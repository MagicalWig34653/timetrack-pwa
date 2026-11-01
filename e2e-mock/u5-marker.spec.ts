import AxeBuilder from '@axe-core/playwright';
import { type Page } from '@playwright/test';
import { expect, test } from './test';
import { loginAsAdmin } from './helpers';

// U5: every absence kind and status stays visibly marked in the month grid, the phone month and the year view, also
// when the row only has room for one pill (1280x640) and the day carries a holiday next to the absence. Dates in 2037.
test.describe.configure({ mode: 'serial' });

const SEEDS = [
	{ kind: 'vacation', status: 'approved', date: '2037-10-03' }, // Saturday with a holiday: two pills on one day
	{ kind: 'vacation', status: 'planned', date: '2037-10-05' },
	{ kind: 'vacation', status: 'requested', date: '2037-10-06' },
	{ kind: 'vacation', status: 'taken', date: '2037-10-07' },
	{ kind: 'sick', status: 'recorded', date: '2037-10-08' },
	{ kind: 'excused', status: 'recorded', date: '2037-10-09' },
	{ kind: 'other', status: 'recorded', date: '2037-10-12' }
] as const;

const tile = (page: Page, date: string) => page.locator(`[data-testid="month-grid"] [data-date="${date}"]`);

async function seed(page: Page) {
	const csrf = (await (await page.request.get('/api/v1/auth/session')).json()).csrfToken;
	for (const s of SEEDS) {
		const r = await page.request.post('/api/v1/absences', { data: { kind: s.kind, status: s.status, startDate: s.date, endDate: s.date }, headers: { 'X-CSRF-Token': csrf } });
		expect(r.status(), `${s.kind}/${s.status}`).toBe(201);
	}
}

async function expectVisibleChip(page: Page, date: string, chip: string, status?: string) {
	const el = tile(page, date).locator(status ? `[data-chip="${chip}"][data-status="${status}"]` : `[data-chip="${chip}"]`).first();
	await expect(el, `${date} ${chip}`).toBeVisible();
	const box = (await el.boundingBox())!;
	expect(box.width, `${date} ${chip} width`).toBeGreaterThan(20);
	expect(box.height, `${date} ${chip} height`).toBeGreaterThanOrEqual(16);
	// inside its cell (not clipped away)
	const cell = (await tile(page, date).boundingBox())!;
	expect(box.y + box.height).toBeLessThanOrEqual(cell.y + cell.height + 1);
}

for (const [scheme, viewport] of [
	['light', { width: 1280, height: 640 }],
	['dark', { width: 1280, height: 640 }],
	['light', { width: 1440, height: 900 }]
] as const) {
	test(`month grid marks every absence kind and status (${scheme} ${viewport.width}x${viewport.height})`, async ({ browser }) => {
		const { page, context } = await loginAsAdmin(browser, { viewport, colorScheme: scheme });
		if (scheme === 'light' && viewport.height === 640) await seed(page);
		await page.goto('/calendar?date=2037-10-12');
		await expect(page.getByTestId('month-grid')).toBeVisible();
		for (const s of SEEDS) await expectVisibleChip(page, s.date, 'absence', s.status);
		// the holiday shares the day with the vacation: the absence stays, the rest is counted in the corner
		await expect(tile(page, '2037-10-03').getByTestId('pill-more').or(tile(page, '2037-10-03').locator('[data-chip="holiday"]'))).toBeVisible();
		const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag412']).analyze();
		expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
		await context.close();
	});
}

test('phone month shows a dot per absence and the year view colours the days', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 390, height: 844 } });
	await page.goto('/calendar?date=2037-10-12');
	for (const s of SEEDS) {
		const dot = page.locator(`[data-phone-cell][data-date="${s.date}"] [data-dot="${s.kind}"]`);
		await expect(dot, `${s.date} dot`).toBeVisible();
		expect((await dot.boundingBox())!.width).toBeGreaterThan(3);
	}
	await context.close();
	const desktop = await loginAsAdmin(browser, { viewport: { width: 1440, height: 900 } });
	await desktop.page.goto('/calendar?date=2037-10-12');
	await desktop.page.getByTestId('view-year').click();
	await expect(desktop.page.getByTestId('year-overview')).toBeVisible();
	const bg = (date: string) => desktop.page.locator(`[data-testid="year-overview"] [data-date="${date}"]`).evaluate((e) => `${getComputedStyle(e).backgroundColor}|${getComputedStyle(e).boxShadow}`);
	// the absences arrive after the grid renders: wait until the first seeded day is coloured
	await expect.poll(() => bg(SEEDS[1].date)).not.toBe(await bg('2037-10-13'));
	const plain = await bg('2037-10-13');
	for (const s of SEEDS) expect(await bg(s.date), `year ${s.date}`).not.toBe(plain);
	await desktop.context.close();
});
