import { useEffect, useRef, useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { useStore } from "../../lib/store";
import type { LibraryCluster, LibraryEntry, LibraryIssueKind } from "../../types";

type Props = {
  cluster: LibraryCluster | null;
  entries: LibraryEntry[];
  onApply: (entry: LibraryEntry) => void;
  onApplyAll: () => void;
  onAskLlm: (entry: LibraryEntry) => void;
  onUpdateCluster: (patch: { author?: string; series?: string }) => void;
  onDelete: (entry: LibraryEntry) => void;
  onManualRename: (entry: LibraryEntry, newName: string) => void;
  onWriteMetadata: () => void;
  busy: boolean;
};

const ISSUE_COLORS: Record<LibraryIssueKind, string> = {
  "author-variant": "bg-violet-100 dark:bg-violet-900/60 text-violet-800 dark:text-violet-200",
  "series-variant": "bg-sky-100 dark:bg-sky-900/60 text-sky-800 dark:text-sky-200",
  "duplicate-volume": "bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200",
  "format-duplicate": "bg-orange-100 dark:bg-orange-900/60 text-orange-800 dark:text-orange-200",
  "format-preference": "bg-cyan-100 dark:bg-cyan-900/60 text-cyan-800 dark:text-cyan-200",
  "volume-gap": "bg-rose-100 dark:bg-rose-900/60 text-rose-800 dark:text-rose-200",
  "range-or-omnibus": "bg-teal-100 dark:bg-teal-900/60 text-teal-800 dark:text-teal-200",
  "unpadded-volume": "bg-lime-100 dark:bg-lime-900/60 text-lime-800 dark:text-lime-200",
  unparsable: "bg-red-100 dark:bg-red-900/60 text-red-800 dark:text-red-200",
  orphan: "bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300",
  "title-case": "bg-indigo-100 dark:bg-indigo-900/60 text-indigo-800 dark:text-indigo-200",
  "metadata-mismatch": "bg-purple-100 dark:bg-purple-900/60 text-purple-800 dark:text-purple-200",
};

const ISSUE_LABELS: Record<LibraryIssueKind, string> = {
  "author-variant": "Autor",
  "series-variant": "Serie",
  "duplicate-volume": "Duplikat",
  "format-duplicate": "Format",
  "format-preference": "Format",
  "volume-gap": "Lücke",
  "range-or-omnibus": "Range",
  "unpadded-volume": "Padding",
  unparsable: "?",
  orphan: "Orphan",
  "title-case": "Casing",
  "metadata-mismatch": "Meta",
};

// ---------------------------------------------------------------------------
// Resizable column widths
// ---------------------------------------------------------------------------

type ColKey = "datei" | "issues" | "vorschlag" | "actions";
type ColWidths = Record<ColKey, number>;

const WIDTHS_KEY = "lib_col_widths_v1";
const DEFAULT_WIDTHS: ColWidths = { datei: 560, issues: 140, vorschlag: 360, actions: 200 };
const MIN_WIDTH = 60;

function loadWidths(): ColWidths {
  try {
    const raw = localStorage.getItem(WIDTHS_KEY);
    if (!raw) return DEFAULT_WIDTHS;
    return { ...DEFAULT_WIDTHS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_WIDTHS;
  }
}

function ResizeHandle({
  onDrag,
}: {
  onDrag: (delta: number) => void;
}) {
  const startX = useRef(0);
  function onMouseDown(ev: React.MouseEvent) {
    ev.preventDefault();
    startX.current = ev.clientX;
    const onMove = (e: MouseEvent) => onDrag(e.clientX - startX.current);
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }
  return (
    <div
      onMouseDown={onMouseDown}
      className="absolute -right-1.5 top-0 bottom-0 w-3 cursor-col-resize z-10 hover:bg-blue-500/30 active:bg-blue-500/50"
    />
  );
}

function buildCopyString(author: string, series: string): string {
  const parts = author.split(",").map((s) => s.trim());
  const name = parts.length === 2 ? `${parts[1]} ${parts[0]}` : author;
  const raw = `${name} ${series}`.trim();
  return raw
    .replace(/[^a-zA-Z0-9äöüÄÖÜß\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function LibraryTable({ cluster, entries, onApply, onApplyAll, onAskLlm, onUpdateCluster, onDelete, onManualRename, onWriteMetadata, busy }: Props) {
  const toggleSelected = useStore((s) => s.toggleLibrarySelected);
  const [widths, setWidths] = useState<ColWidths>(loadWidths);
  const baseWidths = useRef<ColWidths>(widths);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(WIDTHS_KEY, JSON.stringify(widths));
    } catch {
      /* ignore */
    }
  }, [widths]);

  function makeDragger(key: ColKey) {
    return (delta: number) => {
      setWidths((w) => {
        if (delta === 0 && baseWidths.current !== w) {
          baseWidths.current = w;
          return w;
        }
        return { ...w, [key]: Math.max(MIN_WIDTH, baseWidths.current[key] + delta) };
      });
    };
  }

  function onDragStart(key: ColKey) {
    baseWidths.current = widths;
    return makeDragger(key);
  }

  if (!cluster) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
        Serie in der linken Spalte wählen
      </div>
    );
  }

  const clusterEntries = entries
    .filter((e) => e.clusterId === cluster.id)
    .sort((a, b) => {
      if (a.volume === null && b.volume === null) return a.originalName.localeCompare(b.originalName);
      if (a.volume === null) return 1;
      if (b.volume === null) return -1;
      return a.volume - b.volume;
    });

  const withSuggestions = clusterEntries.filter((e) => e.suggestion && e.status !== "done");
  const selectedWithSuggestions = withSuggestions.filter((e) => e.selected);
  const hasEpub = clusterEntries.some((e) => e.extension.toLowerCase() === ".epub");
  const mismatchCount = clusterEntries.filter((e) =>
    e.issues.some((i) => i.kind === "metadata-mismatch"),
  ).length;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Cluster header */}
      <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex items-center gap-3">
        <div className="flex-1 min-w-0 flex items-center gap-1">
          <EditableLabel
            value={cluster.canonicalAuthor}
            placeholder="Autor"
            className="font-semibold text-sm"
            onCommit={(v) => onUpdateCluster({ author: v })}
          />
          <span className="mx-1 text-slate-400">—</span>
          <EditableLabel
            value={cluster.canonicalSeries || ""}
            placeholder="Serie"
            className="text-sm"
            onCommit={(v) => onUpdateCluster({ series: v })}
          />
          <button
            type="button"
            title="Autor + Serie kopieren"
            className="ml-1 p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors flex-shrink-0"
            onClick={() => {
              const text = buildCopyString(cluster.canonicalAuthor, cluster.canonicalSeries ?? "");
              navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-green-500">
                <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path d="M7 3.5A1.5 1.5 0 0 1 8.5 2h3.879a1.5 1.5 0 0 1 1.06.44l3.122 3.12A1.5 1.5 0 0 1 17 6.622V12.5a1.5 1.5 0 0 1-1.5 1.5h-1v-3.379a3 3 0 0 0-.879-2.121L10.5 5.379A3 3 0 0 0 8.379 4.5H7v-1Z" />
                <path d="M4.5 6A1.5 1.5 0 0 0 3 7.5v9A1.5 1.5 0 0 0 4.5 18h7a1.5 1.5 0 0 0 1.5-1.5v-5.879a1.5 1.5 0 0 0-.44-1.06L9.44 6.439A1.5 1.5 0 0 0 8.378 6H4.5Z" />
              </svg>
            )}
          </button>
          <span className="ml-2 text-xs text-slate-400 flex-shrink-0">
            {clusterEntries.length} Datei(en)
          </span>
        </div>
        {cluster.missingVolumes.length > 0 && (
          <span className="text-xs text-rose-600 dark:text-rose-400">
            Fehlend: {cluster.missingVolumes.join(", ")}
          </span>
        )}
        {withSuggestions.length > 0 && (
          <button
            onClick={onApplyAll}
            disabled={busy || selectedWithSuggestions.length === 0}
            className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed text-white text-xs font-medium"
          >
            {busy
              ? "Wende an…"
              : `${selectedWithSuggestions.length} ausgewählte anwenden`}
          </button>
        )}
        {hasEpub && (
          <button
            onClick={onWriteMetadata}
            disabled={busy}
            className="px-3 py-1.5 rounded-md bg-purple-600 hover:bg-purple-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed text-white text-xs font-medium"
            title="Schreibt Autor, Serie, Band und Titel aus dem normierten Dateinamen in die EPUB-OPF-Metadaten."
          >
            Metadaten in EPUBs schreiben
            {mismatchCount > 0 ? ` (${mismatchCount})` : ""}
          </button>
        )}
      </div>

      {/* Entries table */}
      <div className="flex-1 overflow-auto">
        <div className="min-w-max">
          {/* Sticky column headers */}
          <div className="sticky top-0 z-10 bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800">
            <div className="flex items-center">
              <div className="w-8 flex-shrink-0 px-2 py-1.5 text-center">
                {withSuggestions.length > 0 && (
                  <input
                    type="checkbox"
                    checked={withSuggestions.length > 0 && withSuggestions.every((e) => e.selected)}
                    ref={(el) => {
                      if (el) el.indeterminate = withSuggestions.some((e) => e.selected) && !withSuggestions.every((e) => e.selected);
                    }}
                    onChange={(ev) => {
                      const checked = ev.target.checked;
                      for (const e of withSuggestions) {
                        if (e.selected !== checked) toggleSelected(e.id);
                      }
                    }}
                    title="Alle auswählen / abwählen"
                  />
                )}
              </div>
              <div className="relative px-2 py-1.5 font-medium text-xs uppercase tracking-wider text-slate-600 dark:text-slate-400 flex-shrink-0" style={{ width: widths.datei }}>
                Datei
                <ResizeHandle onDrag={onDragStart("datei")} />
              </div>
              <div className="relative px-2 py-1.5 font-medium text-xs uppercase tracking-wider text-slate-600 dark:text-slate-400 flex-shrink-0" style={{ width: widths.issues }}>
                Issues
                <ResizeHandle onDrag={onDragStart("issues")} />
              </div>
              <div className="relative px-2 py-1.5 font-medium text-xs uppercase tracking-wider text-slate-600 dark:text-slate-400 flex-shrink-0" style={{ width: widths.vorschlag }}>
                Vorschlag
                <ResizeHandle onDrag={onDragStart("vorschlag")} />
              </div>
              <div className="px-2 py-1.5 font-medium text-xs uppercase tracking-wider text-slate-600 dark:text-slate-400 flex-shrink-0" style={{ width: widths.actions }} />
            </div>
          </div>

          {/* Rows */}
          {clusterEntries.map((e) => {
            return (
              <div
                key={e.id}
                className={`flex items-center border-b border-slate-100 dark:border-slate-800/50 ${
                  e.status === "done"
                    ? "opacity-50"
                    : e.status === "error"
                      ? "bg-rose-50 dark:bg-rose-950/30"
                      : ""
                }`}
              >
                {/* Checkbox */}
                <div className="w-8 flex-shrink-0 px-2 py-1.5 text-center">
                  {e.suggestion && e.status !== "done" && (
                    <input
                      type="checkbox"
                      checked={e.selected}
                      onChange={() => toggleSelected(e.id)}
                    />
                  )}
                </div>

                {/* Datei */}
                <div
                  className="px-2 py-1.5 flex-shrink-0 overflow-hidden"
                  style={{ width: widths.datei }}
                >
                  {editingId === e.id ? (
                    <div className="flex items-center gap-1">
                      <input
                        autoFocus
                        value={editingName}
                        onChange={(ev) => setEditingName(ev.target.value)}
                        onKeyDown={(ev) => {
                          if (ev.key === "Enter") {
                            const name = editingName;
                            setEditingId(null);
                            onManualRename(e, name);
                          } else if (ev.key === "Escape") {
                            setEditingId(null);
                          }
                        }}
                        className="flex-1 text-sm bg-white dark:bg-slate-950 border border-blue-400 dark:border-blue-600 rounded px-1.5 py-0.5 outline-none"
                      />
                      <button
                        onClick={() => {
                          const name = editingName;
                          setEditingId(null);
                          onManualRename(e, name);
                        }}
                        disabled={busy}
                        className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white text-xs"
                      >
                        OK
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="px-2 py-0.5 rounded bg-slate-300 dark:bg-slate-700 hover:bg-slate-400 dark:hover:bg-slate-600 text-xs"
                      >
                        Abbr.
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="text-sm text-left truncate block w-full hover:underline cursor-pointer"
                      title={e.originalPath}
                      onClick={() =>
                        openPath(e.originalPath).catch((err) =>
                          console.error("openPath failed", err),
                        )
                      }
                    >
                      {e.originalName}
                    </button>
                  )}
                </div>

                {/* Issues */}
                <div
                  className="px-2 py-1.5 flex-shrink-0 overflow-hidden"
                  style={{ width: widths.issues }}
                >
                  <div className="flex flex-wrap gap-1">
                    {e.issues.map((issue, i) => (
                      <span
                        key={i}
                        className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${ISSUE_COLORS[issue.kind]}`}
                        title={issue.message}
                      >
                        {ISSUE_LABELS[issue.kind]}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Vorschlag */}
                <div
                  className="px-2 py-1.5 flex-shrink-0 overflow-hidden"
                  style={{ width: widths.vorschlag }}
                >
                  {e.suggestion && (
                    <div className="truncate text-xs" title={e.suggestion.proposedPath}>
                      <span
                        className={`inline-block mr-1.5 px-1 py-0.5 rounded text-[10px] font-medium ${
                          e.suggestion.action === "rename"
                            ? "bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-200"
                            : "bg-orange-100 dark:bg-orange-900/60 text-orange-800 dark:text-orange-200"
                        }`}
                      >
                        {e.suggestion.action === "rename" ? "Rename" : "Move"}
                      </span>
                      {e.suggestion.proposedName}
                    </div>
                  )}
                  {e.status === "done" && (
                    <span className="text-xs text-emerald-600 dark:text-emerald-400">Erledigt</span>
                  )}
                  {e.status === "error" && (
                    <span className="text-xs text-rose-600 dark:text-rose-400" title={e.error}>
                      Fehler
                    </span>
                  )}
                </div>

                {/* Actions */}
                <div
                  className="px-2 py-1.5 flex-shrink-0 flex gap-1 justify-end"
                  style={{ width: widths.actions }}
                >
                  {e.issues.some((i) => i.kind === "unparsable") && e.status !== "done" && (
                    <button
                      onClick={() => onAskLlm(e)}
                      disabled={busy}
                      className="px-2 py-1 rounded bg-violet-600 hover:bg-violet-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white text-xs"
                      title="LLM fragen"
                    >
                      LLM
                    </button>
                  )}
                  {e.suggestion && e.status !== "done" && (
                    <button
                      onClick={() => onApply(e)}
                      disabled={busy}
                      className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white text-xs"
                    >
                      {e.suggestion.action === "rename" ? "Rename" : "Move"}
                    </button>
                  )}
                  {e.status !== "done" && editingId !== e.id && (
                    <button
                      onClick={() => {
                        setEditingId(e.id);
                        setEditingName(e.suggestion?.proposedName ?? e.originalName);
                      }}
                      disabled={busy}
                      className="px-2 py-1 rounded bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 disabled:opacity-50 text-slate-700 dark:text-slate-200 text-xs"
                      title="Manuell umbenennen"
                    >
                      ✎
                    </button>
                  )}
                  {e.status !== "done" && (
                    confirmDeleteId === e.id ? (
                      <>
                        <button
                          onClick={() => {
                            setConfirmDeleteId(null);
                            onDelete(e);
                          }}
                          disabled={busy}
                          className="px-2 py-1 rounded bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white text-xs"
                          title="Wirklich in den Papierkorb"
                        >
                          Sicher?
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-2 py-1 rounded bg-slate-300 dark:bg-slate-700 hover:bg-slate-400 dark:hover:bg-slate-600 text-xs"
                        >
                          ✕
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteId(e.id)}
                        disabled={busy}
                        className="px-2 py-1 rounded bg-rose-100 hover:bg-rose-200 dark:bg-rose-900/40 dark:hover:bg-rose-900/70 disabled:opacity-50 text-rose-700 dark:text-rose-300 text-xs"
                        title="In den Papierkorb verschieben"
                      >
                        🗑
                      </button>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function EditableLabel({
  value,
  placeholder,
  className,
  onCommit,
}: {
  value: string;
  placeholder: string;
  className?: string;
  onCommit: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  if (!editing) {
    return (
      <button
        type="button"
        className={`${className ?? ""} hover:bg-slate-200 dark:hover:bg-slate-700 rounded px-1.5 py-0.5 -mx-1.5 cursor-text truncate`}
        title="Klicken zum Bearbeiten"
        onClick={() => setEditing(true)}
      >
        {value || <span className="text-slate-400 italic">{placeholder}</span>}
      </button>
    );
  }

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onCommit(trimmed);
    else setDraft(value);
  };

  return (
    <input
      ref={inputRef}
      className={`${className ?? ""} bg-white dark:bg-slate-950 border border-blue-400 dark:border-blue-600 rounded px-1.5 py-0.5 outline-none min-w-[8rem]`}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") { setDraft(value); setEditing(false); }
      }}
    />
  );
}
