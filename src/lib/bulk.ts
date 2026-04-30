import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { BulkEntry, EpubMeta, PdfMeta } from "../types";
import { basename, extension, formatAuthor } from "./naming";
import { decomposeFilename } from "./lmstudio";

export type EnrichOpts = {
  llm: { url: string; model: string } | null;
};

function makeId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export async function scanFolder(path: string, recursive: boolean): Promise<BulkEntry[]> {
  const paths = await invoke<string[]>("scan_directory", { path, recursive });
  return paths.map((p) => emptyEntry(p));
}

function emptyEntry(p: string): BulkEntry {
  const name = basename(p);
  return {
    id: makeId(),
    originalPath: p,
    originalName: name,
    extension: extension(name),
    selected: false,
    author: "",
    series: "",
    volume: null,
    volumeEnd: null,
    title: null,
    proposedName: name,
    source: "none",
    confidence: "low",
    status: "idle",
  };
}

function isComplete(e: BulkEntry): boolean {
  return !!e.author && !!e.title && !!e.series;
}

/**
 * Enriches a single entry. Pipeline:
 *   1. embedded metadata (EPUB OPF / PDF info)
 *   2. (optional) LLM decomposition of the filename — if step 1 gave nothing
 *      useful and a local LLM is configured & reachable
 *   3. web lookup (Google Books) — using the cleanest query available so far
 */
export async function enrichEntry(
  entry: BulkEntry,
  signal?: AbortSignal,
  opts: EnrichOpts = { llm: null },
): Promise<BulkEntry> {
  let next: BulkEntry = { ...entry };
  let embeddedFound = false;
  let llmFound = false;
  let isbn: string | null = null;

  // Step 1: embedded metadata
  const ext = entry.extension.toLowerCase();
  if (ext === ".epub") {
    try {
      const m = await invoke<EpubMeta>("read_epub_metadata", { path: entry.originalPath });
      const got = applyEpub(next, m);
      next = got.entry;
      embeddedFound = got.found;
      isbn = m.isbn ?? null;
    } catch {
      /* ignore — fall through */
    }
  } else if (ext === ".pdf") {
    try {
      const m = await invoke<PdfMeta>("read_pdf_metadata", { path: entry.originalPath });
      if (m.title) next.title = m.title;
      if (m.author) next.author = formatAuthor(m.author);
      if (m.title || m.author) {
        next.source = "embedded";
        next.confidence = "medium";
        embeddedFound = true;
      }
    } catch {
      /* ignore */
    }
  }

  if (signal?.aborted) return next;

  // Step 2: LLM filename decomposition — only if step 1 didn't give us anything
  // useful and a local LLM is available.
  if (opts.llm && !embeddedFound) {
    try {
      const decomp = await decomposeFilename(
        opts.llm.url,
        opts.llm.model,
        entry.originalName,
        signal,
      );
      if (decomp.author || decomp.title || decomp.series || decomp.volume !== null) {
        if (!next.author && decomp.author) next.author = formatAuthor(decomp.author);
        if (!next.title && decomp.title) next.title = decomp.title;
        if (!next.series && decomp.series) next.series = decomp.series;
        if (next.volume === null && decomp.volume !== null) next.volume = decomp.volume;
        next.source = "llm";
        next.confidence = "medium";
        llmFound = true;
      }
    } catch {
      /* LLM unavailable or failed — keep going to web step */
    }
  }

  if (signal?.aborted) return next;

  // Step 3: web lookup if anything is still missing.
  const needsLookup = !isComplete(next);
  if (needsLookup) {
    try {
      const query = isbn ? `isbn:${isbn}` : buildQueryFromEntry(next);
      const hit = await lookupGoogleBooks(query, signal);
      if (hit) {
        if (!next.title && hit.title) next.title = hit.title;
        if (!next.author && hit.author) next.author = formatAuthor(hit.author);
        if (!next.series && hit.series) next.series = hit.series;
        if (next.volume === null && hit.volume !== null) next.volume = hit.volume;
        if (!embeddedFound && !llmFound) {
          next.source = "web";
          next.confidence = "medium";
        }
      } else if (!embeddedFound && !llmFound) {
        next.source = "none";
        next.confidence = "low";
      }
    } catch {
      /* network failure — leave as-is */
    }
  } else if (embeddedFound) {
    next.confidence = "high";
  }

  next.status = "ok";
  return next;
}

function applyEpub(entry: BulkEntry, m: EpubMeta): { entry: BulkEntry; found: boolean } {
  const next = { ...entry };
  let found = false;
  if (m.title) {
    next.title = m.title;
    found = true;
  }
  if (m.author) {
    next.author = m.author_file_as
      ? normalizeFileAs(m.author_file_as)
      : formatAuthor(m.author);
    found = true;
  }
  if (m.series) {
    next.series = m.series;
    found = true;
  }
  if (m.series_index !== null && m.series_index !== undefined) {
    const v = Math.round(m.series_index);
    if (Number.isFinite(v) && v > 0) next.volume = v;
  }
  if (found) {
    next.source = "embedded";
    next.confidence = "high";
  }
  return { entry: next, found };
}

/** "Pratchett, Terry" → keep. "Pratchett Terry" → "Pratchett, Terry". */
function normalizeFileAs(fileAs: string): string {
  if (fileAs.includes(",")) return fileAs.trim();
  return formatAuthor(fileAs);
}

function buildQueryFromEntry(e: BulkEntry): string {
  // If we already have title/author (e.g. from LLM decomposition), use those —
  // they make for a much cleaner web query than the raw filename.
  const parts: string[] = [];
  if (e.title) parts.push(e.title);
  if (e.author) parts.push(e.author);
  if (parts.length > 0) return parts.join(" ");
  const stem = e.originalName.replace(/\.[^.]+$/, "");
  return stem.replace(/[_\-\.]+/g, " ").replace(/\s+/g, " ").trim();
}

type GoogleHit = {
  title: string | null;
  author: string | null;
  series: string | null;
  volume: number | null;
};

export async function lookupGoogleBooks(
  query: string,
  signal?: AbortSignal,
): Promise<GoogleHit | null> {
  const url = `https://www.googleapis.com/books/v1/volumes?maxResults=1&q=${encodeURIComponent(query)}`;
  const res = await tauriFetch(url, { method: "GET", signal });
  if (!res.ok) return null;
  const data: any = await res.json();
  const item = data?.items?.[0]?.volumeInfo;
  if (!item) return null;
  const title: string | null = typeof item.title === "string" ? item.title : null;
  const subtitle: string | null = typeof item.subtitle === "string" ? item.subtitle : null;
  const authors: string[] = Array.isArray(item.authors) ? item.authors : [];
  const author = authors[0] ?? null;
  const { series, volume, cleanTitle } = parseSeries(title, subtitle);
  return {
    title: cleanTitle ?? title,
    author,
    series,
    volume,
  };
}

/**
 * Heuristic series parser.
 * Examples:
 *   title="Mort", subtitle="Discworld Book 4" → series="Discworld", volume=4
 *   title="Mort (Discworld Book 4)" → series="Discworld", volume=4, cleanTitle="Mort"
 *   title="Discworld 4: Mort" → series="Discworld", volume=4, cleanTitle="Mort"
 */
function parseSeries(
  title: string | null,
  subtitle: string | null,
): { series: string | null; volume: number | null; cleanTitle: string | null } {
  if (subtitle) {
    const m = subtitle.match(/^(.+?)\s+(?:Book|Vol(?:ume)?|Band|#)\s*(\d+)/i);
    if (m) return { series: m[1].trim(), volume: parseInt(m[2], 10), cleanTitle: title };
  }
  if (title) {
    const m1 = title.match(/^(.+?)\s*\((.+?)\s+(?:Book|Vol(?:ume)?|Band|#)\s*(\d+)\)\s*$/i);
    if (m1)
      return {
        series: m1[2].trim(),
        volume: parseInt(m1[3], 10),
        cleanTitle: m1[1].trim(),
      };
    const m2 = title.match(/^(.+?)\s+(\d+):\s*(.+)$/);
    if (m2)
      return {
        series: m2[1].trim(),
        volume: parseInt(m2[2], 10),
        cleanTitle: m2[3].trim(),
      };
  }
  return { series: null, volume: null, cleanTitle: title };
}
