import { beforeEach, describe, expect, it } from 'vitest';
import type { AggregatedItem, Order, Poll } from '#lib/api/types.js';
import { bestOptionIds, deadlineFromInput, deadlineInputValue, entryForAggregate, formatCents, groupUrl, optionTime, optionTitle, parsePrice, priceInputValue, tallyOf, tokenOfPath } from './format.js';
import { clearMemory, loadMemory, saveMemory, updateMemory } from './secrets.js';

const opt = (id: string, extra: object = {}) => ({ id, ...extra });
function poll(extra: Partial<Poll> = {}): Poll {
	return {
		title: 'T',
		kind: 'date',
		choiceMode: 'multi',
		options: [opt('a', { date: '2026-12-01' }), opt('b', { date: '2026-12-02', startTime: '18:00', endTime: '20:00' }), opt('c', { date: '2026-12-03' })],
		hideResults: false,
		closed: false,
		resultsVisible: true,
		voteCount: 3,
		votes: [
			{ id: '1', name: 'A', answers: [{ optionId: 'a', answer: 'yes' }, { optionId: 'b', answer: 'maybe' }], createdAt: '', updatedAt: '' },
			{ id: '2', name: 'B', answers: [{ optionId: 'b', answer: 'yes' }], createdAt: '', updatedAt: '' },
			{ id: '3', name: 'C', answers: [{ optionId: 'a', answer: 'yes' }, { optionId: 'b', answer: 'yes' }], createdAt: '', updatedAt: '' }
		],
		...extra
	};
}

describe('price helpers', () => {
	it('formats cents in euros', () => {
		expect(formatCents(750).replace(/\s/g, ' ')).toBe('7,50 €');
		expect(formatCents(0)).toContain('0,00');
	});
	it('parses typed prices', () => {
		expect(parsePrice('')).toBeNull();
		expect(parsePrice('  ')).toBeNull();
		expect(parsePrice('7,5')).toBe(750);
		expect(parsePrice('7.50')).toBe(750);
		expect(parsePrice('12')).toBe(1200);
		expect(parsePrice('€ 3,20')).toBe(320);
		expect(parsePrice('0')).toBe(0);
		expect(parsePrice('10000')).toBe(1_000_000);
		for (const bad of ['abc', '1,234', '-1', '10000,01', '1,2,3', '1e3']) expect(parsePrice(bad), bad).toBeUndefined();
	});
	it('round-trips through the input text', () => {
		expect(priceInputValue(750)).toBe('7,50');
		expect(priceInputValue(null)).toBe('');
		expect(parsePrice(priceInputValue(1999))).toBe(1999);
	});
});

describe('poll helpers', () => {
	it('titles and times of options', () => {
		expect(optionTitle(opt('x', { label: 'Pizza' }))).toBe('Pizza');
		expect(optionTitle(opt('x', { date: '2026-12-01' }))).toMatch(/01\.12\./);
		expect(optionTitle(opt('x', { date: '2026-12-01', label: 'Kino' }))).toMatch(/01\.12\. Kino/);
		expect(optionTime(opt('x', { startTime: '18:00', endTime: '20:00' }))).toBe('18:00–20:00');
		expect(optionTime(opt('x', { startTime: '18:00' }))).toBe('18:00');
		expect(optionTime(opt('x'))).toBe('');
	});
	it('counts from the votes when the server sends no tally and prefers the server tally', () => {
		expect(tallyOf(poll(), 'a')).toEqual({ optionId: 'a', yes: 2, maybe: 0, no: 1 });
		expect(tallyOf(poll(), 'b')).toEqual({ optionId: 'b', yes: 2, maybe: 1, no: 0 });
		expect(tallyOf(poll({ tally: [{ optionId: 'a', yes: 9, maybe: 0, no: 0 }] }), 'a').yes).toBe(9);
	});
	it('picks the option with most yes, ties by maybe, none without a yes or with hidden results', () => {
		expect(bestOptionIds(poll())).toEqual(['b']); // a: 2 yes 0 maybe, b: 2 yes 1 maybe
		expect(bestOptionIds(poll({ votes: [] }))).toEqual([]);
		expect(bestOptionIds(poll({ resultsVisible: false, votes: undefined }))).toEqual([]);
		const tie = poll({ votes: [{ id: '1', name: 'A', answers: [{ optionId: 'a', answer: 'yes' }, { optionId: 'c', answer: 'yes' }], createdAt: '', updatedAt: '' }] });
		expect(bestOptionIds(tie).sort()).toEqual(['a', 'c']);
		const onlyMaybe = poll({ votes: [{ id: '1', name: 'A', answers: [{ optionId: 'a', answer: 'maybe' }], createdAt: '', updatedAt: '' }] });
		expect(bestOptionIds(onlyMaybe)).toEqual([]);
	});
});

describe('order helpers', () => {
	const entry = (id: string, item: string, note: string | null, priceCents: number | null) => ({ id, name: 'x', item, note, quantity: 1, priceCents, createdAt: '', updatedAt: '' });
	it('finds the entry behind an aggregated line regardless of case and spacing', () => {
		const order = { entries: [entry('1', 'Döner', null, 700), entry('2', 'Döner', 'ohne Zwiebeln', 700), entry('3', 'döner ', 'Ohne  Zwiebeln', 700)] } as Order;
		const line: AggregatedItem = { item: 'Döner', note: 'ohne Zwiebeln', priceCents: 700, quantity: 2, names: [] };
		expect(entryForAggregate(order, line)?.id).toBe('2');
		expect(entryForAggregate(order, { ...line, note: null })?.id).toBe('1');
		expect(entryForAggregate(order, { ...line, priceCents: 650 })).toBeUndefined();
	});
});

describe('link and deadline helpers', () => {
	it('builds absolute links and extracts tokens', () => {
		expect(groupUrl('/g/abc', 'https://timetrack.example.org')).toBe('https://timetrack.example.org/g/abc');
		expect(tokenOfPath('/g/abc')).toBe('abc');
	});
	it('converts deadlines between zone-local inputs and instants', () => {
		const iso = deadlineFromInput('2026-12-01T18:30', 'Europe/Berlin');
		expect(iso).toBe('2026-12-01T17:30:00.000Z');
		expect(deadlineInputValue(iso, 'Europe/Berlin')).toBe('2026-12-01T18:30');
		expect(deadlineFromInput('', 'Europe/Berlin')).toBeNull();
		expect(deadlineInputValue(null, 'Europe/Berlin')).toBe('');
	});
});

describe('edit secret memory (localStorage per link)', () => {
	beforeEach(() => localStorage.clear());
	it('starts empty and persists name, secrets and answers per token', () => {
		expect(loadMemory('t1')).toEqual({ votes: {}, entries: {}, answers: {} });
		updateMemory('t1', (m) => {
			m.name = 'Anna';
			m.votes.v1 = 's1';
			m.answers.v1 = [{ optionId: 'a', answer: 'yes' }];
		});
		updateMemory('t2', (m) => (m.entries.e1 = 's2'));
		expect(loadMemory('t1')).toMatchObject({ name: 'Anna', votes: { v1: 's1' } });
		expect(loadMemory('t2').entries).toEqual({ e1: 's2' });
		expect(loadMemory('t2').votes).toEqual({});
		expect(JSON.parse(localStorage.getItem('tt-groups:t1')!).votes.v1).toBe('s1');
	});
	it('clears one link without touching others', () => {
		saveMemory('a', { name: 'x', votes: {}, entries: {}, answers: {} });
		saveMemory('b', { name: 'y', votes: {}, entries: {}, answers: {} });
		clearMemory('a');
		expect(loadMemory('a').name).toBeUndefined();
		expect(loadMemory('b').name).toBe('y');
	});
	it('ignores corrupt storage content', () => {
		localStorage.setItem('tt-groups:bad', '{"votes": 5, "entries": ["x"], "name": 7}');
		expect(loadMemory('bad')).toEqual({ name: undefined, votes: {}, entries: {}, answers: {} });
		localStorage.setItem('tt-groups:junk', 'not json');
		expect(loadMemory('junk').votes).toEqual({});
	});
	it('falls back to memory when localStorage is blocked', () => {
		const original = Storage.prototype.setItem;
		Storage.prototype.setItem = () => {
			throw new Error('blocked');
		};
		try {
			saveMemory('blocked', { name: 'z', votes: { v: 's' }, entries: {}, answers: {} });
			expect(loadMemory('blocked').votes).toEqual({ v: 's' });
		} finally {
			Storage.prototype.setItem = original;
		}
	});
});
