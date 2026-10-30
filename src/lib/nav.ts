import type { MessageKey } from '#lib/i18n/index.js';

/** Top navigation entries; entries of a switched-off module are filtered out by the layout (see modules/map.ts). */
export const MAIN_LINKS: { href: string; label: MessageKey; prefix: boolean; section?: string }[] = [
	{ href: '/', label: 'nav.home', prefix: false },
	{ href: '/week', label: 'nav.week', prefix: true },
	{ href: '/suggestions', label: 'nav.suggestions', prefix: true },
	{ href: '/reports', label: 'nav.reports', prefix: true },
	{ href: '/calendar', label: 'nav.calendar', prefix: true },
	{ href: '/vacation', label: 'nav.vacation', prefix: true },
	{ href: '/absences', label: 'nav.absences', prefix: true },
	{ href: '/shared', label: 'nav.shared', prefix: true },
	{ href: '/export', label: 'nav.export', prefix: true },
	{ href: '/import', label: 'nav.import', prefix: true },
	{ href: '/settings', label: 'nav.settings', prefix: false, section: '/settings' }
];

export const ADMIN_LINKS: { href: string; label: MessageKey; prefix: boolean }[] = [
	{ href: '/admin/invitations', label: 'nav.invitations', prefix: true },
	{ href: '/admin/accounts', label: 'nav.accounts', prefix: true },
	{ href: '/admin/modules', label: 'nav.admin_modules', prefix: true },
	{ href: '/admin/mail', label: 'nav.mail', prefix: true },
	{ href: '/admin/apns', label: 'nav.apns', prefix: true }
];

export const SETTINGS_LINKS: { href: string; label: MessageKey }[] = [
	{ href: '/settings/profile', label: 'nav.profile' },
	{ href: '/settings/work-model', label: 'nav.work_model' },
	{ href: '/settings/appearance', label: 'nav.appearance' },
	{ href: '/settings/places', label: 'nav.places' },
	{ href: '/settings/account-time', label: 'nav.account_time' },
	{ href: '/settings/learning-fields', label: 'nav.learning_fields' },
	{ href: '/settings/notifications', label: 'nav.notification_settings' },
	{ href: '/settings/modules', label: 'nav.modules' },
	{ href: '/settings/devices', label: 'nav.devices' },
	{ href: '/settings/trigger-links', label: 'nav.trigger_links' },
	{ href: '/settings/calendar-feeds', label: 'nav.calendar_feeds' },
	{ href: '/settings/sharing', label: 'nav.sharing' },
	{ href: '/settings/vacation-form', label: 'nav.vacation_form' },
	{ href: '/settings/passkeys', label: 'nav.passkeys' },
	{ href: '/settings/identities', label: 'nav.identities' },
	{ href: '/settings/connections', label: 'nav.connections' },
	{ href: '/settings/api-tokens', label: 'nav.api_tokens' },
	{ href: '/settings/mcp-help', label: 'nav.mcp_help' },
	{ href: '/settings/recovery', label: 'nav.recovery' },
	{ href: '/settings/sessions', label: 'nav.sessions' },
	{ href: '/settings/privacy', label: 'nav.privacy' },
	// shortcuts to pages that live outside /settings but belong to "Daten & Export" (U8)
	{ href: '/export', label: 'nav.export' },
	{ href: '/import', label: 'nav.import' },
	{ href: '/time/cancelled', label: 'trash.title' }
];

/** Admin-only settings entries. */
export const SETTINGS_ADMIN_LINKS: { href: string; label: MessageKey }[] = [
	{ href: '/admin/invitations', label: 'nav.invitations' },
	{ href: '/admin/accounts', label: 'nav.accounts' },
	{ href: '/admin/modules', label: 'nav.admin_modules' },
	{ href: '/admin/mail', label: 'nav.mail' },
	{ href: '/admin/apns', label: 'nav.apns' },
	{ href: '/settings/storage', label: 'nav.storage' }
];

/** One explanatory line per settings entry (the page's own description), shown on the settings landing page. */
export const SETTINGS_DESCRIPTIONS: Record<string, MessageKey> = {
	'/settings/profile': 'profile.description',
	'/settings/passkeys': 'passkeys.description',
	'/settings/identities': 'identities.description',
	'/settings/recovery': 'recovery.description',
	'/settings/sessions': 'sessions.description',
	'/settings/work-model': 'work_model.description',
	'/settings/account-time': 'account_time.description',
	'/settings/vacation-form': 'vform.description',
	'/settings/learning-fields': 'learning.description',
	'/settings/sharing': 'share.description',
	'/settings/places': 'places.description',
	'/settings/devices': 'devices.description',
	'/settings/trigger-links': 'trigger.description',
	'/settings/notifications': 'notif_settings.description',
	'/settings/calendar-feeds': 'feeds.description',
	'/settings/appearance': 'appearance.description',
	'/settings/modules': 'modules.description',
	'/settings/connections': 'connections.description',
	'/settings/api-tokens': 'tokens.description',
	'/settings/mcp-help': 'mcphelp.description',
	'/settings/privacy': 'privacy.description',
	'/export': 'export.description',
	'/import': 'import.description',
	'/time/cancelled': 'trash.description',
	'/admin/invitations': 'invitations.description',
	'/admin/accounts': 'accounts.description',
	'/admin/modules': 'admin_modules.description',
	'/admin/mail': 'mail.description',
	'/admin/apns': 'apns.description',
	'/settings/storage': 'storage.description'
};

/**
 * Grouped settings navigation (P1): the former single row of 18 tabs became a sidebar list on wide screens and a
 * collapsible grouped list on phones. Every settings link belongs to exactly one group (nav.test.ts).
 */
export const SETTINGS_GROUPS: { id: string; label: MessageKey; hrefs: string[] }[] = [
	{ id: 'account', label: 'nav.settings_group.account', hrefs: ['/settings/profile', '/settings/passkeys', '/settings/identities', '/settings/recovery', '/settings/sessions'] },
	{ id: 'work', label: 'nav.settings_group.work', hrefs: ['/settings/work-model', '/settings/account-time', '/settings/vacation-form', '/settings/learning-fields', '/settings/sharing'] },
	{ id: 'places', label: 'nav.settings_group.places', hrefs: ['/settings/places', '/settings/devices', '/settings/trigger-links'] },
	{ id: 'notify', label: 'nav.settings_group.notify', hrefs: ['/settings/notifications', '/settings/calendar-feeds'] },
	{ id: 'ai', label: 'nav.settings_group.ai', hrefs: ['/settings/connections', '/settings/api-tokens', '/settings/mcp-help'] },
	{ id: 'data', label: 'nav.settings_group.data', hrefs: ['/export', '/import', '/time/cancelled', '/settings/privacy'] },
	{ id: 'app', label: 'nav.settings_group.app', hrefs: ['/settings/appearance', '/settings/modules'] },
	{ id: 'admin', label: 'nav.settings_group.admin', hrefs: ['/admin/invitations', '/admin/accounts', '/admin/modules', '/admin/mail', '/admin/apns', '/settings/storage'] }
];

/** Groups the visible links; empty groups disappear. */
export function groupSettingsLinks<T extends { href: string }>(links: T[]): { id: string; label: MessageKey; links: T[] }[] {
	return SETTINGS_GROUPS.map((group) => ({
		id: group.id,
		label: group.label,
		links: group.hrefs.map((href) => links.find((link) => link.href === href)).filter((link): link is T => !!link)
	})).filter((group) => group.links.length > 0);
}

export interface NavItem {
	href: string;
	label: MessageKey;
	prefix: boolean;
	icon: 'house' | 'clock' | 'week' | 'calendar' | 'book' | 'chart' | 'plane' | 'absence' | 'share' | 'bulb' | 'download' | 'upload' | 'invite' | 'users' | 'modules' | 'storage' | 'mail' | 'groups';
	/** further path prefixes that keep the entry highlighted (the planner tab of "Woche" lives at /plan) */
	alsoActive?: string[];
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
			{ href: '/week', label: 'nav.week', prefix: true, icon: 'week', alsoActive: ['/plan', '/time'] },
			{ href: '/calendar', label: 'nav.calendar', prefix: true, icon: 'calendar' },
			{ href: '/stats', label: 'nav.stats', prefix: true, icon: 'chart' },
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
			{ href: '/groups', label: 'nav.groups', prefix: true, icon: 'groups' },
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
			{ href: '/admin/modules', label: 'nav.admin_modules', prefix: true, icon: 'modules' },
			{ href: '/admin/mail', label: 'nav.mail', prefix: true, icon: 'mail' },
			{ href: '/admin/apns', label: 'nav.apns', prefix: true, icon: 'mail' }
		]
	}
];

/** Extra search terms per settings page (German); the page title is always searched too. */
export const SETTINGS_KEYWORDS: Record<string, string> = {
	'/settings/profile': 'profil name anzeigename e-mail adresse konto einrichtung wiederholen onboarding',
	'/settings/work-model': 'arbeitszeit soll woche tag pause rundung schule fahrtzeit modell firmentage betriebsferien',
	'/settings/appearance': 'darstellung hell dunkel akzent farbe theme transparenz design',
	'/settings/places': 'orte standort ort automatik geofence regeln',
	'/settings/account-time': 'zeitkonto saldo anfangsstand korrektur',
	'/settings/learning-fields': 'lernfelder berichtsheft ihk',
	'/settings/vacation-form': 'urlaub urlaubsanspruch resturlaub urlaubsantrag antrag formular pdf vorlage urlaub ausfüllen',
	'/settings/notifications': 'hinweise push benachrichtigung erinnerung apns web-push',
	'/settings/modules': 'module funktionen ausblenden',
	'/settings/devices': 'geräte shortcuts automatik',
	'/settings/trigger-links': 'auslöse links url start stopp timer schaltfläche widget kurzbefehl',
	'/settings/calendar-feeds': 'kalender abo ics abonnieren apple google outlook feed link url',
	'/settings/sharing': 'freigaben teilen plan privat',
	'/settings/passkeys': 'passkey anmeldung sicherheit konto',
	'/settings/identities': 'openid oidc anmeldung verknüpft',
	'/settings/connections': 'verbindungen ki chatgpt claude oauth',
	'/settings/api-tokens': 'token api bearer mcp',
	'/settings/mcp-help': 'ki mcp anbindung hilfe',
	'/settings/recovery': 'wiederherstellung recovery codes passwort',
	'/settings/sessions': 'sitzungen abmelden geräte sicherheit',
	'/settings/privacy': 'daten datenschutz export herunterladen löschen konto dsgvo auskunft',
	'/settings/storage': 'speicher dateien s3 anhänge',
	'/export': 'export exportieren csv pdf tabelle nachweis herunterladen',
	'/import': 'import importieren csv excel tabelle übernehmen',
	'/time/cancelled': 'storniert stornierte einträge papierkorb gelöscht wiederherstellen',
	'/admin/invitations': 'einladung einladen registrierung token admin',
	'/admin/accounts': 'konten benutzer admin sperren löschen',
	'/admin/modules': 'module server admin funktionen',
	'/admin/mail': 'e-mail mail smtp versand server testmail verbindung prüfen',
	'/admin/apns': 'apns push apple iphone mitteilungen schlüssel server prüfen verbindung'
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
ALL_LABELS.set('/plan', 'nav.week');
// /time was merged into the week page (N2): its sub pages (day detail, cancelled entries) belong to "Woche".
ALL_LABELS.set('/time', 'nav.week');

/** Breadcrumb trail for a pathname: section, then page; unknown tails are shown as text. */
export function breadcrumbs(pathname: string): Crumb[] {
	if (pathname === '/') return [{ label: 'nav.home' }];
	const parts = pathname.split('/').filter(Boolean);
	const trail: Crumb[] = [{ label: 'nav.home', href: '/' }];
	if (parts[0] === 'settings') {
		if (parts.length === 1) return [{ label: 'nav.home', href: '/' }, { label: 'nav.settings' }];
		trail.push({ label: 'nav.settings', href: '/settings' });
		const label = ALL_LABELS.get(`/settings/${parts[1] ?? ''}`);
		if (label) trail.push({ label });
		return trail;
	}
	if (parts[0] === 'admin') {
		trail.push({ label: 'nav.settings', href: '/settings' });
		const label = ALL_LABELS.get(`/admin/${parts[1] ?? ''}`);
		if (label) trail.push({ label });
		return trail;
	}
	const label = ALL_LABELS.get(`/${parts[0]}`);
	if (label && pathname === '/time/cancelled') {
		trail.push({ label, href: '/week' }, { label: 'trash.title' });
		return trail;
	}
	if (parts[0] === 'groups' && parts.length > 1) {
		const leaf = parts[1] === 'polls' ? (parts[2] === 'new' ? 'groups.crumb_poll_new' : 'groups.crumb_poll') : parts[1] === 'orders' ? (parts[2] === 'new' ? 'groups.crumb_order_new' : 'groups.crumb_order') : 'groups.crumb_catalogs';
		return [...trail, { label: 'nav.groups', href: '/groups' }, { label: leaf }];
	}
	if (label && pathname === '/vacation/planner') {
		trail.push({ label, href: '/vacation' }, { label: 'planner.title' });
		return trail;
	}
	if (label) {
		trail.push(parts.length > 1 ? { label, href: parts[0] === 'time' ? '/week' : `/${parts[0]}` } : { label });
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

/**
 * Pages that share one section shell (the settings nav + content column, see SettingsShell). The app layout keeps such a
 * shell mounted across navigations between its pages; the `/admin/*` pages are listed in the settings nav (admin group) and use the same shell.
 */
export function sectionShell(pathname: string): 'settings' | null {
	return pathname === '/settings' || pathname.startsWith('/settings/') || pathname.startsWith('/admin/') ? 'settings' : null;
}
