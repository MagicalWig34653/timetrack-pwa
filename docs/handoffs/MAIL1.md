# Handoff MAIL1: E-Mail-Prüfung (PWA)

Branch `mail1-smtp-check` (Worktree `timetrack-pwa-wt/mail1`), nicht gemergt. Gegenstück im Backend: `docs/handoffs/MAIL1.md`, ADR-0022, Vertrag **v0.18.0**.

## Neu
- Seite `src/routes/(app)/admin/mail/+page.svelte`, Komponente `src/lib/components/mail/CheckStepper.svelte`, Hilfen `src/lib/mail/format.ts`, Texte `src/lib/i18n/de-mail.ts`, API `getMailStatus`/`checkMail`/`sendMailTest`.
- Navigation: Seitenleiste (Verwaltung), Einstellungen (Gruppe Verwaltung), Modulkarte (`/admin/mail` = Kern), Link im Profilhinweis „kann keine E-Mails senden“ für Admins.
- Mock `mock/mail.ts` mit Szenarien über `POST /api/v1/mock/mail {scenario: ok|tls|auth|sender|not_configured, rateLimit, old}`; `mailAvailable:false` startet unkonfiguriert. Testmail ohne frische Sitzung: `staleSessions` des Mock.
- Ehrlichkeit: Die Schritte erscheinen erst, wenn die einzige Antwort da ist (leichte Staffelung nur per CSS); Zeiten sind die gemessenen des Servers.
- Der Docs-Hinweis nennt den Pfad `docs/installation/konfiguration.md` als Text (kein Link: keine feste Docs-URL bekannt).

## Prüfung
Siehe Backend-Handoff (Zahlen). PWA: `npm run check` 0 Fehler; `npm test` 708 bestanden; `npm run build` ok; `test:e2e:mock` 101 bestanden (Port 19980); `test:e2e:pwa` 7 bestanden; echtes Backend `npx playwright test` 188 bestanden (Binärkopie, Port 20400), darunter zwei neue Fälle in `e2e/profile.spec.ts` (Prüfung grün gegen den Fake-SMTP-Empfänger, Testmail mit festem Betreff, Mitglied 403, unkonfigurierte Instanz).
