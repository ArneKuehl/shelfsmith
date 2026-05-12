export type FieldSource = "regex" | "metadata" | "llm" | "web" | "manual";

export interface Alternative {
  value: string;
  source: Exclude<FieldSource, "manual">;
  confidence: number;
}

export interface FieldResult {
  value: string;
  source: FieldSource;
  confidence: number;
  alternatives?: Alternative[];
}

export interface MetadataPatch {
  author?: string;
  title?: string;
  series?: string;
  seriesIndex?: number;
}

export interface PipelineResult {
  author: FieldResult;
  series: FieldResult | null;
  volume: FieldResult | null;
  title: FieldResult;
  ext: string;
  tags: string[];
  matchedPattern: string;
  overallConfidence: number;
  proposedName: string;
  metadataPatch?: MetadataPatch;
}

export interface NormalizeResult {
  stem: string;
  ext: string;
  tags: string[];
  removedParts: string[];
}

export interface DecomposeResult {
  author: FieldResult | null;
  series: FieldResult | null;
  volume: FieldResult | null;
  title: FieldResult | null;
  matchedPattern: string;
}

export interface RenameRecord {
  dirty: string;
  clean: string;
  timestamp: string;
  source: "auto" | "manual";
}

// ---------------------------------------------------------------------------
// Provider interfaces (Phase 3)
// ---------------------------------------------------------------------------

export interface MetadataResult {
  author: string | null;
  title: string | null;
  series: string | null;
  seriesIndex: number | null;
  isbn: string | null;
}

export interface LlmResult {
  author: string | null;
  series: string | null;
  title: string | null;
  volume: number | null;
}

export interface WebResult {
  author: string | null;
  title: string | null;
  series: string | null;
  seriesIndex: number | null;
}

export interface MetadataProvider {
  extract(filePath: string): Promise<MetadataResult>;
}

export interface LlmProvider {
  decompose(
    filename: string,
    examples?: Array<{ dirty: string; clean: string }>,
  ): Promise<LlmResult>;
  decomposeBatch?(filenames: string[]): Promise<LlmResult[]>;
}

export interface WebProvider {
  lookup(query: string): Promise<WebResult>;
}

export interface PipelineOptions {
  metadataProvider?: MetadataProvider;
  llmProvider?: LlmProvider;
  webProvider?: WebProvider;
  historyPool?: RenameRecord[];
}
