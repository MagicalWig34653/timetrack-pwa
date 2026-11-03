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

Historischer Prüfstand von `8c2076c` am 03.11.2026 (Nachprüfung unten):

- `npm ci --cache /private/tmp/tt-pwa-pkg/.npm-cache --no-audit --no-fund`: Registry nicht erreichbar (`ENOTFOUND`). Vorhandene `node_modules` anschließend lesend aus dem Hauptcheckout in den Klon kopiert; alle Prüfungen laufen auf dieser Kopie. Lockdatei unverändert. npm-Cache liegt ausschließlich im Klon.
- `npm run check`: Exit 0, 0 Fehler, 0 Warnungen, einschließlich Service-Worker-Typecheck.
- `npm test`: Exit 0, 132 Dateien, 1401 Tests grün (12 zusätzliche Regressionen). Im ersten Lauf waren vier neue Erwartungen an die Balkenskala zu präzise; auf die bestehende Rundung auf eine Nachkommastelle korrigiert, anschließend vollständige Suite grün.
- Playwright kann in der Sandbox wegen `EPERM` beim Start des lokalen Servers nicht laufen; keine Browser-Ausführung behauptet. `npm exec -- playwright test -c playwright.mock.config.ts e2e-mock/plan-offday.spec.ts e2e-mock/vacation-bookings.spec.ts --list`: Exit 0, 7 Tests in 2 Dateien erkannt (nur Erkennung).
- `git diff --check`: grün.

## Nachprüfung der zwei extern gemeldeten Mock-E2E-Fehler

Ausgangspunkt `8c2076c`, weiterhin Branch `pwa-offday`; ausschließlich im bestehenden Paketklon gearbeitet. Backend und Hauptcheckout nicht geändert, kein Push.

### Raster: vermeintlich deaktivierte Plus-Aktion

Im geprüften Quellstand hat `WeekGrid.svelte` an `button.wg-add` **keine** `disabled`-Bindung. `DayCard.svelte` ist die lesende Wochenkarte, nicht der Rastereditor. `grid-edit.ts` sperrt manuelle Änderungen nur außerhalb der Woche. Die verbleibenden `blockedBy`-Prüfungen im Raster betreffen Markierungs-Chips, Sollband und Differenzanzeige, keine Bearbeitungssperre. Deshalb keine weitere Produktionsbedingung entfernt; legitime Beschränkungen und die Folgewochen-Ausnahme bleiben erhalten.

Neue Komponentenregression `src/lib/components/week/WeekGrid.test.ts`: rendert Urlaub, Krank, Freistellung und Feiertag mit Soll 0, prüft aktivierte Plus-Aktionen und den jeweiligen Datums-Callback. Das prüft die zuvor nur in reinen Editierfunktionen abgedeckte Bindung am tatsächlichen Button.

`playwright.mock.config.ts` startet nur `scripts/serve-build.mjs build`, baut aber nicht neu. Ein direkter Playwright-Aufruf kann daher einen älteren Produktionsbuild testen. Der gemeldete deaktivierte Button passt nicht zum Quellstand; ein veralteter Build ist die naheliegende, ohne Browser-Ausführung noch nicht belegte Ursache. Vor der externen Wiederholung zwingend neu bauen (Befehle unten).

### Vergangener Urlaubstag: Fixture korrigiert

`DayCard.svelte` setzt `data-mark={day.mark}` direkt aus der Zeitwoche; die Darstellung bevorzugt keine Buchung vor einer Urlaubsmarkierung. Auch `mock/week.ts:markOf` priorisiert die bewertete Abwesenheit vor Ist-Zeit. Der separate Urlaubschip/Vorlesetext stammt aus der Abwesenheitsliste und erklärt, warum dort trotzdem Urlaub sichtbar war.

Die Fixture `2025-03-04` lag vor dem Demo-Arbeitsmodell (`mock/time.ts:seedDemo`: Beginn 60 Tage vor der Mock-Uhr). `mock/planning.ts:dayContext` leitet ohne gültiges Arbeitsmodell keine Urlaubsmarkierung ab; die Zeitwoche liefert bei vorhandener Buchung dann `work`. Für den beabsichtigten Test eines bewerteten Urlaubstags fehlte somit eine Voraussetzung. Die E2E-Fixture erweitert jetzt das Arbeitsmodell bis `2025-01-01` und stellt es im `finally` wieder her. Erwartung `vacation` bleibt bestehen, zusätzlich explizit an der API geprüft. Keine Umdeutung von Abwesenheitslisten im Client und keine Änderung der Mock-/Backend-Bewertung.

Neue Unit-Regression in `mock/week.test.ts` mit derselben gültigen Fixture prüft gemeinsam Urlaub, Ist 3:00, Plan 2:00, Plan/Ist +1:00, Soll 0 und Saldo +3:00. Das folgt PLAN-OFFDAY/VB1 für einen Urlaubstag im gültigen Arbeitsmodell. Gutschriften bleiben unberührt.

### Aktueller Prüfstand

Am 03.11.2026 nach den Korrekturen, alle Befehle mit Exit 0:

- `npm run check`: 0 Fehler, 0 Warnungen, einschließlich Service-Worker-Typecheck.
- `npm test`: 133 Dateien, 1403 Tests grün (zwei neue Regressionen).
- `VITE_MOCK=1 npm run build`: statischer Mock-Produktionsbuild erfolgreich; kein Browserlauf.
- `git diff --check`: grün.
- Playwright wie beauftragt wegen bekannter Sandbox-EPERM nicht ausgeführt. Beide externen Spec-Läufe bleiben offen. Auch Echt-Backend- und Service-Worker-E2E nicht ausgeführt.

Prüfprotokolle lokal unter `node_modules/.cache/pwa-offday/` (ignoriert, nicht im Commit). Keine laufenden Prüfjobs oder Dienste. Keine Migration oder Vertragsänderung.

### Extern erneut auszuführen

Im Paketklon nach Checkout des neuen Commits, zuerst den Produktionsbuild erneuern:

```sh
VITE_MOCK=1 npm run build
npx playwright test -c playwright.mock.config.ts e2e-mock/plan-offday.spec.ts
npx playwright test -c playwright.mock.config.ts e2e-mock/vacation-bookings.spec.ts
```

Beide vollständigen Spec-Dateien ausführen (serielle, aufeinander aufbauende Tests). Die Sandbox-Prüfung ersetzt diese Browserläufe nicht. Falls der Plus-Button nach frischem Build weiterhin deaktiviert ist, sind Build-Revision und der vom Browser tatsächlich geladene Stand zu prüfen; im aktuellen Quellcode existiert diese Bindung nicht.

## Rückfragen und Übergabe

Keine umsetzungsblockierenden Rückfragen. Gutschrift an Urlaubstagen bleibt eine offene Produktentscheidung außerhalb dieses Pakets; weder implementiert noch entschieden.

Nächster konkreter Schritt: außerhalb der Sandbox frisch bauen und die beiden Mock-Specs mit den Befehlen oben ausführen, danach Lead-Review und Integration des lokalen Commits. Echte Backend-E2E und Service-Worker-E2E nicht ausgeführt. Keine laufenden Dienste oder Migrationsfolgen; Klon samt lokalen Prüfprotokollen bleibt erhalten.
