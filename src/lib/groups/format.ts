import type { AggregatedItem, Order, OrderEntry, Poll, PollAnswerValue, PollOption, PollTally, PollVote } from '../api/types';
import { formatDateShort, fromLocalInputValue, toLocalInputValue } from '../time/dates';

const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

/** "7,50 €" */
export function formatCents(cents: number): string {
	return euro.format(cents / 100);
}

/**
 * Parses a price typed by the user ("7,5", "7.50", "12", "€ 3,20") into cents.
 * "" -> null (no price); invalid input or values outside 0 to 10 000 EUR -> undefined.
 */
export function parsePrice(input: string): number | null | undefined {
	const text = input.replace(/[€\s]/g, '').replace(',', '.');
	if (text === '') return null;
	if (!/^\d{1,7}(\.\d{1,2})?$/.test(text)) return undefined;
	const cents = Math.round(Number(text) * 100);
	return cents >= 0 && cents <= 1_000_000 ? cents : undefined;
}

/** Cents as the text of a price input: 750 -> "7,50". */
export function priceInputValue(cents: number | null | undefined): string {
	return cents === null || cents === undefined ? '' : (cents / 100).toFixed(2).replace('.', ',');
}

/** Short heading of a poll option: text label, or "Do., 12.11." plus the optional label. */
export function optionTitle(option: PollOption): string {
	if (option.date) return option.label ? `${formatDateShort(option.date)} ${option.label}` : formatDateShort(option.date);
	return option.label ?? '';
}

/** Time range of a date option ("18:00 bis 20:00" / "ab 18:00"); empty without a start time. */
export function optionTime(option: PollOption): string {
	if (!option.startTime) return '';
	return option.endTime ? `${option.startTime}–${option.endTime}` : option.startTime;
}

export function answerOf(vote: PollVote, optionId: string): PollAnswerValue {
	return vote.answers.find((a) => a.optionId === optionId)?.answer ?? 'no';
}

/** Tally of an option: the server's `tally`, or counted from the visible votes. */
export function tallyOf(poll: Poll, optionId: string): PollTally {
	const given = poll.tally?.find((entry) => entry.optionId === optionId);
	if (given) return given;
	const result: PollTally = { optionId, yes: 0, maybe: 0, no: 0 };
	for (const vote of poll.votes ?? []) result[answerOf(vote, optionId)] += 1;
	return result;
}

/** Options with the most "yes" answers, ties broken by "maybe". Empty while nobody said yes. */
export function bestOptionIds(poll: Poll): string[] {
	if (!poll.resultsVisible) return [];
	const scored = poll.options.map((option) => ({ id: option.id, tally: tallyOf(poll, option.id) }));
	const top = scored.reduce((best, entry) => (entry.tally.yes > best.yes || (entry.tally.yes === best.yes && entry.tally.maybe > best.maybe) ? entry.tally : best), { yes: 0, maybe: 0 } as { yes: number; maybe: number });
	if (top.yes === 0) return [];
	return scored.filter((entry) => entry.tally.yes === top.yes && entry.tally.maybe === top.maybe).map((entry) => entry.id);
}

const normalize = (value: string | null | undefined) => (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** An entry that belongs to an aggregated line (same dish, note and price as the server groups them); the source of "Übernehmen". */
export function entryForAggregate(order: Order, line: AggregatedItem): OrderEntry | undefined {
	return order.entries.find(
		(entry) => normalize(entry.item) === normalize(line.item) && normalize(entry.note) === normalize(line.note) && (entry.priceCents ?? null) === (line.priceCents ?? null)
	);
}

/** Absolute address of a group page from the `path` the API returns (`/g/<token>`). */
export function groupUrl(path: string, origin = typeof location === 'undefined' ? 'https://timetrack.example.org' : location.origin): string {
	return origin + path;
}

/** The token of a `/g/<token>` path. */
export function tokenOfPath(path: string): string {
	return path.replace(/^\/g\//, '');
}

/** Deadline instant -> value of a datetime-local input in the given zone; '' without deadline. */
export function deadlineInputValue(deadline: string | null | undefined, zone: string): string {
	return deadline ? toLocalInputValue(deadline, zone) : '';
}

/** Value of a datetime-local input -> ISO instant; null for empty or invalid input. */
export function deadlineFromInput(value: string, zone: string): string | null {
	const date = fromLocalInputValue(value, zone);
	return date ? date.toISOString() : null;
}

/** True when the IANA zone name is known to this browser. */
export function isKnownZone(zone: string): boolean {
	try {
		new Intl.DateTimeFormat('de-DE', { timeZone: zone });
		return true;
	} catch {
		return false;
	}
}
