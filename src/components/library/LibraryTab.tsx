import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "../../lib/store";
import { analyzeLibrary, reanalyze } from "../../lib/library";
import { loadLibraryCache, saveLibraryCache } from "../../lib/persist";
import { decomposeFilename } from "../../lib/lmstudio";
import { LibraryTree } from "./LibraryTree";
import { LibraryTable } from "./LibraryTable";
import { LibraryMissingTable } from "./LibraryMissingTable";
import { dirname, joinPath } from "../../lib/naming";
import type { LibraryEntry, RenameResult } from "../../types";

type DeleteResult = { path: string; ok: boolean; error?: string };

export function LibraryTab() {
  const settings = useStore((s) => s.settings);
  const entries = useStore((s) => s.libraryEntries);
  const clusters = useStore((s) => s.libraryClusters);
  const libSettings = useStore((s) => s.librarySettings);
  const scanning = useStore((s) => s.libraryScanning);
  const selectedCluster = useStore((s) => s.librarySelectedCluster);
  const setEntries = useStore((s) => s.setLibraryEntries);
  const setClusters = useStore((s) => s.setLibraryClusters);
  const setLibSettings = useStore((s) => s.setLibrarySettings);
  const setScanning = useStore((s) => s.setLibraryScanning);
  const setSelectedCluster = useStore((s) => s.setLibrarySelectedCluster);
  const updateEntry = useStore((s) => s.updateLibraryEntry);
  const error = useStore((s) => s.error);
  const setError = useStore((s) => s.setError);

  const [folder, setFolder] = useState<string | null>(null);
  const [recursive, setRecursive] = useState(settings.bulk_recursive_default);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [cacheLoaded, setCacheLoaded] = useState(false);
  const [view, setView] = useState<"detail" | "missing">("detail");

  const abortRef = useRef<AbortController | null>(null);

  // Load cache on mount
  useEffect(() => {
    loadLibraryCache()
      .then((c) => {
        if (c) {
          if (c.folder) setFolder(c.folder);
          setRecursive(c.recursive);
          if (c.entries.length > 0) setEntries(c.entries);
          if (c.clusters.length > 0) setClusters(c.clusters);
          if (c.settings) setLibSettings(c.settings);
        }
      })
      .finally(() => setCacheLoaded(true));
  }, [setEntries, setClusters, setLibSettings]);

  // Persist whenever entries/clusters change
  useEffect(() => {
    if (!cacheLoaded) return;
    saveLibraryCache({ folder, recursive, entries, clusters, settings: libSettings }).catch(() => {});
  }, [entries, clusters, folder, recursive, libSettings, cacheLoaded]);

  const pickFolder = async () => {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") setFolder(dir);
  };

  const startScan = async () => {
    if (!folder) return;
    setError(null);
    setScanning(true);
    setSelectedCluster(null);
    await saveLibraryCache(null).catch(() => {});
    try {
      const result = await analyzeLibrary(folder, recursive, libSettings);
      setEntries(result.entries);
      setClusters(result.clusters);
      if (result.entries.length === 0) {
        setError("Keine unterstützten Dateien gefunden.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  };

  const runReanalyze = () => {
    const s = useStore.getState();
    const result = reanalyze(s.libraryEntries, s.librarySettings);
    setEntries(result.entries);
    setClusters(result.clusters);
  };

  // Real disk rescan + reanalyze; tries to preserve the currently selected
  // cluster by matching (authorKey, seriesKey).
  const rescanPreservingCluster = async () => {
    if (!folder) return;
    const prevId = useStore.getState().librarySelectedCluster;
    const prev = useStore.getState().libraryClusters.find((c) => c.id === prevId);
    setScanning(true);
    try {
      const result = await analyzeLibrary(folder, recursive, libSettings);
      setEntries(result.entries);
      setClusters(result.clusters);
      if (prev) {
        const match = result.clusters.find(
          (c) => c.authorKey === prev.authorKey && c.seriesKey === prev.seriesKey,
        );
        setSelectedCluster(match ? match.id : null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  };

  const applySingle = async (entry: LibraryEntry) => {
    if (!entry.suggestion) return;
    setBusy(true);
    setError(null);
    updateEntry(entry.id, { status: "renaming" });
    const pair = { from: entry.originalPath, to: entry.suggestion.proposedPath };
    try {
      const results = await invoke<RenameResult[]>("rename_files", { pairs: [pair] });
      const r = results[0];
      if (r.ok) {
        await rescanPreservingCluster();
      } else {
        updateEntry(entry.id, { status: "error", error: r.error });
      }
    } catch (e) {
      updateEntry(entry.id, {
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const applyAllInCluster = async () => {
    if (!selectedCluster) return;
    setBusy(true);
    setError(null);
    const targets = entries.filter(
      (e) =>
        e.clusterId === selectedCluster &&
        e.selected &&
        e.suggestion &&
        e.status !== "done",
    );
    let anySuccess = false;
    for (const entry of targets) {
      if (!entry.suggestion) continue;
      updateEntry(entry.id, { status: "renaming" });
      const pair = { from: entry.originalPath, to: entry.suggestion.proposedPath };
      try {
        const results = await invoke<RenameResult[]>("rename_files", { pairs: [pair] });
        const r = results[0];
        if (r.ok) {
          anySuccess = true;
        } else {
          updateEntry(entry.id, { status: "error", error: r.error });
        }
      } catch (e) {
        updateEntry(entry.id, {
          status: "error",
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    if (anySuccess) await rescanPreservingCluster();
    setBusy(false);
  };

  const deleteEntry = async (entry: LibraryEntry) => {
    setBusy(true);
    setError(null);
    try {
      const results = await invoke<DeleteResult[]>("delete_files", {
        paths: [entry.originalPath],
      });
      const r = results[0];
      if (r.ok) {
        await rescanPreservingCluster();
      } else {
        updateEntry(entry.id, { status: "error", error: r.error ?? "Löschen fehlgeschlagen" });
      }
    } catch (e) {
      updateEntry(entry.id, {
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const manualRename = async (entry: LibraryEntry, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === entry.originalName) return;
    setBusy(true);
    setError(null);
    updateEntry(entry.id, { status: "renaming" });
    const targetPath = joinPath(dirname(entry.originalPath), trimmed);
    try {
      const results = await invoke<RenameResult[]>("rename_files", {
        pairs: [{ from: entry.originalPath, to: targetPath }],
      });
      const r = results[0];
      if (r.ok) {
        await rescanPreservingCluster();
      } else {
        updateEntry(entry.id, { status: "error", error: r.error });
      }
    } catch (e) {
      updateEntry(entry.id, {
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const askLlm = async (entry: LibraryEntry) => {
    setBusy(true);
    setError(null);
    try {
      const decomp = await decomposeFilename(
        settings.lmstudio_url,
        settings.model,
        entry.originalName,
      );
      const patch: Partial<LibraryEntry> = {};
      if (decomp.author) patch.author = decomp.author;
      if (decomp.series) patch.series = decomp.series;
      if (decomp.title) patch.title = decomp.title;
      if (decomp.volume !== null) patch.volume = decomp.volume;
      updateEntry(entry.id, patch);
      runReanalyze();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const updateCluster = (patch: { author?: string; series?: string }) => {
    if (!selectedCluster) return;
    const clusterEntryIds = new Set(
      entries.filter((e) => e.clusterId === selectedCluster).map((e) => e.id),
    );
    for (const id of clusterEntryIds) {
      const ep: Partial<LibraryEntry> = {};
      if (patch.author !== undefined) ep.author = patch.author;
      if (patch.series !== undefined) ep.series = patch.series;
      updateEntry(id, ep);
    }
    setTimeout(runReanalyze, 0);
  };

  const selectedClusterObj = clusters.find((c) => c.id === selectedCluster) ?? null;

  const issueCount = entries.reduce(
    (n, e) => n + e.issues.filter((i) => i.kind !== "volume-gap").length,
    0,
  );
  const clusterCount = clusters.length;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Toolbar */}
      <div className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-4 py-3 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[16rem]">
          <label className="block text-xs uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">
            Quellordner
          </label>
          <div className="flex items-center gap-2">
            <span
              className="flex-1 truncate text-sm text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded px-2 py-1.5"
              title={folder ?? "—"}
            >
              {folder ?? "(kein Ordner gewählt)"}
            </span>
            <button
              className="px-2 py-1.5 rounded bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-xs"
              onClick={pickFolder}
            >
              Ordner wählen…
            </button>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm pb-2">
          <input
            type="checkbox"
            checked={recursive}
            onChange={(e) => setRecursive(e.target.checked)}
          />
          Rekursiv
        </label>
        <label className="flex items-center gap-2 text-sm pb-2">
          <input
            type="checkbox"
            checked={libSettings.titleCase}
            onChange={(e) => {
              setLibSettings({ titleCase: e.target.checked });
              if (entries.length > 0) setTimeout(runReanalyze, 0);
            }}
          />
          Title-Case
        </label>
        {scanning ? (
          <button
            className="px-4 py-2 rounded-md bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium"
            onClick={() => abortRef.current?.abort()}
          >
            Abbrechen
          </button>
        ) : (
          <button
            className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed text-white text-sm font-medium"
            onClick={startScan}
            disabled={!folder}
          >
            Scannen & Analysieren
          </button>
        )}
        {entries.length > 0 && (
          <span className="text-xs text-slate-500 pb-2 self-end">
            {entries.length} Dateien, {clusterCount} Cluster, {issueCount} Issues
          </span>
        )}
        {entries.length > 0 && (
          <div className="pb-1 self-end inline-flex rounded-md border border-slate-300 dark:border-slate-700 overflow-hidden text-xs">
            <button
              className={`px-3 py-1.5 ${
                view === "detail"
                  ? "bg-blue-600 text-white"
                  : "bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              }`}
              onClick={() => setView("detail")}
            >
              Detail
            </button>
            <button
              className={`px-3 py-1.5 border-l border-slate-300 dark:border-slate-700 ${
                view === "missing"
                  ? "bg-blue-600 text-white"
                  : "bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              }`}
              onClick={() => setView("missing")}
            >
              Lücken
            </button>
          </div>
        )}
      </div>

      {/* Main area: tree + table OR missing-volumes table */}
      <div className="flex flex-1 overflow-hidden">
        {view === "detail" ? (
          <>
            {/* Left: cluster tree */}
            <div className="w-72 flex-shrink-0 border-r border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col">
              <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800">
                <input
                  type="text"
                  placeholder="Filter…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="w-full text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded px-2 py-1.5"
                />
              </div>
              <LibraryTree
                clusters={clusters}
                selectedClusterId={selectedCluster}
                onSelect={setSelectedCluster}
                filter={filter}
              />
            </div>
            {/* Right: detail table */}
            <LibraryTable
              cluster={selectedClusterObj}
              entries={entries}
              onApply={applySingle}
              onApplyAll={applyAllInCluster}
              onAskLlm={askLlm}
              onUpdateCluster={updateCluster}
              onDelete={deleteEntry}
              onManualRename={manualRename}
              busy={busy}
            />
          </>
        ) : (
          <LibraryMissingTable
            clusters={clusters}
            entries={entries}
            onSelectCluster={(id) => {
              setSelectedCluster(id);
              setView("detail");
            }}
          />
        )}
      </div>

      {error && (
        <div className="px-4 py-2 bg-rose-100 dark:bg-rose-950/60 border-t border-rose-300 dark:border-rose-900 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </div>
      )}
    </div>
  );
}
