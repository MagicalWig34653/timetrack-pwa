import type { MessageKey } from '#lib/i18n/index.js';

/** Top navigation entries; entries of a switched-off module are filtered out by the layout (see modules/map.ts). */
export const MAIN_LINKS: { href: string; label: MessageKey; prefix: boolean; section?: string }[] = [
	{ href: '/', label: 'nav.home', prefix: false },
	{ href: '/time', label: 'nav.time', prefix: true },
	{ href: '/suggestions', label: 'nav.suggestions', prefix: true },
	{ href: '/reports', label: 'nav.reports', prefix: true },
	{ href: '/calendar', label: 'nav.calendar', prefix: true },
	{ href: '/vacation', label: 'nav.vacation', prefix: true },
	{ href: '/absences', label: 'nav.absences', prefix: true },
	{ href: '/shared', label: 'nav.shared', prefix: true },
	{ href: '/export', label: 'nav.export', prefix: true },
	{ href: '/import', label: 'nav.import', prefix: true },
	{ href: '/settings/work-model', label: 'nav.settings', prefix: false, section: '/settings' }
];

export const ADMIN_LINKS: { href: string; label: MessageKey; prefix: boolean }[] = [
	{ href: '/admin/invitations', label: 'nav.invitations', prefix: true },
	{ href: '/admin/modules', label: 'nav.admin_modules', prefix: true }
];

export const SETTINGS_LINKS: { href: string; label: MessageKey }[] = [
	{ href: '/settings/work-model', label: 'nav.work_model' },
	{ href: '/settings/places', label: 'nav.places' },
	{ href: '/settings/account-time', label: 'nav.account_time' },
	{ href: '/settings/learning-fields', label: 'nav.learning_fields' },
	{ href: '/settings/notifications', label: 'nav.notification_settings' },
	{ href: '/settings/modules', label: 'nav.modules' },
	{ href: '/settings/devices', label: 'nav.devices' },
	{ href: '/settings/sharing', label: 'nav.sharing' },
	{ href: '/settings/passkeys', label: 'nav.passkeys' },
	{ href: '/settings/identities', label: 'nav.identities' },
	{ href: '/settings/connections', label: 'nav.connections' },
	{ href: '/settings/api-tokens', label: 'nav.api_tokens' },
	{ href: '/settings/mcp-help', label: 'nav.mcp_help' },
	{ href: '/settings/recovery', label: 'nav.recovery' },
	{ href: '/settings/sessions', label: 'nav.sessions' }
];

/** Admin-only settings entries. */
export const SETTINGS_ADMIN_LINKS: { href: string; label: MessageKey }[] = [{ href: '/settings/storage', label: 'nav.storage' }];
