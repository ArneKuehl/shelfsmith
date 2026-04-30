import type { FileEntry, Settings } from "../types";
import { targetPath } from "./store";

export type CollisionMap = Map<string, string[]>;

export function findCollisions(entries: FileEntry[], settings?: Settings): CollisionMap {
  const byTarget = new Map<string, string[]>();
  for (const e of entries) {
    if (!e.selected) continue;
    const t = targetPath(e, settings).toLowerCase();
    const arr = byTarget.get(t) ?? [];
    arr.push(e.id);
    byTarget.set(t, arr);
  }
  const out: CollisionMap = new Map();
  for (const [t, ids] of byTarget) {
    if (ids.length > 1) out.set(t, ids);
  }
  return out;
}

export function entryHasCollision(entry: FileEntry, collisions: CollisionMap): boolean {
  for (const ids of collisions.values()) if (ids.includes(entry.id)) return true;
  return false;
}

export function entryHasInvalidName(entry: FileEntry): boolean {
  return entry.proposedName.trim() === entry.extension || entry.proposedName.length === 0;
}
