import { describe, expect, it } from 'vitest';
import { navigate, typeahead, type NavEntry } from './menu-nav.js';

const entries: NavEntry[] = [{ label: 'Bearbeiten' }, { separator: true }, { label: 'Duplizieren' }, { label: 'Dauerhaft löschen', disabled: true }, { label: 'Löschen' }];

describe('navigate', () => {
	it('skips separators and disabled entries and wraps', () => {
		expect(navigate(entries, 0, 'next')).toBe(2);
		expect(navigate(entries, 2, 'next')).toBe(4);
		expect(navigate(entries, 4, 'next')).toBe(0);
		expect(navigate(entries, 0, 'prev')).toBe(4);
		expect(navigate(entries, 4, 'prev')).toBe(2);
	});
	it('starts from nothing selected', () => {
		expect(navigate(entries, -1, 'next')).toBe(0);
		expect(navigate(entries, -1, 'prev')).toBe(4);
	});
	it('finds first and last selectable', () => {
		expect(navigate([{ separator: true }, { label: 'a' }, { label: 'b', disabled: true }], 0, 'last')).toBe(1);
		expect(navigate(entries, 3, 'first')).toBe(0);
		expect(navigate(entries, 3, 'last')).toBe(4);
	});
	it('returns -1 without selectable entries', () => {
		expect(navigate([{ label: 'x', disabled: true }], 0, 'next')).toBe(-1);
		expect(navigate([], 0, 'first')).toBe(-1);
	});
});

describe('typeahead', () => {
	it('jumps to the next entry starting with the typed text, ignoring case and disabled entries', () => {
		expect(typeahead(entries, 'l', 0)).toBe(4);
		expect(typeahead(entries, 'd', 0)).toBe(2);
		expect(typeahead(entries, 'DU', 0)).toBe(2);
	});
	it('cycles when the same letter is repeated', () => {
		const list: NavEntry[] = [{ label: 'Urlaub' }, { label: 'Unterbrechung' }, { label: 'Krank' }];
		expect(typeahead(list, 'u', 0)).toBe(1);
		expect(typeahead(list, 'uu', 1)).toBe(0);
	});
	it('returns -1 when nothing matches or the buffer is empty', () => {
		expect(typeahead(entries, 'x', 0)).toBe(-1);
		expect(typeahead(entries, '', 0)).toBe(-1);
	});
});
