import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { FilenameDecomposition, LLMResponse } from "../types";

const SYSTEM_PROMPT = `Du bist ein Experte für Buchserien-Metadaten.
Du analysierst Dateinamen und extrahierst strukturierte Informationen.
Antworte AUSSCHLIESSLICH mit einem validen JSON-Objekt nach dem vorgegebenen Schema.`;

const SCHEMA = {
  type: "object",
  properties: {
    author: { type: "string", description: "Autor im Format 'Nachname Vorname'" },
    series: { type: "string", description: "Name der Buchreihe" },
    files: {
      type: "array",
      items: {
        type: "object",
        properties: {
          originalName: { type: "string" },
          volume: { anyOf: [{ type: "integer" }, { type: "null" }] },
          volumeEnd: { anyOf: [{ type: "integer" }, { type: "null" }] },
          title: { anyOf: [{ type: "string" }, { type: "null" }] },
        },
        required: ["originalName", "volume", "volumeEnd", "title"],
        additionalProperties: false,
      },
    },
  },
  required: ["author", "series", "files"],
  additionalProperties: false,
};

function buildUserPrompt(filenames: string[]): string {
  const list = filenames.map((n, i) => `${i + 1}. "${n}"`).join("\n");
  return `Die folgenden Dateien gehören zur selben Buchserie.
Analysiere die Namen IM ZUSAMMENHANG und extrahiere:
- "author": Autor im Format "Nachname Vorname"
- "series": Name der Buchreihe (einheitlich für alle Dateien)
- pro Datei:
  - "volume": Bandnummer als Integer, null wenn nicht erkennbar.
    Bei Sammelbänden/Omnibus (z.B. "Bände 1-3") die Startnummer (1).
  - "volumeEnd": bei Sammelbänden die Endnummer (z.B. 3); bei Einzelbänden null.
  - "title": Einzeltitel, null wenn nicht erkennbar.

Dateiliste:
${list}`;
}

export class LMStudioError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
  }
}

export async function analyze(
  baseUrl: string,
  model: string,
  filenames: string[],
  signal?: AbortSignal,
): Promise<LLMResponse> {
  const url = baseUrl.replace(/\/$/, "") + "/v1/chat/completions";
  let res: Response;
  try {
    res = await tauriFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        model,
        temperature: 0.1,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(filenames) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "book_series", strict: true, schema: SCHEMA },
        },
      }),
    });
  } catch (e) {
    throw new LMStudioError(
      `LM Studio nicht erreichbar unter ${baseUrl}. Läuft der Server?`,
      e,
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new LMStudioError(`LM Studio HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new LMStudioError("Unerwartete LM-Studio-Antwort (kein content).");
  }
  const cleaned = stripFences(content);
  let parsed: LLMResponse;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new LMStudioError(`Antwort ist kein valides JSON: ${cleaned.slice(0, 200)}`, e);
  }
  if (!parsed?.files || !Array.isArray(parsed.files)) {
    throw new LMStudioError("Antwort enthält kein 'files'-Array.");
  }
  return parsed;
}

function stripFences(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

const DECOMPOSE_SCHEMA = {
  type: "object",
  properties: {
    author: { anyOf: [{ type: "string" }, { type: "null" }] },
    series: { anyOf: [{ type: "string" }, { type: "null" }] },
    title: { anyOf: [{ type: "string" }, { type: "null" }] },
    volume: { anyOf: [{ type: "integer" }, { type: "null" }] },
  },
  required: ["author", "series", "title", "volume"],
  additionalProperties: false,
};

const DECOMPOSE_SYSTEM = `Du bist ein Experte für Buchserien-Metadaten.
Du analysierst einen einzelnen Dateinamen und extrahierst Autor, Serie, Bandnummer und Einzeltitel.
Wenn ein Wert nicht erkennbar ist, gib null zurück. Antworte AUSSCHLIESSLICH als JSON nach dem Schema.`;

/**
 * Asks the local LLM to decompose a single filename into author/series/title/volume.
 * Returns nulls for fields that cannot be determined.
 */
export async function decomposeFilename(
  baseUrl: string,
  model: string,
  filename: string,
  signal?: AbortSignal,
): Promise<FilenameDecomposition> {
  const url = baseUrl.replace(/\/$/, "") + "/v1/chat/completions";
  const userPrompt = `Zerlege den folgenden Dateinamen:
"${filename}"

Gib zurück:
- "author": Autor im Format "Nachname Vorname" (oder null)
- "series": Name der Buchreihe (oder null)
- "title": Einzeltitel des Bandes (oder null)
- "volume": Bandnummer als Integer (oder null)`;
  let res: Response;
  try {
    res = await tauriFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        model,
        temperature: 0.1,
        messages: [
          { role: "system", content: DECOMPOSE_SYSTEM },
          { role: "user", content: userPrompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "filename_decomp", strict: true, schema: DECOMPOSE_SCHEMA },
        },
      }),
    });
  } catch (e) {
    throw new LMStudioError(`LM Studio nicht erreichbar unter ${baseUrl}.`, e);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new LMStudioError(`LM Studio HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new LMStudioError("Unerwartete LM-Studio-Antwort (kein content).");
  }
  const cleaned = stripFences(content);
  let parsed: FilenameDecomposition;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new LMStudioError(`Antwort ist kein valides JSON: ${cleaned.slice(0, 200)}`, e);
  }
  return {
    author: typeof parsed.author === "string" && parsed.author.trim() ? parsed.author.trim() : null,
    series: typeof parsed.series === "string" && parsed.series.trim() ? parsed.series.trim() : null,
    title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : null,
    volume:
      typeof parsed.volume === "number" && Number.isFinite(parsed.volume) ? parsed.volume : null,
  };
}

/**
 * Quick health check — does the LM Studio server respond? Uses /v1/models with a
 * short timeout so we don't block the bulk pipeline when nothing's running.
 */
export async function checkAvailable(baseUrl: string, timeoutMs = 1500): Promise<boolean> {
  const url = baseUrl.replace(/\/$/, "") + "/v1/models";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await tauriFetch(url, { method: "GET", signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}
