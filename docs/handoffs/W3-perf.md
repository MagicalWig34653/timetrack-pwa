# W3-perf – schnelleres Wochenwechseln in /week

Stand: 27.10.2026, Branch `w3-week-perf` (Basis main 96d2c67), nicht gemergt.

## Messung vorher (Mock-Build, 150 ms Latenz je GET)
- Kaltstart `/week`: 15 GET, Inhalt nach ca. 840 ms. Stufen: modules, work-models, absences, suggestions, notifications (parallel) -> time/weeks + time/days -> Tagespanel (holidays, absences, plan/days, places (2x), time/days/{d}, segments) -> legal-profiles.
- Wechsel auf eine andere Woche: 4 GET (absences, suggestions, time/weeks, time/days), alle parallel, aber leeres Skelett bis zur Antwort (ein Roundtrip, ca. 150-190 ms).
- Wechsel auf die aktuelle Woche (Tag vorausgewählt): 12 GET, die Tagespanel-Daten (holidays, places 2x, legal-profiles, plan, absences, day, segments) wurden bei jedem Rücksprung neu geladen, in drei Stufen (ca. 360 ms bis alles da).
- Ursachen: Skelett bei jedem Wechsel (`load = loading`); Referenzdaten (Feiertage, Orte, Arbeitsmodelle, Rechtsprofile) ohne Cache; `setCsrfToken` leerte den Lesecache bei jedem Sitzungs-Refresh (der bestehende 30-s-Cache griff daher kaum).

## Änderungen
- `api/client.ts`: `cachedRead` exportiert mit TTL-Parameter; Referenzdaten (holidays je Jahr/Region, places, work-models, legal-profiles) 5 min, `listDays`/`listAbsences` je Bereich 30 s; parallele Aufrufe teilen dieselbe Promise (Dedupe). Jeder erfolgreiche Schreibzugriff, Login/Logout/Kontowechsel (geänderter CSRF-Token) leert den Cache. `setCsrfToken` leert nur noch bei geändertem Token.
- `week/prefetch.ts`: nach dem Rendern der Woche werden nächste und vorherige Woche (time/weeks, time/days, absences) im Leerlauf nacheinander in den Cache geladen; Abbruch bei Navigation (nicht gestartete Ladevorgänge entfallen, Fehler werden ignoriert).
- `/week`: Stale-while-revalidate – die bisherige Woche bleibt abgedunkelt (`opacity-60`, `aria-busy`) sichtbar, bis die neue da ist; Skelett nur beim allerersten Laden; Urlaubsdaten werden beim Wechsel nicht mehr geleert; Fehler zeigen weiterhin den Fehlerzustand; veraltete Antworten werden verworfen (Zielwoche-Vergleich, wie zuvor); `data-week` zeigt die tatsächlich angezeigte Woche.
- Abbruch laufender HTTP-Requests (AbortSignal) ist bewusst nicht umgesetzt: `request()` kennt kein Signal, und Prefetch-Antworten sollen im Cache landen. Superseded Antworten werden verworfen.

## Messung nachher (gleiches Szenario)
- Wechsel auf vorab geladene Nachbarwoche: 0 Roundtrips bis zum Inhalt (Test fordert < 300 ms bei 150 ms Latenz, kein Skelett); danach nur der Prefetch der neuen Nachbarwoche (3 GET); keine Anfragen für holidays, places, work-models; insgesamt <= 8 GET.
- Rücksprung auf die aktuelle Woche: vorher 12 GET, nachher aus dem Cache (0 für Referenzdaten).
- Wechsel auf nicht vorgeladene Woche: ein Roundtrip (ca. 150-190 ms), Vorwoche bleibt sichtbar.

## Tests
`week/prefetch.test.ts`, Ergänzungen in `api/client.test.ts` (Cache/Dedupe/Invalidierung, Token), Mock-E2E `e2e-mock/w3-week-perf.spec.ts`.

## Backend (nur Empfehlung, nicht geändert)
`GET /time/weeks/{w}` (`TimeWeek.swift`) ruft `days.snapshot()` ohne Fenster auf: gesamte Segment- und Abwesenheitshistorie plus alle Anpassungen werden je Aufruf geladen und für Tage sowie zwei Kontostände ausgewertet (konstante Statementzahl, aber Last wächst mit der Historie). `GET /time/days` lädt zusätzlich je Aufruf einen Snapshot. Empfehlung: Kontostand-Anfang je Woche cachen/inkrementell (z. B. Zwischenstand pro Monat), `time/days` und `time/weeks` einen gemeinsamen Snapshot teilen lassen. Es liegen keine Zahlen vor (nicht gemessen, nur Codeanalyse). Weiter: `/time/suggestions` und `/notifications` werden bei jeder Navigation vom Layout abgefragt (nicht geändert).

## Offen / ungeprüft
Keine Messung gegen das echte Backend und große Historien; Prefetch erhöht dort die Last um zwei Wochenabfragen je Seitenaufruf. Die Cache-TTL 30 s kann Änderungen anderer Geräte kurz verzögern.
