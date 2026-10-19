# Stand der PWA – 17.10.2026 (Pakete bis P2, W1; Dokumentationsabgleich D3)

Projektstatus: Alpha. Das Repository ist seit 17.10.2026 öffentlich (AGPL-3.0-only). Die PWA läuft im Stand P2 auf der privaten Live-Testinstanz des Betreibers (ausgerollt 16.10. abends); eine Produktionsinstanz wird eingerichtet. Seit P2 gab es nur CI-/Dokumentationsänderungen (W1, D3), keine Änderungen an `src/`.

Kanonisches Projektgedächtnis liegt im Backend-Repo (`../timetrack-backend/docs/STATUS.md`, ARBEITSPLAN.md, ADRs). Dieses Dokument beschreibt den tatsächlichen Stand der PWA.
Frühere Paketstände und Details: `docs/handoffs/*.md` (L1 bis L23, P1, X1).

## Paket P5 (Kalenderkacheln, Abwesenheiten filtern, Anhänge ansehen, 19.10.2026, Branch p5-absences-calendar, nicht gemergt)
`/calendar`: Kachelhintergrund nach Arbeitstag, frei, Urlaub genehmigt, Urlaub geplant, krank, sonstige Abwesenheit samt Legende (Arbeitsmodell bestimmt Arbeitstage). `/absences`: Sortierung, Filter (Art, Status, Zeitraum, Anhang, Notiztext), Zähler, Leerzustand, URL-Parameter und Merken je Browser. Anhänge von Abwesenheiten lassen sich in einem Dialog ansehen (Bild, PDF, Text; sonst Download). Vertrag unverändert 0.23.0; Serverwünsche (Anhangzahl, Inline-Auslieferung) in `docs/handoffs/P5.md`.

## Paket P4 (Systeminfo für Mitglieder, 19.10.2026, Branch p4-system-info-members, nicht gemergt)
Hilfe-Dialog und Kopiertext vertragen die Mitglieder-Variante von `GET /system/info` (Vertrag 0.23.0): Datenbank, Migrationen, Laufzeit und Replikat erscheinen nur, wenn der Server sie liefert (Admins). Details: `docs/handoffs/P4.md`.

## Paket V2-PWA (Urlaubsplanung, 19.10.2026, Branch v2-vacation-planner, nicht gemergt, Lead-Prüfung offen)
Neue Seite `/vacation/planner` (Modul planning, Knopf „Urlaub planen“ auf `/vacation`): Budgetkopf, Filter (gemerkt je Browser), gerankte Vorschlagskarten mit Faktor, Konfliktwarnungen, Budgetzustand, Tagesstreifen und „In meinen Urlaub übernehmen“ (Bestätigung, je Block eine geplante Urlaubs-Abwesenheit, Häkchen bei Konflikten). Füllfenster unter Faktor 2 standardmäßig ausgeblendet. Vertrag v0.22.0. Zahlen und Details: `docs/handoffs/V2-pwa.md`.

## Paket AC2 (sechs weitere Akzentfarben, 18.10.2026, Lead-Prüfung offen)
Voreinstellungen `wine`, `slate`, `cocoa`, `olive`, `ocean`, `ink` (Wein, Schiefer, Kakao, Oliv, Ozean, Tinte; weiße Schrift, Kontrast mindestens 5,36:1), Vertrag v0.21.0. Server vor v0.21.0 lehnen die IDs ab: die PWA speichert dort `custom` plus Hex und behält den Leuchteffekt. Details: `docs/handoffs/AC2.md`.

## Paket P3a (Update-Banner und 503, 18.10.2026, Lead-Prüfung offen)
Update-Banner bei Rolling Updates robust: wartender Worker zählt nur, wenn die vom Server gemeldete PWA-Revision abweicht; 10 Minuten Ruhe nach angewendetem Update; Hard Reset (Service Worker abmelden, Caches löschen, einmal neu laden), wenn der Controller nicht wechselt. API-Client beachtet `Retry-After` (max. 5 s) bei 503 `database_unavailable`, neue deutsche Meldung. Vertrag v0.20.0. Details: `docs/handoffs/P3a.md`.

## Paket V1 (Version und Build in der Hilfe, 18.10.2026, Lead-Prüfung offen)
Hilfe-Dialog zeigt Version, Image-ID (Commit) und Build-Datum von PWA und Backend, API-Version, Datenbank, Migrationen, Laufzeit, Replikat; Hinweis bei älterer geladener Oberfläche, Kopierzeile für Fehlerberichte. Build schreibt `build/version.json`. Vertrag v0.19.0, ADR-0023. Details: `docs/handoffs/V1.md`.

## Paket MAIL1 (E-Mail-Prüfung, 17.10.2026, Lead-Prüfung offen)
Neue Adminseite `/admin/mail` („E-Mail“, Seitenleiste Verwaltung nach Module und Einstellungen, Gruppe Verwaltung; Link auch im Profilhinweis für Admins): Statuskarte (Server, Port, Verschlüsselung mit Erklärung, Absender, Hinweise), Checkliste mit kopierbaren Umgebungszeilen bei fehlender Einrichtung, „Verbindung prüfen“ als senkrechte Schrittanzeige (Zeiten und Erklärungen vom Server), „Testmail senden“ (frische Sitzung, sonst Hinweis zur erneuten Anmeldung), Erklärung der Nutzung. Vertrag v0.18.0; ältere Server (404): „Dieser Server unterstützt die Prüfung noch nicht“. Details: `docs/handoffs/MAIL1.md`.

## Paket K1 (Woche, 17.10.2026, Lead-Prüfung offen)
Neuer Navigationspunkt „Woche“: `/week` (Übersicht, Kern) mit Wochenwahl, Kennzahlen, Tageskarten, Zusammenfassung mit Icons und Plan-Ist-Karte; `/plan` (Planer, Modul planning) mit Schnellaktionen, Live-Summen, Speichern über `PUT /plan/weeks/{isoWeek}` und Schutz vor Verlassen. Heute zeigt eine Planzeile, der Kalender die geplanten Zeiten. Vertrag v0.17.0; ältere Server zeigen einen Hinweis. Zahlen und Details: `docs/handoffs/K1.md`.

## Technik
SvelteKit 3 (SPA, `adapter-static`, kein SSR), Svelte 5, TypeScript, Tailwind 4, shadcn-svelte (Nova/Neutral), Vitest + Testing Library, Playwright. Node nur für Entwicklung/Build.
API-Client `src/lib/api/client.ts` (getippt von Hand nach `contracts/openapi.yaml`, aktuell v0.14.0 für Darstellung je Konto, v0.13.0 für Profil und Einrichtung, v0.12.0 für Konten und Push-Ersetzen, übrige Teile v0.10.x), Texte `src/lib/i18n/de*.ts`, Mock-API `mock/`.

## Routen und Seiten
Kern (immer an): `/` Dashboard, `/time`, `/time/[date]`, `/notifications` (Hinweiszentrum, Glocke), `/settings/profile|work-model|places|account-time|notifications|passkeys|identities|recovery|sessions|modules|privacy`, `/onboarding`,
`/admin/invitations`, `/admin/accounts`, `/admin/modules` (nur Admin), öffentlich `/login`, `/invite/[token]`, `/recover`, `/recover/passkey`, `/setup/recovery`, `/offline`; Dev-Mock: `/mock-idp`, `/mock-oauth`.
Module (abschaltbar, ADR-0012, Zuordnung in `src/lib/modules/map.ts`):
- reports: `/reports`, `/settings/learning-fields`, Dashboard-Karte
- planning: `/vacation`, `/vacation/planner`, `/calendar`, `/absences`, `/shared`, `/settings/sharing`
- transfer: `/export`, `/import`, `/settings/storage` (Admin), Anhänge (Abwesenheitsformular, Berichtsheft-Quellen)
- automation: `/settings/devices`, `/suggestions`, Hinweis auf dem Dashboard
- mcp: `/settings/api-tokens`, `/settings/connections`, `/settings/mcp-help`, `/oauth/consent`

## Designsprache (L21, ADR-0014)
Zinc-Tokens (OKLCH, hell/dunkel), Glasflächen mit deckenden Rückfällen, Akzentsystem (`src/lib/theme/accent.ts`, Standard #2563EB), Shell mit Seitenleiste (256 px), Kopfzeile (60 px), mobilem Off-Canvas-Menü, Einstellungssuche; Muster-Komponenten (`PageHeader`, `Panel`, `KpiCard`, `SectionHeading`, `EmptyState`, `FilterBar`, `StatusChip`, `Banner`); neue Seite `/settings/appearance`. Details und Abweichungen: `docs/handoffs/L21.md`.

## Glas und Leuchteffekt (G1, Vertrag v0.15.0; Branch g1-glass, nicht gemergt, Lead-Prüfung offen)

- Alle schwebenden Flächen (Popover inkl. Palette, native Dialoge und Scrim, Toast, Drawer, Seitenleiste, Kopfzeile) tragen Blur über gemeinsame Tokens/Klassen in `layout.css` (`--bf-*`, `--glass-*`, `.glass-pop/-soft/-scrim`); Seitenleiste/Kopfzeile malen ihr Glas auf `::before`, damit Popover darin den Seitengrund verwischen. Rückfälle (reduzierte Transparenz, In-App-Schalter, kein `backdrop-filter`) machen alles deckend.
- Neue Konto-Einstellung „Leuchteffekt“ (`glow`: Aus/Dezent/Mittel/Stark, Standard Dezent) auf der Darstellungsseite und in der Palette; Cache `tt.glow`, früh gesetzt in `app.html`. Ältere Server ohne `glow`: lokal, ohne Sendefehler.
- Acht weitere Akzent-Voreinstellungen mit weißer Schrift (Indigo, Marine, Purpur, Magenta, Karmin, Waldgrün, Petrol, Bronze); ältere Server speichern sie als `custom` plus Hex.
- Details: `docs/handoffs/G1.md`.

## Darstellung je Konto (P2, ADR-0020, Vertrag v0.14.0; Lead-Prüfung offen)
Akzentfarbe (Voreinstellungen `blue|teal|violet|green|orange|pink|graphite` oder eigene Farbe) und Farbschema gehören zum Konto (`GET/PATCH /me/preferences`, in `GET /auth/session` als `account.preferences`); localStorage (`tt.accent`, `tt.accentId`, `tt.theme`) ist Sofort-Cache und Offline-Rückfall. Transparenz (`tt.transparency`) und App-Symbol bleiben Gerätewahl.
Abgleich in `ThemeStore.reconcile` (`src/lib/theme/theme.svelte.ts`, aufgerufen von `sessionStore`): eine ungesendete lokale Änderung desselben Kontos (`tt.prefsPending` = Konto-ID) gewinnt und wird gesendet; sonst überschreiben die Kontowerte den Cache. Hat das Konto nie Werte und weicht der Cache von den Standardwerten ab, wird die lokale Wahl einmal übertragen (nicht, wenn der Cache `tt.prefsOwner` einem anderen Konto gehört). Anmeldeseite nutzt nur den Cache. Statuszeile `appearance-sync` auf `/settings/appearance`. Ältere Server ohne `account.preferences`: rein lokal wie zuvor.
Details und Tests: `docs/handoffs/P2.md`.

## Arbeitsmodell korrigieren, Urlaubskonto (M1, Vertrag v0.16.0; Lead-Prüfung offen)
Arbeitsmodell-Seite: Formular startet mit den Werten der neuesten Version; „Bearbeiten“ je Version mit den Modi „Ab einem Datum ändern“ (neue Version) und „Diese Version korrigieren“ (`PUT`, nur wenn der Server `version` liefert) mit Warnbanner, Live-Vorschau (`POST .../preview`) und Bestätigung. Urlaub: Karte „Dein Urlaubskonto“ mit Anspruch, Übertrag, Korrekturen, Stichtag, genommen, geplant; ohne Anspruch eine Handlungsaufforderung. Übergabe: `docs/handoffs/M1.md`.

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

## Profil und geführte Einrichtung (P1, ADR-0019, Vertrag v0.13.0)
- Einstellungen sind nach Gruppen navigierbar (Seitenspalte ab 1100 px, einklappbare Liste auf dem Handy) statt 18 waagerechter Tabs.
- `/settings/profile`: Anzeigename, Kontoname lesend, E-Mail per Bestätigungscode (ohne SMTP erklärt), „Einrichtung wiederholen“. `/onboarding`: sechs Schritte (Arbeitsmodell, Pausen, Berufsschule, Urlaub, Funktionen, Zusammenfassung) mit sichtbaren Vorschlägen, gespeichert erst am Ende; neue Konten sehen ein Banner auf der Startseite. Details und Grenzen: `docs/handoffs/P1.md`.

## PWA / Service Worker
Manifest, Icons (`npm run icons`), `src/service-worker.ts` (Precache, Navigation netzwerk-first mit `/offline`, API/OAuth/MCP nie gecacht, Update nur nach Bestätigung, Push-Handler), Offline-Banner, Web-Push-Einstellungen. Registrierung nur im Produktionsbuild (https/localhost) oder mit `VITE_SW=1`. Details: `docs/handoffs/L16.md`.
Favicon + App-Icons im Design der nativen App (F1, Branch `f1-icons`): `static/favicon.svg|ico`, `icons/*`, Generator `npm run icons`; Details: `docs/handoffs/F1.md`.

## Tests und Befehle
| Befehl | Inhalt |
| --- | --- |
| `npm run check` | svelte-check + tsc des Service Workers (0 Fehler/Warnungen) |
| `npm test` | vitest, 643 Tests (Komponenten, Mock-Regeln, Modul-Routenabdeckung; Lead, Paket P2) |
| `npm run build` | statisches Build nach `build/` |
| `npm run test:e2e` | baut, startet je Spec-Gruppe eine Swift-Backend-Instanz (SQLite-Wegwerf-DB, virtueller WebAuthn-Authenticator), 181 Specs (inkl. Modul-, Arbeitszeit-, Konten-, Profil- und Darstellungs-Specs; Lead gegen frisch gebautes Backend, Paket P2) |
| `npm run test:e2e:mock` | Playwright gegen `dev:mock` (kein Backend), 84 Specs (Lead, P2), inkl. `modules.spec.ts` und `worktime.spec.ts` |
| `npm run test:e2e:pwa` | Produktionsbuild mit Mock-API: Manifest, Service Worker, Offline, Push; 6 Specs |

Umgebungsvariablen: `E2E_BACKEND_DIR` (Backend-Checkout, Standard `../timetrack-backend`), `E2E_PORT` (Basisport, Standard 18090; weitere Instanzen +1 bis +10, Arbeitszeit-Tabelle +9, Konten +10, Profil +11 und +12, Profil-SMTP +13), `E2E_SKIP_BUILD=1` (vorhandenes Backend-Binary/Build nutzen), `E2E_MOCK_PORT` (Standard 5199).
Mock-Modus: `npm run dev:mock`; Demo-Konto `admin` (virtueller Passkey), Einladung `demo-invite`, Recovery-Code `AAAA-BBBB-CCCC`. `MOCK_OIDC=0`, `MOCK_MODULES_DISABLED=reports,mcp` (Betreiber-Sperre). Test-Hooks (nicht im Vertrag): `POST /api/v1/mock/notify|push|oidc|modules|accounts`.
Screenshots: `SCREENSHOT_DIR=<dir>` aktiviert die Screenshot-Specs (390 px und Desktop, hell/dunkel).

## Bekannte Grenzen / nicht geprüft
- L23: `reauth_required` und `account_deletion_incomplete` nur im Mock geprüft (echtes Backend: 10-Minuten-Frist bzw. defekter Speicher nötig); echtes `pushsubscriptionchange` im Browser nicht auslösbar (Logik per Unit-Test).
- Modulschalter sind seit L18 auch gegen das echte Backend geprüft (`e2e/modules.spec.ts`).
- Mock-Guard bildet die Routengruppen aus ADR-0012 nach; die automation-Events werden nur serverweit geprüft (Token-Konto unbekannt).
- Nicht geprüft: Firefox/WebKit, Screenreader, MariaDB-Modus, echte ChatGPT-/Claude-Connectoren, echte Push-Zustellung (iOS/Android), echter Shortcuts-Durchlauf, native Apps.
- Bekannter Backend-Befund (L16): `.webmanifest` ohne Content-Type; Icon-Dateinamen können `immutable` erhalten.

## CI auf GitHub (W1, Stand 17.10.2026)
Workflows unter `.github/workflows/` (CI mit Check, Vitest, Build, Playwright Mock und Produktionsbuild; optional Echt-E2E gegen selbst gebautes Backend; CodeQL; Dependency Review; Dependabot). Beim Abgleich am 17.10.: PWA-CI und CodeQL auf `main` grün. Dependency Review schlägt fehl, solange „Dependency graph“ im Repository nicht aktiviert ist; drei Dependabot-Pull-Requests offen (nicht gemergt, große Sprünge wie TypeScript 7 prüfen). Gesamtübersicht: Backend-Repo `docs/CI.md`.

## Handoffs (docs/handoffs/)
Je Paket ein Handoff mit Befehlen, Zahlen und Grenzen: L1, L3b, L4–L7b, L9, L11–L19, L21–L23 (Oberflächen, Echt-E2E, Designsprache, Konten), P1 (Profil/Einrichtung), P2 (Darstellung je Konto; enthält den Vertrag für die nativen Apps), X1 (MCP-Gesamt-E2E), W1 (CI). L2/L3a/L10 liegen im Backend-Repo, L20 wurde nur als Diagnose im Backend-Arbeitsplan geführt. Commit-Hashes in Handoffs sind seit der Historienbereinigung (17.10.2026) ungültig; Paket-ID und `git log --grep` verwenden.

## Nächste Schritte
Echtgeräte: Passkey auf Plattform-Authenticator, Installation als PWA (iOS/Android/Desktop), Push-Zustellung, Shortcuts-Durchlauf, ChatGPT-/Claude-Connector; Firefox/WebKit und Screenreader prüfen; Anschluss an die Produktionsinstanz (Build mit `npm run build`, Auslieferung durch das Backend über `PWA_STATIC_DIR`).

## Y1 (Import der Arbeitszeit-Tabelle als geführter Ablauf)
Erkennungskarte mit Vorlage, Vorschau mit einem Hauptknopf, „Anpassen“ eingeklappt, Ergebnis mit Schritt „Arbeitsmodell anlegen“, leere Vorlage. Details und Zahlen: docs/handoffs/Y1.md (Branch `y1-import-ux`, nicht integriert).
