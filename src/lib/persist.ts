import { load, type Store } from "@tauri-apps/plugin-store";
import type { BulkEntry, LibraryCluster, LibraryEntry, LibrarySettings, PipelineEntry, Settings, UndoEntry } from "../types";
import type { RenameRecord } from "./pipeline/types";

export type BulkCache = {
  folder: string | null;
  recursive: boolean;
  entries: BulkEntry[];
};

const FILE = "settings.json";
let storePromise: Promise<Store> | null = null;

function getStore(): Promise<Store> {
  if (!storePromise) storePromise = load(FILE, { autoSave: true, defaults: {} });
  return storePromise;
}

export async function loadSettings(): Promise<Partial<Settings>> {
  const s = await getStore();
  const out: Partial<Settings> = {};
  const url = await s.get<string>("lmstudio_url");
  const model = await s.get<string>("model");
  const inclTitle = await s.get<boolean>("include_title_in_name");
  const moveAfter = await s.get<boolean>("move_after_rename");
  const moveDir = await s.get<string | null>("move_target_dir");
  const bulkRec = await s.get<boolean>("bulk_recursive_default");
  const bulkDir = await s.get<string | null>("bulk_target_dir");
  const bulkSort = await s.get<string>("bulk_sort_by");
  const bulkLlm = await s.get<boolean>("bulk_llm_fallback");
  const theme = await s.get<string>("theme");
  if (url) out.lmstudio_url = url;
  if (model) out.model = model;
  if (typeof inclTitle === "boolean") out.include_title_in_name = inclTitle;
  if (typeof moveAfter === "boolean") out.move_after_rename = moveAfter;
  if (typeof moveDir === "string" || moveDir === null) out.move_target_dir = moveDir;
  if (typeof bulkRec === "boolean") out.bulk_recursive_default = bulkRec;
  if (typeof bulkDir === "string" || bulkDir === null) out.bulk_target_dir = bulkDir;
  if (bulkSort === "author" || bulkSort === "series") out.bulk_sort_by = bulkSort;
  if (typeof bulkLlm === "boolean") out.bulk_llm_fallback = bulkLlm;
  if (theme === "dark" || theme === "light") out.theme = theme;
  return out;
}

export async function saveSettings(settings: Settings): Promise<void> {
  const s = await getStore();
  await s.set("lmstudio_url", settings.lmstudio_url);
  await s.set("model", settings.model);
  await s.set("include_title_in_name", settings.include_title_in_name);
  await s.set("move_after_rename", settings.move_after_rename);
  await s.set("move_target_dir", settings.move_target_dir);
  await s.set("bulk_recursive_default", settings.bulk_recursive_default);
  await s.set("bulk_target_dir", settings.bulk_target_dir);
  await s.set("bulk_sort_by", settings.bulk_sort_by);
  await s.set("bulk_llm_fallback", settings.bulk_llm_fallback);
  await s.set("theme", settings.theme);
}

export async function loadUndo(): Promise<UndoEntry | null> {
  const s = await getStore();
  return (await s.get<UndoEntry>("last_undo")) ?? null;
}

export async function saveUndo(undo: UndoEntry | null): Promise<void> {
  const s = await getStore();
  if (undo) await s.set("last_undo", undo);
  else await s.delete("last_undo");
}

export async function loadBulkCache(): Promise<BulkCache | null> {
  const s = await getStore();
  return (await s.get<BulkCache>("bulk_cache")) ?? null;
}

export async function saveBulkCache(cache: BulkCache | null): Promise<void> {
  const s = await getStore();
  if (cache) await s.set("bulk_cache", cache);
  else await s.delete("bulk_cache");
}

// ---------------------------------------------------------------------------
// Library cache
// ---------------------------------------------------------------------------

export type LibraryCache = {
  folder: string | null;
  recursive: boolean;
  entries: LibraryEntry[];
  clusters: LibraryCluster[];
  settings: LibrarySettings;
};

export async function loadLibraryCache(): Promise<LibraryCache | null> {
  const s = await getStore();
  return (await s.get<LibraryCache>("library_cache")) ?? null;
}

export async function saveLibraryCache(cache: LibraryCache | null): Promise<void> {
  const s = await getStore();
  if (cache) await s.set("library_cache", cache);
  else await s.delete("library_cache");
}

// ---------------------------------------------------------------------------
// Pipeline cache
// ---------------------------------------------------------------------------

export type PipelineCache = {
  folder: string | null;
  recursive: boolean;
  entries: PipelineEntry[];
};

export async function loadPipelineCache(): Promise<PipelineCache | null> {
  const s = await getStore();
  return (await s.get<PipelineCache>("pipeline_cache")) ?? null;
}

export async function savePipelineCache(cache: PipelineCache | null): Promise<void> {
  const s = await getStore();
  if (cache) await s.set("pipeline_cache", cache);
  else await s.delete("pipeline_cache");
}

// ---------------------------------------------------------------------------
// Rename history
// ---------------------------------------------------------------------------

export async function loadRenameHistory(): Promise<RenameRecord[]> {
  const s = await getStore();
  return (await s.get<RenameRecord[]>("rename_history")) ?? [];
}

export async function saveRenameHistory(records: RenameRecord[]): Promise<void> {
  const s = await getStore();
  await s.set("rename_history", records);
}
