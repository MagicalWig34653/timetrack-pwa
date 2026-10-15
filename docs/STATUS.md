# Stand der PWA – 15.10.2026 (Paket L21)

Kanonisches Projektgedächtnis liegt im Backend-Repo (`../timetrack-backend/docs/STATUS.md`, ARBEITSPLAN.md, ADRs). Dieses Dokument beschreibt den tatsächlichen Stand der PWA.
Frühere Paketstände und Details: `docs/handoffs/*.md` (L1 bis L19, X1).

## Technik
SvelteKit 3 (SPA, `adapter-static`, kein SSR), Svelte 5, TypeScript, Tailwind 4, shadcn-svelte (Nova/Neutral), Vitest + Testing Library, Playwright. Node nur für Entwicklung/Build.
API-Client `src/lib/api/client.ts` (getippt von Hand nach `contracts/openapi.yaml`, aktuell v0.10.1), Texte `src/lib/i18n/de*.ts`, Mock-API `mock/`.

## Routen und Seiten
Kern (immer an): `/` Dashboard, `/time`, `/time/[date]`, `/notifications` (Hinweiszentrum, Glocke), `/settings/work-model|places|account-time|notifications|passkeys|identities|recovery|sessions|modules`,
`/admin/invitations`, `/admin/modules` (nur Admin), öffentlich `/login`, `/invite/[token]`, `/recover`, `/recover/passkey`, `/setup/recovery`, `/offline`; Dev-Mock: `/mock-idp`, `/mock-oauth`.
Module (abschaltbar, ADR-0012, Zuordnung in `src/lib/modules/map.ts`):
- reports: `/reports`, `/settings/learning-fields`, Dashboard-Karte
- planning: `/vacation`, `/calendar`, `/absences`, `/shared`, `/settings/sharing`
- transfer: `/export`, `/import`, `/settings/storage` (Admin), Anhänge (Abwesenheitsformular, Berichtsheft-Quellen)
- automation: `/settings/devices`, `/suggestions`, Hinweis auf dem Dashboard
- mcp: `/settings/api-tokens`, `/settings/connections`, `/settings/mcp-help`, `/oauth/consent`

## Designsprache (L21, ADR-0014)
Zinc-Tokens (OKLCH, hell/dunkel), Glasflächen mit deckenden Rückfällen, Akzentsystem (`src/lib/theme/accent.ts`, Standard #2563EB), Shell mit Seitenleiste (256 px), Kopfzeile (60 px), mobilem Off-Canvas-Menü, Einstellungssuche; Muster-Komponenten (`PageHeader`, `Panel`, `KpiCard`, `SectionHeading`, `EmptyState`, `FilterBar`, `StatusChip`, `Banner`); neue Seite `/settings/appearance`. Details und Abweichungen: `docs/handoffs/L21.md`.

## Modulschalter (L17)
`moduleStore` (`src/lib/modules/store.svelte.ts`) lädt `GET /modules` nach dem Login (Routenwächter), cached es und aktualisiert sich nach Änderungen und bei jeder Antwort `404 module_disabled`.
404/501 (älteres Backend) = alle Module an. Ausgeblendet werden Navigation, Einstellungs-Unternavigation, Dashboard-Karten/-Hinweise, Anhänge, Kalender-Link im Import; Direktaufruf zeigt „Dieses Modul ist deaktiviert“ mit Link zu `/settings/modules`.
`/settings/modules`: Schalter je Modul (optimistisch, Rückfall bei Fehler, `module_locked` auf Deutsch), „Vom Betreiber deaktiviert“/„Server deaktiviert“ sperren den Schalter, Hinweis zur Planung (Abwesenheiten/Feiertage wirken dann nicht auf Tagesbewertung).
`/admin/modules`: serverweite Schalter (`GET/PUT /admin/modules`), Betreiber-Sperren sichtbar, Warndialog „Betrifft alle Konten“ vor dem Abschalten.
Ein Test (`src/lib/modules/modules.test.ts`) schlägt fehl, wenn eine Seite weder Kern noch genau einem Modul zugeordnet ist.

## Freigestellt und Arbeitszeit-Tabelle (L18, ADR-0013)
- `excused` („Freigestellt“, bezahlt frei, kein Urlaubsverbrauch, nie geteilt): Abwesenheitsart und Tagesmarkierung, Kalender, Formular, Filter.
- Import: erkennt das Profil `worktime_workbook` (Banner, Umschalter zum allgemeinen Assistenten), Profil-Schritt mit Pause und Bemerkungsregeln, Vorschau mit Zeitkonto-Hinweis und Regelanlage für unbekannte Bemerkungen, Ergebnis mit Abwesenheiten/eigenen Feiertagen, typisierte Rollback-Konflikte.
- Export: Format `worktime-xlsx` mit Optionen (bewertet/tatsächlich, Pause, Standard-Beginn, Datumssystem).
- Seit L19 gegen das echte Backend (C21/C22) geprüft: `e2e/worktime.spec.ts` (Import-Assistent, Export mit unabhängigem Leser `exceljs`, Round-trip in ein zweites Konto, Rollback und Konflikte, Modul planning aus). Der Mock-Export bleibt eine Näherung.
- Rollback-Konflikte zeigen die typisierte Liste `conflictItems` (v0.10.1); Vorschau-`warnings` (pause_exceeds_day) erscheinen in der Problemtabelle als Hinweis.
- Offener Backend-Befund (`test.fixme`): Schul-/Arbeitszeile mit Standardzeiten auf eingebautem Feiertag erzeugt Überschuss im Zeitkonto (Details `docs/handoffs/L19.md`).

## PWA / Service Worker
Manifest, Icons (`npm run icons`), `src/service-worker.ts` (Precache, Navigation netzwerk-first mit `/offline`, API/OAuth/MCP nie gecacht, Update nur nach Bestätigung, Push-Handler), Offline-Banner, Web-Push-Einstellungen. Registrierung nur im Produktionsbuild (https/localhost) oder mit `VITE_SW=1`. Details: `docs/handoffs/L16.md`.

## Tests und Befehle
| Befehl | Inhalt |
| --- | --- |
| `npm run check` | svelte-check + tsc des Service Workers (0 Fehler/Warnungen) |
| `npm test` | vitest, 488 Tests (Komponenten, Mock-Regeln, Modul-Routenabdeckung) |
| `npm run build` | statisches Build nach `build/` |
| `npm run test:e2e` | baut, startet je Spec-Gruppe eine Swift-Backend-Instanz (SQLite-Wegwerf-DB, virtueller WebAuthn-Authenticator), 157 Specs (inkl. 10 Modul- und 19 Arbeitszeit-Specs, davon 1 `fixme`) |
| `npm run test:e2e:mock` | Playwright gegen `dev:mock` (kein Backend), inkl. `modules.spec.ts` und `worktime.spec.ts` |
| `npm run test:e2e:pwa` | Produktionsbuild mit Mock-API: Manifest, Service Worker, Offline, Push |

Umgebungsvariablen: `E2E_BACKEND_DIR` (Backend-Checkout, Standard `../timetrack-backend`), `E2E_PORT` (Basisport, Standard 18090; weitere Instanzen +1 bis +9, Arbeitszeit-Tabelle auf +9), `E2E_SKIP_BUILD=1` (vorhandenes Backend-Binary/Build nutzen), `E2E_MOCK_PORT` (Standard 5199).
Mock-Modus: `npm run dev:mock`; Demo-Konto `admin` (virtueller Passkey), Einladung `demo-invite`, Recovery-Code `AAAA-BBBB-CCCC`. `MOCK_OIDC=0`, `MOCK_MODULES_DISABLED=reports,mcp` (Betreiber-Sperre). Test-Hooks (nicht im Vertrag): `POST /api/v1/mock/notify|push|oidc|modules`.
Screenshots: `SCREENSHOT_DIR=<dir>` aktiviert die Screenshot-Specs (390 px und Desktop, hell/dunkel).

## Bekannte Grenzen / nicht geprüft
- Modulschalter sind seit L18 auch gegen das echte Backend geprüft (`e2e/modules.spec.ts`).
- Mock-Guard bildet die Routengruppen aus ADR-0012 nach; die automation-Events werden nur serverweit geprüft (Token-Konto unbekannt).
- Nicht geprüft: Firefox/WebKit, Screenreader, MariaDB-Modus, echte ChatGPT-/Claude-Connectoren, echte Push-Zustellung (iOS/Android), echter Shortcuts-Durchlauf, native Apps.
- Bekannter Backend-Befund (L16): `.webmanifest` ohne Content-Type; Icon-Dateinamen können `immutable` erhalten.
