# N3-pwa – Urlaub in der Wochenübersicht

Stand: 26.10.2026, Branch `n3-week-vacation` (Basis main 1fadfe7).

## Änderungen
- `src/lib/week/vacation.ts`: Urlaub (nur Status planned, requested, approved; abgelehnt/storniert/genommen nicht) je Tag aus `listAbsences` der sichtbaren Woche. Halbtage: Start-/Endflag, bei Einzeltag eines von beiden. Freie Tage (Mark `off`/`holiday`) bekommen keinen Eintrag.
- `/week` (`+page.svelte`) lädt die Abwesenheiten der Woche (nur bei aktivem Planungsmodul); schlägt das fehl, bleibt das alte Verhalten (Abwesenheiten aus `getTimeWeek`).
- `DayCard`: Urlaub nur als Icon (Palme, bei Halbtag mit ½); genehmigt einfarbig, geplant/beantragt schraffiert und gestrichelt wie im Planer; Karte leicht schraffiert. Volltext ("Urlaub – geplant, noch nicht beantragt", "Urlaub (halber Tag) – beantragt, noch nicht genehmigt", "Urlaub – genehmigt") als Tooltip bei Hover und Tastaturfokus der Karte sowie im `aria-label` der Karte. Die Marke "Urlaub" und der alte Warn-Chip entfallen für denselben Urlaub (kein Doppel).
- Fehlerbehebung Screenshot KW 48: Der alte Warn-Chip (Art + ": " + Warnung) erschien auch an freien Tagen (Sa/So), weil `chipAbsences` offene Abwesenheiten immer zeigte. Jetzt keine Chips an Tagen mit Mark `off`/`holiday`; andere offene Abwesenheiten zeigen nur das Label, die Warnung steht im `title`.
- Tagesdetail (`DayPanel`): Urlaubseinträge haben den Link "Zur Urlaubsübersicht" (`/absences?year=`); Status steht ausgeschrieben.
- Wochenkennzahlen unverändert (Urlaub zählt nicht als gearbeitete Zeit; E2E prüft Ist 0:00).

## Tests
Unit `vacation.test.ts` (neu), `absences.test.ts` erweitert; Mock-E2E `e2e-mock/n3-vacation.spec.ts` (Chips, Tooltip Hover/Fokus, keine Chips an Wochenende/storniert, Link, axe Phone/Desktop hell/dunkel, Screenshots mit `SCREENSHOT_DIR`).

## Offen
axe auf `/week` ohne die Regel `label-content-name-mismatch` (bestand schon vor N3). Backend-Mark `vacation` für genehmigten Urlaub wird nicht mehr als Chip gezeigt, wenn die Abwesenheitsliste geladen ist.
