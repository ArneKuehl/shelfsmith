import { useMemo, useState } from "react";
import type { LibraryCluster, LibraryEntry } from "../../types";

type Props = {
  clusters: LibraryCluster[];
  entries: LibraryEntry[];
  onSelectCluster: (id: string) => void;
};

type SortKey = "author" | "series" | "have" | "max" | "missing";

function formatRanges(nums: number[]): string {
  if (nums.length === 0) return "";
  const sorted = [...nums].sort((a, b) => a - b);
  const out: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i];
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    out.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = n;
    prev = n;
  }
  out.push(start === prev ? `${start}` : `${start}–${prev}`);
  return out.join(", ");
}

export function LibraryMissingTable({ clusters, entries, onSelectCluster }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("author");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filter, setFilter] = useState("");

  const rows = useMemo(() => {
    const entriesByCluster = new Map<string, LibraryEntry[]>();
    for (const e of entries) {
      const list = entriesByCluster.get(e.clusterId) ?? [];
      list.push(e);
      entriesByCluster.set(e.clusterId, list);
    }
    const lf = filter.trim().toLowerCase();
    return clusters
      .filter((c) => c.missingVolumes.length > 0)
      .filter(
        (c) =>
          !lf ||
          c.canonicalAuthor.toLowerCase().includes(lf) ||
          c.canonicalSeries.toLowerCase().includes(lf),
      )
      .map((c) => {
        const cEntries = entriesByCluster.get(c.id) ?? [];
        const presentVolumes = new Set<number>();
        for (const e of cEntries) {
          if (e.volume === null) continue;
          const start = Math.ceil(e.volume);
          const end = e.volumeEnd !== null ? Math.floor(e.volumeEnd) : start;
          for (let v = start; v <= end; v++) presentVolumes.add(v);
        }
        const have = presentVolumes.size;
        const maxVol = presentVolumes.size > 0 ? Math.max(...presentVolumes) : 0;
        return {
          cluster: c,
          have,
          max: maxVol,
          missing: c.missingVolumes,
        };
      });
  }, [clusters, entries, filter]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      switch (sortKey) {
        case "author": {
          const cmp = a.cluster.canonicalAuthor.localeCompare(b.cluster.canonicalAuthor);
          return cmp !== 0 ? cmp * dir : a.cluster.canonicalSeries.localeCompare(b.cluster.canonicalSeries) * dir;
        }
        case "series":
          return a.cluster.canonicalSeries.localeCompare(b.cluster.canonicalSeries) * dir;
        case "have":
          return (a.have - b.have) * dir;
        case "max":
          return (a.max - b.max) * dir;
        case "missing":
          return (a.missing.length - b.missing.length) * dir;
      }
    });
  }, [rows, sortKey, sortDir]);

  const onHeader = (k: SortKey) => {
    if (k === sortKey) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(k);
      setSortDir("asc");
    }
  };

  const arrow = (k: SortKey) => (sortKey === k ? (sortDir === "asc" ? " ▲" : " ▼") : "");

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center gap-3">
        <input
          type="text"
          placeholder="Filter author / series…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded px-2 py-1.5 w-64"
        />
        <span className="text-xs text-slate-500">
          {sorted.length} series with gaps
        </span>
      </div>
      <div className="flex-1 overflow-auto">
        {sorted.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No series with missing volumes.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-xs uppercase tracking-wider text-slate-600 dark:text-slate-400">
              <tr>
                <th className="text-left px-3 py-2 cursor-pointer select-none" onClick={() => onHeader("author")}>
                  Author{arrow("author")}
                </th>
                <th className="text-left px-3 py-2 cursor-pointer select-none" onClick={() => onHeader("series")}>
                  Series{arrow("series")}
                </th>
                <th className="text-right px-3 py-2 cursor-pointer select-none" onClick={() => onHeader("have")}>
                  Have{arrow("have")}
                </th>
                <th className="text-right px-3 py-2 cursor-pointer select-none" onClick={() => onHeader("max")}>
                  Max. Vol.{arrow("max")}
                </th>
                <th className="text-right px-3 py-2 cursor-pointer select-none" onClick={() => onHeader("missing")}>
                  Missing{arrow("missing")}
                </th>
                <th className="text-left px-3 py-2">Missing volumes</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr
                  key={r.cluster.id}
                  onClick={() => onSelectCluster(r.cluster.id)}
                  className="border-b border-slate-100 dark:border-slate-800/60 hover:bg-blue-50 dark:hover:bg-blue-950/40 cursor-pointer"
                >
                  <td className="px-3 py-1.5 text-slate-800 dark:text-slate-200">
                    {r.cluster.canonicalAuthor}
                  </td>
                  <td className="px-3 py-1.5 text-slate-800 dark:text-slate-200">
                    {r.cluster.canonicalSeries || "(No series)"}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-700 dark:text-slate-300">
                    {r.have}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-700 dark:text-slate-300">
                    {r.max}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    <span className="inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200 text-xs font-semibold">
                      {r.missing.length}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-slate-600 dark:text-slate-400 font-mono text-xs">
                    {formatRanges(r.missing)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
