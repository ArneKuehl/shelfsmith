import { useStore } from "../../lib/store";
import type { LibraryCluster, LibraryEntry, LibraryIssueKind } from "../../types";

type Props = {
  cluster: LibraryCluster | null;
  entries: LibraryEntry[];
  onApply: (entry: LibraryEntry) => void;
  onApplyAll: () => void;
  onAskLlm: (entry: LibraryEntry) => void;
  busy: boolean;
};

const ISSUE_COLORS: Record<LibraryIssueKind, string> = {
  "author-variant": "bg-violet-100 dark:bg-violet-900/60 text-violet-800 dark:text-violet-200",
  "series-variant": "bg-sky-100 dark:bg-sky-900/60 text-sky-800 dark:text-sky-200",
  "duplicate-volume": "bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200",
  "format-duplicate": "bg-orange-100 dark:bg-orange-900/60 text-orange-800 dark:text-orange-200",
  "volume-gap": "bg-rose-100 dark:bg-rose-900/60 text-rose-800 dark:text-rose-200",
  "range-or-omnibus": "bg-teal-100 dark:bg-teal-900/60 text-teal-800 dark:text-teal-200",
  "unpadded-volume": "bg-lime-100 dark:bg-lime-900/60 text-lime-800 dark:text-lime-200",
  unparsable: "bg-red-100 dark:bg-red-900/60 text-red-800 dark:text-red-200",
  orphan: "bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300",
  "title-case": "bg-indigo-100 dark:bg-indigo-900/60 text-indigo-800 dark:text-indigo-200",
};

const ISSUE_LABELS: Record<LibraryIssueKind, string> = {
  "author-variant": "Autor",
  "series-variant": "Serie",
  "duplicate-volume": "Duplikat",
  "format-duplicate": "Format",
  "volume-gap": "Lücke",
  "range-or-omnibus": "Range",
  "unpadded-volume": "Padding",
  unparsable: "?",
  orphan: "Orphan",
  "title-case": "Casing",
};

export function LibraryTable({ cluster, entries, onApply, onApplyAll, onAskLlm, busy }: Props) {
  const toggleSelected = useStore((s) => s.toggleLibrarySelected);

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

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Cluster header */}
      <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <span className="font-semibold text-sm">{cluster.canonicalAuthor}</span>
          <span className="mx-2 text-slate-400">—</span>
          <span className="text-sm">{cluster.canonicalSeries || "(Ohne Serie)"}</span>
          <span className="ml-2 text-xs text-slate-400">
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
      </div>

      {/* Entries table */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800">
            <tr>
              <th className="w-8 px-2 py-1.5" />
              <th className="text-left px-2 py-1.5 font-medium text-slate-600 dark:text-slate-400">
                Datei
              </th>
              <th className="text-left px-2 py-1.5 font-medium text-slate-600 dark:text-slate-400">
                Issues
              </th>
              <th className="text-left px-2 py-1.5 font-medium text-slate-600 dark:text-slate-400">
                Vorschlag
              </th>
              <th className="w-20 px-2 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {clusterEntries.map((e) => (
              <tr
                key={e.id}
                className={`border-b border-slate-100 dark:border-slate-800/50 ${
                  e.status === "done"
                    ? "opacity-50"
                    : e.status === "error"
                      ? "bg-rose-50 dark:bg-rose-950/30"
                      : ""
                }`}
              >
                <td className="px-2 py-1.5 text-center">
                  {e.suggestion && e.status !== "done" && (
                    <input
                      type="checkbox"
                      checked={e.selected}
                      onChange={() => toggleSelected(e.id)}
                    />
                  )}
                </td>
                <td className="px-2 py-1.5">
                  <div className="truncate max-w-sm" title={e.originalPath}>
                    {e.originalName}
                  </div>
                </td>
                <td className="px-2 py-1.5">
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
                </td>
                <td className="px-2 py-1.5">
                  {e.suggestion && (
                    <div className="truncate max-w-sm text-xs" title={e.suggestion.proposedPath}>
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
                </td>
                <td className="px-2 py-1.5 text-right flex gap-1 justify-end">
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
