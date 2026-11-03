import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import type { PlanWeekDay } from '#lib/api/types.js';
import { emptyDraft } from '#lib/week/plan-draft.js';
import WeekGrid from './WeekGrid.svelte';

afterEach(() => vi.unstubAllGlobals());

it('keeps the add action enabled and dispatches it on every off-day column', async () => {
	vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
	const days: PlanWeekDay[] = (['vacation', 'sick', 'excused', 'holiday'] as const).map((blockedBy, i) => ({
		date: `2036-05-${12 + i}`, weekday: i + 1, targetSeconds: 0, plannedSeconds: null, blockedBy, plan: null
	}));
	const onadd = vi.fn();
	render(WeekGrid, {
		days, drafts: days.map((day) => emptyDraft(day.date)), multi: true, visible: [0, 1, 2, 3],
		tool: 'draw', brush: { kind: 'office', placeId: null, breakMinutes: 0 }, places: [], actuals: {}, showActuals: false,
		issues: new Map(), today: '2036-05-12', nowMinute: null,
		suggestion: { start: '08:00', end: '16:00', breakMinutes: 0, source: 'fallback' },
		holidayNames: {}, holidayTreatments: {}, onadd,
		onpaint: vi.fn(), onquick: vi.fn(), onmove: vi.fn(), onresize: vi.fn(), onerase: vi.fn(),
		onedit: vi.fn(), oneditday: vi.fn(), onsplit: vi.fn(), menu: () => [], onswipe: vi.fn()
	});
	for (const day of days) {
		const add = screen.getByTestId(`add-${day.date}`);
		expect(add).toBeEnabled();
		await fireEvent.click(add);
		expect(onadd).toHaveBeenLastCalledWith(day.date);
	}
	expect(onadd).toHaveBeenCalledTimes(4);
});
