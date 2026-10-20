/** Minimal shape of a menu entry for keyboard navigation. */
export interface NavEntry {
	label?: string;
	disabled?: boolean;
	separator?: boolean;
}

const selectable = (entry: NavEntry) => !entry.separator && !entry.disabled;

export type NavMove = 'next' | 'prev' | 'first' | 'last';

/** Index of the entry reached by an arrow/Home/End key; skips separators and disabled entries, wraps around. -1 when nothing is selectable. */
export function navigate(entries: NavEntry[], current: number, move: NavMove): number {
	const n = entries.length;
	if (!entries.some(selectable)) return -1;
	if (move === 'first') return entries.findIndex(selectable);
	if (move === 'last') return n - 1 - [...entries].reverse().findIndex(selectable);
	if (current < 0) return navigate(entries, 0, move === 'next' ? 'first' : 'last');
	const step = move === 'next' ? 1 : -1;
	let index = current;
	for (let i = 0; i < n; i++) {
		index = (((index + step) % n) + n) % n;
		if (selectable(entries[index])) return index;
	}
	return -1;
}

/**
 * Typeahead: a buffer of typed characters selects the next entry whose label starts with it. Repeating one
 * character cycles through the entries starting with it. Returns -1 when nothing matches.
 */
export function typeahead(entries: NavEntry[], buffer: string, current: number): number {
	const needle = buffer.toLocaleLowerCase('de');
	if (!needle) return -1;
	const cycle = needle.length > 1 && [...needle].every((c) => c === needle[0]);
	const prefix = cycle ? needle[0] : needle;
	const n = entries.length;
	// A growing prefix may still match the current entry; a repeated letter moves on.
	const start = cycle || needle.length === 1 ? current + 1 : Math.max(current, 0);
	for (let i = 0; i < n; i++) {
		const index = (((start + i) % n) + n) % n;
		const entry = entries[index];
		if (selectable(entry) && (entry.label ?? '').toLocaleLowerCase('de').startsWith(prefix)) return index;
	}
	return -1;
}
