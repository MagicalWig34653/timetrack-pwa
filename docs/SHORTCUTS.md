# Timetrack mit Kurzbefehlen automatisieren (iOS und macOS)

Stand: 14.10.2026. **Wichtig vorab:** Der Server-Teil (Endpunkt, Ergebnisse, Idempotenz, Vorbeifahrt-Schutz) ist in
`e2e/stage2-time.spec.ts` gegen das echte Backend geprüft. Die Kurzbefehle selbst (Aktionsnamen, Menüs, Verhalten der
persönlichen Automation auf iOS/macOS) sind **nicht auf einem echten Gerät erprobt**. Bezeichnungen der Aktionen können
je nach OS-Version und Sprache abweichen. Bitte beim ersten Einrichten mit einem Testort und dem Abschnitt
„Ohne Kurzbefehle testen“ prüfen.

## Grundidee

Ein Kurzbefehl meldet nur **Ereignisse** („ich bin am Ort X angekommen“). Ein Standortsignal ist nie dasselbe wie
gearbeitete Zeit. Was daraus wird, bestimmt der Ort in der App (Einstellungen / Orte):

| Automatik des Ortes | Bestätigter Aufenthalt führt zu |
| --- | --- |
| Direkt buchen (`direct`) | einem Eintrag, zurückdatiert auf die Ankunft |
| Vorschlag (`suggest`) | einem Vorschlag, den du unter „Vorschläge“ annimmst oder verwirfst |
| Aus (`off`) | nichts, das Ereignis wird nur festgehalten |

Du kannst die Automatik jederzeit pro Ort umstellen. Ein Kurzbefehl kann nichts anderes: Das Gerätetoken
darf nur Ereignisse melden (kein Lesen, kein Ändern).

## Was du brauchst

1. **Gerätetoken**: Einstellungen / Geräte, „Token erzeugen“ (pro Gerät eines). Das Token wird **nur einmal** angezeigt.
   Kopiere es sofort in den Kurzbefehl. Verloren? Token widerrufen und ein neues erzeugen.
2. **Orts-ID**: Einstellungen / Orte, unter dem Ort steht „Orts-ID für Kurzbefehle“ mit Kopier-Schaltfläche.
3. **Server-Adresse**: die Adresse, unter der du die App aufrufst, plus `/api/v1/automation/events`
   (zum Beispiel `https://zeit.example.org/api/v1/automation/events`).
4. **deviceId**: ein frei gewählter, stabiler Name pro Gerät, zum Beispiel `iphone-lino` (höchstens 80 Zeichen).
   Immer denselben Namen verwenden: Die Reihenfolge der Ereignisse wird je Gerät und Ort ausgewertet.

## Die Anfrage

`POST <Server>/api/v1/automation/events`

Kopfzeilen:

```
Authorization: Bearer <Gerätetoken>
Content-Type: application/json
```

Hinweis: Nur dieser Kopf, **kein** Cookie. Ein Bearer-Token wird auf allen anderen Endpunkten abgewiesen.

JSON-Rumpf:

```json
{
  "eventId": "6f1c2c1e-3a54-4c1c-9a3a-0c5d0f7b2a10",
  "deviceId": "iphone-lino",
  "placeId": "<Orts-ID>",
  "type": "arrival",
  "occurredAt": "2026-10-14T08:02:11+02:00"
}
```

| Feld | Bedeutung |
| --- | --- |
| `eventId` | **UUID**, pro Ereignis neu, bei Wiederholung desselben Ereignisses gleich (siehe „Wiederholung“). Keine UUID: Antwort 400. |
| `deviceId` | Name des Geräts, siehe oben. |
| `placeId` | Orts-ID aus der App. |
| `type` | `arrival` (Ankunft), `presence_confirmed` (Aufenthalt bestätigt), `departure` (Abfahrt), `cancel` (Abbruch). |
| `occurredAt` | ISO 8601, **wann das Ereignis eintrat** (nicht wann es gesendet wird). Mit Offset (`+02:00`) oder `Z` beides geprüft. |
| `latitude`, `longitude` | optional, werden nicht benötigt. |

Antwort bei Erfolg (HTTP 200): `{"result": "...", "segmentId": ..., "suggestionId": ...}`. Die Werte stehen unten.

## Einrichtung als Kurzbefehl (Ankunft)

Vorgehen in der Kurzbefehle-App (Namen der Aktionen sinngemäß, deutsche iOS-Oberfläche):

1. Neuen Kurzbefehl anlegen, Name zum Beispiel „Timetrack Ankunft Büro“.
2. Aktion **Text** mit der Orts-ID. Als Variable `placeId` benennen.
3. Aktion **Aktuelles Datum**, danach **Datum formatieren** mit Format „ISO 8601“ (bei Bedarf „Eigenes Format“
   `yyyy-MM-dd'T'HH:mm:ssXXX`). Ergebnis als Variable `occurredAt` benennen.
4. **eventId erzeugen.** Kurzbefehle hat nach meinem Kenntnisstand keine fertige UUID-Aktion.
   - macOS: Aktion **Shell-Skript ausführen** mit `uuidgen`. Ergebnis als `eventId`.
   - iOS: Der Server verlangt das UUID-Format (8-4-4-4-12 Hexziffern). Ein tragfähiger Notbehelf ist, aus Datum,
     Uhrzeit und Zufallszahlen eine Ziffernfolge in diesem Muster zu bauen (Ziffern sind gültige Hexziffern):
     `JJJJMMTT-HHmm-4ssZ-8ZZZ-ZZZZZZZZZZZZ`, wobei `ss` die Sekunden und `Z` Ziffern aus der Aktion
     **Zufallszahl** sind. Das ergibt eine eindeutige Kennung, aber keine „echte“ UUID v4. Ob das Muster auf
     deinem Gerät sauber klappt, musst du ausprobieren.
5. Aktion **Inhalte von URL abrufen**:
   - URL: `https://<Server>/api/v1/automation/events`
   - Methode: **POST**
   - Kopfzeilen: `Authorization` = `Bearer <Gerätetoken>`, `Content-Type` = `application/json`
   - Anfragetext: **JSON** mit den Feldern `eventId`, `deviceId`, `placeId`, `type` (hier `arrival`), `occurredAt`
     (Variablen aus den Schritten davor einsetzen).
6. Optional: **Ergebnis anzeigen** oder **Mitteilung anzeigen** mit dem Wert `result` aus der Antwort
   (Aktion **Wert für Schlüssel abrufen**), damit du die Rückmeldung siehst.

### Die drei Kurzbefehle

| Kurzbefehl | `type` | wann |
| --- | --- | --- |
| Ankunft | `arrival` | sofort beim Eintreffen am Ort |
| Aufenthalt bestätigt | `presence_confirmed` | nach der Wartezeit (siehe Vorbeifahrt-Schutz) |
| Abfahrt | `departure` | beim Verlassen des Ortes |

Optional ein vierter, `cancel`, wenn du manuell „Das war nichts“ melden willst.

### Persönliche Automation

Kurzbefehle-App, Reiter „Automation“, „Neue Automation“ (persönlich):

- **Ankunft:** Auslöser „Ankunft“ am Ort (Karte/Adresse), Zeit „jederzeit“ oder dein Arbeitszeitfenster,
  Aktion: Kurzbefehl „Timetrack Ankunft“ ausführen. „Vor Ausführung fragen“ ausschalten, sonst startet nichts von selbst.
- **Aufenthalt bestätigt:** Ein zweiter Kurzbefehl, der nach `confirmAfterSeconds` (Standard 5 Minuten) prüft, ob du
  noch am Ort bist. Zwei Wege (beide ungeprüft): im Ankunfts-Kurzbefehl nach der Ankunftsmeldung **Warten**
  (`confirmAfterSeconds`) und danach **Aktueller Standort** mit Entfernungsprüfung zum Ort, dann
  `presence_confirmed` senden; oder die Ankunfts-Automation so einrichten, dass sie nur den Ankunfts-Teil macht,
  und die Bestätigung über eine zweite Automation zu einer festen Uhrzeit anstoßen.
  Wichtig ist nur: **`presence_confirmed` wird nur gesendet, wenn du nach der Wartezeit noch am Ort bist.**
- **Abfahrt:** Auslöser „Verlassen“ am Ort, Aktion: Kurzbefehl „Timetrack Abfahrt“.

Auf iOS laufen Ortsautomationen nur, wenn Ortungsdienste und Hintergrundaktualisierung erlaubt sind; die Zuverlässigkeit
der Auslöser liegt bei iOS, nicht bei Timetrack.

## Wiederholung und Idempotenz

- Jedes Ereignis hat eine eigene `eventId`. Der Server merkt sich sie. Sendest du **dieselbe** `eventId` noch einmal
  (zum Beispiel weil die Antwort verloren ging), bekommst du **das erste Ergebnis unverändert** zurück und es wird
  nichts doppelt gebucht (geprüft).
- Ein **neues** Ereignis braucht eine **neue** `eventId`. Wer für jede Anfrage dieselbe feste ID benutzt, bekommt immer
  das Ergebnis des allerersten Ereignisses.
- Schlägt die Anfrage mit Netzfehler fehl (kein Empfang), stoppt der Kurzbefehl. Eine automatische Wiederholung gibt es
  in Kurzbefehlen nicht von Haus aus. Möglichkeit (ungeprüft): `eventId` und `occurredAt` vor dem Senden in eine Datei
  speichern und nach Erfolg löschen; ein „Nachsenden“-Kurzbefehl sendet liegen gebliebene Dateien mit derselben
  `eventId`. Da `occurredAt` mitgeschickt wird, kann ein Ereignis auch **später** gemeldet werden; die Buchung wird
  auf den Eintrittszeitpunkt gelegt. Voraussetzung: Die Ereignisse eines Geräts und Ortes kommen in zeitlicher Reihenfolge an.

## Vorbeifahrt-Schutz

Fährst du nur an einem Ort vorbei, entsteht keine Buchung:

1. `arrival` wird nur **festgehalten** (`recorded`). Es entsteht keine Zeit.
2. Erst `presence_confirmed`, das **mindestens `confirmAfterSeconds`** nach der Ankunft eintrat
   (pro Ort einstellbar, Standard 300 Sekunden = 5 Minuten), bucht beziehungsweise schlägt vor.
3. Ein zu früh gesendetes `presence_confirmed` bucht nichts (`ignored`); ein späteres gültiges zählt noch.
4. `departure` ohne bestätigten Aufenthalt bucht nichts (`ignored`), ebenso `cancel`.

Eine fehlende Abfahrt beweist nichts: Bleibt ein automatischer Eintrag offen, wird er nicht von selbst beendet.
Stattdessen erscheint später ein Vorschlag „Ende“ (ohne erfundenes Ende), den du mit der richtigen Zeit annimmst.

## Was die Ergebnisse bedeuten

| `result` | Bedeutung | Beobachtet, wenn … |
| --- | --- | --- |
| `recorded` | nur festgehalten, nichts gebucht | `arrival` an jedem Ort; jedes Ereignis an einem Ort mit Automatik „Aus“ |
| `booked` | Eintrag gebucht (`segmentId`) | `presence_confirmed` an „Direkt“-Ort; `departure`, die einen gebuchten Eintrag beendet |
| `suggested` | Vorschlag angelegt (`suggestionId`) | `presence_confirmed` an „Vorschlag“-Ort; unter „Vorschläge“ entscheiden |
| `ignored` | bewusst nichts getan | zu frühes `presence_confirmed`, `departure`/`cancel` ohne bestätigten Aufenthalt, doppelte Bestätigung |
| `needs_review` | unklar, bitte in der App prüfen, nichts Neues gebucht | Ereignis älter als ein schon bekanntes (Reihenfolge), neue Ankunft bei noch offenem automatischem Eintrag, Überschneidung mit vorhandenen Zeiten |
| `duplicate` | im Vertrag vorgesehen | in der Praxis liefert ein Duplikat das **erste Ergebnis** (siehe oben), `duplicate` selbst wurde nicht beobachtet |

Fehlercodes (HTTP): 401 Token fehlt, ungültig, widerrufen oder abgelaufen; 400 ungültiger Rumpf (zum Beispiel
`eventId` keine UUID, unbekannter `type`); 429 mehr als 120 Anfragen je Token in 5 Minuten. Fremde oder unbekannte
Orts-IDs sind nicht gebucht; der genaue Statuscode dafür wurde hier nicht geprüft.

## Ohne Kurzbefehle testen

Auf dem Mac im Terminal (ersetzt `<…>`; die Orts-ID muss zu deinem Konto gehören):

```sh
curl -sS -X POST "https://<Server>/api/v1/automation/events" \
  -H "Authorization: Bearer <Gerätetoken>" \
  -H "Content-Type: application/json" \
  -d "{\"eventId\":\"$(uuidgen)\",\"deviceId\":\"mac-test\",\"placeId\":\"<Orts-ID>\",\"type\":\"arrival\",\"occurredAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
```

Erwartet: `{"result":"recorded"}`. Danach ein `presence_confirmed` mit **neuer** `eventId` und einem
`occurredAt` mindestens 5 Minuten nach der Ankunft: je nach Ort `booked` oder `suggested`.
Teste zuerst an einem Ort mit Automatik „Vorschlag“, dort kann nichts Falsches gebucht werden.

## Grenzen und offene Punkte

- Nicht auf einem echten iPhone, iPad oder Mac erprobt; Aktionsnamen und Verhalten der Automationen können abweichen.
- Der UUID-Notbehelf für iOS (Datum plus Zufallszahlen) ist ein Vorschlag, keine geprüfte Anleitung.
- Kein automatisches Nachsenden bei Netzfehlern; ein Nachsende-Kurzbefehl ist nur skizziert.
- Ereignisse werden pro `deviceId` und Ort nach `occurredAt` geordnet. Ein später eintreffendes, älteres Ereignis
  wird `needs_review`.
- Ein offener automatischer Eintrag überschneidet sich mit allen späteren Zeiten; vergessene Abfahrten also
  zeitnah beenden (Vorschlag „Ende“ annehmen oder Eintrag korrigieren).
- Kein Hintergrunddienst im Backend: Die Markierung fehlender Abfahrten geschieht beim Öffnen der Vorschläge
  oder beim nächsten Signal, nicht zu einer festen Uhrzeit.
- Standortkoordinaten (`latitude`, `longitude`) werden vom Server nicht zur Prüfung des Ortes verwendet.
  Ob ein Signal wirklich am Ort entstand, entscheidet allein die Auslösung auf dem Gerät.
