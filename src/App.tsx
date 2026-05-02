import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DropZone } from "./components/DropZone";
import { SeriesHeader } from "./components/SeriesHeader";
import { PreviewTable } from "./components/PreviewTable";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { UndoBar } from "./components/UndoBar";
import { SettingsScreen } from "./components/SettingsScreen";
import { BulkTab } from "./components/bulk/BulkTab";
import { LibraryTab } from "./components/library/LibraryTab";
import { useStore, targetPath } from "./lib/store";
import { analyze } from "./lib/lmstudio";
import { findCollisions } from "./lib/collisions";
import { loadSettings, loadUndo, saveSettings, saveUndo } from "./lib/persist";
import type { Mode, RenameResult, Theme } from "./types";

export default function App() {
  const {
    mode,
    setMode,
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
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    loadSettings().then((s) => Object.keys(s).length > 0 && setSettings(s));
    loadUndo().then((u) => u && setUndo(u));
  }, [setSettings, setUndo]);

  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
  }, [settings.theme]);

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
      <Tabs
        mode={mode}
        onChange={setMode}
        theme={settings.theme}
        onToggleTheme={() => {
          const next: Theme = settings.theme === "dark" ? "light" : "dark";
          setSettings({ theme: next });
          saveSettings({ ...settings, theme: next }).catch(() => {});
        }}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      {settingsOpen && <SettingsScreen onClose={() => setSettingsOpen(false)} />}
      {mode === "series" ? (
        <>
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
            <div className="px-4 py-2 bg-rose-100 dark:bg-rose-950/60 border-t border-rose-300 dark:border-rose-900 text-sm text-rose-800 dark:text-rose-200">
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
        </>
      ) : mode === "bulk" ? (
        <BulkTab />
      ) : (
        <LibraryTab />
      )}
    </div>
  );
}

function Tabs({
  mode,
  onChange,
  theme,
  onToggleTheme,
  onOpenSettings,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
  theme: Theme;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
}) {
  const tab = (m: Mode, label: string) => (
    <button
      key={m}
      onClick={() => onChange(m)}
      className={`px-4 py-2 text-sm font-medium border-b-2 ${
        mode === m
          ? "border-blue-500 text-slate-900 dark:text-white"
          : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex items-center bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 px-4">
      {tab("series", "Serie")}
      {tab("bulk", "Bibliothek")}
      {tab("library", "Aufräumen")}
      <button
        onClick={onToggleTheme}
        className="ml-auto my-1 px-3 py-1.5 text-base leading-none rounded border border-slate-300 dark:border-slate-700 text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
        title={theme === "dark" ? "Light Mode" : "Dark Mode"}
        aria-label="Theme umschalten"
      >
        {theme === "dark" ? "☀︎" : "☾"}
      </button>
      <button
        onClick={onOpenSettings}
        className="my-1 ml-1 px-3 py-1.5 text-base leading-none rounded border border-slate-300 dark:border-slate-700 text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
        title="Einstellungen"
        aria-label="Einstellungen öffnen"
      >
        ⚙
      </button>
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
    <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
      <button
        className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed text-white text-sm font-medium"
        onClick={onAnalyze}
        disabled={analyzing || renaming}
      >
        {analyzing ? "Analysiere…" : "Analyse starten"}
      </button>
      <button
        className="px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed text-white text-sm font-medium"
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
        <span className="text-xs text-rose-700 dark:text-rose-300">⚠ {collisions} Kollision(en)</span>
      )}
    </div>
  );
}
