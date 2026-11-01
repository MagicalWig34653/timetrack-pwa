# U8 (PWA): settings information architecture

## Inventory (before)
- 21 settings pages in 4 groups (Konto & Sicherheit, Arbeit, App, Verbindungen) plus admin items split across three places: the sidebar "Verwaltung" group (invitations, accounts, modules, mail), the settings nav (mail, storage) and the sidebar search.
- Duplicates / misplaced: `/admin/mail` appeared in both nav trees; export/import/cancelled entries (`/time/cancelled`) were not reachable from settings; privacy (data export/delete) sat under account; sharing sat under connections; the sidebar "Einstellungen" entry linked to `/settings/work-model` (arbitrary page) and "Konto & Sicherheit" to `/settings/passkeys`.
- Admin pages: only `/admin/mail` had the settings shell; the other admin pages had none (content/nav jumped).

## New structure
Settings landing `/settings` (new): search field plus cards (title + one-line description) grouped by topic; on phones the landing replaces the folded nav button, on wide screens the sticky sidebar stays. Reserved min-height avoids page jumping while filtering.

Groups (sidebar and landing): Profil & Sicherheit (profile, passkeys, identities, recovery, sessions) | Arbeitszeit & Urlaub (work model incl. rounding, account time, vacation form, learning fields, sharing) | Orte & Automatik (places, devices, trigger links) | Benachrichtigungen & Kalender (notifications, calendar feeds) | KI-Zugang (connections, API tokens, MCP help) | Daten & Export (export, import, cancelled entries, privacy/data) | Darstellung & Module (appearance, modules) | Verwaltung (Admin) (invitations, accounts, server modules, mail, file storage; admins only).

## Old -> new route map
No route was removed or renamed; all old URLs work unchanged. What changed:
- `/settings` is a new landing page (sidebar "Einstellungen" and breadcrumb now link there instead of `/settings/work-model`).
- `/export`, `/import`, `/time/cancelled` are additionally listed in the settings navigation/search (shortcuts, pages not moved).
- `/admin/*` (all four pages) now use the settings shell (new `admin/+layout.svelte`, old `admin/mail/+layout.svelte` removed); `sectionShell()` covers `/admin/*`. Admin entries appear in the "Verwaltung (Admin)" group, `/settings/storage` moved there from the settings group list.
- Sessions, recovery, identities remain on their own routes, only regrouped.
- Search keywords extended (urlaub, firmentage, rundung, papierkorb, export, ...).

## Files
`src/lib/nav.ts` (groups, descriptions, keywords, breadcrumbs, sectionShell), `src/lib/components/shell/SettingsShell.svelte`, `SidebarNav.svelte`, `src/routes/(app)/settings/+page.svelte`, `src/routes/(app)/admin/+layout.svelte`, `src/lib/modules/map.ts` (`/settings` core, exact match), `de-profile.ts` (group labels).

## Tests
`nav.test.ts` (descriptions, admin group, shell, search), e2e-mock `settings-ia.spec.ts` (landing, search, axe, old URLs), updated `profile.spec.ts` and `layout-routes.spec.ts`.
