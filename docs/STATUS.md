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
