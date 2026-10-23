import { describe, expect, it } from 'vitest';
import { DraftHistory } from './history.js';
import { emptyDraft, type DayDraft } from './plan-draft.js';

const a: DayDraft[] = [emptyDraft('2026-10-26')];
const b: DayDraft[] = [{ ...emptyDraft('2026-10-26'), mode: 'office', start: '08:00', end: '16:00' }];
const c: DayDraft[] = [{ ...b[0], end: '17:00' }];

describe('DraftHistory', () => {
	it('undoes and redoes in order with labels', () => {
		const h = new DraftHistory();
		h.record('paint', a, b);
		h.record('resize', b, c);
		expect(h.undoLabel).toBe('resize');
		expect(h.undo()).toEqual({ drafts: b, label: 'resize' });
		expect(h.canRedo).toBe(true);
		expect(h.redoLabel).toBe('resize');
		expect(h.undo()?.drafts).toEqual(a);
		expect(h.undo()).toBeNull();
		expect(h.redo()?.drafts).toEqual(b);
		expect(h.redo()?.drafts).toEqual(c);
		expect(h.redo()).toBeNull();
	});
	it('clears the redo branch on a new edit', () => {
		const h = new DraftHistory();
		h.record('paint', a, b);
		h.undo();
		h.record('other', a, c);
		expect(h.canRedo).toBe(false);
		expect(h.undoLabel).toBe('other');
	});
	it('ignores edits that change nothing and caps the history', () => {
		const h = new DraftHistory(2);
		h.record('noop', a, a);
		expect(h.canUndo).toBe(false);
		h.record('1', a, b);
		h.record('2', b, c);
		h.record('3', c, a);
		h.undo();
		h.undo();
		expect(h.undo()).toBeNull();
	});
	it('clear empties both stacks', () => {
		const h = new DraftHistory();
		h.record('x', a, b);
		h.undo();
		h.clear();
		expect(h.canUndo || h.canRedo).toBe(false);
	});
});
