# Handoff VB1-pwa: Buchungen an Urlaubstagen

Branch `vacation-bookings`, Backend-ADR-0034 (Vorschlag, keine bestätigte Nutzerentscheidung) und Backend-Handoff `docs/handoffs/VACATION-BOOKINGS.md`. Keine Vertragsänderung.

## Befund

Die PWA hatte für **Buchungen** (Timer-Start auf Heute, „Eintrag manuell ergänzen“ in Tages-/Wochenpanel und Tagesseite, Segmentformular, Kontextmenü der Segmente) **keine Sperre**: keine Prüfung auf `mark`/Absenz, keine deaktivierte Schaltfläche, kein Fehlertext. Das gilt auch für Krank, Freistellung und Feiertag (ebenfalls nichts zu entfernen). Der Mock lehnt wie das Backend nichts ab. Belegt durch die neue Mock-E2E.

Die einzige Sperre auf Blocktagen betrifft die **Planung** (Wochenplaner `WeekGrid`/`grid-edit.ts`: „Block hinzufügen“ deaktiviert, Malen/Verschieben/Einfügen überspringt Tage mit `blockedBy`; Kalender-Überschneidungshinweis `pd.blocked` für Abwesenheiten). Das ist bewusst Backend-Verhalten (`PlanWeekDay.blockedBy`, geplante Zeit zählt dort 0) und **nicht** geändert: Planen auf einem Urlaubstag würde im Plan nichts zählen. Offene Frage an den Nutzer, falls auch das gewünscht ist.

## Geändert

- `src/lib/time/off-day-booking.ts` (+ Test): leitet aus `mark` in {vacation, sick, excused, holiday} und `workSeconds`/`rawWorkSeconds` > 0 bzw. `segmentsCount` > 0 einen Hinweis ab.
- Hinweistexte (`day.off_booking_*`, `weekview.off_booking`): „Buchung an Urlaubstag: Die gebuchte Zeit zählt als Überstunde.“ (analog Krankheits-, Freistellungs-, Feiertag).
- `DaySummary` (Heute-Seite, Tagespanel, Tagesseite): ruhiger Hinweis als gedämpfte Textzeile. `DayCard` (Woche): neutraler Chip „Überstunde“ mit Tooltip (kein Rahmen/Balken) und Hinweis im aria-Label.
- Monatsraster (Desktop): Pille „Ist h:mm“ nach den Abwesenheiten an Tagen mit Abwesenheit/Feiertag und gebuchter Zeit (`month-pills.ts`, filterbar über den Legendenschlüssel `worked`); vorher zeigte das Raster dort keine Ist-Zeit. Handy-Punkte, Tageschips, Wochenkarte (Stunden, Saldo) und Statistik zeigten das Ist schon bei Urlaub.
- Plan-Ist-Differenz: bleibt `null` an blockierten Tagen, die Karte zeigt dann nur Ist und Saldo (E2E prüft, dass `day-plan-diff` fehlt).
- Der Urlaubstag bleibt Urlaub (Chip/Markierung/Verbrauch unverändert); keine „Urlaub zurückgeben“-Logik.

## Tests

Unit: `off-day-booking.test.ts`, `day-summary.test.ts`, `month-pills.test.ts`, `overview.test.ts`. Mock-E2E `e2e-mock/vacation-bookings.spec.ts`: manueller Eintrag am ganzen und halben Urlaubstag, Wochenkarte und Monatspille, Timer-Start auf Heute an einem Urlaubstag (räumt Absenz und Eintrag danach weg). Mock-Daten brauchten keine Änderung (Auswertung rechnet Buchungen am Urlaubstag bereits voll).

## Offen

Planen auf Blocktagen (siehe oben); Geräteprüfung gegen das echte Backend; Apple-Apps getrennt prüfen (dort liegt die vom Nutzer erlebte Sperre womöglich).
