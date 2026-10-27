import AxeBuilder from '@axe-core/playwright';
import { type Page } from '@playwright/test';
import { expect, test } from './test';
import { loginAsAdmin, seededWorkDays } from './helpers';

// Plan blocks (package P13, contract 0.35.0) against the in-repo mock API: several blocks per day in the grid and the
// list, kinds, splitting, hints, saving the full list, the week overview, share views and the fallback for older servers.
// Serial: the mock state lives in one server process. Weeks 2034-W20 to W24 are used by this file only.
test.describe.configure({ mode: 'serial' });

const addDays = (date: string, n: number) => {
	const [y, m, d] = date.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
// 2034-W20 = Monday 15.05.2034
const MONDAY = '2034-05-15';
const day = (n: number, base = MONDAY) => addDays(base, n);

async function openGrid(page: Page, week: string) {
	await page.goto(`/plan?week=${week}&view=grid`);
	await expect(page.getByTestId('week-grid')).toBeVisible();
	await page.getByTestId('week-grid-scroll').evaluate((el) => (el.scrollTop = 0));
}

async function point(page: Page, date: string, minute: number, dx = 0.5) {
	const grid = page.getByTestId('week-grid');
	const startHour = Number(await grid.getAttribute('data-start-hour'));
	const hh = Number(await grid.getAttribute('data-hour-height'));
	const box = (await page.getByTestId(`col-${date}`).boundingBox())!;
	return { x: box.x + box.width * dx, y: box.y + ((minute - startHour * 60) / 60) * hh };
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
	await page.mouse.move(to.x, to.y, { steps: 6 });
	await page.mouse.up();
}

const paint = async (page: Page, date: string, from: number, to: number) => drag(page, await point(page, date, from), await point(page, date, to));
const blockCount = (page: Page) => page.getByTestId('week-grid').locator('[data-block]:not([data-ghost])');

test('paint a school block and a work block on one day, save the full list, reload', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1440, height: 1100 } });
	await openGrid(page, '2034-W20');
	await page.getByTestId('brush-school').click();
	await paint(page, day(1), 8 * 60, 12 * 60);
	await page.getByTestId('brush-work').click();
	await paint(page, day(1), 13 * 60, 17 * 60);
	await expect(blockCount(page)).toHaveCount(2);
	await expect(page.getByTestId(`block-${day(1)}-0`)).toHaveAttribute('data-plan-mode', 'school');
	await expect(page.getByTestId(`block-${day(1)}-1`)).toHaveAttribute('data-plan-mode', 'work');
	await expect(page.getByTestId(`block-time-${day(1)}-0`)).toHaveText('08:00–12:00');
	await expect(page.getByTestId(`block-time-${day(1)}-1`)).toHaveText('13:00–17:00');
	// the day sum is the sum of the blocks, the gap is no work time; both kinds carry a label, not just a colour
	await expect(page.getByTestId(`day-plan-${day(1)}`)).toHaveText('8:00');
	await expect(page.getByTestId(`block-${day(1)}-0`)).toContainText('Schule');
	await expect(page.getByTestId(`block-${day(1)}-1`)).toContainText('Arbeit');
	await expect(page.getByTestId(`block-desc-${day(1)}-1`)).toHaveText(/13:00 bis 17:00 Uhr.*Block 2 von 2/);
	await expect(page.getByTestId('plan-hints')).toHaveCount(0);

	// a day of 8:00 to 16:30 without a gap gets the non-binding planning hints
	await page.getByTestId('brush-office').click();
	await paint(page, day(2), 8 * 60, 16 * 60 + 30);
	const hints = page.getByTestId('plan-hints');
	await expect(hints).toBeVisible();
	await expect(hints.locator('[data-hint="planned_break_short"]')).toContainText('Pausen');
	await expect(hints.locator('[data-hint="planned_work_stretch_long"]')).toContainText('6 Stunden');
	await expect(hints).toContainText('Unverbindliche Hinweise');

	// save: the request carries the complete block list of every planned day and none of the old window fields
	const request = page.waitForRequest((r) => r.method() === 'PUT' && r.url().includes('/plan/weeks/2034-W20'));
	await page.getByTestId('plan-save').click();
	const body = (await request).postDataJSON() as { replace: boolean; days: { date: string; mode: string; blocks: { start: string; end: string; kind: string }[]; plannedStart?: string }[] };
	expect(body.replace).toBe(true);
	const tuesday = body.days.find((d) => d.date === day(1))!;
	expect(tuesday.blocks.map((b) => `${b.start}-${b.end} ${b.kind}`)).toEqual(['08:00-12:00 school', '13:00-17:00 work']);
	expect(tuesday).not.toHaveProperty('plannedStart');
	expect(tuesday.mode).toBe('school');
	await expect(page.getByTestId('plan-dirty')).toHaveAttribute('data-dirty', 'false');

	await page.reload();
	await expect(page.getByTestId('week-grid')).toBeVisible();
	await expect(blockCount(page)).toHaveCount(3);
	await expect(page.getByTestId(`block-time-${day(1)}-0`)).toHaveText('08:00–12:00');
	await expect(page.getByTestId(`block-${day(1)}-1`)).toHaveAttribute('data-plan-mode', 'work');
	await expect(page.getByTestId(`day-plan-${day(1)}`)).toHaveText('8:00');
	await context.close();
});

test('split with the keyboard, insert a break, merge, resize stops at the neighbour, undo', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1440, height: 1100 } });
	await openGrid(page, '2034-W21');
	await paint(page, day(0, '2034-05-22'), 8 * 60, 16 * 60);
	const monday = day(0, '2034-05-22');
	await page.getByTestId(`block-${monday}-0`).focus();
	await page.keyboard.press('s');
	await expect(blockCount(page)).toHaveCount(2);
	await expect(page.getByTestId(`block-time-${monday}-0`)).toHaveText('08:00–12:00');
	await expect(page.getByTestId(`block-time-${monday}-1`)).toHaveText('12:00–16:00');
	await expect(page.getByTestId('plan-notice')).toContainText('Block geteilt');

	// the first block cannot grow into the second one (Alt + arrow moves the end edge)
	await page.getByTestId(`block-${monday}-0`).focus();
	await page.keyboard.press('Alt+ArrowDown');
	await expect(page.getByTestId(`block-time-${monday}-0`)).toHaveText('08:00–12:00');
	await page.keyboard.press('Alt+ArrowUp');
	await expect(page.getByTestId(`block-time-${monday}-0`)).toHaveText('08:00–11:45');

	// a 30 minute break inside the second block through the context menu
	await page.getByTestId(`block-${monday}-1`).click({ button: 'right', position: { x: 40, y: 50 } });
	await page.getByRole('menuitem', { name: 'Pause einfügen: 30 Min.' }).click();
	await expect(blockCount(page)).toHaveCount(3);
	await expect(page.getByTestId(`day-plan-${monday}`)).toHaveText('7:15');
	await page.getByTestId('plan-undo').click();
	await expect(blockCount(page)).toHaveCount(2);

	// two neighbours of the same kind can be merged again; the gap closes
	await page.getByTestId(`block-${monday}-0`).click({ button: 'right', position: { x: 40, y: 50 } });
	await page.getByRole('menuitem', { name: 'Mit nächstem Block verbinden' }).click();
	await expect(blockCount(page)).toHaveCount(1);
	await expect(page.getByTestId(`block-time-${monday}-0`)).toHaveText('08:00–16:00');

	// moving a block of a split day leaves the other one where it is
	await page.keyboard.press('Control+z');
	await page.getByTestId(`block-${monday}-1`).focus();
	await page.keyboard.press('ArrowRight');
	await expect(page.getByTestId(`block-${day(1, '2034-05-22')}-0`)).toBeVisible();
	await expect(page.getByTestId(`block-${monday}-0`)).toBeVisible();
	await expect(blockCount(page)).toHaveCount(2);
	await context.close();
});

test('edit one block in the dialog: kind, place and note; the day mode is separate; overlaps are refused', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1440, height: 1100 } });
	await openGrid(page, '2034-W22');
	// Whit Monday (29.05.2034) is a public holiday, so the Tuesday is used
	const monday = day(1, '2034-05-29');
	await page.getByTestId('brush-home').click();
	await paint(page, monday, 8 * 60, 12 * 60);
	await page.getByTestId('brush-school').click();
	await paint(page, monday, 13 * 60, 16 * 60);
	await expect(page.getByTestId(`chip-${monday}`)).toContainText('Homeoffice'); // the day mode follows the first block

	await page.getByTestId(`block-${monday}-1`).dblclick({ position: { x: 40, y: 30 } });
	await expect(page.getByTestId('block-dialog')).toBeVisible();
	await page.getByTestId('bd-kind').selectOption('travel');
	await page.getByTestId('bd-note').fill('Bahn nach Hamburg');
	const placeOptions = await page.locator('#bd-place option').count();
	if (placeOptions > 1) await page.locator('#bd-place').selectOption({ index: 1 });
	// the second block would overlap the first one
	await page.getByTestId('bd-start').fill('11:00');
	await page.getByTestId('bd-submit').click();
	await expect(page.getByTestId('bd-problem')).toContainText('überschneiden');
	await page.getByTestId('bd-start').fill('13:30');
	await page.getByTestId('bd-daymode').selectOption('customer');
	await page.getByTestId('bd-submit').click();
	await expect(page.getByTestId('block-dialog')).toHaveCount(0);
	await expect(page.getByTestId(`block-${monday}-1`)).toHaveAttribute('data-plan-mode', 'travel');
	await expect(page.getByTestId(`block-time-${monday}-1`)).toHaveText('13:30–16:00');
	await expect(page.getByTestId(`block-${monday}-1`)).toContainText('Bahn nach Hamburg');
	await expect(page.getByTestId(`block-${monday}-0`)).toHaveAttribute('data-plan-mode', 'home'); // the other block keeps its kind
	await expect(page.getByTestId(`chip-${monday}`)).toContainText('Kunde');

	// the chip opens the day: free day removes the blocks
	await page.getByTestId(`chip-${monday}`).click();
	await expect(page.getByTestId('bd-daymode')).toBeVisible();
	await page.getByTestId('bd-daymode').selectOption('off');
	await page.getByTestId('bd-submit').click();
	await expect(blockCount(page)).toHaveCount(0);
	await page.getByTestId('plan-undo').click();
	await expect(blockCount(page)).toHaveCount(2);

	// a block can be added with the dialog next to the others and starts after the last block
	await page.getByTestId('plan-add-block').click();
	await expect(page.getByTestId('block-dialog')).toBeVisible();
	await page.getByTestId('bd-day').selectOption(monday);
	await expect(page.getByTestId('bd-start')).toHaveValue('16:00');
	await page.getByTestId('bd-end').fill('18:00');
	await page.getByTestId('bd-submit').click();
	await expect(blockCount(page)).toHaveCount(3);
	await expect(page.getByTestId(`block-time-${monday}-2`)).toHaveText('16:00–18:00');
	await context.close();
});

test('list view: several blocks per day with kind, times, place and note; problems are named', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1440, height: 1100 } });
	await page.goto('/plan?week=2034-W23&view=list');
	await expect(page.getByTestId('plan-rows')).toBeVisible();
	const date = day(0, '2034-06-05');
	await page.locator(`#plan-mode-${date}`).selectOption('office');
	// the suggested working day comes as two blocks around the break
	await expect(page.getByTestId(`plan-block-${date}-0`)).toBeVisible();
	await expect(page.getByTestId(`plan-block-${date}-1`)).toBeVisible();
	await page.getByTestId(`plan-kind-${date}-0`).selectOption('school');
	await page.getByTestId(`plan-start-${date}-0`).fill('08:00');
	await page.getByTestId(`plan-end-${date}-0`).fill('12:00');
	await page.getByTestId(`plan-kind-${date}-1`).selectOption('work');
	await page.getByTestId(`plan-start-${date}-1`).fill('13:00');
	await page.getByTestId(`plan-end-${date}-1`).fill('17:00');
	await expect(page.getByTestId(`plan-hours-${date}`)).toHaveText('8:00');
	// add a third block and take it away again
	await page.getByTestId(`plan-addblock-${date}`).click();
	await expect(page.getByTestId(`plan-block-${date}-2`)).toBeVisible();
	await expect(page.getByTestId(`plan-hours-${date}`)).toHaveText('12:00');
	await page.getByTestId(`plan-remove-${date}-2`).click();
	await expect(page.getByTestId(`plan-block-${date}-2`)).toHaveCount(0);
	await page.getByTestId(`plan-start-${date}-1`).fill('11:00');
	await page.getByTestId('plan-save').click();
	await expect(page.getByTestId(`plan-problem-${date}`)).toContainText('überschneiden');
	await page.getByTestId(`plan-start-${date}-1`).fill('13:00');
	await page.getByTestId('plan-save').click();
	await expect(page.getByTestId('plan-dirty')).toHaveAttribute('data-dirty', 'false');
	// the grid shows what the list saved
	await page.getByTestId('view-grid').click();
	await expect(page.getByTestId(`block-${date}-0`)).toHaveAttribute('data-plan-mode', 'school');
	await expect(page.getByTestId(`block-${date}-1`)).toHaveAttribute('data-plan-mode', 'work');
	await page.getByTestId('view-list').click();
	await page.getByTestId(`plan-remove-${date}-1`).click();
	await expect(page.getByTestId(`plan-block-${date}-1`)).toHaveCount(0);
	await context.close();
});

test('week overview and day detail show every block and the difference between plan and actual', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1440, height: 1100 } });
	const worked = seededWorkDays()[0];
	const iso = await page.evaluate((d) => {
		const date = new Date(`${d}T00:00:00Z`);
		const thursday = new Date(date.getTime() + (4 - (date.getUTCDay() || 7)) * 86_400_000);
		const jan4 = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
		const first = new Date(jan4.getTime() - (((jan4.getUTCDay() || 7) - 1) * 86_400_000));
		return `${thursday.getUTCFullYear()}-W${String(1 + Math.round((thursday.getTime() - 3 * 86_400_000 - first.getTime()) / (7 * 86_400_000))).padStart(2, '0')}`;
	}, worked);
	await openGrid(page, iso);
	// start from a free day so that a seeded plan of the demo data does not add blocks
	await page.getByTestId('brush-off').click();
	await paint(page, worked, 6 * 60, 7 * 60);
	await page.getByTestId('brush-school').click();
	await paint(page, worked, 8 * 60, 12 * 60);
	await page.getByTestId('brush-work').click();
	await paint(page, worked, 13 * 60, 17 * 60);
	await page.getByTestId('plan-save').click();
	await expect(page.getByTestId('plan-dirty')).toHaveAttribute('data-dirty', 'false');

	await page.goto(`/week?week=${iso}`);
	const card = page.getByTestId(`week-day-${worked}`);
	await expect(card).toBeVisible();
	await expect(card.getByTestId('day-block')).toHaveCount(2);
	await expect(card.getByTestId('day-block').first()).toContainText('Schule 08:00–12:00');
	await expect(card.getByTestId('day-block').nth(1)).toContainText('Arbeit 13:00–17:00');
	await expect(card.getByTestId('day-plan-diff')).toContainText('Plan');
	await expect(card).toHaveAttribute('aria-label', /Schule 08:00–12:00, Arbeit 13:00–17:00/);
	await card.click();
	const panel = page.getByTestId('week-day-panel');
	await expect(panel.getByTestId('panel-plan-blocks').locator('[data-kind]')).toHaveCount(2);
	await expect(panel.getByTestId('panel-plan-diff')).toBeVisible();
	await context.close();
});

test('a shared plan shows the blocks with kind and times only', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await page.goto('/shared');
	await page.getByTestId('incoming-list').getByRole('button', { name: /Lena Beispiel/ }).click();
	const view = page.getByTestId('shared-view');
	await expect(view.getByTestId('shared-plan')).toBeVisible();
	await expect(view.getByTestId('shared-block').first()).toBeVisible();
	await expect(view.getByTestId('shared-block').first()).toHaveAttribute('data-kind', /work|school|travel|office|home|customer/);
	// the seeded plan of the owner has a day note; it never reaches the share view
	await expect(view).not.toContainText('Blockwoche');
	await context.close();
});

test('an older server (before 0.35.0) keeps the single window with a break', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1440, height: 1100 } });
	await page.route('**/api/v1/system/info', async (route) => {
		const response = await route.fetch();
		const json = await response.json();
		json.backend.apiVersion = '0.34.0';
		await route.fulfill({ response, json });
	});
	const strip = (plan: Record<string, unknown> | null) => {
		if (plan) {
			delete plan.blocks;
			delete plan.planHints;
		}
	};
	let lastPut: Record<string, unknown> | null = null;
	await page.route('**/api/v1/plan/weeks/**', async (route) => {
		const request = route.request();
		if (request.method() === 'PUT') lastPut = request.postDataJSON();
		const response = await route.fetch();
		const json = await response.json();
		for (const d of json.days ?? []) strip(d.plan);
		await route.fulfill({ response, json });
	});
	await openGrid(page, '2034-W24');
	// no block kinds beyond the four day modes, no splitting
	await expect(page.getByTestId('brush-travel')).toHaveCount(0);
	await expect(page.getByTestId('brush-work')).toHaveCount(0);
	const monday = day(0, '2034-06-12');
	await page.getByTestId('brush-school').click();
	await paint(page, monday, 8 * 60, 12 * 60);
	await page.getByTestId('brush-home').click();
	await paint(page, monday, 12 * 60 + 30, 19 * 60);
	// the second paint replaces the plan of the day: one block per day
	await expect(blockCount(page)).toHaveCount(1);
	await expect(page.getByTestId(`block-${monday}-0`)).toHaveAttribute('data-plan-mode', 'home');
	await expect(page.getByTestId(`block-${monday}-0`)).toContainText('30 Min. Pause'); // eight hours: the usual half hour
	await page.getByTestId(`block-${monday}-0`).click({ button: 'right', position: { x: 40, y: 60 } });
	await expect(page.getByRole('menuitem', { name: 'Block hier teilen' })).toHaveCount(0);
	await page.keyboard.press('Escape');
	await page.getByTestId('plan-save').click();
	await expect(page.getByTestId('plan-dirty')).toHaveAttribute('data-dirty', 'false');
	const body = lastPut as unknown as { days: Record<string, unknown>[] };
	expect(body.days[0]).toMatchObject({ date: monday, mode: 'home', plannedStart: '12:30', plannedEnd: '19:00', plannedBreakMinutes: 30 });
	expect(body.days[0]).not.toHaveProperty('blocks');
	// the dialog is the single-window form with a break
	await page.getByTestId('plan-add-block').click();
	await expect(page.getByTestId('bd-break')).toBeVisible();
	await expect(page.getByTestId('bd-daymode')).toHaveCount(0);
	await page.keyboard.press('Escape');
	// the list shows the single window
	await page.getByTestId('view-list').click();
	await expect(page.locator(`#plan-start-${monday}`)).toHaveValue('12:30');
	await expect(page.getByTestId(`plan-addblock-${monday}`)).toHaveCount(0);
	await context.close();
});

test('the planner with blocks has no accessibility violations', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1440, height: 1100 } });
	await openGrid(page, '2034-W20');
	await expect(page.getByTestId(`block-${day(1)}-1`)).toBeVisible();
	const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
	expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
	await page.getByTestId('view-list').click();
	await expect(page.getByTestId('plan-rows')).toBeVisible();
	const list = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
	expect(list.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
	await context.close();
});
