import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { FilenameDecomposition, LLMResponse } from "../types";

export type DecomposeResult = FilenameDecomposition & { prompt: string; raw: string };

const SYSTEM_PROMPT = `You are an expert in book series metadata.
You analyze filenames and extract structured information.
Respond EXCLUSIVELY with a valid JSON object following the provided schema.`;

const SCHEMA = {
  type: "object",
  properties: {
    author: { type: "string", description: "Author in the format 'Last name First name'" },
    series: { type: "string", description: "Name of the book series" },
    files: {
      type: "array",
      items: {
        type: "object",
        properties: {
          originalName: { type: "string" },
          volume: { anyOf: [{ type: "number" }, { type: "null" }] },
          volumeEnd: { anyOf: [{ type: "number" }, { type: "null" }] },
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
  return `The following files belong to the same book series.
Analyze the names IN CONTEXT and extract:
- "author": Author in the format "Last name First name"
- "series": Name of the book series (consistent across all files)
- per file:
  - "volume": Volume number as a number (integer or decimal like 0, 0.5, 8.5), null if not recognizable.
    For collections/omnibus (e.g. "Volumes 1-3") use the start number (1).
    Prequels/backstories (e.g. "Volume 0") as 0; in-between volumes (e.g. "Volume 8.5") as decimal.
  - "volumeEnd": for collections the end number (e.g. 3); for single volumes null.
  - "title": Individual title, null if not recognizable.

File list:
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
      `LM Studio not reachable at ${baseUrl}. Is the server running?`,
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
    throw new LMStudioError("Unexpected LM Studio response (no content).");
  }
  const cleaned = stripFences(content);
  let parsed: LLMResponse;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new LMStudioError(`Response is not valid JSON: ${cleaned.slice(0, 200)}`, e);
  }
  if (!parsed?.files || !Array.isArray(parsed.files)) {
    throw new LMStudioError("Response contains no 'files' array.");
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
    volume: { anyOf: [{ type: "number" }, { type: "null" }] },
  },
  required: ["author", "series", "title", "volume"],
  additionalProperties: false,
};

const DECOMPOSE_SYSTEM = `You are an expert in book series metadata.
You analyze a single filename and extract author, series, volume number, and individual title.
If a value cannot be determined, return null. Respond EXCLUSIVELY as JSON following the schema.`;

/**
 * Asks the local LLM to decompose a single filename into author/series/title/volume.
 * Returns nulls for fields that cannot be determined.
 */
export async function decomposeFilename(
  baseUrl: string,
  model: string,
  filename: string,
  signal?: AbortSignal,
): Promise<DecomposeResult> {
  const url = baseUrl.replace(/\/$/, "") + "/v1/chat/completions";
  const userPrompt = `Decompose the following filename:
"${filename}"

Return:
- "author": Author in the format "Last name First name" (or null)
- "series": Name of the book series (or null)
- "title": Individual title of the volume (or null)
- "volume": Volume number as a number, including 0 (prequel) or decimals like 0.5 / 8.5 for in-between volumes (or null)`;
  let res: Response;
  try {
    res = await tauriFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        model,
        temperature: 0.3,
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
    throw new LMStudioError(`LM Studio not reachable at ${baseUrl}.`, e);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new LMStudioError(`LM Studio HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new LMStudioError("Unexpected LM Studio response (no content).");
  }
  const cleaned = stripFences(content);
  let parsed: FilenameDecomposition;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new LMStudioError(`Response is not valid JSON: ${cleaned.slice(0, 200)}`, e);
  }
  return {
    author: typeof parsed.author === "string" && parsed.author.trim() ? parsed.author.trim() : null,
    series: typeof parsed.series === "string" && parsed.series.trim() ? parsed.series.trim() : null,
    title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : null,
    volume:
      typeof parsed.volume === "number" && Number.isFinite(parsed.volume) ? parsed.volume : null,
    prompt: userPrompt,
    raw: content,
  };
}

export type CheckResult = {
  ok: boolean;
  url: string;
  status?: number;
  statusText?: string;
  error?: string;
  durationMs: number;
};

/**
 * Detailed health check — returns status code or error reason so the UI can
 * surface why a probe failed.
 */
export async function checkAvailableDetailed(
  baseUrl: string,
  timeoutMs = 5000,
): Promise<CheckResult> {
  const url = baseUrl.replace(/\/$/, "") + "/v1/models";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await tauriFetch(url, { method: "GET", signal: ctrl.signal });
    return {
      ok: res.ok,
      url,
      status: res.status,
      statusText: res.statusText,
      durationMs: Date.now() - start,
    };
  } catch (e) {
    const aborted = ctrl.signal.aborted;
    return {
      ok: false,
      url,
      error: aborted
        ? `Timeout after ${timeoutMs} ms`
        : e instanceof Error
          ? `${e.name}: ${e.message}`
          : String(e),
      durationMs: Date.now() - start,
    };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Quick health check — does the LM Studio server respond? Uses /v1/models with a
 * short timeout so we don't block the bulk pipeline when nothing's running.
 */
export async function checkAvailable(baseUrl: string, timeoutMs = 5000): Promise<boolean> {
  const r = await checkAvailableDetailed(baseUrl, timeoutMs);
  return r.ok;
}
