import { type Page } from '@playwright/test';
import { expect, test } from './test';
import { loginAsAdmin } from './helpers';

// U4: typing into the /absences filters must not make the layout jump or take the focus away (reproduced earlier: every
// keystroke rewrote the URL through goto(), which resets focus, and the reset button changed the height of the filter box).
test.describe.configure({ mode: 'serial' });
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--disable-features=OverlayScrollbar'] } });

interface Sample {
	focus: string;
	selectionEnd: number | null;
	value: string;
	filtersHeight: number;
	filtersTop: number;
	inputTop: number;
	inputLeft: number;
	scrollY: number;
	pageHeight: number;
}

const sample = (page: Page): Promise<Sample> =>
	page.evaluate(() => {
		const input = document.getElementById('filter-q') as HTMLInputElement;
		const box = document.querySelector('[data-testid="absence-filters"]')!.getBoundingClientRect();
		const rect = input.getBoundingClientRect();
		return {
			focus: (document.activeElement as HTMLElement | null)?.id ?? document.activeElement?.tagName ?? '',
			selectionEnd: input.selectionEnd,
			value: input.value,
			filtersHeight: box.height,
			filtersTop: box.top + window.scrollY,
			inputTop: rect.top + window.scrollY,
			inputLeft: rect.left,
			scrollY: window.scrollY,
			pageHeight: document.documentElement.scrollHeight
		};
	});

for (const [label, viewport] of [['desktop', { width: 1280, height: 800 }], ['phone', { width: 390, height: 800 }]] as const) {
	test(`typing in the text filter keeps focus, caret and the position of the filter box (${label})`, async ({ browser }) => {
		const { page, context } = await loginAsAdmin(browser, { viewport });
		await page.goto('/absences');
		await expect(page.getByTestId('absence-row')).toHaveCount(4);
		const input = page.locator('#filter-q');
		await input.scrollIntoViewIfNeeded();
		await input.click();
		const before = await sample(page);
		const text = 'Erkältung';
		const samples: Sample[] = [];
		for (const [i, char] of [...text].entries()) {
			await page.keyboard.type(char, { delay: 30 });
			samples.push(await sample(page));
			expect(samples[i].value).toBe(text.slice(0, i + 1));
		}
		// the debounced filter and URL update land after the last key; the layout must be as still as during typing
		await expect(page.getByTestId('absence-row')).toHaveCount(1);
		await expect(page).toHaveURL(/q=Erk/);
		await page.waitForTimeout(400);
		samples.push(await sample(page));

		for (const s of samples) {
			expect(s.focus, 'focus stays in the text filter').toBe('filter-q');
			expect(s.selectionEnd, 'caret stays at the end').toBe(s.value.length);
			expect(s.inputTop, 'filter input does not move vertically').toBe(before.inputTop);
			expect(s.inputLeft, 'filter input does not move horizontally').toBe(before.inputLeft);
			expect(s.filtersHeight, 'filter box keeps its height (reset button reserves its space)').toBe(before.filtersHeight);
			expect(s.scrollY, 'scroll position is kept').toBe(before.scrollY);
		}
		// typing continues seamlessly after the list has changed
		await page.keyboard.type('x');
		await expect(page.getByTestId('absences-empty')).toBeVisible();
		expect((await sample(page)).focus).toBe('filter-q');
		await context.close();
	});

	test(`rows are not re-created while the filter text changes (${label})`, async ({ browser }) => {
		const { page, context } = await loginAsAdmin(browser, { viewport });
		await page.goto('/absences');
		await expect(page.getByTestId('absence-row')).toHaveCount(4);
		// mark the DOM node of every row; keyed rows that stay in the result must keep the same node (no re-mount)
		await page.evaluate(() => document.querySelectorAll('[data-testid="absence-row"]').forEach((el, i) => el.setAttribute('data-marker', `m${i}`)));
		await page.locator('#filter-q').click();
		await page.keyboard.type('Erk', { delay: 30 });
		await expect(page.getByTestId('absence-row')).toHaveCount(1);
		await expect(page.getByTestId('absence-row')).toHaveAttribute('data-marker', /m\d/);
		await context.close();
	});
}
