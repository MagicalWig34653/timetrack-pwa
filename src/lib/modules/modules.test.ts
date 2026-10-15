import { describe, expect, it } from 'vitest';
import { MODULE_KEYS } from '#lib/api/types.js';
import { de } from '#lib/i18n/de.js';
import { ADMIN_LINKS, MAIN_LINKS, SETTINGS_ADMIN_LINKS, SETTINGS_LINKS } from '#lib/nav.js';
import { CATEGORY_MODULES, CORE_ROUTES, isCoreRoute, MODULE_ROUTES, moduleOfPath } from './map.js';

/** Every page file under src/routes, as the URL path it serves (route groups removed, [param] kept as a sample value). */
const pages = Object.keys(import.meta.glob('/src/routes/**/+page.svelte')).map((file) => {
	const path = file
		.replace('/src/routes', '')
		.replace(/\/\+page\.svelte$/, '')
		.replace(/\/\([^/]+\)/g, '')
		.replace(/\[[^\]]+\]/g, 'sample');
	return path === '' ? '/' : path;
});

/** Owners of a path: 'core' and/or module keys. A well-classified path has exactly one. */
function owners(path: string): string[] {
	const result = new Set<string>();
	if (isCoreRoute(path)) result.add('core');
	const module = moduleOfPath(path);
	if (module) result.add(module);
	return [...result];
}

describe('module route classification (ADR-0012)', () => {
	it('finds the page files', () => {
		expect(pages.length).toBeGreaterThan(25);
		expect(pages).toContain('/reports');
		expect(pages).toContain('/time/sample');
	});

	it('assigns every page to core or exactly one module - add new routes to modules/map.ts', () => {
		const unclassified = pages.filter((path) => owners(path).length === 0);
		expect(unclassified, `routes missing in src/lib/modules/map.ts: ${unclassified.join(', ')}`).toEqual([]);
		const ambiguous = pages.filter((path) => owners(path).length > 1);
		expect(ambiguous).toEqual([]);
	});

	it('has no listed route without a page (stale entries)', () => {
		const listed = [...CORE_ROUTES, ...Object.values(MODULE_ROUTES).flat()];
		const stale = listed.filter((route) => !pages.some((page) => page === route || page.startsWith(route + '/')));
		expect(stale).toEqual([]);
	});

	it('classifies every navigation entry', () => {
		for (const link of [...MAIN_LINKS, ...ADMIN_LINKS, ...SETTINGS_LINKS, ...SETTINGS_ADMIN_LINKS]) {
			expect(owners(link.href), link.href).toHaveLength(1);
		}
	});

	it('maps the documented pages to their module', () => {
		const expected: Record<string, string> = {
			'/reports': 'reports',
			'/settings/learning-fields': 'reports',
			'/vacation': 'planning',
			'/calendar': 'planning',
			'/absences': 'planning',
			'/shared': 'planning',
			'/settings/sharing': 'planning',
			'/export': 'transfer',
			'/import': 'transfer',
			'/settings/storage': 'transfer',
			'/settings/devices': 'automation',
			'/suggestions': 'automation',
			'/settings/api-tokens': 'mcp',
			'/settings/connections': 'mcp',
			'/settings/mcp-help': 'mcp',
			'/oauth/consent': 'mcp'
		};
		for (const [path, module] of Object.entries(expected)) expect(moduleOfPath(path), path).toBe(module);
		for (const core of ['/', '/time', '/time/2026-10-15', '/notifications', '/settings/modules', '/settings/work-model', '/admin/modules', '/admin/invitations']) {
			expect(moduleOfPath(core), core).toBeNull();
		}
	});

	it('only uses known module keys and has German texts for each', () => {
		expect(Object.keys(MODULE_ROUTES).sort()).toEqual([...MODULE_KEYS].sort());
		for (const key of MODULE_KEYS) {
			expect(de[`module.${key}.name` as keyof typeof de]).toBeTruthy();
			expect(de[`module.${key}.desc` as keyof typeof de]).toBeTruthy();
		}
		for (const module of Object.values(CATEGORY_MODULES)) expect(MODULE_KEYS).toContain(module);
	});
});
