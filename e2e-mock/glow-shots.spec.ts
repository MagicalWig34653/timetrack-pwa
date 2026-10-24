import { type Page } from '@playwright/test';
import { test } from './test';
import { loginAsAdmin } from './helpers';

// Review screenshots for the glass and glow work (G1); only runs with SCREENSHOT_DIR.
const dir = process.env.SCREENSHOT_DIR;
test.describe.configure({ mode: 'serial' });

async function setLook(page: Page, glow: string, accent: string, scheme: 'light' | 'dark') {
	await page.goto('/settings/appearance');
	await page.getByTestId(`glow-${glow}`).click();
	await page.getByTestId(`mode-${scheme}`).click();
	if (accent.startsWith('#')) {
		await page.getByTestId('accent-hex').fill(accent);
		await page.getByTestId('accent-apply').click();
	} else await page.getByTestId(`accent-${accent}`).click();
	await page.waitForFunction(() => document.querySelector('[data-testid=appearance-sync]')?.getAttribute('data-state') === 'saved');
}

for (const scheme of ['light', 'dark'] as const) {
	test(`glow shots desktop ${scheme}`, async ({ browser }) => {
		test.skip(!dir, 'set SCREENSHOT_DIR');
		test.setTimeout(300_000);
		const { page } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 860 }, colorScheme: scheme });
		for (const [accentName, accent] of [['blue', 'blue'], ['orange', 'orange']] as const) {
			for (const glow of ['off', 'subtle', 'medium', 'strong']) {
				await setLook(page, glow, accent, scheme);
				for (const route of ['/', '/time', '/settings/appearance']) {
					await page.goto(route);
					await page.waitForLoadState('networkidle');
					await page.screenshot({ path: `${dir}/${scheme}-${accentName}-${glow}-${route === '/' ? 'home' : route.slice(1).replace(/\//g, '_')}.png` });
				}
				await page.goto('/');
				await page.getByTestId('appearance-menu').click();
				await page.screenshot({ path: `${dir}/${scheme}-${accentName}-${glow}-popover.png`, clip: { x: 700, y: 0, width: 580, height: 520 } });
				await page.keyboard.press('Escape');
			}
		}
		await setLook(page, 'medium', 'indigo', scheme);
		await page.goto('/');
		await page.getByTestId('appearance-menu').click();
		await page.screenshot({ path: `${dir}/${scheme}-presets-popover.png` });
		await page.keyboard.press('Escape');
		await page.goto('/settings/appearance');
		await page.getByTestId('accent-picker').first().waitFor();
		await page.waitForLoadState('networkidle');
		await page.screenshot({ path: `${dir}/${scheme}-presets-page.png`, fullPage: true });
		for (const [name, hex] of [['indigo', 'indigo'], ['crimson', 'crimson'], ['forest', 'forest'], ['bronze', 'bronze'], ['yellow', '#fef08a']]) {
			await setLook(page, 'strong', hex, scheme);
			await page.goto('/');
			await page.waitForLoadState('networkidle');
			await page.screenshot({ path: `${dir}/${scheme}-new-${name}-home.png` });
		}
		await setLook(page, 'strong', 'blue', scheme);
		await page.goto('/');
		await page.getByRole('button', { name: /Hilfe/ }).first().click();
		await page.getByRole('dialog').waitFor();
		await page.screenshot({ path: `${dir}/${scheme}-dialog.png` });
	});
}

test('glow shots phone', async ({ browser }) => {
	test.skip(!dir, 'set SCREENSHOT_DIR');
	const { page } = await loginAsAdmin(browser, { viewport: { width: 390, height: 844 } });
	for (const glow of ['off', 'strong']) {
		await setLook(page, glow, 'blue', 'light');
		await page.screenshot({ path: `${dir}/phone-${glow}-home.png` });
		await page.getByTestId('appearance-menu').click();
		await page.screenshot({ path: `${dir}/phone-${glow}-popover.png` });
		await page.keyboard.press('Escape');
		await page.getByTestId('menu-button').click();
		await page.screenshot({ path: `${dir}/phone-${glow}-menu.png` });
		await page.keyboard.press('Escape');
	}
});

// Frame times while scrolling a tall page, glow off against strong (reported, not asserted: depends on the machine).
test('glow scroll frame times', async ({ browser }) => {
	test.skip(!dir, 'set SCREENSHOT_DIR');
	const { page } = await loginAsAdmin(browser, { viewport: { width: 1280, height: 860 } });
	for (const glow of ['off', 'subtle', 'strong']) {
		await setLook(page, glow, 'blue', 'light');
		await page.goto('/settings/appearance');
		await page.waitForLoadState('networkidle');
		const stats = await page.evaluate(async () => {
			const frames: number[] = [];
			let last = performance.now();
			let running = true;
			const tick = (now: number) => {
				frames.push(now - last);
				last = now;
				if (running) requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
			const max = document.documentElement.scrollHeight - innerHeight;
			for (let round = 0; round < 3; round++) {
				for (let y = 0; y <= max; y += 40) {
					window.scrollTo(0, y);
					await new Promise((r) => requestAnimationFrame(() => r(null)));
				}
				for (let y = max; y >= 0; y -= 40) {
					window.scrollTo(0, y);
					await new Promise((r) => requestAnimationFrame(() => r(null)));
				}
			}
			running = false;
			frames.sort((a, b) => a - b);
			const pick = (q: number) => frames[Math.min(frames.length - 1, Math.floor(frames.length * q))];
			return { frames: frames.length, p50: pick(0.5), p95: pick(0.95), p99: pick(0.99), max: frames[frames.length - 1] };
		});
		console.log(`FRAMES ${glow} ${JSON.stringify(stats)}`);
	}
});
