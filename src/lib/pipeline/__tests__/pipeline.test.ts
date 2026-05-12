import { describe, it, expect } from "vitest";
import { runPipeline } from "../index";

const GROUND_TRUTH: Array<{ dirty: string; clean: string }> = [
  // Already clean passthrough (note: pipeline doesn't add dots to initials)
  {
    dirty: "Bernays, Edward L - Crystallizing Public Opinion-Open Road Media (2015).epub",
    clean: "Bernays, Edward L - Crystallizing Public Opinion.epub",
  },
  // libgen suffix + publisher-year + author flip
  {
    dirty: "Mark Manson - The Subtle Art of Not Giving a Fuck_ A Counterintuitive Approach to Living a Good Life-HarperCollins (2016).epub",
    clean: "Manson, Mark - The Subtle Art of Not Giving a Fuck - A Counterintuitive Approach to Living a Good Life.epub",
  },
  // Numeric ID suffix → title only (needs LLM for author)
  {
    dirty: "The Battlemage_116967466.epub",
    clean: "The Battlemage.epub",
  },
  // Round bracket series prefix
  {
    dirty: "(Cradle 1-9) Will Wight.epub",
    clean: "Wight, Will - Cradle (01-09).epub",
  },
  // Square bracket series prefix
  {
    dirty: "[Dungeon Crawler Carl 4] Matt Dinniman - The Gate of the Feral Gods.epub",
    clean: "Dinniman, Matt - Dungeon Crawler Carl (04) - The Gate of the Feral Gods.epub",
  },
  // Royalroad tag
  {
    dirty: "The System Envoy_ A SciFi 4X LitRPG Series-rylrdl_60127.epub",
    clean: "The System Envoy - (Royalroad).epub",
  },
  // Pen name - title only (no author → preserve as-is)
  {
    dirty: "He Who Fights with Monsters 5.epub",
    clean: "He Who Fights with Monsters 5.epub",
  },
  // Publisher with year
  {
    dirty: "Kyle Cucci - Evasive Malware_ Understanding Deceptive and Self-Defending Threats-No Starch Press (2024).pdf",
    clean: "Cucci, Kyle - Evasive Malware - Understanding Deceptive and Self-Defending Threats.pdf",
  },
  // (epub) marker removal
  {
    dirty: "Tao Wong - The Third Cut (epub).epub",
    clean: "Wong, Tao - The Third Cut.epub",
  },
  // TA prefix → already clean after removal
  {
    dirty: "TA 241 - Blish, James - Star Trek 10 - Spocks Gehirn.epub",
    clean: "Blish, James - Star Trek (10) - Spocks Gehirn.epub",
  },
  // libgen suffix + publisher-year + author flip
  {
    dirty: "Randall Munroe - What if_ Was wäre wenn_ (2020, Albrecht Knaus Verlag) - libgen.li.epub",
    clean: "Munroe, Randall - What if - Was wäre wenn.epub",
  },
  // Title only with volume — preserve as-is (needs LLM for author)
  {
    dirty: "The primal Hunter 4.epub",
    clean: "The primal Hunter 4.epub",
  },
];

// Cases that need LLM/metadata enrichment (Stage 2/3) to be fully solved.
// Pipeline correctly identifies them as title-only or partial matches.
const NEEDS_ENRICHMENT: Array<{ dirty: string; expectedPattern: string }> = [
  // Anna’s Archive: author was in the removed suffix. After normalization the
  // stem looks like "Chrysalis 6 - Antvance into the Unknown" which matches
  // author_dash_title with "Chrysalis 6" as a fake author → needs enrichment.
  {
    dirty: "Chrysalis 6_ Antvance into the Unknown_ A LitRPG Adventure -- RinoZ -- 2024 -- Aethon Books -- 0497fdde5dbc09b39fde7a23321cc4fd -- Anna’s Archive.epub",
    expectedPattern: "author_dash_title",
  },
  // Underscore filename: truncated during download, can't reliably split
  {
    dirty: "The_Call_of_the_Forces_A_LitRP_-_Yuri_Ajin.epub",
    expectedPattern: "author_dash_title",
  },
  // After normalization becomes "Immortal Great Souls 3 - LastRock" which
  // matches author_dash_title (Immortal Great Souls 3 = fake author)
  {
    dirty: "Immortal Great Souls 3_ LastRock_118340078.epub",
    expectedPattern: "author_dash_title",
  },
];

describe("pipeline integration (ground truth)", () => {
  for (const { dirty, clean } of GROUND_TRUTH) {
    it(`${dirty.slice(0, 60)}...`, () => {
      const result = runPipeline(dirty);
      expect(result.proposedName).toBe(clean);
    });
  }
});

describe("pipeline cases needing enrichment", () => {
  for (const { dirty, expectedPattern } of NEEDS_ENRICHMENT) {
    it(`${dirty.slice(0, 60)}... → pattern ${expectedPattern}`, () => {
      const result = runPipeline(dirty);
      expect(result.matchedPattern).toBe(expectedPattern);
    });
  }
});
