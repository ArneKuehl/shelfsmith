import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { PEN_NAMES } from "../rules";
import { findSimilar } from "../history";
import type { LlmProvider, LlmResult, RenameRecord } from "../types";

const SCHEMA = {
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

function buildSystemPrompt(): string {
  const penList = [...PEN_NAMES].sort().join(", ");
  return `You are an expert in book metadata. You analyze ebook filenames and extract structured information.

Known single-word pen names (do NOT split these into first/last): ${penList}

Rules:
- "author": Full author name as "Lastname, Firstname" (or just the pen name if single-word). Return null if unknown.
- "series": Name of the book series (without volume numbers). Return null if unknown.
- "title": Individual book title (without series name or volume). Return null if not distinct from series.
- "volume": Volume number as a number (integer or decimal like 0.5). Return null if unknown.

Respond EXCLUSIVELY with valid JSON following the provided schema.`;
}

function buildUserPrompt(
  filename: string,
  examples?: Array<{ dirty: string; clean: string }>,
): string {
  let prompt = "";
  if (examples && examples.length > 0) {
    prompt += "Here are some similar filenames and their correct clean versions:\n";
    for (const ex of examples) {
      prompt += `  "${ex.dirty}" → "${ex.clean}"\n`;
    }
    prompt += "\nNow analyze:\n";
  }
  prompt += `Decompose this filename: "${filename}"`;
  return prompt;
}

function stripFences(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

export class LMStudioLlmProvider implements LlmProvider {
  constructor(
    private baseUrl: string,
    private model: string,
    private historyPool: RenameRecord[] = [],
  ) {}

  async decompose(
    filename: string,
    examples?: Array<{ dirty: string; clean: string }>,
  ): Promise<LlmResult> {
    const fewShot = examples ?? this.selectExamples(filename);
    const url = this.baseUrl.replace(/\/$/, "") + "/v1/chat/completions";
    const res = await tauriFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.1,
        messages: [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: buildUserPrompt(filename, fewShot) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "filename_decomp", strict: true, schema: SCHEMA },
        },
      }),
    });

    if (!res.ok) {
      throw new Error(`LLM HTTP ${res.status}`);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("LLM returned no content");
    }

    const parsed = JSON.parse(stripFences(content));
    return {
      author: str(parsed.author),
      series: str(parsed.series),
      title: str(parsed.title),
      volume: typeof parsed.volume === "number" && Number.isFinite(parsed.volume)
        ? parsed.volume
        : null,
    };
  }

  private selectExamples(filename: string): Array<{ dirty: string; clean: string }> {
    if (this.historyPool.length === 0) return [];
    return findSimilar(filename, this.historyPool, 5).map((r) => ({
      dirty: r.dirty,
      clean: r.clean,
    }));
  }
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
