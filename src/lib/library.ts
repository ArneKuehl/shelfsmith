import { invoke } from "@tauri-apps/api/core";
import type {
  LibraryCluster,
  LibraryEntry,
  LibrarySettings,
  LibrarySuggestion,
} from "../types";
import { basename, dirname, extension, joinPath, sanitize, formatAuthor, padVolume } from "./naming";
import { authorKey, seriesKey, buildClusters, toTitleCase } from "./cluster";

// ---------------------------------------------------------------------------
// Filename parsing regex
// ---------------------------------------------------------------------------

// Matches: "Author - Series (01) - Title.epub"
//      or: "Author - Series (01-05) - Title.epub"
//      or: "Author - Series (01).epub"
//      or: "Author - Series.epub"
const FILENAME_RE =
  /^(.+?)\s*-\s*(.+?)\s*(?:\((\d+(?:\.\d+)?)\s*(?:-\s*(\d+(?:\.\d+)?))?\)\s*)?(?:-\s*(.+?))?\s*$/;

const ALTERNATIVE_TAG = /\s*\(alternativ(?:e)?(?:\s+\d+)?(?:\s+datei)?\)\s*/gi;

type Parsed = {
  author: string;
  series: string;
  volume: number | null;
  volumeEnd: number | null;
  title: string | null;
};

export function parseLibraryFilename(name: string): Parsed | null {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const cleaned = stem.replace(ALTERNATIVE_TAG, "").trim();
  const m = FILENAME_RE.exec(cleaned);
  if (!m) return null;
  const author = m[1].trim();
  const series = m[2].trim();
  const volume = m[3] ? Number.parseFloat(m[3]) : null;
  const volumeEnd = m[4] ? Number.parseFloat(m[4]) : null;
  const title = m[5]?.trim() || null;
  if (!author || !series) return null;
  return { author, series, volume, volumeEnd, title };
}

// ---------------------------------------------------------------------------
// Entry creation
// ---------------------------------------------------------------------------

let _counter = 0;
function makeId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36) + (++_counter).toString(36);
}

function createEntry(path: string): LibraryEntry {
  const name = basename(path);
  const ext = extension(name);
  const parsed = parseLibraryFilename(name);
  const author = parsed?.author ?? "";
  const series = parsed?.series ?? "";

  return {
    id: makeId(),
    originalPath: path,
    originalName: name,
    dir: dirname(path),
    extension: ext,
    author,
    series,
    volume: parsed?.volume ?? null,
    volumeEnd: parsed?.volumeEnd ?? null,
    title: parsed?.title ?? null,
    authorKey: authorKey(author),
    seriesKey: seriesKey(series),
    clusterId: "",
    issues: [],
    suggestion: null,
    selected: false,
    status: "idle",
  };
}

// ---------------------------------------------------------------------------
// Full pipeline
// ---------------------------------------------------------------------------

export async function analyzeLibrary(
  folder: string,
  recursive: boolean,
  libSettings: LibrarySettings,
): Promise<{ entries: LibraryEntry[]; clusters: LibraryCluster[] }> {
  const paths = await invoke<string[]>("scan_directory", { path: folder, recursive });
  const entries = paths.map(createEntry);
  return reanalyze(entries, libSettings);
}

export function reanalyze(
  entries: LibraryEntry[],
  libSettings: LibrarySettings,
): { entries: LibraryEntry[]; clusters: LibraryCluster[] } {
  // 1. Build clusters
  const parsed = entries.map((e) => ({
    id: e.id,
    authorKey: e.authorKey,
    seriesKey: e.seriesKey,
    author: e.author,
    series: e.series,
  }));
  const { clusters, entryClusterMap } = buildClusters(parsed, libSettings.fuzzThreshold);

  // 2. Assign cluster IDs
  const entryMap = new Map<string, LibraryEntry>();
  for (const e of entries) {
    entryMap.set(e.id, { ...e, clusterId: entryClusterMap.get(e.id) ?? "", issues: [], suggestion: null });
  }

  // 3. Detect issues per cluster (skip "done" entries for detection)
  for (const cluster of clusters) {
    const clusterEntries = cluster.entryIds.map((id) => entryMap.get(id)!).filter(Boolean);
    const activeEntries = clusterEntries.filter((e) => e.status !== "done");
    detectIssues(cluster, activeEntries, libSettings);
    buildSuggestions(cluster, activeEntries, libSettings);

    // update entry-level data back
    for (const e of clusterEntries) entryMap.set(e.id, e);
    cluster.issueCount = clusterEntries.reduce(
      (n, e) => n + e.issues.filter((i) => i.kind !== "volume-gap" && i.kind !== "range-or-omnibus").length,
      0,
    );
  }

  return { entries: [...entryMap.values()], clusters };
}

// ---------------------------------------------------------------------------
// Issue detection
// ---------------------------------------------------------------------------

function detectIssues(
  cluster: LibraryCluster,
  entries: LibraryEntry[],
  libSettings: LibrarySettings,
): void {
  const { canonicalAuthor, canonicalSeries } = cluster;

  for (const e of entries) {
    // unparsable
    if (!e.author && !e.series) {
      e.issues.push({ kind: "unparsable", message: "Dateiname konnte nicht geparst werden" });
      continue;
    }

    // orphan
    if (!e.series) {
      e.issues.push({ kind: "orphan", message: "Keine Serie erkannt" });
    }

    // author-variant
    if (e.author && e.author !== canonicalAuthor) {
      e.issues.push({
        kind: "author-variant",
        message: `Autor „${e.author}" weicht von „${canonicalAuthor}" ab`,
      });
    }

    // series-variant
    if (e.series && e.series !== canonicalSeries) {
      e.issues.push({
        kind: "series-variant",
        message: `Serie „${e.series}" weicht von „${canonicalSeries}" ab`,
      });
    }

    // title-case
    if (libSettings.titleCase) {
      const tcAuthor = toTitleCase(canonicalAuthor);
      const tcSeries = toTitleCase(canonicalSeries);
      if (e.author === canonicalAuthor && canonicalAuthor !== tcAuthor) {
        e.issues.push({
          kind: "title-case",
          message: `Autor „${canonicalAuthor}" → „${tcAuthor}"`,
        });
      }
      if (e.series === canonicalSeries && canonicalSeries !== tcSeries) {
        e.issues.push({
          kind: "title-case",
          message: `Serie „${canonicalSeries}" → „${tcSeries}"`,
        });
      }
    }

    // range-or-omnibus
    if (e.volumeEnd !== null && e.volumeEnd > (e.volume ?? 0)) {
      e.issues.push({
        kind: "range-or-omnibus",
        message: `Band-Range (${e.volume}–${e.volumeEnd}) — Omnibus/Sammelband?`,
      });
    }

    // non-epub — not the preferred format
    if (e.extension.toLowerCase() !== ".epub") {
      e.issues.push({
        kind: "format-preference",
        message: `Format ${e.extension} — EPUB ist bevorzugt`,
      });
    }

    // duplicate-volume — (alternative) tag in original name
    if (ALTERNATIVE_TAG.test(e.originalName)) {
      ALTERNATIVE_TAG.lastIndex = 0;
      e.issues.push({ kind: "duplicate-volume", message: "Alternative-Datei" });
    }
  }

  // Build a set of all volumes covered by omnibus/range entries
  const omnibusCoverage = new Set<number>();
  const omnibusEntries: LibraryEntry[] = [];
  for (const e of entries) {
    if (e.volume !== null && e.volumeEnd !== null && e.volumeEnd > e.volume) {
      omnibusEntries.push(e);
      for (let v = Math.ceil(e.volume); v <= Math.floor(e.volumeEnd); v++) {
        omnibusCoverage.add(v);
      }
    }
  }

  // duplicate-volume — same volume across different entries
  const volumeMap = new Map<string, LibraryEntry[]>();
  for (const e of entries) {
    if (e.volume === null) continue;
    const vk = `${e.volume}`;
    const list = volumeMap.get(vk) ?? [];
    list.push(e);
    volumeMap.set(vk, list);
  }
  for (const [, group] of volumeMap) {
    if (group.length <= 1) continue;
    for (const e of group) {
      const isDup = e.issues.some((i) => i.kind === "duplicate-volume");
      if (!isDup) {
        const others = group.filter((o) => o.id !== e.id);
        const otherNames = others.map((o) => o.originalName).join(", ");
        e.issues.push({
          kind: "duplicate-volume",
          message: `Band ${e.volume} existiert auch als: ${otherNames}`,
        });
      }
    }
  }

  // Einzelbände, die komplett durch einen Omnibus abgedeckt sind → Duplikat
  for (const e of entries) {
    if (e.volume === null || e.volumeEnd !== null) continue;
    if (!omnibusCoverage.has(e.volume)) continue;
    const isDup = e.issues.some((i) => i.kind === "duplicate-volume");
    if (isDup) continue;
    const covering = omnibusEntries
      .filter((o) => e.volume! >= o.volume! && e.volume! <= o.volumeEnd!)
      .map((o) => o.originalName)
      .join(", ");
    e.issues.push({
      kind: "duplicate-volume",
      message: `Band ${e.volume} ist in Omnibus enthalten: ${covering}`,
    });
  }

  // format-duplicate — same volume, different format; EPUB wins
  for (const [, group] of volumeMap) {
    if (group.length <= 1) continue;
    const hasEpub = group.some((e) => e.extension.toLowerCase() === ".epub");
    if (hasEpub) {
      for (const e of group) {
        if (e.extension.toLowerCase() !== ".epub") {
          const existing = e.issues.some((i) => i.kind === "format-duplicate");
          if (!existing) {
            e.issues.push({
              kind: "format-duplicate",
              message: `Nicht-EPUB-Version — EPUB-Variante vorhanden`,
            });
          }
        }
      }
    }
  }

  // volume-gap — omnibus ranges count as covered
  const coveredVolumes = new Set<number>(omnibusCoverage);
  for (const e of entries) {
    if (e.volume !== null && e.volumeEnd === null && Number.isInteger(e.volume) && e.volume > 0) {
      coveredVolumes.add(e.volume);
    }
  }
  const allVolumes = [...coveredVolumes];
  if (allVolumes.length >= 1) {
    const maxVol = Math.max(...allVolumes);
    const missing: number[] = [];
    for (let i = 1; i <= maxVol; i++) {
      if (!coveredVolumes.has(i)) missing.push(i);
    }
    cluster.missingVolumes = missing;
    if (missing.length > 0) {
      for (const e of entries) {
        if (e.volume !== null) {
          e.issues.push({
            kind: "volume-gap",
            message: `Fehlende Bände: ${missing.join(", ")}`,
          });
          break;
        }
      }
    }
  }

  // unpadded-volume — inconsistent padding
  if (allVolumes.length >= 2) {
    const maxVol = Math.max(...allVolumes);
    const expectedWidth = Math.max(2, String(Math.floor(maxVol)).length);
    for (const e of entries) {
      if (e.volume === null) continue;
      const volInName = e.originalName.match(/\((\d+(?:\.\d+)?)/);
      if (volInName) {
        const intPart = volInName[1].split(".")[0];
        if (intPart.length < expectedWidth) {
          e.issues.push({
            kind: "unpadded-volume",
            message: `Band-Padding inkonsistent (${intPart} → ${intPart.padStart(expectedWidth, "0")})`,
          });
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Build suggestions
// ---------------------------------------------------------------------------

function buildSuggestions(
  cluster: LibraryCluster,
  entries: LibraryEntry[],
  libSettings: LibrarySettings,
): void {
  let canonAuthor = cluster.canonicalAuthor;
  let canonSeries = cluster.canonicalSeries;

  if (libSettings.titleCase) {
    canonAuthor = toTitleCase(canonAuthor);
    canonSeries = toTitleCase(canonSeries);
  }

  const volumes = entries
    .filter((e) => e.volume !== null)
    .map((e) => Math.max(e.volume ?? 0, e.volumeEnd ?? 0));
  const maxVol = volumes.length > 0 ? Math.max(...volumes) : 0;

  // Build a volume→entries map so we can check whether a duplicate-volume
  // entry is purely a format duplicate (EPUB preferred over other formats).
  const volGroupMap = new Map<string, LibraryEntry[]>();
  for (const e of entries) {
    if (e.volume === null) continue;
    const vk = `${e.volume}`;
    const list = volGroupMap.get(vk) ?? [];
    list.push(e);
    volGroupMap.set(vk, list);
  }

  for (const e of entries) {
    const isFormatDup = e.issues.some((i) => i.kind === "format-duplicate");
    const isDupVol = e.issues.some((i) => i.kind === "duplicate-volume");

    // EPUB files that are only flagged as duplicate because a non-EPUB copy
    // exists should NOT get a move suggestion — EPUB is the preferred format.
    const isEpub = e.extension.toLowerCase() === ".epub";
    if (isEpub && isDupVol && !isFormatDup) {
      const vk = e.volume !== null ? `${e.volume}` : null;
      const group = vk ? volGroupMap.get(vk) ?? [] : [];
      const onlyFormatDups = group.length > 1 && group
        .filter((o) => o.id !== e.id)
        .every((o) => o.extension.toLowerCase() !== ".epub");
      if (onlyFormatDups) continue;
    }

    const isDup = isFormatDup || isDupVol;

    // Build the canonical filename first — rename takes priority over move.
    let renameSuggestion: LibrarySuggestion | null = null;
    if (e.author && e.series) {
      const author = sanitize(formatAuthor(canonAuthor));
      const series = sanitize(canonSeries);
      let name = `${author} - ${series}`;
      if (e.volume !== null) {
        const start = padVolume(e.volume, maxVol);
        const end =
          e.volumeEnd !== null && e.volumeEnd > e.volume
            ? `-${padVolume(e.volumeEnd, maxVol)}`
            : "";
        name += ` (${start}${end})`;
      }
      if (e.title) name += ` - ${sanitize(e.title)}`;
      const proposedName = name + e.extension;
      if (proposedName !== e.originalName) {
        renameSuggestion = {
          action: "rename",
          proposedName,
          proposedPath: joinPath(e.dir, proposedName),
        };
      }
    }

    if (renameSuggestion) {
      e.suggestion = renameSuggestion;
    } else if (isDup) {
      const root = findScanRoot(entries);
      const dupDir = joinPath(root, "_duplicates");
      e.suggestion = {
        action: "move-duplicate",
        proposedName: e.originalName,
        proposedPath: joinPath(dupDir, e.originalName),
      };
    }
  }
}

function findScanRoot(entries: LibraryEntry[]): string {
  if (entries.length === 0) return "";
  const dirs = entries.map((e) => e.dir);
  let common = dirs[0];
  for (let i = 1; i < dirs.length; i++) {
    while (!dirs[i].startsWith(common)) {
      const sep = Math.max(common.lastIndexOf("/"), common.lastIndexOf("\\"));
      if (sep <= 0) return common;
      common = common.slice(0, sep);
    }
  }
  return common;
}
