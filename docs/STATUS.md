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

## Stand 14.10.2026 – Paket L9 (Branch l9-export-import-storage-ui)

Oberfläche für Export, Import, Dateispeicher und Abwesenheitsanhänge gegen Vertrag v0.4.0 (nur gegen die Mock-API, das Backend implementiert die Endpunkte erst in C11–C13):
`/export` (Zeitraum, Monatskürzel, xlsx/pdf/csv, Download per Blob mit Dateiname aus Content-Disposition, Hinweis tatsächlich vs. bewertet, `range_too_large`),
`/import` (Assistent mit sechs Schritten: Datei, Blatt/Kopfzeile mit Rohvorschau, Spalten und Formate inkl. Dezimalstunden 7,7 = 7:42, Vorlagen, Vorschau, ausdrückliche Bestätigung, Ergebnis mit Rücknahme und Konfliktliste, Verwerfen),
`/settings/storage` (nur Admin; Regeleditor, Geheimnis nur schreibend, 501-Hinweis zu STORAGE_SECRET_KEY, „gilt nur für neue Uploads“), Anhänge im Abwesenheitsformular (Whitelist, 413/415 deutsch, „nie geteilt“).
Mock: TS-Port des Import-Parsings (`src/lib/transfer/import-parse.ts`), echtes CSV, Platzhalter für XLSX/PDF. Neue Seiten zeigen bei 404/501 „noch nicht verfügbar“.
Geprüft: `npm run check` 0/0, `npm test` 262 grün, `npm run build`, `npm run test:e2e` (echtes Backend) 49 grün, `npm run test:e2e:mock` 23 grün (+4 Screenshot-Specs übersprungen ohne SCREENSHOT_DIR), Screenshots 390 px/Desktop hell/dunkel gesichtet.
Details und offene Vertragsfragen: `docs/handoffs/L9.md`.

## Stand 14.10.2026 – Paket L11 (Branch l11-oidc-ui)

Oberfläche für optionales OIDC gegen Vertrag v0.5.0 und ADR-0007 (nur gegen die Mock-API, das Backend implementiert die Endpunkte erst in C14):
`/login` zeigt bei `GET auth/oidc/config` `enabled` unter dem Passkey-Button „Mit <Name> anmelden“ (sekundär; Fehler der Config-Abfrage verstecken ihn nur) und liest `?oidc_error=<code>` (alle sieben Codes auf Deutsch, URL wird bereinigt);
`/invite/[token]` bietet „Stattdessen mit <Name> registrieren“, nach Rückkehr mit `?oidc=<pendingId>` Formular für Kontoname/Anzeigename (`POST auth/oidc/register`) und danach die Aufforderung „Passkey einrichten“;
neue Seite `/settings/identities` (Liste mit E-Mail nur als Hinweis, Verknüpfen mit `purpose=link`, Entfernen mit Bestätigung, `409 last_login_method`, `403 reauth_required` -> „Abmelden und neu anmelden“, Banner `?linked=1`), Eintrag in der Einstellungsnavigation.
Angemeldete Nutzer, die per Fehler-Redirect auf `/login?oidc_error=…` landen (z. B. Verknüpfen fehlgeschlagen), werden zu `/settings/identities?oidc_error=…` weitergeleitet, damit die Meldung nicht verloren geht.
Mock: Config (standardmäßig an in `dev:mock`, `MOCK_OIDC=0` schaltet aus, `MOCK_OIDC_NAME`), In-App-Anbieter `/mock-idp` (nur mit `VITE_MOCK=1`; Demo-Nutzer 1/2, Fehlercodes), Callback als 302, Identitäten mit Regeln (`last_login_method`, `identity_taken`, frische Sitzung), Test-Hook `POST /api/v1/mock/oidc` (nicht im Vertrag).
Geprüft: `npm run check` 0/0, `npm test` 297 grün, `npm run build`, `npm run test:e2e` (echtes Backend, unverändert) 49 grün, `npm run test:e2e:mock` 29 grün (+4 Screenshot-Specs übersprungen ohne SCREENSHOT_DIR), Screenshots 390 px hell/dunkel (Login, Einladung, Identitäten, Mock-IdP).
Nicht geprüft: echtes Backend/Dex (E2E folgt mit C14), Firefox/WebKit. Details und offene Fragen: `docs/handoffs/L11.md`.

## Stand 15.10.2026 – Paket L12 (Branch l12-stage3b-e2e)

Export, Import-Assistent, Dateispeicher-Admin und Abwesenheitsanhänge laufen gegen das echte Swift-Backend (C1–C13, Vertrag v0.5.1): neue Spec `e2e/stage3b.spec.ts` (25 Tests, vierte Instanz auf `E2E_PORT`+3 mit `STORAGE_SECRET_KEY` und temporärem lokalem Speicherverzeichnis), inkl. S3-Variante gegen Adobe S3Mock (wird ohne S3Mock übersprungen).
UI behoben: Fehlercodes an das Backend angepasst (`import_not_ready`, `rollback_conflict`, `unsupported_type`) plus Texte für `too_many_rows`, `storage_unavailable`, `storage_corrupt`; Mock angeglichen.
Geprüft: `npm run check` 0/0, `npm test` 297, `npm run build`, `npm run test:e2e` 74 grün, `npm run test:e2e:mock` 29 grün. Keine Backend-Fehler (Beobachtungen in `docs/handoffs/L12.md`).

## Stand 15.10.2026 – Paket L13 (Branch l13-reports-ui)

Berichtsheft-Oberfläche gegen Vertrag v0.6.0 / ADR-0008 (nur gegen die Mock-API, das Backend implementiert die Endpunkte erst in C15):
`/reports` (ISO-Wochennavigation mit Jahr/KW, Vor/Zurück, aktuelle Woche, KW 53; Einträge je Tag mit Lernfeld, Zeit h:mm, Notizen; Anlegen/Bearbeiten/Löschen mit Bestätigung, If-Match und 412-Ablauf; Zeiteingabe h:mm oder Dezimalstunden mit Komma, live gelesen als h:mm; Lernfeld-Combobox mit Freitext; Wochen- und Lernfeldsummen; neutraler Hinweis „Arbeitszeit laut Zeiterfassung“; Status Entwurf/Erledigt; „Als Text kopieren“ mit Zwischenablage, Vorschau-Dialog, Fallback mit markiertem Text, Toast; Quellen mit Notizen und Dateien),
`/settings/learning-fields` (CRUD), Dashboard-Karte „Berichtsheft“ (blendet sich bei 404/501 aus). Neue Seiten zeigen bei 404/501 „noch nicht verfügbar“. Details, Annahmen, offene Fragen: `docs/handoffs/L13.md`.
Geprüft: `npm run check` 0/0, `npm test` 346 grün (+49), `npm run build`, `npm run test:e2e` (echtes Backend) 74 grün, `npm run test:e2e:mock` 39 grün (+10; 8 Screenshot-Specs übersprungen ohne SCREENSHOT_DIR), Screenshots 390 px/Desktop hell/dunkel ohne horizontales Scrollen. Nicht geprüft: echtes Backend für das Berichtsheft, Firefox/WebKit, Screenreader.

## Stand 15.10.2026 – Paket L14 (Branch l14-reports-e2e)

Berichtsheft läuft gegen das echte Swift-Backend (C15, Vertrag v0.6.0): neue Spec `e2e/reports.spec.ts` (19 Tests, fünfte Instanz auf `E2E_PORT`+4 / `E2E_REPORTS_PORT`, eigene SQLite-DB, Datenbank-Dateispeicher).
Angeglichen: echtes Textformat (`Summe: h:mm h`, keine Restzeile bei leerer Notiz, Zeilenumbrüche als ` / `) in Mock, Golden-Tests und Mock-E2E; fehlendes If-Match -> 412, unbekannte Lernfeld-ID -> 404 im Mock; L13-Annahmen geprüft (Details und offene Fragen: `docs/handoffs/L14.md`). Keine Backend-Fehler gefunden.
Geprüft: `npm run check` 0/0, `npm test` 347, `npm run build`, `npm run test:e2e` 93 grün (74 + 19), `npm run test:e2e:mock` 39 grün (+8 übersprungen). Nicht geprüft: Firefox/WebKit, S3/lokales Backend für Quellen, MariaDB.
## Stand 15.10.2026 – Paket L15 (Branch l15-mcp-ui)

Oberfläche für MCP/OAuth gegen Vertrag v0.7.0 / ADR-0009 (nur gegen die Mock-API, das Backend implementiert die Endpunkte erst in C16/C17):
`/oauth/consent?request=<id>` (außerhalb des App-Layouts, aber angemeldet: sonst `/login?next=…` und Rückkehr; Client-Name, Weiterleitungs-Host prominent, angemeldetes Konto mit „Anderes Konto verwenden“, Scopes als Checkboxen mit Klartext, Schreibrechte hervorgehoben, Hinweis auf Widerruf, „Zugriff erlauben“/„Ablehnen“, nie automatische Entscheidung; 404 abgelaufen/ungültig, 409 bereits entschieden),
`/settings/api-tokens` (Liste, Formular mit Voreinstellungen „Nur lesen“/„Lesen und schreiben“, Ablauf 30/90/365 Tage, Token nur einmal mit Kopieren, `reauth_required` -> neu anmelden, Widerruf mit Bestätigung),
`/settings/connections` (OAuth-Grants, Widerruf mit Bestätigung), `/settings/mcp-help` (Adresse `<origin>/mcp` mit Kopieren, OAuth-Ablauf, ChatGPT/Claude Schritt für Schritt, Bearer-Header, Sicherheit; deutlicher Hinweis: mit echten Clients NICHT geprüft).
Mock: `/oauth/register`, `/oauth/authorize` (302 zur Consent-Seite), Anfragen/Entscheidung/Grants/Tokens mit Regeln; Mock-Client-Seite `/mock-oauth` (nur `dev:mock`) erzeugt den kompletten Ablauf mit PKCE.
Geprüft: `npm run check` 0/0, `npm test` 384 grün, `npm run build`, `npm run test:e2e` (echtes Backend) 74 grün (mit `E2E_PORT=18190`, 18090 war belegt), `npm run test:e2e:mock` 48 grün (+10 Screenshot-Specs übersprungen ohne SCREENSHOT_DIR; mit `E2E_MOCK_PORT=5231`), Screenshots 390 px hell/dunkel gesichtet (Consent, Tokens, Verbindungen, Hilfe), kein horizontales Scrollen.
Nicht geprüft: echtes Backend, echtes ChatGPT/Claude, Firefox/WebKit. Details und offene Fragen: `docs/handoffs/L15.md`.

## Stand 15.10.2026 – Paket X1 (Branch x1-mcp-e2e)

OAuth 2.1 und MCP laufen Ende zu Ende gegen das echte Swift-Backend (C16/C17, Vertrag v0.7.0): neue Spec `e2e/mcp.spec.ts` (27 Tests, seriell, Alice + Bob) mit Skript-MCP-Client (`e2e/mcp-client.ts`, JSON-RPC über fetch, lokaler Loopback-Listener für `redirect_uri`) und sechster Instanz auf `E2E_PORT`+5 / `E2E_MCP_PORT` (eigene SQLite-DB). Geprüft: Metadaten, 401/405, Client-Registrierung, PKCE-Flow mit PWA-Zustimmungsseite (Scope abgewählt), falscher Verifier/Redirect/Resource/Client, Code-Wiederverwendung, Refresh-Rotation und Reuse-Erkennung, MCP-Sitzung, Scope-Durchsetzung, Idempotenz, Versionskonflikte, Prompt-Injection-Text als Daten, Widerruf (Verbindungen, API-Tokens), Kontentrennung, Ablehnen-Fluss.
Angeglichen: Hinweis auf der Zustimmungsseite bei „Anderes Konto verwenden“ (die Anfrage ist an die erste Sitzung gebunden, nach dem Wechsel muss die Verbindung im Client neu gestartet werden). Keine Backend-Fehler, zwei kleine Abweichungen vom C16-Handoff in `docs/handoffs/X1.md`.
Geprüft: `npm run check` 0/0, `npm test` 384, `npm run build`, `npm run test:e2e` 120 grün (93 + 27), `npm run test:e2e:mock` 48 grün (10 Screenshot-Specs übersprungen). Nicht geprüft: echte ChatGPT-/Claude-Connectoren, Token-Ablauf per Zeit, Firefox/WebKit.
