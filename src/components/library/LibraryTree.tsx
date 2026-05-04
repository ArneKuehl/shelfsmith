import type { LibraryCluster } from "../../types";

type Props = {
  clusters: LibraryCluster[];
  selectedClusterId: string | null;
  onSelect: (id: string) => void;
  filter: string;
};

export function LibraryTree({ clusters, selectedClusterId, onSelect, filter }: Props) {
  const lf = filter.toLowerCase();
  const filtered = lf
    ? clusters.filter(
        (c) =>
          c.canonicalAuthor.toLowerCase().includes(lf) ||
          c.canonicalSeries.toLowerCase().includes(lf),
      )
    : clusters;

  const sorted = [...filtered].sort((a, b) => {
    const cmp = a.canonicalAuthor.localeCompare(b.canonicalAuthor);
    if (cmp !== 0) return cmp;
    return a.canonicalSeries.localeCompare(b.canonicalSeries);
  });

  // Group by author
  const byAuthor = new Map<string, LibraryCluster[]>();
  for (const c of sorted) {
    const key = c.authorKey;
    const list = byAuthor.get(key) ?? [];
    list.push(c);
    byAuthor.set(key, list);
  }

  return (
    <div className="flex flex-col overflow-y-auto text-sm">
      {sorted.length === 0 && (
        <div className="px-3 py-4 text-slate-500 text-center text-xs">
          {lf ? "No results" : "No scan performed yet"}
        </div>
      )}
      {[...byAuthor.entries()].map(([aKey, authorClusters]) => (
        <div key={aKey}>
          <div className="px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-900 sticky top-0">
            {authorClusters[0].canonicalAuthor}
          </div>
          {authorClusters.map((c) => (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
              className={`w-full text-left px-4 py-1.5 flex items-center justify-between hover:bg-slate-100 dark:hover:bg-slate-800 ${
                selectedClusterId === c.id
                  ? "bg-blue-50 dark:bg-blue-950/40 border-l-2 border-blue-500"
                  : "border-l-2 border-transparent"
              }`}
            >
              <span className="truncate">
                {c.canonicalSeries || "(No series)"}
                <span className="ml-1.5 text-xs text-slate-400">({c.entryIds.length})</span>
              </span>
              {c.issueCount > 0 && (
                <span className="ml-2 flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200 text-[10px] font-bold">
                  {c.issueCount}
                </span>
              )}
              {c.missingVolumes.length > 0 && (
                <span
                  className="ml-1 flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 text-[10px] font-bold"
                  title={`Missing: ${c.missingVolumes.join(", ")}`}
                >
                  ?
                </span>
              )}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
