import { expect, test } from './test';
import { loginAsAdmin } from './helpers';

test('planner: planned vacation is shown like a free day and the save bar stays visible', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 700 } });
	const session = await (await page.request.get('/api/v1/auth/session')).json();
	// 2034-W10: Monday 2034-03-06; planned (not submitted) vacation on Tuesday and Wednesday
	const response = await page.request.fetch('/api/v1/absences', {
		method: 'POST',
		data: { kind: 'vacation', startDate: '2034-03-07', endDate: '2034-03-08', status: 'planned' },
		headers: { 'X-CSRF-Token': session.csrfToken }
	});
	expect(response.status()).toBeLessThan(300);
	await page.goto('/plan?week=2034-W10&view=grid');
	await expect(page.getByTestId('week-grid')).toBeVisible();
	const chip = page.getByTestId('allday-2034-03-07').locator('[data-status="planned"], [data-testid^="blocked-chip"]');
	await expect(chip).toContainText('Urlaub');
	await expect(chip).toContainText('Geplant');
	// the save bar is inside the viewport without scrolling
	const box = await page.getByTestId('plan-save').boundingBox();
	expect(box && box.y + box.height <= 700).toBe(true);
	await page.mouse.wheel(0, 2000);
	const after = await page.getByTestId('plan-save').boundingBox();
	expect(after && after.y + after.height <= 700).toBe(true);
	await context.close();
});
