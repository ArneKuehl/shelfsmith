import { create } from "zustand";
import type { FileEntry, SeriesMeta, Settings, UndoEntry } from "../types";
import { basename, buildProposedName, dirname, extension, joinPath, maxVolume } from "./naming";

type State = {
  settings: Settings;
  meta: SeriesMeta;
  entries: FileEntry[];
  undo: UndoEntry | null;
  analyzing: boolean;
  renaming: boolean;
  error: string | null;
  lastRenameDone: boolean;

  setSettings: (s: Partial<Settings>) => void;
  setLastRenameDone: (b: boolean) => void;
  setMeta: (m: Partial<SeriesMeta>) => void;
  addPaths: (paths: string[]) => void;
  removeEntry: (id: string) => void;
  toggleSelected: (id: string) => void;
  updateEntry: (id: string, patch: Partial<FileEntry>) => void;
  applyLLM: (data: { author: string; series: string; files: Array<{ originalName: string; volume: number | null; volumeEnd: number | null; title: string | null }> }) => void;
  recomputeNames: () => void;
  setEntryStatus: (id: string, status: FileEntry["status"], error?: string) => void;
  clearAll: () => void;
  setUndo: (u: UndoEntry | null) => void;
  setAnalyzing: (b: boolean) => void;
  setRenaming: (b: boolean) => void;
  setError: (e: string | null) => void;
};

const DEFAULT_SETTINGS: Settings = {
  lmstudio_url: "http://localhost:1234",
  model: "meta-llama-3.1-8b-instruct",
  include_title_in_name: true,
  move_after_rename: false,
  move_target_dir: null,
};

const ALLOWED_EXT = /\.(epub|pdf|mobi|azw3)$/i;

function makeId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export const useStore = create<State>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  meta: { author: "", series: "" },
  entries: [],
  undo: null,
  analyzing: false,
  renaming: false,
  error: null,
  lastRenameDone: false,

  setSettings: (s) => set((st) => ({ settings: { ...st.settings, ...s } })),
  setLastRenameDone: (b) => set({ lastRenameDone: b }),
  setMeta: (m) => {
    set((st) => ({ meta: { ...st.meta, ...m } }));
    get().recomputeNames();
  },
  addPaths: (paths) => {
    const state = get();
    const wipe = state.lastRenameDone;
    const baseEntries = wipe ? [] : state.entries;
    const existing = new Set(baseEntries.map((e) => e.originalPath));
    const fresh = paths
      .filter((p) => ALLOWED_EXT.test(p) && !existing.has(p))
      .map((p): FileEntry => {
        const name = basename(p);
        return {
          id: makeId(),
          originalPath: p,
          originalName: name,
          extension: extension(name),
          selected: true,
          volume: null,
          volumeEnd: null,
          title: null,
          proposedName: name,
          status: "idle",
        };
      });
    if (fresh.length === 0 && !wipe) return;
    set({
      entries: [...baseEntries, ...fresh],
      lastRenameDone: false,
      ...(wipe ? { meta: { author: "", series: "" }, error: null } : {}),
    });
  },
  removeEntry: (id) =>
    set((st) => ({ entries: st.entries.filter((e) => e.id !== id) })),
  toggleSelected: (id) =>
    set((st) => ({
      entries: st.entries.map((e) => (e.id === id ? { ...e, selected: !e.selected } : e)),
    })),
  updateEntry: (id, patch) => {
    set((st) => ({
      entries: st.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }));
    get().recomputeNames();
  },
  applyLLM: (data) => {
    set((st) => ({
      meta: { author: data.author || st.meta.author, series: data.series || st.meta.series },
      entries: st.entries.map((e) => {
        const m = data.files.find((f) => f.originalName === e.originalName);
        if (!m) return e;
        return { ...e, volume: m.volume, volumeEnd: m.volumeEnd, title: m.title };
      }),
    }));
    get().recomputeNames();
  },
  recomputeNames: () => {
    const { entries, meta, settings } = get();
    const max = maxVolume(entries);
    const updated = entries.map((e) => ({
      ...e,
      proposedName: buildProposedName(meta, e, max, settings.include_title_in_name),
    }));
    updated.sort(sortByVolume);
    set({ entries: updated });
  },
  setEntryStatus: (id, status, error) =>
    set((st) => ({
      entries: st.entries.map((e) => (e.id === id ? { ...e, status, error } : e)),
    })),
  clearAll: () => set({ entries: [], meta: { author: "", series: "" }, error: null }),
  setUndo: (u) => set({ undo: u }),
  setAnalyzing: (b) => set({ analyzing: b }),
  setRenaming: (b) => set({ renaming: b }),
  setError: (e) => set({ error: e }),
}));

function sortByVolume(a: FileEntry, b: FileEntry): number {
  if (a.volume === null && b.volume === null) return a.originalName.localeCompare(b.originalName);
  if (a.volume === null) return 1;
  if (b.volume === null) return -1;
  return a.volume - b.volume;
}

export function targetPath(e: FileEntry, settings?: Settings): string {
  const dir =
    settings?.move_after_rename && settings.move_target_dir
      ? settings.move_target_dir
      : dirname(e.originalPath);
  return joinPath(dir, e.proposedName);
}
