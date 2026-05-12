import { describe, it, expect } from "vitest";
import { findSimilar, createRecord } from "../history";
import type { RenameRecord } from "../types";

const POOL: RenameRecord[] = [
  createRecord("He Who Fights with Monsters 5.epub", "Shirtaloon - He Who Fights With Monsters (05).epub", "manual"),
  createRecord("The Battlemage_116967466.epub", "Matharu, Taran - Summoner (03) - The Battlemage.epub", "manual"),
  createRecord("Mark Manson - Some Book.epub", "Manson, Mark - Some Book.epub", "auto"),
];

describe("history", () => {
  describe("findSimilar", () => {
    it("returns top-K sorted by similarity", () => {
      const results = findSimilar("He Who Fights with Monsters 6.epub", POOL, 2);
      expect(results).toHaveLength(2);
      expect(results[0].dirty).toContain("He Who Fights");
    });

    it("returns empty for empty pool", () => {
      expect(findSimilar("anything", [], 5)).toHaveLength(0);
    });

    it("respects topK limit", () => {
      const results = findSimilar("some book.epub", POOL, 1);
      expect(results).toHaveLength(1);
    });
  });

  describe("createRecord", () => {
    it("creates a record with timestamp", () => {
      const r = createRecord("dirty.epub", "clean.epub", "auto");
      expect(r.dirty).toBe("dirty.epub");
      expect(r.clean).toBe("clean.epub");
      expect(r.source).toBe("auto");
      expect(r.timestamp).toBeTruthy();
    });
  });
});
