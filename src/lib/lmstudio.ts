import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { LLMResponse } from "../types";

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
