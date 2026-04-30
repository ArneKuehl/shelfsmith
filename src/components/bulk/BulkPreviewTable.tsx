import { useStore } from "../../lib/store";
import type { BulkEntry } from "../../types";

export function BulkPreviewTable({
  onRename,
}: {
  onRename: (entry: BulkEntry) => void;
}) {
  const entries = useStore((s) => s.bulkEntries);
  const update = useStore((s) => s.updateBulkEntry);
  const remove = useStore((s) => s.removeBulkEntry);

  if (entries.length === 0) return null;

  return (
    <div className="flex-1 overflow-auto px-4 py-3 space-y-2">
      {entries.map((e) => (
        <Row
          key={e.id}
          entry={e}
          onChange={(patch) => update(e.id, patch, true)}
          onRemove={() => remove(e.id)}
          onRename={() => onRename(e)}
        />
      ))}
      <style>{css}</style>
    </div>
  );
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
      ? "bg-rose-950/30 border-rose-900/60"
      : e.status === "scanning"
        ? "bg-slate-900/60 border-slate-800"
        : "bg-slate-900 border-slate-800";

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
        <span className="text-slate-600 text-xs">→</span>
        <span
          className={`font-mono text-xs truncate flex-[2] min-w-0 ${
            e.status === "error" ? "text-rose-300" : "text-emerald-300"
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
        {e.status === "scanning" && <span className="text-amber-400 text-xs">…</span>}
        {e.status === "error" && (
          <span className="text-rose-400 text-xs" title={e.error}>
            ✗ {e.error}
          </span>
        )}
        <button
          className="action-btn bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:cursor-not-allowed"
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
      return "bg-emerald-900/60 text-emerald-200";
    case "web":
      return "bg-sky-900/60 text-sky-200";
    case "manual":
      return "bg-amber-900/60 text-amber-200";
    case "none":
      return "bg-slate-800 text-slate-400";
  }
}

const css = `
  .cell-input { width: 100%; background: rgb(15 23 42); border: 1px solid rgb(51 65 85);
    border-radius: 4px; padding: 6px 10px; font-size: 14px; color: rgb(226 232 240); }
  .cell-input:focus { outline: none; border-color: rgb(59 130 246); }
  .action-btn { display: inline-flex; align-items: center; justify-content: center;
    width: 32px; height: 32px; border-radius: 6px; color: white; font-weight: 700;
    flex-shrink: 0; }
`;
