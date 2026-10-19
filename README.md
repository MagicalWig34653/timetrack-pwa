# timetrack-pwa

Progressive Web App von **Timetrack**, einer selbst gehosteten Arbeitszeiterfassung (AGPL-3.0-only). Die PWA ist die Weboberfläche zum Timetrack-Backend: Zeiterfassung, Urlaub und Planung, Berichtsheft, Export/Import, Verbindungen (MCP), Konten- und Datenschutzfunktionen. Die Oberfläche ist ausschließlich deutsch; Code, Kommentare und Tests sind englisch.

> **Status: Alpha.** Funktional für die Etappen 1–4; nicht auf Echtgeräten erprobt (Plattform-Passkey, Push-Zustellung, Installation, Screenreader). Geprüfter Stand und Grenzen: [docs/STATUS.md](docs/STATUS.md).

## Technik

SvelteKit 3 als SPA (`adapter-static`, kein SSR), Svelte 5, TypeScript, Tailwind 4, shadcn-svelte-Komponenten, Service Worker mit Manifest. Tests mit Vitest und Playwright. Node ist nur für Entwicklung und Build nötig; produktiv liefert das Backend den statischen Build aus (`PWA_STATIC_DIR`).

## Verhältnis zu den anderen Repositories

| Repository | Rolle |
| --- | --- |
| [timetrack-backend](https://github.com/MagicalWig34653/timetrack-backend) | Hauptrepo: Backend, API-Vertrag (`contracts/openapi.yaml`), Deployment, Konzept, Architektur, ADRs, Arbeitsplan |
| timetrack-pwa (dieses) | Weboberfläche |
| [timetrack-apple](https://github.com/MagicalWig34653/timetrack-apple) | Native Apps für macOS, iOS/iPadOS und watchOS |

Der API-Client (`src/lib/api/client.ts`) ist von Hand nach dem Vertrag im Backend-Repo getippt (aktuell v0.14.0). Die Repos liegen nebeneinander (`<workspace>/timetrack-backend`, `<workspace>/timetrack-pwa`); die Echt-E2E-Tests bauen und starten das Backend aus `../timetrack-backend`.

## Lokal starten

```sh
npm ci
npm run dev        # Dev-Server, /api wird an 127.0.0.1:18080 weitergeleitet (laufendes Backend)
npm run dev:mock   # Dev-Server mit eingebauter Mock-API (kein Backend nötig)
npm run check      # svelte-check + Typprüfung des Service Workers
npm test           # Vitest (Komponenten, Mock, Hilfsfunktionen)
npm run build      # statisches Build nach build/ (wird vom Backend ausgeliefert)
```

End-to-End-Tests:

```sh
npm run test:e2e:mock   # Playwright gegen den Mock-Modus
npm run test:e2e:pwa    # Produktionsbuild: Manifest, Service Worker, Offline, Push
npm run test:e2e        # gegen ein echtes Wegwerf-Backend (Swift-Toolchain nötig, baut ../timetrack-backend)
```

Zuletzt gemessen (17.10.2026, Stand P2): 587 Unit-Tests, 84 Mock-E2E, 6 PWA-Build-Specs, 180 Echt-E2E. Testsuiten, Umgebungsvariablen, Mock-Modus und bekannte Grenzen: [docs/STATUS.md](docs/STATUS.md). Shortcuts-Anleitung für Apple-Geräte: [docs/SHORTCUTS.md](docs/SHORTCUTS.md).

## Mitarbeit und Sicherheit

Bitte vor größeren Änderungen ein Issue anlegen (nur synthetische Daten, keine echten Arbeitszeiten oder Zugangsdaten). Neue Seiten müssen in `src/lib/modules/map.ts` einem Kern- oder Modulbereich zugeordnet werden; Nutzertexte nur über `src/lib/i18n`. Sicherheitslücken nicht öffentlich melden, sondern über die private Meldung von GitHub (siehe `.github/SECURITY.md`).

## Lizenz

[GNU AGPL-3.0-only](LICENSE). Die übernommenen shadcn-svelte-Komponenten behalten ihre MIT-Lizenz, siehe [SHADCN-LICENSE.md](SHADCN-LICENSE.md). Abhängigkeitsinventar: Backend-Repo `docs/LIZENZEN.md`. Laufzeit-Abhängigkeiten im ausgelieferten Bundle: `pdf-lib` (MIT, seit Jahren nicht mehr gepflegt; Ersatz `@cantoo/pdf-lib`) und `pdfjs-dist` (Apache-2.0) für den Urlaubsantrag.
