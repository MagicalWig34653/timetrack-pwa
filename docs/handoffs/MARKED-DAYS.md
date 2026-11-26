# MARKED-DAYS: markierte Urlaubstage wieder hervorgehoben (26.11.2026)

Meldung Lino 26.11.: Markierte Urlaubstage werden im Kalender nicht hervorgehoben.

## Ursache
- Monatskalender (`/calendar`), Jahresansicht und Handy-Raster waren korrekt: im Mock und gegen das echte Swift-Backend
  geprüft (Urlaub geplant/genehmigt, Krank, Freistellung, Feiertag hell und dunkel getönt).
- Fehler im Wochenplaner-Raster (`/plan`, `WeekGrid.svelte`): Commit `8c2076c` (PWA-OFFDAY) hat mit der Sperr-Schraffur die
  ganze Regel `.wg-col[data-blocked]` gelöscht. Spalten mit genehmigtem Urlaub, Krank, Freistellung oder Feiertag sahen
  danach wie normale Arbeitstage aus; nur geplanter/beantragter Urlaub (`data-vacation`) blieb schraffiert.

## Warum kein Test anschlug
- `plan-offday.spec.ts` prüfte nur, dass die Schraffur weg ist (`not.toHaveCSS(... repeating-linear-gradient)`), nie, dass die
  Markierung sichtbar bleibt. Unit-Tests prüfen Attribute (`data-blocked`), nicht die Darstellung.
- `vacation-visible.spec.ts` prüfte nur den Monatskalender, nur hell.

## Fix
- `WeekGrid.svelte`: ruhige Tönung je Art (Urlaub himmelblau, Krank rosé, Freistellung petrol, Feiertag bernstein) in der
  Farbe des Kopf-Chips, keine Schraffur, Zeiger bleibt `crosshair` (Planung bleibt erlaubt, ADR-0035).
- Neue E2E `e2e-mock/marked-days-visible.spec.ts`: markiert Urlaub im Kalender per UI, prüft Tönung im Monatsraster und
  im Planer (vier Arten, eigene Tönung je Art, geplanter Urlaub schraffiert), hell und dunkel; Screenshots mit `SCREENSHOT_DIR`.
  Vor dem Fix rot (`excused column is tinted (rgba(0, 0, 0, 0))`), danach grün.

## Nebenbefund (CI rot seit 23.11.)
- Mock-Seed legte die geplante Urlaubsabwesenheit bei Montag+42 Tagen an; ab Ende November liegt sie im Folgejahr und
  `/absences` (ein Jahr) zeigte 3 statt 4 Zeilen (`absences-p5`, `absences-filter-stability`, `vacation-form` rot).
- `mock/planning.ts`: nur eine Abwesenheit, die aus dem laufenden Jahr fiele, rückt wochenweise ins Jahr (ohne
  Überschneidung); die übrigen behalten ihr Datum. Unit-Tests in `mock/planning.test.ts` (rot, dann grün).

## Prüfstand
- `npm run check` 0/0, `npm test` 1432 grün, komplette Mock-E2E 277 bestanden, 0 Fehler.
- Offen (nicht Teil dieses Pakets): optionaler CI-Job „real backend“ hat mehrere fremde Fehler, u. a.
  `e2e/absences-p5.spec.ts` erwartet die Kachel-Legende geöffnet (Legende ist inzwischen eingeklappt).
