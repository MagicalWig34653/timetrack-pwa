# Handoff V2-PWA: Urlaubsplanung

Stand: 19.10.2026. Branch `v2-vacation-planner` (Worktree `timetrack-pwa-wt/v2`), nicht gemergt, Lead-Prüfung offen. Backend: Paket V2 (Vertrag v0.22.0, ADR-0025, `GET /api/v1/vacation/suggestions`).

## Neu
- Seite `/vacation/planner` (Modul planning über das Präfix `/vacation`, kein Eintrag in `map.ts` nötig). Erreichbar über den Knopf „Urlaub planen“ im Kopf der Urlaubsseite; die Seitenleiste behält „Urlaub“ hervorgehoben, die Brotkrumen zeigen Urlaub > Urlaubsplanung.
- Budgetkopf (Anspruch, Genommen, Geplant, Rest, Jahr von „Zeitraum von“).
- Filter: Zeitraum von/bis (höchstens 18 Monate, im Client geprüft), höchstens Urlaubstage, mindestens freie Tage, Mindest-Faktor (Standard 2), Anzahl. Gemerkt in `localStorage` (`timetrack.vacation-planner.filters`, try/catch, defekte oder veraltete Werte fallen auf Standard zurück). Zeitraum, Urlaubstage und freie Tage lösen erst mit „Vorschläge aktualisieren“ eine Abfrage aus; Faktor und Anzahl wirken sofort im Client.
- Die Seite fragt immer mit `limit=100` ab und zeigt die besten N nach dem Faktor-Filter (sonst würde der Filter weniger als N Karten übrig lassen). Fenster mit Faktor unter 2 sind standardmäßig ausgeblendet, mit Hinweis „N Vorschläge … ausgeblendet“ und „Alle zeigen“ (setzt den Mindest-Faktor auf 1).
- Karten: Art-Badge (Brückentag, Feiertagsblock, Schulferien-Verlängerung, Langer Urlaub), „X Urlaubstage → Y Tage frei“, „Faktor 2,8“, Feiertage, Schulferien, exakte Urlaubstage, Konflikte als Warnkasten (Berufsschultag, Abwesenheit eingetragen, Arbeit geplant, Schon als Urlaub eingetragen) ohne die Karte auszublenden, Zustand „Passt nicht ins Budget“, „Danach noch X Tage übrig“, Streifen mit einer Zelle je Kalendertag (Urlaub, Feiertag, Wochenende/frei, schon Urlaub, Konfliktpunkt) mit Legende.
- Übernehmen: Bestätigungsbereich in der Karte (kein Modaldialog, die UI-Bibliothek hat keinen) mit den Zeiträumen und Tagen. Bei Konflikten ist ein Häkchen „Ich habe die Hinweise gelesen“ Pflicht, bei „passt nicht ins Budget“ zusätzlich ein Häkchen. Je zusammenhängendem Block ein `POST /absences` (`kind: vacation`, `status: planned`) von erstem bis letztem Urlaubstag des Blocks (nicht `start`/`end`: Wochenenden am Rand werden nicht gebucht). Ein bereits eingetragener Urlaubstag trennt Blöcke (kein Überlapp). Danach Erfolgsmeldung (grün), Link zu Abwesenheiten und Neuladen der Vorschläge samt Budget. Teilweise gelungene Buchung: Warnung mit Zahl und Grund. Überlappung mit einer Abwesenheit (409 `absence_overlap`) wird als deutsche Fehlermeldung in der Karte gezeigt, nichts wird überschrieben.
- Fehlerzustände: Laden, leer, alle ausgeblendet, 503 `database_unavailable` (Client wiederholt gemäß Retry-After, danach Meldung mit „Erneut versuchen“), 404/501 „nicht verfügbar“.

## Dateien
- `src/routes/(app)/vacation/planner/+page.svelte`, Komponenten `VacationSuggestionCard`, `SuggestionTimeline`, `TimelineLegend` unter `src/lib/components/planning/`.
- `src/lib/vacation/planner.ts` (Filter, Speicher, Blockbildung, Zeitstrahlzellen, Formatierung), Texte `src/lib/i18n/de-vacation-planner.ts` (inkl. `error.invalid`).
- Typen und `api.getVacationSuggestions` in `src/lib/api/`.
- Mock: `mock/vacation-suggestions.ts` (vereinfachte Engine: freie Blöcke werden über Arbeitstage verkettet, Rangfolge Faktor, freie Tage, Beginn; überlappungsfrei) und Route in `mock/planning.ts` (Validierung wie Backend: 400 `invalid`, 400 `range_too_large`).
- Tests: `src/lib/vacation/planner.test.ts`, `mock/vacation-suggestions.test.ts`, `src/routes/vacation-planner-pages.test.ts`, Mock-E2E `e2e-mock/vacation-planner.spec.ts`, Echt-E2E `e2e/vacation-planner.spec.ts` (eigene Backend-Instanz `E2E_VACATION_PLANNER_PORT`, Standard `E2E_PORT + 15`, in `e2e/global-setup.ts`).

## Abweichungen und Annahmen
- Der Mock-Algorithmus ist nicht identisch mit dem Swift-Algorithmus (Schulferien-Fenster, Halbtage, Jahreswechsel vereinfacht). Verbindlich ist der Vertrag.
- Das Backend wählt überlappungsfrei die besten Fenster; es liefert deshalb z. B. für Pfingstmontag den Brückentag davor (Freitag), nicht einen großen Block. Das ist bewusst unverändert dargestellt.
- Konflikt `already_vacation` wird als Warnung gezeigt, die Tage werden aber nie erneut gebucht.
- Eingetragen wird Status `planned`; Genehmigung bleibt manuell.
- Datumsfelder folgen dem Browser-Gebietsschema (Chromium Englisch: MM/TT/JJJJ), wie die übrigen Formulare der PWA.

## Prüfung
- `npm run check`: 0 Fehler, 0 Warnungen (4807 Dateien). `npm test`: 791 Tests in 69 Dateien grün (davon neu: 13 `planner.test.ts`, 7 `vacation-suggestions.test.ts`, 9 `vacation-planner-pages.test.ts`).
- Mock-E2E (`E2E_MOCK_PORT=5231`): 110 bestanden, 53 übersprungen (Screenshot-Specs ohne `SCREENSHOT_DIR`), 0 Fehler (ein früherer Lauf parallel zu anderer Last hatte 2 Ausfälle, Wiederholung grün; davon 8 neue Tests in `vacation-planner.spec.ts`).
- Echt-E2E, nur `vacation-planner.spec.ts` (`E2E_PORT=18290`, `E2E_SKIP_BUILD=1`): 4 von 4 bestanden.
- `test:e2e:pwa`: 8 bestanden, 1 Ausfall `pwa.spec.ts:149` (Push-Test, wartet 20 s auf zugestellte Benachrichtigung; einzeln grün, in der Gesamtfolge zweimal rot; keine Berührung mit diesem Paket, nicht gegen den Basisstand gegengeprüft).
- Screenshots (Desktop und Telefon, hell und dunkel) selbst geprüft; Brotkrume zeigte zuerst „planner“, behoben (`src/lib/nav.ts`).

Echt-E2E gegen eine Kopie des Debug-Backends (gebaut aus dem V2-Stand, inhaltsgleich zu Backend-main 0.22.0), `E2E_SKIP_BUILD=1`.
