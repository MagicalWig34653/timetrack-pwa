# Handoff P13-pwa: mehrere Planblöcke pro Tag

Stand: 27.10.2026, Branch `p13-plan-blocks` (Basis main 8742d1a), nicht gemergt. Vertrag 0.35.0, ADR-0031, Backend-Handoff `P13.md`.

## Was gebaut ist
- **API-Typen/Client:** `PlanTimeBlock`, `PlanBlockKind`, `PlanHint`; `blocks` an `PlanDayInput`/`PlanDay`, `planBlocks`/`planHints`/`planActualDifferenceSeconds` an `TimeWeekDay`, `blocks` (Start, Ende, Art) in `SharedView.plan`. `api/api-version.ts` (`supportsPlanBlocks`, ab 0.35.0) und `api/capabilities.svelte.ts` (lädt `/system/info` einmal; ohne Antwort bleibt alles beim alten Verhalten).
- **Entwurfsmodell (`week/plan-draft.ts`):** `DayDraft` hat `blocks[]` (Beginn, Ende, Art, Ort, Notiz) statt Start/Ende; Tagesart (`mode`) bleibt eigenständig. `breakMinutes` gilt nur noch für alte Server (mit Blocklisten sind Lücken die Pausen). Summe = Summe der Blockdauern. `entryFromDraft`/`weekRequest(…, multi)` senden die vollständige, zeitlich geordnete Liste (kein `plannedStart`), bei `off` und ohne Zeiten `[]`; alter Server: ein Fenster mit Pause. `planHintsOf` spiegelt die Backend-Regel für Live-Hinweise.
- **Raster (`WeekGrid`, `grid-edit.ts`):** Blöcke werden per `datum#index` adressiert. Malen mit Art (Arbeit, Schule, Fahrt, Büro, Homeoffice, Kunde, Frei), Lücken erlaubt; neuer Block gewinnt gegen Überdecktes (trimmt/teilt, meldet „ersetzt“). Verschieben/Kopieren/Größe: Gruppe behält Form, Größenänderung stoppt am Nachbarblock. Teilen (Taste S, Kontextmenü), Pause einfügen (15/30/45, als Lücke), Verbinden mit nächstem Block. Art und Ort pro Block, Tagesart im Dialog bzw. am Chip. Max. 32 Blöcke.
- **Erkennbarkeit ohne Farbe:** Farbe + Icon (`BlockKindIcon`) + Muster (Streifen Schule, Punkte Fahrt, Linien Homeoffice, Kreuzschraffur Kunde) + Text. Tastatur: Tab, Pfeile, Strg/Alt+Pfeil, S, Enter, Entf. Der zugängliche Name ist der sichtbare Text, Wochentag/Zeit/Netto/„Block n von m“ kommen als `aria-describedby`.
- **Liste:** `PlanRow` zeigt je Tag Blockzeilen (Art, Beginn, Ende, Ort, Notiz, Entfernen, „Block hinzufügen“); Überschneidung wird beim Speichern benannt.
- **Hinweise:** `planHints` (planned_break_short, planned_work_stretch_long, planned_break_part_short) als deutsche, unverbindliche „Planungshinweise“ unter dem Raster, in der Liste und im Tagespanel. Die ArbZG-Hinweise nach Profil bleiben getrennt (`break_short` nur noch für Nicht-Erwachsenenprofile, die Erwachsenenregel deckt `planHints` ab).
- **Wochenkarten/Tagesdetail:** Karte listet die Blöcke (Art, Zeit), wenn Arten wechseln oder mehr als zwei Blöcke da sind (zwei gleichartige Blöcke um eine Lücke bleiben als Fenster mit Pause lesbar), plus Chip „Plan ±x“ (`planActualDifferenceSeconds`) und aria-Text. Tagespanel: Blöcke, Plan-Ist-Differenz, Planhinweise. Heute-Seite und Kalender-Chips nennen mehrere Blöcke.
- **Freigaben:** `/shared` zeigt Blöcke nur mit Art und Zeit (nie Ort/Notiz).
- **Alte Pfade:** `planInputOf` (Undo des Kalenders), `PlanDayForm`, `PlanDialog` senden die Blockliste unverändert zurück, solange Fenster/Pause nicht angefasst werden; sonst ersetzt das Einzelfenster den Tag (Hinweis im Dialog).
- **Rückfall:** Bei `apiVersion < 0.35.0` bleibt die alte Einzelblock-Oberfläche (vier Tagesarten, Pause als Zahl, kein Teilen, Dialog mit Pause, Liste mit einem Fenster).
- **Mock:** `mock/plan-blocks.ts` validiert wie das Backend (Reihenfolge der Prüfungen, alle fünf Fehlercodes, max. 32, `off` nur leer, Liste gewinnt, Altschreibweise wird in Blöcke umgewandelt, Extremwert-Pause bleibt Altwert mit 0 s), liefert `blocks`/`planHints`, `planBlocks`/`planActualDifferenceSeconds` in `/time/weeks`, Freigaben ohne Ort/Notiz; `apiVersion` des Mocks jetzt 0.35.0.

## Prüfung
`npm run check` 0 Fehler/0 Warnungen; `npm test` 1210 Tests (vorher 1188); `npm run test:e2e:mock` 192 bestanden, 84 übersprungen (Screenshot-Specs ohne `SCREENSHOT_DIR`). Neu: `e2e-mock/p13.spec.ts` (8: Schule+Arbeit malen, speichern, Neuladen mit Anfrageinhalt; Teilen/Pause/Verbinden/Größe am Nachbarn/Undo; Dialog mit Art/Notiz/Überschneidung; Liste; Wochenkarte und Tagespanel; Freigabe; Rückfall alter Server per `page.route`; axe Raster und Liste), `p13-shots.spec.ts` (nur mit `SCREENSHOT_DIR`; Raster und Liste, 390 px und Desktop, hell/dunkel). Bestehende Specs (`week-grid`, `week`, `x1`, `version`) auf Block-IDs/-Felder angepasst. axe: `/plan` ist damit sauber, die offene Regel `label-content-name-mismatch` (N2) an Planerblöcken ist behoben; Kontrast des Differenz-Chips „unter Soll“ nachgezogen.

## Nicht geprüft / offen
- Gegen ein echtes Backend 0.35.0 nicht getestet (nur Mock, der nach dem Backend-Code nachgebaut ist).
- Echtes Touch (Langdrücken, Wischen) wie bei P11 nur im Code; auf dem Telefon in Playwright wurden Blöcke über den Dialog angelegt.
- Rechtsprofil für `planHints` ist fest Erwachsene (wie im Backend); die ArbZG-Hinweise nach Profil laufen weiter über `limits.ts`.
- Folgewochen kopieren schreibt weiter wochenweise ohne Transaktion (P11, Punkt 3).
- Kalenderfreigaben/ICS sind Backend; die PWA zeigt die ICS-Beschreibung nicht an.
- ADR-/Vertragsdoku im Backend nicht angefasst.
