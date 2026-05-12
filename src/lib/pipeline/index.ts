import { normalize } from "./stages/normalize";
import { decompose } from "./stages/decompose";
import { enrich } from "./stages/enrich";
import { assemble } from "./stages/assemble";
import type { PipelineResult, PipelineOptions } from "./types";

export type { PipelineResult, PipelineOptions, FieldResult, Alternative, RenameRecord } from "./types";
export { TauriMetadataProvider } from "./providers/metadata";
export { LMStudioLlmProvider } from "./providers/llm";
export { GoogleBooksWebProvider } from "./providers/web";

/**
 * Synchronous pipeline — regex only (Stage 0+1+4). Used by tests and
 * when no enrichment providers are configured.
 */
export function runPipeline(
  filename: string,
): PipelineResult {
  const normalized = normalize(filename);
  const decomposed = decompose(normalized.stem);
  const genreTagRemoved = normalized.removedParts.some((p) => p.startsWith("[genre_tag]"));

  return assemble(
    decomposed,
    normalized.ext,
    normalized.tags,
    decomposed.matchedPattern,
    genreTagRemoved,
  );
}

/**
 * Async pipeline with enrichment — runs normalize → decompose → enrich → assemble.
 * When providers are supplied, metadata/LLM/web enrichment fills missing fields
 * and cross-validates existing ones.
 */
export async function runPipelineAsync(
  filename: string,
  filePath: string,
  options: PipelineOptions,
): Promise<PipelineResult> {
  const normalized = normalize(filename);
  const decomposed = decompose(normalized.stem);
  const enriched = await enrich(decomposed, filePath, options);
  const genreTagRemoved = normalized.removedParts.some((p) => p.startsWith("[genre_tag]"));

  return assemble(
    enriched,
    normalized.ext,
    normalized.tags,
    enriched.matchedPattern,
    genreTagRemoved,
  );
}
