# SCHULZEIT: nur ein Buchungsweg „Schultag buchen“ (26.11.2026)

Karte 218E0EBC, Grundlage [docs/ux/schulzeit.md](../ux/schulzeit.md) (Review F5BB8351 angenommen) und Linos Antworten:
(1) ohne Plan schlägt „Schultag buchen“ die Uhrzeiten vom letzten Schultag vor, vor dem Speichern änderbar (5896768E);
(2) „Schultag (Gutschrift)“ verschwindet aus der Auswahl, bestehende Tage bleiben gültig und zeigen „Uhrzeiten nachtragen“ (0D554339).
Nur PWA; keine Vertrags-, API- oder Backend-Änderung (Markierung `school_credit` bleibt in API und Import gültig).

## Umsetzung
- `src/lib/time/school.ts`: reine Regeln (Plan → Zeiten, letzter Schultag, Markierungsauswahl, Bewertungstext, Wochenhinweis,
  Timer-Vorbelegung, Arbeit am Schul-Ort, Prüfliste). Unit-Tests `school.test.ts`.
- `SchoolDayBooking.svelte`: Knopf „Schultag buchen“ → kleines Formular Beginn/Ende → legt **immer** einen Abschnitt Art „Schule“
  am Schul-Ort an. Zeiten: Schulblöcke bzw. Planfenster des Tages, sonst letzter Schultag davor (beim Nachtragen eines Tages
  vor jedem Schultag der nächste spätere), sonst leer.
- Tagesdetail (`DayTimeSections`): Knopf neben „Eintrag manuell ergänzen“ (wenn ein Schul-Ort existiert und noch keine Schule
  gebucht ist); Bewertung „Schule erfasst 5:30 → voller Schultag, angerechnet 7:42“ bzw. „… kein voller Schultag, zählt 2:00“;
  Markierungsauswahl ohne „Schultag (Gutschrift)“ (nur an Tagen, die sie schon tragen); dort Hinweis mit „Uhrzeiten nachtragen“.
- Heute: bei Plan „Schule“ Zeile „Heute ist Schule geplant (…)“ mit „Schultag buchen“; Timer vorbelegt mit Art „Schule“ und
  Schul-Ort; Start mit Art „Arbeit“ an einem Ort der Art „Schule“ fragt nach („Als Schule starten“ / „Ja, Arbeit starten“).
- Woche: Karte vergangener/heutiger Tage mit Plan „Schule“ ohne Schulzeit zeigt „Schule geplant, nichts gebucht“; Banner mit
  Link „Schultage prüfen (n)“ für vergangene Tage der Woche.
- Abwesenheit „Freistellung“ auf einem als Schule geplanten Tag: Hinweis „Für Berufsschule bitte ‚Schultag buchen‘ verwenden“.
- Neue Seite `/time/school-check` (Kern, über `/time`): letzte 8 Wochen, vergangene Tage. Zeilen „Arbeit am Ort Berufsschule“
  → „In Schule ändern“ (Bestätigung, Korrektur mit Revision), „Schule geplant, nichts gebucht“ → „Schultag buchen“,
  „Schultag ohne Zeiten“ → „Uhrzeiten nachtragen“; „Alles so lassen“ blendet die aktuellen Zeilen aus (localStorage).
  Nichts passiert automatisch.

## Prüfung
- Rot zuerst: `school.test.ts` (Modul fehlte), `e2e-mock/school-booking.spec.ts` (Wochenhinweis fehlte), `nav.test.ts`
  (Brotkrumen „school-check“).
- `npm run check` 0/0, `npm test` 1448 grün, Mock-E2E `school-booking.spec.ts` 10 grün (6 Abläufe + Bilder hell/dunkel,
  Handy 390×844 und Desktop 1440×1000; Bilder mit `SCREENSHOT_DIR`).
- Gegen das echte Backend ungeprüft (nur Mock); die Schulregel rechnet das Backend unverändert.

## Offen
- Apple-Apps haben den alten Weg noch (Parität, eigene Karte).
- „Alles so lassen“ gilt je Browser (localStorage), nicht kontoweit.
