# Handoff AC2 (PWA-Teil): sechs weitere Akzentfarben

Stand: 18.10.2026. Branch `AC2` (Worktree `timetrack-pwa-wt/ac2`), nicht gemergt. Vertrag v0.21.0 (Backend-Branch `AC2`, dort `docs/handoffs/AC2.md` mit den Werten für die Apple-Apps).

## Änderungen

- `src/lib/theme/accent.ts`: `ACCENT_IDS`/`ACCENT_PRESETS` um `wine #7f1d3f`, `slate #475a8c`, `cocoa #5c4033`, `olive #4d6b1f`, `ocean #0e7490`, `ink #334155`; neue Liste `ACCENT_IDS_V021`. Ableitung (Hell/Dunkel, Ink, Soft, Glow) ist unverändert und gilt für alle Voreinstellungen.
- `src/lib/i18n/de-design.ts`: Namen Wein, Schiefer, Kakao, Oliv, Ozean, Tinte (Reihenfolge wie `ACCENT_IDS`).
- `src/lib/theme/theme.svelte.ts`: Rückfall in zwei Stufen. Lehnt ein Server beim Speichern einer neuen ID mit 400 ab, sendet die PWA `custom` plus Hex und behält `glow` (Server v0.15.0 bis v0.20.0); lehnt er danach erneut ab, fällt sie wie bisher auf die v0.14.0-Form zurück.
- Mock (`mock/api.ts`) kennt die IDs.
- Tests: Unit (`glow.test.ts`: Weiß-Kontrast je neue Voreinstellung, OKLab-Abstand mindestens 5,5 zu allen anderen, Tokens hell/dunkel für alle 21 über die bestehende Schleife; `theme.test.ts`: Rückfall-Kette), Mock-E2E (`glow.spec.ts`: IDs, Namen, Speichern; `accent-shots.spec.ts`: Bildschirmfotos mit `SCREENSHOT_DIR`).

## Prüfstand

`npm run check` 0 Fehler; `npm test` 751 bestanden; `test:e2e:mock` 106 bestanden, 49 übersprungen (Bildschirmfoto-Specs ohne `SCREENSHOT_DIR`), 0 Fehler. Echt-Backend-E2E nicht ausgeführt (nur ID-Liste und Mock berührt; das Backend prüft die IDs in seinen Tests).
