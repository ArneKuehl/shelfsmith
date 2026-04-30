import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useStore, bulkTargetPath } from "../../lib/store";
import { saveSettings } from "../../lib/persist";
import { enrichEntry, scanFolder } from "../../lib/bulk";
import { BulkPreviewTable } from "./BulkPreviewTable";
import type { BulkEntry, BulkSortBy, RenameResult } from "../../types";

export function BulkTab() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const entries = useStore((s) => s.bulkEntries);
  const setEntries = useStore((s) => s.setBulkEntries);
  const upsert = useStore((s) => s.upsertBulkEntry);
  const removeBulkEntry = useStore((s) => s.removeBulkEntry);
  const scanning = useStore((s) => s.bulkScanning);
  const setScanning = useStore((s) => s.setBulkScanning);
  const setRenaming = useStore((s) => s.setBulkRenaming);
  const progress = useStore((s) => s.bulkProgress);
  const setProgress = useStore((s) => s.setBulkProgress);
  const setUndo = useStore((s) => s.setBulkUndo);
  const recomputeAll = useStore((s) => s.recomputeAllBulkNames);
  const error = useStore((s) => s.error);
  const setError = useStore((s) => s.setError);
  const undo = useStore((s) => s.bulkUndo);

  const [folder, setFolder] = useState<string | null>(null);
  const [recursive, setRecursive] = useState(settings.bulk_recursive_default);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setRecursive(settings.bulk_recursive_default);
  }, [settings.bulk_recursive_default]);

  const persistSetting = (patch: Partial<typeof settings>) => {
    setSettings(patch);
    saveSettings({ ...settings, ...patch }).catch(() => {});
  };

  const pickFolder = async () => {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") setFolder(dir);
  };

  const pickTargetDir = async () => {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") persistSetting({ bulk_target_dir: dir });
  };

  const startScan = async () => {
    if (!folder) return;
    setError(null);
    setScanning(true);
    setProgress(null);
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    try {
      const fresh = await scanFolder(folder, recursive);
      setEntries(fresh);
      if (fresh.length === 0) {
        setError("Keine unterstützten Dateien gefunden.");
        return;
      }
      setProgress({ done: 0, total: fresh.length });
      let done = 0;
      for (const e of fresh) {
        if (signal.aborted) break;
        upsert({ ...e, status: "scanning" });
        try {
          const enriched = await enrichEntry(e, signal);
          upsert(enriched);
        } catch (err) {
          upsert({
            ...e,
            status: "error",
            error: err instanceof Error ? err.message : String(err),
          });
        }
        done++;
        setProgress({ done, total: fresh.length });
        await sleep(150);
      }
      recomputeAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
      setProgress(null);
      abortRef.current = null;
    }
  };

  const cancelScan = () => abortRef.current?.abort();

  const renameSingle = async (entry: BulkEntry) => {
    if (!entry.author || !entry.series) return;
    setError(null);
    setRenaming(true);
    upsert({ ...entry, status: "renaming" });
    const pair = { from: entry.originalPath, to: bulkTargetPath(entry, settings) };
    try {
      const results = await invoke<RenameResult[]>("rename_files", { pairs: [pair] });
      const r = results[0];
      if (r.ok) {
        setUndo({
          timestamp: Date.now(),
          pairs: [{ from: r.from, to: r.to }],
          removedEntries: [{ ...entry, status: "renamed" }],
        });
        removeBulkEntry(entry.id);
      } else {
        upsert({ ...entry, status: "error", error: r.error });
      }
    } catch (e) {
      upsert({
        ...entry,
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setRenaming(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Toolbar
        folder={folder}
        recursive={recursive}
        scanning={scanning}
        progress={progress}
        targetDir={settings.bulk_target_dir}
        totalCount={entries.length}
        sortBy={settings.bulk_sort_by}
        onPickFolder={pickFolder}
        onPickTarget={pickTargetDir}
        onClearTarget={() => persistSetting({ bulk_target_dir: null })}
        onToggleRecursive={(b) => {
          setRecursive(b);
          persistSetting({ bulk_recursive_default: b });
        }}
        onSortByChange={(by) => persistSetting({ bulk_sort_by: by })}
        onScan={startScan}
        onCancel={cancelScan}
      />
      <BulkPreviewTable onRename={renameSingle} />
      {error && (
        <div className="px-4 py-2 bg-rose-100 dark:bg-rose-950/60 border-t border-rose-300 dark:border-rose-900 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </div>
      )}
      {undo && <BulkUndoBar />}
    </div>
  );
}

function Toolbar(props: {
  folder: string | null;
  recursive: boolean;
  scanning: boolean;
  progress: { done: number; total: number } | null;
  targetDir: string | null;
  totalCount: number;
  sortBy: BulkSortBy;
  onPickFolder: () => void;
  onPickTarget: () => void;
  onClearTarget: () => void;
  onToggleRecursive: (b: boolean) => void;
  onSortByChange: (by: BulkSortBy) => void;
  onScan: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-4 py-3 flex flex-wrap items-end gap-3">
      <div className="flex-1 min-w-[16rem]">
        <label className="block text-xs uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">
          Quellordner
        </label>
        <div className="flex items-center gap-2">
          <span
            className="flex-1 truncate text-sm text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded px-2 py-1.5"
            title={props.folder ?? "—"}
          >
            {props.folder ?? "(kein Ordner gewählt)"}
          </span>
          <button
            className="px-2 py-1.5 rounded bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-xs"
            onClick={props.onPickFolder}
          >
            Ordner wählen…
          </button>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm pb-2">
        <input
          type="checkbox"
          checked={props.recursive}
          onChange={(e) => props.onToggleRecursive(e.target.checked)}
        />
        Rekursiv
      </label>
      <div className="pb-2">
        <label className="block text-xs uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">
          Sortierung
        </label>
        <div className="inline-flex rounded overflow-hidden border border-slate-300 dark:border-slate-700">
          <button
            className={`px-3 py-1.5 text-xs ${
              props.sortBy === "author"
                ? "bg-blue-600 text-white"
                : "bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700"
            }`}
            onClick={() => props.onSortByChange("author")}
          >
            Autor
          </button>
          <button
            className={`px-3 py-1.5 text-xs ${
              props.sortBy === "series"
                ? "bg-blue-600 text-white"
                : "bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700"
            }`}
            onClick={() => props.onSortByChange("series")}
          >
            Serie
          </button>
        </div>
      </div>
      <div className="flex-1 min-w-[16rem]">
        <label className="block text-xs uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">
          Ziel-Ordner (optional)
        </label>
        <div className="flex items-center gap-2">
          <span
            className="flex-1 truncate text-sm text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded px-2 py-1.5"
            title={props.targetDir ?? "—"}
          >
            {props.targetDir ?? "(am Ort umbenennen)"}
          </span>
          <button
            className="px-2 py-1.5 rounded bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-xs"
            onClick={props.onPickTarget}
          >
            Wählen…
          </button>
          {props.targetDir && (
            <button
              className="px-2 py-1.5 rounded bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-xs"
              onClick={props.onClearTarget}
            >
              ×
            </button>
          )}
        </div>
      </div>
      {props.scanning ? (
        <button
          className="px-4 py-2 rounded-md bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium"
          onClick={props.onCancel}
        >
          {props.progress
            ? `Abbrechen (${props.progress.done}/${props.progress.total})`
            : "Abbrechen"}
        </button>
      ) : (
        <button
          className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed text-white text-sm font-medium"
          onClick={props.onScan}
          disabled={!props.folder}
        >
          Scannen
        </button>
      )}
      {props.totalCount > 0 && (
        <span className="text-xs text-slate-500 pb-2 self-end">
          {props.totalCount} Datei(en)
        </span>
      )}
    </div>
  );
}

function BulkUndoBar() {
  const undo = useStore((s) => s.bulkUndo);
  const setUndo = useStore((s) => s.setBulkUndo);
  const setEntries = useStore((s) => s.setBulkEntries);
  const entries = useStore((s) => s.bulkEntries);
  const setRenaming = useStore((s) => s.setBulkRenaming);
  const setError = useStore((s) => s.setError);

  if (!undo) return null;
  const time = new Date(undo.timestamp).toLocaleTimeString();

  const doUndo = async () => {
    setRenaming(true);
    setError(null);
    try {
      const reversed = undo.pairs.map((p) => ({ from: p.to, to: p.from }));
      const results = await invoke<RenameResult[]>("rename_files", { pairs: reversed });
      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) {
        setError(`${failed.length} Undo-Operation(en) fehlgeschlagen.`);
      } else {
        setEntries([
          ...entries,
          ...undo.removedEntries.map((e) => ({ ...e, status: "ok" as const })),
        ]);
        setUndo(null);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setRenaming(false);
    }
  };

  return (
    <div className="px-4 py-2 border-t border-slate-200 dark:border-slate-800 bg-amber-100 dark:bg-amber-950/40 flex items-center justify-between text-sm">
      <span>
        Letzte Bulk-Umbenennung um {time} ({undo.pairs.length} Datei(en))
      </span>
      <button
        className="px-3 py-1 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-sm"
        onClick={doUndo}
      >
        Rückgängig
      </button>
    </div>
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
