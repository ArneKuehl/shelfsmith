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

### 4. LM Studio

- LM Studio installieren, ein Instruct-Modell laden (z.B. Llama 3.1 8B Instruct).
- Im LM Studio den lokalen Server starten (Default-URL: `http://localhost:1234`).
- Modell sollte JSON Schema (Structured Outputs) unterstützen — die meisten
  Llama/Qwen/Mistral-Instruct-Modelle tun das.

### 5. App starten

```bash
npm run tauri dev
```

## Bedienung

1. Oben URL und Modell-Namen eintragen (wird persistent gespeichert).
2. Ebook-Dateien (.epub/.pdf/.mobi/.azw3) ins Fenster ziehen.
3. „Analyse starten" — die Tabelle füllt sich mit Vorschlägen.
4. Bei Bedarf Autor/Serie zentral korrigieren, einzelne Bandnummern/Titel editieren,
   Fremddateien per Checkbox abwählen.
5. „Umbenennen" — nach Bestätigung werden alle ausgewählten Dateien umbenannt.
6. Falls etwas schiefgeht: „Rückgängig" macht den letzten Run zurück.

## Architektur

- `src/lib/lmstudio.ts` — LM-Studio-Client mit JSON-Schema-Outputs
- `src/lib/naming.ts` — Sanitize, Bandnummer-Padding, `buildProposedName`
- `src/lib/collisions.ts` — Duplikatprüfung
- `src/lib/store.ts` — Zustand-Store (state management)
- `src-tauri/src/commands/rename.rs` — `fs::rename`-Backend
