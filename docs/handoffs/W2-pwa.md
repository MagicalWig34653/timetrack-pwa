# Handoff W2-PWA: Timer fortführen

Stand: 23.10.2026. Branch `w2-continue-timer` (auf main 7c71beb), nicht gepusht, nicht gemergt. Gegenstück: Backend `docs/handoffs/W2-reopen.md`, Vertrag **v0.27.0** (kein neuer Endpunkt).

## Umsetzung
- Logik in `src/lib/time/continue.ts`: `continuableSegment` (letzter nicht stornierter Eintrag, nur wenn beendet), `gapSeconds`, `continueSegment` (PATCH `endedAt: null`, Grund „Timer fortgesetzt“, `If-Match` = Version, Wiederholung nur bei Netzwerkfehler), `restartLike` (neuer Timer mit Art/Ort, Notiz best effort), `isReopenUnsupported`, Fehlertexte.
- `TimerCard.svelte` (neue Prop `last`): Panel unter dem Startknopf, nur ohne laufenden Timer. Lücke bis 15 Minuten: ein Knopf plus Hinweis; darüber zwei Knöpfe mit Erklärung. Hinweis nach Erfolg (`continue-notice`), bei Rückfall der ehrliche Text.
- Dashboard (`routes/(app)/+page.svelte`) übergibt `continuableSegment(segments)`; `DayTimeSections.svelte`: Kontextmenü-Eintrag „Fortführen“ nur am letzten Eintrag des heutigen Tages. Tastaturkürzel oder Palette für Start/Stopp gibt es in der PWA nicht, daher nichts weiter anzubinden.
- Fehlerbehandlung: 409/412/404 zeigen deutschen Text und lesen den Timer neu (Dashboard lädt neu). Rückfall nur bei 4xx außer 0/401/403/404/408/409/412/429 und bei 200 mit unverändertem Ende; nie bei Netzwerk, 5xx, 429, 401.
- Offline: Die PWA hat für Zeitbuchungen keine Schreib-Warteschlange (Start/Stopp brauchen den Server, Netzwerkfehler werden angezeigt, drei Versuche mit derselben Anfrage). Fortführen verhält sich gleich; PATCH mit `If-Match` ließe sich ohnehin nicht blind nachspielen.
- Mock (`mock/time.ts`): `endedAt: null` auf beendetem Eintrag öffnet ihn wieder (Guards: storniert 409 `conflict`, anderer läuft 409 `timer_already_running`, späterer Eintrag 409 `segment_overlap`).

## Tests
- Vitest: `src/lib/time/continue.test.ts` (Auswahl, Lücke, Rückfall-Entscheidung, Mock-Durchläufe), `src/lib/components/time/timer-continue.test.ts` (Karte: kurze/lange Lücke, Rückfall, Netzwerk, Konflikt). Gesamt 962 Tests grün.
- Mock-E2E: `e2e-mock/continue-timer.spec.ts` (5 Specs), danach `time`, `transfer`, `vacation-planner`, `worktime` und die übrigen Specs grün.
- Grenze der Umgebung: `node_modules` (per `cp -Rc` aus main) enthält `pdf-lib`/`pdfjs-dist` nicht; deshalb schlagen `npm run check` (9 Fehler, nur `src/lib/vacation-form`), 2 Vitest-Dateien (`pdf.test.ts`, `mock/vacation-form.test.ts`) und `vacation-form.spec.ts` hier fehl, unabhängig von W2.
- Nicht geprüft: echtes Backend 0.27.0 (E2E gegen Swift-Backend), Firefox/WebKit.
- Screenshots (klein) liegen nur lokal; erzeugt mit `SCREENSHOT_DIR=<dir>` in `continue-timer.spec.ts`.
