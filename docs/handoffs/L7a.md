# Übergabe L7a – Angleichung an Vertrag v0.3.1

Branch `l7a-contract-0-3-1` (nicht gepusht). Backend und Vertrag nur gelesen (v0.3.1, ADR-0005). Code englisch, UI deutsch (`src/lib/i18n/de-planning.ts`).

## Geändert

| Thema | Umsetzung |
| --- | --- |
| Einstellungen | `GET vacation/settings` liefert immer 200; `configured:false` zeigt „noch nicht gespeichert“ und die Vorschlagswerte (nie still gespeichert). Keine 404-Behandlung mehr. |
| Übertrag | `carryOverByYear`; Formularfeld „Übertrag für {Jahr}“ ändert nur das gewählte Jahr, andere Jahre bleiben im PUT erhalten. Formular wird je Jahr neu aufgebaut. |
| Saldo | `snapshotRemainingHalfDays` wird direkt angezeigt (keine Ableitung mehr). |
| Einträge | `GET vacation/entries?year`, `DELETE vacation/entries/{id}`; `VacationEntryList` auf `/vacation`, Löschen zweistufig (Löschen -> Jetzt löschen / Abbrechen). |
| Abwesenheiten | `GET absences/{id}` nach 412: `AbsenceForm` holt die aktuelle Fassung und übergibt sie an `onstale(fresh)`; `/absences` ersetzt nur diesen Eintrag und öffnet das Formular auf der neuen Version, `DayPanel` öffnet auf der neuen Version (Kalender lädt im Hintergrund). Nicht-Urlaub zeigt „Verbraucht keinen Urlaub“ (`countedHalfDays` ist 0). |
| Freigaben | `share_exists` (409) und Eigenfreigabe mit deutschem Text; Eigenfreigabe wird zusätzlich vorab gegen das eigene Kürzel geprüft, ein 400 beim Anlegen zeigt „Freigabe abgelehnt …“. Texte zu Umfang `vacation` (nur genehmigt/genommen) und `actual` (nur Tage mit Arbeitszeit) angepasst. |
| Zeiträume | `api.listAbsences/listPlanDays/viewShared` teilen in 366-Tage-Blöcke, `api.listDays` in 93-Tage-Blöcke (`splitRange`, `mergeSharedViews`); `range_too_large` hat eine allgemeine deutsche Meldung. |

## Mock

- `time/days` und Zeitkonto berücksichtigen Abwesenheiten (`mock/planning.ts: dayContext`, eingehängt über `time.setDayContext`): Feiertag an Arbeitstag -> Markierung `holiday`; approved/taken `vacation`/`sick` -> Markierung, Soll 0; halber Urlaubstag (`halfDayStart` erster, `halfDayEnd` letzter Tag, Eintagesabwesenheit mit Flag) -> Soll halbiert; `planned/requested/rejected/cancelled` und `kind=other` ohne Wirkung; expliziter Tagesmarker gewinnt (auch gegen halbiertes Soll); optional `targetOverrideSeconds` im PUT gespeichert.
- Weitere Regeln v0.3.1 im Mock: Settings-GET mit Standardwerten, Übertrag je Jahr, Einträge mit IDs, `GET absences/{id}`, `countedHalfDays` nur Urlaub und nicht bei abgelehnt/storniert, Zeitraumgrenze 366 Tage (`range_too_large`), `time/days` 93 Tage.
- Tagesansicht (`DaySummary`): neutraler Hinweis „Soll 0: Der Tag ist als „Urlaub“ gewertet.“ bzw. „Soll halbiert: halber Urlaubstag.“

## Tests (Zahlen)

`npm test` 184 (vorher 158): Mock-Regeln v0.3.1, Zeitraum-Helfer, Seiten (configured, Übertrag je Jahr, Einträge löschen, 412 -> GET, Freigabefehler, nur approved/taken in der Ansicht), `DaySummary`. `test:e2e:mock` 15 (+2: Tagesansicht mit Urlaub, Einträge löschen). `test:e2e` (echtes Backend) 29 unverändert, die Planungsseiten haben dort noch keine Gegenstelle (C9).

## Annahmen und offene Fragen

1. Feiertag und genehmigter Urlaub am selben Tag: Mock setzt `holiday` (Urlaub wird dort ohnehin nicht verbraucht). ADR nennt keine Rangfolge.
2. `sick` wirkt im Mock nur mit Status approved/taken (ADR: „planned/requested/other ändern die Bewertung nicht“); unklar, ob `sick` mit anderem Status auch wirkt.
3. Fehlercode für Freigabe an sich selbst ist im Vertrag nur „400“; die UI behandelt jeden 400 beim Anlegen so (Mock: `bad_request`).
4. `targetOverrideSeconds` steht nicht im Vertrag (weder `DayPreferences` noch `DayEvaluation`); der PWA-Typ führt es aus v0.3.0. Die Auswertung zeigt das halbierte Soll nur über `targetSeconds` und `mark`. Eine abgeleitete Markierung ist von einer ausdrücklich gesetzten nicht zu unterscheiden (das Tagesformular zeigt sie vorbelegt).
5. Übertragsverfall: weiterhin nur Hinweistext aus `carryOverExpiry`, kein Vorschaufeld im Vertrag.
6. Zusammengeführte Urlaubszeiträume bei Blockgrenzen (>366 Tage) werden nur bei Überlappung verbunden; liefert der Server geschnittene Zeiträume, bleiben sie getrennt.
