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

## Nachtrag 26.11.2026: Markieren per Ziehen in der Monatsansicht (Review Lino)
Lino meinte das Markieren mehrerer Tage mit gedrückter Maustaste im Monatsraster.
- Ursache: Auswahl und Ziehvorschau nutzten Tailwind-Klassen (`ring-2`, `bg-primary/10`). Die Zellregeln `.cell-vac-open`,
  `.cell-vac-booked` (box-shadow) und `.cell-holiday` (Hintergrund) liegen außerhalb der Tailwind-Ebenen und gewinnen immer.
  Daher fehlte Urlaubstagen der Auswahlrahmen, ein Feiertag blieb bernsteinfarben, und der Tag unter dem Mauszeiger wurde durch
  die Hover-Farbe grau. Dasselbe galt im Handy-Raster.
- Fix (`CalendarBoard.svelte`): eigene Regeln `.cell-selected` und `.cell-ghost` (mit `data-ghost` für Warnung/Sperre) auf derselben
  Ebene wie die Zellregeln, mit Vorrang vor Tönung und Hover. Pillen behalten ihre Farbe.
- Test: `e2e-mock/drag-select-visible.spec.ts` (Mo normal, Di Urlaub genehmigt, Mi Urlaub geplant, Do Feiertag; Ziehen, Zeiger bleibt
  auf dem letzten Tag; während und nach dem Ziehen gleiche Hervorhebung, hell und dunkel). Vor dem Fix rot, danach grün.
- Prüfstand: `npm run check` 0/0, `npm test` 1432 grün, Mock-E2E 280 bestanden, 0 Fehler.
