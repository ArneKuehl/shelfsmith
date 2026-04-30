import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { useStore } from "../lib/store";

export function DropZone() {
  const addPaths = useStore((s) => s.addPaths);
  const entries = useStore((s) => s.entries);
  const clearAll = useStore((s) => s.clearAll);
  const [hover, setHover] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const p = event.payload;
        if (p.type === "over" || p.type === "enter") setHover(true);
        else if (p.type === "leave") setHover(false);
        else if (p.type === "drop") {
          setHover(false);
          addPaths(p.paths);
        }
      })
      .then((u) => (unlisten = u));
    return () => unlisten?.();
  }, [addPaths]);

  const pickFiles = async () => {
    const result = await open({
      multiple: true,
      filters: [{ name: "Ebooks", extensions: ["epub", "pdf", "mobi", "azw3"] }],
    });
    if (Array.isArray(result)) addPaths(result);
    else if (typeof result === "string") addPaths([result]);
  };

  if (entries.length > 0) {
    return (
      <div className="px-4 py-2 text-xs text-slate-400 border-b border-slate-800 flex items-center justify-between gap-2">
        <span>{entries.length} Datei(en) geladen — weiter Dateien droppen oder hinzufügen</span>
        <div className="flex items-center gap-2">
          <button className="btn-ghost" onClick={pickFiles}>+ Dateien hinzufügen</button>
          <button
            className="btn-clear"
            onClick={() => {
              if (confirm("Liste leeren? Alle geladenen Dateien werden entfernt.")) clearAll();
            }}
          >
            Liste leeren
          </button>
        </div>
        <style>{btnCss}</style>
      </div>
    );
  }

  return (
    <div
      className={`m-6 flex-1 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed transition-colors ${
        hover ? "border-blue-500 bg-blue-500/10" : "border-slate-700 bg-slate-900/50"
      }`}
    >
      <div className="text-2xl font-semibold mb-2">Dateien hierher ziehen</div>
      <div className="text-sm text-slate-400 mb-6">
        Unterstützt: .epub, .pdf, .mobi, .azw3
      </div>
      <button className="btn-primary" onClick={pickFiles}>Dateien auswählen…</button>
      <style>{btnCss}</style>
    </div>
  );
}

const btnCss = `
  .btn-primary { background: rgb(37 99 235); color: white; border-radius: 8px;
    padding: 8px 16px; font-size: 14px; font-weight: 500; }
  .btn-primary:hover { background: rgb(29 78 216); }
  .btn-ghost { color: rgb(148 163 184); padding: 4px 8px; border-radius: 6px; }
  .btn-ghost:hover { color: white; background: rgb(30 41 59); }
  .btn-clear { color: rgb(252 165 165); padding: 4px 10px; border-radius: 6px;
    border: 1px solid rgb(127 29 29); }
  .btn-clear:hover { color: white; background: rgb(127 29 29); }
`;
