import { describe, it, expect } from "vitest";
import { decompose } from "../stages/decompose";

describe("decompose (Stage 1)", () => {
  describe("already clean", () => {
    it("accepts 'Nachname, Vorname - Titel' format", () => {
      const r = decompose("Feist, Raymond E. - Magician");
      expect(r.matchedPattern).toBe("already_clean");
      expect(r.author?.value).toBe("Feist, Raymond E.");
      expect(r.title?.value).toBe("Magician");
    });

    it("accepts clean format with series", () => {
      const r = decompose("Wight, Will - Cradle (01) - Unsouled");
      expect(r.matchedPattern).toBe("already_clean");
      expect(r.author?.value).toBe("Wight, Will");
      expect(r.series?.value).toBe("Cradle");
      expect(r.volume?.value).toBe("01");
      expect(r.title?.value).toBe("Unsouled");
    });
  });

  describe("Anna's Archive restructured", () => {
    it("swaps title and author from 'Title -- Author' format", () => {
      const r = decompose("Some Great Book -- John Smith");
      expect(r.matchedPattern).toBe("annas_archive_restructured");
      expect(r.author?.value).toBe("Smith, John");
      expect(r.title?.value).toBe("Some Great Book");
    });
  });

  describe("square bracket series prefix", () => {
    it("extracts from [Series N] Author - Title", () => {
      const r = decompose(
        "[Dungeon Crawler Carl 4] Matt Dinniman - The Gate of the Feral Gods",
      );
      expect(r.matchedPattern).toBe("square_bracket_series_prefix");
      expect(r.series?.value).toBe("Dungeon Crawler Carl");
      expect(r.volume?.value).toBe("04");
      expect(r.author?.value).toBe("Dinniman, Matt");
      expect(r.title?.value).toBe("The Gate of the Feral Gods");
    });

    it("handles [Series N] Author without title", () => {
      const r = decompose("[Defiance of the Fall 2] TheFirstDefier");
      expect(r.series?.value).toBe("Defiance of the Fall");
      expect(r.volume?.value).toBe("02");
      expect(r.author?.value).toBe("TheFirstDefier");
    });
  });

  describe("round bracket series prefix", () => {
    it("extracts from (Series N) Author - Title", () => {
      const r = decompose(
        "(Sword of Truth 3) Goodkind, Terry - Die Schwestern des Lichts",
      );
      expect(r.matchedPattern).toBe("round_bracket_series_prefix");
      expect(r.series?.value).toBe("Sword of Truth");
      expect(r.volume?.value).toBe("03");
      expect(r.author?.value).toBe("Goodkind, Terry");
      expect(r.title?.value).toBe("Die Schwestern des Lichts");
    });

    it("handles volume ranges", () => {
      const r = decompose("(Cradle 1-9) Will Wight");
      expect(r.series?.value).toBe("Cradle");
      expect(r.volume?.value).toBe("01-09");
      expect(r.author?.value).toBe("Wight, Will");
    });
  });

  describe("author dash title", () => {
    it("flips 'Vorname Nachname - Title'", () => {
      const r = decompose("Mark Manson - The Subtle Art");
      expect(r.matchedPattern).toBe("author_dash_title");
      expect(r.author?.value).toBe("Manson, Mark");
      expect(r.title?.value).toBe("The Subtle Art");
    });

    it("keeps comma-separated author", () => {
      const r = decompose("Manson, Mark - The Subtle Art");
      expect(r.author?.value).toBe("Manson, Mark");
    });

    it("recognizes pen name", () => {
      const r = decompose("Shirtaloon - He Who Fights With Monsters");
      expect(r.author?.value).toBe("Shirtaloon");
      expect(r.author?.confidence).toBe(1.0);
    });

    it("handles author - series - title with dash separators", () => {
      const r = decompose("Blish, James - Star Trek 10 - Spocks Gehirn");
      expect(r.author?.value).toBe("Blish, James");
      expect(r.series?.value).toBe("Star Trek");
      expect(r.volume?.value).toBe("10");
      expect(r.title?.value).toBe("Spocks Gehirn");
    });
  });

  describe("title only", () => {
    it("flags title-only files for enrichment", () => {
      const r = decompose("He Who Fights with Monsters 5");
      expect(r.matchedPattern).toBe("title_only");
      expect(r.author).toBeNull();
      expect(r.title?.value).toBeDefined();
    });
  });

  describe("author normalization", () => {
    it("keeps pen names from the set", () => {
      const r = decompose("RinoZ - Chrysalis");
      expect(r.author?.value).toBe("RinoZ");
    });

    it("flags 3+ word authors with lower confidence", () => {
      const r = decompose("Paul Papanek Stork - Some Book");
      expect(r.author?.value).toContain("Stork");
      expect(r.author!.confidence).toBeLessThan(1.0);
    });
  });
});
