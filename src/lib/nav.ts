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
	{ href: '/admin/accounts', label: 'nav.accounts', prefix: true },
	{ href: '/admin/modules', label: 'nav.admin_modules', prefix: true }
];

export const SETTINGS_LINKS: { href: string; label: MessageKey }[] = [
	{ href: '/settings/work-model', label: 'nav.work_model' },
	{ href: '/settings/appearance', label: 'nav.appearance' },
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
	{ href: '/settings/sessions', label: 'nav.sessions' },
	{ href: '/settings/privacy', label: 'nav.privacy' }
];

/** Admin-only settings entries. */
export const SETTINGS_ADMIN_LINKS: { href: string; label: MessageKey }[] = [{ href: '/settings/storage', label: 'nav.storage' }];

export interface NavItem {
	href: string;
	label: MessageKey;
	prefix: boolean;
	icon: 'house' | 'clock' | 'calendar' | 'book' | 'plane' | 'absence' | 'share' | 'bulb' | 'download' | 'upload' | 'invite' | 'users' | 'modules' | 'storage';
	/** badge source rendered by the sidebar */
	badge?: 'suggestions';
}

export interface NavGroup {
	id: 'daily' | 'planning' | 'data' | 'admin';
	label: MessageKey;
	items: NavItem[];
	adminOnly?: boolean;
}

/** Sidebar structure per docs/DESIGN.md "Informationsarchitektur"; module-aware filtering happens in the shell. */
export const NAV_GROUPS: NavGroup[] = [
	{
		id: 'daily',
		label: 'nav.group.daily',
		items: [
			{ href: '/', label: 'nav.home', prefix: false, icon: 'house' },
			{ href: '/time', label: 'nav.time', prefix: true, icon: 'clock' },
			{ href: '/calendar', label: 'nav.calendar', prefix: true, icon: 'calendar' },
			{ href: '/reports', label: 'nav.reports', prefix: true, icon: 'book' }
		]
	},
	{
		id: 'planning',
		label: 'nav.group.planning',
		items: [
			{ href: '/vacation', label: 'nav.vacation', prefix: true, icon: 'plane' },
			{ href: '/absences', label: 'nav.absences', prefix: true, icon: 'absence' },
			{ href: '/shared', label: 'nav.shared', prefix: true, icon: 'share' },
			{ href: '/suggestions', label: 'nav.suggestions', prefix: true, icon: 'bulb', badge: 'suggestions' }
		]
	},
	{
		id: 'data',
		label: 'nav.group.data',
		items: [
			{ href: '/export', label: 'nav.export', prefix: true, icon: 'download' },
			{ href: '/import', label: 'nav.import', prefix: true, icon: 'upload' }
		]
	},
	{
		id: 'admin',
		label: 'nav.group.admin',
		adminOnly: true,
		items: [
			{ href: '/admin/invitations', label: 'nav.invitations', prefix: true, icon: 'invite' },
			{ href: '/admin/accounts', label: 'nav.accounts', prefix: true, icon: 'users' },
			{ href: '/admin/modules', label: 'nav.admin_modules', prefix: true, icon: 'modules' }
		]
	}
];

/** Extra search terms per settings page (German); the page title is always searched too. */
export const SETTINGS_KEYWORDS: Record<string, string> = {
	'/settings/work-model': 'arbeitszeit soll woche tag pause rundung schule fahrtzeit modell',
	'/settings/appearance': 'darstellung hell dunkel akzent farbe theme transparenz design',
	'/settings/places': 'orte standort ort automatik geofence',
	'/settings/account-time': 'zeitkonto saldo anfangsstand korrektur',
	'/settings/learning-fields': 'lernfelder berichtsheft ihk',
	'/settings/notifications': 'hinweise push benachrichtigung erinnerung',
	'/settings/modules': 'module funktionen ausblenden',
	'/settings/devices': 'geräte shortcuts automatik',
	'/settings/sharing': 'freigaben teilen plan privat',
	'/settings/passkeys': 'passkey anmeldung sicherheit konto',
	'/settings/identities': 'openid oidc anmeldung verknüpft',
	'/settings/connections': 'verbindungen ki chatgpt claude oauth',
	'/settings/api-tokens': 'token api bearer mcp',
	'/settings/mcp-help': 'ki mcp anbindung hilfe',
	'/settings/recovery': 'wiederherstellung recovery codes passwort',
	'/settings/sessions': 'sitzungen abmelden geräte sicherheit',
	'/settings/privacy': 'daten datenschutz export herunterladen löschen konto dsgvo auskunft',
	'/settings/storage': 'speicher dateien s3 anhänge'
};

export interface Crumb {
	label: MessageKey | null;
	text?: string;
	href?: string;
}

const ALL_LABELS = new Map<string, MessageKey>();
for (const group of NAV_GROUPS) for (const item of group.items) ALL_LABELS.set(item.href, item.label);
for (const link of [...SETTINGS_LINKS, ...SETTINGS_ADMIN_LINKS]) ALL_LABELS.set(link.href, link.label);
ALL_LABELS.set('/notifications', 'nav.notifications');

/** Breadcrumb trail for a pathname: section, then page; unknown tails are shown as text. */
export function breadcrumbs(pathname: string): Crumb[] {
	if (pathname === '/') return [{ label: 'nav.home' }];
	const parts = pathname.split('/').filter(Boolean);
	const trail: Crumb[] = [{ label: 'nav.home', href: '/' }];
	if (parts[0] === 'settings') {
		trail.push({ label: 'nav.settings', href: '/settings/work-model' });
		const label = ALL_LABELS.get(`/settings/${parts[1] ?? ''}`);
		if (label) trail.push({ label });
		return trail;
	}
	if (parts[0] === 'admin') {
		const label = ALL_LABELS.get(`/admin/${parts[1] ?? ''}`);
		if (label) trail.push({ label });
		return trail;
	}
	const label = ALL_LABELS.get(`/${parts[0]}`);
	if (label) {
		trail.push(parts.length > 1 ? { label, href: `/${parts[0]}` } : { label });
		if (parts.length > 1) trail.push({ label: null, text: parts.slice(1).join(' / ') });
	}
	return trail;
}

/** Settings pages matching a query by title or keyword (case-insensitive, all words must match). */
export function searchSettings<T extends { href: string; label: MessageKey }>(links: T[], query: string, title: (key: MessageKey) => string): T[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (words.length === 0) return [];
	return links.filter((link) => {
		const haystack = `${title(link.label)} ${SETTINGS_KEYWORDS[link.href] ?? ''}`.toLowerCase();
		return words.every((word) => haystack.includes(word));
	});
}
