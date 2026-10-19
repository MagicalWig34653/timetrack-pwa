import { describe, expect, it } from 'vitest';
import type { SystemInfo } from '#lib/api/types.js';
import { resolveBuildInfo } from '../../../scripts/build-info.ts';
import { formatUptime, revisionMismatch, shortDate, shortRevision, supportText, type PwaBuild } from './info.js';

const own: PwaBuild = { version: '0.1.0', revision: 'abc1234def5678abc1234def5678abc1234def56', buildDate: '2026-10-18T08:00:00Z' };
const info = (pwaRevision: string | null): SystemInfo => ({
	backend: {
		version: '0.1.0',
		revision: 'def5678abc1234def5678abc1234def5678abc12',
		revisionShort: 'def5678',
		buildDate: '2026-10-18T09:30:00Z',
		apiVersion: '0.19.0',
		database: 'mariadb',
		schemaMigrations: 40,
		migrationsPending: false,
		uptimeSeconds: 100,
		replicaId: 'abc'
	},
	pwa: pwaRevision === null ? null : { version: '0.1.0', revision: pwaRevision, buildDate: null }
});

const memberInfo = (): SystemInfo => {
	const { backend, pwa } = info('abc1234def5678abc1234def5678abc1234def56');
	// members receive no operator details: the keys are absent, not null
	const { database, schemaMigrations, migrationsPending, uptimeSeconds, replicaId, ...versionOnly } = backend;
	void [database, schemaMigrations, migrationsPending, uptimeSeconds, replicaId];
	return { backend: versionOnly, pwa };
};

describe('version helpers', () => {
	it('shortens revisions and dates', () => {
		expect(shortRevision(own.revision)).toBe('abc1234');
		expect(shortRevision('unknown')).toBe('unbekannt');
		expect(shortRevision(null)).toBe('unbekannt');
		expect(shortDate('2026-10-18T08:00:00Z')).toBe('2026-10-18');
		expect(shortDate(null)).toBe('');
	});

	it('detects an older loaded interface only for known, different revisions', () => {
		expect(revisionMismatch(own, info(own.revision))).toBe(false);
		expect(revisionMismatch(own, info(own.revision.toUpperCase()))).toBe(false);
		expect(revisionMismatch(own, info('1111111222222233333334444444555555566666'))).toBe(true);
		expect(revisionMismatch(own, info(null))).toBe(false);
		expect(revisionMismatch(own, info('unknown'))).toBe(false);
		expect(revisionMismatch({ ...own, revision: 'unknown' }, info('1111111'))).toBe(false);
		expect(revisionMismatch(own, null)).toBe(false);
		expect(revisionMismatch(own, { ...memberInfo(), pwa: { version: '0.1.0', revision: '1111111222222233333334444444555555566666', buildDate: null } })).toBe(true);
		expect(revisionMismatch(own, memberInfo())).toBe(false);
	});

	it('formats the uptime', () => {
		expect(formatUptime(42)).toBe('42 Sek.');
		expect(formatUptime(125)).toBe('2 Min.');
		expect(formatUptime(3 * 3600 + 5 * 60)).toBe('3 Std. 5 Min.');
		expect(formatUptime(93784)).toBe('1 Tag 2 Std. 3 Min.');
		expect(formatUptime(Number.NaN)).toBe('–');
		expect(formatUptime(undefined as unknown as number)).toBe('–');
	});

	it('builds the support text, also for servers without the endpoint', () => {
		expect(supportText(own, info(own.revision))).toBe('Timetrack PWA 0.1.0 (abc1234, 2026-10-18), Backend 0.1.0 (def5678, 2026-10-18), API 0.19.0, mariadb');
		const member = supportText(own, memberInfo());
		expect(member).toBe('Timetrack PWA 0.1.0 (abc1234, 2026-10-18), Backend 0.1.0 (def5678, 2026-10-18), API 0.19.0');
		expect(member).not.toMatch(/undefined|NaN/);
		expect(supportText(own, null)).toBe('Timetrack PWA 0.1.0 (abc1234, 2026-10-18), Backend: keine Versionsangabe verfügbar');
	});
});

describe('resolveBuildInfo', () => {
	const fixed = () => new Date('2026-10-18T10:00:00Z');
	it('prefers the environment of the Docker build', () => {
		expect(resolveBuildInfo({ PWA_VERSION: '0.3.0', PWA_REVISION: 'ABCDEF1234567', PWA_BUILD_DATE: '2026-01-01T00:00:00Z' }, fixed)).toEqual({
			version: '0.3.0',
			revision: 'abcdef1234567',
			buildDate: '2026-01-01T00:00:00Z'
		});
	});
	it('falls back to package.json, git and the clock, and rejects non-hex revisions', () => {
		const result = resolveBuildInfo({ PWA_REVISION: 'not-a-sha' }, fixed);
		expect(result.version).toMatch(/^\d+\.\d+\.\d+/);
		expect(result.revision).toBe('unknown');
		expect(result.buildDate).toBe('2026-10-18T10:00:00.000Z');
	});
});
