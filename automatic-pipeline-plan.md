# Strategie: Automatische Bereinigung von Dateinamen (E-Books/Dokumente)

## Kontext

Du hast ~1190 Dateinamen manuell bereinigt. Die `duplicates.json` enthält 1278 Dirty→Clean-Mappings. Ziel ist es, Regeln und Strategien abzuleiten, die diese Bereinigung in Zukunft automatisieren können — als mehrstufige Pipeline aus klassischen Regex-Verfahren und lokalen LLMs.

## Zielformat

```
Nachname, Vorname - Titel.ext
Nachname, Vorname - Serie (NN) - Untertitel.ext
Penname - Serie (NN) - Untertitel.ext
```

Sonderfälle: `(alternative file)`, `(alt)`, `- (Royalroad)`, `Für Dummies - Thema`

---

## Pipeline-Übersicht

```
Stage 0: Normalisierung (deterministisch)
   ↓
Stage 1: Strukturelle Zerlegung (Regex-Muster)
   ↓
Stage 2: Metadaten-Anreicherung (EPUB/PDF-Metadaten, Web-Lookup)
   ↓
Stage 3: LLM-Anreicherung (lokal, für Restfälle)
   ↓
Stage 4: Zusammenbau + Konfidenz-Scoring
   ↓
Stage 5: Deduplizierung & Konfliktauflösung
```

---

## Stage 0: Normalisierung (Pre-Processing)

Alle Operationen sind deterministisch und verlustfrei.

| # | Operation | Betroffene Dateien | Regex/Logik |
|---|-----------|-------------------|-------------|
| 1 | **Unicode NFC** | alle | `string.normalize("NFC")` — `u + ̈` → `ü` |
| 2 | **Underscores → Spaces** | ~590 | `/_/g` → ` ` (nach Abtrennung der Extension) |
| 3 | **Whitespace trimmen** | alle | Mehrfach-Spaces kollabieren |
| 4a | **Anna's Archive Suffix** | ~26 | `-- Author -- Year -- Publisher -- hash -- Anna's Archive` entfernen |
| 4b | **libgen.li Suffix** | ~86 | `- libgen.li` am Ende entfernen |
| 4c | **Numerische ID** | ~92 | `_\d{6,}` vor Extension entfernen |
| 4d | **Royalroad rylrdl** | ~22 | `-rylrdl_\d+` entfernen, Quelle als "Royalroad" merken |
| 4e | **Download-Duplikat** | ~18 | `(1)` vor Extension entfernen |
| 4f | **`(epub)` Marker** | ~15 | `(epub)` aus dem Namen entfernen |
| 5 | **Publisher + Jahr** | ~479 | `-Verlagsname (2024)` am Ende entfernen — nur wenn Klammer genau 4-stellige Jahreszahl enthält |
| 6 | **Genre-Tags** | ~50-100 | Kuratierte Liste: "A LitRPG Level-up Adventure", "A Progression Fantasy", "A Xianxia Cultivation Series" etc. entfernen |
| 7 | **Doppelpunkt-Artefakt** | viele | `Titel_ Untertitel` → `Titel - Untertitel` (Underscore gefolgt von Space) |

**Reihenfolge ist wichtig**: Erst Anna's Archive (längster Suffix), dann libgen, dann numerische ID, dann Publisher+Jahr — um Fehlmatches zu vermeiden.

---

## Stage 1: Strukturelle Zerlegung (Regex-basiert)

Extrahiert `author`, `series`, `volume`, `title` aus dem normalisierten Namen. Muster werden in Prioritätsreihenfolge durchprobiert:

### Muster-Katalog

1. **Bereits sauber**: `Nachname, Vorname - Titel` — direkt übernehmen
2. **Anna's Archive Format**: `Titel -- Autor` (nach Stage 0 Bereinigung) — Felder tauschen
3. **Serien-Prefix in Klammern**: `(Serie N) Autor - Titel` oder `[Serie N] Autor - Titel` (~864 + 106 Dateien) — Serie+Band extrahieren, Rest als Autor-Titel parsen
4. **Terra Astra Prefix**: `TA NNN - Autor - Titel` (~10) — Prefix entfernen, normal parsen
5. **Standard Autor-Titel**: `Autor - Titel` — Autor-Name flippen wenn nötig
6. **Nur Titel**: Kein Trennzeichen erkennbar — Autor bleibt unbekannt

### Autornamen-Normalisierung

| Eingabe | Aktion | Beispiel |
|---------|--------|---------|
| `Nachname, Vorname` | beibehalten | `Feist, Raymond E.` |
| `Vorname Nachname` (2 Wörter) | flippen | `Mark Manson` → `Manson, Mark` |
| Ein Wort | Penname beibehalten | `Shirtaloon`, `RinoZ` |
| 3+ Wörter | Flaggen zur Review | `Claudia Ossola-Haring` — unklar wo der Nachname beginnt |
| Mehrere Autoren (`and`, `&`) | Primärautor wählen oder `&`-Format | `Author1 & Author2` |

**Penname-Liste**: Kuratierte Liste bekannter Ein-Wort-Autoren (Zogarth, Shirtaloon, RinoZ, TurtleMe, Casualfarmer, Pegaz, SunriseCV, DarkTechnomancer, TMarkos, JCLouis etc.)

### Band-Nummer-Extraktion

- Aus Klammer-Prefix: `(Serie 4)` → Band 4
- Aus Titel: `Book 5`, `Vol. 3`, `#7`, oder nachlaufende Ziffer nach Serienname
- Immer auf 2 Stellen zero-padden: `4` → `(04)`

---

## Stage 2: Metadaten-Anreicherung

Füllt Lücken aus Stage 1 mit eingebetteten Datei-Metadaten und Web-Lookups.

### Quellen (nach Vertrauenswürdigkeit)

1. **EPUB OPF-Metadaten** — Titel, Autor, `calibre:series`, `calibre:series_index`, ISBN. Höchste Vertrauensstufe.
2. **PDF Info-Dictionary** — Titel und Autor (oft unzuverlässig, aber besser als nichts).
3. **Google Books API** — ISBN-basiert (wenn vorhanden) oder Titel+Autor-Suche. Besonders nützlich für Serien-Informationen.

### Kreuzvalidierung

Wenn Regex-Ergebnis und Metadaten übereinstimmen → Konfidenz `hoch`. Bei Widerspruch → beide Werte in Review-Queue zeigen.

---

## Stage 3: LLM-Anreicherung (lokal)

Nur für Fälle, die Regex + Metadaten nicht lösen können.

### Wann LLM einsetzen?

- **Titel-only Dateien** ohne Autor nach Stage 1+2 (~159 Fälle)
- **Serien-Erkennung** wenn die Serie nur aus dem Kontext bekannt ist (z.B. "He Who Fights with Monsters 5" → Autor ist Shirtaloon)
- **Genre-Tag-Erkennung** für unbekannte Genre-Phrasen
- **Mehrdeutige Autorennamen** (3+ Wörter)

### Empfohlene lokale Modelle

| Modell | Größe (Q4) | Stärken | Einsatz |
|--------|-----------|---------|---------|
| **Llama 3.1 8B Instruct** | ~4.5 GB | Gute Faktenkenntnis, schnell auf Apple Silicon | Primär |
| **Qwen 2.5 7B Instruct** | ~4.4 GB | Stark multilingual (wichtig für deutsche Titel) | Alternative |
| **Phi-3.5 Mini 3.8B** | ~2.3 GB | Kleinster Footprint | Hardware-Beschränkung |

### Prompt-Strategie

- Strukturiertes JSON-Output-Format erzwingen (via `response_format`)
- Penname-Liste im System-Prompt mitgeben
- **Batch-Modus**: 10-20 Dateinamen pro Anfrage — reduziert Latenz und erlaubt dem LLM Muster über Dateien hinweg zu erkennen
- Beispiele aus den bekannten Clean-Mappings als Few-Shot-Context mitgeben

### Konfidenz

LLM-Ergebnisse immer als `medium` markieren — erst nach Kreuzvalidierung mit Web-Lookup auf `hoch` setzen.

---

## Stage 4: Zusammenbau & Konfidenz-Scoring

### Zusammenbau-Regeln

```
{Autor} - {Serie} ({Band}) - {Titel}.{ext}     # Vollständig
{Autor} - {Titel}.{ext}                          # Ohne Serie
{Autor} - {Serie} ({Band}).{ext}                  # Ohne Untertitel
{Autor} - {Titel} - (Royalroad).{ext}            # Royalroad-Quelle
{Autor} - {Titel} (alternative file).{ext}        # Duplikat-Variante
```

### Konfidenz-Score (0.0 – 1.0)

| Abzug | Bedingung |
|-------|-----------|
| -0.4 | Autor komplett unbekannt |
| -0.3 | Autor nur per LLM geraten (ohne Metadaten-Bestätigung) |
| -0.2 | Serie nur aus Titelmuster abgeleitet |
| -0.2 | Bandnummer mehrdeutig |
| -0.1 | Titel gekürzt oder Genre-Tags entfernt |

**Schwellwerte**:
- **≥ 0.7 = hoch** → Auto-Rename mit Bestätigung
- **0.4–0.7 = mittel** → Review empfohlen
- **< 0.4 = niedrig** → Manuelle Bearbeitung nötig

---

## Stage 5: Deduplizierung

Wenn mehrere Dirty-Namen denselben Clean-Namen ergeben:
- Eine Datei als "primär" markieren (EPUB > PDF, größere Datei bevorzugt)
- Weitere als `(alternative file)` oder `(alt)` suffixen
- Dateigröße und Metadaten-Qualität als Entscheidungskriterien

---

## Erwartete Abdeckung pro Stage

| Stage | Geschätzte Abdeckung | Kumulativ |
|-------|---------------------|-----------|
| Stage 0+1 (Regex) | ~70-80% | 70-80% |
| Stage 2 (Metadaten) | ~10-15% | 85-90% |
| Stage 3 (LLM) | ~5-8% | 93-98% |
| Manuell | ~2-5% | ~98-100% |

---

## Test-Strategie

Die 1190 bekannten Dirty→Clean-Mappings dienen als Ground Truth:
1. Jeder Dirty-Name durchläuft die Pipeline
2. Output wird mit erwartetem Clean-Namen verglichen
3. Genauigkeit pro Stage tracken (was schafft Regex allein? Was braucht Metadaten? Was braucht LLM?)
4. Ziel: 90%+ Regex-only, 95%+ mit Metadaten, 98%+ mit LLM

---

## Umsetzungsreihenfolge

1. **Phase 1**: Stage 0 + Stage 1 als eigenständige Funktion — testbar gegen die Ground-Truth-Daten
2. **Phase 2**: Metadaten-Integration (vorhandene `enrichEntry`-Logik anbinden)
3. **Phase 3**: LLM-Integration (vorhandenes `decomposeFilename` erweitern)
4. **Phase 4**: Konfidenz-UI (Review-Queue mit Batch-Approve für High-Confidence)
