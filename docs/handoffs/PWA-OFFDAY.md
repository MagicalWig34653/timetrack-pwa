# PWA-OFFDAY – PLAN-OFFDAY und VB1

Stand: 03.11.2026. Branch `pwa-offday`, Basis `ff06ddd`. Frischer Klon unter `/private/tmp/tt-pwa-pkg`; Hauptcheckout und Backend nur gelesen. Kein Push, keine Migration, keine neuen Abhängigkeiten oder Schalter.

## Auftrag und vorgefundener Stand

Maßgeblich: Backend `docs/handoffs/PLAN-OFFDAY.md`, ADR-0035 (Wertung weiterhin Vorschlag) und `docs/handoffs/VACATION-BOOKINGS.md` (VB1). Schon in der Basis enthalten: freie manuelle Planung an allen vier Markierungen, Server-Plansummen und Plan/Ist, erlaubte Buchungen und neutrale deutsche Hinweise. Alte Aussagen im historischen Handoff `VB1-pwa.md`, Planung sei gesperrt und Plan/Ist immer null, sind überholt; siehe auch `PLAN-OFFDAY-pwa.md`.

Die ausdrücklich beschlossene Ausnahme `FOLLOW-WEEK.md` bleibt bestehen: Folgewochen-Kopie überspringt markierte Zieltage auch beim Überschreiben. Standardwoche und „Gleich für alle Arbeitstage“ bleiben auf Arbeitstage beschränkt. Keine Änderung an Gutschriften, Urlaubsverbrauch, Saldo-Berechnung oder Rückgabe von Urlaub. Die Produktfrage zu Gutschriften an Urlaubstagen bleibt unentschieden.

## Änderungen

- `WeekGrid.svelte`: Schraffur und Sonderhintergrund der ganzen markierten Spalte entfernt. Markierungs-Chips bleiben sichtbar; Zeitraster, Gesten und Plus-Aktion bleiben bedienbar. Keine einseitigen Akzentrahmen.
- `grid-edit.ts`: überholte Sperr-Kommentare berichtigt, Wochenbereichsprüfung passend benannt. Keine erneute Tagesprüfung eingeführt.
- `DayCard.svelte` / `overview.ts`: Planmodus sowie Blockdetails im Vorlesetext auch neben Urlaub/Krank/Freistellung/Feiertag sichtbar. Server-Differenz und Ist bleiben erhalten. Bestehende neutrale Hinweise unverändert über i18n.
- Unit-Regressionen: alle vier Markierungen, Mehrblock- und älterer Einzelblock-Vertrag, Anlegen/Bearbeiten/Vergrößern/Kopieren/Verschieben/Einfügen/Löschen sowie Markierung und unveränderte Eingabedaten; Planmodus, Blockdetails und Plan/Ist im Vorlesetext und Planskala.
- Mock-E2E: Freistellung zusätzlich zu Urlaub/Krank/Feiertag/Halbtag, keine Sperr-Schraffur und bedienbarer Cursor; vergangener Urlaubstag mit Plan und Buchung zeigt Ist, positiven Saldo und Plan/Ist-Differenz zugleich. Keine Änderung der Mock-Bewertung nötig (bereits Vertrag 0.44.0).

## Prüfungen

Prüfstand auf diesem Branch am 03.11.2026:

- `npm ci --cache /private/tmp/tt-pwa-pkg/.npm-cache --no-audit --no-fund`: Registry nicht erreichbar (`ENOTFOUND`). Vorhandene `node_modules` anschließend lesend aus dem Hauptcheckout in den Klon kopiert; alle Prüfungen laufen auf dieser Kopie. Lockdatei unverändert. npm-Cache liegt ausschließlich im Klon.
- `npm run check`: Exit 0, 0 Fehler, 0 Warnungen, einschließlich Service-Worker-Typecheck.
- `npm test`: Exit 0, 132 Dateien, 1401 Tests grün (12 zusätzliche Regressionen). Im ersten Lauf waren vier neue Erwartungen an die Balkenskala zu präzise; auf die bestehende Rundung auf eine Nachkommastelle korrigiert, anschließend vollständige Suite grün.
- Playwright kann in der Sandbox wegen `EPERM` beim Start des lokalen Servers nicht laufen; keine Browser-Ausführung behauptet. `npm exec -- playwright test -c playwright.mock.config.ts e2e-mock/plan-offday.spec.ts e2e-mock/vacation-bookings.spec.ts --list`: Exit 0, 7 Tests in 2 Dateien erkannt (nur Erkennung).
- `git diff --check`: grün.

## Rückfragen und Übergabe

Keine umsetzungsblockierenden Rückfragen. Gutschrift an Urlaubstagen bleibt eine offene Produktentscheidung außerhalb dieses Pakets; weder implementiert noch entschieden.

Nächster konkreter Schritt: außerhalb der Sandbox die beiden Mock-Specs ausführen, danach Lead-Review und Integration des lokalen Commits. Echte Backend-E2E und Service-Worker-E2E nicht ausgeführt. Keine laufenden Dienste oder Migrationsfolgen; Klon samt lokalen Prüfprotokollen bleibt erhalten.
