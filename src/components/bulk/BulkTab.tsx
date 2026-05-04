import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useStore, bulkTargetPath } from "../../lib/store";
import { loadBulkCache, saveBulkCache, saveSettings } from "../../lib/persist";
import { enrichEntry, scanFolder, type EnrichOpts } from "../../lib/bulk";
import { checkAvailable } from "../../lib/lmstudio";
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
  const [llmActive, setLlmActive] = useState<null | boolean>(null);
  const [cacheLoaded, setCacheLoaded] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Load cached scan on mount.
  useEffect(() => {
    loadBulkCache()
      .then((c) => {
        if (c) {
          if (c.folder) setFolder(c.folder);
          setRecursive(c.recursive);
          if (c.entries.length > 0) setEntries(c.entries);
        }
      })
      .finally(() => setCacheLoaded(true));
  }, [setEntries]);

  // Persist scan + manual edits whenever they change (plugin-store autosaves).
  useEffect(() => {
    if (!cacheLoaded) return;
    saveBulkCache({ folder, recursive, entries }).catch(() => {});
  }, [entries, folder, recursive, cacheLoaded]);

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
    await saveBulkCache(null).catch(() => {});
    setEntries([]);
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    try {
      const fresh = await scanFolder(folder, recursive);
      setEntries(fresh);
      if (fresh.length === 0) {
        setError("No supported files found.");
        return;
      }
      // LLM availability check up front so we don't probe per file.
      let opts: EnrichOpts = { llm: null };
      if (settings.bulk_llm_fallback) {
        const ok = await checkAvailable(settings.lmstudio_url);
        setLlmActive(ok);
        if (ok) opts = { llm: { url: settings.lmstudio_url, model: settings.model } };
      } else {
        setLlmActive(null);
      }
      setProgress({ done: 0, total: fresh.length });
      let done = 0;
      for (const e of fresh) {
        if (signal.aborted) break;
        upsert({ ...e, status: "scanning" });
        try {
          const enriched = await enrichEntry(e, signal, opts);
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
        llmEnabled={settings.bulk_llm_fallback}
        llmActive={llmActive}
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
  llmEnabled: boolean;
  llmActive: null | boolean;
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
          Source folder
        </label>
        <div className="flex items-center gap-2">
          <span
            className="flex-1 truncate text-sm text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded px-2 py-1.5"
            title={props.folder ?? "—"}
          >
            {props.folder ?? "(no folder selected)"}
          </span>
          <button
            className="px-2 py-1.5 rounded bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-xs"
            onClick={props.onPickFolder}
          >
            Choose folder…
          </button>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm pb-2">
        <input
          type="checkbox"
          checked={props.recursive}
          onChange={(e) => props.onToggleRecursive(e.target.checked)}
        />
        Recursive
      </label>
      <div className="pb-2">
        <label className="block text-xs uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">
          Sort by
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
            Author
          </button>
          <button
            className={`px-3 py-1.5 text-xs ${
              props.sortBy === "series"
                ? "bg-blue-600 text-white"
                : "bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700"
            }`}
            onClick={() => props.onSortByChange("series")}
          >
            Series
          </button>
        </div>
      </div>
      <div className="flex-1 min-w-[16rem]">
        <label className="block text-xs uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">
          Target folder (optional)
        </label>
        <div className="flex items-center gap-2">
          <span
            className="flex-1 truncate text-sm text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded px-2 py-1.5"
            title={props.targetDir ?? "—"}
          >
            {props.targetDir ?? "(rename in place)"}
          </span>
          <button
            className="px-2 py-1.5 rounded bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-xs"
            onClick={props.onPickTarget}
          >
            Choose…
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
            ? `Cancel (${props.progress.done}/${props.progress.total})`
            : "Cancel"}
        </button>
      ) : (
        <button
          className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed text-white text-sm font-medium"
          onClick={props.onScan}
          disabled={!props.folder}
        >
          Scan
        </button>
      )}
      {props.totalCount > 0 && (
        <span className="text-xs text-slate-500 pb-2 self-end">
          {props.totalCount} file(s)
        </span>
      )}
      {props.llmEnabled && (
        <span
          className={`text-xs pb-2 self-end ${
            props.llmActive === true
              ? "text-emerald-700 dark:text-emerald-300"
              : props.llmActive === false
                ? "text-amber-700 dark:text-amber-300"
                : "text-slate-500"
          }`}
          title={
            props.llmActive === true
              ? "Local LLM reachable — used as fallback"
              : props.llmActive === false
                ? "Local LLM unreachable — step skipped"
                : "LLM status checked on scan"
          }
        >
          {props.llmActive === true ? "LLM ✓" : props.llmActive === false ? "LLM ✗" : "LLM ?"}
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
        setError(`${failed.length} undo operation(s) failed.`);
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
        Last bulk rename at {time} ({undo.pairs.length} file(s))
      </span>
      <button
        className="px-3 py-1 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-sm"
        onClick={doUndo}
      >
        Undo
      </button>
    </div>
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
