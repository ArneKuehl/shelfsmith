export function ConfirmDialog({
  open,
  count,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl p-6 max-w-md">
        <h2 className="text-lg font-semibold mb-2">{count} Datei(en) umbenennen?</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
          Diese Aktion kann mit „Rückgängig" zurückgenommen werden, solange das Fenster geöffnet bleibt.
        </p>
        <div className="flex justify-end gap-2">
          <button className="px-4 py-2 text-sm rounded-md hover:bg-slate-200 dark:hover:bg-slate-800" onClick={onCancel}>
            Abbrechen
          </button>
          <button
            className="px-4 py-2 text-sm rounded-md bg-blue-600 hover:bg-blue-700 text-white"
            onClick={onConfirm}
          >
            Umbenennen
          </button>
        </div>
      </div>
    </div>
  );
}
