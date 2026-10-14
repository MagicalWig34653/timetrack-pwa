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

## Stand 14.10.2026 – Paket L7a (Branch l7a-contract-0-3-1)

PWA und Mock an Vertrag v0.3.1 angepasst (weiterhin nur gegen die Mock-API für die Planungsseiten): `GET vacation/settings` immer 200 mit `configured`
(Hinweis „noch nicht gespeichert“ statt 404-Behandlung), Übertrag je Jahr (`carryOverByYear`, Formular bearbeitet nur das gewählte Jahr),
`snapshotRemainingHalfDays` statt Ableitung, `GET/DELETE vacation/entries` (Liste auf `/vacation`, Löschen mit Bestätigung), `GET absences/{id}` nach 412,
`countedHalfDays` nur für Urlaub und 0 bei abgelehnt/storniert (blockieren keine Überlappung), Freigabe-Fehler (`share_exists`, Eigenfreigabe) auf Deutsch,
`range_too_large` (Client teilt Anfragen: 366 Tage, `time/days` 93 Tage). Mock speist Abwesenheiten, Feiertage und halbe Urlaubstage in `time/days` ein
(Soll 0 bzw. halbiert, expliziter Marker gewinnt); Tagesansicht zeigt dazu einen neutralen Hinweis.
Geprüft: `npm run check` 0/0, `npm test` 184 grün (+26), `npm run build`, `npm run test:e2e` (echtes Backend) 29 grün, `npm run test:e2e:mock` 15 grün (+4 Screenshot-Specs übersprungen).
Details, Annahmen und offene Fragen: `docs/handoffs/L7a.md`.

## Stand 14.10.2026 – Paket L7b (Branch l7b-planning-e2e)

Urlaub, Abwesenheiten, Kalender/Planung und Freigaben laufen gegen das echte Swift-Backend (C1–C9, Vertrag v0.3.2): neue Spec `e2e/stage3-planning.spec.ts`
(20 Tests, dritte Backend-Instanz auf `E2E_PORT`+2 / `E2E_PLANNING_PORT`, eigene SQLite-DB): Arbeitsmodell, Urlaubseinstellungen (Standard nur vorgeschlagen, erst nach Speichern `configured`),
Stichtagsbestand ersetzt Anspruch (nicht additiv), Korrekturen/Einträge löschen, Osterurlaub (Feiertage/Wochenende nicht gezählt, geplant -> genehmigt -> genommen, Saldo nur einmal gebucht, Vorschau),
Feiertag vor Urlaub (`markSource`), Halbtage (Soll halbiert), Überlappung 409 deutsch, Krankheit mit Unterlagenfeldern (Zeitkonto +2 x 7:42, kein negatives Delta), 412 mit „Aktuelle Fassung laden“,
eigener Feiertag/Schulferien, Planung setzen/ändern/entfernen, Freigaben (Standard nichts, Umfänge einzeln, strenge Feldliste ohne Notizen/Orte/Krankheit/Unterlagen, Widerruf sofort 404, 409/400/404),
Kontentrennung mit fremden IDs (404). UI angepasst: `DayEvaluation.markSource`/`targetOverrideSeconds` (v0.3.2) in Typen, Tagesansicht zeigt die Herkunft der Markierung neutral; Mock liefert beide Felder.
Geprüft: `npm run check` 0/0, `npm test` 186 grün, `npm run build`, `npm run test:e2e` 49 grün (15 + 14 + 20), `npm run test:e2e:mock` 15 grün (4 Screenshot-Specs übersprungen ohne SCREENSHOT_DIR).
Keine Backend-Fehler gefunden (Beobachtungen in `docs/handoffs/L7b.md`). Nicht geprüft: MariaDB-Modus, Firefox/WebKit, Jahreswechsel der Maschinenuhr (Spec nutzt feste Daten 2026).
