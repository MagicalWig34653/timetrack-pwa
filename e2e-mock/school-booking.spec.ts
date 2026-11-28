import { type Page } from '@playwright/test';
import { expect, test } from './test';
import { loginAsAdmin } from './helpers';

// "Schulzeit: nur ein Buchungsweg" (docs/ux/schulzeit.md, card 218E0EBC, Lino 26.11.2026): "Schultag buchen" always books a
// segment of the kind "Schule"; a plan or the last school day only pre-fill the times, which stay editable. The mark
// "Schultag (Gutschrift)" is gone from the choice, old days keep it and ask for times. Screenshots (light/dark, phone/desktop)
// go to SCREENSHOT_DIR when it is set.
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
const isoWeek = (date: string) => {
	const [y, m, d] = date.split('-').map(Number);
	const t = new Date(Date.UTC(y, m - 1, d));
	t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
	const week = Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
	return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
};
const berlin = (date: string, hm: string) => {
	for (const offset of ['+01:00', '+02:00']) {
		const instant = new Date(`${date}T${hm}:00${offset}`);
		const local = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instant);
		if (local === hm) return instant.toISOString();
	}
	throw new Error(`no Berlin time ${date} ${hm}`);
};
const localHm = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

async function call(page: Page, method: string, path: string, body?: unknown) {
	const session = await (await page.request.get('/api/v1/auth/session')).json();
	const response = await page.request.fetch(`/api/v1${path}`, { method, data: body, headers: { 'X-CSRF-Token': session.csrfToken } });
	expect(response.status(), `${method} ${path}`).toBeLessThan(300);
	return response.status() === 204 ? null : response.json();
}
type Seg = { id: string; kind: string; placeId: string | null; startedAt: string; endedAt: string | null; voided: boolean };
const segmentsOf = async (page: Page, date: string) =>
	((await call(page, 'GET', `/time/segments?from=${encodeURIComponent(berlin(date, '00:00'))}&to=${encodeURIComponent(berlin(addDays(date, 1), '00:00'))}`)) as Seg[]).filter((s) => !s.voided);

const shot = async (page: Page, name: string) => {
	if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/${name}.png`, fullPage: true });
};

// four weeks back: inside the seeded work model, before the seeded segments (last 14 days)
const monday = mondayOf(addDays(berlinToday(), -28));
const day = (n: number) => addDays(monday, n);
const week = isoWeek(monday);
const schoolPlan = { mode: 'school', blocks: [{ start: '08:00', end: '13:30', kind: 'school' }] };

test('a day planned as school shows "nichts gebucht" in the week; "Schultag buchen" books the planned times as school', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1440, height: 1000 } });
	await call(page, 'PUT', `/plan/days/${day(0)}`, schoolPlan);
	await call(page, 'PUT', `/plan/days/${day(2)}`, schoolPlan);

	await page.goto(`/week?week=${week}`);
	const wed = page.getByTestId(`week-day-${day(2)}`);
	await expect(wed.getByTestId('day-school-unbooked')).toHaveText('Schule geplant, nichts gebucht');
	await expect(page.getByTestId(`week-day-${day(1)}`).getByTestId('day-school-unbooked')).toHaveCount(0);

	await page.goto(`/time/${day(2)}`);
	await page.getByTestId('school-book').click();
	const form = page.getByTestId('school-book-form');
	await expect(form.getByTestId('school-book-hint')).toHaveAttribute('data-source', 'plan');
	await expect(form.locator('#school-start')).toHaveValue('08:00');
	await expect(form.locator('#school-end')).toHaveValue('13:30');
	await form.getByRole('button', { name: 'Schultag speichern' }).click();
	await expect(page.getByTestId('school-evaluation')).toHaveText('Schule erfasst 5:30 → voller Schultag, angerechnet 7:42');

	const booked = await segmentsOf(page, day(2));
	expect(booked).toHaveLength(1);
	expect(booked[0].kind).toBe('school');
	expect([localHm(booked[0].startedAt), localHm(booked[0].endedAt!)]).toEqual(['08:00', '13:30']);
	const places = (await call(page, 'GET', '/places')) as { id: string; kind: string }[];
	expect(booked[0].placeId).toBe(places.find((p) => p.kind === 'school')!.id);

	await page.goto(`/week?week=${week}`);
	await expect(page.getByTestId(`week-day-${day(2)}`).getByTestId('day-school-unbooked')).toHaveCount(0);
	await expect(page.getByTestId(`week-day-${day(2)}`)).toHaveAttribute('data-mark', 'school');
	await context.close();
});

test('without a plan "Schultag buchen" proposes the times of the last school day, which can be changed before saving', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1440, height: 1000 } });
	await page.goto(`/time/${day(3)}`);
	await page.getByTestId('school-book').click();
	const form = page.getByTestId('school-book-form');
	await expect(form.getByTestId('school-book-hint')).toHaveAttribute('data-source', 'last');
	await expect(form.locator('#school-start')).toHaveValue('08:00');
	await expect(form.locator('#school-end')).toHaveValue('13:30');
	await form.locator('#school-end').fill('12:00');
	await form.getByRole('button', { name: 'Schultag speichern' }).click();
	await expect(page.getByTestId('school-evaluation')).toContainText('Schule erfasst 4:00');
	const booked = await segmentsOf(page, day(3));
	expect(booked.map((s) => [s.kind, localHm(s.startedAt), localHm(s.endedAt!)])).toEqual([['school', '08:00', '12:00']]);
	await context.close();
});

test('the mark "Schultag (Gutschrift)" is no longer offered; an old school-credit day stays valid and asks for times', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1440, height: 1000 } });
	await page.goto(`/time/${day(4)}`);
	await expect(page.locator('#day-mark option')).toHaveText(['Keine Markierung', 'Feiertag', 'Urlaub', 'Krank', 'Freigestellt']);

	// an existing day with the old mark (Apple apps, import, before this change)
	await call(page, 'PUT', `/time/days/${day(1)}`, { mark: 'school_credit' });
	await page.goto(`/time/${day(1)}`);
	await expect(page.locator('#day-mark')).toHaveValue('school_credit');
	const hint = page.getByTestId('school-credit-hint');
	await expect(hint).toBeVisible();
	await hint.getByRole('button', { name: 'Uhrzeiten nachtragen' }).click();
	const form = page.getByTestId('school-book-form');
	await expect(form.locator('#school-start')).toHaveValue('08:00');
	await form.getByRole('button', { name: 'Schultag speichern' }).click();
	await expect(page.getByTestId('school-credit-hint')).toHaveCount(0);
	expect((await segmentsOf(page, day(1))).map((s) => s.kind)).toEqual(['school']);
	await context.close();
});

test('today planned as school: the timer starts as school at the school place and asks before booking work there', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1440, height: 1000 } });
	const today = berlinToday();
	await call(page, 'PUT', `/plan/days/${today}`, schoolPlan);
	await page.goto('/');
	await expect(page.getByTestId('school-today')).toContainText('Heute ist Schule geplant (08:00–13:30).');
	await expect(page.getByTestId('school-today').getByTestId('school-book')).toBeVisible();
	await expect(page.locator('#timer-kind')).toHaveValue('school');
	await expect(page.locator('#timer-place option:checked')).toHaveText('Berufsschule');

	await page.locator('#timer-kind').selectOption('work');
	await page.getByRole('button', { name: 'Start' }).click();
	const confirm = page.getByTestId('timer-school-confirm');
	await expect(confirm).toContainText('Am Ort Berufsschule wird Arbeit gebucht. Ist das richtig?');
	expect(await call(page, 'GET', '/time/timer')).toBeNull();
	await confirm.getByRole('button', { name: 'Als Schule starten' }).click();
	await expect(page.getByTestId('timer-dot')).toBeVisible();
	const running = (await call(page, 'GET', '/time/timer')) as Seg;
	expect(running.kind).toBe('school');
	await page.getByRole('button', { name: 'Stopp' }).click();
	await expect(page.getByTestId('timer-dot')).toHaveCount(0);
	await call(page, 'DELETE', `/time/segments/${running.id}?reason=${encodeURIComponent('E2E aufgeräumt')}`);
	await context.close();
});

test('a Freistellung on a day planned as school points to "Schultag buchen"', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1440, height: 1000 } });
	await page.goto('/absences');
	await page.getByRole('button', { name: 'Abwesenheit anlegen' }).click();
	await page.locator('#abs-kind').selectOption('excused');
	await page.locator('#abs-start').fill(day(0));
	await page.locator('#abs-end').fill(day(0));
	await expect(page.getByTestId('absence-school-hint')).toContainText('Für Berufsschule bitte „Schultag buchen“ verwenden');
	await page.locator('#abs-start').fill(day(4));
	await page.locator('#abs-end').fill(day(4));
	await expect(page.getByTestId('absence-school-hint')).toHaveCount(0);
	await context.close();
});

test('"Schultage prüfen" lists earlier mis-bookings and fixes each one only after a confirmation', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1440, height: 1000 } });
	const places = (await call(page, 'GET', '/places')) as { id: string; kind: string }[];
	const school = places.find((p) => p.kind === 'school')!;
	// Friday: timer at the Berufsschule left on "Arbeit"
	await call(page, 'POST', '/time/segments', { kind: 'work', placeId: school.id, startedAt: berlin(day(4), '08:00'), endedAt: berlin(day(4), '13:30') });

	await page.goto(`/week?week=${week}`);
	await page.getByTestId('school-check-link').click();
	await expect(page).toHaveURL(/\/time\/school-check$/);
	const fri = page.locator(`[data-testid="school-check-item"][data-date="${day(4)}"]`);
	const mon = page.locator(`[data-testid="school-check-item"][data-date="${day(0)}"]`);
	await expect(fri).toHaveAttribute('data-type', 'work_at_school');
	await expect(fri).toContainText('Arbeit am Ort Berufsschule');
	await expect(mon).toHaveAttribute('data-type', 'planned_not_booked');

	// change the kind: nothing happens before the confirmation
	await fri.getByRole('button', { name: 'In Schule ändern' }).click();
	expect((await segmentsOf(page, day(4))).map((s) => s.kind)).toEqual(['work']);
	await fri.getByRole('button', { name: 'Ja, ändern' }).click();
	await expect(fri).toHaveCount(0);
	expect((await segmentsOf(page, day(4))).map((s) => s.kind)).toEqual(['school']);

	// book the planned school day from the list (the form is the confirmation)
	await mon.getByRole('button', { name: 'Schultag buchen' }).click();
	await expect(mon.locator('#school-start')).toHaveValue('08:00');
	await mon.getByRole('button', { name: 'Schultag speichern' }).click();
	await expect(mon).toHaveCount(0);
	expect((await segmentsOf(page, day(0))).map((s) => s.kind)).toEqual(['school']);

	// "Alles so lassen" hides the rest without changing anything
	await call(page, 'PUT', `/plan/days/${day(7)}`, schoolPlan);
	await page.reload();
	await expect(page.locator(`[data-testid="school-check-item"][data-date="${day(7)}"]`)).toBeVisible();
	await page.getByRole('button', { name: 'Alles so lassen' }).click();
	await expect(page.getByTestId('school-check-item')).toHaveCount(0);
	await page.reload();
	await expect(page.getByTestId('school-check-item')).toHaveCount(0);
	expect(await segmentsOf(page, day(7))).toEqual([]);
	await context.close();
});

const views = [
	{ device: 'phone', viewport: { width: 390, height: 844 } },
	{ device: 'desktop', viewport: { width: 1440, height: 1000 } }
] as const;

for (const scheme of ['light', 'dark'] as const) {
	for (const { device, viewport } of views) {
		test(`screens ${scheme} ${device}: week hint, day booking, old school-credit day, timer prompt, check list`, async ({ browser }) => {
			const { page, context } = await loginAsAdmin(browser, { viewport, colorScheme: scheme });
			// six weeks back (the seeded vacation lies five weeks back), set up idempotently: Wednesday planned school, Tuesday old school-credit mark, Friday work at school
			const m = mondayOf(addDays(berlinToday(), -42));
			const w = isoWeek(m);
			await call(page, 'PUT', `/plan/days/${addDays(m, 2)}`, schoolPlan);
			await call(page, 'PUT', `/time/days/${addDays(m, 1)}`, { mark: 'school_credit' });
			const places = (await call(page, 'GET', '/places')) as { id: string; kind: string }[];
			if ((await segmentsOf(page, addDays(m, 4))).length === 0) {
				await call(page, 'POST', '/time/segments', { kind: 'work', placeId: places.find((p) => p.kind === 'school')!.id, startedAt: berlin(addDays(m, 4), '08:00'), endedAt: berlin(addDays(m, 4), '13:30') });
			}
			const name = (what: string) => `school-${what}-${device}-${scheme}`;

			await page.goto(`/week?week=${w}`);
			await expect(page.getByTestId(`week-day-${addDays(m, 2)}`).getByTestId('day-school-unbooked')).toBeVisible();
			await shot(page, name('week'));

			await page.goto(`/time/${addDays(m, 2)}`);
			await page.getByTestId('school-book').click();
			await expect(page.getByTestId('school-book-form')).toBeVisible();
			await shot(page, name('day-book'));

			await page.goto(`/time/${addDays(m, 1)}`);
			await expect(page.getByTestId('school-credit-hint')).toBeVisible();
			await shot(page, name('day-credit'));

			await page.goto('/');
			await expect(page.locator('#timer-kind')).toHaveValue('school');
			await page.locator('#timer-kind').selectOption('work');
			await page.getByRole('button', { name: 'Start' }).click();
			await expect(page.getByTestId('timer-school-confirm')).toBeVisible();
			await shot(page, name('timer'));

			await page.goto('/time/school-check');
			await expect(page.getByTestId('school-check-item').first()).toBeVisible();
			await shot(page, name('check'));
			await context.close();
		});
	}
}
