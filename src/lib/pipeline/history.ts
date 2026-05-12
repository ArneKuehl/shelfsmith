import { jaroWinkler } from "../cluster";
import type { RenameRecord } from "./types";

export function findSimilar(
  dirty: string,
  pool: RenameRecord[],
  topK = 5,
): RenameRecord[] {
  if (pool.length === 0) return [];

  const scored = pool.map((record) => ({
    record,
    score: jaroWinkler(dirty.toLowerCase(), record.dirty.toLowerCase()),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map((s) => s.record);
}

export function createRecord(
  dirty: string,
  clean: string,
  source: "auto" | "manual",
): RenameRecord {
  return {
    dirty,
    clean,
    timestamp: new Date().toISOString(),
    source,
  };
}
