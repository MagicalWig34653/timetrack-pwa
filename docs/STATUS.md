# Lokaler Stand – 13.10.2026

Auf main: SvelteKit 3, Svelte 5, TypeScript, Tailwind 4, shadcn-svelte (Nova/Neutral),
Static Adapter, Startseite mit Badge. npm 11.17.0 / Node 26.5.0, Lockfile vorhanden.
Prüfung: npm run check (0 Fehler/Warnungen), npm run build (statisches build/) erfolgreich.
Kein Browserdurchlauf; keine API/Auth-/Fachfunktionen. Noch kein Manifest/Service Worker,
keine installierbare PWA oder Offline-Synchronisation. Keine laufenden Dienste.
Nächstes Paket: API-Verträge im Backend abstimmen, Kontenoberfläche und PWA-Einrichtung.
Globale Aufgaben/Entscheidungen: ../../timetrack-backend/docs/STATUS.md und ARBEITSPLAN.md.

Nachtrag 14.10.2026: Sprachregel in AGENTS.md verbindlich ergänzt (Details im Backend).
Nur Dokumentation geändert; Diff geprüft, keine Builds erneut ausgeführt.
Lokalisierungsressourcen für die bisherigen direkt eingebetteten deutschen UI-Texte noch offen.

## Stand 14.10.2026 – Paket L1 (Branch l1-auth-ui)

Vorhanden: Kontenoberfläche (Einladung/Registrierung, Login mit Passkey, Wiederherstellung, Passkey-/Recovery-/Sitzungsverwaltung,
Admin-Einladungen), SPA ohne SSR mit Routenwächter, getippter API-Client, WebAuthn-Helfer, deutsche Lokalisierung in `src/lib/i18n/de.ts`,
Mock-API (`npm run dev:mock`), Dev-Proxy `/api` -> 127.0.0.1:18080. Geprüft: `npm run check` (0 Fehler), `npm test` (31 grün),
`npm run build`, Mock-Durchlauf in Headless-Chromium. NICHT geprüft: echtes Backend, echter Authenticator, mobile Breite/Dunkelmodus per Screenshot.
Details und offene Vertragsfragen: `docs/handoffs/L1.md`. Noch kein Manifest/Service Worker.

## Stand 14.10.2026 – Paket L3b (Branch l3b-e2e)

Playwright-E2E gegen das echte Swift-Backend (`npm run test:e2e`, Port `E2E_PORT`, Standard 18090, SQLite-Wegwerf-DB, virtueller WebAuthn-Authenticator):
15 Tests grün (Bootstrap, Registrierung, Login/Logout, Passkeys, Recovery-Codes/Passwort, Einladungen, Kontentrennung, Sitzungen, Vertrag).
Keine Backend- oder UI-Fehler gefunden. Nicht geprüft: MariaDB-Modus, E-Mail-Wiederherstellung, Firefox/WebKit. Details: `docs/handoffs/L3b.md`.

## Stand 14.10.2026 – Paket L4 (Branch l4-time-ui)

Zeiterfassungs-Oberfläche gegen den Vertrag v0.2.0 (nur gegen die Mock-API, das Backend implementiert die Endpunkte erst in C6):
Dashboard `/` (Timer, Tagesverlauf roh/bewertet, Soll/Differenz, Zeitkonto), `/time`, `/time/[date]`, `/suggestions`,
`/settings/work-model|places|account-time|devices`. Beträge immer h:mm. Timer-Aufrufe idempotent (clientEventId, Wiederholung nur bei Netzfehlern).
Geprüft: `npm run check` 0/0, `npm test` 101 grün, `npm run build`, `npm run test:e2e` (echtes Backend, unverändert) 15 grün,
`npm run test:e2e:mock` 6 grün (startet `dev:mock`), Screenshots 390 px und Desktop, hell/dunkel (Chromium). Nicht geprüft: echtes Backend für die neuen Seiten,
Firefox/WebKit, Pfeiltasten-/Screenreader-Durchlauf. Details und offene Vertragsfragen: `docs/handoffs/L4.md`.

## Stand 14.10.2026 – Paket L5 (Branch l5-time-integration)

Die Zeiterfassungs-Seiten laufen gegen das echte Swift-Backend (C1–C6, Vertrag v0.2.1): neue Spec `e2e/stage2-time.spec.ts`
(14 Tests, eigene Backend-Instanz auf `E2E_PORT`+1, eigene SQLite-DB): Arbeitsmodell 38:30 h, Orte mit Automatikmodus,
Timer mit Doppelklick, ADR-Beispiel (roh 6:55, bewertet 7:15, Lücke unverändert), Korrektur mit Grund und 412-Konflikt aus zweitem
Browser-Kontext, Storno, Tagesmarkierung, Anfangsstand, Gerätetoken (nur einmal sichtbar), `automation/events` per Bearer
(direct/suggest/off, Vorbeifahrt, Duplikat), Vorschlag annehmen/verwerfen, Kontentrennung (fremde IDs -> 404).
Geprüft: `npm run check` 0/0, `npm test` 101 grün, `npm run build`, `npm run test:e2e` 29 grün (15 alt + 14 neu), `npm run test:e2e:mock` 6 grün.
UI behoben: Tagesnotiz/Gutschrift werden aus v0.2.1 vorbelegt, Anfangsstand auch nach erstem Modell erfassbar, Meldung `suggestion_resolved`.
Keine Backend-Fehler gefunden. Neue Anleitung `docs/SHORTCUTS.md` (nicht auf echtem Gerät geprüft). Details: `docs/handoffs/L5.md`.

## Stand 14.10.2026 – Paket L6 (Branch l6-planning-ui)

Oberfläche für Urlaub, Abwesenheiten, Kalender/Planung und Freigaben gegen den Vertrag v0.3.0 (nur gegen die Mock-API, das Backend implementiert die Endpunkte erst in C8/C9):
`/vacation` (Saldo je Jahr mit Erklärtexten, Stichtagsbestand, Korrekturen, Einstellungen mit Vorschlagswerten 30 Tage/DE-ST nur vorbelegt),
`/calendar` (Monatsraster, auf dem Handy Wochenliste; Feiertage, Ferien, Abwesenheiten, Planung, Ist-Hinweise; Tag anklicken zum Anlegen),
`/absences` (Jahresliste, Filter, Bearbeiten mit If-Match), `/settings/sharing` (ausgehende Freigaben), `/shared` (eingehende Freigaben, nur Lesen).
Urlaub wird aus ganzzahligen halben Tagen als „12,5 Tage“ gezeigt. Mock enthält TS-Port der ADR-0005-Regeln und einen Feiertagsrechner (DE-ST u. a.).
Neue Seiten zeigen bei 404/501 „noch nicht verfügbar“. Details, Mock-Annahmen und offene Vertragsfragen: `docs/handoffs/L6.md`.
Geprüft: `npm run check` 0/0, `npm test` 158 grün, `npm run build`, `npm run test:e2e` (echtes Backend) 29 grün, `npm run test:e2e:mock` 13 grün (+4 Screenshot-Specs übersprungen ohne SCREENSHOT_DIR), Screenshots 390 px/Desktop hell/dunkel.
