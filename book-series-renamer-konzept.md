# Book Series Renamer — Technisches Konzept

## 1. Ziel der Anwendung

Eine Cross-Platform Desktop-App, die Buchserien-Dateien per Drag & Drop entgegennimmt, deren Namen mithilfe eines lokalen LLM (LM Studio) analysiert und einheitliche, strukturierte Dateinamen vorschlägt — vor dem eigentlichen Umbenennen mit einer editierbaren Vorschau.

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
| Styling | **Tailwind CSS** | Schnell, kein separates CSS-Bundle nötig |
| Backend (Rust) | Tauri-Commands | Dateisystemoperationen (Umbenennen, Pfadauflösung) |
| LLM-Integration | **LM Studio API** (OpenAI-kompatibel) | Läuft lokal auf `http://localhost:1234`, kein API-Key, kein Datenschutzproblem |
| Build/Tooling | Vite | Standard in Tauri v2 |

## 6. LLM-Integration (LM Studio)

### Prompt-Strategie

Alle Dateinamen werden **in einem einzigen Prompt** übermittelt, damit das Modell den Serienkontext erkennen kann (z.B. Bandnummern aus verschiedenen Namenskonventionen ableiten).
Das LLM sollte sowhl die allgemeinen Daten zur Serie ausgeben als auch die Nummerierung der Einzelnen Buch-Datei innerhalb der Serie im JSON ausgeben.

**System-Prompt:**
```
Du bist ein Experte für Buchserien-Metadaten. 
Du analysierst Dateinamen und extrahierst strukturierte Informationen.
Antworte AUSSCHLIESSLICH mit einem validen JSON-Array. Kein erklärender Text, keine Markdown-Backticks.
```

**User-Prompt (dynamisch aufgebaut):**
```
Die folgenden Dateien gehören vermutlich zur selben Buchserie.
Analysiere die Namen IM ZUSAMMENHANG und extrahiere für jede Datei:
- "originalName": exakter Dateiname wie angegeben
- "author": Autor (Nachname Vorname oder Vorname Nachname, einheitlich)
- "series": Name der Buchreihe
- "volume": Bandnummer als Integer (null wenn nicht erkennbar)
- "title": Einzeltitel des Bandes (null wenn nicht erkennbar)

Dateiliste:
1. "brandons_way_of_kings_unabridged.mp3"
2. "stormlight_2_words_of_radiance.mp3"
...

JSON-Array:
```

### Namensformat
Authoren sollten immer mit Nachname, Vorname genannt werden.

Der `proposedName` wird clientseitig aus den LLM-Feldern berechnet:

```typescript
function buildProposedName(entry: FileEntry): string {
  const vol = entry.volume !== null ? ` (${entry.volume})` : '';
  return `${entry.author} - ${entry.series}${vol}${entry.extension}`;
  // Beispiel: "Sanderson Brandon - Stormlight Archive (2).mp3"
}
```

---

## 7. Tauri-Command: Umbenennen

Im Rust-Backend wird das eigentliche `fs::rename` ausgeführt.

---

## 8. UI-Ablauf (User Flow)

Kurzer Edit zum Ablauf: Der Name der Serie und des Autors sollen einmal zentral angezeigt werden, nicht für jede Datei einzeln. Aber es sollen einzelne Files auch abgewählt werden können, falls eine Datei mit rein gekommen ist, die nicht zur Serie gehört.
Weiterhin möchte ich die Dateien in der vorgeschlagenen Reihenfolge sehen, also nach Bandnummer.

```
1. App öffnen
        │
2. LM Studio URL + Modell prüfen/einstellen (SettingsBar)
        │
3. Dateien in DropZone ziehen
        │
4. [Analyse starten] klicken
        │
5. Ladeindikator (API-Call läuft)
        │
6. PreviewTable erscheint:
   ┌─────────────────────────────────────────────────────┐
   │ Altname               │ Autor   │ Serie  │ Bd │ Neuname │
   ├───────────────────────┼─────────┼────────┼────┼─────────┤
   │ buch1_final.mp3       │ [edit]  │ [edit] │[1] │ Vorschau│
   │ stormlight_2.m4b      │ [edit]  │ [edit] │[2] │ Vorschau│
   └─────────────────────────────────────────────────────┘
   [Autor global setzen] [Serie global setzen]
        │
7. Nutzer prüft, editiert einzelne Felder falls nötig
        │
8. [Alle umbenennen] klicken → Bestätigungs-Dialog
        │
9. Tauri-Command führt fs::rename aus
        │
10. Status-Feedback pro Zeile (✓ / ✗ + Fehlermeldung)
```


## 10. Konfiguration (persistent)

Wird in der Tauri App-Config-Datei gespeichert (OS-spezifisch via `tauri-plugin-store`):

```json
{
  "lmstudio_url": "http://localhost:1234",
  "model": "meta-llama-3.1-8b-instruct",
  "naming_pattern": "{author} - {series} ({volume})",
  "last_directory": "/Users/arne/Bücher"
}
```

---

## 11. Erweiterungsmöglichkeiten (nicht im MVP)

- **Undo**: Umbenennungen rückgängig machen (inverse Rename-Map speichern)
- **Cover-Extraktion**: Bei EPUB/M4B Coverbild auslesen und anzeigen
- **Exportfunktion**: Umbenennung als Dry-Run-Log exportieren (CSV)

---

## 12. Hinweise für Claude Code

- Tauri v2 verwenden (nicht v1 — Breaking Changes in API und Permissions)
- LM Studio API ist OpenAI-kompatibel, kein eigenes SDK nötig — einfacher `fetch`-Call genügt
- Drag & Drop über das native Tauri `drag-drop`-Event, nicht über HTML5 `FileReader` (der liefert keinen absoluten Pfad)
- Für den Pfadzugriff: `tauri::api::path` bzw. `@tauri-apps/api/path` im Frontend
- JSON-Parsing der LLM-Antwort defensiv gestalten — Modelle geben manchmal Kommentare oder Markdown-Fences zurück, diese vorher strippen
