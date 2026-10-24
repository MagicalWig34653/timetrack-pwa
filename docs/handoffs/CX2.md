# CX2 – Stabilität, Lizenzbeilage und Barrierefreiheit

Branch: `cx2-stability`. Nur der PWA-Worktree wurde geändert. Kein Backend-
Vertrag und keine Route wurden verändert.

Der Commit ist in dieser Umgebung blockiert: Git kann die außerhalb des
beschreibbaren Worktrees liegende Worktree-Indexdatei nicht sperren
(`index.lock: Operation not permitted`). Die Änderungen liegen deshalb
unstaged im Worktree.

## Änderungen

- Mock-E2E läuft gegen den gebauten statischen Client (`VITE_MOCK=1`) und die
  Mock-API in `scripts/serve-build.mjs`. Der Server bietet nur mit `TEST_HOOKS=1`
  einen Reset-Endpunkt. Das automatische Playwright-Fixture setzt den gesamten
  Mock-Zustand vor jeder Spec-Datei zurück. Tests derselben Datei behalten den
  Zustand für ihre mehrstufigen Szenarien. Die Anmeldeseite wird im globalen Setup
  geladen, bevor Tests beginnen. Ein Worker, 120 Sekunden Testlimit und
  20 Sekunden Aktionslimit sind festgelegt.
- Vitest-Tests erhalten 30 Sekunden für Tests und Hooks. Der Push-E2E hat
  120 Sekunden.
- `scripts/generate-licenses.mjs` erzeugt bei jedem Build die Beilage
  `static/THIRD-PARTY-NOTICES.txt`; der Hilfe-Dialog verlinkt sie. Ein Unit-Test
  prüft Paketversionen, PDF.js-Hinweis und Inter-Lizenz.
- `@axe-core/playwright` 4.14.0 ist exakt gepinnt. Die neue Mock-E2E-Spec prüft
  die Hauptseiten mit WCAG A/AA-Regeln. Die tatsächlichen axe-Befunde sind noch
  nicht gemessen. Lizenzdetails: `docs/LIZENZEN.md`.

## Prüfungen

| Befehl | Ergebnis |
| --- | --- |
| `npm run check` | 0 Fehler, 0 Warnungen |
| `npm test` | 108 Dateien, 1.099 Tests grün |
| `VITE_MOCK=1 npm run build` | grün |
| `E2E_MOCK_PORT=5387 npx playwright test -c playwright.mock.config.ts --list` | 244 Tests in 37 Dateien erkannt |
| `E2E_MOCK_PORT=5387 npm run test:e2e:mock` | blockiert: lokaler Listener wird mit `EPERM` abgewiesen |

Ein unabhängiger `python3 -m http.server` schlägt in derselben Sandbox ebenso
beim Binden mit `EPERM` fehl. Auch Chromium selbst kann wegen verweigerter
Mach-Port-Registrierung nicht starten. Deshalb ist die vollständige Mock-Suite
hier nicht grün belegt; die axe-Befunde und der Push-E2E sind offen.

## Nachlauf auf einer Umgebung mit Browser- und Loopback-Zugriff

1. `npm ci` (Lockfile enthält die exakten axe-Pakete).
2. `npm run check && npm test`.
3. `E2E_MOCK_PORT=<freier Port> npm run test:e2e:mock`.
4. `E2E_PWA_PORT=<freier Port> npm run test:e2e:pwa`.
5. Axe-Befunde beheben und beide vollständigen E2E-Suiten erneut ausführen.

Die Paketmetadaten von `@axe-core/playwright` und `axe-core` geben MPL-2.0 an.
Die im Auftrag gewünschte permissive Lizenz ist daher noch eine offene
Produktentscheidung; keine der beiden Abhängigkeiten gelangt in den PWA-Build.

## Abschluss (Claude, 24.10.2026)

- Behoben: `serve-build.mjs` lieferte `.mjs` (pdf.js-Worker) als `application/octet-stream` mit `nosniff`; Vorschau scheiterte nur im Produktions-Build.
- Behoben: axe `label-content-name-mismatch` auf `/reports` (aria-label beginnt jetzt mit dem sichtbaren Text: „Eintrag hinzufügen für {date}“).
- Behoben: `e2e-pwa` Offline-Test erwartete `/offline$`, die Seite hängt `?from=` an; `context.setOffline(false)` blockierte, ersetzt durch `page.close()`.
- Lauf `test:e2e:mock`: 168 bestanden, 76 übersprungen (ausschließlich Screenshot-Specs ohne `SCREENSHOT_DIR`), 0 nicht gelaufen (die 9 zuvor waren serielle Folgetests nach dem Fehler). `test:e2e:pwa`: 12/12 inkl. Push. `npm run check` 0 Fehler, `npm test` 1099 grün.
