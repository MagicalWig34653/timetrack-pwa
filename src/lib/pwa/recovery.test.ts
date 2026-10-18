// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The self-healing bootstrap lives inline in src/app.html (it must run before any bundle). The tests extract that exact
// script and run it in jsdom, so the shipped code is what is verified.
const html = readFileSync(resolve(process.cwd(), 'src/app.html'), 'utf8');
const source = /<script id="tt-recovery">([\s\S]*?)<\/script>/.exec(html)?.[1];

type Api = { isLoadFailure(t: unknown): boolean; isAppAsset(u: unknown): boolean; decide(now: number, last: unknown): string; WINDOW_MS: number; KEY: string };
const api = () => (window as unknown as { __ttRecovery: Api }).__ttRecovery;

// Runs the shipped script; listeners of earlier runs are removed so each test sees exactly one instance.
const registered: [string, EventListenerOrEventListenerObject, boolean | AddEventListenerOptions | undefined][] = [];
function load() {
	for (const [type, fn, opts] of registered.splice(0)) window.removeEventListener(type, fn, opts);
	const original = window.addEventListener.bind(window);
	window.addEventListener = ((type: string, fn: EventListenerOrEventListenerObject, opts?: boolean | AddEventListenerOptions) => {
		registered.push([type, fn, opts]);
		original(type, fn, opts);
	}) as typeof window.addEventListener;
	try {
		window.eval(source!);
	} finally {
		window.addEventListener = original;
	}
}

describe('recovery bootstrap: pure logic', () => {
	beforeEach(() => {
		delete (window as unknown as { __ttRecovery?: Api }).__ttRecovery;
		load();
	});

	it('is present in app.html', () => expect(source).toBeTruthy());

	it('recognises asset/chunk load failures and nothing else', () => {
		for (const m of [
			"TypeError: 'text/html' is not a valid JavaScript MIME type for module script 'https://x/_app/immutable/entry/app.1.js'",
			'Failed to fetch dynamically imported module: https://x/_app/immutable/nodes/3.js',
			'error loading dynamically imported module',
			'Importing a module script failed.',
			'Unable to preload CSS for /_app/immutable/assets/0.css'
		])
			expect(api().isLoadFailure(m), m).toBe(true);
		for (const m of ['TypeError: x is undefined', 'Network request failed', '', undefined, null, 42]) expect(api().isLoadFailure(m), String(m)).toBe(false);
	});

	it('only treats /_app/ URLs as app assets', () => {
		expect(api().isAppAsset('https://x.example/_app/immutable/entry/app.1.js')).toBe(true);
		expect(api().isAppAsset('/_app/version.json?x=1')).toBe(true);
		expect(api().isAppAsset('https://x.example/other/app.js')).toBe(false);
		expect(api().isAppAsset(undefined)).toBe(false);
	});

	it('allows one recovery per five minutes', () => {
		const now = 1_000_000_000_000;
		const { decide, WINDOW_MS } = api();
		expect(decide(now, null)).toBe('recover');
		expect(decide(now, 'garbage')).toBe('recover');
		expect(decide(now, String(now - 1000))).toBe('fallback');
		expect(decide(now, String(now - WINDOW_MS + 1))).toBe('fallback');
		expect(decide(now, String(now - WINDOW_MS))).toBe('recover');
		expect(decide(now, String(now + 60_000))).toBe('fallback'); // clock skew never loops
	});
});

describe('recovery bootstrap: event handling', () => {
	beforeEach(() => {
		localStorage.clear();
		document.getElementById('tt-recovery-fallback')?.remove();
	});

	const rejection = (message: string) => {
		const event = new Event('unhandledrejection') as Event & { reason: unknown };
		event.reason = new TypeError(message);
		return event;
	};

	it('shows the German fallback instead of recovering again within the window', () => {
		localStorage.setItem('tt.recovery', String(Date.now() - 1000));
		load();
		window.dispatchEvent(rejection('Failed to fetch dynamically imported module: /_app/x.js'));
		const box = document.getElementById('tt-recovery-fallback')!;
		expect(box.textContent).toContain('Die Anwendung konnte nicht geladen werden. Es läuft gerade ein Update. Bitte in einigen Sekunden neu laden.');
		expect(box.querySelector('button')?.textContent).toBe('Neu laden');
	});

	it('ignores unrelated errors', () => {
		load();
		window.dispatchEvent(rejection('something else'));
		expect(document.getElementById('tt-recovery-fallback')).toBeNull();
		expect(localStorage.getItem('tt.recovery')).toBeNull();
	});

	it('first matching failure records the attempt and cleans service workers and caches', async () => {
		const unregister = vi.fn().mockResolvedValue(true);
		const del = vi.fn().mockResolvedValue(true);
		Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistrations: () => Promise.resolve([{ unregister }, { unregister }]) } });
		Object.defineProperty(window, 'caches', { configurable: true, value: { keys: () => Promise.resolve(['a', 'b', 'c']), delete: del } });
		load();
		window.dispatchEvent(rejection("'text/html' is not a valid JavaScript MIME type for module script"));
		expect(localStorage.getItem('tt.recovery')).toMatch(/^\d+$/);
		await vi.waitFor(() => expect(del).toHaveBeenCalledTimes(3));
		expect(unregister).toHaveBeenCalledTimes(2);
		expect(document.getElementById('tt-recovery-fallback')).toBeNull();
	});
});
