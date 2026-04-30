import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SettingsBar } from "./components/SettingsBar";
import { DropZone } from "./components/DropZone";
import { SeriesHeader } from "./components/SeriesHeader";
import { PreviewTable } from "./components/PreviewTable";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { UndoBar } from "./components/UndoBar";
import { useStore, targetPath } from "./lib/store";
import { analyze } from "./lib/lmstudio";
import { findCollisions } from "./lib/collisions";
import { loadSettings, loadUndo, saveUndo } from "./lib/persist";
import type { RenameResult } from "./types";

export default function App() {
  const {
    settings,
    setSettings,
    entries,
    meta,
    analyzing,
    setAnalyzing,
    renaming,
    setRenaming,
    error,
    setError,
    applyLLM,
    setEntryStatus,
    setUndo,
    setLastRenameDone,
  } = useStore();

  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    loadSettings().then((s) => Object.keys(s).length > 0 && setSettings(s));
    loadUndo().then((u) => u && setUndo(u));
  }, [setSettings, setUndo]);

  const selected = entries.filter((e) => e.selected);
  const collisions = findCollisions(entries, settings);
  const blocked =
    selected.length === 0 || collisions.size > 0 || !meta.author || !meta.series;

  const runAnalyze = async () => {
    if (entries.length === 0) return;
    setAnalyzing(true);
    setError(null);
    try {
      const data = await analyze(
        settings.lmstudio_url,
        settings.model,
        entries.map((e) => e.originalName),
      );
      applyLLM(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalyzing(false);
    }
  };

  const runRename = async () => {
    setConfirm(false);
    setRenaming(true);
    setError(null);
    const pairs = selected.map((e) => ({ from: e.originalPath, to: targetPath(e, settings) }));
    selected.forEach((e) => setEntryStatus(e.id, "renaming"));
    try {
      const results = await invoke<RenameResult[]>("rename_files", { pairs });
      const successful: { from: string; to: string }[] = [];
      for (const r of results) {
        const entry = selected.find((e) => e.originalPath === r.from);
        if (!entry) continue;
        if (r.ok) {
          setEntryStatus(entry.id, "done");
          successful.push({ from: r.from, to: r.to });
        } else {
          setEntryStatus(entry.id, "error", r.error);
        }
      }
      if (successful.length > 0) {
        const undo = { timestamp: Date.now(), pairs: successful };
        setUndo(undo);
        await saveUndo(undo);
        setLastRenameDone(true);
      }
    } catch (e) {
      setError(String(e));
      selected.forEach((e) => setEntryStatus(e.id, "error", String(e)));
    } finally {
      setRenaming(false);
    }
  };

  return (
    <div className="flex flex-col h-screen">
      <SettingsBar />
      <SeriesHeader />
      {entries.length > 0 ? (
        <>
          <DropZone />
          <ActionsBar
            count={selected.length}
            blocked={blocked}
            analyzing={analyzing}
            renaming={renaming}
            collisions={collisions.size}
            onAnalyze={runAnalyze}
            onRename={() => setConfirm(true)}
          />
          <PreviewTable />
        </>
      ) : (
        <DropZone />
      )}
      {error && (
        <div className="px-4 py-2 bg-rose-950/60 border-t border-rose-900 text-sm text-rose-200">
          {error}
        </div>
      )}
      <UndoBar />
      <ConfirmDialog
        open={confirm}
        count={selected.length}
        onConfirm={runRename}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
}

function ActionsBar({
  count,
  blocked,
  analyzing,
  renaming,
  collisions,
  onAnalyze,
  onRename,
}: {
  count: number;
  blocked: boolean;
  analyzing: boolean;
  renaming: boolean;
  collisions: number;
  onAnalyze: () => void;
  onRename: () => void;
}) {
  return (
    <div className="px-4 py-2 border-b border-slate-800 flex items-center gap-2">
      <button
        className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white text-sm font-medium"
        onClick={onAnalyze}
        disabled={analyzing || renaming}
      >
        {analyzing ? "Analysiere…" : "Analyse starten"}
      </button>
      <button
        className="px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white text-sm font-medium"
        onClick={onRename}
        disabled={blocked || renaming || analyzing}
        title={
          collisions > 0
            ? "Kollisionen vorhanden"
            : !count
              ? "Keine Dateien ausgewählt"
              : ""
        }
      >
        {renaming ? "Benenne um…" : `${count} Datei(en) umbenennen`}
      </button>
      {collisions > 0 && (
        <span className="text-xs text-rose-300">⚠ {collisions} Kollision(en)</span>
      )}
    </div>
  );
}
