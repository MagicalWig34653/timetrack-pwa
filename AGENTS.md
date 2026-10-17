# Timetrack – Client-Repository

Das Backend ist Hauptrepo und kanonisches Projektgedächtnis: `../timetrack-backend`.
Vor Aufgaben dort AGENTS.md, docs/STATUS.md, docs/ARBEITSPLAN.md,
docs/ENTWICKLUNGSABLAUF.md und relevante Konzepte/ADRs lesen; zusätzlich hier docs/STATUS.md.
Falls das Hauptrepo fehlt, zunächst dessen Checkout bereitstellen; nicht aus Chat-Memory weiterarbeiten.
API-Verträge liegen im Backend unter contracts/. Keine unabhängigen globalen Konzeptkopien.
Claude koordiniert; Ziel war etwa 50 % Umsetzung durch Codex über das Claude-Codex-Plugin (tatsächlicher Anteil ca. 19,5 %, Details im Backend `docs/ARBEITSPLAN.md`; Codex schreibt nicht in diesem Repo).
Dateibesitz pro Agent klar trennen. Fragen ausschließlich im normalen Chat.
Ergebnisse/Prüfungen lokal und globale Auswirkungen im Backend dokumentieren.
Keine Secrets oder persönlichen Daten committen. Sessions müssen wegwerfbar bleiben.
Das Repo ist öffentlich: Commit-Autor ist die Pseudonym-Identität des Projekts (Git-Konfiguration nicht ändern); keine privaten E-Mail-Adressen, Pfade, Hostnamen, IP-Adressen oder Domains (Platzhalter `timetrack.example.org`). Name: Projekt Timetrack; „Chronolog“ ist nur der App-Store-Eintrag der Apps.

Code, Kommentare, Tests und technische Bezeichner auf Englisch; nutzerseitige Texte auf Deutsch.
Verbindliche Details stehen im Backend unter docs/ENTWICKLUNGSABLAUF.md,
Abschnitt „Sprache von Code und Oberfläche“. An alle beauftragten Agents weitergeben.

Arbeitsstand, Testbefehle und Routenübersicht dieses Repos: docs/STATUS.md. Übergaben je Paket: docs/handoffs/.
Neue Seiten/Routen müssen in `src/lib/modules/map.ts` einem Kern- oder Modulbereich zugeordnet werden (ADR-0012);
ein Test schlägt sonst fehl. Nutzertexte nur über `src/lib/i18n`, nie direkt in Komponenten.
