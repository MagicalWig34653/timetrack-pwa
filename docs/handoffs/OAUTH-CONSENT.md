# Handoff OAUTH-CONSENT (Vertrag 0.44.0, Backend SCOPE-F10)

Branch `oauth-consent`. Die OAuth-Zustimmungsseite (`/oauth/consent`) liest die neuen Felder von `GET /oauth/requests/{id}`; der Mock meldet `apiVersion` 0.44.0.

## Umgesetzt
- **Auswahl:** Die Seite zeigt alle `availableScopes` (bestehender `ScopePicker`, Checkboxen mit deutscher Bezeichnung und Beschreibung je Scope, Schreibrechte hervorgehoben). Angehakt ist die Vorbelegung `scopes`, der Rest ist abgewählt und wird nur von der Person ergänzt. Gesendet wird die Auswahl als `decision.scopes`.
- **Ohne `scope`-Parameter** (`requestedScopes` leer): Hinweis „Die Anwendung hat keine bestimmten Rechte angefragt. Es sind nur Leserechte vorausgewählt.“ (`data-testid="no-scopes-requested"`) und angepasster Auswahltext. Mit `scope`: wie bisher, nur die angefragten Rechte stehen zur Wahl.
- **Mindestens ein Recht:** ohne Auswahl ist „Zugriff erlauben“ deaktiviert, Hinweis bleibt. Schreibwarnung nur bei gewähltem Schreibrecht.
- „Nicht verifizierter Client“ samt Registrierungsdatum und die Weiterleitungsadresse unverändert (SEC-clients). Keine einseitigen Rahmen.
- Typ `OAuthRequest`: `requestedScopes`, `availableScopes`.
- **Mock** wie Backend: `requestedScopes`/`availableScopes` (ohne `scope`: alle sieben wählbar, Vorbelegung nur `:read`); `decision` mit Scope außerhalb `availableScopes` -> 400, ohne `scopes` im Body gilt die Vorbelegung. Die Mock-Clientseite `/mock-oauth` sendet keinen `scope`, wenn nichts angehakt ist.

## Tests
- Unit: `mock/mcp.test.ts` (Vorbelegung, Erweitern, 400, Body ohne scopes), `src/routes/mcp-pages.test.ts` (Hinweis, Schalter, Erweitern auf Schreibrecht, mit scope, 400 als Fehlermeldung).
- Mock-E2E: `e2e-mock/mcp.spec.ts` (ohne scope: nur lesend, Schreibrecht ergänzen, Grant; mit scope; nichts gewählt -> Button deaktiviert).

## Offen
- Prüfung gegen das echte Backend 0.44.0 und Gerät.
- `npm run check` zeigt in Worktrees mit verlinktem `node_modules` 18 bekannte `./$types`-Fehler (vor der Änderung identisch); im Hauptcheckout nicht relevant.
- Mock-E2E: 270 grün, 88 vorgesehene Skips (Screenshot-Läufe); der erste vollständige Lauf hatte nur die zwei Versionstests rot (API-Version 0.44.0, angepasst). Läufe nach Mitternacht: `continue-timer.spec.ts` („long gap“, 3 Tests) schlägt uhrzeitabhängig fehl (Segment „vor 90 Minuten“ liegt am Vortag), unabhängig von dieser Änderung; vor Mitternacht war der Lauf vollständig grün.
