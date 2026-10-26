# Handoff J2-pwa: Seite springt weiterhin beim Menüwechsel

Stand: 26.10.2026. Branch `j2-layout-jump` (auf main 1fadfe7), nicht gepusht, nicht gemergt. Backend unverändert.

## Messung
Alle 40 Routen (14 Hauptseiten, 3 Admin, 22 Einstellungen plus `/admin/mail`) per Client-Navigation besucht, Chromium mit klassischen Scrollleisten, vier Fenstergrößen (1280x800, 1280x1400, 900x800, 390x800). Gemessen: Box von `<main>`, Seitenleiste, Einstellungs-Inhaltsspalte, `h1`, horizontaler Überlauf, `scrollY`, jeweils direkt nach dem URL-Wechsel und nach dem Laden.
Ergebnis vor der Änderung: Breite/Position von `<main>`, Seitenleiste und Titel waren seit J1 überall gleich (keine Scrollleistenverschiebung mehr). Gefunden wurden:

## Ursachen
1. **Neuaufbau der Einstellungsnavigation bei jedem Wechsel** (Hauptursache): `{#key page.url.pathname}` im App-Layout umschloss auch das Einstellungs-Layout. Die Navigation wurde bei jedem Klick zerstört und neu erzeugt; ihre eigene Scrollposition (`overflow-y-auto`, relevant bei niedrigen Fenstern) sprang auf 0, Fokus ging verloren. Nachgewiesen mit Markierung am DOM-Knoten (`lost`, Scroll 200 -> 0).
2. **`/stats` lief auf Telefon (317 px) und Tablet (81 px) seitlich über**: Grid ohne `grid-cols-1` (Spalte `auto`), die Diagramme messen ihre Breite selbst und hielten sich dadurch gegenseitig breit. Seitliches Überlaufen verschiebt die ganze Seite.

Nicht ursächlich (geprüft): Breite/x von `main`, Seitenleiste und Titel-y über alle Routen, Titel springt nicht beim Laden, kein Seitenübergang.

## Änderungen
- `src/lib/nav.ts`: `sectionShell(pathname)`; `src/routes/(app)/+layout.svelte`: Key = Bereich (settings, `/admin/mail`) statt voller Pfad.
- `SettingsShell.svelte`: Key und Fehlergrenze pro Seite jetzt innerhalb der Inhaltsspalte (Navigation bleibt stehen, Fehler bleibt auf den Inhalt begrenzt).
- `stats/+page.svelte`: `grid-cols-1`.
- Neue Spec `e2e-mock/layout-routes.spec.ts`: alle Routen vorwärts und rückwärts (je 80 Besuche) in vier Fenstern, prüft `main`-x/Breite, Seitenleiste, Überlauf, Titel beim Laden, Inhaltsspalte der Einstellungen; plus Test, dass die Navigation (DOM-Knoten, Scrollposition) beim Seitenwechsel erhalten bleibt.

## Offen
- Echte Safari/iOS-Prüfung (dort Overlay-Scrollleisten). Zwischen `/settings/*` und `/admin/mail` (anderer Layout-Baum) wird die Navigation weiterhin neu erzeugt, optisch identisch.
- Hoehenspruenge durch Skeletons unterhalb des Titels wurden nicht angefasst (Titel und Spalte bewegen sich nicht).
- Scrollposition springt bei neuer Unterseite auf 0 (gewollt).

## Verifikation
`npm run check` 0 Fehler, `npm test` 1122 grün, `npm run test:e2e:mock`: 178 grün, 80 übersprungen (Screenshot-Fälle), danach Spec-Korrektur und Neulauf der Layout-Specs (11 grün). Ohne die Layout-Änderung schlägt der Persistenz-Test fehl (Gegenprobe).
