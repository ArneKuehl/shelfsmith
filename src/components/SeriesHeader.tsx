import { useStore } from "../lib/store";

export function SeriesHeader() {
  const meta = useStore((s) => s.meta);
  const setMeta = useStore((s) => s.setMeta);
  const entries = useStore((s) => s.entries);

  if (entries.length === 0) return null;

  return (
    <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 flex flex-wrap gap-3">
      <div className="flex-1 min-w-[240px]">
        <label className="block text-xs uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">
          Author (Last name, First name)
        </label>
        <input
          className="hdr-input"
          placeholder="e.g. Sanderson, Brandon"
          value={meta.author}
          onChange={(e) => setMeta({ author: e.target.value })}
        />
      </div>
      <div className="flex-1 min-w-[240px]">
        <label className="block text-xs uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">
          Serie
        </label>
        <input
          className="hdr-input"
          placeholder="e.g. Stormlight Archive"
          value={meta.series}
          onChange={(e) => setMeta({ series: e.target.value })}
        />
      </div>
      <style>{`
        .hdr-input { width: 100%; background: rgb(255 255 255); border: 1px solid rgb(203 213 225);
          border-radius: 6px; padding: 8px 12px; font-size: 14px; color: rgb(15 23 42); }
        .dark .hdr-input { background: rgb(15 23 42); border-color: rgb(51 65 85); color: rgb(226 232 240); }
        .hdr-input:focus { outline: none; border-color: rgb(59 130 246); }
      `}</style>
    </div>
  );
}
