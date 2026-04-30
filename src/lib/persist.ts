import { load, type Store } from "@tauri-apps/plugin-store";
import type { Settings, UndoEntry } from "../types";

const FILE = "settings.json";
let storePromise: Promise<Store> | null = null;

function getStore(): Promise<Store> {
  if (!storePromise) storePromise = load(FILE, { autoSave: true });
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
  if (url) out.lmstudio_url = url;
  if (model) out.model = model;
  if (typeof inclTitle === "boolean") out.include_title_in_name = inclTitle;
  if (typeof moveAfter === "boolean") out.move_after_rename = moveAfter;
  if (typeof moveDir === "string" || moveDir === null) out.move_target_dir = moveDir;
  return out;
}

export async function saveSettings(settings: Settings): Promise<void> {
  const s = await getStore();
  await s.set("lmstudio_url", settings.lmstudio_url);
  await s.set("model", settings.model);
  await s.set("include_title_in_name", settings.include_title_in_name);
  await s.set("move_after_rename", settings.move_after_rename);
  await s.set("move_target_dir", settings.move_target_dir);
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
