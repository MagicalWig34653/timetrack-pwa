import { describe, expect, it } from 'vitest';
import { SETTINGS_LINKS, breadcrumbs, searchSettings } from './nav';

describe('navigation helpers', () => {
	it('builds breadcrumbs', () => {
		expect(breadcrumbs('/')).toEqual([{ label: 'nav.home' }]);
		expect(breadcrumbs('/settings/appearance').map((c) => c.label)).toEqual(['nav.home', 'nav.settings', 'nav.appearance']);
		expect(breadcrumbs('/time/2026-10-15').map((c) => c.label ?? c.text)).toEqual(['nav.home', 'nav.time', '2026-10-15']);
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
