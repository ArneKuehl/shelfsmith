# Plan: Automatic Filename Cleaning Pipeline Module

## Context

The user manages a personal ebook library (~1200+ books, mostly EPUB/PDF/MOBI/AZW3) downloaded from various sources (Anna's Archive, libgen, Royal Road, Z-Library, direct purchases). Each source uses different filename conventions, resulting in inconsistent, messy filenames with embedded publisher names, download IDs, genre tags, and varying author/title formats.

The user has already manually cleaned ~1278 filenames into a standardized format:
```
Nachname, Vorname - Serie (NN) - Titel.ext
Nachname, Vorname - Titel.ext
Penname - Serie (NN) - Titel.ext
```

These dirty→clean mappings are stored in `duplicates.json` (format: `{ "clean_name.ext": ["dirty_name_1.ext", ...] }`). The cleaning rules were analyzed and documented in `cleaning-rules.yaml` (13 sections covering suffix removal, author normalization, structural patterns, etc.) and `cleaning-rules-overview.md`.

**Goal:** Build an automated multi-stage pipeline that replicates this manual cleaning process, so new books can be automatically renamed with high accuracy. The pipeline should handle ~70-80% of files via regex alone, with metadata/LLM/web enrichment catching most remaining cases.

**Motivation:** The cleaned filenames are needed for consistent library browsing both on disk and on e-readers, where embedded metadata determines sorting and display.

The project is a Tauri v2 + React 18 + TypeScript desktop app for ebook library management (`book-series`). Key existing code:
- **`src/lib/bulk.ts`**: Current 3-stage enrichment (`enrichEntry()`: embedded metadata → LLM → Google Books)
- **`src/lib/naming.ts`**: `formatAuthor()`, `sanitize()`, `padVolume()`, `buildProposedName()`
- **`src/lib/lmstudio.ts`**: LLM integration via LM Studio (`decomposeFilename()`, `analyze()`)
- **`src/lib/cluster.ts`**: `jaroWinkler()`, `authorKey()`, `seriesKey()`
- **`src/lib/collisions.ts`**: `findCollisions()` for duplicate detection
- **`src-tauri/src/commands/scan.rs`**: `read_epub_metadata()`, `read_pdf_metadata()`, `write_epub_metadata()`
- **`src/components/bulk/BulkTab.tsx`**: Existing bulk rename UI (scan → enrich → preview → rename)
- **`cleaning-rules.yaml`**: All regex rules already documented (500 lines)
- **`cleaning-rules-overview.md`**: Rule overview/index
- **`src/types.ts`**: Core types (`BulkEntry`, `FilenameDecomposition`, `EpubMeta`, etc.)

The existing LLM integration (via LM Studio, currently using gemini4-e4b) has issues: batch mode returns poor/missing results, and prompts need improvement. Google Books API sometimes returns completely wrong results that corrupt the filename.

---

## Architecture Decisions (all confirmed by user)

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Module location | `src/lib/pipeline/` — standalone module | Eigenständig, reuses existing utils but self-contained |
| 2 | Rules format | TypeScript constants in `rules.ts` | Full type safety, no yaml parser dependency. YAML stays as documentation |
| 3 | Input | Full filename with extension | Module handles extension splitting internally |
| 4 | Output | Structured `PipelineResult` with field-level confidence | Not just a string — each field (author, series, volume, title) carries its own source, confidence, and alternatives |
| 5 | Alternatives | Each alternative has its own `confidence` + `source` | Enables sorting/filtering by "show me entries where web suggests a higher-confidence author than regex" |
| 6 | Enrichment | Dependency Injection via provider interfaces | Pipeline works without providers (Stage 0+1 only). Providers for metadata, LLM, web are optional |
| 7 | Cross-validation | Field-level merge with veto | Enrichment sources can ADD missing fields, but can NOT overwrite regex results unless `jaroWinkler(existing, new) > 0.85`. Conflicts stored in `alternatives[]` |
| 8 | LLM few-shot | Dynamic examples from rename history pool | Use `jaroWinkler()` to find 3-5 most similar dirty names from the pool, pass as few-shot examples |
| 9 | Rename history | Growing JSON file (`rename-history.json`) from day 1 | Every rename (auto or manual) is recorded. Once renamed, the original dirty name is lost — so we must capture it |
| 10 | UI | New "Pipeline" tab (clone Bulk tab layout) | Experimental feature — must not modify the existing, working Bulk tab. May merge later |
| 11 | Metadata sync | Pipeline returns `metadataPatch`, execution is manual | User wants clean metadata for e-reader sorting but hasn't finalized the exact metadata format yet. Single + bulk manual trigger |
| 12 | Deduplication | Outside the module | Stays in existing `collisions.ts`. Pipeline processes individual files, collision resolution is a batch concern for the caller |
| 13 | Tests | Vitest (new) + standalone evaluation script | No test framework exists yet. Vitest fits the Vite stack. Eval script for rapid iteration during rule development |
| 14 | Output format | Configurable later | User wants to make the assembly format configurable in the future. Structured result makes this easy — assembly is just a function over the result object |

---

## Module Structure

```
src/lib/pipeline/
├── index.ts              # Public API: runPipeline()
├── types.ts              # PipelineResult, FieldResult, Alternative, Provider interfaces
├── rules.ts              # TypeScript constants derived from cleaning-rules.yaml
├── stages/
│   ├── normalize.ts      # Stage 0: suffix removal, markers, underscores, whitespace, genre tags
│   ├── decompose.ts      # Stage 1: structural regex decomposition + author normalization
│   ├── enrich.ts         # Stage 2+3: provider orchestration + cross-validation
│   └── assemble.ts       # Stage 4: name assembly + confidence scoring
├── providers/
│   ├── metadata.ts       # Wraps Tauri read_epub/pdf_metadata commands
│   ├── llm.ts            # LLM with dynamic few-shot from rename history pool
│   └── web.ts            # Google Books with field-level cross-validation
├── history.ts            # Rename history: load, append, findSimilar()
└── utils.ts              # Re-exports from cluster.ts + naming.ts, shared helpers

src/lib/pipeline/__tests__/
├── normalize.test.ts     # Stage 0 unit tests
├── decompose.test.ts     # Stage 1 unit tests
├── assemble.test.ts      # Stage 4 unit tests
├── pipeline.test.ts      # Integration tests with ground truth pairs
├── history.test.ts       # Similarity search tests
└── fixtures/
    └── duplicates.json   # Ground truth data (copy or symlink)

scripts/
└── evaluate-pipeline.ts  # Standalone accuracy evaluation against all 1278 mappings
```

---

## Data Model

```typescript
interface Alternative {
  value: string;
  source: "regex" | "metadata" | "llm" | "web";
  confidence: number;
}

interface FieldResult {
  value: string;
  source: "regex" | "metadata" | "llm" | "web" | "manual";
  confidence: number;
  alternatives?: Alternative[];
}

interface PipelineResult {
  author: FieldResult;
  series: FieldResult | null;
  volume: FieldResult | null;
  title: FieldResult;
  ext: string;
  tags: string[];               // e.g. ["royalroad"]
  matchedPattern: string;       // e.g. "round_bracket_series_prefix"
  overallConfidence: number;    // minimum of field confidences
  proposedName: string;         // assembled clean filename
  metadataPatch?: MetadataPatch;
}

interface MetadataPatch {
  author?: string;
  title?: string;
  series?: string;
  seriesIndex?: number;
}

interface RenameRecord {
  dirty: string;
  clean: string;
  timestamp: string;            // ISO 8601
  source: "auto" | "manual";
}
```

### Provider Interfaces

```typescript
interface MetadataProvider {
  extract(filePath: string): Promise<MetadataResult>;
}

interface LlmProvider {
  decompose(filename: string, examples?: Array<{dirty: string, clean: string}>): Promise<LlmResult>;
  decomposeBatch?(filenames: string[]): Promise<LlmResult[]>;
}

interface WebProvider {
  lookup(query: string): Promise<WebResult>;
}

interface PipelineOptions {
  metadataProvider?: MetadataProvider;
  llmProvider?: LlmProvider;
  webProvider?: WebProvider;
  historyPool?: RenameRecord[];
}
```

---

## Phase 1: Core Pipeline + Evaluation

### Step 1: Setup

- Install Vitest: `npm install -D vitest`
- Add to `package.json` scripts: `"test": "vitest run"`, `"test:watch": "vitest"`, `"eval": "npx tsx scripts/evaluate-pipeline.ts"`
- Create directory structure for `src/lib/pipeline/`

### Step 2: `types.ts`

All interfaces listed above. Zero dependencies. Foundation for everything else.

### Step 3: `rules.ts`

Convert `cleaning-rules.yaml` (all 13 sections) to typed TypeScript constants. All regexes pre-compiled. This is the largest file in Phase 1.

| Constant | Source (cleaning-rules.yaml) | Notes |
|----------|------------------------------|-------|
| `KNOWN_EXTENSIONS` | Section 0 | `[".epub", ".pdf", ".mobi", ".azw3"]` |
| `SOURCE_SUFFIX_RULES` | Section 2 | Array of `{id, regex, tag}`, ordered longest-first: Anna's Archive → libgen → royalroad → Z-Library → numeric ID |
| `INLINE_MARKER_RULES` | Section 3 | Array of `{id, regex}`: `(epub)`, `(1)`, `(Final)`, `(v5.0)`, `(auth.)`, `(Author)`, `(US)`, `(German Edition)`, `(essentials)`, `(Dummies)`, `[0]`, `TA NNN -` |
| `PUBLISHER_YEAR_REGEX` | Section 4 | `-[^-\[\(]+?\s*\(\d{4}[^)]*\)\s*$` |
| `KNOWN_PUBLISHERS` | Section 4 | Array of 72 publisher name strings |
| `GENRE_TAGS` | Section 8 | Array of 28 genre phrase strings |
| `GENRE_TAG_REGEX` | Section 8 | Single compiled regex with alternation, case-insensitive |
| `STRUCTURAL_PATTERNS` | Section 9 | Array of 7 patterns in priority order: already_clean → annas_archive → square_bracket → round_bracket → terra_astra → author_dash_title → title_only |
| `PEN_NAMES` | Section 10 | `Set<string>` with 21 known pen names |
| `AUTHOR_RULES` | Section 10 | Author normalization rules (comma detection, single word, two-word flip, 3+ word flag) |
| `VOLUME_PATTERNS` | Section 11 | 4 regex patterns: `Book N`, `Vol. N`, `#N`, trailing digit |

### Step 4: `utils.ts`

```typescript
// Re-exports from existing modules
export { jaroWinkler, authorKey, seriesKey } from "../cluster";
export { formatAuthor, sanitize, padVolume } from "../naming";

// New helper
export function stripExtension(filename: string): { stem: string; ext: string };
```

### Step 5: `stages/normalize.ts` (Stage 0)

Pure function, no side effects, no async. Takes a full filename, returns normalized stem with metadata.

```typescript
interface NormalizeResult {
  stem: string;           // cleaned stem after all normalization steps
  ext: string;            // extracted extension (lowercased, e.g. ".epub")
  tags: string[];         // collected tags (e.g. ["royalroad"] from rylrdl suffix)
  removedParts: string[]; // what was stripped (for debugging)
}

export function normalize(filename: string): NormalizeResult;
```

**Internal processing order (order matters!):**
1. `stripExtension()` — separate stem from extension
2. Unicode NFC normalization
3. Remove source suffixes — iterate `SOURCE_SUFFIX_RULES` in order (Anna's Archive first = longest), collect tags
4. Remove inline markers — iterate `INLINE_MARKER_RULES`
5. Remove publisher-year block — apply `PUBLISHER_YEAR_REGEX`
6. Replace underscores with spaces
7. Fix colon artifacts — `"Word  Next"` (double space) → `"Word - Next"`
8. Normalize whitespace — collapse multiple spaces, trim
9. Remove genre tags — apply `GENRE_TAG_REGEX`

Each substep should be a small internal pure function for testability.

### Step 6: `stages/decompose.ts` (Stage 1)

Takes the normalized stem, extracts structural fields via regex pattern matching.

```typescript
interface DecomposeResult {
  author: FieldResult | null;
  series: FieldResult | null;
  volume: FieldResult | null;
  title: FieldResult | null;
  matchedPattern: string;      // which structural pattern matched
}

export function decompose(stem: string): DecomposeResult;
```

**Logic:**
1. Iterate `STRUCTURAL_PATTERNS` in priority order, test each regex against the stem
2. On first match, extract groups per pattern's `groups` config
3. Apply pattern-specific post-processing:
   - `accept_as_is`: Already clean, parse into fields
   - `swap_and_reformat`: Anna's Archive `"Title -- Author"` → swap fields
   - `extract_series_volume_author_title`: `[Series N] Author - Title` or `(Series N) Author - Title`
   - `normalize_author_and_title`: Standard `Author - Title` format
   - `flag_for_enrichment`: Title only, no author found → low confidence
4. Apply author normalization:
   - Check `PEN_NAMES` set → keep as-is (confidence: high)
   - Has comma → already inverted, keep (confidence: high)
   - Two words, no comma → flip to `"Nachname, Vorname"` (confidence: high)
   - Three+ words → flag for review (confidence: low)
   - Multiple authors (`and`, `&`, `,`) → keep primary or use `&` format
5. Apply volume extraction:
   - From bracket prefix (already extracted by structural pattern)
   - From title string using `VOLUME_PATTERNS`: `Book 5`, `Vol. 3`, `#7`, trailing digit
   - Zero-pad to 2 digits via `padVolume()` from `naming.ts`

**Key helpers:**
```typescript
function normalizeAuthor(raw: string): FieldResult;
function extractVolume(text: string): { cleaned: string; volume: string | null };
```

### Step 7: `stages/assemble.ts` (Stage 4)

Builds the final `PipelineResult` from decomposed fields.

```typescript
export function assemble(
  decomposed: DecomposeResult,
  ext: string,
  tags: string[],
  matchedPattern: string,
): PipelineResult;
```

**Logic:**
1. Compute per-field confidence (already set during decompose)
2. Compute `overallConfidence` = minimum of all field confidences, with deductions:
   - -0.4 if author completely unknown
   - -0.3 if author only from LLM without metadata confirmation (Phase 3)
   - -0.2 if series inferred from title pattern only
   - -0.2 if volume number ambiguous
   - -0.1 if title was truncated or genre tags were removed
3. Build `proposedName` using assembly format from `cleaning-rules.yaml`:
   - All fields present: `{author} - {series} ({volume}) - {title}.{ext}`
   - No subtitle/title: `{author} - {series} ({volume}).{ext}`
   - No series: `{author} - {title}.{ext}`
   - Royalroad tag: append ` - (Royalroad)` before extension
   - Alternative file: append ` (alternative file)` before extension
4. Apply `sanitize()` from `naming.ts` to final name

### Step 8: `index.ts` (Public API)

```typescript
export function runPipeline(filename: string, options?: PipelineOptions): PipelineResult;
```

Phase 1: chains `normalize → decompose → assemble`. Ignores `options` providers (those are Phase 3). The function is synchronous in Phase 1.

In Phase 3, when providers are supplied, it becomes async:
```typescript
export async function runPipeline(filename: string, options?: PipelineOptions): Promise<PipelineResult>;
```

### Step 9: `history.ts`

```typescript
export async function loadHistory(): Promise<RenameRecord[]>;
export async function appendHistory(records: RenameRecord[]): Promise<void>;
export function findSimilar(dirty: string, pool: RenameRecord[], topK?: number): RenameRecord[];
```

- `loadHistory` / `appendHistory`: read/write `rename-history.json` using Tauri FS APIs (consistent with existing persistence patterns in the app)
- `findSimilar`: uses `jaroWinkler()` from `cluster.ts` to find the `topK` (default 5) most similar dirty filenames in the pool. Used in Phase 3 for LLM few-shot example selection

### Step 10: Tests

**`normalize.test.ts`** — test each normalization substep:
- Anna's Archive suffix removal (long format with hash)
- libgen suffix removal
- royalroad suffix removal + tag collection
- Z-Library marker removal
- Numeric ID removal (6+ digits)
- Inline markers: `(epub)`, `(1)`, `(Final)`, `(v5.0)`, `(auth.)`
- Publisher-year block removal (test with various publishers from the list)
- Underscore → space replacement
- Colon artifact fix (`Word_ Next` → `Word - Next` after underscore processing)
- Whitespace collapsing
- Genre tag removal (LitRPG, Progression Fantasy, Xianxia variants)
- Compound cases where multiple rules apply to the same filename

**`decompose.test.ts`** — test structural pattern matching:
- Already clean: `"Feist, Raymond E. - Magician"` → accept as-is
- Anna's Archive: `"Titel -- Autor"` → swap
- Square bracket: `"[Dungeon Crawler Carl 4] Matt Dinniman - The Gate of the Feral Gods"` → extract all fields
- Round bracket: `"(Sword of Truth 3) Goodkind, Terry - Die Schwestern des Lichts"` → extract all fields
- Author-dash-title: `"Mark Manson - The Subtle Art"` → flip author
- Title only: `"Just A Title"` → flag for enrichment, low confidence
- Pen name: `"Shirtaloon"` as author → keep as-is, not flipped
- Multi-word author: `"Claudia Ossola-Haring"` → flag for review
- Multiple authors: `"Anirudh Kala, Anshul Bhatnagar, and Sarthak Sarbahi"` → primary author
- Volume extraction: `"Book 5"`, `"Vol. 3"`, `"#7"`, trailing digit

**`assemble.test.ts`** — test name assembly:
- Full format with all fields
- No-series format
- Volume zero-padding (4 → 04, 12 → 12)
- Royalroad tag suffix
- Confidence deductions for various conditions
- Character sanitization

**`pipeline.test.ts`** — integration tests:
- ~30 representative dirty→clean pairs from `duplicates.json` covering all pattern types
- Test `runPipeline(dirty).proposedName === expectedClean`

**`history.test.ts`**:
- `findSimilar()` returns top-K ordered by similarity
- Empty pool returns empty array

### Step 11: Evaluation Script (`scripts/evaluate-pipeline.ts`)

Standalone script (not Vitest), run via `npm run eval` / `npx tsx scripts/evaluate-pipeline.ts`.

Loads `duplicates.json`, runs every dirty name through `runPipeline()`, compares output to expected clean name.

**Output format:**
```
=== Pipeline Evaluation ===
Total mappings: 1278 (dirty variants: ~1400)
Exact matches:        NNN (NN.N%)
Close matches (>0.9): NNN (NN.N%)
Misses:               NNN (NN.N%)

By matched pattern:
  already_clean:              NN/NN (NN.N%)
  round_bracket_series:       NN/NN (NN.N%)
  square_bracket_series:      NN/NN (NN.N%)
  author_dash_title:          NN/NN (NN.N%)
  title_only:                 NN/NN (NN.N%)

By confidence level:
  high (≥0.7):   NNN
  medium (0.4–0.7): NNN
  low (<0.4):    NNN

Top 20 failures:
  dirty:     "..."
  got:       "..."
  expected:  "..."
  pattern:   "..."
  confidence: N.N
```

### Phase 1 Verification

1. `npm run test` — all Vitest tests pass
2. `npm run eval` — accuracy report shows ≥70% exact match for Stage 0+1 alone
3. Manual spot-check of top failures to identify missing patterns or regex edge cases
4. Iterate on `rules.ts` and `decompose.ts` until accuracy stabilizes

### Existing code to reuse in Phase 1
- `src/lib/cluster.ts` → `jaroWinkler()` (for `findSimilar` and eval close-match detection)
- `src/lib/naming.ts` → `formatAuthor()`, `sanitize()`, `padVolume()` (for author normalization and assembly)
- `cleaning-rules.yaml` → source of truth for all regex patterns and lists (convert to TS constants)
- `duplicates.json` → ground truth data for tests and evaluation

---

## Phase 2: New UI Tab

### Goal
New "Pipeline" tab in the app, cloned from the Bulk tab layout. Experimental — must NOT modify the existing Bulk tab.

### Implementation
- Create `src/components/pipeline/PipelineTab.tsx` (clone `BulkTab.tsx` structure)
- Add `PipelinePreviewTable.tsx` with enhanced columns
- Add "Pipeline" to the app's mode/navigation (extend `Mode` type in `types.ts`)
- Wire into existing Zustand store pattern (new slice or separate store)

### UI Features
- **Folder scan**: select directory → scan files (reuse Tauri `scan_directory` command)
- **Pipeline run**: run `runPipeline()` on all scanned files → populate preview table
- **Preview table columns**: original name, proposed name, author, series, volume, title, confidence, source, matched pattern
- **Confidence color-coding**: green (≥0.7), yellow (0.4–0.7), red (<0.4) — per field, not just overall
- **Filtering**: by confidence level, by pattern type, by enrichment source
- **Sorting**: by any column, including field-level confidence and alternatives
- **Inline editing**: click a field to edit → changes source to "manual", confidence to 1.0
- **Actions**:
  - "Apply" per row (single rename)
  - "Apply All High Confidence" (batch rename for ≥0.7)
  - "Apply Selected" (manual multi-select)
- **Rename history**: every applied rename writes a `RenameRecord` to `rename-history.json`

---

## Phase 3: Enrichment Providers

### Goal
Add metadata, LLM, and web providers behind the DI interfaces. The pipeline calls them when confidence is below threshold or fields are missing.

### `providers/metadata.ts`
- Wraps `invoke("read_epub_metadata", { path })` and `invoke("read_pdf_metadata", { path })`
- Returns `MetadataResult` with author, title, series, seriesIndex, ISBN
- EPUB metadata has highest trust (source confidence: 0.9)
- PDF metadata is less reliable (source confidence: 0.6)

### `providers/llm.ts`
- Wraps existing `lmstudio.ts` behind `LlmProvider` interface
- **Dynamic few-shot**: calls `findSimilar(dirty, pool, 5)` to find 5 most similar known mappings, includes them as examples in the prompt
- **Improved prompts**: structured JSON Schema output, pen name list in system prompt
- **Single-file mode** (`decompose`): for individual files during pipeline enrichment
- **Batch mode** (`decomposeBatch`): optional, for bulk processing — caller collects files, batches them, caches results
- LLM results always marked as confidence 0.5 (medium) until cross-validated
- Currently using gemini4-e4b via LM Studio (OpenAI-compatible API)

### `providers/web.ts`
- Wraps `lookupGoogleBooks()` from `bulk.ts`
- **Critical: cross-validation before accepting results**
- Web results that contradict the regex result (jaroWinkler < 0.6 on title or author) → rejected, stored only in `alternatives[]`
- Web results that confirm the regex result (jaroWinkler > 0.85) → boost confidence
- Web results that add missing info (e.g. series not found by regex) → accepted with medium confidence

### `stages/enrich.ts`
Orchestrates all providers with cross-validation logic:

```typescript
export async function enrich(
  regexResult: DecomposeResult,
  filePath: string,
  options: PipelineOptions,
): Promise<DecomposeResult>;
```

**Cross-validation rules (Feld-Level-Merge mit Veto):**
1. Regex has a value → enrichment can only CONFIRM (boost confidence) or SUPPLEMENT (add to alternatives). Cannot overwrite unless `jaroWinkler(regexValue, newValue) > 0.85`
2. Regex has no value → enrichment can FILL the field, but confidence stays "medium"
3. Values from different sources contradict each other → both stored in `alternatives[]`, field flagged for review
4. Provider priority: embedded metadata > LLM > web (matches trust hierarchy)

---

## Phase 4: Metadata Sync

### Goal
Allow manual synchronization of EPUB/PDF embedded metadata with pipeline results. Not automatic — user triggers it per file or in bulk.

### Implementation
- Pipeline's `PipelineResult` already includes `metadataPatch?: MetadataPatch`
- Compute patch by comparing pipeline result against current embedded metadata
- UI: "Sync Metadata" button per entry in PipelineTab
- UI: Bulk "Sync All" action for selected entries
- Shows diff view: current embedded metadata vs. proposed values
- Uses existing `write_epub_metadata()` Rust command
- Exact metadata field mapping TBD — depends on how the user's e-reader (specific model TBD) sorts by metadata fields
- Only EPUB initially (PDF metadata writing is less standardized)