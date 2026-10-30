import { describe, expect, it } from 'vitest';
import { SETTINGS_LINKS, breadcrumbs, searchSettings } from './nav';

describe('navigation helpers', () => {
	it('builds breadcrumbs', () => {
		expect(breadcrumbs('/')).toEqual([{ label: 'nav.home' }]);
		expect(breadcrumbs('/settings/appearance').map((c) => c.label)).toEqual(['nav.home', 'nav.settings', 'nav.appearance']);
		expect(breadcrumbs('/time/2026-10-15').map((c) => c.label ?? c.text)).toEqual(['nav.home', 'nav.week', '2026-10-15']);
	});
	it('searches settings by title and keyword', () => {
		const titles = (key: string) => key;
		expect(searchSettings(SETTINGS_LINKS, 'akzent', titles).map((l) => l.href)).toEqual(['/settings/appearance']);
		expect(searchSettings(SETTINGS_LINKS, '', titles)).toEqual([]);
		expect(searchSettings(SETTINGS_LINKS, 'zzzz', titles)).toEqual([]);
	});
});

import { SETTINGS_ADMIN_LINKS, groupSettingsLinks } from './nav';

describe('grouped settings navigation', () => {
	it('puts every settings link into exactly one group', () => {
		const all = [...SETTINGS_LINKS, ...SETTINGS_ADMIN_LINKS];
		const grouped = groupSettingsLinks(all).flatMap((g) => g.links.map((l) => l.href));
		expect([...grouped].sort()).toEqual(all.map((l) => l.href).sort());
		expect(new Set(grouped).size).toBe(grouped.length);
	});
	it('drops empty groups', () => {
		const groups = groupSettingsLinks(SETTINGS_LINKS);
		expect(groups.some((g) => g.id === 'admin')).toBe(false);
		expect(groups[0].links[0].href).toBe('/settings/profile');
	});
});

import { SETTINGS_DESCRIPTIONS, SETTINGS_GROUPS, sectionShell } from './nav';

describe('settings information architecture (U8)', () => {
	it('groups admin entries separately and keeps every entry described', () => {
		const all = [...SETTINGS_LINKS, ...SETTINGS_ADMIN_LINKS];
		for (const link of all) expect(SETTINGS_DESCRIPTIONS[link.href], link.href).toBeTruthy();
		const admin = SETTINGS_GROUPS.find((g) => g.id === 'admin')!;
		expect(admin.hrefs).toEqual(SETTINGS_ADMIN_LINKS.map((l) => l.href).sort((a, b) => admin.hrefs.indexOf(a) - admin.hrefs.indexOf(b)));
	});
	it('shares one shell for settings, landing and admin pages', () => {
		for (const path of ['/settings', '/settings/profile', '/admin/accounts', '/admin/mail']) expect(sectionShell(path)).toBe('settings');
		expect(sectionShell('/week')).toBeNull();
	});
	it('finds moved entries by keyword', () => {
		expect(searchSettings(SETTINGS_LINKS, 'papierkorb', (k) => k).map((l) => l.href)).toEqual(['/time/cancelled']);
	});
});

describe('groups navigation (G2)', () => {
	it('lists the groups entry in the sidebar and builds readable breadcrumbs for its sub pages', async () => {
		const { NAV_GROUPS, breadcrumbs } = await import('./nav.js');
		const hrefs = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.href));
		expect(hrefs).toContain('/groups');
		expect(breadcrumbs('/groups/polls/new').map((c) => c.label)).toEqual(['nav.home', 'nav.groups', 'groups.crumb_poll_new']);
		expect(breadcrumbs('/groups/orders/3f2a').map((c) => c.label)).toEqual(['nav.home', 'nav.groups', 'groups.crumb_order']);
		expect(breadcrumbs('/groups/catalogs').map((c) => c.label)).toEqual(['nav.home', 'nav.groups', 'groups.crumb_catalogs']);
	});
});
