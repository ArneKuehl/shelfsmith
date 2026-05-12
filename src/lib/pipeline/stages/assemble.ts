import { CONFIDENCE } from "../rules";
import { sanitize } from "../utils";
import type { DecomposeResult, PipelineResult } from "../types";

export function assemble(
  decomposed: DecomposeResult,
  ext: string,
  tags: string[],
  matchedPattern: string,
  genreTagRemoved: boolean,
): PipelineResult {
  const author = decomposed.author ?? {
    value: "",
    source: "regex" as const,
    confidence: 0,
  };
  const title = decomposed.title ?? {
    value: "",
    source: "regex" as const,
    confidence: 0,
  };
  const series = decomposed.series;
  const volume = decomposed.volume;

  let overallConfidence = Math.min(
    author.confidence,
    title.confidence,
    series?.confidence ?? 1.0,
    volume?.confidence ?? 1.0,
  );

  if (!author.value) {
    overallConfidence += CONFIDENCE.DEDUCTIONS.AUTHOR_UNKNOWN;
  }
  if (genreTagRemoved) {
    overallConfidence += CONFIDENCE.DEDUCTIONS.TITLE_TRUNCATED;
  }

  overallConfidence = Math.max(0, Math.min(1, overallConfidence));

  const proposedName = buildName(author.value, series?.value ?? null, volume?.value ?? null, title.value, ext, tags);

  return {
    author,
    series: series ?? null,
    volume: volume ?? null,
    title,
    ext,
    tags,
    matchedPattern,
    overallConfidence,
    proposedName,
  };
}

function buildName(
  author: string,
  series: string | null,
  volume: string | null,
  title: string,
  ext: string,
  tags: string[],
): string {
  const parts: string[] = [];

  const safeAuthor = sanitize(author);
  const safeSeries = series ? sanitize(series) : null;
  const safeTitle = sanitize(title);

  if (safeAuthor) {
    parts.push(safeAuthor);
  }

  if (safeSeries && volume) {
    parts.push(`${safeSeries} (${volume})`);
  } else if (safeSeries) {
    parts.push(safeSeries);
  }

  if (safeTitle && safeTitle !== safeSeries) {
    parts.push(safeTitle);
  }

  if (tags.includes("royalroad")) {
    parts.push("(Royalroad)");
  }

  const name = parts.join(" - ");
  return name ? name + ext : ext;
}
