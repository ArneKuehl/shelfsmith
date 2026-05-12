import { describe, it, expect } from "vitest";
import { normalize } from "../stages/normalize";

describe("normalize (Stage 0)", () => {
  describe("extension stripping", () => {
    it("strips .epub extension", () => {
      const r = normalize("Some Book.epub");
      expect(r.ext).toBe(".epub");
      expect(r.stem).toBe("Some Book");
    });

    it("strips .pdf extension", () => {
      const r = normalize("Some Book.pdf");
      expect(r.ext).toBe(".pdf");
    });
  });

  describe("source suffix removal", () => {
    it("removes Anna's Archive suffix", () => {
      const r = normalize(
        "Chrysalis 6_ Antvance into the Unknown_ A LitRPG Adventure -- RinoZ -- 2024 -- Aethon Books -- 0497fdde5dbc09b39fde7a23321cc4fd -- Anna’s Archive.epub",
      );
      expect(r.stem).not.toContain("Anna");
      expect(r.stem).not.toContain("Aethon Books");
    });

    it("removes libgen.li suffix", () => {
      const r = normalize(
        "Paul Papanek Stork - Learning Microsoft Power Automate - libgen.li.epub",
      );
      expect(r.stem).not.toContain("libgen");
      expect(r.stem).toBe("Paul Papanek Stork - Learning Microsoft Power Automate");
    });

    it("removes royalroad rylrdl suffix and tags royalroad", () => {
      const r = normalize(
        "The System Envoy - A SciFi 4X LitRPG Series-rylrdl_60127.epub",
      );
      expect(r.stem).not.toContain("rylrdl");
      expect(r.tags).toContain("royalroad");
    });

    it("removes Z-Library suffix", () => {
      const r = normalize("Some Book (Z-Library).epub");
      expect(r.stem).toBe("Some Book");
    });

    it("removes numeric ID suffix", () => {
      const r = normalize("The Battlemage_116967466.epub");
      expect(r.stem).toBe("The Battlemage");
    });
  });

  describe("inline marker removal", () => {
    it("removes (epub) marker", () => {
      const r = normalize("Author - Title (epub).epub");
      expect(r.stem).toBe("Author - Title");
    });

    it("removes download duplicate (1)", () => {
      const r = normalize("filename(1).epub");
      expect(r.stem).toBe("filename");
    });

    it("removes (Final) marker", () => {
      const r = normalize("Author - Title (Final).epub");
      expect(r.stem).toBe("Author - Title");
    });

    it("removes (auth.) marker", () => {
      const r = normalize("Author - Title (auth.).epub");
      expect(r.stem).toBe("Author - Title");
    });

    it("removes (German Edition) marker", () => {
      const r = normalize("Author - Title (German Edition).epub");
      expect(r.stem).toBe("Author - Title");
    });

    it("removes leading [0] prefix", () => {
      const r = normalize("[0] Hans Rosling - Factfulness.epub");
      expect(r.stem).toBe("Hans Rosling - Factfulness");
    });

    it("removes TA prefix", () => {
      const r = normalize("TA 241 - Blish, James - Star Trek 10 - Spocks Gehirn.epub");
      expect(r.stem).toBe("Blish, James - Star Trek 10 - Spocks Gehirn");
    });
  });

  describe("publisher-year removal", () => {
    it("removes publisher and year block", () => {
      const r = normalize(
        "Kyle Cucci - Evasive Malware-No Starch Press (2024).pdf",
      );
      expect(r.stem).toBe("Kyle Cucci - Evasive Malware");
    });

    it("removes publisher with city", () => {
      const r = normalize(
        "Author - Title-Springer Berlin Heidelberg (2020, Berlin).pdf",
      );
      expect(r.stem).toBe("Author - Title");
    });
  });

  describe("underscore and colon artifact handling", () => {
    it("replaces underscores with spaces", () => {
      const r = normalize("Some_Book_Title.epub");
      expect(r.stem).toBe("Some Book Title");
    });

    it("fixes colon artifacts (double space after underscore replacement)", () => {
      const r = normalize("Mastering Retrieval-Augmented Generation_ Advanced Techniques.epub");
      expect(r.stem).toBe("Mastering Retrieval-Augmented Generation - Advanced Techniques");
    });
  });

  describe("genre tag removal", () => {
    it("removes LitRPG adventure tag", () => {
      const r = normalize("Title_ A LitRPG Adventure.epub");
      expect(r.stem).not.toContain("LitRPG");
    });

    it("removes Xianxia cultivation tag", () => {
      const r = normalize("Title - A Xianxia Cultivation Series.epub");
      expect(r.stem).toBe("Title");
    });

    it("removes progression fantasy tag", () => {
      const r = normalize("Title_ A Progression Fantasy Series.epub");
      expect(r.stem).not.toContain("Progression");
    });
  });

  describe("compound cases", () => {
    it("handles libgen format with embedded publisher in parens", () => {
      // This format has (Year, Publisher) as part of the filename,
      // not as a -Publisher (Year) suffix. The publisher-year regex
      // correctly does NOT match here because there's no dash-publisher prefix.
      const r = normalize(
        "Anirudh Kala, Anshul Bhatnagar, and Sarthak Sarbahi - Optimizing Databricks Workloads (2021, Packt Publishing Pvt. Ltd.).epub",
      );
      expect(r.stem).toContain("Optimizing Databricks Workloads");
    });

    it("handles royalroad + genre tag", () => {
      const r = normalize(
        "The System Envoy_ A SciFi 4X LitRPG Series-rylrdl_60127.epub",
      );
      expect(r.tags).toContain("royalroad");
      expect(r.stem).not.toContain("rylrdl");
      expect(r.stem).not.toContain("SciFi 4X LitRPG");
    });

    it("handles numeric ID + underscore replacement", () => {
      const r = normalize(
        "Mastering Retrieval-Augmented Generation_ Advanced Techniques and Production-Ready Solutions for Enterprise AI_122991047.epub",
      );
      expect(r.stem).not.toContain("122991047");
      expect(r.stem).toContain("Mastering Retrieval-Augmented Generation");
    });
  });
});
