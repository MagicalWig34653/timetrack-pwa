import AxeBuilder from '@axe-core/playwright';
import { type Browser, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { expect, test } from './test';
import { loginAsAdmin } from './helpers';

// Groups module (G2, ADR-0033) against the mock: owner screens, the public /g/<token> page without login, edit secrets in
// localStorage, order export, module switch, accessibility, phone viewport. Serial: the mock server keeps its state.
test.describe.configure({ mode: 'serial' });

const shots = process.env.SCREENSHOT_DIR;
const shot = async (page: Page, name: string) => {
	if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
};
const axe = (page: Page) => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();

async function api(page: Page, method: string, path: string, body?: unknown) {
	return page.evaluate(
		async ({ method, path, body }) => {
			const session = await (await fetch('/api/v1/auth/session', { credentials: 'include' })).json();
			const res = await fetch(path, {
				method,
				credentials: 'include',
				headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken },
				body: body === undefined ? undefined : JSON.stringify(body)
			});
			return { status: res.status, body: res.status === 204 ? null : await res.json() };
		},
		{ method, path, body }
	);
}

/** A visitor without account: no authenticator, no session. */
async function visitor(browser: Browser, options: { viewport?: { width: number; height: number }; colorScheme?: 'light' | 'dark' } = {}) {
	const context = await browser.newContext(options);
	return { context, page: await context.newPage() };
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

let textPollPath = '';
let orderPath = '';
let datePollPath = '';

test('owner creates a text poll and sees the link once', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1366, height: 768 } });
	await expect(page.getByTestId('sidebar').getByRole('link', { name: 'Umfragen & Bestellungen' })).toBeVisible();
	await page.getByTestId('sidebar').getByRole('link', { name: 'Umfragen & Bestellungen' }).click();
	await expect(page.getByRole('heading', { name: 'Umfragen & Bestellungen' })).toBeVisible();
	await expect(page.getByTestId('polls-empty')).toBeVisible();
	await shot(page, 'g2-owner-list-empty');

	await page.getByTestId('new-poll').click();
	await page.getByLabel('Titel').fill('Teamessen');
	await page.getByTestId('kind-text').click();
	await page.getByLabel('Möglichkeit 1', { exact: true }).fill('Pizza');
	await page.getByLabel('Möglichkeit 2', { exact: true }).fill('Sushi');
	await page.getByTestId('mode-single').click();
	await shot(page, 'g2-owner-new-poll');
	await page.getByRole('button', { name: 'Umfrage anlegen' }).click();

	await expect(page.getByRole('heading', { name: 'Teamessen' })).toBeVisible();
	const url = await page.getByTestId('share-link-url').inputValue();
	expect(url).toMatch(/\/g\/[A-Za-z0-9_-]{43}$/);
	textPollPath = new URL(url).pathname;
	await shot(page, 'g2-owner-poll-detail-fresh');

	// reload: the owner can look at the link again (without the "just created" note)
	await page.reload();
	await expect(page.getByTestId('share-link-known')).toBeVisible();
	expect(new URL(await page.getByTestId('share-link-url').inputValue()).pathname).toBe(textPollPath);
	await context.close();
});

test('public poll page needs no login, has no app chrome and is marked noindex', async ({ browser }) => {
	const { page, context } = await visitor(browser, { viewport: { width: 1366, height: 768 } });
	await page.goto(textPollPath);
	await expect(page.getByTestId('group-title')).toHaveText('Teamessen');
	expect(new URL(page.url()).pathname).toBe(textPollPath);
	await expect(page.getByTestId('sidebar')).toHaveCount(0);
	await expect(page.getByRole('navigation')).toHaveCount(0);
	// the shell (app.html) carries the robots meta for every route; the page adds the no-referrer policy
	await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
	await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
	// nothing but the public API is called
	const requests: string[] = [];
	page.on('request', (r) => r.url().includes('/api/') && requests.push(new URL(r.url()).pathname));
	await page.reload();
	await expect(page.getByTestId('group-title')).toBeVisible();
	expect(requests.every((p) => p.startsWith('/api/v1/public/groups/'))).toBe(true);
	await shot(page, 'g2-public-poll-desktop');
	await context.close();
});

test('visitor votes, the vote survives a reload and can be edited; a second visitor cannot reuse the name', async ({ browser }) => {
	const first = await visitor(browser, { viewport: { width: 1366, height: 768 } });
	const page = first.page;
	await page.goto(textPollPath);
	await page.getByLabel('Dein Name').fill('Anna');
	await page.getByLabel('Sushi').check();
	await page.getByRole('button', { name: 'Abstimmen' }).click();
	await expect(page.getByTestId('vote-notice')).toContainText('Danke');
	await expect(page.getByTestId('vote-row')).toHaveCount(1);
	await expect(page.getByTestId('vote-row')).toContainText('(du)');
	await shot(page, 'g2-public-poll-voted');

	await page.reload();
	await expect(page.getByRole('heading', { name: 'Deine Antwort ändern' })).toBeVisible();
	await expect(page.getByLabel('Dein Name')).toHaveValue('Anna');
	await expect(page.getByLabel('Sushi')).toBeChecked();
	await page.getByLabel('Pizza').check();
	await page.getByRole('button', { name: 'Änderung speichern' }).click();
	await expect(page.getByTestId('vote-notice')).toContainText('geändert');
	await expect(page.getByTestId('vote-row').locator('[data-answer="yes"]')).toHaveCount(1);

	// another browser profile has no secret: the name is taken
	const second = await visitor(browser);
	await second.page.goto(textPollPath);
	await second.page.getByLabel('Dein Name').fill('anna');
	await second.page.getByLabel('Sushi').check();
	await second.page.getByRole('button', { name: 'Abstimmen' }).click();
	await expect(second.page.getByText(/Dieser Name ist schon vergeben/)).toBeVisible();
	await expect(second.page.getByTestId('vote-row')).toHaveCount(1);
	await second.page.getByLabel('Dein Name').fill('Ben');
	await second.page.getByRole('button', { name: 'Abstimmen' }).click();
	await expect(second.page.getByTestId('vote-row')).toHaveCount(2);

	await second.context.close();
	await first.context.close();
});

test('a signed-in owner opening the link stays on the public page', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await page.goto(textPollPath);
	await expect(page.getByTestId('group-title')).toHaveText('Teamessen');
	expect(new URL(page.url()).pathname).toBe(textPollPath);
	await expect(page.getByTestId('sidebar')).toHaveCount(0);
	await context.close();
});

test('owner detail: matrix, remove a vote, choose the final option, close and reopen', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1366, height: 768 } });
	await page.goto('/groups');
	await page.getByTestId('poll-list').getByRole('link', { name: /Teamessen/ }).click();
	await expect(page.getByTestId('vote-row')).toHaveCount(2);
	await expect(page.getByTestId('share-link-known')).toBeVisible();
	await shot(page, 'g2-owner-poll-detail');

	await page.getByRole('button', { name: 'Stimme von Ben entfernen' }).click();
	await page.getByTestId('confirm-submit').click();
	await expect(page.getByTestId('vote-row')).toHaveCount(1);

	await page.getByRole('button', { name: /Sushi als Ergebnis wählen/ }).click();
	await expect(page.getByTestId('final-result')).toContainText('Sushi');
	await expect(page.getByTestId('reopen')).toBeVisible();
	await shot(page, 'g2-owner-poll-final');

	// the public page shows the closed state and the result
	const { page: pub, context: pubContext } = await visitor(browser);
	await pub.goto(textPollPath);
	await expect(pub.getByTestId('closed-note')).toBeVisible();
	await expect(pub.getByTestId('final-result')).toContainText('Sushi');
	await expect(pub.getByTestId('vote-form')).toHaveCount(0);
	await pubContext.close();

	await page.getByTestId('reopen').click();
	await expect(page.getByTestId('close')).toBeVisible();
	await context.close();
});

test('renewing the link invalidates the old one', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await page.goto('/groups');
	await page.getByTestId('poll-list').getByRole('link', { name: /Teamessen/ }).click();
	await page.getByRole('button', { name: 'Link erneuern' }).click();
	await page.getByRole('button', { name: 'Neuen Link erzeugen' }).click();
	await expect(page.getByTestId('share-link-fresh')).toBeVisible();
	const fresh = new URL(await page.getByTestId('share-link-url').inputValue()).pathname;
	expect(fresh).not.toBe(textPollPath);
	const old = await visitor(browser);
	await old.page.goto(textPollPath);
	await expect(old.page.getByTestId('group-notfound')).toBeVisible();
	await old.page.goto(fresh);
	await expect(old.page.getByTestId('group-title')).toHaveText('Teamessen');
	textPollPath = fresh;
	await old.context.close();
	await context.close();
});

test('order round: owner sets up a catalog, visitors add, take over and export', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1366, height: 768 } });
	await page.goto('/groups/catalogs');
	await expect(page.getByTestId('catalogs-empty')).toBeVisible();
	await page.getByTestId('new-catalog').click();
	await page.getByLabel('Name', { exact: true }).fill('Dönerladen');
	await page.getByLabel('Gericht 1', { exact: true }).fill('Döner');
	await page.getByLabel('Preis von Gericht 1 in Euro').fill('7,50');
	await page.getByTestId('add-dish').click();
	await page.getByLabel('Gericht 2', { exact: true }).fill('Falafel');
	await page.getByLabel('Preis von Gericht 2 in Euro').fill('6,50');
	await shot(page, 'g2-owner-catalog-form');
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByTestId('catalog-list')).toContainText('Dönerladen');
	await expect(page.getByTestId('catalog-list')).toContainText('Gerichte: 2');

	await page.goto('/groups/orders/new');
	await page.getByLabel('Titel').fill('Dönerstag');
	await page.getByLabel('Hinweis für die Teilnehmer (optional)').fill('Bestellung bis 11 Uhr');
	await page.getByLabel('Katalog (optional)').selectOption({ label: 'Dönerladen (Gerichte: 2)' });
	await page.getByRole('button', { name: 'Bestellrunde anlegen' }).click();
	await expect(page.getByRole('heading', { name: 'Dönerstag' })).toBeVisible();
	orderPath = new URL(await page.getByTestId('share-link-url').inputValue()).pathname;
	await context.close();

	const anna = await visitor(browser, { viewport: { width: 1366, height: 768 } });
	await anna.page.goto(orderPath);
	await expect(anna.page.getByTestId('group-title')).toHaveText('Dönerstag');
	await anna.page.getByLabel('Dein Name').fill('Anna');
	await anna.page.getByTestId('suggestions').getByRole('button', { name: /Döner/ }).click();
	await anna.page.getByLabel('Menge', { exact: true }).fill('2');
	await anna.page.getByLabel('Notiz (optional)').fill('scharf');
	await anna.page.getByRole('button', { name: 'Eintragen' }).click();
	await expect(anna.page.getByTestId('order-line')).toHaveCount(1);
	await shot(anna.page, 'g2-public-order-desktop');

	const ben = await visitor(browser);
	await ben.page.goto(orderPath);
	await ben.page.getByLabel('Dein Name').fill('Ben');
	await ben.page.getByRole('button', { name: /„Döner“ für mich übernehmen/ }).click();
	await ben.page.getByRole('button', { name: 'Für mich eintragen' }).click();
	await expect(ben.page.getByTestId('entry-notice')).toContainText('übernommen');
	const line = ben.page.getByTestId('order-line');
	await expect(line).toHaveCount(1);
	await expect(line).toContainText('3×');
	await expect(line).toContainText('Anna, Ben');
	await expect(ben.page.getByTestId('order-total-value')).toContainText('22,50');

	const [csv] = await Promise.all([ben.page.waitForEvent('download'), ben.page.getByRole('button', { name: 'CSV' }).click()]);
	expect(csv.suggestedFilename()).toMatch(/\.csv$/);
	const csvText = readFileSync((await csv.path())!, 'utf8');
	expect(csvText).toContain('Name;Gericht;Notiz;Menge;Preis (EUR)');
	expect(csvText).toContain('Anna;Döner;scharf;2;7,50');
	const [txt] = await Promise.all([ben.page.waitForEvent('download'), ben.page.getByRole('button', { name: 'Text' }).click()]);
	expect(readFileSync((await txt.path())!, 'utf8')).toContain('3x Döner (scharf) - Anna, Ben');

	// Ben edits and then deletes his own entry; Anna's has no buttons for him
	await ben.page.getByTestId('order-entry').filter({ hasText: 'Ben' }).getByRole('button', { name: /ändern/ }).click();
	await ben.page.getByLabel('Menge', { exact: true }).fill('4');
	await ben.page.getByRole('button', { name: 'Änderung speichern' }).click();
	await expect(ben.page.getByTestId('order-line')).toContainText('6×');
	await expect(ben.page.getByTestId('order-entry').filter({ hasText: 'Anna' }).getByRole('button')).toHaveCount(0);
	await ben.page.getByTestId('order-entry').filter({ hasText: 'Ben' }).getByRole('button', { name: /löschen/ }).click();
	await expect(ben.page.getByTestId('order-line')).toContainText('2×');
	await ben.context.close();
	await anna.context.close();
});

test('owner order detail: grouped overview, export, remove entry', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1366, height: 768 } });
	await page.goto('/groups');
	await page.getByTestId('order-list').getByRole('link', { name: /Dönerstag/ }).click();
	await expect(page.getByTestId('order-line')).toHaveCount(1);
	await shot(page, 'g2-owner-order-detail');
	const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'CSV' }).click()]);
	expect(readFileSync((await download.path())!, 'utf8')).toContain('Anna;Döner;scharf;2;7,50');
	await page.getByRole('button', { name: /Eintrag Döner von Anna entfernen/ }).click();
	await page.getByTestId('confirm-submit').click();
	await expect(page.getByTestId('order-empty')).toBeVisible();
	await context.close();
});

test('phone: public date poll and order fit the viewport without sideways page scroll', async ({ browser }) => {
	const { page: owner, context: ownerContext } = await loginAsAdmin(browser, { viewport: { width: 390, height: 844 } });
	const created = await api(owner, 'POST', '/api/v1/groups/polls', {
		title: 'Sommerfest: Terminfindung mit einem recht langen Titel',
		description: 'Wann passt es euch am besten? Bitte bis Freitag antworten.',
		kind: 'date',
		choiceMode: 'multi',
		timeZone: 'Europe/Berlin',
		options: [
			{ date: '2026-12-04', startTime: '17:00', endTime: '20:00' },
			{ date: '2026-12-05', startTime: '12:00' },
			{ date: '2026-12-11' },
			{ date: '2026-12-12', startTime: '18:30', endTime: '22:00' },
			{ date: '2026-12-18' },
			{ date: '2026-12-19' }
		]
	});
	expect(created.status).toBe(201);
	datePollPath = created.body.path;
	await ownerContext.close();

	const v = await visitor(browser, { viewport: { width: 390, height: 844 } });
	const page = v.page;
	await page.goto(datePollPath);
	await expect(page.getByTestId('group-title')).toBeVisible();
	for (const [i, name] of ['Anna Schmidt', 'Ben', 'Clara-Marie von Hohenzollern', 'Dirk'].entries()) {
		const answers = created.body.options.map((o: { id: string }, n: number) => ({ optionId: o.id, answer: (n + i) % 3 === 0 ? 'yes' : (n + i) % 3 === 1 ? 'maybe' : 'no' }));
		await page.evaluate(async ({ path, name, answers }) => {
			await fetch(`/api/v1${path.replace('/g/', '/public/groups/')}/votes`, { method: 'POST', body: JSON.stringify({ name, answers }), headers: { 'Content-Type': 'application/json' } });
		}, { path: datePollPath, name, answers });
	}
	await page.reload();
	await expect(page.getByTestId('vote-row')).toHaveCount(4);
	expect(await noHorizontalScroll(page)).toBe(0);
	await expect(page.getByTestId('poll-results')).toBeVisible();
	await shot(page, 'g2-public-poll-phone');
	// the form is usable on a phone: all options reachable, buttons large enough
	const yes = page.getByTestId('vote-option').first().getByText('Ja', { exact: true });
	const box = (await yes.boundingBox())!;
	expect(box.height).toBeGreaterThanOrEqual(32);
	await v.context.close();
});

test('phone: public order page', async ({ browser }) => {
	const v = await visitor(browser, { viewport: { width: 390, height: 844 } });
	await v.page.goto(orderPath);
	await expect(v.page.getByTestId('group-title')).toHaveText('Dönerstag');
	expect(await noHorizontalScroll(v.page)).toBe(0);
	await shot(v.page, 'g2-public-order-phone');
	await v.context.close();
});

for (const scheme of ['light', 'dark'] as const) {
	test(`axe: public poll and order pages (${scheme})`, async ({ browser }) => {
		const v = await visitor(browser, { colorScheme: scheme, viewport: { width: 1280, height: 800 } });
		for (const path of [textPollPath, datePollPath, orderPath]) {
			await v.page.goto(path);
			await expect(v.page.getByTestId('group-title')).toBeVisible();
			expect((await axe(v.page)).violations, path).toEqual([]);
		}
		await shot(v.page, `g2-public-order-${scheme}`);
		await v.page.goto(datePollPath);
		await expect(v.page.getByTestId('group-title')).toBeVisible();
		await shot(v.page, `g2-public-poll-${scheme}`);
		await v.context.close();
	});

	test(`axe: owner screens (${scheme})`, async ({ browser }) => {
		const { page, context } = await loginAsAdmin(browser, { colorScheme: scheme, viewport: { width: 1280, height: 800 } });
		for (const route of ['/groups', '/groups/polls/new', '/groups/orders/new', '/groups/catalogs']) {
			await page.goto(route);
			await expect(page.locator('main h1')).toBeVisible();
			expect((await axe(page)).violations, route).toEqual([]);
		}
		await page.goto('/groups');
		await page.getByTestId('poll-list').getByRole('link').first().click();
		await expect(page.getByTestId('poll-results')).toBeVisible();
		expect((await axe(page)).violations, 'poll detail').toEqual([]);
		await page.goto('/groups');
		await page.getByTestId('order-list').getByRole('link').first().click();
		await expect(page.getByTestId('order-summary')).toBeVisible();
		expect((await axe(page)).violations, 'order detail').toEqual([]);
		await context.close();
	});
}

test('owner screens on a landscape monitor fit without page scroll (list, new poll)', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 1366, height: 768 } });
	for (const route of ['/groups', '/groups/orders/new', '/groups/catalogs']) {
		await page.goto(route);
		await expect(page.locator('main h1')).toBeVisible();
		const overflow = await page.evaluate(() => document.documentElement.scrollHeight - document.documentElement.clientHeight);
		expect(overflow, route).toBeLessThanOrEqual(0);
	}
	await shot(page, 'g2-owner-list');
	await context.close();
});

test('owner screens on a phone', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser, { viewport: { width: 390, height: 844 } });
	for (const route of ['/groups', '/groups/polls/new', '/groups/catalogs']) {
		await page.goto(route);
		await expect(page.locator('main h1')).toBeVisible();
		expect(await noHorizontalScroll(page), route).toBe(0);
	}
	await page.goto('/groups');
	await page.getByTestId('poll-list').getByRole('link').first().click();
	await expect(page.getByTestId('poll-results')).toBeVisible();
	expect(await noHorizontalScroll(page)).toBe(0);
	await shot(page, 'g2-owner-poll-detail-phone');
	await context.close();
});

test('module off: entry and page disappear, public links stop answering; on again restores them', async ({ browser }) => {
	const { page, context } = await loginAsAdmin(browser);
	await page.goto('/settings/modules');
	const switchFor = page.getByRole('switch', { name: 'Umfragen und Bestellungen nutzen' });
	await expect(switchFor).toBeChecked();
	await switchFor.uncheck();
	await expect(page.getByText('Gespeichert.')).toBeVisible();
	await expect(page.getByTestId('sidebar').getByRole('link', { name: 'Umfragen & Bestellungen' })).toHaveCount(0);
	await page.goto('/groups');
	await expect(page.getByTestId('new-poll')).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'Dieses Modul ist deaktiviert' })).toBeVisible();
	const v = await visitor(browser);
	await v.page.goto(orderPath);
	await expect(v.page.getByTestId('group-notfound')).toBeVisible();
	await api(page, 'PUT', '/api/v1/me/modules', { modules: { groups: true } });
	await v.page.reload();
	await expect(v.page.getByTestId('group-title')).toBeVisible();
	await page.goto('/groups');
	await expect(page.getByTestId('new-poll')).toBeVisible();
	await v.context.close();
	await context.close();
});
