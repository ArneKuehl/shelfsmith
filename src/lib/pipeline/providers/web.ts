import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { WebProvider, WebResult } from "../types";

export class GoogleBooksWebProvider implements WebProvider {
  async lookup(query: string): Promise<WebResult> {
    const url = `https://www.googleapis.com/books/v1/volumes?maxResults=1&q=${encodeURIComponent(query)}`;
    const res = await tauriFetch(url, { method: "GET" });
    if (!res.ok) return empty();

    const data: any = await res.json();
    const item = data?.items?.[0]?.volumeInfo;
    if (!item) return empty();

    const title: string | null = typeof item.title === "string" ? item.title : null;
    const subtitle: string | null = typeof item.subtitle === "string" ? item.subtitle : null;
    const authors: string[] = Array.isArray(item.authors) ? item.authors : [];
    const author = authors[0] ?? null;
    const { series, seriesIndex, cleanTitle } = parseSeries(title, subtitle);

    return {
      author,
      title: cleanTitle ?? title,
      series,
      seriesIndex,
    };
  }
}

function parseSeries(
  title: string | null,
  subtitle: string | null,
): { series: string | null; seriesIndex: number | null; cleanTitle: string | null } {
  if (subtitle) {
    const m = subtitle.match(/^(.+?)\s+(?:Book|Vol(?:ume)?|Band|#)\s*(\d+(?:[.,]\d+)?)/i);
    if (m) return { series: m[1].trim(), seriesIndex: parseVol(m[2]), cleanTitle: title };
  }
  if (title) {
    const m1 = title.match(/^(.+?)\s*\((.+?)\s+(?:Book|Vol(?:ume)?|Band|#)\s*(\d+(?:[.,]\d+)?)\)\s*$/i);
    if (m1) return { series: m1[2].trim(), seriesIndex: parseVol(m1[3]), cleanTitle: m1[1].trim() };

    const m2 = title.match(/^(.+?)\s+(\d+(?:[.,]\d+)?):\s*(.+)$/);
    if (m2) return { series: m2[1].trim(), seriesIndex: parseVol(m2[2]), cleanTitle: m2[3].trim() };
  }
  return { series: null, seriesIndex: null, cleanTitle: title };
}

function parseVol(s: string): number {
  return Number.parseFloat(s.replace(",", "."));
}

function empty(): WebResult {
  return { author: null, title: null, series: null, seriesIndex: null };
}
