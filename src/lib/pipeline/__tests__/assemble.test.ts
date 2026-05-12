import { describe, it, expect } from "vitest";
import { assemble } from "../stages/assemble";
import type { DecomposeResult, FieldResult } from "../types";

function field(value: string, confidence = 1.0): FieldResult {
  return { value, source: "regex", confidence };
}

function makeDecompose(overrides: Partial<DecomposeResult> = {}): DecomposeResult {
  return {
    author: field("Nachname, Vorname"),
    series: null,
    volume: null,
    title: field("Some Title"),
    matchedPattern: "test",
    ...overrides,
  };
}

describe("assemble (Stage 4)", () => {
  it("assembles author - title format", () => {
    const r = assemble(makeDecompose(), ".epub", [], "test", false);
    expect(r.proposedName).toBe("Nachname, Vorname - Some Title.epub");
  });

  it("assembles author - series (vol) - title format", () => {
    const r = assemble(
      makeDecompose({
        series: field("My Series"),
        volume: field("03"),
      }),
      ".epub",
      [],
      "test",
      false,
    );
    expect(r.proposedName).toBe("Nachname, Vorname - My Series (03) - Some Title.epub");
  });

  it("assembles author - series (vol) without title", () => {
    const r = assemble(
      makeDecompose({
        series: field("My Series"),
        volume: field("03"),
        title: null,
      }),
      ".epub",
      [],
      "test",
      false,
    );
    expect(r.proposedName).toBe("Nachname, Vorname - My Series (03).epub");
  });

  it("appends royalroad tag", () => {
    const r = assemble(makeDecompose(), ".epub", ["royalroad"], "test", false);
    expect(r.proposedName).toBe("Nachname, Vorname - Some Title - (Royalroad).epub");
  });

  it("deducts confidence for unknown author", () => {
    const r = assemble(
      makeDecompose({ author: field("", 0) }),
      ".epub",
      [],
      "test",
      false,
    );
    expect(r.overallConfidence).toBeLessThan(0.5);
  });

  it("deducts confidence for genre tag removal", () => {
    const r = assemble(makeDecompose(), ".epub", [], "test", true);
    expect(r.overallConfidence).toBe(0.9);
  });

  it("clamps confidence to [0, 1]", () => {
    const r = assemble(
      makeDecompose({ author: null }),
      ".epub",
      [],
      "test",
      true,
    );
    expect(r.overallConfidence).toBeGreaterThanOrEqual(0);
    expect(r.overallConfidence).toBeLessThanOrEqual(1);
  });
});
