export { jaroWinkler, authorKey, seriesKey } from "../cluster";
export { sanitize, padVolume, swapAuthorName } from "../naming";
import { KNOWN_EXTENSIONS } from "./rules";

export function stripExtension(filename: string): { stem: string; ext: string } {
  const lower = filename.toLowerCase();
  for (const ext of KNOWN_EXTENSIONS) {
    if (lower.endsWith(ext)) {
      return { stem: filename.slice(0, -ext.length), ext };
    }
  }
  const dot = filename.lastIndexOf(".");
  if (dot > 0) {
    return { stem: filename.slice(0, dot), ext: filename.slice(dot).toLowerCase() };
  }
  return { stem: filename, ext: "" };
}
