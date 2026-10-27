import { describe, expect, it, vi } from 'vitest';
import { adjacentMondays, prefetchAdjacentWeeks } from './prefetch';

describe('prefetchAdjacentWeeks', () => {
	it('names next then previous week', () => {
		expect(adjacentMondays('2026-10-26')).toEqual(['2026-11-02', '2026-10-19']);
	});

	it('loads next and previous sequentially when idle', async () => {
		const pending: Array<() => void> = [];
		const load = vi.fn(() => Promise.resolve());
		prefetchAdjacentWeeks('2026-10-26', { idle: (run) => (pending.push(run), () => {}), load });
		expect(load).not.toHaveBeenCalled();
		pending.shift()!();
		await Promise.resolve();
		await Promise.resolve();
		expect(load).toHaveBeenLastCalledWith('2026-11-02', '2026-W45');
		pending.shift()!();
		expect(load).toHaveBeenLastCalledWith('2026-10-19', '2026-W43');
	});

	it('cancel stops work that has not started and swallows failures', async () => {
		const pending: Array<() => void> = [];
		const cancelIdle = vi.fn();
		const load = vi.fn(() => Promise.reject(new Error('x')));
		const cancel = prefetchAdjacentWeeks('2026-10-26', { idle: (run) => (pending.push(run), cancelIdle), load });
		pending.shift()!();
		await new Promise((r) => setTimeout(r, 0));
		expect(pending.length).toBe(1); // continues after a failure
		cancel();
		expect(cancelIdle).toHaveBeenCalled();
		pending.shift()!();
		expect(load).toHaveBeenCalledTimes(1);
	});
});
