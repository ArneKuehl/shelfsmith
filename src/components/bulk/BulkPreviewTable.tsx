import { useEffect, useMemo, useRef, useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { useStore } from "../../lib/store";
import { authorSortKey, seriesSortKey, formatAuthor, swapAuthorName } from "../../lib/naming";
import { decomposeFilename } from "../../lib/lmstudio";
import { lookupGoogleBooks } from "../../lib/bulk";
import { LlmInfoPopup } from "../LlmInfoPopup";
import type { BulkEntry } from "../../types";

export function BulkPreviewTable({
  onRename,
}: {
  onRename: (entry: BulkEntry) => void;
}) {
  const entries = useStore((s) => s.bulkEntries);
  const sortBy = useStore((s) => s.settings.bulk_sort_by);
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateBulkEntry);
  const remove = useStore((s) => s.removeBulkEntry);

  async function handleLlmQuery(entry: BulkEntry) {
    update(entry.id, { status: "scanning" }, false);
    try {
      const decomp = await decomposeFilename(
        settings.lmstudio_url,
        settings.model,
        entry.originalName,
      );
      const patch: Partial<BulkEntry> = {
        status: "ok",
        source: "llm",
        confidence: "medium",
        llmPrompt: decomp.prompt,
        llmRaw: decomp.raw,
      };
      if (decomp.author) patch.author = formatAuthor(decomp.author);
      if (decomp.series) patch.series = decomp.series;
      if (decomp.title) patch.title = decomp.title;
      if (decomp.volume !== null) patch.volume = decomp.volume;

      // Sanitize via web lookup using the LLM-derived data.
      try {
        const queryParts = [patch.title ?? entry.title, patch.author ?? entry.author].filter(Boolean);
        if (queryParts.length > 0) {
          const hit = await lookupGoogleBooks(queryParts.join(" "));
          if (hit) {
            if (hit.title) patch.title = hit.title;
            if (hit.author) patch.author = formatAuthor(hit.author);
            if (hit.series) patch.series = hit.series;
            if (hit.volume !== null) patch.volume = hit.volume;
            patch.source = "web";
            patch.confidence = "high";
          }
        }
      } catch {
        /* web unreachable — keep LLM result */
      }

      update(entry.id, patch, true);
    } catch (err) {
      update(entry.id, {
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      }, false);
    }
  }

  const [editingId, setEditingId] = useState<string | null>(null);
  const lastSortedRef = useRef<BulkEntry[]>([]);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);

  const sorted = useMemo(() => {
    if (editingId) {
      // While editing: keep previous order, but pick up content updates and
      // gracefully handle entries added/removed during the edit.
      const prev = lastSortedRef.current;
      const byId = new Map(entries.map((e) => [e.id, e]));
      const next: BulkEntry[] = [];
      const seen = new Set<string>();
      for (const old of prev) {
        const cur = byId.get(old.id);
        if (cur) {
          next.push(cur);
          seen.add(cur.id);
        }
      }
      for (const e of entries) if (!seen.has(e.id)) next.push(e);
      lastSortedRef.current = next;
      return next;
    }
    const fresh = sortEntries(entries, sortBy);
    lastSortedRef.current = fresh;
    return fresh;
  }, [entries, sortBy, editingId]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => setShowScrollTop(el.scrollTop > 200);
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [entries.length]);

  if (entries.length === 0) return null;

  let lastSeriesKey: string | null = null;

  return (
    <div className="relative flex-1 min-h-0">
      <div ref={scrollerRef} className="absolute inset-0 overflow-auto px-4 py-3 space-y-2">
        {sorted.map((e) => {
          const key = seriesSortKey(e.series);
          const showHeader = sortBy === "series" && key !== lastSeriesKey;
          if (showHeader) lastSeriesKey = key;
          return (
            <div key={e.id}>
              {showHeader && <SeriesGroupHeader label={e.series || "(no series)"} />}
              <Row
                entry={e}
                onChange={(patch) => update(e.id, patch, true)}
                onRemove={() => remove(e.id)}
                onRename={() => onRename(e)}
                onQueryLlm={() => handleLlmQuery(e)}
                onEditStart={() => setEditingId(e.id)}
                onEditEnd={() => setEditingId((cur) => (cur === e.id ? null : cur))}
              />
            </div>
          );
        })}
        <style>{css}</style>
      </div>
      {showScrollTop && (
        <button
          type="button"
          onClick={() =>
            scrollerRef.current?.scrollTo({ top: 0, behavior: "smooth" })
          }
          className="absolute bottom-4 left-4 z-10 px-3 py-2 rounded-full shadow-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 text-sm flex items-center gap-1.5"
          title="Scroll to top"
          aria-label="Back to top"
        >
          <span aria-hidden>↑</span>
          <span>Top</span>
        </button>
      )}
    </div>
  );
}

function SeriesGroupHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 pt-1 pb-1">
      <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
      <span className="text-[11px] uppercase tracking-wider text-slate-600 dark:text-slate-400 font-medium">
        {label}
      </span>
      <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
    </div>
  );
}

function sortEntries(entries: BulkEntry[], by: "author" | "series"): BulkEntry[] {
  const decorated = entries.map((e, i) => ({
    e,
    i,
    aKey: authorSortKey(e.author),
    sKey: seriesSortKey(e.series),
    vol: e.volume ?? Number.POSITIVE_INFINITY,
    name: e.originalName,
    empty: !e.author && !e.series,
  }));
  decorated.sort((x, y) => {
    if (x.empty !== y.empty) return x.empty ? 1 : -1;
    if (by === "author") {
      const a = x.aKey.localeCompare(y.aKey);
      if (a !== 0) return a;
      const s = x.sKey.localeCompare(y.sKey);
      if (s !== 0) return s;
    } else {
      const s = x.sKey.localeCompare(y.sKey);
      if (s !== 0) return s;
      const a = x.aKey.localeCompare(y.aKey);
      if (a !== 0) return a;
    }
    if (x.vol !== y.vol) return x.vol - y.vol;
    const n = x.name.localeCompare(y.name);
    if (n !== 0) return n;
    return x.i - y.i;
  });
  return decorated.map((d) => d.e);
}

function Row({
  entry: e,
  onChange,
  onRemove,
  onRename,
  onQueryLlm,
  onEditStart,
  onEditEnd,
}: {
  entry: BulkEntry;
  onChange: (patch: Partial<BulkEntry>) => void;
  onRemove: () => void;
  onRename: () => void;
  onQueryLlm: () => void;
  onEditStart: () => void;
  onEditEnd: () => void;
}) {
  const [showLlmInfo, setShowLlmInfo] = useState(false);
  const authorRef = useRef<HTMLInputElement>(null);
  const editProps = { onFocus: onEditStart, onBlur: onEditEnd };
  const rowBg =
    e.status === "error"
      ? "bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900/60"
      : e.status === "scanning"
        ? "bg-slate-50 dark:bg-slate-900/60 border-slate-200 dark:border-slate-800"
        : "bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800";

  const renamable = !!e.author && (!!e.series || !!e.title) && e.status !== "renaming";

  return (
    <div className={`rounded-md border ${rowBg} px-3 py-2`}>
      {showLlmInfo && e.llmPrompt != null && e.llmRaw != null && (
        <LlmInfoPopup
          prompt={e.llmPrompt}
          raw={e.llmRaw}
          onClose={() => setShowLlmInfo(false)}
        />
      )}
      {/* Row 1: editable fields */}
      <div className="flex items-end gap-2">
        <Field label="Author" className="flex-1 min-w-[14rem]" onLabelClick={() => {
          onChange({ author: swapAuthorName(e.author) });
          requestAnimationFrame(() => {
            authorRef.current?.focus();
            authorRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
          });
        }}>
          <input
            ref={authorRef}
            className="cell-input"
            value={e.author}
            placeholder="Last name, First name"
            onChange={(ev) => onChange({ author: ev.target.value })}
            {...editProps}
          />
        </Field>
        <Field label="Series" className="flex-1 min-w-[12rem]">
          <input
            className="cell-input"
            value={e.series}
            placeholder="—"
            onChange={(ev) => onChange({ series: ev.target.value })}
            {...editProps}
          />
        </Field>
        <Field label="Volume" className="w-20">
          <VolumeInput
            value={e.volume}
            onCommit={(v) => onChange({ volume: v })}
            onEditStart={onEditStart}
            onEditEnd={onEditEnd}
          />
        </Field>
        <Field label="To" className="w-20">
          <VolumeInput
            value={e.volumeEnd}
            onCommit={(v) => onChange({ volumeEnd: v })}
            onEditStart={onEditStart}
            onEditEnd={onEditEnd}
          />
        </Field>
        <Field label="Title" className="flex-[2] min-w-[16rem]">
          <input
            className="cell-input"
            value={e.title ?? ""}
            placeholder="—"
            onChange={(ev) => onChange({ title: ev.target.value || null })}
            {...editProps}
          />
        </Field>
      </div>

      {/* Row 2: original / proposed names + source badge + action buttons */}
      <div className="flex items-end gap-3 mt-2">
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <button
            type="button"
            className="font-mono text-xs text-slate-500 truncate text-left hover:underline cursor-pointer"
            title={e.originalPath}
            onClick={() => {
              openPath(e.originalPath).catch((err) => console.error("openPath failed", err));
            }}
          >
            {e.originalName}
          </button>
          <span
            className={`font-mono text-xs truncate ${
              e.status === "error" ? "text-rose-700 dark:text-rose-300" : "text-emerald-700 dark:text-emerald-300"
            }`}
            title={e.proposedName}
          >
            → {e.proposedName}
          </span>
        </div>
        <button
          type="button"
          className={`px-1.5 py-0.5 rounded text-xs cursor-pointer hover:opacity-75 active:scale-95 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed ${sourceColor(e.source)}`}
          title={`Source: ${sourceLabel(e.source)} · Confidence: ${e.confidence} · Click to re-query LLM`}
          onClick={onQueryLlm}
          disabled={e.status === "scanning" || e.status === "renaming"}
        >
          {sourceLabel(e.source)}
        </button>
        {e.llmPrompt != null && (
          <button
            type="button"
            className="w-5 h-5 flex items-center justify-center rounded-full text-slate-400 hover:text-violet-600 dark:hover:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/40 transition-colors flex-shrink-0"
            title="Show LLM prompt and response"
            onClick={() => setShowLlmInfo(true)}
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
              <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 1.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11ZM8 5a.75.75 0 1 1 0-1.5A.75.75 0 0 1 8 5Zm-.75 2h1.5v4.5h-1.5V7Z"/>
            </svg>
          </button>
        )}
        {e.status === "scanning" && <span className="text-amber-600 dark:text-amber-400 text-xs">…</span>}
        {e.status === "error" && (
          <span className="text-rose-600 dark:text-rose-400 text-xs" title={e.error}>
            ✗ {e.error}
          </span>
        )}
        <button
          className="action-btn bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed"
          onClick={onRename}
          disabled={!renamable}
          title={renamable ? "Rename" : "Author and series or title required"}
        >
          ✓
        </button>
        <button
          className="action-btn bg-rose-600 hover:bg-rose-500"
          onClick={onRemove}
          title="Remove from list"
        >
          ✗
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  className,
  children,
  onLabelClick,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
  onLabelClick?: () => void;
}) {
  return (
    <div className={className}>
      <label
        className={`block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5${onLabelClick ? " cursor-pointer hover:text-slate-800 dark:hover:text-slate-300" : ""}`}
        onClick={onLabelClick}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function sourceLabel(s: BulkEntry["source"]): string {
  switch (s) {
    case "embedded":
      return "EPUB";
    case "llm":
      return "LLM";
    case "web":
      return "Web";
    case "manual":
      return "manual";
    case "none":
      return "—";
  }
}

function sourceColor(s: BulkEntry["source"]): string {
  switch (s) {
    case "embedded":
      return "bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200";
    case "llm":
      return "bg-violet-100 dark:bg-violet-900/60 text-violet-800 dark:text-violet-200";
    case "web":
      return "bg-sky-100 dark:bg-sky-900/60 text-sky-800 dark:text-sky-200";
    case "manual":
      return "bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200";
    case "none":
      return "bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400";
  }
}

function VolumeInput({
  value,
  onCommit,
  onEditStart,
  onEditEnd,
}: {
  value: number | null;
  onCommit: (v: number | null) => void;
  onEditStart: () => void;
  onEditEnd: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const display = text ?? (value === null ? "" : String(value));

  return (
    <input
      className="cell-input text-center"
      value={display}
      placeholder="—"
      inputMode="decimal"
      onFocus={() => {
        setText(value === null ? "" : String(value));
        onEditStart();
      }}
      onChange={(ev) => {
        const raw = ev.target.value;
        if (!/^-?\d*[.,]?\d*$/.test(raw)) return;
        setText(raw);
        const norm = raw.trim().replace(",", ".");
        if (norm === "" || norm === "-") return onCommit(null);
        const n = Number.parseFloat(norm);
        if (Number.isFinite(n)) onCommit(n);
      }}
      onBlur={() => {
        setText(null);
        onEditEnd();
      }}
    />
  );
}

const css = `
  .cell-input { width: 100%; background: rgb(255 255 255); border: 1px solid rgb(203 213 225);
    border-radius: 4px; padding: 6px 10px; font-size: 14px; color: rgb(15 23 42); }
  .dark .cell-input { background: rgb(15 23 42); border-color: rgb(51 65 85); color: rgb(226 232 240); }
  .cell-input:focus { outline: none; border-color: rgb(59 130 246); }
  .action-btn { display: inline-flex; align-items: center; justify-content: center;
    width: 32px; height: 32px; border-radius: 6px; color: white; font-weight: 700;
    flex-shrink: 0; }
`;
