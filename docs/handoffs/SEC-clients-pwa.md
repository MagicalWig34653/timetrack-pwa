# Handoff SEC-clients-pwa (Vertrag 0.41.0, Backend SEC-A und SEC-C)

Branch `sec-clients`. Die PWA liest jetzt Vertrag 0.41.0; der Mock meldet `apiVersion` 0.41.0.

## Umgesetzt
1. **Rückfallpasswort:** Mindestlänge 16 (`src/lib/recovery.ts`), Hilfetext und Meldung nennen die lange Passphrase; 400 `weak_password` hat eine eigene deutsche Meldung (`error.weak_password`). Mock: 16 bis 256 Zeichen plus Qualitätsprüfung.
2. **429:** `ApiError.retryAfterSeconds` liest den Header `Retry-After` (Sekunden oder HTTP-Datum, ohne die 5-s-Kappung des GET-Retrys). `errorMessage` hängt bei 429 „Bitte versuche es in etwa N Sekunden/Minuten/Stunden erneut.“ an; Grundtext „Zu viele Versuche, bitte später erneut versuchen.“ gilt für alle 429 (recovery/start, recovery/complete, E-Mail-Änderung, Recovery-E-Mail, Upload, Export).
3. **Kontoexport:** 403 `reauth_required` zeigt die Hinweiskarte (Abmelden und per Passkey neu anmelden), Rückkehr über `/settings/privacy?retry=export` wiederholt den Export einmal selbst. 429 `export_rate_limited` hat einen eigenen Text.
4. **Speicher:** 413 `storage_quota_exceeded` hat eine eigene Meldung. Admin-Seite `/settings/storage`: Karte „Kontingent je Konto“ (`quotaBytes` mit Einheit, `quotaFiles`; 0 = unbegrenzt, lokale Prüfung). Eine Nutzungsanzeige je Konto gibt es im Vertrag 0.41.0 nicht; nicht umgesetzt.
5. **Zustimmungsseite:** Hinweiskarte „Nicht verifizierter Client“ (bei `clientVerified=false`) mit Registrierungsdatum; Redirect-Host deutlich größer und mit umlaufendem Rahmen (kein einseitiger Balken). Scope-Vorbelegung unverändert (Nutzerentscheidung offen).
6. **Beendete Sitzungen:** `setSessionEndedHandler` (client.ts): ein 401 auf einem Datenaufruf (nicht `/auth/*`) bei bekannter Sitzung setzt den Fehlercode `session_ended`, das App-Layout meldet leise ab und geht auf `/login?ended=1&next=…` (Hinweiskarte, kein Fehlerflackern). Hinweise zur Abmeldung anderer Geräte auf der Passkey-Seite (Widerruf), der Recovery-Passkey-Seite und in der Erfolgsmeldung.

## Mock und Tests
- Test-Hook `POST /api/v1/mock/limits {limited:[Pfade], retryAfter, exportLimited, quotaFull, uploadLimited, endSessions}`; `MockResponse.headers` (Retry-After). Mock-Export verlangt frische Sitzung; Passkey anlegen (Recovery) und widerrufen beenden andere Sitzungen; Speicher-Kontingent im Transfer-Mock erzwungen; OAuth-Anfrage mit `clientRegisteredAt`/`clientVerified`.
- Neu: `src/routes/security-clients.test.ts`, Ergänzungen in `pages.test.ts`, `accounts-pages.test.ts`, `transfer-pages.test.ts`, `storage-rules.test.ts`; Mock-E2E `e2e-mock/security-clients.spec.ts`; `version.spec.ts` auf API 0.41.0.

## Offen
- Echte Geräteprüfung gegen Backend 0.41.0 (insbesondere Export-Wiederholung nach Anmeldung: Safari könnte den automatischen Download ohne Nutzergeste blockieren; die Meldung „Export wird gestartet“ bleibt dann stehen).
- Bei 401 durch das Backend-Leerlauf-Timeout (14 Tage) gilt derselbe leise Weg.
