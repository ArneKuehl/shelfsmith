import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useStore } from "../../lib/store";
import { analyzeLibrary, loadEpubMetaForEntries, reanalyze } from "../../lib/library";
import { toTitleCase } from "../../lib/cluster";
import { loadLibraryCache, saveLibraryCache } from "../../lib/persist";
import { decomposeFilename } from "../../lib/lmstudio";
import { LibraryTree } from "./LibraryTree";
import { LibraryTable } from "./LibraryTable";
import { LibraryMissingTable } from "./LibraryMissingTable";
import { DropConfirmDialog, type DropSource } from "./DropConfirmDialog";
import { basename, buildProposedName, dirname, extension, joinPath } from "../../lib/naming";
import type { EpubMeta, LibraryEntry, PdfMeta, RenameResult } from "../../types";

type DeleteResult = { path: string; ok: boolean; error?: string };

const ALLOWED_EXTENSIONS = new Set([".epub", ".pdf", ".mobi", ".azw3"]);

type DropState = {
  filePath: string;
  fileName: string;
  fileExt: string;
  volume: number | null;
  volumeEnd: number | null;
  title: string | null;
  source: DropSource;
  llmPrompt?: string;
  llmRaw?: string;
};

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
  const updateEntries = useStore((s) => s.updateLibraryEntries);
  const error = useStore((s) => s.error);
  const setError = useStore((s) => s.setError);

  const [folder, setFolder] = useState<string | null>(null);
  const [recursive, setRecursive] = useState(settings.bulk_recursive_default);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [cacheLoaded, setCacheLoaded] = useState(false);
  const [view, setView] = useState<"detail" | "missing">("detail");
  const [metaProgress, setMetaProgress] = useState<{ done: number; total: number } | null>(null);
  const [dropState, setDropState] = useState<DropState | null>(null);
  const [dropHover, setDropHover] = useState(false);
  const [dropBusy, setDropBusy] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  // Loads EPUB OPF metadata for entries that don't have it yet, then re-analyzes
  // so the metadata-mismatch badge can appear. Should NOT be called from
  // reanalyze (e.g. after rename/move) — only after a fresh scan or first
  // cache-load.
  const loadAndApplyEpubMeta = async () => {
    const entries = useStore.getState().libraryEntries;
    const targets = entries.filter(
      (e) => e.extension.toLowerCase() === ".epub" && e.epubMeta === undefined,
    );
    if (targets.length === 0) return;
    setMetaProgress({ done: 0, total: targets.length });
    try {
      const result = await loadEpubMetaForEntries(entries, (done, total) =>
        setMetaProgress({ done, total }),
      );
      const patches = new Map<string, Partial<LibraryEntry>>();
      for (const [id, meta] of result) patches.set(id, { epubMeta: meta });
      updateEntries(patches);
      runReanalyze();
    } finally {
      setMetaProgress(null);
    }
  };

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
      .finally(() => {
        setCacheLoaded(true);
        // Fill in missing EPUB metadata in the background (e.g. after upgrading
        // from a cache that predates this feature).
        loadAndApplyEpubMeta().catch(() => {});
      });
  }, [setEntries, setClusters, setLibSettings]);

  // Persist whenever entries/clusters change
  useEffect(() => {
    if (!cacheLoaded) return;
    saveLibraryCache({ folder, recursive, entries, clusters, settings: libSettings }).catch(() => {});
  }, [entries, clusters, folder, recursive, libSettings, cacheLoaded]);

  const selectedClusterObj = clusters.find((c) => c.id === selectedCluster) ?? null;

  // -------------------------------------------------------------------------
  // Drag & Drop: import file into selected cluster
  // -------------------------------------------------------------------------

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const p = event.payload;
        if (p.type === "over" || p.type === "enter") setDropHover(true);
        else if (p.type === "leave") setDropHover(false);
        else if (p.type === "drop") {
          setDropHover(false);
          const cluster = useStore.getState().librarySelectedCluster;
          if (!cluster) return;
          const filePath = p.paths[0];
          if (!filePath) return;
          const fileName = basename(filePath);
          const ext = extension(fileName).toLowerCase();
          if (!ALLOWED_EXTENSIONS.has(ext)) {
            setError(`Unsupported format: ${ext}`);
            return;
          }
          handleDrop(filePath, fileName, ext);
        }
      })
      .then((u) => (unlisten = u));
    return () => unlisten?.();
  }, []);

  const handleDrop = async (filePath: string, fileName: string, ext: string) => {
    setDropBusy(true);
    setError(null);
    let volume: number | null = null;
    let volumeEnd: number | null = null;
    let title: string | null = null;
    let source: DropSource = "filename";
    let llmPrompt: string | undefined;
    let llmRaw: string | undefined;
    let metadataHasVolume = false;
    let metadataHasTitle = false;

    // Step 1: Try embedded metadata
    if (ext === ".epub") {
      try {
        const m = await invoke<EpubMeta>("read_epub_metadata", { path: filePath });
        if (m.series_index != null) {
          volume = m.series_index;
          metadataHasVolume = true;
        }
        if (m.title) {
          title = m.title;
          metadataHasTitle = true;
        }
        if (metadataHasVolume && metadataHasTitle) source = "metadata";
      } catch { /* ignore */ }
    } else if (ext === ".pdf") {
      try {
        const m = await invoke<PdfMeta>("read_pdf_metadata", { path: filePath });
        if (m.title) {
          title = m.title;
          metadataHasTitle = true;
        }
      } catch { /* ignore */ }
    }

    // Step 2: LLM fallback if metadata didn't provide both volume AND title
    if (!(metadataHasVolume && metadataHasTitle)) {
      try {
        const decomp = await decomposeFilename(settings.lmstudio_url, settings.model, fileName);
        llmPrompt = decomp.prompt;
        llmRaw = decomp.raw;
        if (!metadataHasVolume && decomp.volume !== null) volume = decomp.volume;
        if (!metadataHasTitle && decomp.title) title = decomp.title;
        source = metadataHasVolume || metadataHasTitle ? "metadata" : "llm";
      } catch {
        // LLM unavailable — keep whatever we have
        if (!metadataHasVolume && !metadataHasTitle) source = "filename";
      }
    }

    setDropState({ filePath, fileName, fileExt: ext, volume, volumeEnd, title, source, llmPrompt, llmRaw });
    setDropBusy(false);
  };

  const handleDropReQueryLlm = async () => {
    if (!dropState) return;
    setDropBusy(true);
    try {
      const decomp = await decomposeFilename(settings.lmstudio_url, settings.model, dropState.fileName);
      setDropState((prev) =>
        prev
          ? {
              ...prev,
              volume: decomp.volume,
              title: decomp.title,
              source: "llm",
              llmPrompt: decomp.prompt,
              llmRaw: decomp.raw,
            }
          : null,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDropBusy(false);
    }
  };

  const resolveTargetDir = (): { dir: string; warning?: string } => {
    if (!selectedCluster) return { dir: "", warning: "No series selected" };
    const clusterEntries = entries.filter((e) => e.clusterId === selectedCluster);
    const dirs = new Set(clusterEntries.map((e) => e.dir));
    if (dirs.size === 1) return { dir: [...dirs][0] };
    if (dirs.size === 0) return { dir: "", warning: "Cannot determine target directory" };
    const counts = new Map<string, number>();
    for (const e of clusterEntries) counts.set(e.dir, (counts.get(e.dir) ?? 0) + 1);
    let bestDir = "";
    let bestCount = 0;
    for (const [d, c] of counts) {
      if (c > bestCount) {
        bestDir = d;
        bestCount = c;
      }
    }
    return { dir: bestDir, warning: `Files in ${dirs.size} different directories` };
  };

  const dropTargetInfo = useMemo(() => resolveTargetDir(), [selectedCluster, entries]);

  const dropProposedName = useMemo(() => {
    if (!dropState || !selectedClusterObj) return "";
    const cluster = selectedClusterObj;
    const author = libSettings.titleCase
      ? toTitleCase(cluster.canonicalAuthor)
      : cluster.canonicalAuthor;
    const series = libSettings.titleCase
      ? toTitleCase(cluster.canonicalSeries)
      : cluster.canonicalSeries;
    const clusterEntries = entries.filter((e) => e.clusterId === cluster.id);
    const existingMax = clusterEntries.reduce((m, e) => {
      const candidate = Math.max(e.volume ?? 0, e.volumeEnd ?? 0);
      return candidate > m ? candidate : m;
    }, 0);
    const maxVol = Math.max(existingMax, dropState.volume ?? 0, dropState.volumeEnd ?? 0);
    const meta = { author, series };
    const entry = {
      id: "",
      originalPath: dropState.filePath,
      originalName: dropState.fileName,
      extension: dropState.fileExt,
      selected: false,
      volume: dropState.volume,
      volumeEnd: dropState.volumeEnd,
      title: dropState.title,
      proposedName: "",
      status: "idle" as const,
    };
    return buildProposedName(meta, entry, maxVol, settings.include_title_in_name);
  }, [dropState, selectedClusterObj, entries, libSettings.titleCase, settings.include_title_in_name]);

  const handleDropConfirm = async () => {
    if (!dropState || !dropProposedName || !dropTargetInfo.dir) return;
    setDropBusy(true);
    setError(null);
    const targetPath = joinPath(dropTargetInfo.dir, dropProposedName);
    try {
      const results = await invoke<RenameResult[]>("rename_files", {
        pairs: [{ from: dropState.filePath, to: targetPath }],
      });
      const r = results[0];
      if (r.ok) {
        setDropState(null);
        await rescanPreservingCluster();
      } else {
        setError(r.error ?? "Failed to add to library");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDropBusy(false);
    }
  };

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
        setError("No supported files found.");
      } else {
        // Background: read EPUB OPF metadata so mismatch badges can light up.
        loadAndApplyEpubMeta().catch(() => {});
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
    const prevEntries = useStore.getState().libraryEntries;
    setScanning(true);
    try {
      const result = await analyzeLibrary(folder, recursive, libSettings);
      // Preserve previously-loaded EPUB metadata across rescans. Match by the
      // post-rename path (suggestion.proposedPath) first, then by the original
      // path. This keeps the metadata-mismatch badge stable after renames/moves
      // without re-reading every EPUB from disk.
      const metaByPath = new Map<string, EpubMeta | null>();
      for (const e of prevEntries) {
        if (e.epubMeta === undefined) continue;
        if (e.suggestion?.proposedPath) metaByPath.set(e.suggestion.proposedPath, e.epubMeta);
        metaByPath.set(e.originalPath, e.epubMeta);
      }
      const carried = result.entries.map((e) => {
        const m = metaByPath.get(e.originalPath);
        return m === undefined ? e : { ...e, epubMeta: m };
      });
      // Re-run analysis so mismatch badges reflect the carried-over metadata.
      const reanalyzed = reanalyze(carried, libSettings);
      setEntries(reanalyzed.entries);
      setClusters(reanalyzed.clusters);
      if (prev) {
        const match = reanalyzed.clusters.find(
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

    // Safety: for move-duplicate actions, never move ALL copies of a volume.
    // Track how many copies per volume exist and how many we've already moved,
    // and skip if moving would leave zero copies.
    const allClusterEntries = entries.filter((e) => e.clusterId === selectedCluster);
    const volumeCounts = new Map<string, number>();
    for (const e of allClusterEntries) {
      if (e.volume === null || e.status === "done") continue;
      const vk = `${e.volume}`;
      volumeCounts.set(vk, (volumeCounts.get(vk) ?? 0) + 1);
    }
    const movedPerVolume = new Map<string, number>();

    let anySuccess = false;
    for (const entry of targets) {
      if (!entry.suggestion) continue;

      if (entry.suggestion.action === "move-duplicate" && entry.volume !== null) {
        const vk = `${entry.volume}`;
        const total = volumeCounts.get(vk) ?? 1;
        const moved = movedPerVolume.get(vk) ?? 0;
        if (total - moved <= 1) {
          updateEntry(entry.id, {
            status: "error",
            error: "Skipped — last copy of this volume",
          });
          continue;
        }
        movedPerVolume.set(vk, moved + 1);
      }

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

  const writeMetadataInCluster = async () => {
    if (!selectedCluster) return;
    const cluster = clusters.find((c) => c.id === selectedCluster);
    if (!cluster) return;
    const epubEntries = entries.filter(
      (e) => e.clusterId === selectedCluster && e.extension.toLowerCase() === ".epub",
    );
    if (epubEntries.length === 0) return;

    setBusy(true);
    setError(null);

    const expectedAuthor = libSettings.titleCase
      ? toTitleCase(cluster.canonicalAuthor)
      : cluster.canonicalAuthor;
    const expectedSeries = libSettings.titleCase
      ? toTitleCase(cluster.canonicalSeries)
      : cluster.canonicalSeries;

    const patches = new Map<string, Partial<LibraryEntry>>();
    for (const entry of epubEntries) {
      // Skip omnibus volumes for series_index — but still write title/author/series.
      const isOmnibus = entry.volumeEnd !== null && entry.volumeEnd > (entry.volume ?? 0);
      const patch = {
        title: entry.title ?? null,
        author: expectedAuthor || null,
        series: expectedSeries || null,
        series_index: !isOmnibus && entry.volume !== null ? entry.volume : null,
      };
      try {
        await invoke("write_epub_metadata", { path: entry.originalPath, patch });
        patches.set(entry.id, {
          epubMeta: {
            title: patch.title,
            author: patch.author,
            author_file_as: patch.author,
            series: patch.series,
            series_index: patch.series_index,
            isbn: entry.epubMeta?.isbn ?? null,
          },
          status: "idle",
          error: undefined,
        });
      } catch (e) {
        updateEntry(entry.id, {
          status: "error",
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    if (patches.size > 0) {
      updateEntries(patches);
      runReanalyze();
    }
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
        updateEntry(entry.id, { status: "error", error: r.error ?? "Delete failed" });
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

  const issueCount = entries.reduce(
    (n, e) =>
      n +
      e.issues.filter(
        (i) =>
          i.kind !== "volume-gap" &&
          i.kind !== "range-or-omnibus" &&
          i.kind !== "metadata-mismatch",
      ).length,
    0,
  );
  const clusterCount = clusters.length;

  return (
    <div className={`flex flex-col flex-1 overflow-hidden ${dropHover && selectedCluster ? "ring-2 ring-blue-500 ring-inset" : ""}`}>
      {/* Toolbar */}
      <div className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-4 py-3 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[16rem]">
          <label className="block text-xs uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">
            Source folder
          </label>
          <div className="flex items-center gap-2">
            <span
              className="flex-1 truncate text-sm text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded px-2 py-1.5"
              title={folder ?? "—"}
            >
              {folder ?? "(no folder selected)"}
            </span>
            <button
              className="px-2 py-1.5 rounded bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-xs"
              onClick={pickFolder}
            >
              Choose folder…
            </button>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm pb-2">
          <input
            type="checkbox"
            checked={recursive}
            onChange={(e) => setRecursive(e.target.checked)}
          />
          Recursive
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
          Title case
        </label>
        {scanning ? (
          <button
            className="px-4 py-2 rounded-md bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium"
            onClick={() => abortRef.current?.abort()}
          >
            Cancel
          </button>
        ) : (
          <button
            className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed text-white text-sm font-medium"
            onClick={startScan}
            disabled={!folder}
          >
            Scan & Analyze
          </button>
        )}
        {entries.length > 0 && (
          <span className="text-xs text-slate-500 pb-2 self-end">
            {entries.length} files, {clusterCount} clusters, {issueCount} issues
            {metaProgress
              ? ` · Reading EPUB metadata ${metaProgress.done}/${metaProgress.total}`
              : ""}
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
              Gaps
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
              onWriteMetadata={writeMetadataInCluster}
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

      <DropConfirmDialog
        open={dropState !== null}
        filePath={dropState?.filePath ?? ""}
        fileName={dropState?.fileName ?? ""}
        volume={dropState?.volume ?? null}
        volumeEnd={dropState?.volumeEnd ?? null}
        title={dropState?.title ?? null}
        source={dropState?.source ?? "filename"}
        proposedName={dropProposedName}
        targetDir={dropTargetInfo.dir}
        dirWarning={dropTargetInfo.warning}
        llmPrompt={dropState?.llmPrompt}
        llmRaw={dropState?.llmRaw}
        busy={dropBusy}
        onVolumeChange={(v) => setDropState((s) => (s ? { ...s, volume: v } : null))}
        onVolumeEndChange={(v) => setDropState((s) => (s ? { ...s, volumeEnd: v } : null))}
        onTitleChange={(t) => setDropState((s) => (s ? { ...s, title: t } : null))}
        onReQueryLlm={handleDropReQueryLlm}
        onConfirm={handleDropConfirm}
        onCancel={() => setDropState(null)}
      />
    </div>
  );
}
