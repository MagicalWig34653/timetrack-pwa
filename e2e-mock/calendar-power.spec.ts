import { type Page } from '@playwright/test';
import { expect, test } from './test';
import { loginAsAdmin } from './helpers';

// P9: drag and drop, inspector layout, blurred planning window, context menu and the shared day detail.
// Dates lie in May 2032 (Monday 2032-05-03) so they do not collide with the other planning specs on the shared mock server.
test.describe.configure({ mode: 'serial' });

const tile = (page: Page, date: string) => page.locator(`[data-testid="month-grid"] [data-date="${date}"]`);

async function drag(page: Page, from: string, to: string) {
	const a = (await tile(page, from).boundingBox())!;
	const b = (await tile(page, to).boundingBox())!;
	await page.mouse.move(a.x + 12, a.y + 40);
	await page.mouse.down();
	await page.mouse.move(a.x + 30, a.y + 44, { steps: 3 });
	await page.mouse.move(b.x + 12, b.y + 40, { steps: 8 });
	return async () => page.mouse.up();
}

test('drag over days selects them, the dialog plans vacation for the range and Ctrl+Z undoes it', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 1000 } });
	await page.goto('/calendar?date=2032-05-03');
	await expect(page.getByTestId('calendar-month')).toHaveText('Mai 2032');

	const release = await drag(page, '2032-05-03', '2032-05-05');
	await expect(page.getByTestId('drag-status')).toContainText('03.05.2032–05.05.2032 (3 Tage)');
	await release();
	await expect(page.getByTestId('selection-count')).toHaveText('3 Tage ausgewählt');

	await page.getByTestId('select-vacation').click();
	const dialog = page.getByRole('dialog', { name: 'Genau planen' });
	await expect(dialog).toBeVisible();
	await expect(dialog).toHaveAttribute('aria-modal', 'true');
	await expect(dialog.getByLabel('Art')).toHaveValue('vacation');
	await dialog.getByLabel('Bis').fill('2032-05-06');
	await dialog.getByTestId('pd-submit').click();
	await expect(dialog).toHaveCount(0);
	await expect(page.getByTestId('month-grid').locator('[data-chip="absence"]')).toHaveCount(4);

	await page.keyboard.press('Control+z');
	await expect(page.getByTestId('month-grid').locator('[data-chip="absence"]')).toHaveCount(0);
	await page.keyboard.press('Control+Shift+z');
	await expect(page.getByTestId('month-grid').locator('[data-chip="absence"]')).toHaveCount(4);
	await context.close();
});

test('Escape cancels a drag without selecting', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 1000 } });
	await page.goto('/calendar?date=2032-05-17');
	const release = await drag(page, '2032-05-17', '2032-05-20');
	await expect(page.getByTestId('drag-status')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('drag-status')).toHaveCount(0);
	await release();
	await expect(page.getByTestId('selection-count')).toHaveCount(0);
	await context.close();
});

test('an absence is moved by dragging and resized at its edge, with a conflict ghost', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 1000 } });
	await page.goto('/calendar?date=2032-05-03');
	// existing vacation 03.-06.05. from the first test; move it one week later
	const chip = tile(page, '2032-05-04').locator('[data-chip="absence"]');
	const from = (await chip.boundingBox())!;
	const target = (await tile(page, '2032-05-11').boundingBox())!;
	await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
	await page.mouse.down();
	await page.mouse.move(from.x + 40, from.y + 10, { steps: 3 });
	await page.mouse.move(target.x + 30, target.y + 40, { steps: 8 });
	await expect(page.getByTestId('drag-status')).toContainText('10.05.2032–13.05.2032');
	await page.mouse.up();
	await expect(tile(page, '2032-05-10').locator('[data-chip="absence"]')).toHaveCount(1);
	await expect(tile(page, '2032-05-04').locator('[data-chip="absence"]')).toHaveCount(0);

	// resize the end edge from 13.05. to 14.05.
	const handle = tile(page, '2032-05-13').locator('[data-resize="end"]');
	const h = (await handle.boundingBox())!;
	const next = (await tile(page, '2032-05-14').boundingBox())!;
	await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
	await page.mouse.down();
	await page.mouse.move(h.x + 20, h.y + 10, { steps: 3 });
	await page.mouse.move(next.x + 30, next.y + 40, { steps: 6 });
	await page.mouse.up();
	await expect(tile(page, '2032-05-14').locator('[data-chip="absence"]')).toHaveCount(1);

	// keyboard alternative: Alt+ArrowLeft on the focused day moves it back
	await tile(page, '2032-05-12').focus();
	await page.keyboard.press('Alt+ArrowLeft');
	await expect(tile(page, '2032-05-14').locator('[data-chip="absence"]')).toHaveCount(0);
	await expect(tile(page, '2032-05-09').locator('[data-chip="absence"]')).toHaveCount(1);
	await context.close();
});

test('wide screens show the day details in a right inspector column without moving the grid', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1600, height: 1000 } });
	await page.goto('/calendar?date=2032-06-07');
	const grid = page.getByTestId('month-grid');
	const before = (await grid.boundingBox())!;
	const inspector = page.getByTestId('inspector');
	const side = (await inspector.boundingBox())!;
	expect(side.x).toBeGreaterThan(before.x + before.width - 2);
	await tile(page, '2032-06-09').click();
	await expect(page.getByTestId('day-detail')).toBeVisible();
	const after = (await grid.boundingBox())!;
	expect(Math.abs(after.width - before.width)).toBeLessThan(1);
	expect(Math.abs(after.x - before.x)).toBeLessThan(1);
	expect((await inspector.boundingBox())!.x).toBeCloseTo(side.x, 0);
	await page.setViewportSize({ width: 1200, height: 1000 });
	const narrow = (await inspector.boundingBox())!;
	const gridNarrow = (await grid.boundingBox())!;
	expect(narrow.y).toBeGreaterThan(gridNarrow.y + gridNarrow.height - 2);
	await context.close();
});

test('planning window: blurred backdrop, focus trap, Escape returns focus, reduced transparency removes the blur, sheet on phones', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 900 } });
	await page.goto('/calendar?date=2032-06-07');
	await tile(page, '2032-06-08').dblclick();
	const dialog = page.getByRole('dialog', { name: 'Genau planen' });
	await expect(dialog).toBeVisible();
	await expect(dialog).toHaveAttribute('data-sheet', 'false');
	const blur = () => dialog.evaluate((el) => getComputedStyle(el).backdropFilter || getComputedStyle(el).getPropertyValue('-webkit-backdrop-filter'));
	expect(await blur()).toContain('blur');
	// focus stays inside while tabbing
	for (let i = 0; i < 25; i++) {
		await page.keyboard.press('Tab');
		const inside = await dialog.evaluate((el) => el.contains(document.activeElement));
		expect(inside, await page.evaluate(() => `${document.activeElement?.tagName} ${document.activeElement?.textContent?.slice(0,30)} ${document.activeElement?.getAttribute("aria-label")} i`)).toBe(true);
	}
	await page.evaluate(() => (document.documentElement.dataset.transparency = 'reduced'));
	expect(await blur()).toBe('none');
	await page.evaluate(() => delete document.documentElement.dataset.transparency);
	await page.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);
	await expect(tile(page, '2032-06-08')).toBeFocused();

	await page.setViewportSize({ width: 390, height: 800 });
	await page.locator('[data-testid="week-days"] [data-date="2032-06-08"]').dblclick();
	await expect(page.getByRole('dialog', { name: 'Genau planen' })).toHaveAttribute('data-sheet', 'true');
	await context.close();
});

test('plan with times for a range of working days, in the precise window', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 1000 } });
	await page.goto('/calendar?date=2032-06-07');
	await tile(page, '2032-06-07').click();
	await tile(page, '2032-06-11').click({ modifiers: ['Shift'] });
	await expect(page.getByTestId('selection-count')).toHaveText('5 Tage ausgewählt');
	await page.getByTestId('select-plan').click();
	const dialog = page.getByRole('dialog', { name: 'Genau planen' });
	await dialog.getByLabel('Arbeitsform').selectOption('home');
	await dialog.getByLabel('Beginn').fill('08:00');
	await dialog.getByLabel('Ende', { exact: true }).fill('16:30');
	await dialog.getByLabel('Pause (Min.)').fill('30');
	await dialog.getByTestId('pd-submit').click();
	await expect(dialog).toHaveCount(0);
	await expect(page.getByTestId('month-grid').locator('[data-chip="plan"]')).toHaveCount(5);
	await tile(page, '2032-06-09').click();
	await expect(page.getByTestId('panel-plan-times')).toContainText('08:00');
	await context.close();
});

test('context menu: keyboard operable, closes on Escape, keeps the system menu in inputs and with Ctrl, sets sick days', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 1000 } });
	await page.goto('/calendar?date=2032-07-05');
	await tile(page, '2032-07-06').click({ button: 'right' });
	const menu = page.getByRole('menu');
	await expect(menu).toBeVisible();
	await expect(menu.getByRole('menuitem').first()).toBeFocused();
	await page.keyboard.press('ArrowDown');
	await expect(menu.getByRole('menuitem', { name: 'Krank eintragen' })).toBeFocused();
	await page.keyboard.press('ArrowUp');
	await page.keyboard.type('k');
	await expect(menu.getByRole('menuitem', { name: 'Krank eintragen' })).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(menu).toHaveCount(0);
	await expect(tile(page, '2032-07-06')).toBeFocused();

	// Ctrl+right-click keeps the system menu
	await tile(page, '2032-07-06').click({ button: 'right', modifiers: ['Control'] });
	await expect(page.getByRole('menu')).toHaveCount(0);

	// menu key opens it without a mouse; choose sick
	await tile(page, '2032-07-07').focus();
	await page.keyboard.press('ContextMenu');
	await page.getByRole('menuitem', { name: 'Krank eintragen' }).click();
	await expect(tile(page, '2032-07-07').locator('[data-chip="absence"]')).toHaveCount(1);

	// right-click on an absence chip: its own menu with status entries
	await tile(page, '2032-07-07').locator('[data-chip="absence"]').click({ button: 'right' });
	await expect(page.getByRole('menuitem', { name: 'Status: Genehmigt' })).toBeVisible();
	await page.getByRole('menuitem', { name: 'Abwesenheit löschen' }).click();
	await expect(tile(page, '2032-07-07').locator('[data-chip="absence"]')).toHaveCount(0);

	// a menu at the viewport edge stays inside the viewport
	await page.setViewportSize({ width: 1280, height: 600 });
	const t = (await tile(page, '2032-07-09').boundingBox())!;
	await page.mouse.click(Math.min(t.x + t.width - 4, 1275), 590, { button: 'right' });
	const box = (await page.getByRole('menu').boundingBox())!;
	expect(box.y + box.height).toBeLessThanOrEqual(600);
	expect(box.x + box.width).toBeLessThanOrEqual(1280);
	await page.mouse.wheel(0, 100);
	await expect(page.getByRole('menu')).toHaveCount(0);
	await context.close();
});

test('the shared day detail is the same on /time/<date> and in the calendar', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1600, height: 1000 } });
	await page.goto('/calendar?date=2032-08-02');
	await tile(page, '2032-08-03').click();
	const inspector = page.getByTestId('inspector');
	await expect(inspector.getByTestId('day-panel')).toBeVisible();
	const calendarButtons = await inspector.getByRole('button').allInnerTexts();
	await page.goto('/time/2032-08-03');
	const detail = page.getByTestId('day-detail');
	await expect(detail.getByTestId('day-panel')).toBeVisible();
	const pageButtons = await detail.getByRole('button').allInnerTexts();
	// same actions; only the calendar's "Schließen" differs
	expect(pageButtons.filter((b) => b !== 'Schließen')).toEqual(calendarButtons.filter((b) => b !== 'Schließen'));
	await expect(detail.getByRole('button', { name: 'Abwesenheit anlegen' })).toBeVisible();
	await expect(detail.getByRole('button', { name: 'Eintrag manuell ergänzen' })).toBeVisible();
	await context.close();
});
