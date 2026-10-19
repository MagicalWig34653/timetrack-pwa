import type { ModuleKey } from '../api/types';

/**
 * Classification of every PWA route and navigation entry (ADR-0012). Each route belongs to the always-on core or to
 * exactly one switchable module; modules.test.ts fails when a page exists that is listed nowhere.
 * Matching is by path prefix at a segment boundary ('/time' covers '/time/2026-10-15'); '/' matches only itself.
 */
export const CORE_ROUTES = [
	'/',
	'/time',
	'/week',
	'/notifications',
	'/login',
	'/invite',
	'/recover',
	'/setup/recovery',
	'/offline',
	'/mock-idp',
	'/mock-oauth',
	'/onboarding',
	'/settings/profile',
	'/settings/work-model',
	'/settings/appearance',
	'/settings/places',
	'/settings/account-time',
	'/settings/notifications',
	'/settings/passkeys',
	'/settings/identities',
	'/settings/recovery',
	'/settings/sessions',
	'/settings/modules',
	'/settings/privacy',
	'/admin/invitations',
	'/admin/accounts',
	'/admin/modules',
	'/admin/mail'
] as const;

export const MODULE_ROUTES: Record<ModuleKey, readonly string[]> = {
	reports: ['/reports', '/settings/learning-fields'],
	planning: ['/vacation', '/calendar', '/plan', '/absences', '/shared', '/settings/sharing', '/settings/vacation-form'],
	transfer: ['/export', '/import', '/settings/storage'],
	automation: ['/settings/devices', '/suggestions'],
	mcp: ['/settings/api-tokens', '/settings/connections', '/settings/mcp-help', '/oauth/consent']
};

function covers(route: string, pathname: string): boolean {
	if (route === '/') return pathname === '/';
	return pathname === route || pathname.startsWith(route + '/');
}

/** The module a path belongs to, or null for core routes (and unknown paths, which show the normal not-found). */
export function moduleOfPath(pathname: string): ModuleKey | null {
	for (const [key, routes] of Object.entries(MODULE_ROUTES) as [ModuleKey, readonly string[]][]) {
		if (routes.some((route) => covers(route, pathname))) return key;
	}
	return null;
}

export function isCoreRoute(pathname: string): boolean {
	return CORE_ROUTES.some((route) => covers(route, pathname));
}

/** Notification categories produced by a switchable module (ADR-0012); the other categories are core. */
export const CATEGORY_MODULES = {
	report_gap: 'reports',
	document_submission: 'planning',
	pending_suggestions: 'automation'
} as const satisfies Record<string, ModuleKey>;
