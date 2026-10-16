# Stand der PWA – 16.10.2026 (Paket L23)

Kanonisches Projektgedächtnis liegt im Backend-Repo (`../timetrack-backend/docs/STATUS.md`, ARBEITSPLAN.md, ADRs). Dieses Dokument beschreibt den tatsächlichen Stand der PWA.
Frühere Paketstände und Details: `docs/handoffs/*.md` (L1 bis L23, X1).

## Technik
SvelteKit 3 (SPA, `adapter-static`, kein SSR), Svelte 5, TypeScript, Tailwind 4, shadcn-svelte (Nova/Neutral), Vitest + Testing Library, Playwright. Node nur für Entwicklung/Build.
API-Client `src/lib/api/client.ts` (getippt von Hand nach `contracts/openapi.yaml`, aktuell v0.12.0 für Konten und Push-Ersetzen, übrige Teile v0.10.x), Texte `src/lib/i18n/de*.ts`, Mock-API `mock/`.

## Routen und Seiten
Kern (immer an): `/` Dashboard, `/time`, `/time/[date]`, `/notifications` (Hinweiszentrum, Glocke), `/settings/work-model|places|account-time|notifications|passkeys|identities|recovery|sessions|modules|privacy`,
`/admin/invitations`, `/admin/accounts`, `/admin/modules` (nur Admin), öffentlich `/login`, `/invite/[token]`, `/recover`, `/recover/passkey`, `/setup/recovery`, `/offline`; Dev-Mock: `/mock-idp`, `/mock-oauth`.
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
- Der frühere Backend-Befund (Schulzeile auf Feiertag) ist seit C23 behoben; der `fixme`-Test ist ein normaler Test.

## Arbeitszeit-Import nach C23 (L22, Vertrag v0.10.2, ADR-0013 Ergänzung)
- Profil-Schritt: `holidayTimes` (Verwerfen, Standard / Behalten mit Mehrarbeit-Hinweis) und `partialCredit` (Als Arbeit mit Notiz, Standard / Als Abwesenheit); beides in Vorlagen gespeichert, ältere Vorlagen erhalten die Standardwerte.
- Vorschau: Hinweisliste mit Tageanzahl und „Was bedeutet das?“ (`holiday_times_discarded`, `school_on_holiday`, `credit_partial_as_work`), Saldo-Panel „Tabellensaldo bis heute“ / „nach heute“ (Gesamt sekundär), Hinweis „Beginn des Arbeitsmodells“ aus `firstContentDate` mit Link nach `/settings/work-model?validFrom=…` (die Arbeitsmodell-Seite öffnet dann das Formular für eine neue Version mit diesem Datum). Dieselben Hinweise in der Bestätigung und im Ergebnis (`ImportResult.warnings`, im Vertrag noch nicht erfasst, siehe Handoff).
- Mock bildet die C23-Regeln nach (Feiertagszeiten, Teil-Gutschrift mit Soll aus dem Modell oder B1/5 und 5 Minuten Toleranz, Saldo nach heute, `firstContentDate`); `pause_exceeds_day` steht jetzt in `warnings` wie beim Backend. Details: `docs/handoffs/L22.md`.

## Konten und Datenschutz (L23, ADR-0016)
- `/admin/accounts` (nur Admin): seitenweise Kontenliste (Identität, Rolle, Zustand, letzte Aktivität, Passkeys), Deaktivieren/Reaktivieren, Rollenwechsel, Sitzungen beenden, Löschen mit getipptem Handle; `reauth_required` führt über „Abmelden und neu anmelden“ zurück zur Seite; `self_lockout`, `last_admin`, `confirmation_mismatch` und `account_deletion_incomplete` (Wiederholen) auf Deutsch.
- `/settings/privacy`: „Meine Daten herunterladen“ (`GET /me/export`, ZIP) und „Konto löschen“ (frische Sitzung, getipptes Handle, Hinweis bei letztem Admin und bei unvollständiger Löschung), danach `/login?deleted=1`.
- Service Worker: `pushsubscriptionchange` abonniert neu und ruft `POST /me/push-subscriptions/replace` (`src/lib/pwa/subscription-change.ts`, getestet). Details und Grenzen: `docs/handoffs/L23.md`.

## PWA / Service Worker
Manifest, Icons (`npm run icons`), `src/service-worker.ts` (Precache, Navigation netzwerk-first mit `/offline`, API/OAuth/MCP nie gecacht, Update nur nach Bestätigung, Push-Handler), Offline-Banner, Web-Push-Einstellungen. Registrierung nur im Produktionsbuild (https/localhost) oder mit `VITE_SW=1`. Details: `docs/handoffs/L16.md`.

## Tests und Befehle
| Befehl | Inhalt |
| --- | --- |
| `npm run check` | svelte-check + tsc des Service Workers (0 Fehler/Warnungen) |
| `npm test` | vitest, 551 Tests (Komponenten, Mock-Regeln, Modul-Routenabdeckung) |
| `npm run build` | statisches Build nach `build/` |
| `npm run test:e2e` | baut, startet je Spec-Gruppe eine Swift-Backend-Instanz (SQLite-Wegwerf-DB, virtueller WebAuthn-Authenticator), 168 Specs (inkl. 10 Modul-, 20 Arbeitszeit- und 10 Konten-Specs) |
| `npm run test:e2e:mock` | Playwright gegen `dev:mock` (kein Backend), inkl. `modules.spec.ts` und `worktime.spec.ts` |
| `npm run test:e2e:pwa` | Produktionsbuild mit Mock-API: Manifest, Service Worker, Offline, Push |

Umgebungsvariablen: `E2E_BACKEND_DIR` (Backend-Checkout, Standard `../timetrack-backend`), `E2E_PORT` (Basisport, Standard 18090; weitere Instanzen +1 bis +10, Arbeitszeit-Tabelle +9, Konten +10), `E2E_SKIP_BUILD=1` (vorhandenes Backend-Binary/Build nutzen), `E2E_MOCK_PORT` (Standard 5199).
Mock-Modus: `npm run dev:mock`; Demo-Konto `admin` (virtueller Passkey), Einladung `demo-invite`, Recovery-Code `AAAA-BBBB-CCCC`. `MOCK_OIDC=0`, `MOCK_MODULES_DISABLED=reports,mcp` (Betreiber-Sperre). Test-Hooks (nicht im Vertrag): `POST /api/v1/mock/notify|push|oidc|modules|accounts`.
Screenshots: `SCREENSHOT_DIR=<dir>` aktiviert die Screenshot-Specs (390 px und Desktop, hell/dunkel).

## Bekannte Grenzen / nicht geprüft
- L23: `reauth_required` und `account_deletion_incomplete` nur im Mock geprüft (echtes Backend: 10-Minuten-Frist bzw. defekter Speicher nötig); echtes `pushsubscriptionchange` im Browser nicht auslösbar (Logik per Unit-Test).
- Modulschalter sind seit L18 auch gegen das echte Backend geprüft (`e2e/modules.spec.ts`).
- Mock-Guard bildet die Routengruppen aus ADR-0012 nach; die automation-Events werden nur serverweit geprüft (Token-Konto unbekannt).
- Nicht geprüft: Firefox/WebKit, Screenreader, MariaDB-Modus, echte ChatGPT-/Claude-Connectoren, echte Push-Zustellung (iOS/Android), echter Shortcuts-Durchlauf, native Apps.
- Bekannter Backend-Befund (L16): `.webmanifest` ohne Content-Type; Icon-Dateinamen können `immutable` erhalten.
