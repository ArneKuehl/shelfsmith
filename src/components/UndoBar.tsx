import { useStore } from "../lib/store";
import { invoke } from "@tauri-apps/api/core";
import { saveUndo } from "../lib/persist";
import type { RenameResult, UndoEntry } from "../types";

export function UndoBar() {
  const undo = useStore((s) => s.undo);
  const setUndo = useStore((s) => s.setUndo);
  const setError = useStore((s) => s.setError);
  const setRenaming = useStore((s) => s.setRenaming);

  if (!undo) return null;

  const time = new Date(undo.timestamp).toLocaleTimeString();

  const doUndo = async () => {
    setRenaming(true);
    setError(null);
    try {
      const reversed: UndoEntry["pairs"] = undo.pairs.map((p) => ({ from: p.to, to: p.from }));
      const results = await invoke<RenameResult[]>("rename_files", { pairs: reversed });
      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) {
        setError(`${failed.length} Undo-Operation(en) fehlgeschlagen.`);
      } else {
        setUndo(null);
        await saveUndo(null);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setRenaming(false);
    }
  };

  return (
    <div className="px-4 py-2 border-t border-slate-800 bg-amber-950/40 flex items-center justify-between text-sm">
      <span>Letzte Umbenennung um {time} ({undo.pairs.length} Datei(en))</span>
      <button
        className="px-3 py-1 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-sm"
        onClick={doUndo}
      >
        Rückgängig
      </button>
    </div>
  );
}
