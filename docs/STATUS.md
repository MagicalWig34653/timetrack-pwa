# Stand der PWA – 15.10.2026 (Paket L17)

Kanonisches Projektgedächtnis liegt im Backend-Repo (`../timetrack-backend/docs/STATUS.md`, ARBEITSPLAN.md, ADRs). Dieses Dokument beschreibt den tatsächlichen Stand der PWA.
Frühere Paketstände und Details: `docs/handoffs/*.md` (L1 bis L17, X1).

## Technik
SvelteKit 3 (SPA, `adapter-static`, kein SSR), Svelte 5, TypeScript, Tailwind 4, shadcn-svelte (Nova/Neutral), Vitest + Testing Library, Playwright. Node nur für Entwicklung/Build.
API-Client `src/lib/api/client.ts` (getippt von Hand nach `contracts/openapi.yaml`, aktuell v0.9.0), Texte `src/lib/i18n/de*.ts`, Mock-API `mock/`.

## Routen und Seiten
Kern (immer an): `/` Dashboard, `/time`, `/time/[date]`, `/notifications` (Hinweiszentrum, Glocke), `/settings/work-model|places|account-time|notifications|passkeys|identities|recovery|sessions|modules`,
`/admin/invitations`, `/admin/modules` (nur Admin), öffentlich `/login`, `/invite/[token]`, `/recover`, `/recover/passkey`, `/setup/recovery`, `/offline`; Dev-Mock: `/mock-idp`, `/mock-oauth`.
Module (abschaltbar, ADR-0012, Zuordnung in `src/lib/modules/map.ts`):
- reports: `/reports`, `/settings/learning-fields`, Dashboard-Karte
- planning: `/vacation`, `/calendar`, `/absences`, `/shared`, `/settings/sharing`
- transfer: `/export`, `/import`, `/settings/storage` (Admin), Anhänge (Abwesenheitsformular, Berichtsheft-Quellen)
- automation: `/settings/devices`, `/suggestions`, Hinweis auf dem Dashboard
- mcp: `/settings/api-tokens`, `/settings/connections`, `/settings/mcp-help`, `/oauth/consent`

## Modulschalter (L17)
`moduleStore` (`src/lib/modules/store.svelte.ts`) lädt `GET /modules` nach dem Login (Routenwächter), cached es und aktualisiert sich nach Änderungen und bei jeder Antwort `404 module_disabled`.
404/501 (älteres Backend) = alle Module an. Ausgeblendet werden Navigation, Einstellungs-Unternavigation, Dashboard-Karten/-Hinweise, Anhänge, Kalender-Link im Import; Direktaufruf zeigt „Dieses Modul ist deaktiviert“ mit Link zu `/settings/modules`.
`/settings/modules`: Schalter je Modul (optimistisch, Rückfall bei Fehler, `module_locked` auf Deutsch), „Vom Betreiber deaktiviert“/„Server deaktiviert“ sperren den Schalter, Hinweis zur Planung (Abwesenheiten/Feiertage wirken dann nicht auf Tagesbewertung).
`/admin/modules`: serverweite Schalter (`GET/PUT /admin/modules`), Betreiber-Sperren sichtbar, Warndialog „Betrifft alle Konten“ vor dem Abschalten.
Ein Test (`src/lib/modules/modules.test.ts`) schlägt fehl, wenn eine Seite weder Kern noch genau einem Modul zugeordnet ist.

## PWA / Service Worker
Manifest, Icons (`npm run icons`), `src/service-worker.ts` (Precache, Navigation netzwerk-first mit `/offline`, API/OAuth/MCP nie gecacht, Update nur nach Bestätigung, Push-Handler), Offline-Banner, Web-Push-Einstellungen. Registrierung nur im Produktionsbuild (https/localhost) oder mit `VITE_SW=1`. Details: `docs/handoffs/L16.md`.

## Tests und Befehle
| Befehl | Inhalt |
| --- | --- |
| `npm run check` | svelte-check + tsc des Service Workers (0 Fehler/Warnungen) |
| `npm test` | vitest, 455 Tests (Komponenten, Mock-Regeln, Modul-Routenabdeckung) |
| `npm run build` | statisches Build nach `build/` |
| `npm run test:e2e` | baut, startet je Spec-Gruppe eine Swift-Backend-Instanz (SQLite-Wegwerf-DB, virtueller WebAuthn-Authenticator), 128 Specs |
| `npm run test:e2e:mock` | Playwright gegen `dev:mock` (kein Backend), inkl. `e2e-mock/modules.spec.ts` |
| `npm run test:e2e:pwa` | Produktionsbuild mit Mock-API: Manifest, Service Worker, Offline, Push |

Umgebungsvariablen: `E2E_BACKEND_DIR` (Backend-Checkout, Standard `../timetrack-backend`), `E2E_PORT` (Basisport, Standard 18090; weitere Instanzen +1 bis +6), `E2E_SKIP_BUILD=1` (vorhandenes Backend-Binary/Build nutzen), `E2E_MOCK_PORT` (Standard 5199).
Mock-Modus: `npm run dev:mock`; Demo-Konto `admin` (virtueller Passkey), Einladung `demo-invite`, Recovery-Code `AAAA-BBBB-CCCC`. `MOCK_OIDC=0`, `MOCK_MODULES_DISABLED=reports,mcp` (Betreiber-Sperre). Test-Hooks (nicht im Vertrag): `POST /api/v1/mock/notify|push|oidc|modules`.
Screenshots: `SCREENSHOT_DIR=<dir>` aktiviert die Screenshot-Specs (390 px und Desktop, hell/dunkel).

## Bekannte Grenzen / nicht geprüft
- Modulschalter bisher nur gegen die Mock-API getestet; Echt-Backend-E2E für Vertrag v0.9.0 folgt nach dem Merge von C20 (siehe handoffs/L17.md).
- Mock-Guard bildet die Routengruppen aus ADR-0012 nach; die automation-Events werden nur serverweit geprüft (Token-Konto unbekannt).
- Nicht geprüft: Firefox/WebKit, Screenreader, MariaDB-Modus, echte ChatGPT-/Claude-Connectoren, echte Push-Zustellung (iOS/Android), echter Shortcuts-Durchlauf, native Apps.
- Bekannter Backend-Befund (L16): `.webmanifest` ohne Content-Type; Icon-Dateinamen können `immutable` erhalten.
