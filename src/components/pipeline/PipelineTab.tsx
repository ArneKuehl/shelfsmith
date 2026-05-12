import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "../../lib/store";
import {
  loadPipelineCache,
  savePipelineCache,
  loadRenameHistory,
  saveRenameHistory,
} from "../../lib/persist";
import {
  runPipeline,
  runPipelineAsync,
  TauriMetadataProvider,
  LMStudioLlmProvider,
  GoogleBooksWebProvider,
} from "../../lib/pipeline";
import type { PipelineOptions, PipelineResult, RenameRecord } from "../../lib/pipeline/types";
import { createRecord } from "../../lib/pipeline/history";
import { checkAvailable } from "../../lib/lmstudio";
import { basename, dirname, extension, joinPath } from "../../lib/naming";
import { PipelinePreviewTable } from "./PipelinePreviewTable";
import type { PipelineEntry, RenameResult } from "../../types";
import type { FieldSource } from "../../lib/pipeline/types";

function makeId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function toPipelineEntry(path: string): PipelineEntry {
  const name = basename(path);
  return {
    id: makeId(),
    originalPath: path,
    originalName: name,
    extension: extension(name),
    selected: false,
    author: "",
    series: "",
    volume: null,
    title: null,
    proposedName: name,
    matchedPattern: "",
    overallConfidence: 0,
    fieldSource: "regex" as FieldSource,
    authorConfidence: 0,
    seriesConfidence: 0,
    titleConfidence: 0,
    tags: [],
    status: "idle",
  };
}

function resultToEntry(entry: PipelineEntry, result: PipelineResult): PipelineEntry {
  return {
    ...entry,
    author: result.author.value,
    series: result.series?.value ?? "",
    volume: result.volume?.value ?? null,
    title: result.title.value || null,
    proposedName: result.proposedName,
    matchedPattern: result.matchedPattern,
    overallConfidence: result.overallConfidence,
    fieldSource: result.author.source,
    authorConfidence: result.author.confidence,
    seriesConfidence: result.series?.confidence ?? 0,
    titleConfidence: result.title.confidence,
    tags: result.tags,
    status: "ok",
  };
}

let renameHistory: RenameRecord[] = [];

async function appendHistory(records: RenameRecord[]): Promise<void> {
  renameHistory = [...renameHistory, ...records];
  saveRenameHistory(renameHistory).catch(() => {});
}

export function PipelineTab() {
  const entries = useStore((s) => s.pipelineEntries);
  const setEntries = useStore((s) => s.setPipelineEntries);
  const upsert = useStore((s) => s.upsertPipelineEntry);
  const removePipelineEntry = useStore((s) => s.removePipelineEntry);
  const scanning = useStore((s) => s.pipelineScanning);
  const setScanning = useStore((s) => s.setPipelineScanning);
  const setRenaming = useStore((s) => s.setPipelineRenaming);
  const progress = useStore((s) => s.pipelineProgress);
  const setProgress = useStore((s) => s.setPipelineProgress);
  const settings = useStore((s) => s.settings);
  const error = useStore((s) => s.error);
  const setError = useStore((s) => s.setError);

  const [folder, setFolder] = useState<string | null>(null);
  const [recursive, setRecursive] = useState(settings.bulk_recursive_default);
  const [enrichEnabled, setEnrichEnabled] = useState(true);
  const [llmActive, setLlmActive] = useState<boolean | null>(null);
  const [cacheLoaded, setCacheLoaded] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    loadPipelineCache()
      .then((c) => {
        if (c) {
          if (c.folder) setFolder(c.folder);
          setRecursive(c.recursive);
          if (c.entries.length > 0) setEntries(c.entries);
        }
      })
      .finally(() => setCacheLoaded(true));
    loadRenameHistory().then((h) => { renameHistory = h; });
  }, [setEntries]);

  useEffect(() => {
    if (!cacheLoaded) return;
    savePipelineCache({ folder, recursive, entries }).catch(() => {});
  }, [entries, folder, recursive, cacheLoaded]);

  const pickFolder = async () => {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") setFolder(dir);
  };

  const buildOptions = async (): Promise<PipelineOptions> => {
    if (!enrichEnabled) return {};
    const options: PipelineOptions = {
      metadataProvider: new TauriMetadataProvider(),
      historyPool: renameHistory,
    };
    // Check LLM availability
    if (settings.bulk_llm_fallback) {
      const ok = await checkAvailable(settings.lmstudio_url);
      setLlmActive(ok);
      if (ok) {
        options.llmProvider = new LMStudioLlmProvider(
          settings.lmstudio_url,
          settings.model,
          renameHistory,
        );
      }
    }
    options.webProvider = new GoogleBooksWebProvider();
    return options;
  };

  const startScan = async () => {
    if (!folder) return;
    setError(null);
    setScanning(true);
    setProgress(null);
    await savePipelineCache(null).catch(() => {});
    setEntries([]);
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    try {
      const paths = await invoke<string[]>("scan_directory", {
        path: folder,
        recursive,
      });
      if (paths.length === 0) {
        setError("No supported files found.");
        return;
      }
      const fresh = paths.map(toPipelineEntry);
      setEntries(fresh);

      const options = await buildOptions();
      const useAsync = enrichEnabled && Object.keys(options).length > 0;

      setProgress({ done: 0, total: fresh.length });
      let done = 0;
      for (const e of fresh) {
        if (signal.aborted) break;
        upsert({ ...e, status: "scanning" });
        try {
          let result: PipelineResult;
          if (useAsync) {
            result = await runPipelineAsync(e.originalName, e.originalPath, options);
          } else {
            result = runPipeline(e.originalName);
          }
          upsert(resultToEntry(e, result));
        } catch (err) {
          // Fallback to sync pipeline on enrichment error
          try {
            const result = runPipeline(e.originalName);
            upsert(resultToEntry(e, result));
          } catch {
            upsert({
              ...e,
              status: "error",
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        done++;
        setProgress({ done, total: fresh.length });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
      setProgress(null);
      abortRef.current = null;
    }
  };

  const cancelScan = () => abortRef.current?.abort();

  const recordRename = (entry: PipelineEntry, source: "auto" | "manual") => {
    if (entry.proposedName !== entry.originalName) {
      const record = createRecord(entry.originalName, entry.proposedName, source);
      appendHistory([record]).catch(() => {});
    }
  };

  const renameSingle = async (entry: PipelineEntry) => {
    if (entry.proposedName === entry.originalName) return;
    setError(null);
    setRenaming(true);
    upsert({ ...entry, status: "renaming" });
    const targetDir = settings.bulk_target_dir ?? dirname(entry.originalPath);
    const pair = { from: entry.originalPath, to: joinPath(targetDir, entry.proposedName) };
    try {
      const results = await invoke<RenameResult[]>("rename_files", {
        pairs: [pair],
      });
      const r = results[0];
      if (r.ok) {
        recordRename(entry, "manual");
        removePipelineEntry(entry.id);
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

  const renameAllHighConfidence = async () => {
    const high = entries.filter(
      (e) =>
        e.overallConfidence >= 0.7 &&
        e.status === "ok" &&
        e.proposedName !== e.originalName,
    );
    if (high.length === 0) return;
    setError(null);
    setRenaming(true);
    const targetDir = settings.bulk_target_dir;
    const pairs = high.map((e) => ({
      from: e.originalPath,
      to: joinPath(targetDir ?? dirname(e.originalPath), e.proposedName),
    }));
    for (const e of high) upsert({ ...e, status: "renaming" });
    try {
      const results = await invoke<RenameResult[]>("rename_files", { pairs });
      const doneIds = new Set<string>();
      const records: RenameRecord[] = [];
      for (const r of results) {
        const entry = high.find((e) => e.originalPath === r.from);
        if (!entry) continue;
        if (r.ok) {
          doneIds.add(entry.id);
          if (entry.proposedName !== entry.originalName) {
            records.push(createRecord(entry.originalName, entry.proposedName, "auto"));
          }
        } else {
          upsert({ ...entry, status: "error", error: r.error });
        }
      }
      if (records.length > 0) {
        appendHistory(records).catch(() => {});
      }
      if (doneIds.size > 0) {
        setEntries(entries.filter((e) => !doneIds.has(e.id)));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      for (const entry of high) {
        upsert({ ...entry, status: "error", error: String(e) });
      }
    } finally {
      setRenaming(false);
    }
  };

  const highCount = entries.filter(
    (e) =>
      e.overallConfidence >= 0.7 &&
      e.status === "ok" &&
      e.proposedName !== e.originalName,
  ).length;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <Toolbar
        folder={folder}
        recursive={recursive}
        scanning={scanning}
        progress={progress}
        totalCount={entries.length}
        highCount={highCount}
        enrichEnabled={enrichEnabled}
        llmActive={llmActive}
        onPickFolder={pickFolder}
        onToggleRecursive={setRecursive}
        onToggleEnrich={setEnrichEnabled}
        onScan={startScan}
        onCancel={cancelScan}
        onRenameAll={renameAllHighConfidence}
      />
      <PipelinePreviewTable onRename={renameSingle} />
      {error && (
        <div className="px-4 py-2 bg-rose-100 dark:bg-rose-950/60 border-t border-rose-300 dark:border-rose-900 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </div>
      )}
    </div>
  );
}

function Toolbar(props: {
  folder: string | null;
  recursive: boolean;
  scanning: boolean;
  progress: { done: number; total: number } | null;
  totalCount: number;
  highCount: number;
  enrichEnabled: boolean;
  llmActive: boolean | null;
  onPickFolder: () => void;
  onToggleRecursive: (b: boolean) => void;
  onToggleEnrich: (b: boolean) => void;
  onScan: () => void;
  onCancel: () => void;
  onRenameAll: () => void;
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
      <label className="flex items-center gap-2 text-sm pb-2">
        <input
          type="checkbox"
          checked={props.enrichEnabled}
          onChange={(e) => props.onToggleEnrich(e.target.checked)}
        />
        Enrich
      </label>
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
      {props.highCount > 0 && !props.scanning && (
        <button
          className="px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium"
          onClick={props.onRenameAll}
        >
          Rename {props.highCount} high confidence
        </button>
      )}
      {props.totalCount > 0 && (
        <span className="text-xs text-slate-500 pb-2 self-end">
          {props.totalCount} file(s)
        </span>
      )}
      {props.enrichEnabled && props.llmActive !== null && (
        <span
          className={`text-xs pb-2 self-end ${
            props.llmActive
              ? "text-emerald-700 dark:text-emerald-300"
              : "text-amber-700 dark:text-amber-300"
          }`}
        >
          {props.llmActive ? "LLM ✓" : "LLM ✗"}
        </span>
      )}
    </div>
  );
}
