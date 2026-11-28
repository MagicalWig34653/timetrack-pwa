import { expect, test } from './test';
import { loginAsAdmin } from './helpers';

// W3: week switching stays fast with 150 ms latency per API request (prefetch, shared cache, stale-while-revalidate).
const LATENCY_MS = 150;

test('week switch: no blank state, adjacent weeks prefetched, static data not refetched', async ({ browser }) => {
	const { page } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	const requests: string[] = [];
	await page.route('**/api/v1/**', async (route) => {
		const url = new URL(route.request().url());
		if (route.request().method() === 'GET' && url.pathname !== '/api/v1/auth/session') {
			requests.push(url.pathname + url.search);
			await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
		}
		await route.continue();
	});

	await page.goto('/week');
	await expect(page.getByTestId('week-overview')).toBeVisible();
	const first = await page.getByTestId('week-overview').getAttribute('data-week');
	// let the idle prefetch of the neighbours finish
	await expect.poll(() => requests.filter((r) => r.startsWith('/api/v1/time/weeks/')).length, { timeout: 10_000 }).toBeGreaterThanOrEqual(3);
	await page.waitForTimeout(800);

	// a skeleton or empty page must never appear while switching
	let sawSkeleton = false;
	await page.exposeFunction('markSkeleton', () => (sawSkeleton = true));
	await page.evaluate(() => {
		new MutationObserver(() => {
			if (!document.querySelector('[data-testid=week-overview]')) (window as unknown as { markSkeleton: () => void }).markSkeleton();
		}).observe(document.body, { childList: true, subtree: true });
	});

	requests.length = 0;
	const started = Date.now();
	await page.getByTestId('week-next').click();
	await expect(page.getByTestId('week-overview')).not.toHaveAttribute('data-week', first!);
	const elapsed = Date.now() - started;
	expect(elapsed, 'prefetched week appears without a request round trip').toBeLessThan(LATENCY_MS * 2);
	expect(sawSkeleton).toBe(false);
	await page.waitForTimeout(1500);
	const log = requests.join('\n');
	expect(requests.filter((r) => r.startsWith('/api/v1/time/weeks/')).length, log).toBeLessThanOrEqual(1); // only the new neighbour
	expect(requests.filter((r) => r.includes('/calendar/holidays')).length, log).toBe(0);
	expect(requests.filter((r) => r.startsWith('/api/v1/places')).length, log).toBe(0);
	expect(requests.filter((r) => r.startsWith('/api/v1/work-models')).length, log).toBe(0);
	expect(requests.length, log).toBeLessThanOrEqual(8);
});

test('week switch to an unfetched week keeps the previous week visible and dimmed', async ({ browser }) => {
	const { page } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	const weeks: string[] = [];
	page.on('requestfinished', (r) => { if (r.url().includes('/api/v1/time/weeks/')) weeks.push(r.url()); });
	await page.goto('/week');
	const overview = page.getByTestId('week-overview');
	await expect(overview).toBeVisible();
	const first = await overview.getAttribute('data-week');
	// shown week plus both prefetched neighbours: the first step back is then answered from the cache
	await expect.poll(() => weeks.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(3);
	// hold every further week request until released: the week two steps back stays unfetched, however slow the machine is
	let release!: () => void;
	const released = new Promise<void>((resolve) => (release = resolve));
	await page.route('**/api/v1/time/weeks/**', async (route) => {
		await released;
		await route.continue();
	});
	const prev = page.getByTestId('week-nav').getByTestId('week-prev');
	await prev.click();
	// the link's href follows the URL: only click again once the first step is on screen, else both clicks go one week back
	await expect(overview).not.toHaveAttribute('data-week', first!);
	const second = await overview.getAttribute('data-week');
	await prev.click();
	await expect(overview).toHaveAttribute('aria-busy', 'true');
	await expect(overview).toHaveAttribute('data-week', second!);
	await expect(page.getByTestId('week-skeleton')).toHaveCount(0);
	release();
	await expect(overview).not.toHaveAttribute('data-week', second!, { timeout: 10_000 });
	await expect(overview).toHaveAttribute('aria-busy', 'false');
});
