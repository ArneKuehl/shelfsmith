import { useMemo } from "react";
import { useStore } from "../../lib/store";
import { authorSortKey, seriesSortKey } from "../../lib/naming";
import type { BulkEntry } from "../../types";

export function BulkPreviewTable({
  onRename,
}: {
  onRename: (entry: BulkEntry) => void;
}) {
  const entries = useStore((s) => s.bulkEntries);
  const sortBy = useStore((s) => s.settings.bulk_sort_by);
  const update = useStore((s) => s.updateBulkEntry);
  const remove = useStore((s) => s.removeBulkEntry);

  const sorted = useMemo(() => sortEntries(entries, sortBy), [entries, sortBy]);

  if (entries.length === 0) return null;

  let lastSeriesKey: string | null = null;

  return (
    <div className="flex-1 overflow-auto px-4 py-3 space-y-2">
      {sorted.map((e) => {
        const key = seriesSortKey(e.series);
        const showHeader = sortBy === "series" && key !== lastSeriesKey;
        if (showHeader) lastSeriesKey = key;
        return (
          <div key={e.id}>
            {showHeader && <SeriesGroupHeader label={e.series || "(ohne Serie)"} />}
            <Row
              entry={e}
              onChange={(patch) => update(e.id, patch, true)}
              onRemove={() => remove(e.id)}
              onRename={() => onRename(e)}
            />
          </div>
        );
      })}
      <style>{css}</style>
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
}: {
  entry: BulkEntry;
  onChange: (patch: Partial<BulkEntry>) => void;
  onRemove: () => void;
  onRename: () => void;
}) {
  const rowBg =
    e.status === "error"
      ? "bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900/60"
      : e.status === "scanning"
        ? "bg-slate-50 dark:bg-slate-900/60 border-slate-200 dark:border-slate-800"
        : "bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800";

  const renamable = !!e.author && !!e.series && e.status !== "renaming";

  return (
    <div className={`rounded-md border ${rowBg} px-3 py-2`}>
      {/* Row 1: editable fields */}
      <div className="flex items-end gap-2">
        <Field label="Autor" className="flex-1 min-w-[14rem]">
          <input
            className="cell-input"
            value={e.author}
            placeholder="Nachname, Vorname"
            onChange={(ev) => onChange({ author: ev.target.value })}
          />
        </Field>
        <Field label="Serie" className="flex-1 min-w-[12rem]">
          <input
            className="cell-input"
            value={e.series}
            placeholder="—"
            onChange={(ev) => onChange({ series: ev.target.value })}
          />
        </Field>
        <Field label="Band" className="w-20">
          <input
            className="cell-input text-center"
            value={e.volume ?? ""}
            placeholder="—"
            onChange={(ev) => {
              const v = ev.target.value.trim();
              onChange({ volume: v === "" ? null : Number.parseInt(v, 10) || null });
            }}
          />
        </Field>
        <Field label="Bis" className="w-20">
          <input
            className="cell-input text-center"
            value={e.volumeEnd ?? ""}
            placeholder="—"
            onChange={(ev) => {
              const v = ev.target.value.trim();
              onChange({ volumeEnd: v === "" ? null : Number.parseInt(v, 10) || null });
            }}
          />
        </Field>
        <Field label="Titel" className="flex-[2] min-w-[16rem]">
          <input
            className="cell-input"
            value={e.title ?? ""}
            placeholder="—"
            onChange={(ev) => onChange({ title: ev.target.value || null })}
          />
        </Field>
      </div>

      {/* Row 2: original → proposed, source badge, action buttons */}
      <div className="flex items-center gap-3 mt-2">
        <span
          className="font-mono text-xs text-slate-500 truncate flex-1 min-w-0"
          title={e.originalPath}
        >
          {e.originalName}
        </span>
        <span className="text-slate-500 dark:text-slate-600 text-xs">→</span>
        <span
          className={`font-mono text-xs truncate flex-[2] min-w-0 ${
            e.status === "error" ? "text-rose-700 dark:text-rose-300" : "text-emerald-700 dark:text-emerald-300"
          }`}
          title={e.proposedName}
        >
          {e.proposedName}
        </span>
        <span
          className={`px-1.5 py-0.5 rounded text-xs ${sourceColor(e.source)}`}
          title={`Konfidenz: ${e.confidence}`}
        >
          {sourceLabel(e.source)}
        </span>
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
          title={renamable ? "Umbenennen" : "Autor und Serie erforderlich"}
        >
          ✓
        </button>
        <button
          className="action-btn bg-rose-600 hover:bg-rose-500"
          onClick={onRemove}
          title="Aus Liste entfernen"
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
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">
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
    case "web":
      return "Web";
    case "manual":
      return "manuell";
    case "none":
      return "—";
  }
}

function sourceColor(s: BulkEntry["source"]): string {
  switch (s) {
    case "embedded":
      return "bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200";
    case "web":
      return "bg-sky-100 dark:bg-sky-900/60 text-sky-800 dark:text-sky-200";
    case "manual":
      return "bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200";
    case "none":
      return "bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400";
  }
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
