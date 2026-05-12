import { invoke } from "@tauri-apps/api/core";
import type { EpubMeta, PdfMeta } from "../../../types";
import type { MetadataProvider, MetadataResult } from "../types";

export class TauriMetadataProvider implements MetadataProvider {
  async extract(filePath: string): Promise<MetadataResult> {
    const ext = filePath.toLowerCase().split(".").pop() ?? "";

    if (ext === "epub") {
      try {
        const m = await invoke<EpubMeta>("read_epub_metadata", { path: filePath });
        return {
          author: m.author_file_as ?? m.author ?? null,
          title: m.title ?? null,
          series: m.series ?? null,
          seriesIndex: m.series_index ?? null,
          isbn: m.isbn ?? null,
        };
      } catch {
        return empty();
      }
    }

    if (ext === "pdf") {
      try {
        const m = await invoke<PdfMeta>("read_pdf_metadata", { path: filePath });
        return {
          author: m.author ?? null,
          title: m.title ?? null,
          series: null,
          seriesIndex: null,
          isbn: null,
        };
      } catch {
        return empty();
      }
    }

    return empty();
  }
}

function empty(): MetadataResult {
  return { author: null, title: null, series: null, seriesIndex: null, isbn: null };
}
