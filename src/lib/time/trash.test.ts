import { describe, expect, it } from 'vitest';
import type { Segment } from '#lib/api/types.js';
import { filterCancelled, isMissingEndpoint, toggleAll, toggleId } from './trash.js';

const seg = (id: string, startedAt: string, kind: Segment['kind'] = 'work', voided = true): Segment =>
	({ id, kind, startedAt, endedAt: startedAt, rawStartedAt: startedAt, rawEndedAt: startedAt, source: 'manual', version: 1, voided, needsReview: false }) as Segment;

describe('filterCancelled', () => {
	const all = [seg('a', '2026-10-01T08:00:00Z'), seg('b', '2026-10-05T08:00:00Z', 'travel'), seg('c', '2026-11-01T08:00:00Z'), seg('d', '2026-10-02T08:00:00Z', 'work', false)];
	it('filters by range and kind, drops active ones, newest first', () => {
		const r = filterCancelled(all, { from: '2026-10-01', to: '2026-10-31', kind: 'all' }, 'Europe/Berlin');
		expect(r.map((s) => s.id)).toEqual(['b', 'a']);
		expect(filterCancelled(all, { from: '2026-10-01', to: '2026-10-31', kind: 'travel' }, 'Europe/Berlin').map((s) => s.id)).toEqual(['b']);
	});
	it('uses the local day near midnight', () => {
		const late = [seg('x', '2026-10-31T23:30:00Z')];
		expect(filterCancelled(late, { from: '2026-11-01', to: '2026-11-01', kind: 'all' }, 'Europe/Berlin')).toHaveLength(1);
	});
});

describe('selection', () => {
	it('toggles ids and all', () => {
		const v = [seg('a', '2026-10-01T08:00:00Z'), seg('b', '2026-10-02T08:00:00Z')];
		expect([...toggleId(new Set(['a']), 'b')]).toEqual(['a', 'b']);
		expect([...toggleId(new Set(['a']), 'a')]).toEqual([]);
		expect(toggleAll(new Set(), v).size).toBe(2);
		expect(toggleAll(new Set(['a', 'b']), v).size).toBe(0);
	});
});

describe('isMissingEndpoint', () => {
	it('detects absent endpoints', () => {
		expect(isMissingEndpoint({ status: 404 })).toBe(true);
		expect(isMissingEndpoint({ status: 409 })).toBe(false);
		expect(isMissingEndpoint(null)).toBe(false);
	});
});
