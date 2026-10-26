# N4-pwa – Betriebstage 24.12./31.12. (PWA)

Branch `n4-company-days` (von `main`), Vertrag 0.32.0, Backend: ADR-0029, Handoff N4-backend.

## Umgesetzt
- Einstellungen (Seite Urlaub, Formular „Einstellungen“): Gruppe „Betriebstage“ mit Auswahl Keine/Halber Tag/Ganzer Tag für Heiligabend und Silvester, eigene feste Tag.Monat.-Regeln mit Name hinzufügen/entfernen (höchstens 12 insgesamt). Prüfung wie im Backend (ungültiges Datum, 29.02., doppelt, Name über 80, mehr als 12), Fehler je Zeile. PUT sendet immer `companyDays`.
- Anzeige: neue Komponente `HolidayBadge` (Flagge, Name; `half` mit ½, gestricheltem Rand, Tooltip „Heiligabend – halber Betriebstag, Soll halbiert“ und Screenreader-Text). Eingebaut in Wochenkarte (Markierung bleibt Arbeit bei `half`; bei `full` ersetzt der Name den Chip „Feiertag“), Aria-Label der Wochenkarte, Tagespanel, Kalender (Chips, Tooltip, Zellenname, hohler Punkt bei `half`), Plan-Raster (Chip mit ½), Plan-Liste (PlanRow).
- Typen: `CompanyDay`, `VacationSettings.companyDays`, `CalendarDay.companyTreatment`, `TimeWeekDay.holidayName`/`companyDayTreatment`.
- Mock: Einstellungen mit Standardliste und Validierung (PUT ohne Feld behält), Feiertagsliste mit `companyTreatment`, Soll halbiert/0, Wochenfelder, Urlaubszählung (half höchstens 1, full 0), Vorschläge (nur full).
- Nicht geändert: Statistik und Urlaubsplaner-Zeitleiste (folgen dem Backend; Planer-Feiertage kommen aus den Vorschlägen, dort zählt nur `full`).

## Prüfung
`npm run check` 0 Fehler/Warnungen; `npm test` 1149 Tests (neu: company-days, dots, overview, mock/company-days); `npm run test:e2e:mock` 174 Specs (neu: `e2e-mock/n4-company-days.spec.ts`, 3 Specs inkl. axe 390 px/Desktop hell/dunkel; Screenshots mit `SCREENSHOT_DIR`, Namen `n4-*`). Ein einmaliger Fehlschlag in `transfer.spec.ts` (Rollback) im Gesamtlauf ist einzeln und auf unverändertem Stand grün (flaky).

## Nicht geprüft
Echt-E2E gegen das Backend 0.32.0, native Apps, Urlaubsplaner-Anzeige von `half`-Tagen, Statistikseite.
