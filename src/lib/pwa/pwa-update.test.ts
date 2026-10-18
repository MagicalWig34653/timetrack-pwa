import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APPLIED_KEY, HARD_RESET_KEY } from './update-policy';
import { CONTROLLER_TIMEOUT_MS, pwa } from './pwa.svelte';

type Internals = {
	registration: unknown;
	waitingWorker: boolean;
	reloading: boolean;
	reloadStarted: boolean;
};
const internals = pwa as unknown as Internals;

describe('PwaState update flow', () => {
	const reload = vi.fn();
	const unregister = vi.fn(async () => true);
	const deleteCache = vi.fn(async () => true);
	const postMessage = vi.fn();

	function stubInfo(revision: string | null) {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => (revision === null ? new Response('nope', { status: 404 }) : new Response(JSON.stringify({ pwa: { revision } }), { status: 200 })))
		);
	}

	beforeEach(() => {
		vi.useFakeTimers();
		localStorage.clear();
		reload.mockClear();
		unregister.mockClear();
		deleteCache.mockClear();
		postMessage.mockClear();
		vi.stubGlobal('location', { ...window.location, reload });
		vi.stubGlobal('caches', { keys: async () => ['a', 'b'], delete: deleteCache });
		Object.defineProperty(navigator, 'serviceWorker', {
			configurable: true,
			value: { getRegistrations: async () => [{ unregister }] }
		});
		internals.registration = { waiting: { postMessage } };
		internals.waitingWorker = true;
		internals.reloading = false;
		internals.reloadStarted = false;
		pwa.updateReady = false;
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('hides the banner when the server revision equals the running bundle', async () => {
		stubInfo(__APP_REVISION__);
		await pwa.evaluateUpdate();
		expect(pwa.updateReady).toBe(false);
	});

	it('shows the banner when the server revision differs', async () => {
		stubInfo('f'.repeat(40));
		await pwa.evaluateUpdate();
		expect(pwa.updateReady).toBe(true);
	});

	it('falls back to the suppression window when system/info is unavailable', async () => {
		stubInfo(null);
		await pwa.evaluateUpdate();
		expect(pwa.updateReady).toBe(true);
		localStorage.setItem(APPLIED_KEY, String(Date.now()));
		await pwa.evaluateUpdate();
		expect(pwa.updateReady).toBe(false);
	});

	it('records the attempt, hides the banner and posts SKIP_WAITING', () => {
		pwa.updateReady = true;
		pwa.applyUpdate();
		expect(pwa.updateReady).toBe(false);
		expect(localStorage.getItem(APPLIED_KEY)).not.toBeNull();
		expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
		expect(reload).not.toHaveBeenCalled();
	});

	it('unregisters, clears caches and reloads once when the controller does not change', async () => {
		pwa.applyUpdate();
		await vi.advanceTimersByTimeAsync(CONTROLLER_TIMEOUT_MS + 10);
		expect(unregister).toHaveBeenCalledTimes(1);
		expect(deleteCache).toHaveBeenCalledTimes(2);
		expect(reload).toHaveBeenCalledTimes(1);
		expect(localStorage.getItem(HARD_RESET_KEY)).not.toBeNull();
	});

	it('does not repeat the hard reset within a minute: plain reload only', async () => {
		localStorage.setItem(HARD_RESET_KEY, String(Date.now()));
		pwa.applyUpdate();
		await vi.advanceTimersByTimeAsync(CONTROLLER_TIMEOUT_MS + 10);
		expect(unregister).not.toHaveBeenCalled();
		expect(reload).toHaveBeenCalledTimes(1);
	});

	it('hard-resets immediately when posting the message throws', async () => {
		postMessage.mockImplementationOnce(() => {
			throw new Error('dead worker');
		});
		pwa.applyUpdate();
		await vi.advanceTimersByTimeAsync(1);
		expect(unregister).toHaveBeenCalledTimes(1);
		expect(reload).toHaveBeenCalledTimes(1);
	});
});
