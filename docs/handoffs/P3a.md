# Handoff P3a (PWA): robustes Update-Banner und 503 database_unavailable

Branch `p3a-update-banner` (Worktree `timetrack-pwa-wt/p3a`), nicht gemergt. Vertrag v0.20.0 (Backend ADR-0024).

## Problem
Bei zwei Backend-Replikaten und Rolling Updates liefert der Browser `service-worker.js` von Replikaten mit unterschiedlichem Stand und installiert fortlaufend "Updates"; das Banner "Neue Version verfügbar" verschwand nie. Nach dem Neuladen konnte zudem ein 500 (heute 503 `database_unavailable`) von einem Replikat ohne Datenbank sichtbar werden.

## Was gebaut ist
- `src/lib/pwa/update-policy.ts` (rein, Unit-getestet): `shouldShowUpdateBanner`. Ohne wartenden Worker nie. Sind eigene und vom Server gemeldete PWA-Revision (`GET /system/info` -> `pwa.revision`) bekannt, entscheidet allein der Vergleich: gleich = kein Banner (auch mit wartendem Worker), verschieden = Banner (auch im Unterdrückungsfenster). Ist `system/info` nicht verfügbar (alter Backend, offline, nicht angemeldet) oder eine Revision `unknown`: alte Logik, aber 10 Minuten nach einem angewendeten Update unterdrückt (`localStorage`-Zeitstempel `tt-pwa-update-applied-at`, alle Zugriffe mit try/catch).
- `pwa.svelte.ts`: `evaluateUpdate()` wird bei erkanntem wartendem Worker und bei Sichtbarkeitswechsel aufgerufen. `applyUpdate()` merkt den Versuch, blendet das Banner aus, sendet `SKIP_WAITING` und startet einen 3-s-Timer (`CONTROLLER_TIMEOUT_MS`). Ändert sich der Controller nicht (oder wirft `postMessage`), wird `hardReset()` ausgeführt: Service Worker abmelden, Caches löschen, einmal neu laden. Ein zweiter Hard Reset innerhalb 60 s wird zum einfachen Reload (Schleifenschutz); `controllerchange` löst höchstens einen automatischen Reload aus. `hardReset()` wird auch vom Knopf in der Hilfe (`VersionInfo.svelte`) genutzt.
- API-Client: GET wird bei Netzfehler und 502/503/504 (insbesondere 503 `database_unavailable`) bis zu zweimal wiederholt (bestand seit X1); neu: `Retry-After` (Sekunden oder HTTP-Datum) hat Vorrang vor dem Standard-Backoff, gedeckelt auf 5 s (`retryAfterMs`). Schreibende Aufrufe werden nie automatisch wiederholt. Neue Meldung `error.database_unavailable` (Deutsch) erscheint überall, wo `errorMessage()` genutzt wird.

## Tests
`src/lib/pwa/update-policy.test.ts`, `src/lib/pwa/pwa-update.test.ts` (Fake-Timer: Banner-Entscheidung, Fallback, Hard Reset, Schleifenschutz), Erweiterung `src/lib/api/client.test.ts` (Retry-After, Deckel, Aufgeben, Schreibzugriffe), `e2e-mock/version.spec.ts` (503 einmal, dann Erfolg).

## Offen
- Kein "Nochmal versuchen"-Knopf: es gibt keine zentrale Fehleroberfläche für Schreibfehler (jedes Formular zeigt `errorMessage()` selbst); ein Knopf müsste pro Formular ergänzt werden. Die Meldung sagt, dass erneut versucht werden kann.
- Das Banner-Verhalten im echten Service Worker ist nicht per Playwright abgedeckt (Mock-E2E läuft ohne Service Worker); `test:e2e:pwa` nicht ausgeführt.
- `worktime.spec.ts` (Import, Warnungen) schlug einmal im vollen Mock-Lauf fehl und lief danach grün (vermutlich flaky, nicht P3a).
