# Handoff V6-pwa: Urlaubsantrag, Resttage, „davon abgegolten“, PDF-Tausch

Branch `v6-vacation-form` (von main), nicht gemergt/gepusht. Backend unverändert.

## 1) Resttage zum Antrag
Ursache: N2 hatte nicht eingereichte Planung pauschal aus dem Rest herausgerechnet. Für Urlaub, der zeitlich VOR dem Antrag liegt, ist das falsch (die Tage sind vorher verbraucht).
Definition (`vacation-form/remaining.ts`, `request.ts`):
- Rest vor Antrag = Anspruch + Übertrag (bzw. Snapshot-Rest) + Korrekturen − Urlaub (genommen, genehmigt, beantragt, geplant) vor dem ersten Antragstag.
- Rest nach Antrag = Rest vor Antrag − Tage dieses Antrags.
- Rest am Jahresende inkl. aller Planungen = `availableAfterPlannedHalfDays` des Servers (abzüglich des Antrags, falls er noch keine Abwesenheit ist). Spätere Planung mindert nur diese Zahl.
- Tagesgenau: ein Block, der vor dem Antrag beginnt und hineinreicht, zählt nur mit den Tagen vor dem ersten Antragstag; der Teil nach dem letzten Antragstag ist „später“; Überschneidungen werden nicht doppelt gezählt (Hinweis im Dialog). Halbtage an den Rändern bleiben erhalten (zwei Halbtage am selben Tag zählen beidseitig). Jahresgrenze: nur das Jahr des Antragsbeginns (wie die Bilanz), Snapshot-Datum schneidet früheren Urlaub ab. Ganz im Fenster liegende Blöcke nutzen `countedHalfDays` des Servers, angeschnittene werden lokal gezählt.
- Fehlt die Abwesenheitsliste (Laden schlug fehl), gilt alles andere vorsichtshalber als „früher“; Dialog weist darauf hin.
- Dialog: Aufstellung mit Anspruch, Liste der abgezogenen Blöcke (Zeitraum + Status, „teilweise“), Summe, dieser Antrag, Rest zum Antrag, spätere Blöcke (nicht abgezogen), Rest am Jahresende.
- Nicht abgebildet: Verfall des Übertrags (Stichtag).

## 2) „Davon abgegolten“
Lesen des Formulars (nur lokal, nichts kopiert): linke Spalte Urlaubsanspruch / Zusatzurlaub / Übertrag Vorjahr, rechte Spalte „Urlaubsanspruch gesamt“ / „davon abgegolten“ / „verbleiben“, darunter Zeitraum, Arbeitstage, „Resttage“. Plausible Lesart: gesamt − abgegolten = verbleiben (vor dem Antrag); Resttage = verbleiben − Arbeitstage dieses Antrags.
Bisher: Quelle `paidOut` (negative Korrekturen, meist 0) und Namensvorschläge, die `…_abgegolten`/`…_zusatz`/`…_zusatz_vorjahr` fälschlich auf „Anspruch des Jahres“ legten; „verbleibend“ bekam Rest NACH dem Antrag.
Neu: Quelle `compensated` („Davon abgegolten“) = Urlaub vor dem Antrag, Option „Zählt als abgegolten“: `all` (Standard, damit gesamt − abgegolten = verbleiben stimmt) oder `decided` (nur genommen/genehmigt). Neue Quelle `restYearEnd`. `paidOut` bleibt, umbenannt „Ausbezahlt (negative Korrekturen)“. Vorschläge: abgegolten → compensated, „anspruch…verbleib“ → restBefore, Zusatz/Übertrag vor generischem „anspruch“.
Migration: Mapping hat `revision` (2). Ältere Mappings: `paidOut` auf Feldern mit „abgegolten“ → `compensated`, `restAfter` auf „anspruch…verbleib“ → `restBefore` (einmalig, danach bleibt die Wahl).
Annahme zu bestätigen: „abgegolten“ = bereits genommener/verplanter Urlaub dieses Jahres (nicht Auszahlung).

## 3) PDF tauschen
Backend (B7/ADR-0026): Datei-PUT behält das Mapping, Mapping liegt als opakes JSON beim Server und ist per PUT neu speicherbar. Kein Backend-Bedarf. Die PWA setzte es bisher selbst zurück; jetzt `vacation-form/replace.ts` (`carryMapping`): gleicher Feldname (exakt, sonst ohne Groß/Klein und Leerzeichen, nur eindeutig) und Quelle passt zum neuen Typ → übernommen; neue Felder → „fresh“ (Badge „Neu: bitte zuordnen“ in der Feldliste), fehlende → „removed“, Typ passt nicht → „changed“; Overlay-Positionen bleiben, wenn die Seite existiert. Person, Datumsformat, Flatten bleiben. Prüfkarte nach dem Tausch (Übernommen/Neu/Entfernt/Typ geändert) auf `/settings/vacation-form`. Datei-PUT und Mapping-PUT bleiben zwei Aufrufe (nicht atomar; optional atomarer Endpunkt im Backend).

## Tests
Unit: `remaining`-Fälle in `request.test.ts` (vor/nach/Überschneidung/Halbtage/Übertrag/Snapshot/Jahresgrenze/Status), `replace.test.ts`, `mapping.test.ts` (Migration, Vorschläge, Scope), `sources.test.ts`. Mock-E2E `e2e-mock/v6-vacation-form.spec.ts` (Tausch behält Zuordnung und markiert Neues, Dialog-Aufstellung, axe, Screenshots mit SCREENSHOT_DIR). Alle Testdaten synthetisch; die Arbeitgeber-PDF wurde nur lokal gelesen, nichts übernommen.
Zahlen: siehe Abschlussbericht (check 0 Fehler; Unit 1251 in 120 Dateien).

## Offen
Bedeutung „abgegolten“ vom Nutzer bestätigen lassen; Übertragsverfall; Jahreswechsel-Anträge nur für das Startjahr; bestehende Mappings außer den zwei migrierten Feldern unverändert.
