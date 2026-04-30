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

export type Settings = {
  lmstudio_url: string;
  model: string;
  include_title_in_name: boolean;
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
