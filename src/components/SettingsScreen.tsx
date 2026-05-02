import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useStore } from "../lib/store";
import { saveSettings } from "../lib/persist";
import { checkAvailableDetailed } from "../lib/lmstudio";
import { appendConnectionLog, getConnectionLogPath } from "../lib/log";
import { openPath } from "@tauri-apps/plugin-opener";
import type { Settings } from "../types";

export function SettingsScreen({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const recompute = useStore((s) => s.recomputeNames);
  const recomputeBulk = useStore((s) => s.recomputeAllBulkNames);
  const libSettings = useStore((s) => s.librarySettings);
  const setLibSettings = useStore((s) => s.setLibrarySettings);

  const [llmStatus, setLlmStatus] = useState<"unknown" | "checking" | "ok" | "fail">("unknown");
  const [llmDetail, setLlmDetail] = useState<string>("");
  const [logPath, setLogPath] = useState<string | null>(null);

  useEffect(() => {
    getConnectionLogPath().then(setLogPath);
  }, []);

  const update = (patch: Partial<Settings>) => {
    setSettings(patch);
    saveSettings({ ...settings, ...patch }).catch(() => {});
    recompute();
    recomputeBulk();
  };

  const probe = async () => {
    setLlmStatus("checking");
    setLlmDetail("");
    const r = await checkAvailableDetailed(settings.lmstudio_url);
    const detail = r.ok
      ? `${r.status} ${r.statusText ?? ""} (${r.durationMs} ms)`.trim()
      : r.error
        ? `${r.error} (${r.durationMs} ms)`
        : `HTTP ${r.status ?? "?"} ${r.statusText ?? ""} (${r.durationMs} ms)`.trim();
    setLlmStatus(r.ok ? "ok" : "fail");
    setLlmDetail(detail);
    const path = await appendConnectionLog(
      `probe url=${r.url} ok=${r.ok} ${detail.replace(/\s+/g, " ")}`,
    );
    if (path) setLogPath(path);
  };

  const openLog = async () => {
    if (!logPath) return;
    try {
      await openPath(logPath);
    } catch (e) {
      console.warn("open log failed", e);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center overflow-auto p-6"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl w-full max-w-2xl shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-lg font-semibold">Einstellungen</h2>
          <button
            className="px-2 py-1 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={onClose}
            aria-label="Schließen"
          >
            ✕
          </button>
        </div>
        <div className="px-5 py-4 space-y-6">
          <Section title="LM Studio">
            <Row label="Server-URL">
              <input
                className="ss-input"
                value={settings.lmstudio_url}
                onChange={(e) => update({ lmstudio_url: e.target.value })}
                placeholder="http://localhost:1234"
              />
            </Row>
            <Row label="Modell">
              <input
                className="ss-input"
                value={settings.model}
                onChange={(e) => update({ model: e.target.value })}
                placeholder="meta-llama-3.1-8b-instruct"
              />
            </Row>
            <div className="flex items-center gap-3 mt-1">
              <button
                onClick={probe}
                className="px-3 py-1.5 rounded bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-xs"
              >
                Verbindung testen
              </button>
              {llmStatus === "checking" && <span className="text-xs text-slate-500">Prüfe…</span>}
              {llmStatus === "ok" && (
                <span className="text-xs text-emerald-700 dark:text-emerald-300">
                  Erreichbar
                </span>
              )}
              {llmStatus === "fail" && (
                <span className="text-xs text-rose-700 dark:text-rose-300">
                  Nicht erreichbar
                </span>
              )}
              {llmStatus === "ok" && llmDetail && (
                <span className="text-xs text-slate-500 dark:text-slate-400">{llmDetail}</span>
              )}
            </div>
            {llmStatus === "fail" && llmDetail && (
              <div className="text-xs text-rose-700 dark:text-rose-300 break-all">
                {llmDetail}
              </div>
            )}
            {logPath && (
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="truncate" title={logPath}>
                  Log: {logPath}
                </span>
                <button
                  onClick={openLog}
                  className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700"
                >
                  Öffnen
                </button>
              </div>
            )}
          </Section>

          <Section title="Serien-Modus">
            <Toggle
              checked={settings.include_title_in_name}
              onChange={(v) => update({ include_title_in_name: v })}
              label="Titel im Dateinamen"
              hint="„Sanderson, Brandon - Stormlight Archive (02) - Words of Radiance.epub"
            />
            <Toggle
              checked={settings.move_after_rename}
              onChange={async (v) => {
                if (v && !settings.move_target_dir) {
                  const dir = await open({ directory: true, multiple: false });
                  if (typeof dir === "string") {
                    update({ move_after_rename: true, move_target_dir: dir });
                    return;
                  }
                  return;
                }
                update({ move_after_rename: v });
              }}
              label="Nach Umbenennen verschieben"
            />
            {settings.move_after_rename && (
              <DirField
                label="Ziel-Ordner"
                value={settings.move_target_dir}
                onPick={async () => {
                  const dir = await open({ directory: true, multiple: false });
                  if (typeof dir === "string") update({ move_target_dir: dir });
                }}
                onClear={() => update({ move_target_dir: null })}
              />
            )}
          </Section>

          <Section title="Bibliothek-Modus">
            <Toggle
              checked={settings.bulk_recursive_default}
              onChange={(v) => update({ bulk_recursive_default: v })}
              label="Standardmäßig rekursiv scannen"
            />
            <Toggle
              checked={settings.bulk_llm_fallback}
              onChange={(v) => update({ bulk_llm_fallback: v })}
              label="Lokales LLM als Fallback nutzen"
              hint="Wenn eingebettete Metadaten fehlen, zerlegt das LLM den Dateinamen, bevor die Web-Abfrage läuft. Wird übersprungen, falls das LLM nicht erreichbar ist."
            />
            <DirField
              label="Standard-Ziel-Ordner (optional)"
              value={settings.bulk_target_dir}
              onPick={async () => {
                const dir = await open({ directory: true, multiple: false });
                if (typeof dir === "string") update({ bulk_target_dir: dir });
              }}
              onClear={() => update({ bulk_target_dir: null })}
            />
          </Section>

          <Section title="Aufräumen-Modus">
            <Toggle
              checked={libSettings.titleCase}
              onChange={(v) => setLibSettings({ titleCase: v })}
              label="Title-Case-Normalisierung"
              hint="Erzwingt Großschreibung am Wortanfang bei Autoren- und Seriennamen"
            />
            <Row label="Fuzzy-Schwelle (Clustering)">
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0.7"
                  max="0.98"
                  step="0.01"
                  value={libSettings.fuzzThreshold}
                  onChange={(e) =>
                    setLibSettings({ fuzzThreshold: Number.parseFloat(e.target.value) })
                  }
                  className="flex-1"
                />
                <span className="text-xs text-slate-600 dark:text-slate-400 w-10 text-right">
                  {libSettings.fuzzThreshold.toFixed(2)}
                </span>
              </div>
              <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Höher = strenger (weniger Matches), niedriger = toleranter (mehr Matches)
              </span>
            </Row>
          </Section>

          <Section title="Darstellung">
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-700 dark:text-slate-300">Theme</span>
              <div className="inline-flex rounded overflow-hidden border border-slate-300 dark:border-slate-700">
                {(["light", "dark"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => update({ theme: t })}
                    className={`px-3 py-1.5 text-xs ${
                      settings.theme === t
                        ? "bg-blue-600 text-white"
                        : "bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700"
                    }`}
                  >
                    {t === "light" ? "Light" : "Dark"}
                  </button>
                ))}
              </div>
            </div>
          </Section>
        </div>
      </div>
      <style>{css}</style>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-xs uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-2">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-slate-600 dark:text-slate-400 mb-1">{label}</span>
      {children}
    </label>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex items-start gap-2 text-sm cursor-pointer">
      <input
        type="checkbox"
        className="mt-0.5"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span>{label}</span>
        {hint && (
          <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">{hint}</span>
        )}
      </span>
    </label>
  );
}

function DirField({
  label,
  value,
  onPick,
  onClear,
}: {
  label: string;
  value: string | null;
  onPick: () => void;
  onClear: () => void;
}) {
  return (
    <div>
      <span className="block text-xs text-slate-600 dark:text-slate-400 mb-1">{label}</span>
      <div className="flex items-center gap-2">
        <span
          className="flex-1 truncate text-sm text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded px-2 py-1.5"
          title={value ?? "—"}
        >
          {value ?? "(nicht gesetzt)"}
        </span>
        <button
          className="px-2 py-1.5 rounded bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-xs"
          onClick={onPick}
        >
          Wählen…
        </button>
        {value && (
          <button
            className="px-2 py-1.5 rounded bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-xs"
            onClick={onClear}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

const css = `
  .ss-input { width: 100%; background: rgb(255 255 255); border: 1px solid rgb(203 213 225);
    border-radius: 6px; padding: 6px 10px; font-size: 13px; color: rgb(15 23 42); }
  .dark .ss-input { background: rgb(15 23 42); border-color: rgb(51 65 85); color: rgb(226 232 240); }
  .ss-input:focus { outline: none; border-color: rgb(59 130 246); }
`;
