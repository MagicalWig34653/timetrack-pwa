import { describe, expect, it } from 'vitest';
import type { DayDraft } from './plan-draft.js';
import { settleSave } from './save-merge.js';

const draft = (mode: string, extra: Record<string, unknown> = {}) => ({ mode, ...extra }) as unknown as DayDraft;

describe('settleSave', () => {
	it('adopts the server version when nothing changed during the save', () => {
		const sent = [draft('home')];
		const saved = [draft('home', { startTime: '08:00' })];
		const r = settleSave(sent, [draft('home')], saved);
		expect(r.drafts).toEqual(saved);
		expect(r.baseline).toEqual(saved);
		expect(r.keepHistory).toBe(false);
	});
	it('keeps edits made while saving and only moves the baseline', () => {
		const sent = [draft('home'), draft('office')];
		const current = [draft('home'), draft('school')];
		const saved = [draft('home'), draft('office')];
		const r = settleSave(sent, current, saved);
		expect(r.drafts).toBe(current);
		expect(r.baseline).toEqual(saved);
		expect(r.keepHistory).toBe(true);
	});
});
