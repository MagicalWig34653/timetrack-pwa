# U1-pwa: Kalender und Planer im Viewport (29.10.2026, Branch u1-calendar-planner)

## Was sich geändert hat
- **Monatskalender (`/calendar`)**: Mini-Zeitleisten (`MiniTimeline`) sind entfernt (Komponente, `planBars`/`actualBar`/`lineSpan` aus `cell-model.ts`). Eine Zelle zeigt die Tageszahl und kompakte Pills (`planning/month-pills.ts`): Abwesenheit, Feiertag, Schulferien, Planart; so viele, wie die gemessene Zeilenhöhe zulässt, der Rest als „+n“. Erfasste Zeit steht nur noch im Tagespanel und im zugänglichen Namen.
- **Raster im Stil iOS/Google**: ARIA-Grid aus CSS Grid (Kopfzeile Wochentage, KW-Spalte mit Wochensaldo, Wochenende und Nachbarmonat gedimmt, Heute als Ring um die Tageszahl, Hover-/Fokuszustände, weiche Einblendung beim Monatswechsel ohne Neuaufbau des Rasters). Mehrtägige Abwesenheiten sind **ein durchgehender Balken pro Kalenderwoche**: jedes Tagessegment reicht über die Zellränder, nur das erste Segment einer Woche trägt das (gekürzte) Label; geplant/beantragt schraffiert, genehmigt voll; Ziehen/Verschieben/Größe wie zuvor (Griffe erst bei Hover sichtbar).
- **Viewport-Layout** (neue Tailwind-Variante `fit` = ab 1280 x 640, `src/routes/layout.css`): Seite = `100dvh - 60px - 4.5rem`, kompakte Kopfzeile (`PageHeader compact`), Werkzeugleiste, einzeilige Monatsübersicht, Raster mit gleich hohen Zeilen (`1fr`), Tagespanel als feste Spalte (19 rem) rechts, Legende/Filter als Popover, Meldungen als Toast. Unterhalb (Tablet, Phone) scrollt die Seite wie bisher; Phone behält Punktemonat + Wochenliste (ohne Zeitleisten).
- **Ein Umschalter**: neue Komponente `components/app/Segmented.svelte` (aria-pressed-Gruppe). Kalender: Monat | Jahr; Planer: Raster | Liste (ersetzt die zwei eigenen Varianten).
- **Wochenmodus entfernt** (`?view=week` wird ignoriert). „Woche öffnen“: KW-Zahl ist ein Link, im Tagespanel der Button „Woche öffnen“ (`/week?week=<ISO>&day=<Tag>`), Taste `W`; Tasten `M`/`J` für Monat/Jahr.
- **Planer (`/plan`)**: auf `fit` füllt er die Höhe: Kopfzeile mit Titel, Tabs und Wochennavigation in einer Zeile, Wochensumme, Aktionen (ab 1600 px mit Text, sonst Icons mit Titel) und Umschalter in einer Zeile, Werkzeugleiste, Raster = Resthöhe (scrollt innen), Speichern-Leiste klebt unten (kompakt). Die Bedienungshilfe ist ein Popover neben dem Hinweisfeld. Listenansicht scrollt intern.
- Absolut positionierte Screenreader-Labels in intern scrollenden Containern ließen die Seite scrollen; die Container sind jetzt `relative`.

## Tests
- Unit: `month-pills.test.ts` (6), `cell-model.test.ts` angepasst; `planning-pages.test.ts` (Balken statt Label je Tag).
- Mock-E2E `e2e-mock/u1-fit.spec.ts`: kein Seitenscroll (`scrollHeight <= Viewport`) für `/calendar` (3 Monate, mit Auswahl, Jahr) und `/plan` (Raster, Liste) auf 1366x768 und 1920x1080, Phone 390x844 ohne horizontalen Überlauf, Umschalter Monat/Jahr ohne Woche/Zeitleisten, KW-Link und „Woche öffnen“, durchgehender Abwesenheitsbalken, Hover/Fokus, axe hell/dunkel (1366x768), Screenshots (`SCREENSHOT_DIR`). Angepasst: `c2-month`, `absences-p5`.

## Offen / nicht geprüft
- Kein echtes Touch-Gerät, kein echtes Backend (nur Mock).
- Fokus-Pixeltests nur über Playwright-Viewports; Zwischengrößen 1280–1365 px nicht einzeln gemessen.
- Auf 1366x768 zeigt das Planerraster etwa 6 Stunden gleichzeitig (Rest scrollt im Raster).
