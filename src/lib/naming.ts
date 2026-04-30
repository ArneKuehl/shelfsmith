import type { FileEntry, SeriesMeta } from "../types";

const FORBIDDEN = /[<>:"/\\|?*\x00-\x1F]/g;

export function sanitize(s: string): string {
  return s.replace(FORBIDDEN, "").replace(/\s+/g, " ").trim();
}

/**
 * Normalisiert Autor auf "Nachname, Vorname".
 * - Enthält bereits Komma → unverändert (sanitize-trim später).
 * - Genau zwei Tokens (Wörter) → "<2>, <1>" (heuristisch: Eingabe = "Nachname Vorname"
 *   im Altformat, oder "Vorname Nachname" — wir gehen im Altformat von "Nachname Vorname"
 *   aus und drehen NICHT, fügen nur das Komma ein).
 * - Anderes (mehrere Wörter, z.B. "Carlos Ruiz Zafón") → unverändert (User editiert manuell).
 */
export function formatAuthor(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.includes(",")) return trimmed;
  const parts = trimmed.split(/\s+/);
  if (parts.length === 2) return `${parts[0]}, ${parts[1]}`;
  return trimmed;
}

export function padVolume(volume: number, max: number): string {
  const width = Math.max(2, String(Math.max(max, 1)).length);
  return String(volume).padStart(width, "0");
}

export function maxVolume(entries: FileEntry[]): number {
  return entries.reduce((m, e) => {
    const candidate = Math.max(e.volume ?? 0, e.volumeEnd ?? 0);
    return candidate > m ? candidate : m;
  }, 0);
}

export function buildProposedName(
  meta: SeriesMeta,
  entry: FileEntry,
  maxVol: number,
  includeTitle: boolean,
): string {
  const author = sanitize(formatAuthor(meta.author));
  const series = sanitize(meta.series);
  let name = `${author} - ${series}`;
  if (entry.volume !== null) {
    const start = padVolume(entry.volume, maxVol);
    const end =
      entry.volumeEnd !== null && entry.volumeEnd > entry.volume
        ? `-${padVolume(entry.volumeEnd, maxVol)}`
        : "";
    name += ` (${start}${end})`;
  }
  if (includeTitle && entry.title) name += ` - ${sanitize(entry.title)}`;
  return name + entry.extension;
}

export function basename(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i >= 0 ? path.slice(i + 1) : path;
}

export function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i >= 0 ? path.slice(0, i) : "";
}

export function extension(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i) : "";
}

export function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.endsWith(sep) ? dir + name : dir + sep + name;
}
