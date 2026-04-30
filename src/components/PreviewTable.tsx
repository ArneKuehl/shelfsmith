import { useMemo, useState } from "react";
import { useStore } from "../lib/store";
import { entryHasCollision, entryHasInvalidName, findCollisions } from "../lib/collisions";
import type { FileEntry } from "../types";

type ColKey = "oldName" | "volume" | "title" | "newName";
type Widths = Record<ColKey, number>;

const DEFAULT_WIDTHS: Widths = {
  oldName: 280,
  volume: 130,
  title: 280,
  newName: 360,
};

const MIN_WIDTH = 60;

export function PreviewTable() {
  const entries = useStore((s) => s.entries);
  const toggleSelected = useStore((s) => s.toggleSelected);
  const updateEntry = useStore((s) => s.updateEntry);
  const removeEntry = useStore((s) => s.removeEntry);

  const collisions = useMemo(() => findCollisions(entries), [entries]);
  const [widths, setWidths] = useState<Widths>(DEFAULT_WIDTHS);

  const startResize = (key: ColKey, e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = widths[key];
    const onMove = (ev: MouseEvent) => {
      setWidths((w) => ({ ...w, [key]: Math.max(MIN_WIDTH, startW + ev.clientX - startX) }));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  if (entries.length === 0) return null;

  return (
    <div className="flex-1 overflow-auto px-4 py-2">
      <table className="text-sm border-separate border-spacing-y-1 table-fixed" style={{ width: "max-content", minWidth: "100%" }}>
        <colgroup>
          <col style={{ width: 32 }} />
          <col style={{ width: widths.oldName }} />
          <col style={{ width: widths.volume }} />
          <col style={{ width: widths.title }} />
          <col style={{ width: widths.newName }} />
          <col style={{ width: 64 }} />
          <col style={{ width: 32 }} />
        </colgroup>
        <thead className="text-xs uppercase text-slate-600 dark:text-slate-400 sticky top-0 bg-white dark:bg-slate-950">
          <tr>
            <th className="text-left px-2 py-2"></th>
            <ResizableTh label="Altname" onResize={(e) => startResize("oldName", e)} />
            <ResizableTh label="Band(-Range)" onResize={(e) => startResize("volume", e)} />
            <ResizableTh label="Titel" onResize={(e) => startResize("title", e)} />
            <ResizableTh label="Neuname" onResize={(e) => startResize("newName", e)} />
            <th className="text-left px-2 py-2">Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <Row
              key={e.id}
              entry={e}
              hasCollision={entryHasCollision(e, collisions)}
              hasInvalidName={entryHasInvalidName(e)}
              onToggle={() => toggleSelected(e.id)}
              onChangeVolume={(v) => updateEntry(e.id, { volume: v })}
              onChangeVolumeEnd={(v) => updateEntry(e.id, { volumeEnd: v })}
              onChangeTitle={(t) => updateEntry(e.id, { title: t })}
              onRemove={() => removeEntry(e.id)}
            />
          ))}
        </tbody>
      </table>
      <style>{tableCss}</style>
    </div>
  );
}

function ResizableTh({
  label,
  onResize,
}: {
  label: string;
  onResize: (e: React.MouseEvent) => void;
}) {
  return (
    <th className="text-left px-2 py-2 relative select-none">
      <span className="block truncate pr-2">{label}</span>
      <div
        onMouseDown={onResize}
        onDoubleClick={(e) => e.stopPropagation()}
        className="resizer"
        title="Spaltenbreite ziehen"
      />
    </th>
  );
}

function Row({
  entry: e,
  hasCollision,
  hasInvalidName,
  onToggle,
  onChangeVolume,
  onChangeVolumeEnd,
  onChangeTitle,
  onRemove,
}: {
  entry: FileEntry;
  hasCollision: boolean;
  hasInvalidName: boolean;
  onToggle: () => void;
  onChangeVolume: (v: number | null) => void;
  onChangeVolumeEnd: (v: number | null) => void;
  onChangeTitle: (t: string | null) => void;
  onRemove: () => void;
}) {
  const dim = !e.selected ? "opacity-40" : "";
  const bad = (hasCollision || hasInvalidName) && e.selected;
  const rowBg = bad ? "bg-rose-950/40" : "bg-slate-50 dark:bg-slate-900";
  const rowTooltip = hasCollision
    ? "Kollision: anderer Eintrag bekommt denselben Namen"
    : hasInvalidName
      ? "Ungültiger Dateiname"
      : "";

  return (
    <tr className={`${rowBg} ${dim}`}>
      <td className="px-2 py-2 rounded-l" title={rowTooltip}>
        <input type="checkbox" checked={e.selected} onChange={onToggle} />
      </td>
      <td className="px-2 py-2 font-mono text-xs text-slate-600 dark:text-slate-400" title={e.originalName}>
        <div className="truncate">{e.originalName}</div>
      </td>
      <td className="px-2 py-2">
        <div className="flex items-center gap-1">
          <input
            className="cell-input w-12 text-center"
            value={e.volume ?? ""}
            placeholder="—"
            onChange={(ev) => {
              const v = ev.target.value.trim();
              onChangeVolume(v === "" ? null : Number.parseInt(v, 10) || null);
            }}
          />
          <span className="text-slate-500 text-xs">–</span>
          <input
            className="cell-input w-12 text-center"
            value={e.volumeEnd ?? ""}
            placeholder="—"
            title="Endband bei Sammelband, sonst leer"
            onChange={(ev) => {
              const v = ev.target.value.trim();
              onChangeVolumeEnd(v === "" ? null : Number.parseInt(v, 10) || null);
            }}
          />
        </div>
      </td>
      <td className="px-2 py-2">
        <input
          className="cell-input"
          placeholder="—"
          value={e.title ?? ""}
          onChange={(ev) => onChangeTitle(ev.target.value || null)}
        />
      </td>
      <td className="px-2 py-2 font-mono text-xs" title={e.proposedName}>
        <div className={`truncate ${bad ? "text-rose-700 dark:text-rose-300" : "text-emerald-700 dark:text-emerald-300"}`}>
          {e.proposedName}
        </div>
      </td>
      <td className="px-2 py-2 text-xs">
        {e.status === "renaming" && <span className="text-amber-600 dark:text-amber-400">…</span>}
        {e.status === "done" && <span className="text-emerald-400">✓</span>}
        {e.status === "error" && (
          <span className="text-rose-600 dark:text-rose-400" title={e.error}>✗</span>
        )}
      </td>
      <td className="px-2 py-2 rounded-r">
        <button
          className="text-slate-500 hover:text-rose-600 dark:text-rose-400"
          onClick={onRemove}
          title="Entfernen"
        >
          ×
        </button>
      </td>
    </tr>
  );
}

const tableCss = `
  .cell-input { width: 100%; background: rgb(255 255 255); border: 1px solid rgb(203 213 225);
    border-radius: 4px; padding: 4px 8px; font-size: 13px; color: rgb(15 23 42); }
  .dark .cell-input { background: rgb(15 23 42); border-color: rgb(51 65 85); color: rgb(226 232 240); }
  .cell-input:focus { outline: none; border-color: rgb(59 130 246); }
  .resizer { position: absolute; right: 0; top: 0; bottom: 0; width: 6px;
    cursor: col-resize; user-select: none; }
  .resizer:hover { background: rgb(59 130 246); }
`;
