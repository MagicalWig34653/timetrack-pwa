# Handoff W1-PWA: Verwaltung der Auslöse-Links

Stand: 22.10.2026. Branch `w1-trigger-links` (auf main 430c0b1), nicht gepusht, nicht gemergt. Gegenstück: Backend-Handoff `docs/handoffs/W1.md`, ADR-0027, Vertrag **v0.26.0**.

## Vertrag und Herkunft
Die PWA hält keine Kopie des OpenAPI-Dokuments; der Client ist von Hand nach `contracts/openapi.yaml` des Backends getippt (Stand Backend-Worktree W1, Vertrag 0.26.0, Operationen `listTriggerLinks`, `createTriggerLink`, `revokeTriggerLink`, Schema `TriggerLink`). Typen: `TriggerLink`, `TriggerLinkInput`, `TriggerAction` in `src/lib/api/types.ts`; Client `api.listTriggerLinks/createTriggerLink/revokeTriggerLink`.

## Umsetzung
- Neue Seite `/settings/trigger-links` (Modul `automation`, `src/lib/modules/map.ts`, Einstellungsnavigation Gruppe Verbindungen, Suchbegriffe). Modul aus: Eintrag verschwindet, Route zeigt die übliche Modul-aus-Seite; Mock ordnet `me/trigger-links` dem Modul `automation` zu.
- Liste: Bezeichnung, Aktionen, Art, Ort (Name oder „nicht mehr vorhanden“), erstellt, zuletzt benutzt mit Aktion, Ablauf. Widerruf mit Bestätigung (Text nennt die Folge, nicht rückgängig).
- Anlegen: Bezeichnung (max. 80), Aktionen (Start, Stopp, Umschalten; mindestens eine), Ort optional (nicht archivierte), Art, Gültigkeit 1 bis 730 Tage. Fehler 409 `too_many_trigger_links` hat eine deutsche Meldung.
- Einmalanzeige: Nach dem Anlegen eine Warnbox mit je Aktion der vollständigen Adresse (`location.origin + path + /aktion`) und Kopierknopf; Token nur im Komponentenzustand, nie in Speicher, URL oder Liste; „Ich habe sie gespeichert“ schließt.
- Sicherheitstext (immer sichtbar) und Hilfekarte zu `at`, `place`, `format`, Ergebnissen, 404/429, Prefetch.
- Service Worker: `/t` steht in `BYPASS_PREFIXES` (`src/lib/pwa/core.ts`); der Worker fängt `/t/…` weder ab noch cached es. Test in `core.test.ts` (inkl. `/time` bleibt abfangbar).
- Mock (`mock/time.ts`): GET/POST/DELETE `me/trigger-links` wie der Server (Validierung 400, Ort 404, 20er-Grenze 409, Token 43 Zeichen nur in der POST-Antwort). Der Aufruf `/t/…` selbst ist nicht gemockt.

## Tests
`npm run check` 0 Fehler; `npm test` 88 Dateien, 970 Tests grün (neu: `src/routes/trigger-links-page.test.ts` 6, Mock-Test, SW-Bypass, Modulzuordnung); `E2E_MOCK_PORT=5388 npm run test:e2e:mock` für `e2e-mock/trigger-links.spec.ts` und `modules.spec.ts`: 7 grün. Desktop-Screenshots manuell geprüft.

## Offene Punkte
1. Nicht gegen den echten Server und nicht auf Geräten erprobt; `/t/` muss hinter dem Proxy zum Backend, nicht zur PWA-Hülle (regelt Backend `PWAStaticMiddleware`).
2. Archivierte Orte fehlen in der Auswahl; ein Link an einen später archivierten Ort zeigt den Ortsnamen weiter.
3. Kein Bearbeiten eines Links (Vertrag kennt nur Anlegen/Widerrufen).
4. Keine Telefon-Screenshots (nur Desktop).
