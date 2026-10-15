# timetrack-pwa

Progressive Web App von Timetrack (Svelte 5 / SvelteKit 3, Tailwind 4, shadcn-svelte), AGPL-3.0-only.
Arbeitsmittelpunkt und kanonisches Projektgedächtnis: [../timetrack-backend](../timetrack-backend) (Konzept, ADRs, API-Verträge unter `contracts/`).
Die Oberfläche ist ausschließlich Deutsch (`src/lib/i18n`), Code und Tests sind Englisch.

## Lokal starten

```sh
npm ci
npm run dev        # Dev-Server, /api wird an 127.0.0.1:18080 weitergeleitet (laufendes Backend)
npm run dev:mock   # Dev-Server mit eingebauter Mock-API (kein Backend nötig)
npm run check      # svelte-check + Typprüfung des Service Workers
npm test           # vitest (Komponenten, Mock, Hilfsfunktionen)
npm run build      # statisches Build nach build/ (wird vom Backend ausgeliefert)
```

Testsuiten, Umgebungsvariablen, Mock-Modus und bekannte Grenzen: [docs/STATUS.md](docs/STATUS.md).

Die übernommenen shadcn-svelte-Komponenten behalten ihre MIT-Lizenz; siehe SHADCN-LICENSE.md.
