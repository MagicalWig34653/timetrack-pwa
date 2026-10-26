import { type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './test';
import { loginAsAdmin } from './helpers';

// N3: vacation (planned, requested, approved) as entries on the days of the week overview.
test.describe.configure({ mode: 'serial' });
const dir = process.env.SCREENSHOT_DIR;

async function post(page: Page, data: unknown) {
	const session = await (await page.request.get('/api/v1/auth/session')).json();
	const response = await page.request.fetch('/api/v1/absences', { method: 'POST', data, headers: { 'X-CSRF-Token': session.csrfToken } });
	expect(response.status()).toBeLessThan(300);
}

// 2035-W10: Monday 2035-03-05
async function seed(page: Page) {
	await post(page, { kind: 'vacation', startDate: '2035-03-05', endDate: '2035-03-06', status: 'planned' });
	await post(page, { kind: 'vacation', startDate: '2035-03-07', endDate: '2035-03-07', status: 'requested', halfDayStart: true });
	await post(page, { kind: 'vacation', startDate: '2035-03-08', endDate: '2035-03-08', status: 'approved' });
	await post(page, { kind: 'vacation', startDate: '2035-03-09', endDate: '2035-03-09', status: 'cancelled' });
}

test('week: vacation chips per day, none on free days or for cancelled, not counted as work', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await seed(page);
	// a planned range over the weekend: the free days must not get a chip
	await post(page, { kind: 'vacation', startDate: '2035-03-10', endDate: '2035-03-11', status: 'planned' });
	await page.goto('/week?week=2035-W10');
	await expect(page.getByTestId('week-overview')).toBeVisible();
	const tip = (date: string) => page.getByTestId(`week-day-${date}`).getByTestId('day-vacation-tip');
	// icon only on the card (no visible label), full wording in the tooltip
	await expect(page.getByTestId('week-day-2035-03-05').getByTestId('day-vacation')).toHaveAttribute('data-status', 'planned');
	await expect(tip('2035-03-05')).toHaveText('Urlaub – geplant, noch nicht beantragt');
	await expect(tip('2035-03-06')).toHaveText('Urlaub – geplant, noch nicht beantragt');
	await expect(tip('2035-03-07')).toHaveText('Urlaub (halber Tag) – beantragt, noch nicht genehmigt');
	await expect(page.getByTestId('week-day-2035-03-07').getByTestId('day-vacation')).toHaveAttribute('data-half', 'true');
	await expect(tip('2035-03-08')).toHaveText('Urlaub – genehmigt');
	// the tooltip shows on hover and on keyboard focus of the card
	await expect(tip('2035-03-05')).toBeHidden();
	await page.getByTestId('week-day-2035-03-05').getByTestId('day-vacation').hover();
	await expect(tip('2035-03-05')).toBeVisible();
	await page.mouse.move(0, 0);
	await page.keyboard.press('Tab');
	await page.getByTestId('week-day-2035-03-06').focus();
	await page.keyboard.press('Shift+Tab');
	await page.keyboard.press('Tab');
	await expect(tip('2035-03-06')).toBeVisible();
	await expect(page.getByTestId('week-day-2035-03-09').getByTestId('day-vacation')).toHaveCount(0);
	await expect(page.getByTestId('week-day-2035-03-10').getByTestId('day-vacation')).toHaveCount(0);
	await expect(page.getByTestId('week-day-2035-03-11').getByTestId('day-vacation')).toHaveCount(0);
	// no second chip for the same vacation, no broken warning text
	await expect(page.getByTestId('week-day-2035-03-05').getByTestId('day-absence')).toHaveCount(0);
	await expect(page.getByTestId('week-days')).not.toContainText(': noch');
	await expect(page.getByTestId('week-day-2035-03-05')).toHaveAttribute('aria-label', /Urlaub – geplant, noch nicht beantragt/);
	// worked time stays zero
	await expect(page.getByTestId('week-actual')).toContainText('0:00');

	await page.getByTestId('week-day-2035-03-06').click();
	const panel = page.getByTestId('week-day-panel');
	await expect(panel.getByTestId('panel-absence')).toContainText('Geplant');
	await panel.getByTestId('panel-absence-link').click();
	await expect(page).toHaveURL(/\/absences\?year=2035/);
	await context.close();
});

test('week: axe on the week with vacation chips and screenshots', async ({ browser }) => {
	test.setTimeout(120_000);
	for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 900 }]] as const) {
		for (const scheme of ['light', 'dark'] as const) {
			const { page, context } = await loginAsAdmin(browser, { viewport, colorScheme: scheme });
			await page.goto('/week?week=2035-W10&day=2035-03-07');
			await expect(page.getByTestId('week-day-panel')).toBeVisible();
			await expect(page.getByTestId('day-detail')).toBeVisible();
			const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).disableRules(['label-content-name-mismatch']).analyze();
			expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' | ')}`)).toEqual([]);
			if (dir) await page.screenshot({ path: `${dir}/n3-week-vacation-${name}-${scheme}.png`, fullPage: true });
			await context.close();
		}
	}
});
