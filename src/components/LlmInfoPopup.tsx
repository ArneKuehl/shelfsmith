export function LlmInfoPopup({ prompt, raw, onClose }: { prompt: string; raw: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl w-[680px] max-w-[95vw] max-h-[80vh] flex flex-col"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">LLM Details</span>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg leading-none"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className="overflow-auto p-4 space-y-4 flex-1">
          <section>
            <h3 className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5 font-medium">Prompt</h3>
            <pre className="font-mono text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded p-3 whitespace-pre-wrap break-words text-slate-700 dark:text-slate-300">{prompt}</pre>
          </section>
          <section>
            <h3 className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5 font-medium">LLM Response (raw)</h3>
            <pre className="font-mono text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded p-3 whitespace-pre-wrap break-words text-slate-700 dark:text-slate-300">{raw}</pre>
          </section>
        </div>
      </div>
    </div>
  );
}
