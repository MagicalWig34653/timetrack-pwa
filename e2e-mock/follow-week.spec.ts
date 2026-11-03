import type { Page } from '@playwright/test';
import { expect, test } from './test';
import { loginAsAdmin, pinClock, unpinClock } from './helpers';
import type { PlanWeek } from '../src/lib/api/types';

async function call(page: Page, method: string, path: string, body?: unknown) {
	const session = await (await page.request.get('/api/v1/auth/session')).json();
	const response = await page.request.fetch(`/api/v1${path}`, { method, data: body, headers: { 'X-CSRF-Token': session.csrfToken } });
	expect(response.status(), `${method} ${path}`).toBeLessThan(300);
	return response;
}

for (const overwrite of [false, true]) {
	test(`follow weeks preserves marked targets (overwrite=${overwrite})`, async ({ browser, request }) => {
		const reset = await request.post('/__test/reset');
		expect(reset.status()).toBe(204);
		const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1440, height: 1100 } });
		await pinClock(page);
		try {
			// Fixed weeks keep the copy independent of today's date and time. Each test replaces its own plans.
			await call(page, 'PUT', '/plan/weeks/2033-W30', {
				replace: true,
				days: Array.from({ length: 5 }, (_, i) => ({ date: `2033-07-${25 + i}`, mode: 'office', blocks: [{ start: '08:00', end: '12:00', kind: 'office' }] }))
			});
			await call(page, 'POST', '/calendar/custom-days', { kind: 'holiday', startDate: '2033-08-01', endDate: '2033-08-01', name: 'Testfeiertag' });
			for (const [i, kind] of ['vacation', 'sick', 'excused'].entries()) {
				const date = `2033-08-0${i + 2}`;
				await call(page, 'POST', '/absences', { kind, startDate: date, endDate: date, status: kind === 'vacation' ? 'approved' : 'recorded' });
			}
			await call(page, 'PUT', '/plan/weeks/2033-W31', {
				replace: true,
				days: [2, 4, 5].map((d) => ({ date: `2033-08-0${d}`, mode: 'home', note: 'Keep existing plan', blocks: [{ start: '13:00', end: '15:00', kind: 'home' }] }))
			});
			const before: PlanWeek = await (await call(page, 'GET', '/plan/weeks/2033-W31')).json();
			expect(before.days.slice(0, 4).map((d) => d.blockedBy)).toEqual(['holiday', 'vacation', 'sick', 'excused']);
			await page.goto('/plan?week=2033-W30&view=grid');
			await expect(page.getByTestId('week-grid')).toBeVisible();
			const writes: { replace: boolean; days: { date: string }[] }[] = [];
			page.on('request', (request) => {
				if (request.method() === 'PUT' && request.url().endsWith('/plan/weeks/2033-W31')) writes.push(request.postDataJSON());
			});
			await page.getByTestId('plan-follow').click();
			await page.getByTestId('follow-weeks').fill('1');
			if (overwrite) await page.getByTestId('follow-overwrite').click();
			await page.getByTestId('follow-submit').click();
			await expect(page.getByTestId('follow-dialog')).toHaveCount(0);
			expect(writes).toEqual(overwrite ? [expect.objectContaining({ replace: false, days: [expect.objectContaining({ date: '2033-08-05' })] })] : []);
			const after: PlanWeek = await (await call(page, 'GET', '/plan/weeks/2033-W31')).json();
			expect(after.days.slice(0, 4)).toEqual(before.days.slice(0, 4));
			expect(after.days[4].plan?.mode).toBe(overwrite ? 'office' : 'home');
			expect(after.days.slice(5)).toEqual(before.days.slice(5));
		} finally {
			await unpinClock(page);
			await context.close();
		}
	});
}
