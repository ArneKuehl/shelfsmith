# Book Series Renamer — Technisches Konzept

## 1. Ziel der Anwendung

Eine Cross-Platform Desktop-App, die Ebook-Dateien einheitlich umbenennt. Es gibt
drei Workflows:

- **Serien-Modus**: Eine Auswahl von Dateien einer einzigen Serie wird per
  Drag & Drop entgegengenommen, gemeinsam von einem lokalen LLM (LM Studio)
  analysiert und nach editierbarer Vorschau umbenannt.
- **Bibliothek-Modus**: Ein Ordner (optional rekursiv) wird gescannt, und für
  jede Datei einzeln werden Metadaten ermittelt — bevorzugt aus eingebetteten
  EPUB/PDF-Tags, sonst aus einem Web-Lookup. Pro Datei kann der Vorschlag
  editiert und einzeln umbenannt werden.
- **Aufräumen-Modus**: Für bestehende, bereits sauber benannte Sammlungen.
  Analysiert Dateinamen rein lokal (kein LLM, kein Web), gruppiert sie per
  Fuzzy-Matching in Cluster und erkennt Inkonsistenzen (Autoren-/Serien-
  Varianten, Duplikate, Format-Konflikte, Bandlücken, Casing). Vorschläge
  werden als Rename oder Move-to-`_duplicates/` präsentiert.

In allen Modi gibt es Kollisionsprüfung, Undo und persistente Settings.

---

## 2. Zielplattformen

- macOS (ARM + x86)
- Linux (x86_64)
- Windows (x86_64)

---

## 3. Technologie-Stack

| Schicht | Technologie | Begründung |
|---|---|---|
| Framework | **Tauri v2** | Cross-Platform, nativer Dateisystemzugriff, schlankes Bundle (~5 MB), kein Electron-Overhead |
| Frontend | **React + TypeScript** | Komponentenmodell passt gut zur Tabellen-UI mit editierbaren Feldern |
| State | **Zustand** | Schlanker Store für Mode/Settings/Entries/Undo |
| Styling | **Tailwind CSS** | Schnell, kein separates CSS-Bundle nötig; `darkMode: "class"` für Theme-Switch |
| Backend (Rust) | Tauri-Commands | Dateisystemoperationen (Scan, Rename, EPUB-/PDF-Metadaten lesen) |
| EPUB-Parsing | `zip` + `quick-xml` | OPF aus EPUB-Container extrahieren, Calibre-Felder berücksichtigen |
| PDF-Parsing | `lopdf` | Title/Author aus PDF-Info-Dictionary lesen |
| LLM-Integration | **LM Studio API** (OpenAI-kompatibel) | Läuft lokal auf `http://localhost:1234`, kein API-Key, kein Datenschutzproblem; nur im Serien-Modus |
| Persistenz | `tauri-plugin-store` | Settings + letztes Undo-Objekt OS-spezifisch ablegen |
| HTTP | `tauri-plugin-http` | Web-Lookup im Bibliothek-Modus, keine CORS-Probleme |
| Build/Tooling | Vite | Standard in Tauri v2 |

---

## 4. Modi im Überblick

### Serien-Modus

- Eingabe: Drag & Drop einzelner Dateien (`.epub`, `.pdf`, `.mobi`, `.azw3`).
- Eine zentrale Autor- und Serien-Eingabe gilt für alle Dateien.
- LLM-Analyse über LM Studio bestimmt für jede Datei `volume`, `volumeEnd`,
  `title` sowie einen gemeinsamen Vorschlag für `author` und `series`.
- Nutzer editiert in der Tabelle, schaltet einzelne Dateien per Checkbox ab,
  bestätigt und benennt im Block um.

### Bibliothek-Modus

- Eingabe: ein Ordner, optional rekursiv.
- Backend-Command `scan_directory` liefert die unterstützten Dateipfade.
- Pro Datei läuft `enrichEntry` als dreistufige Pipeline:
  1. **Embedded** — eingebettete Metadaten lesen (`read_epub_metadata` /
     `read_pdf_metadata`).
  2. **LLM-Filename-Decomposition** — falls (1) leer ist und ein lokales LLM
     erreichbar ist: `decomposeFilename` zerlegt den Dateinamen in Autor /
     Serie / Titel / Bandnummer. Übersprungen, wenn `bulk_llm_fallback`
     deaktiviert ist oder `checkAvailable` (kurzer Timeout, einmal pro Scan)
     fehlschlägt.
  3. **Web-Lookup** — Google Books, mit Autor/Titel als Query falls vorhanden,
     sonst dem bereinigten Dateinamen. Füllt fehlende Felder auf.
- Jeder Eintrag trägt `source` (`embedded` | `llm` | `web` | `manual` | `none`)
  und `confidence` (`high` | `medium` | `low`) — als Badge in der UI sichtbar.
- Sortierung umschaltbar zwischen Autor und Serie (siehe Abschnitt 7).
- Umbenennung erfolgt einzeln pro Zeile (✓-Button), optional mit Verschieben in
  einen frei wählbaren Ziel-Ordner.

---

## 5. Datenmodell (Auszug)

Definiert in `src/types.ts`:

- `FileEntry` — eine Datei im Serien-Modus (geteiltes `author`/`series` über `SeriesMeta`).
- `BulkEntry` — eine Datei im Bibliothek-Modus, **selbsttragend** mit `author`,
  `series`, `volume`, `volumeEnd`, `title`, `source`, `confidence`, `status`.
- `LibraryEntry` — eine Datei im Aufräumen-Modus, mit geparsten Feldern,
  normalisierten Keys (`authorKey`/`seriesKey`), Cluster-Zuordnung, Issues
  und optionalem Vorschlag (`LibrarySuggestion`).
- `LibraryCluster` — eine Autor+Serie-Gruppe mit kanonischer Schreibweise,
  Eintrags-IDs, Issue-Count und fehlenden Bandnummern.
- `LibrarySettings` — `titleCase` (default on), `fuzzThreshold` (0.88).
- `Settings` — siehe Abschnitt 9.
- `UndoEntry` / `BulkUndoEntry` — speichert die invertierten Rename-Pairs des
  letzten Runs (Bulk-Variante hält zusätzlich die entfernten Einträge, damit
  Undo sie wiederherstellen kann).

---

## 6. LLM-Integration (LM Studio, nur Serien-Modus)

### Prompt-Strategie

Alle Dateinamen werden **in einem einzigen Prompt** übermittelt, damit das
Modell den Serienkontext erkennen kann (z.B. Bandnummern aus verschiedenen
Namenskonventionen ableiten). Über LM Studios `response_format` mit
`json_schema` bekommt die App garantiert ein wohlgeformtes Objekt zurück.

**System-Prompt:**
```
Du bist ein Experte für Buchserien-Metadaten.
Du analysierst Dateinamen und extrahierst strukturierte Informationen.
Antworte AUSSCHLIESSLICH mit einem validen JSON-Objekt nach dem vorgegebenen Schema.
```

**Schema (Auszug):**
```json
{
  "author": "string",
  "series": "string",
  "files": [
    {
      "originalName": "string",
      "volume": "integer | null",
      "volumeEnd": "integer | null",
      "title": "string | null"
    }
  ]
}
```

### Namensformat

Autoren werden auf das Format `Nachname, Vorname` normalisiert
(`formatAuthor` in `naming.ts`). Der `proposedName` wird clientseitig aus den
Metadaten berechnet:

```
{Author} - {Series} ({Volume}[-{VolumeEnd}]) - {Title}.{ext}
```

Beispiel: `Sanderson, Brandon - Stormlight Archive (02) - Words of Radiance.epub`

Das Padding der Bandnummer richtet sich nach der höchsten Bandnummer im Set
(mind. zweistellig). Im Bibliothek-Modus ist das Padding fix zweistellig
(`padBulkVolume`), da Einträge unabhängig voneinander stehen.

---

## 7. Sortierung im Bibliothek-Modus

Die Liste wird live nach Autor oder Serie sortiert (Toggle in der Toolbar).
Damit Schreibvarianten zusammenfallen, wird ein normalisierter Schlüssel
verwendet (`naming.ts`):

- `normalizeForSort`: lowercase, NFD-Akzente entfernen, führende Artikel
  (`the`, `a`, `an`, `der`, `die`, `das`, `le`, `la`, `el` …) abschneiden,
  alphanumerisch reduzieren, Whitespace kollabieren.
- `authorSortKey`: stellt den Nachnamen nach vorne (auch wenn die Eingabe
  „Vorname Nachname" oder mit Komma vorliegt).
- `seriesSortKey`: zusätzlich werden gängige Serien-Suffixe (`saga`, `cycle`,
  `trilogy`, `chronicles`, `reihe`, `zyklus` …) am Ende abgeschnitten.

Folge: „Riftwar Saga" und „The Riftwar" werden zu demselben Schlüssel und
landen direkt nebeneinander. Bei Sortierung nach Serie zeichnet die UI vor
jedem Wechsel des Schlüssels einen Trenner mit der **tatsächlichen** Schreibung
des ersten Eintrags — Inkonsistenzen werden so sofort sichtbar.

Die Sortierung ist rein abgeleitet (`useMemo` aus `state.bulkEntries`); der
Store wird **nicht** umsortiert, damit live laufende Scans nicht flackern.

---

## 8. Tauri-Commands (Rust-Backend)

Definiert in `src-tauri/src/commands/`:

- `scan_directory(path, recursive) -> Vec<String>` — listet unterstützte
  Dateien (Endungen `.epub`, `.pdf`, `.mobi`, `.azw3`).
- `read_epub_metadata(path) -> EpubMeta` — extrahiert OPF-Metadaten aus dem
  EPUB-Container; berücksichtigt Calibre-Felder (`calibre:series`,
  `calibre:series_index`).
- `read_pdf_metadata(path) -> PdfMeta` — liest Title/Author aus dem PDF-Info-
  Dictionary via `lopdf`.
- `rename_files(pairs) -> Vec<RenameResult>` — führt `fs::rename` aus, fällt
  bei Cross-Device-Errors auf Copy+Delete zurück, behandelt nur-Case-
  Änderungen (Windows/macOS) korrekt.

Alle Commands liefern strukturierte Fehler pro Eintrag, sodass die UI Erfolg
und Fehlschläge differenziert anzeigen kann.

---

## 9. UI-Ablauf

```
App-Start
   │
   ├── Theme aus Settings (Dark default) auf <html> anwenden
   │
   ├── Tab „Serie" ──┐       Tab „Bibliothek" ──┐     Tab „Aufräumen" ──┐
   │                 │                          │                       │
   │   1. URL/Modell │       1. Ordner wählen   │   1. Ordner wählen   │
   │   2. Drag & Drop│       2. „Scannen"       │   2. Scan+Analyse    │
   │   3. Analyse    │       3. Sortieren       │   3. Cluster wählen  │
   │   4. Editieren  │       4. Editieren       │   4. Issues prüfen   │
   │   5. Umbenennen │       5. ✓ pro Zeile     │   5. Rename/Move     │
   │   6. Undo       │       6. Undo            │                      │
   │
   └── Theme-Toggle (☀︎/☾) und Einstellungen-Modal (⚙) in der Tab-Leiste
```

Beide Modi teilen sich den Tauri-Rename-Command, die Persistenz der Settings
und das letzte Undo. Alle Settings werden zentral im Modal `SettingsScreen`
verwaltet — pro Bereich gegliedert: LM Studio, Serien-Modus, Bibliothek-Modus,
Darstellung. Ein „Verbindung testen"-Button im LM-Studio-Bereich nutzt
`checkAvailable`.

---

## 10. Konfiguration (persistent)

Wird via `tauri-plugin-store` in `settings.json` gespeichert (OS-spezifischer
App-Data-Pfad). Tatsächliche Felder (`Settings`-Typ in `src/types.ts`):

```jsonc
{
  "lmstudio_url": "http://localhost:1234",
  "model": "meta-llama-3.1-8b-instruct",
  "include_title_in_name": true,
  "move_after_rename": false,
  "move_target_dir": null,
  "bulk_recursive_default": true,
  "bulk_target_dir": null,
  "bulk_sort_by": "author",      // "author" | "series"
  "bulk_llm_fallback": true,     // LLM-Fallback im Bibliothek-Modus
  "theme": "dark"                // "dark" | "light"
}
```

Zusätzlich wird das letzte Undo-Objekt unter `last_undo` abgelegt, damit ein
Rename auch nach App-Neustart noch zurückgenommen werden kann.

---

## 11. Theme (Dark / Light Mode)

- Tailwind ist auf `darkMode: "class"` konfiguriert.
- `App.tsx` setzt/entfernt die `dark`-Klasse auf `<html>`, gesteuert von
  `settings.theme`.
- Alle Komponenten nutzen das Muster `light-default dark:dark-variant` für
  Slate-Farben und für getönte Hintergründe (rose/emerald/amber/sky).
- Inline-`<style>`-Blöcke (Cell-Inputs, Header-Inputs, Dropzone-Buttons)
  liefern helle Defaults und überschreiben sie via `.dark <selector>`.
- Toggle-Button (☀/☾) sitzt in der Tab-Leiste rechts oben; die Auswahl wird
  persistiert.

---

## 12. Erweiterungsmöglichkeiten

Implementiert seit dem MVP:

- ✅ Undo-Funktion (auch über App-Neustart hinweg).
- ✅ Bibliothek-Modus mit Ordner-Scan und EPUB/PDF-Metadaten.
- ✅ Live-Sortierung mit Fuzzy-Matching für Serien.
- ✅ Dark/Light-Theme.
- ✅ Zentraler Settings-Screen (Modal über ⚙ in der Tab-Leiste).
- ✅ LLM-Filename-Decomposition als Fallback im Bibliothek-Modus.
- ✅ Aufräumen-Modus: Cluster-basierte Bereinigung bestehender Sammlungen
  (Fuzzy-Matching, Issue-Erkennung, Rename/Move-Vorschläge, Format-Präferenz
  EPUB, Lücken-Detection, Title-Case-Normalisierung).

Offen / mögliche Erweiterungen:

- **Cover-Extraktion**: Bei EPUB Coverbild auslesen und in der Tabelle anzeigen.
- **Exportfunktion**: Umbenennung als Dry-Run-Log exportieren (CSV).
- **Web-Lookup-Quellen**: zusätzliche Backends (Goodreads-Scraper, ISBN-DB).
- **Stapel-Umbenennung im Bibliothek-Modus**: Auswahl mehrerer Zeilen + ein
  Klick statt einer ✓-Aktion pro Zeile.
- **Konflikt-Auflöser**: bei Kollisionen Vorschläge generieren statt nur warnen.

---

## 13. Hinweise für Claude Code

- Tauri v2 verwenden (nicht v1 — Breaking Changes in API und Permissions).
- LM Studio API ist OpenAI-kompatibel, kein eigenes SDK nötig — `fetch` über
  `@tauri-apps/plugin-http` (umgeht CORS-Beschränkungen).
- LM Studio mit `response_format: { type: "json_schema" }` ansprechen, dann ist
  defensives Strippen von Markdown-Fences nicht nötig.
- Drag & Drop über das native Tauri `drag-drop`-Event, nicht über HTML5 — der
  HTML5-Pfad liefert keinen absoluten Pfad.
- Pfadzugriff: `tauri::api::path` bzw. `@tauri-apps/api/path` im Frontend.
- Im Bibliothek-Modus die Liste nicht im Store umsortieren — sortiert wird
  rein abgeleitet via `useMemo`, sonst flackert die UI während des Scans.
- Theme-Klassen konsequent als `light-default dark:dark-variant` schreiben;
  inline-CSS via `.dark <selector>` überschreiben statt Tailwind-Pairs zu
  vermischen.
