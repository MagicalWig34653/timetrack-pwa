import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { DayEvaluation } from '#lib/api/types.js';
import DaySummary from './DaySummary.svelte';

const evaluation = (extra: Partial<DayEvaluation>): DayEvaluation => ({
	date: '2026-10-26',
	targetSeconds: 27720,
	rawWorkSeconds: 0,
	breakDeductionSeconds: 0,
	startAdjustSeconds: 0,
	endAdjustSeconds: 0,
	evaluatedWorkSeconds: 0,
	creditSeconds: 0,
	deltaSeconds: -27720,
	provisional: false,
	segmentIds: [],
	breakHints: [],
	...extra
});

describe('DaySummary absence effects', () => {
	it('shows a quiet overtime hint for a booking on a vacation day, whole and half', () => {
		const { unmount } = render(DaySummary, { evaluation: evaluation({ mark: 'vacation', targetSeconds: 0, rawWorkSeconds: 28800, evaluatedWorkSeconds: 28800, deltaSeconds: 28800 }) });
		expect(screen.getByTestId('day-off-booking')).toHaveTextContent('Buchung an Urlaubstag: Die gebuchte Zeit zählt als Überstunde.');
		expect(screen.getByTestId('day-raw')).toHaveTextContent('8:00');
		unmount();
		render(DaySummary, { evaluation: evaluation({ mark: 'vacation', targetSeconds: 13860, rawWorkSeconds: 18000, evaluatedWorkSeconds: 18000, deltaSeconds: 4140 }) });
		expect(screen.getByTestId('day-off-booking')).toBeInTheDocument();
		expect(screen.getByTestId('day-target-note')).toHaveTextContent('halber Urlaubstag');
	});

	it('shows no overtime hint on a vacation day without a booking', () => {
		render(DaySummary, { evaluation: evaluation({ mark: 'vacation', targetSeconds: 0, deltaSeconds: 0 }) });
		expect(screen.queryByTestId('day-off-booking')).toBeNull();
	});

	it('explains a zero target from a vacation, sick or holiday mark neutrally', () => {
		render(DaySummary, { evaluation: evaluation({ mark: 'vacation', targetSeconds: 0, deltaSeconds: 0 }) });
		expect(screen.getByTestId('day-target-note')).toHaveTextContent('Soll 0: Der Tag ist als „Urlaub“ gewertet.');
	});

	it('explains a halved target on a half vacation day', () => {
		render(DaySummary, { evaluation: evaluation({ mark: 'vacation', targetSeconds: 13860 }) });
		expect(screen.getByTestId('day-target-note')).toHaveTextContent('Soll halbiert: halber Urlaubstag.');
	});

	it('names the origin of the mark neutrally (contract v0.3.2 markSource)', () => {
		const { unmount } = render(DaySummary, { evaluation: evaluation({ mark: 'holiday', targetSeconds: 0, markSource: 'holiday' }) });
		expect(screen.getByTestId('day-mark-source')).toHaveTextContent('Markierung: aus dem Feiertagskalender abgeleitet.');
		unmount();
		const second = render(DaySummary, { evaluation: evaluation({ mark: 'sick', targetSeconds: 0, markSource: 'absence' }) });
		expect(screen.getByTestId('day-mark-source')).toHaveTextContent('aus einer Abwesenheit abgeleitet');
		second.unmount();
		render(DaySummary, { evaluation: evaluation({ mark: 'vacation', targetSeconds: 0, markSource: 'explicit' }) });
		expect(screen.getByTestId('day-mark-source')).toHaveTextContent('manuell gesetzt');
	});

	it('shows no source line without a mark or with markSource none', () => {
		render(DaySummary, { evaluation: evaluation({ mark: 'none', markSource: 'none' }) });
		expect(screen.queryByTestId('day-mark-source')).toBeNull();
	});

	it('shows no note for unmarked days', () => {
		render(DaySummary, { evaluation: evaluation({ mark: 'none' }) });
		expect(screen.queryByTestId('day-target-note')).toBeNull();
	});
});
