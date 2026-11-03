# Handoff PLAN-OFFDAY-pwa: Planblöcke an Urlaubs-, Krank-, Freistellungs- und Feiertagen

Branch `plan-offday`, Backend-ADR-0035 (Vorschlag, Wertung keine bestätigte Nutzerentscheidung), Vertrag 0.42.0, Backend-Handoff `docs/handoffs/PLAN-OFFDAY.md`.

## Geändert

- `grid-edit.ts`: nur noch Tage außerhalb der Woche weisen eine Änderung ab (Malen, Verschieben, Kopieren, Einfügen, Dialog, Löschen); `firstFreeIndex` entfernt.
- `WeekGrid.svelte`: Spalte nicht mehr gesperrt (kein `not-allowed`, Plus-Schaltfläche aktiv), Blöcke und Zeitraster-Bereich werden auch an markierten Tagen gezeigt, Tagesplan nicht mehr auf 0 gezwungen, Geisterblock nicht mehr „nicht möglich“. Die Markierung (Chip, Schraffur) bleibt als reine Anzeige.
- `PlanRow.svelte` (Listenansicht): Felder aktiv, Plan zählt; Zeile unter dem Tag nennt die Markierung und, wenn geplant, „Plan an einem Urlaubstag zählt als geplante Mehrzeit.“ (analog Krankheits-, Freistellungs-, Feiertag). `PlannerBoard.svelte`: derselbe Hinweis ruhig unter dem Planer; Hinweise und Auswahl auch für markierte Tage; `BlockDialog` Tagauswahl ohne Sperre.
- `plan-draft.ts`: `weekTotals` summiert alle Tage; `clearWeek` leert auch markierte Tage; `copyWeek` (letzte Woche kopieren) kopiert auch dorthin. `limits.ts`: Rechtshinweise (Tages-/Wochenmaximum, Ruhezeit) gelten auch für Plan an markierten Tagen.
- `follow.ts` / `CopyDaysDialog`: ursprünglich kein Überspringen markierter Tage mehr (Folgewochen-Kopie inzwischen korrigiert, siehe [FOLLOW-WEEK](FOLLOW-WEEK.md)); die Voreinstellung „Arbeitstage“ wählt weiter nur Tage mit Soll.
- Absichtlich unverändert: „Standardwoche“ und „Gleich für alle Arbeitstage“ planen nur Arbeitstage mit Soll (markierte Tage haben Soll 0 und bleiben, wie sie sind), damit keine Mehrzeit unbemerkt entsteht.
- Mock: `apiVersion` 0.42.0, `plannedSeconds` an markierten Tagen = Plandauer (Plan- und Zeitwoche), `planActualDifferenceSeconds` dort gesetzt (nicht für künftige Tage). Typkommentare in `types.ts`. Texte in `de-week.ts`, `de-weekgrid.ts` (`wg.say_blocked` nennt nur noch „außerhalb der Woche“).
- Nicht betroffen (kein `blockedBy`): Wochenübersicht (nutzt Server-`plannedSeconds`, Plan/Ist-Differenz wurde nie ausgeblendet), Planfreigabe-Anzeige, Kalender (`pd.blocked` betrifft Abwesenheitsüberschneidungen).

## Tests

Unit angepasst (grid-edit, plan-draft, follow, limits, Mock), neue Mock-E2E `e2e-mock/plan-offday.spec.ts` (Malen, Verschieben, Alt-Kopieren, Halbtag, Summen, Hinweis, Speichern/Neuladen, Listenansicht), `week.spec.ts`, `version.spec.ts` und `e2e/stage3-planning.spec.ts` (gegen echtes Backend 0.42.0, nicht ausgeführt) angepasst. `npm run check` 0/0, `npm test` 1368 grün, Mock-E2E voll grün.

## Offen

Folgewochen-Kopie überspringt nach Nutzerentscheidung 02.11.2026 wieder markierte Zieltage, auch bei Überschreiben; umgesetzt in [FOLLOW-WEEK](FOLLOW-WEEK.md). Backend-Entscheidungen aus ADR-0035 (Wertung, Urlaubsvorschlag) stehen noch aus.
