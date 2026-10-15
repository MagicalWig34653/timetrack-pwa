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
