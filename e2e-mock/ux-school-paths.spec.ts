import { type Page } from '@playwright/test';
import { expect, test } from './test';
import { loginAsAdmin } from './helpers';

// UX analysis "Schulzeit buchen" (docs/ux/schulzeit.md, 26.11.2026): plays every way a user can record a school day in the PWA,
// one weekday each in a past week without seeded data, and pins what the evaluation makes of it. Screenshots for the document
// are written only when SCREENSHOT_DIR is set. The assertions describe the CURRENT behaviour the analysis is based on.
test.describe.configure({ mode: 'serial' });

const berlinToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());
const addDays = (date: string, n: number) => {
	const [y, m, d] = date.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const mondayOf = (date: string) => {
	const [y, m, d] = date.split('-').map(Number);
	return addDays(date, 1 - (new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7));
};
/** UTC instant of a Berlin wall-clock time. */
const berlin = (date: string, hm: string) => {
	for (const offset of ['+01:00', '+02:00']) {
		const instant = new Date(`${date}T${hm}:00${offset}`);
		const local = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instant);
		if (local === hm) return instant.toISOString();
	}
	throw new Error(`no Berlin time ${date} ${hm}`);
};

async function call(page: Page, method: string, path: string, body?: unknown) {
	const session = await (await page.request.get('/api/v1/auth/session')).json();
	const response = await page.request.fetch(`/api/v1${path}`, { method, data: body, headers: { 'X-CSRF-Token': session.csrfToken } });
	expect(response.status(), `${method} ${path}`).toBeLessThan(300);
	return response.status() === 204 ? null : response.json();
}

const shot = async (page: Page, name: string, fullPage = false) => {
	if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/${name}.png`, fullPage });
};

const hm = (seconds: number) => `${seconds < 0 ? '-' : ''}${Math.floor(Math.abs(seconds) / 3600)}:${String(Math.floor((Math.abs(seconds) % 3600) / 60)).padStart(2, '0')}`;

test('five ways to record a school day and what the evaluation makes of them', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1440, height: 1000 } });
	// four weeks back: inside the seeded work model, outside the seeded segments and absences
	const monday = mondayOf(addDays(berlinToday(), -28));
	const day = (n: number) => addDays(monday, n);
	const week = { isoWeek: await isoWeek(page, monday) };
	const places = (await call(page, 'GET', '/places')) as { id: string; name: string; kind: string }[];
	const school = places.find((p) => p.kind === 'school')!;

	// A Monday: booked school time (timer or manual entry with kind "Schule"), 08:00-13:30
	await call(page, 'POST', '/time/segments', { kind: 'school', placeId: school.id, startedAt: berlin(day(0), '08:00'), endedAt: berlin(day(0), '13:30') });
	// B Tuesday: day mark "Schultag (Gutschrift)" without times
	await call(page, 'PUT', `/time/days/${day(1)}`, { mark: 'school_credit' });
	// C Wednesday: only planned as school in the week planner
	await call(page, 'PUT', `/plan/days/${day(2)}`, { mode: 'school', blocks: [{ start: '08:00', end: '13:30', kind: 'school' }] });
	// D Thursday: timer at the place "Berufsschule" but kind "Arbeit" (the default of the timer)
	await call(page, 'POST', '/time/segments', { kind: 'work', placeId: school.id, startedAt: berlin(day(3), '08:00'), endedAt: berlin(day(3), '13:30') });
	// E Friday: absence "Freistellung" in the calendar
	await call(page, 'POST', '/absences', { kind: 'excused', startDate: day(4), endDate: day(4), status: 'recorded' });

	const days = (await call(page, 'GET', `/time/days?from=${day(0)}&to=${day(4)}`)) as { date: string; mark?: string; targetSeconds: number; evaluatedWorkSeconds: number; creditSeconds: number; balanceSeconds?: number | null }[];
	const row = (n: number) => days.find((d) => d.date === day(n))!;
	const total = (d: { evaluatedWorkSeconds: number; creditSeconds: number }) => d.evaluatedWorkSeconds + d.creditSeconds;
	const table = [0, 1, 2, 3, 4].map((n) => {
		const d = row(n);
		return `${'ABCDE'[n]} ${d.date} mark=${d.mark ?? '-'} soll=${hm(d.targetSeconds)} booked=${hm(d.evaluatedWorkSeconds)} credit=${hm(d.creditSeconds)} diff=${hm(total(d) - d.targetSeconds)}`;
	});
	console.log(table.join('\n'));
	const weekBody = (await call(page, 'GET', `/time/weeks/${week.isoWeek}`)) as { days: { date: string; mark: string }[] };
	console.log(weekBody.days.map((d) => `${d.date} weekmark=${d.mark}`).join('\n'));

	// A: full school day, credited with the daily target
	expect(total(row(0))).toBe(row(0).targetSeconds);
	// B: credited as well, but without any times
	expect(total(row(1))).toBe(row(1).targetSeconds);
	// C: a plan books nothing
	expect(total(row(2))).toBe(0);
	expect(row(2).targetSeconds).toBeGreaterThan(0);
	// D: counted as ordinary work, below the target
	expect(total(row(3))).toBeLessThan(row(3).targetSeconds);
	// E: no target, no time
	expect(row(4).targetSeconds).toBe(0);

	await page.goto(`/week?week=${week.isoWeek}`);
	await expect(page.getByTestId('week-overview')).toBeVisible();
	await page.waitForTimeout(500);
	await shot(page, 'school-week-overview');
	for (const n of [0, 1, 2, 3]) {
		await page.goto(`/week?week=${week.isoWeek}&day=${day(n)}`);
		await page.waitForTimeout(700);
		await shot(page, `school-day-${'abcd'[n]}`, true);
	}
	await page.goto(`/plan?week=${week.isoWeek}&view=grid`);
	await expect(page.getByTestId('week-grid')).toBeVisible();
	await page.getByTestId('week-grid-scroll').evaluate((el) => (el.scrollTop = 0));
	await shot(page, 'school-planner');
	await page.goto('/');
	await page.waitForTimeout(700);
	await shot(page, 'school-timer');
	await context.close();
});

async function isoWeek(page: Page, date: string): Promise<string> {
	const [y, m, d] = date.split('-').map(Number);
	const t = new Date(Date.UTC(y, m - 1, d));
	const dayNum = t.getUTCDay() || 7;
	t.setUTCDate(t.getUTCDate() + 4 - dayNum);
	const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
	const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
	void page;
	return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
