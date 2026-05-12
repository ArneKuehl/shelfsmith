import { STRUCTURAL_PATTERNS, PEN_NAMES, VOLUME_PATTERNS } from "../rules";
import { swapAuthorName } from "../utils";
import type { FieldResult, DecomposeResult } from "../types";

function field(
  value: string,
  confidence: number,
): FieldResult {
  return { value, source: "regex", confidence };
}

function normalizeAuthor(raw: string): FieldResult {
  const trimmed = raw.trim();
  if (!trimmed) return field("", 0);

  if (PEN_NAMES.has(trimmed)) {
    return field(trimmed, 1.0);
  }

  if (trimmed.includes(",")) {
    return field(trimmed, 1.0);
  }

  const multiSep = /\band\b|&/i;
  if (multiSep.test(trimmed)) {
    const parts = trimmed.split(multiSep).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const primary = normalizeAuthor(parts[0]);
      return field(primary.value, 0.8);
    }
  }

  const words = trimmed.split(/\s+/);
  if (words.length === 1) {
    return field(trimmed, 0.9);
  }
  if (words.length === 2) {
    return field(swapAuthorName(trimmed), 1.0);
  }

  // 3+ words — try heuristic: if last word looks like a surname, flip
  // but flag as lower confidence
  return field(swapAuthorName(trimmed), 0.6);
}

function extractVolume(text: string): { cleaned: string; volume: string | null } {
  for (const pattern of VOLUME_PATTERNS) {
    const m = text.match(pattern);
    if (m) {
      const vol = m[1];
      const cleaned = text.replace(pattern, "").trim();
      return { cleaned, volume: vol };
    }
  }
  return { cleaned: text, volume: null };
}

function parseVolumeString(raw: string): FieldResult {
  const trimmed = raw.trim();
  const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
  if (rangeMatch) {
    const start = rangeMatch[1].padStart(2, "0");
    const end = rangeMatch[2].padStart(2, "0");
    return field(`${start}-${end}`, 1.0);
  }
  const num = parseInt(trimmed, 10);
  if (!isNaN(num)) {
    return field(String(num).padStart(2, "0"), 1.0);
  }
  return field(trimmed, 0.5);
}

function handleAlreadyClean(stem: string): DecomposeResult {
  const dashIdx = stem.indexOf(" - ");
  if (dashIdx < 0) {
    return { author: field(stem, 1.0), series: null, volume: null, title: null, matchedPattern: "already_clean" };
  }
  const author = stem.slice(0, dashIdx).trim();
  const rest = stem.slice(dashIdx + 3).trim();
  const seriesMatch = rest.match(/^(.+?)\s+\((\d[\d.-]*)\)(?:\s+-\s+(.+))?$/);
  if (seriesMatch) {
    return {
      author: field(author, 1.0),
      series: field(seriesMatch[1], 1.0),
      volume: parseVolumeString(seriesMatch[2]),
      title: seriesMatch[3] ? field(seriesMatch[3], 1.0) : null,
      matchedPattern: "already_clean",
    };
  }

  const innerDash = rest.match(/^(.+?)\s+-\s+(.+)$/);
  if (innerDash) {
    const first = innerDash[1].trim();
    const second = innerDash[2].trim();
    const { cleaned, volume } = extractVolume(first);
    if (volume) {
      return {
        author: field(author, 1.0),
        series: field(cleaned, 0.9),
        volume: parseVolumeString(volume),
        title: field(second, 1.0),
        matchedPattern: "already_clean",
      };
    }
    return {
      author: field(author, 1.0),
      series: field(first, 0.8),
      volume: null,
      title: field(second, 1.0),
      matchedPattern: "already_clean",
    };
  }

  return {
    author: field(author, 1.0),
    series: null,
    volume: null,
    title: field(rest, 1.0),
    matchedPattern: "already_clean",
  };
}

function handleSwapAndReformat(m: RegExpMatchArray): DecomposeResult {
  const titlePart = m[1].trim();
  const authorPart = m[2].trim();
  const author = normalizeAuthor(authorPart);
  const { cleaned, volume } = extractVolume(titlePart);
  return {
    author,
    series: null,
    volume: volume ? parseVolumeString(volume) : null,
    title: field(cleaned, 0.8),
    matchedPattern: "annas_archive_restructured",
  };
}

function handleBracketSeries(m: RegExpMatchArray, patternId: string): DecomposeResult {
  const seriesName = m[1].trim();
  const volumeRaw = m[2].trim();
  const authorOrTitle = m[3].trim();
  const titlePart = m[4]?.trim() ?? null;

  let author: FieldResult | null = null;
  let title: FieldResult | null = null;

  if (titlePart) {
    author = normalizeAuthor(authorOrTitle);
    title = field(titlePart, 0.9);
  } else {
    const dashIdx = authorOrTitle.indexOf(" - ");
    if (dashIdx >= 0) {
      author = normalizeAuthor(authorOrTitle.slice(0, dashIdx).trim());
      title = field(authorOrTitle.slice(dashIdx + 3).trim(), 0.9);
    } else {
      author = normalizeAuthor(authorOrTitle);
      title = null;
    }
  }

  return {
    author,
    series: field(seriesName, 1.0),
    volume: parseVolumeString(volumeRaw),
    title,
    matchedPattern: patternId,
  };
}

function handleAuthorDashTitle(m: RegExpMatchArray): DecomposeResult {
  const authorRaw = m[1].trim();
  const titleRaw = m[2].trim();

  const author = normalizeAuthor(authorRaw);

  const seriesTitleMatch = titleRaw.match(/^(.+?)\s+\((\d[\d.-]*)\)(?:\s+-\s+(.+))?$/);
  if (seriesTitleMatch) {
    return {
      author,
      series: field(seriesTitleMatch[1], 0.8),
      volume: parseVolumeString(seriesTitleMatch[2]),
      title: seriesTitleMatch[3] ? field(seriesTitleMatch[3], 0.9) : null,
      matchedPattern: "author_dash_title",
    };
  }

  const multiDash = titleRaw.match(/^(.+?)\s+-\s+(.+)$/);
  if (multiDash) {
    const first = multiDash[1].trim();
    const second = multiDash[2].trim();
    const { cleaned: seriesClean, volume } = extractVolume(first);
    if (volume) {
      return {
        author,
        series: field(seriesClean, 0.8),
        volume: parseVolumeString(volume),
        title: field(second, 0.9),
        matchedPattern: "author_dash_title",
      };
    }
    return {
      author,
      series: field(first, 0.7),
      volume: null,
      title: field(second, 0.9),
      matchedPattern: "author_dash_title",
    };
  }

  const { cleaned, volume } = extractVolume(titleRaw);
  if (volume) {
    return {
      author,
      series: field(cleaned, 0.7),
      volume: parseVolumeString(volume),
      title: null,
      matchedPattern: "author_dash_title",
    };
  }

  return {
    author,
    series: null,
    volume: null,
    title: field(titleRaw, 0.9),
    matchedPattern: "author_dash_title",
  };
}

function handleTitleOnly(m: RegExpMatchArray): DecomposeResult {
  const titleRaw = m[1].trim();
  // Without an author, we can't reliably determine if a trailing number is
  // a volume or part of the title. Leave the title as-is for enrichment.
  return {
    author: null,
    series: null,
    volume: null,
    title: field(titleRaw, 0.5),
    matchedPattern: "title_only",
  };
}

export function decompose(stem: string): DecomposeResult {
  for (const pattern of STRUCTURAL_PATTERNS) {
    const m = stem.match(pattern.regex);
    if (!m) continue;

    switch (pattern.action) {
      case "accept_as_is":
        return handleAlreadyClean(stem);
      case "swap_and_reformat":
        return handleSwapAndReformat(m);
      case "extract_series_volume_author_title":
        return handleBracketSeries(m, pattern.id);
      case "reparse_remainder": {
        const remainder = m[1].trim();
        return decompose(remainder);
      }
      case "normalize_author_and_title":
        return handleAuthorDashTitle(m);
      case "flag_for_enrichment":
        return handleTitleOnly(m);
    }
  }

  return {
    author: null,
    series: null,
    volume: null,
    title: field(stem, 0.5),
    matchedPattern: "none",
  };
}
