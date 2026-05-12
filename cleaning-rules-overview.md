# cleaning-rules.yaml – Übersicht

Maschinell lesbare Bereinigungsregeln, abgeleitet aus 1278 manuellen Dirty→Clean-Mappings (`duplicates.json`).  
Vollständige Regeln: [`cleaning-rules.yaml`](./cleaning-rules.yaml)

| # | Abschnitt | Inhalt |
|---|-----------|--------|
| 1 | `extensions` | 4 Dateiendungen (`.epub`, `.pdf`, `.mobi`, `.azw3`) |
| 2 | `unicode` | NFC-Normalisierung |
| 3 | `source_suffixes` | 5 Quell-Markierungen (Anna's Archive, libgen, rylrdl, Z-Library, numerische ID) |
| 4 | `inline_markers` | 11 interne Marker (`(epub)`, `(Final)`, `(v5.0)`, `(auth.)`, `(German Edition)`, Terra Astra-Prefix …) |
| 5 | `publisher_year` | Regex + Liste von 72 Verlagsnamen |
| 6 | `underscores` | Underscore → Space |
| 7 | `colon_artifact` | `Wort_  Nächster` → `Wort - Nächster` |
| 8 | `whitespace` | Collapse + Trim |
| 9 | `genre_tags` | 28 Genre-Phrasen (LitRPG, Progression Fantasy, Xianxia …) |
| 10 | `structural_patterns` | 7 Strukturmuster in Prioritätsreihenfolge |
| 11 | `author_normalization` | 21 Pennamen + 4 Flip-Regeln |
| 12 | `volume_normalization` | Zero-Pad auf 2 Stellen + 4 Extraktions-Patterns |
| 13 | `assembly` + `confidence` | Zusammenbau-Formate + Konfidenz-Scoring |
