import {
  SOURCE_SUFFIX_RULES,
  INLINE_MARKER_RULES,
  PUBLISHER_YEAR_REGEX,
  PAREN_YEAR_PUBLISHER_REGEX,
  GENRE_TAG_REGEX,
} from "../rules";
import { stripExtension } from "../utils";
import type { NormalizeResult } from "../types";

function removeSourceSuffixes(
  stem: string,
  tags: string[],
  removed: string[],
): string {
  for (const rule of SOURCE_SUFFIX_RULES) {
    const match = stem.match(rule.regex);
    if (match) {
      removed.push(`[${rule.id}] ${match[0].trim()}`);
      if (rule.tag) tags.push(rule.tag);
      stem = stem.replace(rule.regex, "");
    }
  }
  return stem;
}

function removeInlineMarkers(stem: string, removed: string[]): string {
  for (const rule of INLINE_MARKER_RULES) {
    const match = stem.match(rule.regex);
    if (match) {
      removed.push(`[${rule.id}] ${match[0].trim()}`);
      stem = stem.replace(rule.regex, "");
    }
  }
  return stem;
}

function removePublisherYear(stem: string, removed: string[]): string {
  const match = stem.match(PUBLISHER_YEAR_REGEX);
  if (match) {
    removed.push(`[publisher_year] ${match[0].trim()}`);
    stem = stem.replace(PUBLISHER_YEAR_REGEX, "");
    return stem;
  }
  const parenMatch = stem.match(PAREN_YEAR_PUBLISHER_REGEX);
  if (parenMatch) {
    removed.push(`[paren_year_publisher] ${parenMatch[0].trim()}`);
    stem = stem.replace(PAREN_YEAR_PUBLISHER_REGEX, "");
  }
  return stem;
}

function replaceUnderscores(stem: string): string {
  return stem.replace(/_/g, " ");
}

function fixColonArtifacts(stem: string): string {
  return stem.replace(/(\w)  ([A-Z])/g, "$1 - $2");
}

function normalizeWhitespace(stem: string): string {
  return stem.replace(/\s+/g, " ").trim();
}

function removeGenreTags(stem: string, removed: string[]): string {
  const match = stem.match(GENRE_TAG_REGEX);
  if (match) {
    removed.push(`[genre_tag] ${match[0].trim()}`);
    stem = stem.replace(GENRE_TAG_REGEX, "").trim();
  }
  return stem;
}

export function normalize(filename: string): NormalizeResult {
  const { stem: rawStem, ext } = stripExtension(filename);
  const tags: string[] = [];
  const removedParts: string[] = [];

  let stem = rawStem.normalize("NFC");
  stem = removeSourceSuffixes(stem, tags, removedParts);
  stem = removeInlineMarkers(stem, removedParts);
  stem = removePublisherYear(stem, removedParts);
  stem = replaceUnderscores(stem);
  stem = fixColonArtifacts(stem);
  stem = normalizeWhitespace(stem);
  stem = removeGenreTags(stem, removedParts);

  return { stem, ext, tags, removedParts };
}
