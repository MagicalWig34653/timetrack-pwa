# C2-pwa: Monatskalender im Stil des Wochenplaners (27.10.2026, Branch c2-month-calendar)

## Was sich geändert hat
- `/calendar` (Monat): Zellen höher (8 rem), Mini-Zeitleiste je Tag (`MiniTimeline.svelte`): Planblöcke als Balken in den Planerfarben und -mustern (Schule gestreift, Fahrt gepunktet, Home Linien, Kunde Kreuzschraffur), darunter gestrichelter Balken für erfasste Zeit. Zeitfenster 06–22 Uhr.
- Zell-Viewmodel `src/lib/planning/cell-model.ts` (rein, getestet): Balken, Urlaub offen/genehmigt/halb, Krank, Feiertag voll/halb, Schulferien, Frei, Monatssumme (Ist/Soll/Saldo, Urlaub, Kranktage), Heat-Stufen, sichtbarer Zelltext.
- Urlaub geplant/beantragt schraffiert (wie Planerspalte), genehmigt mit Rand, Feiertag mit Kopfstreifen, freie Tage schraffiert.
- Monatskopf (`month-summary`) mit Ist/Soll/Saldo und Urlaubstagen (genehmigt · offen, Halbtage 0,5), Kranktage; folgt der globalen Zeitanzeige. Wochensaldo neben der KW folgt jetzt ebenfalls der Zeitanzeige (`durationText`).
- Schwebende Aktionsleiste (`selection-bar`) bei Auswahl: Urlaub, Krank, Arbeitsplan, Freistellen, Sonstiges, Auswahl aufheben (Phone oberhalb der Navigation).
- Jahresübersicht (`YearOverview.svelte`, Schalter „Jahr“): 12 Minimonate als Heatmap, Klick auf Monat wechselt.
- Datenladen je sichtbarem Monat mit Cache und Vorabladen der Nachbarmonate (Cache wird nach Schreibaktionen verworfen); Platzhalterhöhe für 6 Zeilen, damit der Monatswechsel nicht springt.
- A11y: Zellname beginnt mit dem sichtbaren Text (Tageszahl + Chips), danach volle Beschreibung (axe label-content-name-mismatch sauber); Phone-Wochenliste nutzt aria-describedby statt aria-label; Kontraste der gedimmten Tage behoben.
- Unverändert: Drag/Resize, Kontextmenü, Undo, Tastatur (Pfeile, Shift+Pfeile, Enter/Klick wählt, Alt+Pfeile), Legende, eigene Tage.

## Tests
- Unit `cell-model.test.ts` (12), Mock-E2E `e2e-mock/c2-month.spec.ts` (Bereichsauswahl -> Urlaub, Tastatur, Kontextmenü, Monatswechsel ohne Sprung, Jahresübersicht, Mini-Zeitleiste, axe hell/dunkel Desktop+Phone, Screenshots mit SCREENSHOT_DIR). `calendar-power.spec.ts` angepasst (Rand-Menü scrollt die höhere Zelle in Sicht).

## Offen / nicht geprüft
- Kein Test auf echtem Touch-Gerät (Long-Press-Menü, Tap-Bereichsmodus nur über bestehende Logik); keine Prüfung gegen echtes Backend.
- Tagespanel bleibt das bestehende Inspector-/Unterhalb-Panel (kein neues Drawer).
- Gleichzeitig belegter Port 5199: E2E mit `E2E_MOCK_PORT=5231` gelaufen.
