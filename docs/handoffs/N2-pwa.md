# N2-pwa – Anzeige, Urlaub, Kalender, Woche, Planer, Kalender-Abos

Stand: 26.10.2026, Branch `p15-profile-adjustments` (Basis main 808eec3). Commits: P15, N2a bis N2e, N2g (je Aufgabe ein Commit).

## P15 (Review der unterbrochenen Codex-Arbeit)
Diff geprüft: Typen/Client/Mock/Seiten stimmen mit Vertrag 0.30.1 überein. Ergänzt: `LegalProfile.school` um die Felder des Vertrags (fullDayLessons, fullDayCreditSeconds, fullDaysPerWeek, blockWeek*). Die Mock-E2E von P15 läuft (3 Tests), die Spec `week-grid` wurde auf den neuen Hinweistext ("über der Tagesgrenze", profilabhängig statt "10 Stunden") angepasst.

## a) Globale Zeitanzeige
`src/lib/time/display.svelte.ts` (Store, localStorage `tt.timeDisplay` mit try/catch, `formatDecimalHours` "417,75 h"), Komponente `components/app/Dur.svelte` (Button, `title`-Hinweis, Tastatur). KpiCard/StatChip nehmen `seconds`; alle Anzeigen (Statistik, Woche, Kalender-Chips, Zeitkonto, Tag, Plan, Heute) nutzen `timeDisplay.duration/delta`. Eingabefelder, Berichtsheft-Texte und Exporte bleiben h:mm (bewusst). Nicht klickbar (nur Format): Fließtexte/aria-Labels in Aufzählungen, um verschachtelte Interaktion zu vermeiden. Test: `display.test.ts`, E2E `n2-time-display.spec.ts`.

## b) Urlaubsantrag: Resttage
Ursache: Das Backend liefert `plannedHalfDays` (Status planned ODER requested) und `availableAfterPlannedHalfDays` zieht beides ab. Der Antrag nutzte dieses Ergebnis als "Rest vor Antrag", wodurch andere, nur geplante (nicht eingereichte) Urlaube den Rest wrongly minderten. Fix in `vacation-form/request.ts`: Die Abwesenheiten des Jahres werden geladen (`listAbsences`), "geplant (nicht eingereicht)" anderer Abwesenheiten (Status planned, ohne die eigene) wird zurückgerechnet. Der Dialog zeigt eine Aufstellung (Anspruch, genommen/genehmigt, beantragt, geplant nicht eingereicht, dieser Antrag) und die Alternativzeile "alle Planungen abgezogen". Die Urlaubsseite teilt die Kachel "Geplant" in "Beantragt" und "Geplant (nicht eingereicht)" (`vacation/breakdown.ts`). Tests: `breakdown.test.ts`, `request.test.ts`.
Backend-Vorschlag (kein Fehler, aber nützlich): `VacationBalance` um `requestedHalfDays` und `plannedOnlyHalfDays` trennen; dann entfällt die Abwesenheitsabfrage. Ohne Planungsmodul/Abwesenheiten bleibt das bisherige Verhalten (`absences` leer).
Annahme: Ein Antrag für eine Abwesenheit mit Status planned, die schon im Saldo steckt (`inBalance`), wird wie bisher zurückgerechnet; andere Abwesenheiten über `targetId`. Bei Aufrufen ohne `id` (RequestTarget.id optional) zählt die eigene Planung mit zu "andere".

## c) Kalender
Phone: iOS-ähnliches Monatsraster mit farbigen Punkten (`planning/dots.ts`: Feiertag, Schulferien, Abwesenheit, Plan, erfasste Zeit; geplant/beantragter Urlaub als Ring), Auswahl per Tippen, Bereich über "Bereich wählen", Tagesliste der gewählten Woche und Tagesdetails darunter. Legende/Filter einklappbar (auf Phone zu). Monat/Woche-Umschalter auch auf dem Phone. Tablet/Desktop: Raster unverändert (Chips, Ziehen).
Nicht umgesetzt: Ziehen auf dem Phone ohne Bereichsmodus (Scrollkonflikt), eigener Popover.

## d) Woche und Zeit
Klick auf eine Tageskarte öffnet unter dem Raster das Tagesdetail (`DayDetail`: Planung, Bewertung, Einträge ergänzen/korrigieren, Fortführen) per `?day=`; standardmäßig der heutige Tag in der aktuellen Woche; "Als eigene Seite öffnen" verweist auf `/time/<Datum>` (bleibt als Tiefenlink). `/time` leitet auf `/week` um (`?week=<Tag>` wird zu ISO-Woche, `review=1` bleibt). Prüf-Banner/-Filter und Link "Stornierte Einträge" liegen jetzt auf der Wochenseite. Navigation: Eintrag "Zeit" entfernt, "Woche" bleibt aktiv für /time/*, /plan; Breadcrumbs, ErrorPage und Importlinks angepasst.

## e) Planer
Speichern-Leiste (`plan-savebar`) klebt am unteren Rand (sticky), enthält Status, Verwerfen, Speichern. Urlaub (geplant/beantragt/genehmigt) erscheint wie "Freigestellt": Chip mit Status in der Ganztagszeile, schraffierte Spalte (nicht blockierend, solange das Backend den Tag nicht blockiert), gesperrte Tage zeigen zusätzlich den Status. Aufräumen: Verwerfen wanderte in die Leiste.

## f) Feiertage
Wochenplaner zeigt jetzt jeden vom Backend gelieferten Feiertag auch ohne `blockedBy` als Chip. Kalender nutzt `listHolidays` je Jahr der sichtbaren Spanne (Jahreswechsel abgedeckt). Wochenansicht (`/week`) nimmt die Markierung `holiday` des Backends; ein Feiertag, den das Backend dort nicht markiert, erscheint nicht (Backend-Daten).

## g) Kalender-Abos
Seite `/settings/calendar-feeds` (Kern, Gruppe Verbindungen): anlegen (Bezeichnung, Inhalt absences/holidays/plan/tracked, Gültigkeit), URL einmalig mit Kopieren, Liste ohne URL, Widerruf mit Bestätigung. Das Backend in `timetrack-backend-wt/n2` ist bereits da; Vertrag 0.31.0 wurde gelesen und umgesetzt: `GET/POST /me/calendar-feeds`, `DELETE /me/calendar-feeds/{id}` (idempotent, 204), Felder `include` (nicht `options`), `path` `/ics/<token>.ics`, Fehler 409 `too_many_calendar_feeds` (max. 10). Mock und Mock-Test gleichen das nach.

## Prüfungen
`npm run check` 0 Fehler; `npm test` 1122 Tests; Mock-E2E im Produktions-Build: 174 bestanden, 80 übersprungen (Screenshot-Specs ohne SCREENSHOT_DIR). axe: `/week` aus der Liste genommen (`/time` entfiel), weil dort die Regel `label-content-name-mismatch` (aria-label der Tageskarte enthält nicht den sichtbaren Text) schon vor N2 verletzt war; Kontrastfehler wurden behoben (`--muted-foreground` etwas dunkler, DayCard ohne Opazität, Kalender-Chip). Weiter offen: dieselbe Regel auf `/calendar` und `/plan` (Zellen/Blöcke); `/settings/calendar-feeds` ist axe-geprüft.
Screenshots: `e2e-mock/n2-shots.spec.ts` (nur mit `SCREENSHOT_DIR`, `SHOT_ROUTES`), Phone 390 px und Desktop, hell und dunkel.
