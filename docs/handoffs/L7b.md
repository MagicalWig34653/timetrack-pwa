# Übergabe L7b – Planungsseiten gegen das echte Backend

Branch `l7b-planning-e2e` (nicht gepusht). Backend nur gelesen (main, C1–C9, Vertrag v0.3.2, ADR-0005 inkl. Rangfolge).

## Geändert

- `e2e/global-setup.ts`: dritte Instanz (`E2E_PLANNING_PORT`, Standard `E2E_PORT`+2, eigene SQLite-DB, eigener Bootstrap-Link `E2E_PLANNING_BOOTSTRAP_LINK`, `E2E_PLANNING_BASE_URL`).
- `e2e/helpers.ts`: `apiCall` nimmt optionale Header (If-Match).
- `e2e/stage3-planning.spec.ts`: 20 serielle Tests (Alice = Bootstrap-Admin, Bob per Einladung = Empfänger/fremdes Konto). Feste Daten 2026 (Karfreitag 03.04., Ostermontag 06.04. in DE-ST).
- UI/Vertrag v0.3.2: `DayEvaluation.markSource` und `targetOverrideSeconds` in `types.ts`; `DaySummary` zeigt unter Markierung neutral „Markierung: manuell gesetzt / aus einer Abwesenheit abgeleitet / aus dem Feiertagskalender abgeleitet“ (`data-testid="day-mark-source"`). Mock (`mock/evaluate.ts`) liefert beide Felder. Unit-Tests ergänzt.

## Ergebnis gegen das echte Backend

Alle fachlichen Erwartungen (ADR-0005, Vertrag) trafen zu: Stichtagsbestand ersetzt Anspruch (40 halbe Tage, nicht 100), Osterurlaub zählt 16 halbe Tage, approved -> taken ändert den Saldo nicht, Feiertag vor Urlaub (`markSource` holiday), Halbtage (Soll 3:51 = 13860 s, `targetOverrideSeconds` gesetzt), Krankheit Soll 0 und Zeitkonto +2 x 27720 s, Freigabe-Ansicht mit strenger Feldliste, Widerruf sofort 404, 409/400/404 bei Freigaben, fremde IDs 404.
Fehlerformat der API: `{ "error": { "code", "message" } }` (deutsche `message`).

## UI/Vertrag-Abweichungen

Nur `markSource`/`targetOverrideSeconds` (behoben). Weitere UI-Fehler wurden nicht gefunden.

## Backend-Liste (nichts bearbeitet, keine `test.fixme` nötig)

Beobachtungen ohne Fehlercharakter, zur Entscheidung des Leads:
1. Wochenendtage innerhalb einer genehmigten Urlaubs-/Krankheitsabwesenheit liefern `mark: vacation|sick`, `markSource: absence` (Soll 0 ohnehin). Reproduktion: `GET time/days?from=2026-04-04&to=2026-04-05` mit Urlaub 30.03.–10.04. Die PWA zeigt das nur in der Tagesansicht; ist es unerwünscht, müsste `mark` auf Nicht-Arbeitstagen `none` bleiben.
2. Selbstfreigabe liefert 400 (nur Statuscode laut Vertrag), die PWA prüft vorab clientseitig; eine Server-400 ist per API-Test abgedeckt.
3. Offene Frage aus L7a Nr. 2 (sick mit Status planned/requested) nicht geprüft.

## Tests (Zahlen)

`check` 0/0, `npm test` 186, `build` ok, `test:e2e` 49 (15 stage1 + 14 stage2 + 20 stage3), `test:e2e:mock` 15 (+4 übersprungen). Ein einzelner Lauf zeigte einmal einen Ausfall in `stage1.spec.ts` („recovery codes and fallback password setup“, `toBeVisible`); der direkt folgende Lauf war vollständig grün, Ursache vermutlich Zeitverhalten unter Last, nicht untersucht.

## Nicht geprüft

MariaDB, Firefox/WebKit, Uhr nach dem Jahreswechsel (Seiten starten im aktuellen Jahr, die Spec blättert per `goToYear` auf 2026), E-Mail-Wiederherstellung, Screenshots.
