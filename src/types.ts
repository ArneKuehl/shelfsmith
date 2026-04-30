export type FileEntry = {
  id: string;
  originalPath: string;
  originalName: string;
  extension: string;
  selected: boolean;
  volume: number | null;
  volumeEnd: number | null;
  title: string | null;
  proposedName: string;
  status: "idle" | "renaming" | "done" | "error";
  error?: string;
};

export type SeriesMeta = {
  author: string;
  series: string;
};

export type RenamePair = {
  from: string;
  to: string;
};

export type RenameResult = {
  from: string;
  to: string;
  ok: boolean;
  error?: string;
};

export type UndoEntry = {
  timestamp: number;
  pairs: RenamePair[];
};

export type Mode = "series" | "bulk";

export type Settings = {
  lmstudio_url: string;
  model: string;
  include_title_in_name: boolean;
  move_after_rename: boolean;
  move_target_dir: string | null;
  bulk_recursive_default: boolean;
  bulk_target_dir: string | null;
};

export type LLMResponse = {
  author: string;
  series: string;
  files: Array<{
    originalName: string;
    volume: number | null;
    volumeEnd: number | null;
    title: string | null;
  }>;
};

export type EpubMeta = {
  title: string | null;
  author: string | null;
  author_file_as: string | null;
  series: string | null;
  series_index: number | null;
  isbn: string | null;
};

export type PdfMeta = {
  title: string | null;
  author: string | null;
};

export type LookupSource = "embedded" | "web" | "manual" | "none";
export type LookupConfidence = "high" | "medium" | "low";

export type BulkEntry = {
  id: string;
  originalPath: string;
  originalName: string;
  extension: string;
  selected: boolean;
  author: string;
  series: string;
  volume: number | null;
  volumeEnd: number | null;
  title: string | null;
  proposedName: string;
  source: LookupSource;
  confidence: LookupConfidence;
  status: "idle" | "scanning" | "ok" | "renaming" | "renamed" | "error" | "skipped";
  error?: string;
};

export type BulkUndoEntry = {
  timestamp: number;
  pairs: RenamePair[];
  removedEntries: BulkEntry[];
};
