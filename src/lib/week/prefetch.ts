import { addDays, isoWeekLabel } from '../time/dates';

/** Monday dates of the weeks next to `monday` that are worth warming: next first (the common direction), then previous. */
export function adjacentMondays(monday: string): string[] {
	return [addDays(monday, 7), addDays(monday, -7)];
}

export interface PrefetchOptions {
	/** runs the callback when the browser is idle; returns a cancel function */
	idle?: (run: () => void) => () => void;
	/** loads the data of one week (fills the shared read cache) */
	load: (monday: string, isoWeek: string) => Promise<unknown>;
}

const browserIdle = (run: () => void): (() => void) => {
	if (typeof requestIdleCallback === 'function') {
		const id = requestIdleCallback(run, { timeout: 2000 });
		return () => cancelIdleCallback(id);
	}
	const id = setTimeout(run, 200);
	return () => clearTimeout(id);
};

/**
 * Warms the adjacent weeks one after the other once the browser is idle (low priority, at most one request group in
 * flight). The returned function cancels everything that has not started yet; call it on navigation. Failures are ignored.
 */
export function prefetchAdjacentWeeks(monday: string, options: PrefetchOptions): () => void {
	const idle = options.idle ?? browserIdle;
	let cancelled = false;
	let cancelIdle: (() => void) | null = null;
	const queue = adjacentMondays(monday);
	const next = () => {
		if (cancelled) return;
		const target = queue.shift();
		if (!target) return;
		cancelIdle = idle(() => {
			if (cancelled) return;
			void options.load(target, isoWeekLabel(target)).then(next, next);
		});
	};
	next();
	return () => {
		cancelled = true;
		cancelIdle?.();
	};
}
