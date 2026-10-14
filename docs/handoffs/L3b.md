# Übergabe L3b – Browser-E2E gegen das echte Backend

Branch `l3b-e2e` (nicht gepusht). Code und Tests englisch, UI-Texte deutsch (Selektoren nutzen die deutschen Labels).
Backend (`main`, C1+C2+L2) unverändert; PWA-Quellcode unverändert (kein UI-Fehler gefunden).

## Ausführung

```sh
npm run test:e2e                      # = npm run build && playwright test
E2E_SKIP_BUILD=1 npx playwright test  # überspringt nur den Swift-Build (Binary muss existieren); build/ muss vorhanden sein
```

Globales Setup (`e2e/global-setup.ts`): `swift build --build-system native` im Backend-Repo (`E2E_BACKEND_DIR`, Standard `../timetrack-backend`),
temporäre SQLite-Datei in `os.tmpdir()`, `App bootstrap-admin` (Einladungslink nur im Speicher als `E2E_BOOTSTRAP_LINK`,
nie in Datei/Log), dann `App serve --hostname 127.0.0.1 --port <port>`, Warten auf `/ready`, Teardown (SIGTERM, Temp-Verzeichnis löschen).
Env im Backend: `DATABASE_DRIVER=sqlite AUTO_MIGRATE=true PWA_STATIC_DIR=<pwa>/build PUBLIC_BASE_URL=WEBAUTHN_ORIGIN=http://localhost:<port> WEBAUTHN_RP_ID=localhost`.
Port: `E2E_PORT`, Standard **18090** (18080 gehört dem Compose-Backend). Ist der Port belegt, bricht das Setup mit klarer Meldung ab,
fremde Prozesse werden nie beendet (geprüft mit `E2E_PORT=18080`). Browser: Playwright-Chromium aus dem Cache (1.64.0), headless,
CDP-`WebAuthn`-Authenticator (ctap2, internal, resident key, user verification, automatische Präsenz).

## Ergebnis (14.10.2026)

`15 passed` (zweimal hintereinander, ca. 10-20 s). `npm run check` 0/0, `npm test` 31 grün, `npm run build` grün.

| Test | Abdeckung |
|---|---|
| 1-2 | Bootstrap-Link -> Registrierung mit Passkey -> /setup/recovery -> Übersicht (Admin-Navigation); Bootstrap-Link ist danach ungültig |
| 3 | Letzter Passkey ohne Wiederherstellungsmethode: Widerruf abgelehnt (`last_passkey`, deutsche Meldung), Passkey bleibt |
| 4 | Abmelden, Routenwächter (`/login?next=`), Anmeldung per Passkey (discoverable, ohne Kontoangabe) |
| 5 | Zweiten Passkey hinzufügen, umbenennen |
| 6 | 10 Recovery-Codes erzeugen (Anzeige, Bestätigung, "Übrige Codes: 10"), Rückfallpasswort setzen |
| 7-8 | Passkey A widerrufen; mit A kann man sich nicht mehr anmelden |
| 9 | Recovery per Code -> Recovery-Sitzung -> neuer Passkey -> `/settings/passkeys`; derselbe Code ein zweites Mal abgelehnt |
| 10 | Recovery per Rückfallpasswort (+ falsches Passwort abgelehnt) |
| 11-12 | Admin erstellt Einladung (Liste enthält nie den Token), Zweitnutzer registriert über Link (kein Admin-Menü); benutzte, widerrufene und abgelaufene Einladung abgelehnt (Ablauf: `expires_at` in der Wegwerf-SQLite per `sqlite3` zurückgesetzt, keine Wartezeit) |
| 13 | Zweitnutzer: `GET/POST admin/invitations` 403, fremde Einladungs-ID und fremde Passkey-ID (DELETE/PATCH) 404, eigene Passkey-Liste ohne fremde ID, `/admin/invitations` per UI nicht erreichbar |
| 14 | `DELETE me/sessions`: andere Sitzung wird 401/Login, eigene bleibt |
| 15 | Vertrag: Cookie `tt_session` HttpOnly, SameSite=Lax, nicht Secure (http); Mutation ohne `X-CSRF-Token` -> 403 `csrf_invalid`; `auth/session` ohne Cookie 401; SPA-Fallback für `/invite/...` 200 text/html, `/api/v1/nope` 404; Handle-Konflikt wird deutsch angezeigt |

## Befunde

Backend-Fehler: **keine gefunden.** UI-Fehler: **keine gefunden.** Vertragsabgleich PWA <-> Backend bestätigt:

- Feldnamen, Statuscodes und Fehlercodes der geprüften Pfade passen (`last_passkey`, `handle_taken`, `csrf_invalid`, 404 bei fremden IDs, 403 für Nicht-Admin).
- Cookie/CSRF: `X-CSRF-Token` aus `GET auth/session` funktioniert; ohne Header 403.
- Offene L1-Frage 3 beantwortet: Nach `POST me/passkeys/verify` in der Recovery-Sitzung ist die Sitzung kein Recovery mehr; die PWA landet direkt auf `/settings/passkeys`.
- Offene L1-Frage 10 beantwortet: `bootstrap-admin` gibt `<PUBLIC_BASE_URL>/invite/<token>` aus, passt zur PWA-Route.
- Einladungslink-Anzeige im Admin-UI nutzt `location.origin`; passt nur, solange PWA und Backend dieselbe Origin haben (hier ja).

Testtechnische Einschränkungen (keine Produktfehler):
- Ein virtueller Authenticator kann nicht zwei Resident-Credentials mit gleichem User-Handle (= gleiches Konto) halten; das zweite hätte das erste überschrieben. Der Test nutzt deshalb für Passkey B einen leeren Authenticator (`swapToEmptyAuthenticator`) und merkt sich Passkey A separat. Zudem sendet der Server `excludeCredentials`, daher wäre ein zweiter Passkey auf demselben Authenticator ohnehin abgelehnt worden.
- Die Tests sind eine serielle Geschichte (Zustand baut aufeinander auf), eine frische DB pro Lauf.

## Nicht verifiziert

- MariaDB-Modus (optional, nicht umgesetzt): wäre `DATABASE_DRIVER=mariadb DB_HOST=127.0.0.1 DB_PORT=13306 DB_TLS=off DB_PASSWORD=… DB_NAME=<Wegwerf-DB>` mit angelegter und danach gelöschter Datenbank in `timetrack-dev-db-1`; Zugangsdaten nicht bekannt, Dev-DB nicht angefasst.
- E-Mail-Wiederherstellung (Backend: 501 ohne Sender), Freshness/`reauth_required` (10-Minuten-Fenster), Rate-Limits (429), Recovery-Sitzungsablauf (30 Min.).
- Nur Chromium (headless) mit virtuellem Authenticator, kein echter Plattform-Authenticator, kein Firefox/WebKit, keine mobile Breite, kein Dunkelmodus.
- Dev-Server-Proxy (`npm run dev`) nicht Teil dieses Laufs; getestet ist die produktionsähnliche Ein-Origin-Auslieferung durch das Backend.
- Der Expired-Test setzt den Ablauf per `sqlite3` direkt in der Wegwerf-DB (Zeitformat wird automatisch erkannt).
- Linux/Docker nicht geprüft; Server-Ausgabe wird verworfen (`stdio: ignore`), damit nie Tokens in Logs landen.
