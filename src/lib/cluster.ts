import type { LibraryCluster } from "../types";

// ---------------------------------------------------------------------------
// Normalization keys
// ---------------------------------------------------------------------------

const COMBINING_MARKS = /[̀-ͯ]/g;

function strip(s: string): string {
  return s
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function authorKey(raw: string): string {
  const s = strip(raw);
  if (!s) return "";
  const words = s.split(" ").sort();
  return words.join(" ");
}

const LEADING_ARTICLES =
  /^(the|a|an|der|die|das|den|dem|des|le|la|les|el|los|las|il|lo|gli|een)\s+/;
const TRAILING_SERIES_NOUNS =
  /\s+(series|saga|cycle|cycles|trilogy|tetralogy|chronicles|chronicle|novels|sequence|reihe|zyklus|chroniken)$/;

export function seriesKey(raw: string): string {
  let s = strip(raw);
  if (!s) return "";
  s = s.replace(LEADING_ARTICLES, "");
  s = s.replace(TRAILING_SERIES_NOUNS, "");
  return s.replace(/\s+/g, "").trim();
}

// ---------------------------------------------------------------------------
// Fuzzy matching — Jaro-Winkler similarity
// ---------------------------------------------------------------------------

function jaro(a: string, b: string): number {
  if (a === b) return 1;
  const aLen = a.length;
  const bLen = b.length;
  if (aLen === 0 || bLen === 0) return 0;
  const matchDist = Math.max(Math.floor(Math.max(aLen, bLen) / 2) - 1, 0);
  const aMatches = new Array(aLen).fill(false);
  const bMatches = new Array(bLen).fill(false);
  let matches = 0;
  let transpositions = 0;
  for (let i = 0; i < aLen; i++) {
    const start = Math.max(0, i - matchDist);
    const end = Math.min(i + matchDist + 1, bLen);
    for (let j = start; j < end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let k = 0;
  for (let i = 0; i < aLen; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  return (matches / aLen + matches / bLen + (matches - transpositions / 2) / matches) / 3;
}

export function jaroWinkler(a: string, b: string): number {
  const j = jaro(a, b);
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return j + prefix * 0.1 * (1 - j);
}

// ---------------------------------------------------------------------------
// Clustering
// ---------------------------------------------------------------------------

type RawParsed = {
  id: string;
  authorKey: string;
  seriesKey: string;
  author: string;
  series: string;
};

function mergeKeys(groups: Map<string, RawParsed[]>, threshold: number): Map<string, RawParsed[]> {
  const keys = [...groups.keys()];
  const merged = new Map<string, RawParsed[]>();
  const visited = new Set<string>();

  for (let i = 0; i < keys.length; i++) {
    if (visited.has(keys[i])) continue;
    const cluster = [...(groups.get(keys[i]) ?? [])];
    visited.add(keys[i]);
    for (let j = i + 1; j < keys.length; j++) {
      if (visited.has(keys[j])) continue;
      const collapsed_i = keys[i].replace(/\s/g, "");
      const collapsed_j = keys[j].replace(/\s/g, "");
      if (collapsed_i === collapsed_j || jaroWinkler(keys[i], keys[j]) >= threshold) {
        cluster.push(...(groups.get(keys[j]) ?? []));
        visited.add(keys[j]);
      }
    }
    merged.set(keys[i], cluster);
  }
  return merged;
}

function pickCanonical(variants: string[]): string {
  const counts = new Map<string, number>();
  for (const v of variants) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = variants[0];
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount || (c === bestCount && v.length > best.length)) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

export function toTitleCase(s: string): string {
  const minor = new Set([
    "a", "an", "the", "and", "but", "or", "nor", "for", "yet", "so",
    "in", "on", "at", "to", "by", "of", "up", "as", "if",
    "der", "die", "das", "und", "oder", "von", "zu", "aus", "mit",
    "the", "of", "and",
  ]);
  return s.replace(/\S+/g, (word, idx) => {
    if (idx === 0 || !minor.has(word.toLowerCase())) {
      return word.charAt(0).toUpperCase() + word.slice(1);
    }
    return word.toLowerCase();
  });
}

export function buildClusters(
  entries: RawParsed[],
  threshold: number,
): { clusters: LibraryCluster[]; entryClusterMap: Map<string, string> } {
  const byAuthorKey = new Map<string, RawParsed[]>();
  for (const e of entries) {
    const list = byAuthorKey.get(e.authorKey) ?? [];
    list.push(e);
    byAuthorKey.set(e.authorKey, list);
  }

  const mergedAuthors = mergeKeys(byAuthorKey, threshold);

  const clusters: LibraryCluster[] = [];
  const entryClusterMap = new Map<string, string>();

  for (const [aKey, authorEntries] of mergedAuthors) {
    const bySeriesKey = new Map<string, RawParsed[]>();
    for (const e of authorEntries) {
      const k = e.seriesKey || "__orphan__";
      const list = bySeriesKey.get(k) ?? [];
      list.push(e);
      bySeriesKey.set(k, list);
    }
    const mergedSeries = mergeKeys(bySeriesKey, threshold);

    for (const [sKey, seriesEntries] of mergedSeries) {
      const clusterId = `${aKey}::${sKey}`;
      const canonAuthor = pickCanonical(seriesEntries.map((e) => e.author));
      const canonSeries = pickCanonical(seriesEntries.map((e) => e.series));

      const cluster: LibraryCluster = {
        id: clusterId,
        canonicalAuthor: canonAuthor,
        canonicalSeries: canonSeries,
        authorKey: aKey,
        seriesKey: sKey,
        entryIds: seriesEntries.map((e) => e.id),
        issueCount: 0,
        formatIssueCount: 0,
        missingVolumes: [],
      };
      clusters.push(cluster);
      for (const e of seriesEntries) entryClusterMap.set(e.id, clusterId);
    }
  }

  return { clusters, entryClusterMap };
}
