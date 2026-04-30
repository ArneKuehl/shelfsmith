# Book Series Renamer

Cross-Platform Desktop-App (Tauri v2 + React/TS), die Buchserien-Dateien per
Drag & Drop annimmt, deren Dateinamen über LM Studio analysiert und einheitliche
Dateinamen vorschlägt — mit editierbarer Vorschau, Kollisionsprüfung und Undo.

## Setup

### 1. Toolchain installieren

```bash
brew install node rustup
rustup-init -y
```

(Anschließend einmal `source ~/.zshrc` oder neues Terminal öffnen, damit `cargo`
im PATH ist.)

### 2. Dependencies

```bash
npm install
```

### 3. Icons (einmalig)

Lege ein 1024×1024 PNG-Icon ab (z.B. unter `src-tauri/icons/source.png`) und führe aus:

```bash
npx @tauri-apps/cli icon src-tauri/icons/source.png
```

### 4. LM Studio (empfohlen)

- LM Studio installieren, ein Instruct-Modell laden (z.B. Llama 3.1 8B Instruct).
- Im LM Studio den lokalen Server starten (Default-URL: `http://localhost:1234`).
- Modell sollte JSON Schema (Structured Outputs) unterstützen — die meisten
  Llama/Qwen/Mistral-Instruct-Modelle tun das.

Der Serien-Tab benötigt das LLM zwingend (gemeinsame Analyse aller Dateinamen).
Der Bibliothek-Tab nutzt das LLM optional als Fallback, wenn ein Buch keine
eingebetteten Metadaten hat — kann in den Einstellungen abgeschaltet werden,
und wird automatisch übersprungen, wenn kein LLM erreichbar ist.

### 5. App starten

```bash
npm run tauri dev
```

## Bedienung

Die App hat zwei Tabs:

### Tab „Serie" — eine Serie auf einmal

1. Über das Zahnrad ⚙ in der Tab-Leiste die Einstellungen öffnen und LM-Studio-
   URL/Modell prüfen (einmalig, wird persistent gespeichert).
2. Ebook-Dateien (.epub/.pdf/.mobi/.azw3) ins Fenster ziehen.
3. „Analyse starten" — die Tabelle füllt sich mit Vorschlägen.
4. Bei Bedarf Autor/Serie zentral korrigieren, einzelne Bandnummern/Titel editieren,
   Fremddateien per Checkbox abwählen.
5. „Umbenennen" — nach Bestätigung werden alle ausgewählten Dateien umbenannt.
6. Falls etwas schiefgeht: „Rückgängig" macht den letzten Run zurück.

### Tab „Bibliothek" — ganze Ordner auf einmal

Für gemischte Buchsammlungen, in denen jede Datei zu einer eigenen Serie gehören
kann. Pro Datei läuft eine dreistufige Pipeline:

1. Eingebettete Metadaten (EPUB-OPF, PDF-Info).
2. Falls (1) nichts liefert und ein lokales LLM erreichbar ist: das LLM zerlegt
   den Dateinamen in Autor / Serie / Titel / Bandnummer. Ist das LLM
   nicht erreichbar oder in den Einstellungen deaktiviert, wird der Schritt
   übersprungen.
3. Web-Lookup (Google Books) — nutzt Autor/Titel aus 1/2 als Query, sonst den
   bereinigten Dateinamen.

Eine Statusanzeige in der Toolbar zeigt nach Scan-Start, ob das LLM erreichbar
war (`LLM ✓` / `LLM ✗`). Per Quelle wird in jeder Karte ein Badge angezeigt
(`EPUB`, `LLM`, `Web`, `manuell`, `—`).

1. Quellordner wählen (optional rekursiv).
2. „Scannen" — die Pipeline läuft pro Datei.
3. Sortierung umschalten zwischen **Autor** und **Serie**:
   - Bei „Serie"-Sortierung erscheinen Trennlinien zwischen den Serien-Gruppen.
   - Die Sortierung normalisiert die Vergleichswerte (führende Artikel wie
     „The/Der/Die", Suffixe wie „Saga/Cycle/Trilogy" werden ignoriert), sodass
     z.B. „Riftwar Saga" und „The Riftwar" direkt nebeneinander landen — ideal
     um Schreibvarianten zu erkennen.
4. Pro Zeile die Felder editieren oder den Eintrag verwerfen, dann mit ✓
   einzeln umbenennen. Optional einen Ziel-Ordner wählen, in den umbenannte
   Dateien verschoben werden.

### Einstellungen & Theme

In der Tab-Leiste oben rechts:

- ☀︎/☾ — Dark-/Light-Mode-Toggle (persistiert).
- ⚙ — Einstellungen-Modal mit allen zentralen Optionen: LM-Studio-URL/Modell
  (mit „Verbindung testen"-Button), Serien-Modus-Optionen (Titel im Dateinamen,
  Verschieben nach Umbenennen), Bibliothek-Defaults (rekursiv-Default,
  LLM-Fallback an/aus, Standard-Ziel-Ordner) und das Theme.

## Architektur

- `src/lib/lmstudio.ts` — LM-Studio-Client (`analyze`, `decomposeFilename`,
  `checkAvailable`)
- `src/lib/bulk.ts` — Ordner-Scan + dreistufige Enrichment-Pipeline
- `src/components/SettingsScreen.tsx` — zentrales Einstellungs-Modal
- `src/lib/naming.ts` — Sanitize, Bandnummer-Padding, `buildProposedName`,
  Sortier-Schlüssel (`normalizeForSort`, `authorSortKey`, `seriesSortKey`)
- `src/lib/collisions.ts` — Duplikatprüfung
- `src/lib/store.ts` — Zustand-Store (state management)
- `src/lib/persist.ts` — Settings/Undo-Persistenz via `tauri-plugin-store`
- `src-tauri/src/commands/rename.rs` — `fs::rename`-Backend
