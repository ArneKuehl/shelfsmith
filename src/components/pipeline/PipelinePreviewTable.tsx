import { useMemo, useRef, useState, useEffect } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { useStore } from "../../lib/store";
import { authorSortKey, swapAuthorName } from "../../lib/naming";
import type { PipelineEntry } from "../../types";

export function PipelinePreviewTable({
  onRename,
}: {
  onRename: (entry: PipelineEntry) => void;
}) {
  const entries = useStore((s) => s.pipelineEntries);
  const update = useStore((s) => s.updatePipelineEntry);
  const remove = useStore((s) => s.removePipelineEntry);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"author" | "confidence" | "pattern">("confidence");
  const [filterConf, setFilterConf] = useState<"all" | "high" | "medium" | "low">("all");
  const lastSortedRef = useRef<PipelineEntry[]>([]);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);

  const filtered = useMemo(() => {
    if (filterConf === "all") return entries;
    return entries.filter((e) => {
      if (filterConf === "high") return e.overallConfidence >= 0.7;
      if (filterConf === "medium")
        return e.overallConfidence >= 0.4 && e.overallConfidence < 0.7;
      return e.overallConfidence < 0.4;
    });
  }, [entries, filterConf]);

  const sorted = useMemo(() => {
    if (editingId) {
      const prev = lastSortedRef.current;
      const byId = new Map(filtered.map((e) => [e.id, e]));
      const next: PipelineEntry[] = [];
      const seen = new Set<string>();
      for (const old of prev) {
        const cur = byId.get(old.id);
        if (cur) {
          next.push(cur);
          seen.add(cur.id);
        }
      }
      for (const e of filtered) if (!seen.has(e.id)) next.push(e);
      lastSortedRef.current = next;
      return next;
    }
    const fresh = sortEntries(filtered, sortBy);
    lastSortedRef.current = fresh;
    return fresh;
  }, [filtered, sortBy, editingId]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => setShowScrollTop(el.scrollTop > 200);
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [entries.length]);

  if (entries.length === 0) return null;

  const confCounts = {
    all: entries.length,
    high: entries.filter((e) => e.overallConfidence >= 0.7).length,
    medium: entries.filter(
      (e) => e.overallConfidence >= 0.4 && e.overallConfidence < 0.7,
    ).length,
    low: entries.filter((e) => e.overallConfidence < 0.4).length,
  };

  return (
    <div className="relative flex-1 min-h-0">
      {/* Filter & sort bar */}
      <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center gap-3 text-xs">
        <span className="text-slate-500 dark:text-slate-400">Filter:</span>
        {(["all", "high", "medium", "low"] as const).map((level) => (
          <button
            key={level}
            onClick={() => setFilterConf(level)}
            className={`px-2 py-1 rounded ${
              filterConf === level
                ? "bg-blue-600 text-white"
                : "bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700"
            }`}
          >
            {level === "all"
              ? `All (${confCounts.all})`
              : level === "high"
                ? `High (${confCounts.high})`
                : level === "medium"
                  ? `Medium (${confCounts.medium})`
                  : `Low (${confCounts.low})`}
          </button>
        ))}
        <span className="ml-4 text-slate-500 dark:text-slate-400">Sort:</span>
        {(["confidence", "author", "pattern"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSortBy(s)}
            className={`px-2 py-1 rounded capitalize ${
              sortBy === s
                ? "bg-blue-600 text-white"
                : "bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div
        ref={scrollerRef}
        className="absolute inset-0 top-[41px] overflow-auto px-4 py-3 space-y-2"
      >
        {sorted.map((e) => (
          <Row
            key={e.id}
            entry={e}
            onChange={(patch) => update(e.id, patch)}
            onRemove={() => remove(e.id)}
            onRename={() => onRename(e)}
            onEditStart={() => setEditingId(e.id)}
            onEditEnd={() =>
              setEditingId((cur) => (cur === e.id ? null : cur))
            }
          />
        ))}
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

function sortEntries(
  entries: PipelineEntry[],
  by: "author" | "confidence" | "pattern",
): PipelineEntry[] {
  const arr = entries.slice();
  arr.sort((a, b) => {
    if (by === "confidence") {
      const c = a.overallConfidence - b.overallConfidence;
      if (c !== 0) return c;
      return a.originalName.localeCompare(b.originalName);
    }
    if (by === "pattern") {
      const p = a.matchedPattern.localeCompare(b.matchedPattern);
      if (p !== 0) return p;
      return a.originalName.localeCompare(b.originalName);
    }
    const ak = authorSortKey(a.author);
    const bk = authorSortKey(b.author);
    const c = ak.localeCompare(bk);
    if (c !== 0) return c;
    return a.originalName.localeCompare(b.originalName);
  });
  return arr;
}

function Row({
  entry: e,
  onChange,
  onRemove,
  onRename,
  onEditStart,
  onEditEnd,
}: {
  entry: PipelineEntry;
  onChange: (patch: Partial<PipelineEntry>) => void;
  onRemove: () => void;
  onRename: () => void;
  onEditStart: () => void;
  onEditEnd: () => void;
}) {
  const authorRef = useRef<HTMLInputElement>(null);
  const editProps = { onFocus: onEditStart, onBlur: onEditEnd };
  const renamable =
    e.proposedName !== e.originalName && e.status !== "renaming";

  const rowBg =
    e.status === "error"
      ? "bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900/60"
      : e.status === "scanning"
        ? "bg-slate-50 dark:bg-slate-900/60 border-slate-200 dark:border-slate-800"
        : "bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800";

  return (
    <div className={`rounded-md border ${rowBg} px-3 py-2`}>
      {/* Row 1: editable fields */}
      <div className="flex items-end gap-2">
        <Field
          label="Author"
          className="flex-1 min-w-[14rem]"
          confidence={e.authorConfidence}
          onLabelClick={() => {
            onChange({ author: swapAuthorName(e.author) });
            requestAnimationFrame(() => {
              authorRef.current?.focus();
              authorRef.current?.scrollIntoView({
                block: "center",
                behavior: "smooth",
              });
            });
          }}
        >
          <input
            ref={authorRef}
            className="cell-input"
            value={e.author}
            placeholder="Last name, First name"
            onChange={(ev) => onChange({ author: ev.target.value })}
            {...editProps}
          />
        </Field>
        <Field
          label="Series"
          className="flex-1 min-w-[12rem]"
          confidence={e.seriesConfidence}
        >
          <input
            className="cell-input"
            value={e.series}
            placeholder="—"
            onChange={(ev) => onChange({ series: ev.target.value })}
            {...editProps}
          />
        </Field>
        <Field label="Volume" className="w-20">
          <input
            className="cell-input text-center"
            value={e.volume ?? ""}
            placeholder="—"
            onChange={(ev) =>
              onChange({ volume: ev.target.value || null })
            }
            {...editProps}
          />
        </Field>
        <Field
          label="Title"
          className="flex-[2] min-w-[16rem]"
          confidence={e.titleConfidence}
        >
          <input
            className="cell-input"
            value={e.title ?? ""}
            placeholder="—"
            onChange={(ev) =>
              onChange({ title: ev.target.value || null })
            }
            {...editProps}
          />
        </Field>
      </div>

      {/* Row 2: original / proposed names + badges + actions */}
      <div className="flex items-end gap-3 mt-2">
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <button
            type="button"
            className="font-mono text-xs text-slate-500 truncate text-left hover:underline cursor-pointer"
            title={e.originalPath}
            onClick={() => {
              openPath(e.originalPath).catch((err) =>
                console.error("openPath failed", err),
              );
            }}
          >
            {e.originalName}
          </button>
          <span
            className={`font-mono text-xs truncate ${
              e.status === "error"
                ? "text-rose-700 dark:text-rose-300"
                : "text-emerald-700 dark:text-emerald-300"
            }`}
            title={e.proposedName}
          >
            → {e.proposedName}
          </span>
        </div>

        {/* Confidence badge */}
        <span
          className={`px-1.5 py-0.5 rounded text-xs font-medium ${confidenceColor(e.overallConfidence)}`}
          title={`Confidence: ${(e.overallConfidence * 100).toFixed(0)}%`}
        >
          {(e.overallConfidence * 100).toFixed(0)}%
        </span>

        {/* Pattern badge */}
        <span
          className="px-1.5 py-0.5 rounded text-xs bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
          title={`Matched pattern: ${e.matchedPattern}`}
        >
          {e.matchedPattern}
        </span>

        {/* Tags */}
        {e.tags.map((tag) => (
          <span
            key={tag}
            className="px-1.5 py-0.5 rounded text-xs bg-indigo-100 dark:bg-indigo-900/60 text-indigo-800 dark:text-indigo-200"
          >
            {tag}
          </span>
        ))}

        {e.status === "scanning" && (
          <span className="text-amber-600 dark:text-amber-400 text-xs">
            …
          </span>
        )}
        {e.status === "error" && (
          <span
            className="text-rose-600 dark:text-rose-400 text-xs"
            title={e.error}
          >
            {e.error}
          </span>
        )}

        <button
          className="action-btn bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed"
          onClick={onRename}
          disabled={!renamable}
          title={renamable ? "Rename" : "No changes to apply"}
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
  confidence,
  onLabelClick,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
  confidence?: number;
  onLabelClick?: () => void;
}) {
  const confDot =
    confidence !== undefined
      ? confidence >= 0.7
        ? "text-emerald-500"
        : confidence >= 0.4
          ? "text-amber-500"
          : "text-rose-500"
      : null;

  return (
    <div className={className}>
      <label
        className={`block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 flex items-center gap-1${
          onLabelClick
            ? " cursor-pointer hover:text-slate-800 dark:hover:text-slate-300"
            : ""
        }`}
        onClick={onLabelClick}
      >
        {label}
        {confDot && <span className={confDot}>●</span>}
      </label>
      {children}
    </div>
  );
}

function confidenceColor(c: number): string {
  if (c >= 0.7)
    return "bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200";
  if (c >= 0.4)
    return "bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200";
  return "bg-rose-100 dark:bg-rose-900/60 text-rose-800 dark:text-rose-200";
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
