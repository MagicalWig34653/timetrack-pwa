import { expect, test, type Page } from '@playwright/test';
import { loginAsAdmin, seededWorkDays } from './helpers';

// Week planner time grid (package P11) against the in-repo mock API. Serial: the mock state lives in one server process.
test.describe.configure({ mode: 'serial' });

const addDays = (date: string, n: number) => {
	const [y, m, d] = date.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
// 2033-W20 = 16.-22.05.2033: ordinary working week (no holidays), far enough from the other specs' data.
const MONDAY = '2033-05-16';
const WEEK = '2033-W20';
const day = (n: number) => addDays(MONDAY, n);

async function openGrid(page: Page, week = WEEK) {
	await page.goto(`/plan?week=${week}&view=grid`);
	await expect(page.getByTestId('week-grid')).toBeVisible();
	await page.getByTestId('week-grid-scroll').evaluate((el) => (el.scrollTop = 0));
}

/** Viewport point of a minute in a day column (the scroller starts at its top, so 05:00 is the body top). */
async function point(page: Page, date: string, minute: number, dx = 0.5) {
	const grid = page.getByTestId('week-grid');
	const startHour = Number(await grid.getAttribute('data-start-hour'));
	const hh = Number(await grid.getAttribute('data-hour-height'));
	const box = (await page.getByTestId(`col-${date}`).boundingBox())!;
	return { x: box.x + box.width * dx, y: box.y + ((minute - startHour * 60) / 60) * hh };
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, options: { alt?: boolean; shift?: boolean } = {}) {
	if (options.alt) await page.keyboard.down('Alt');
	if (options.shift) await page.keyboard.down('Shift');
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
	await page.mouse.move(to.x, to.y, { steps: 6 });
	await page.mouse.up();
	if (options.shift) await page.keyboard.up('Shift');
	if (options.alt) await page.keyboard.up('Alt');
}

async function paintBlock(page: Page, date: string, from: number, to: number, options = {}) {
	await drag(page, await point(page, date, from), await point(page, date, to), options);
}

test('paint a block, snap to 15 minutes, live sums and dirty state', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1440, height: 1100 } });
	await openGrid(page);
	await expect(page.getByTestId('plan-dirty')).toHaveAttribute('data-dirty', 'false');
	// 09:07 -> 13:08 snaps to 09:00 - 13:15
	await paintBlock(page, day(1), 9 * 60 + 7, 13 * 60 + 8);
	await expect(page.getByTestId(`block-time-${day(1)}`)).toHaveText('09:00–13:15');
	await expect(page.getByTestId(`day-plan-${day(1)}`)).toHaveText('4:15');
	await expect(page.getByTestId('plan-dirty')).toHaveAttribute('data-dirty', 'true');
	await expect(page.getByTestId('plan-total-text')).toContainText('Plan 4:15');
	await expect(page.getByTestId(`block-${day(1)}`)).toHaveAttribute('data-plan-mode', 'office');
	await expect(page.getByTestId('plan-notice')).toContainText('Block gemalt');
	// a plain click on an empty area only deselects
	await page.getByTestId(`col-${day(3)}`).click({ position: { x: 20, y: 300 } });
	await expect(page.getByTestId(`block-${day(3)}`)).toHaveCount(0);
	await context.close();
});

test('the brush: kind and shift for 5 minute steps, painting over several days, eraser', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1440, height: 1100 } });
	await openGrid(page);
	await page.getByTestId('brush-home').click();
	// drag across Wednesday to Thursday: both days get the block
	const from = await point(page, day(2), 8 * 60);
	const to = await point(page, day(3), 12 * 60);
	await drag(page, from, to);
	await expect(page.getByTestId(`block-${day(2)}`)).toHaveAttribute('data-plan-mode', 'home');
	await expect(page.getByTestId(`block-time-${day(2)}`)).toHaveText('08:00–12:00');
	await expect(page.getByTestId(`block-time-${day(3)}`)).toHaveText('08:00–12:00');
	// shift snaps to 5 minutes
	await page.getByTestId('brush-customer').click();
	await paintBlock(page, day(4), 8 * 60 + 2, 9 * 60 + 33, { shift: true });
	await expect(page.getByTestId(`block-time-${day(4)}`)).toHaveText('08:00–09:35');
	// eraser: select the tool, press on the block
	await page.getByTestId('tool-erase').click();
	const target = await point(page, day(4), 8 * 60 + 40);
	await page.mouse.move(target.x, target.y);
	await page.mouse.down();
	await page.mouse.up();
	await expect(page.getByTestId(`block-${day(4)}`)).toHaveCount(0);
	await page.getByTestId('tool-draw').click();
	await context.close();
});

test('move across days, resize by the edges, copy with Alt, undo and redo', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1440, height: 1100 } });
	await openGrid(page);
	await paintBlock(page, day(0), 8 * 60, 12 * 60);
	await expect(page.getByTestId(`block-time-${day(0)}`)).toHaveText('08:00–12:00');

	// move one day right and one hour down
	await drag(page, await point(page, day(0), 10 * 60), await point(page, day(1), 11 * 60));
	await expect(page.getByTestId(`block-${day(0)}`)).toHaveCount(0);
	await expect(page.getByTestId(`block-time-${day(1)}`)).toHaveText('09:00–13:00');

	// resize: bottom edge to 14:30, top edge to 08:30
	const end = await page.getByTestId(`handle-end-${day(1)}`).boundingBox();
	await drag(page, { x: end!.x + end!.width / 2, y: end!.y + end!.height / 2 }, await point(page, day(1), 14 * 60 + 30));
	await expect(page.getByTestId(`block-time-${day(1)}`)).toHaveText('09:00–14:30');
	const start = await page.getByTestId(`handle-start-${day(1)}`).boundingBox();
	await drag(page, { x: start!.x + start!.width / 2, y: start!.y + 3 }, await point(page, day(1), 8 * 60 + 30));
	await expect(page.getByTestId(`block-time-${day(1)}`)).toHaveText('08:30–14:30');

	// Alt-drag copies to Wednesday and keeps the original
	await drag(page, await point(page, day(1), 11 * 60), await point(page, day(2), 11 * 60), { alt: true });
	await expect(page.getByTestId(`block-time-${day(1)}`)).toHaveText('08:30–14:30');
	await expect(page.getByTestId(`block-time-${day(2)}`)).toHaveText('08:30–14:30');

	// undo walks back, redo forward (Ctrl+Z / Ctrl+Shift+Z)
	await page.keyboard.press('Control+z');
	await expect(page.getByTestId(`block-${day(2)}`)).toHaveCount(0);
	await page.keyboard.press('Control+z');
	await expect(page.getByTestId(`block-time-${day(1)}`)).toHaveText('09:00–14:30');
	await page.keyboard.press('Control+Shift+z');
	await expect(page.getByTestId(`block-time-${day(1)}`)).toHaveText('08:30–14:30');
	await page.getByTestId('plan-undo').click();
	await expect(page.getByTestId(`block-time-${day(1)}`)).toHaveText('09:00–14:30');
	await expect(page.getByTestId('plan-redo')).toBeEnabled();
	await context.close();
});

test('multi-select with the marquee, shift click, keyboard nudge, delete', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1440, height: 1100 } });
	await openGrid(page);
	await paintBlock(page, day(0), 8 * 60, 12 * 60);
	await paintBlock(page, day(1), 8 * 60, 12 * 60);
	await paintBlock(page, day(2), 8 * 60, 12 * 60);
	await page.getByTestId('tool-select').click();
	// marquee from empty space left of Monday's block over Monday and Tuesday
	const a = await point(page, day(0), 7 * 60 + 30, 0.02);
	const b = await point(page, day(1), 9 * 60, 0.9);
	await drag(page, a, b);
	await expect(page.getByTestId('selection-count')).toHaveText('2 ausgewählt');
	// shift click adds Wednesday
	await page.getByTestId(`block-${day(2)}`).click({ modifiers: ['Shift'], position: { x: 30, y: 40 } });
	await expect(page.getByTestId('selection-count')).toHaveText('3 ausgewählt');
	// keyboard: focus a block and nudge all selected by 15 minutes
	await page.getByTestId(`block-${day(1)}`).focus();
	await page.keyboard.press('ArrowDown');
	await expect(page.getByTestId(`block-time-${day(0)}`)).toHaveText('08:15–12:15');
	await expect(page.getByTestId(`block-time-${day(2)}`)).toHaveText('08:15–12:15');
	await page.keyboard.press('Shift+ArrowUp');
	await expect(page.getByTestId(`block-time-${day(1)}`)).toHaveText('08:10–12:10');
	// delete removes the whole selection
	await page.keyboard.press('Delete');
	await expect(page.getByTestId('week-grid').locator('[data-block]:not([data-ghost])')).toHaveCount(0);
	await page.keyboard.press('Control+z');
	await expect(page.getByTestId('week-grid').locator('[data-block]:not([data-ghost])')).toHaveCount(3);
	await context.close();
});

test('context menu: change kind, insert a break, duplicate, copy to other days, paste, delete', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1440, height: 1100 } });
	await openGrid(page);
	await paintBlock(page, day(0), 8 * 60, 16 * 60);
	await expect(page.getByTestId(`block-${day(0)}`)).toHaveAttribute('data-plan-mode', 'office');
	await page.getByTestId(`block-${day(0)}`).click({ button: 'right', position: { x: 40, y: 60 } });
	const menu = page.getByRole('menu');
	await expect(menu).toBeVisible();
	for (const name of ['Bearbeiten …', 'Art: Schule', 'Pause einfügen: 45 Min.', 'Duplizieren', 'Auf andere Tage kopieren …', 'Kopieren', 'Löschen']) {
		await expect(menu.getByRole('menuitem', { name, exact: name === 'Kopieren' ? false : undefined }).first()).toBeVisible();
	}
	await menu.getByRole('menuitem', { name: 'Art: Schule' }).click();
	await expect(page.getByTestId(`block-${day(0)}`)).toHaveAttribute('data-plan-mode', 'school');
	await page.getByTestId(`block-${day(0)}`).click({ button: 'right', position: { x: 40, y: 60 } });
	await page.getByRole('menuitem', { name: 'Pause einfügen: 45 Min.' }).click();
	await expect(page.getByTestId(`block-${day(0)}`)).toContainText('45 Min. Pause');
	await expect(page.getByTestId(`day-plan-${day(0)}`)).toHaveText('7:15');

	// duplicate lands on the next free day
	await page.getByTestId(`block-${day(0)}`).click({ button: 'right', position: { x: 40, y: 60 } });
	await page.getByRole('menuitem', { name: 'Duplizieren' }).click();
	await expect(page.getByTestId(`block-time-${day(1)}`)).toHaveText('08:00–16:00');

	// copy to other days via the dialog
	await page.getByTestId(`block-${day(0)}`).click({ button: 'right', position: { x: 40, y: 60 } });
	await page.getByRole('menuitem', { name: 'Auf andere Tage kopieren …' }).click();
	await expect(page.getByTestId('copy-days-dialog')).toBeVisible();
	await page.getByTestId(`copy-day-${day(3)}`).check();
	await page.getByTestId(`copy-day-${day(4)}`).check();
	await page.getByTestId('copy-days-submit').click();
	await expect(page.getByTestId(`block-${day(3)}`)).toBeVisible();
	await expect(page.getByTestId(`block-${day(4)}`)).toBeVisible();

	// copy and paste with the keyboard onto Saturday (clicking an empty spot there sets the paste target)
	await page.getByTestId(`block-${day(4)}`).click({ position: { x: 30, y: 30 } });
	await page.keyboard.press('Control+c');
	await page.getByTestId(`col-${day(5)}`).click({ position: { x: 20, y: 40 } });
	await page.keyboard.press('Control+v');
	await expect(page.getByTestId(`block-${day(5)}`)).toBeVisible();

	// delete via the menu, then undo
	await page.getByTestId(`block-${day(5)}`).click({ button: 'right', position: { x: 40, y: 60 } });
	await page.getByRole('menuitem', { name: 'Löschen', exact: false }).click();
	await expect(page.getByTestId(`block-${day(5)}`)).toHaveCount(0);
	await page.keyboard.press('Control+z');
	await expect(page.getByTestId(`block-${day(5)}`)).toBeVisible();
	await context.close();
});

test('dialog alternative to dragging, with validation and a blocked day', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1440, height: 1100 } });
	await openGrid(page, '2033-W21');
	await page.getByTestId('plan-add-block').click();
	await expect(page.getByTestId('block-dialog')).toBeVisible();
	await page.getByTestId('bd-day').selectOption(addDays(MONDAY, 8));
	await page.getByTestId('bd-mode').selectOption('customer');
	await page.getByTestId('bd-start').fill('10:00');
	await page.getByTestId('bd-end').fill('09:00');
	await page.getByTestId('bd-submit').click();
	await expect(page.getByTestId('bd-problem')).toBeVisible();
	await page.getByTestId('bd-end').fill('15:30');
	await page.getByTestId('bd-break').fill('30');
	await expect(page.getByTestId('bd-planned')).toContainText('5:00');
	await page.getByTestId('bd-submit').click();
	await expect(page.getByTestId('block-dialog')).toHaveCount(0);
	const tuesday = addDays(MONDAY, 8);
	await expect(page.getByTestId(`block-time-${tuesday}`)).toHaveText('10:00–15:30');
	await expect(page.getByTestId(`block-${tuesday}`)).toHaveAttribute('aria-label', /Kunde.*10:00 bis 15:30 Uhr.*netto 5:00 Stunden.*30 Minuten Pause/);
	// double click opens the dialog for editing
	await page.getByTestId(`block-${tuesday}`).dblclick({ position: { x: 40, y: 40 } });
	await expect(page.getByTestId('bd-delete')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('block-dialog')).toHaveCount(0);
	await context.close();
});

test('templates: standard week, copy last week, copy to following weeks, save', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1440, height: 1100 } });
	await openGrid(page, '2033-W30');
	await page.getByTestId('plan-standard').click();
	await expect(page.getByTestId('week-grid').locator('[data-block]:not([data-ghost])')).toHaveCount(5);
	await expect(page.getByTestId('plan-diff')).toBeVisible();
	await page.keyboard.press('Control+z');
	await expect(page.getByTestId('week-grid').locator('[data-block]:not([data-ghost])')).toHaveCount(0);
	await page.keyboard.press('Control+Shift+z');
	await expect(page.getByTestId('week-grid').locator('[data-block]:not([data-ghost])')).toHaveCount(5);
	await page.getByTestId('plan-save').click();
	await expect(page.getByTestId('plan-dirty')).toHaveAttribute('data-dirty', 'false');

	await page.getByTestId('plan-follow').click();
	await expect(page.getByTestId('follow-dialog')).toBeVisible();
	await page.getByTestId('follow-weeks').fill('2');
	await page.getByTestId('follow-submit').click();
	await expect(page.getByTestId('toast')).toContainText('10 Tage');
	await page.goto('/plan?week=2033-W32&view=grid');
	await expect(page.getByTestId('week-grid').locator('[data-block]:not([data-ghost])')).toHaveCount(5);

	// "Letzte Woche kopieren" from W33 takes the plan of W32
	await page.goto('/plan?week=2033-W33&view=grid');
	await expect(page.getByTestId('week-grid')).toBeVisible();
	await page.getByTestId('plan-copy').click();
	await expect(page.getByTestId('week-grid').locator('[data-block]:not([data-ghost])')).toHaveCount(5);
	await context.close();
});

test('hints for working-time limits and the list view stays reachable', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1440, height: 1100 } });
	await openGrid(page, '2033-W35');
	await paintBlock(page, addDays(MONDAY, 105), 6 * 60, 19 * 60);
	await expect(page.getByTestId('plan-issues')).toContainText('mehr als 10 Stunden');
	await page.getByTestId('view-list').click();
	await expect(page.getByTestId('plan-rows')).toBeVisible();
	await expect(page.getByTestId(`plan-row-${addDays(MONDAY, 105)}`)).toBeVisible();
	await page.getByTestId('view-grid').click();
	await expect(page.getByTestId('week-grid')).toBeVisible();
	await context.close();
});

test('actual times as a ghost overlay', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1440, height: 1100 } });
	const worked = seededWorkDays()[0];
	const monday = addDays(worked, 1 - (new Date(worked + 'T00:00:00Z').getUTCDay() || 7));
	const iso = await page.evaluate((m) => {
		const thursday = new Date(Date.parse(m) + 3 * 86_400_000);
		const jan4 = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
		const first = new Date(jan4.getTime() - (((jan4.getUTCDay() || 7) - 1) * 86_400_000));
		return `${thursday.getUTCFullYear()}-W${String(1 + Math.round((Date.parse(m) - first.getTime()) / (7 * 86_400_000))).padStart(2, '0')}`;
	}, monday);
	await openGrid(page, iso);
	await expect(page.getByTestId(`actual-${worked}`)).toHaveCount(0);
	await page.getByTestId('toggle-actuals').click();
	await expect(page.getByTestId(`actual-${worked}`).first()).toBeVisible();
	await page.getByTestId('toggle-actuals').click();
	await expect(page.getByTestId(`actual-${worked}`)).toHaveCount(0);
	await context.close();
});

test('phone: one day at a time with day tabs and the dialog as the touch path', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 390, height: 844 } });
	await openGrid(page, '2033-W36');
	await expect(page.getByTestId('day-tabs')).toBeVisible();
	await expect(page.locator('[data-testid^="col-"]')).toHaveCount(1);
	await page.getByTestId(`day-tab-${addDays(MONDAY, 112 + 2)}`).click();
	await expect(page.getByTestId(`col-${addDays(MONDAY, 112 + 2)}`)).toBeVisible();
	await page.getByTestId('plan-add-block').click();
	await expect(page.getByTestId('block-dialog')).toBeVisible();
	await page.getByTestId('bd-start').fill('08:00');
	await page.getByTestId('bd-end').fill('12:00');
	await page.getByTestId('bd-submit').click();
	await expect(page.getByTestId(`block-${addDays(MONDAY, 112 + 2)}`)).toBeVisible();
	const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
	expect(overflow).toBeLessThanOrEqual(0);
	await context.close();
});
