import { useStore } from "../lib/store";
import { saveSettings } from "../lib/persist";

export function SettingsBar() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const recompute = useStore((s) => s.recomputeNames);

  const update = (patch: Partial<typeof settings>) => {
    setSettings(patch);
    saveSettings({ ...settings, ...patch }).catch(() => {});
    recompute();
  };

  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-slate-800 bg-slate-900 px-4 py-3">
      <Field label="LM Studio URL" className="w-64">
        <input
          className="input"
          value={settings.lmstudio_url}
          onChange={(e) => update({ lmstudio_url: e.target.value })}
        />
      </Field>
      <Field label="Modell" className="w-72">
        <input
          className="input"
          value={settings.model}
          onChange={(e) => update({ model: e.target.value })}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm pb-2">
        <input
          type="checkbox"
          checked={settings.include_title_in_name}
          onChange={(e) => update({ include_title_in_name: e.target.checked })}
        />
        Titel im Dateinamen
      </label>
      <style>{`
        .input { width: 100%; background: rgb(15 23 42); border: 1px solid rgb(51 65 85);
          border-radius: 6px; padding: 6px 10px; font-size: 13px; color: rgb(226 232 240); }
        .input:focus { outline: none; border-color: rgb(59 130 246); }
      `}</style>
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
