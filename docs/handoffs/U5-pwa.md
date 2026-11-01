# U5-pwa: Kalendermarkierung bei Urlaub/Abwesenheit

Meldung: "Im PWA Kalender sieht man die Markierung nicht mehr, wenn an dem Tag z.B. Urlaub ist."

## Ursache

Im Monatsraster (`CalendarBoard.svelte`) wird die Zahl der Pills je Zelle aus der Zeilenhöhe gemessen (`maxPills`, mindestens 1).
Bei nur einem freien Slot (z. B. 1280x640, Seitenpanel, niedrige Zeilen) hat `monthPills` den Slot für "+n" verwendet und
keine Pill gezeigt. Bei einem Tag mit Urlaub und zweitem Eintrag (Feiertag, Plan) blieb deshalb nur "+2" sichtbar, die
Urlaubsmarkierung war weg (nur der schwache Tint). Seit U1 (keine Mini-Zeitleisten) ist die Pill der einzige kräftige Marker.

## Änderung

- `month-pills.ts`: bei genau einem Slot bleibt die erste Pill (Abwesenheiten stehen vor Feiertagen und Plan) sichtbar,
  "+n" rückt als `moreInCorner` neben die Tageszahl. `visibleText` hängt "+n" an den zugänglichen Namen an (axe `label-content-name-mismatch`).
- `CalendarBoard.svelte`: Eckanzeige für "+n".
- `YearOverview.svelte`: Freigestellt/Sonstiges wurden im Jahresraster nicht markiert (jetzt violett); geplanter/beantragter
  Urlaub zusätzlich mit sky-Hintergrund statt nur dünnem Ring.

## Geprüft

Alle Arten/Status (Urlaub planned/requested/approved/taken, krank/freigestellt/sonstiges recorded, Feiertag, Betriebstage)
im Monatsraster (1280x640 hell/dunkel, 1440x900), Handy-Monat (Punkte) und Jahresansicht.

## Tests

- `src/lib/planning/month-pills.test.ts`: Ein-Slot-Fall, `visibleText` mit "+n".
- `e2e-mock/u5-marker.spec.ts`: Marker mit Größe > 0 je Art/Status in drei Viewports/Modi inkl. axe, Handy-Punkte, Jahresfarben.
