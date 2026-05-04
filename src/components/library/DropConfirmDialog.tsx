import { useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { LlmInfoPopup } from "../LlmInfoPopup";

export type DropSource = "metadata" | "llm" | "filename";

export type DropConfirmDialogProps = {
  open: boolean;
  filePath: string;
  fileName: string;
  volume: number | null;
  volumeEnd: number | null;
  title: string | null;
  source: DropSource;
  proposedName: string;
  targetDir: string;
  dirWarning?: string;
  llmPrompt?: string;
  llmRaw?: string;
  busy: boolean;
  onVolumeChange: (v: number | null) => void;
  onVolumeEndChange: (v: number | null) => void;
  onTitleChange: (t: string | null) => void;
  onReQueryLlm: () => void;
  onConfirm: () => void;
  onCancel: () => void;
};

const SOURCE_LABELS: Record<DropSource, string> = {
  metadata: "EPUB-Meta",
  llm: "LLM",
  filename: "Filename",
};

const SOURCE_COLORS: Record<DropSource, string> = {
  metadata: "bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200",
  llm: "bg-violet-100 dark:bg-violet-900/60 text-violet-800 dark:text-violet-200",
  filename: "bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300",
};

export function DropConfirmDialog({
  open,
  filePath,
  fileName,
  volume,
  volumeEnd,
  title,
  source,
  proposedName,
  targetDir,
  dirWarning,
  llmPrompt,
  llmRaw,
  busy,
  onVolumeChange,
  onVolumeEndChange,
  onTitleChange,
  onReQueryLlm,
  onConfirm,
  onCancel,
}: DropConfirmDialogProps) {
  const [showLlmInfo, setShowLlmInfo] = useState(false);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 flex items-center justify-center bg-black/40"
        onClick={onCancel}
      >
        <div
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl w-[520px] max-w-[95vw] flex flex-col"
          onClick={(ev) => ev.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Add file to library
            </span>
            <button
              type="button"
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg leading-none"
              onClick={onCancel}
            >
              ✕
            </button>
          </div>

          <div className="p-4 space-y-4">
            {/* Original file name */}
            <div>
              <label className="block text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1 font-medium">
                Original file
              </label>
              <button
                type="button"
                className="text-sm text-left truncate block w-full hover:underline cursor-pointer text-blue-600 dark:text-blue-400"
                title={filePath}
                onClick={() => openPath(filePath).catch(() => {})}
              >
                {fileName}
              </button>
            </div>

            {/* Source badge + LLM info icon */}
            <div className="flex items-center gap-2">
              <label className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 font-medium">
                Source
              </label>
              <button
                type="button"
                className={`px-1.5 py-0.5 rounded text-xs cursor-pointer hover:opacity-75 active:scale-95 transition-opacity ${SOURCE_COLORS[source]}`}
                title="Click to re-query LLM"
                onClick={onReQueryLlm}
                disabled={busy}
              >
                {SOURCE_LABELS[source]}
              </button>
              {llmPrompt != null && (
                <button
                  type="button"
                  className="w-5 h-5 flex items-center justify-center rounded-full text-slate-400 hover:text-violet-600 dark:hover:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/40 transition-colors flex-shrink-0"
                  title="Show LLM prompt and response"
                  onClick={() => setShowLlmInfo(true)}
                >
                  <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                    <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 1.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11ZM8 5a.75.75 0 1 1 0-1.5A.75.75 0 0 1 8 5Zm-.75 2h1.5v4.5h-1.5V7Z" />
                  </svg>
                </button>
              )}
              {busy && (
                <span className="text-amber-600 dark:text-amber-400 text-xs">Querying…</span>
              )}
            </div>

            {/* Editable fields */}
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 items-center">
              <label className="text-xs text-slate-500 dark:text-slate-400 font-medium text-right">
                Volume
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="any"
                  className="w-20 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded px-2 py-1 outline-none focus:border-blue-400 dark:focus:border-blue-600"
                  value={volume ?? ""}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    onVolumeChange(v === "" ? null : Number(v));
                  }}
                />
                <span className="text-xs text-slate-400">to</span>
                <input
                  type="number"
                  step="any"
                  className="w-20 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded px-2 py-1 outline-none focus:border-blue-400 dark:focus:border-blue-600"
                  value={volumeEnd ?? ""}
                  placeholder="—"
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    onVolumeEndChange(v === "" ? null : Number(v));
                  }}
                />
              </div>

              <label className="text-xs text-slate-500 dark:text-slate-400 font-medium text-right">
                Title
              </label>
              <input
                type="text"
                className="text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded px-2 py-1 outline-none focus:border-blue-400 dark:focus:border-blue-600"
                value={title ?? ""}
                onChange={(e) => onTitleChange(e.target.value || null)}
              />
            </div>

            {/* Preview */}
            <div>
              <label className="block text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1 font-medium">
                New filename
              </label>
              <div className="font-mono text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-3 py-2 break-all text-slate-700 dark:text-slate-300">
                {proposedName}
              </div>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1 font-medium">
                Target directory
              </label>
              <div className="text-xs text-slate-600 dark:text-slate-400 truncate" title={targetDir}>
                {targetDir}
              </div>
              {dirWarning && (
                <div className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                  ⚠ {dirWarning}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={onCancel}
                className="px-4 py-2 rounded-md bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                disabled={busy}
                className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed text-white text-sm font-medium"
              >
                Add to library
              </button>
            </div>
          </div>
        </div>
      </div>

      {showLlmInfo && llmPrompt != null && llmRaw != null && (
        <LlmInfoPopup prompt={llmPrompt} raw={llmRaw} onClose={() => setShowLlmInfo(false)} />
      )}
    </>
  );
}
