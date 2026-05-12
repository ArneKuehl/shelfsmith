import { jaroWinkler } from "../../cluster";
import { formatAuthor } from "../../naming";
import type {
  DecomposeResult,
  FieldResult,
  FieldSource,
  MetadataResult,
  PipelineOptions,
  LlmResult,
  WebResult,
} from "../types";

const OVERWRITE_THRESHOLD = 0.85;
const LLM_BASE_CONFIDENCE = 0.5;
const METADATA_EPUB_CONFIDENCE = 0.9;
const METADATA_PDF_CONFIDENCE = 0.6;
const WEB_CONFIRM_THRESHOLD = 0.85;
const WEB_REJECT_THRESHOLD = 0.6;

export async function enrich(
  regexResult: DecomposeResult,
  filePath: string,
  options: PipelineOptions,
): Promise<DecomposeResult> {
  let result = structuredClone(regexResult);

  // Stage 2a: Embedded metadata (highest trust)
  if (options.metadataProvider) {
    try {
      const meta = await options.metadataProvider.extract(filePath);
      const isEpub = filePath.toLowerCase().endsWith(".epub");
      const conf = isEpub ? METADATA_EPUB_CONFIDENCE : METADATA_PDF_CONFIDENCE;
      result = mergeMetadata(result, meta, conf);
    } catch {
      /* metadata unavailable */
    }
  }

  // Stage 2b: LLM decomposition — when fields are still missing or low confidence
  if (options.llmProvider && needsEnrichment(result)) {
    try {
      const llmResult = await options.llmProvider.decompose(
        filePath.split("/").pop() ?? filePath,
      );
      result = mergeLlm(result, llmResult);
    } catch {
      /* LLM unavailable */
    }
  }

  // Stage 3: Web lookup — cross-validate or fill gaps
  if (options.webProvider && (needsEnrichment(result) || hasLlmFields(result))) {
    try {
      const query = buildWebQuery(result);
      if (query) {
        const webResult = await options.webProvider.lookup(query);
        result = mergeWeb(result, webResult);
      }
    } catch {
      /* web unavailable */
    }
  }

  return result;
}

function needsEnrichment(r: DecomposeResult): boolean {
  return (
    !r.author?.value ||
    !r.title?.value ||
    (r.author?.confidence ?? 0) < 0.5 ||
    (r.title?.confidence ?? 0) < 0.5
  );
}

function hasLlmFields(r: DecomposeResult): boolean {
  return (
    r.author?.source === "llm" ||
    r.title?.source === "llm" ||
    r.series?.source === "llm"
  );
}

function buildWebQuery(r: DecomposeResult): string | null {
  const parts: string[] = [];
  if (r.title?.value) parts.push(r.title.value);
  if (r.author?.value) parts.push(r.author.value);
  if (r.series?.value && !r.title?.value) parts.push(r.series.value);
  return parts.length > 0 ? parts.join(" ") : null;
}

function mergeMetadata(
  result: DecomposeResult,
  meta: MetadataResult,
  confidence: number,
): DecomposeResult {
  if (meta.author) {
    const formatted = formatAuthor(meta.author);
    result.author = mergeField(result.author, formatted, "metadata", confidence);
  }
  if (meta.title) {
    result.title = mergeField(result.title, meta.title, "metadata", confidence);
  }
  if (meta.series) {
    result.series = mergeField(result.series, meta.series, "metadata", confidence);
  }
  if (meta.seriesIndex !== null && meta.seriesIndex !== undefined) {
    const vol = String(meta.seriesIndex).padStart(2, "0");
    result.volume = mergeField(result.volume, vol, "metadata", confidence);
  }
  return result;
}

function mergeLlm(
  result: DecomposeResult,
  llm: LlmResult,
): DecomposeResult {
  if (llm.author) {
    const formatted = formatAuthor(llm.author);
    result.author = mergeField(result.author, formatted, "llm", LLM_BASE_CONFIDENCE);
  }
  if (llm.title) {
    result.title = mergeField(result.title, llm.title, "llm", LLM_BASE_CONFIDENCE);
  }
  if (llm.series) {
    result.series = mergeField(result.series, llm.series, "llm", LLM_BASE_CONFIDENCE);
  }
  if (llm.volume !== null) {
    const vol = String(llm.volume).padStart(2, "0");
    result.volume = mergeField(result.volume, vol, "llm", LLM_BASE_CONFIDENCE);
  }
  return result;
}

function mergeWeb(
  result: DecomposeResult,
  web: WebResult,
): DecomposeResult {
  if (web.author) {
    const formatted = formatAuthor(web.author);
    result.author = mergeWebField(result.author, formatted, "web");
  }
  if (web.title) {
    result.title = mergeWebField(result.title, web.title, "web");
  }
  if (web.series) {
    result.series = mergeWebField(result.series, web.series, "web");
  }
  if (web.seriesIndex !== null && web.seriesIndex !== undefined) {
    const vol = String(web.seriesIndex).padStart(2, "0");
    result.volume = mergeWebField(result.volume, vol, "web");
  }
  return result;
}

/**
 * Core merge logic for a single field (metadata/LLM).
 * - Empty existing → fill with new value
 * - Existing value close to new (JW > threshold) → boost confidence
 * - Existing value diverges → store as alternative, keep existing
 */
function mergeField(
  existing: FieldResult | null,
  newValue: string,
  source: Exclude<FieldSource, "manual">,
  confidence: number,
): FieldResult {
  if (!existing || !existing.value) {
    return { value: newValue, source, confidence };
  }

  const similarity = jaroWinkler(
    existing.value.toLowerCase(),
    newValue.toLowerCase(),
  );

  if (similarity > OVERWRITE_THRESHOLD) {
    // Confirmation — boost confidence
    const boosted = Math.min(1.0, Math.max(existing.confidence, confidence));
    const alternatives = existing.alternatives?.slice() ?? [];
    if (existing.value !== newValue) {
      alternatives.push({ value: newValue, source, confidence });
    }
    return {
      ...existing,
      confidence: boosted,
      alternatives: alternatives.length > 0 ? alternatives : undefined,
    };
  }

  // Divergence — store as alternative
  const alternatives = existing.alternatives?.slice() ?? [];
  alternatives.push({ value: newValue, source, confidence });
  return { ...existing, alternatives };
}

/**
 * Web merge with stricter cross-validation.
 * Web results that contradict existing regex/metadata (JW < 0.6) are rejected
 * and only stored as alternatives.
 */
function mergeWebField(
  existing: FieldResult | null,
  newValue: string,
  source: "web",
): FieldResult {
  if (!existing || !existing.value) {
    return { value: newValue, source, confidence: 0.6 };
  }

  const similarity = jaroWinkler(
    existing.value.toLowerCase(),
    newValue.toLowerCase(),
  );

  if (similarity >= WEB_CONFIRM_THRESHOLD) {
    // Confirmation — boost confidence
    const boosted = Math.min(1.0, existing.confidence + 0.1);
    return { ...existing, confidence: boosted };
  }

  if (similarity < WEB_REJECT_THRESHOLD) {
    // Contradicts — reject, store only as alternative
    const alternatives = existing.alternatives?.slice() ?? [];
    alternatives.push({ value: newValue, source, confidence: 0.3 });
    return { ...existing, alternatives };
  }

  // In between — store as alternative with moderate confidence
  const alternatives = existing.alternatives?.slice() ?? [];
  alternatives.push({ value: newValue, source, confidence: 0.5 });
  return { ...existing, alternatives };
}
