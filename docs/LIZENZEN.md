# PWA: Lizenzbeilage und Testwerkzeuge

`npm run build` erzeugt `static/THIRD-PARTY-NOTICES.txt` aus den installierten
Paketmetadaten und Lizenzdateien. Die Datei wird mit dem PWA-Build ausgeliefert
und ist im Hilfe-Dialog verlinkt. Der Generator umfasst die Laufzeitabhängigkeiten
(`pdf-lib`, `pdfjs-dist` und die transitiven Pakete) sowie die ausgelieferte
Inter-Schrift (OFL-1.1). `pdfjs-dist` 6.4.299 enthält im npm-Paket keine eigene
NOTICE-Datei; die Beilage übernimmt daher den Lizenzhinweis aus dem Kopf der
ausgelieferten `build/pdf.mjs`. PDF.js-Datenverzeichnisse werden nicht als
statische Dateien kopiert; der Build enthält nur die benötigten JavaScript-Chunks.

Die E2E-Barrierefreiheitsprüfung verwendet `@axe-core/playwright` **4.14.0**
und dessen Abhängigkeit `axe-core` **4.14.0**. Beide Pakete tragen laut
Paketmetadaten **MPL-2.0**. Dies ist eine dateibezogene Copyleft-Lizenz, keine
permissive Lizenz. Die Pakete sind reine Entwicklungsabhängigkeiten und werden
nicht in den PWA-Browser-Build eingebunden. Die im Auftrag gewünschte
permissive Lizenz ist mit dieser Paketversion nicht gegeben; vor einer
Freigabe dieser Lizenzwahl ist eine Entscheidung erforderlich.

Das übergreifende Abhängigkeitsinventar liegt im Backend unter
`docs/LIZENZEN.md`.
