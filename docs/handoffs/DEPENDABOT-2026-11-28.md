# Dependabot 28.11.2026 (Karte C379644B)

- **Rot in PR #15:** `src/lib/pwa/license-notices.test.ts`. Nach Bumps von ausgelieferten Paketen muss `static/THIRD-PARTY-NOTICES.txt` neu erzeugt werden (`node scripts/generate-licenses.mjs` bzw. `npm run build`); Dependabot tut das nicht.
- **uuid (GHSA-w5hq-g745-h8pq):** kommt nur über die devDependency `exceljs` 4.4.0 (letzte stabile Version, verlangt `uuid ^8`). Override auf `^11.1.1`; nicht höher, weil exceljs per `require` lädt und uuid ab 12 kein CommonJS mehr liefert.
- **E2E `asset-recovery`:** altes Rennen zwischen `modulepreload` und `import()` des Entry-Skripts. Scheiterte der Preload vor dem `import()`, lud Chromium die Datei neu, die App startete ohne Recovery. Mit verzögertem `start.js` 5/5 rot (auch auf dem alten main), nach dem Fix 60/60 grün. Kein Produktfehler.
- **jsdom 31:** nur Vitest-Umgebung. Canvas läuft jetzt über `@napi-rs/canvas` (liegt über `pdfjs-dist` schon im Lock), neue CSS-Engine, Parser pausiert an Skripten (kein eigenes `new JSDOM`). Braucht Node `>=26` bzw. 22.22.2/24.15; `.node-version` 26.5.0 passt. 1450/1450 Unit grün.
- **Lokal rot (bekannt, siehe V1.md):** `e2e-pwa/pwa.spec.ts` Push-Zustellung, auch auf unverändertem main; in der CI grün. Die Datei läuft seriell, den Rest mit `--grep-invert "push: enable on this device"` prüfen.
- **Auslieferung:** Ein Push auf PWA-`main` deployt nichts. Das Backend (`docker.yml`, Zeitplan) baut daraus ein Image auf ghcr (auch `:latest`); Rollout nur manuell per `update.sh`.
