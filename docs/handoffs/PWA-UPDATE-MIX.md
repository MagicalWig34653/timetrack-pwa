# PWA-UPDATE-MIX (14.11.2026): „Die Anwendung konnte nicht geladen werden. Es läuft gerade ein Update.“

## Fehlerbild
Lino, 14.11.: Die PWA lädt auch über 30 Minuten nach einem Update nicht und zeigt die Fallback-Meldung des Bootstraps aus
`src/app.html`. Browser-Cache leeren hilft.

## Untersuchung
- Die Meldung erscheint nur, wenn das Laden zweimal innerhalb von 5 Minuten scheitert. Dazwischen hat der Bootstrap alle
  Service Worker abgemeldet, alle Caches geleert und neu geladen. Ein alter Service Worker oder ein alter Cache kann
  den zweiten Fehlschlag nicht verursachen.
- A→B ohne Cache-Leeren nachgestellt (Build `ac529d8` → `8fcc4a8`, dazu die echten GHCR-Images
  `sha-8908fda-ac529d8` → `:main`). Geprüft in Chromium und WebKit, angemeldet, mit zwei Tabs, Update-Banner, echter
  CSP und zu langem `Cache-Control` für HTML. In allen Fällen **kein Fehler**. Die Backend-Header stimmen: `index.html`
  `no-cache`, ETag ändert sich je Image, fehlende Assets 404 `no-store`. Keine gehashte Datei hat zwischen den
  Builds denselben Namen mit anderem Inhalt.
- **Nachgestellt nur im Mischbetrieb:** Ein Proxy verteilt die Anfragen abwechselnd auf ein altes und ein neues Backend.
  Danach erschien die Meldung bei 4 von 6 Aufrufen. Dokument und Assets kommen dann aus verschiedenen Builds, die
  Recovery hilft nicht, weil auch nach dem Neuladen wieder gemischt ausgeliefert wird.
- Wahrscheinliche Ursache im Betrieb: `deploy/swarm/update.sh` (Backend) aktualisiert nur `timetrack_backend`, **nicht**
  `timetrack_backend-pinned`. Mit `PINNED_NODE`/`PINNED_REPLICAS` bleibt der gepinnte Dienst nach jedem `update.sh` auf
  dem alten Image. Erreicht ihn der Proxy, ist der Mischbetrieb dauerhaft. Andere mögliche Quellen: zwei Stacks oder
  Container hinter demselben Upstream, Replikas mit `:latest` auf verschiedenen Ständen.
  **Am Server nicht geprüft** (kein Zugriff). Prüfbefehle für Lino stehen unten.

## Fix (PWA)
- `fetchUsableAsset` (`src/lib/pwa/core.ts`): Eine unbrauchbare Antwort für eine gehashte Datei (404, 5xx, HTML) wird
  bis zu 10-mal neu angefragt, mit kurzen Pausen bis 100 ms. Gehashte Namen sind inhaltsadressiert, die Antwort einer
  anderen Replika ist also richtig. Der Body verworfener Antworten wird abgebrochen, sonst blockieren sie die sechs
  HTTP/1.1-Verbindungen und die Installation hängt (im E2E belegt). Netzfehler (offline) werden nicht wiederholt.
- Der Service Worker nutzt das beim Precache (Installation) und bei `cacheFirst`.
- Bootstrap (`src/app.html`): Nach dem Aufräumen registriert die Recovery einen frischen Service Worker und wartet, bis
  er die Seite steuert (höchstens 10 s, bei gescheiterter Installation sofort weiter). Erst dann lädt sie neu, damit
  das Neuladen schon durch die Wiederholungen des Workers läuft. Die Fallback-Meldung bleibt für dauerhafte Fehler.
- Wirkung: Ein Mischbetrieb aus zwei Builds **mit** diesem Fix lädt (Round-Robin-Test: 6 von 6 Aufrufen). Alte Builds
  ohne Fix im Mix können das nicht leisten. Den eigentlichen Mischbetrieb muss der Betrieb beheben.

## Tests
- `e2e-pwa/mixed-versions.spec.ts`: Testhook `/__test/flaky {every: n}` in `scripts/serve-build.mjs` (jede n-te Anfrage
  unter `/_app/immutable/` → 404). Erster Besuch lädt (vor dem Fix rot: Fallback-Meldung). Installierte App mit altem
  Service Worker lädt nach neuer Version (`/__test/bump`) und mehr als 30 Minuten (`page.clock.fastForward`) ohne
  Cache-Leeren.
- `e2e-pwa/asset-recovery.spec.ts` angepasst: Nach der Recovery steuert der neue Worker die Seite. Der Dauerfehler-Test
  nutzt `context.route`, damit auch die Anfragen des Workers scheitern.
- Unit: `core.test.ts` (Wiederholen, Abbruch des Bodys, Obergrenze, kein Wiederholen offline), `sw.test.ts`
  (Installation mit 404 beim ersten Versuch), `recovery.test.ts` (Registrierung vor dem Neuladen).
- `npm run check` 0/0, `npm test` 1410 grün, `test:e2e:pwa` 14 grün. `test:e2e:mock`: 273 grün, 1 rot:
  `vacation-bookings.spec.ts` „timer start on today…“ ist an Wochenenden rot, auch auf unverändertem `origin/main`
  (heute Samstag). Eigene Karte.

## Für Lino (Betrieb, nicht ausgeführt)
```sh
docker service ls --filter name=timetrack                     # gibt es timetrack_backend-pinned mit Replikas > 0?
docker service inspect --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' timetrack_backend timetrack_backend-pinned
for i in $(seq 8); do curl -s https://<host>/login | grep -o 'entry/start\.[^"]*'; done   # mehr als ein Wert = Mischbetrieb
```
Sofortmaßnahme bei altem gepinnten Dienst: `docker service update --with-registry-auth --image "$TIMETRACK_IMAGE"
timetrack_backend-pinned`. Dauerhaft: Backend-Branch `fix/update-pinned-service` (update.sh zieht den gepinnten Dienst mit).
