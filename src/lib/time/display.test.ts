import { beforeEach, describe, expect, it } from 'vitest';
import { formatDecimalDelta, formatDecimalHours, reloadTimeDisplay, timeDisplay } from './display.svelte';

describe('decimal hours', () => {
	it('formats with a German decimal comma', () => {
		expect(formatDecimalHours(417 * 3600 + 45 * 60)).toBe('417,75 h');
		expect(formatDecimalHours(27720)).toBe('7,70 h');
		expect(formatDecimalHours(0)).toBe('0,00 h');
	});
	it('keeps signs and truncates sub-minute remainders', () => {
		expect(formatDecimalHours(-1080)).toBe('-0,30 h');
		expect(formatDecimalHours(-30)).toBe('0,00 h');
		expect(formatDecimalDelta(900)).toBe('+0,25 h');
		expect(formatDecimalDelta(-900)).toBe('-0,25 h');
	});
});

describe('timeDisplay store', () => {
	beforeEach(() => {
		localStorage.clear();
		reloadTimeDisplay();
	});
	it('defaults to h:mm and toggles', () => {
		expect(timeDisplay.duration(25065)).toBe('6:57');
		timeDisplay.toggle();
		expect(timeDisplay.mode).toBe('decimal');
		expect(timeDisplay.duration(25065)).toBe('6,95 h');
		expect(timeDisplay.delta(3600)).toBe('+1,00 h');
		timeDisplay.toggle();
		expect(timeDisplay.delta(3600)).toBe('+1:00');
	});
	it('persists the choice', () => {
		timeDisplay.set('decimal');
		expect(localStorage.getItem('tt.timeDisplay')).toBe('decimal');
		reloadTimeDisplay();
		expect(timeDisplay.mode).toBe('decimal');
	});
});
