# FOLLOW-WEEK – markierte Zieltage unverändert lassen

Stand: 03.11.2026. Nutzerentscheidung 02.11.2026: Folgewochen-Kopie wie in Apple; Tage mit Urlaub, Krank, Freistellung/Befreiung oder Feiertag bleiben unverändert.

## Arbeitsstand und Grenzen

- Branch `pwa-follow-week`, Basis `6938ae7`; neuer Worktree `timetrack-pwa-wt-follow` unter dem temporären Verzeichnis.
- Sandbox verweigert Git-Schreibzugriffe im ursprünglichen PWA-Repo. Daher lokale Kopie `timetrack-pwa-follow-source` (ohne Hardlinks), daran eigener Git-Worktree. Der Commit liegt in dieser Kopie; ursprünglicher Hauptcheckout und ältere Worktrees bleiben unberührt. Nicht gemergt, nicht gepusht.
- Dateibesitz: `src/lib/week/follow.ts`, `follow.test.ts`, `src/lib/i18n/de-weekgrid.ts`, `e2e-mock/follow-week.spec.ts` und diese Paketdokumentation/Status. Keine parallelen Schreiber.
- Vertrag bleibt unverändert: Folgewochen werden mit `replace: false` und ausschließlich den zu ändernden Tagen gespeichert. Keine Migration oder Änderung an Autorisierung, Ist-Zeiten oder Tagesbewertung.

## Ergebnis und Abnahme

- `followEntries` überspringt jeden Zieltag mit `blockedBy`, bevor vorhandene Pläne und die Überschreiboption geprüft werden. Leere markierte Tage bleiben leer; vorhandene Pläne bleiben vollständig erhalten, auch bei Überschreiben.
- Unmarkierte Tage behalten das bisherige Verhalten (Wochentag-Zuordnung, optionaler Schutz vorhandener Pläne, Mehrblock- und ältere Einzelblock-Verträge). `skippedExisting` zählt weiterhin nur wegen vorhandener Pläne übersprungene unmarkierte Tage.
- Der deutsche Dialoghinweis nennt jetzt auch Freistellung. Manuelle Planung an markierten Tagen bleibt gemäß PLAN-OFFDAY möglich.
- Unit-Regressionen für alle vier Markierungen, beide Überschreiboptionen, beide Vertragsvarianten und jeweils leere/beplante Zieltage; Zielobjekt unverändert geprüft.
- Neue Mock-E2E prüft beide Überschreiboptionen, ausgehende Schreibanfragen und unveränderte gespeicherte Zieltage. Feste Quell-/Zielwochen, `pinClock`/`unpinClock`, Zurücksetzen vor jedem Fall; keine relativen Segmentzeiten.

## Tatsächlich ausgeführte Prüfungen

Am 03.11.2026 auf dem Implementierungsstand dieses Branches:

- `npm run check`: Exit 0, 0 Fehler, 0 Warnungen (einschließlich Service-Worker-Typecheck).
- `npm test`: Exit 0, 132 Dateien, 1389 Tests grün.
- `npm run test:e2e:mock -- e2e-mock/follow-week.spec.ts e2e-mock/week-grid.spec.ts e2e-mock/plan-offday.spec.ts`: Mock-Produktionsbuild erfolgreich; Playwright Exit 1 vor Testbeginn, da die Sandbox den lokalen Testserver mit `listen EPERM` blockiert. Keine Browser-Testergebnisse.
- Derselbe Spec-Satz mit `npx playwright test -c playwright.mock.config.ts ... --list`: Exit 0, 14 Tests aus 3 Dateien erkannt (nur Erkennung, keine Ausführung).
- `git diff --check`: grün.

## Offene Punkte und nächster Schritt

- Die drei genannten Mock-Specs außerhalb der Sandbox mit erlaubtem lokalen Testserver ausführen. Vollständige Mock-Suite, echte Backend-E2E und PWA-Service-Worker-E2E hier nicht ausgeführt.
- Keine bekannten Codefehler; die neue Browser-Regression ist noch nicht ausgeführt. Keine laufenden Jobs oder Dienste, keine Migrationsfolgen.
- Den Commit aus der lokalen Repository-Kopie zur Lead-Prüfung übernehmen; danach erst Integration entscheiden. Kein Merge und kein Push durch diesen Auftrag.
