import { create } from "zustand";
import type {
  BulkEntry,
  BulkUndoEntry,
  FileEntry,
  Mode,
  SeriesMeta,
  Settings,
  UndoEntry,
} from "../types";
import {
  basename,
  buildProposedName,
  dirname,
  extension,
  formatAuthor,
  joinPath,
  maxVolume,
  sanitize,
} from "./naming";

type State = {
  mode: Mode;
  settings: Settings;
  meta: SeriesMeta;
  entries: FileEntry[];
  undo: UndoEntry | null;
  analyzing: boolean;
  renaming: boolean;
  error: string | null;
  lastRenameDone: boolean;

  // Bulk mode
  bulkEntries: BulkEntry[];
  bulkScanning: boolean;
  bulkRenaming: boolean;
  bulkUndo: BulkUndoEntry | null;
  bulkProgress: { done: number; total: number } | null;

  setMode: (m: Mode) => void;
  setSettings: (s: Partial<Settings>) => void;
  setLastRenameDone: (b: boolean) => void;
  setMeta: (m: Partial<SeriesMeta>) => void;
  addPaths: (paths: string[]) => void;
  removeEntry: (id: string) => void;
  toggleSelected: (id: string) => void;
  updateEntry: (id: string, patch: Partial<FileEntry>) => void;
  applyLLM: (data: {
    author: string;
    series: string;
    files: Array<{
      originalName: string;
      volume: number | null;
      volumeEnd: number | null;
      title: string | null;
    }>;
  }) => void;
  recomputeNames: () => void;
  setEntryStatus: (id: string, status: FileEntry["status"], error?: string) => void;
  clearAll: () => void;
  setUndo: (u: UndoEntry | null) => void;
  setAnalyzing: (b: boolean) => void;
  setRenaming: (b: boolean) => void;
  setError: (e: string | null) => void;

  // Bulk
  setBulkEntries: (entries: BulkEntry[]) => void;
  upsertBulkEntry: (entry: BulkEntry) => void;
  updateBulkEntry: (id: string, patch: Partial<BulkEntry>, markManual?: boolean) => void;
  removeBulkEntry: (id: string) => void;
  removeBulkEntries: (ids: string[]) => void;
  toggleBulkSelected: (id: string) => void;
  setAllBulkSelected: (selected: boolean) => void;
  setBulkScanning: (b: boolean) => void;
  setBulkRenaming: (b: boolean) => void;
  setBulkProgress: (p: State["bulkProgress"]) => void;
  setBulkUndo: (u: BulkUndoEntry | null) => void;
  recomputeBulkName: (id: string) => void;
  recomputeAllBulkNames: () => void;
  clearBulk: () => void;
};

const DEFAULT_SETTINGS: Settings = {
  lmstudio_url: "http://localhost:1234",
  model: "meta-llama-3.1-8b-instruct",
  include_title_in_name: true,
  move_after_rename: false,
  move_target_dir: null,
  bulk_recursive_default: true,
  bulk_target_dir: null,
};

const ALLOWED_EXT = /\.(epub|pdf|mobi|azw3)$/i;

function makeId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export const useStore = create<State>((set, get) => ({
  mode: "series",
  settings: DEFAULT_SETTINGS,
  meta: { author: "", series: "" },
  entries: [],
  undo: null,
  analyzing: false,
  renaming: false,
  error: null,
  lastRenameDone: false,

  bulkEntries: [],
  bulkScanning: false,
  bulkRenaming: false,
  bulkUndo: null,
  bulkProgress: null,

  setMode: (mode) => set({ mode, error: null }),
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
  removeEntry: (id) => set((st) => ({ entries: st.entries.filter((e) => e.id !== id) })),
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

  // Bulk
  setBulkEntries: (entries) => set({ bulkEntries: entries }),
  upsertBulkEntry: (entry) =>
    set((st) => {
      const idx = st.bulkEntries.findIndex((e) => e.id === entry.id);
      if (idx === -1) return { bulkEntries: [...st.bulkEntries, entry] };
      const next = st.bulkEntries.slice();
      next[idx] = entry;
      return { bulkEntries: next };
    }),
  updateBulkEntry: (id, patch, markManual) => {
    set((st) => ({
      bulkEntries: st.bulkEntries.map((e) =>
        e.id === id
          ? {
              ...e,
              ...patch,
              ...(markManual ? { source: "manual" as const, confidence: "high" as const } : {}),
            }
          : e,
      ),
    }));
    get().recomputeBulkName(id);
  },
  removeBulkEntry: (id) =>
    set((st) => ({ bulkEntries: st.bulkEntries.filter((e) => e.id !== id) })),
  removeBulkEntries: (ids) => {
    const set_ = new Set(ids);
    set((st) => ({ bulkEntries: st.bulkEntries.filter((e) => !set_.has(e.id)) }));
  },
  toggleBulkSelected: (id) =>
    set((st) => ({
      bulkEntries: st.bulkEntries.map((e) =>
        e.id === id ? { ...e, selected: !e.selected } : e,
      ),
    })),
  setAllBulkSelected: (selected) =>
    set((st) => ({ bulkEntries: st.bulkEntries.map((e) => ({ ...e, selected })) })),
  setBulkScanning: (b) => set({ bulkScanning: b }),
  setBulkRenaming: (b) => set({ bulkRenaming: b }),
  setBulkProgress: (p) => set({ bulkProgress: p }),
  setBulkUndo: (u) => set({ bulkUndo: u }),
  recomputeBulkName: (id) => {
    const { bulkEntries, settings } = get();
    const target = bulkEntries.find((e) => e.id === id);
    if (!target) return;
    set({
      bulkEntries: bulkEntries.map((e) =>
        e.id === id ? { ...e, proposedName: bulkProposedName(e, settings.include_title_in_name) } : e,
      ),
    });
  },
  recomputeAllBulkNames: () => {
    const { bulkEntries, settings } = get();
    set({
      bulkEntries: bulkEntries.map((e) => ({
        ...e,
        proposedName: bulkProposedName(e, settings.include_title_in_name),
      })),
    });
  },
  clearBulk: () =>
    set({ bulkEntries: [], bulkProgress: null, bulkUndo: null, error: null }),
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

export function bulkTargetPath(e: BulkEntry, settings: Settings): string {
  const dir = settings.bulk_target_dir ?? dirname(e.originalPath);
  return joinPath(dir, e.proposedName);
}

/** Builds proposed name for a self-contained BulkEntry (per-file author+series). */
export function bulkProposedName(e: BulkEntry, includeTitle: boolean): string {
  const author = sanitize(formatAuthor(e.author));
  const series = sanitize(e.series);
  const head = author && series ? `${author} - ${series}` : author || series || "";
  let name = head;
  if (e.volume !== null) {
    const start = padBulkVolume(e.volume);
    const end =
      e.volumeEnd !== null && e.volumeEnd > e.volume ? `-${padBulkVolume(e.volumeEnd)}` : "";
    name += name ? ` (${start}${end})` : `(${start}${end})`;
  }
  if (includeTitle && e.title) {
    const t = sanitize(e.title);
    name += name ? ` - ${t}` : t;
  }
  if (!name) name = sanitize(e.originalName.replace(/\.[^.]+$/, "")) || "untitled";
  return name + e.extension;
}

function padBulkVolume(v: number): string {
  return String(v).padStart(2, "0");
}
