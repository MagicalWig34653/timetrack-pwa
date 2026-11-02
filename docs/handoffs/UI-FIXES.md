# UI-FIXES (02.11.2026, Branch ui-fixes)

Zwei Nutzermeldungen: Einstellungen/Verwaltung „springt“ beim Menüwechsel; Urlaub ist im Kalender kaum zu sehen.

## 1. Einstellungen und Verwaltung springen

Reproduktion: Mock-E2E mit gedrosselten API-Antworten (300–400 ms), Seite gescrollt, Menüwechsel in `/admin/*` und `/settings/*`, Messung der Menü-Position über die Zeit (`e2e-mock/layout-stability.spec.ts`). Die früheren Prüfungen (J1/J2) deckten nur `/settings/*` im ungescrollten Zustand ab; `/admin/*` (Einladungen, Konten, Module, APNs) war nicht erfasst.

Ursachen (alle drei gemessen):
1. **Menü sprang um 20 px.** `SettingsShell` klebte bei `top: 76px`, die natürliche Position liegt aber bei 96 px (60 px Kopfzeile + 36 px Seitenpolster). Beim Zurücksetzen der Scrollposition nach einem Seitenwechsel wanderte das Menü von 76 auf 96. Jetzt `top-24` (96 px), `max-h` entsprechend.
2. **Reaktion erst nach Server-Roundtrip.** Der Route-Guard `(app)/+layout.ts` las bei jeder Navigation `GET /auth/session` und wartete darauf; Klick und sichtbare Änderung lagen bei langsamer Leitung um die Antwortzeit auseinander, danach wechselte alles auf einmal (Inhalt, Scroll-Reset, Menü). Neu: `sessionStore.ensureFresh()` liest die Sitzung höchstens alle 20 s neu (ein widerrufenes Login fällt spätestens dann oder beim nächsten 401 auf).
3. **Dokumenthöhe wechselte stark** (Platzhalter „Lädt …“ ca. 150 px, Inhalt 500–1300 px), dadurch klemmte der Browser die Scrollposition. Die Inhaltsspalte hat jetzt eine Mindesthöhe (`100vh - 12rem`, nur breite Ansicht).

Kurze Verwaltungsseiten haben keinen Sticky-Weg; das Menü scrollt dort wie jeder Inhalt mit (kein Sprung).

Regression: `layout-stability.spec.ts` prüft jetzt auch alle `/admin/*`-Seiten (desktop, hoch, Handy) und neu „Menü bewegt sich beim Wechsel nicht, gescrollt, langsame API“ für Einstellungen und Verwaltung. Die anderen Einstellungsgruppen waren durch dieselbe Shell abgedeckt und zeigten nur Ursache 1 bis 3.

## 2. Urlaub im Kalender

Reproduktion in Mock-E2E (Monat, Jahr, Handy; geplant, beantragt, genehmigt, Halbtag; Schnellleiste, Tagesdetail-Formular, Dialog): **Die Daten und die Zuordnung sind korrekt**, der Eintrag erscheint nach dem Speichern in allen Ansichten; das Backend liefert `kind`, `status`, `startDate`, `endDate`, `halfDayStart/End` wie im Vertrag (Listenfilter `startDate <= to && endDate >= from`), keine Backend-Änderung nötig.
Gefunden wurde ein Darstellungsproblem: der Standard-Status „Geplant“ war kaum zu erkennen (Zelle 6 % Tönung, Pill 15 % mit schwacher Schraffur, Handy: nur Ring-Punkt ohne Zellfarbe), und ein in der Legende ausgeblendeter Eintrag („Urlaub“ abgewählt, im Browser gemerkt) ließ neue Einträge ohne Hinweis verschwinden.
Änderungen: kräftigere Zelltönung (geplant 12 %, genehmigt 20 %), Pill 25 % mit stärkerer Schraffur und umlaufender (nicht einseitiger) Kontur, Handy-Zelle auch bei geplantem Urlaub getönt, Filter-Schaltfläche zeigt „n ausgeblendet“.
Regression: `e2e-mock/vacation-visible.spec.ts`.
Offen: Falls die Meldung mit echten Daten ein anderes Bild hat (z. B. andere Ansicht, anderes Gerät), Screenshot nötig; eine rein datenbedingte Ursache ließ sich im Mock nicht nachstellen.
