import { expect, test, type Browser } from '@playwright/test';
import { apiCall as api, newActor as baseActor, registerViaInvite, type Actor } from './helpers';
import { McpClient } from './mcp-client';

// Package L18: module switches (ADR-0012, contract v0.9.0) against the real backend. Two instances with their own databases:
// MAIN (account and server-wide switches, personal MCP token) and OPERATOR (environment lock MODULES_DISABLED=reports,mcp).
test.describe.configure({ mode: 'serial' });

const PORT = Number(process.env.E2E_PORT ?? 18090);
const BASE = `http://localhost:${Number(process.env.E2E_MODULES_PORT ?? PORT + 7)}`;
const OP_BASE = `http://localhost:${Number(process.env.E2E_MODULES_OPERATOR_PORT ?? PORT + 8)}`;
test.use({ baseURL: BASE });
const newActor = (browser: Browser, base = BASE) => baseActor(browser, [], base);

let alice: Actor; // bootstrap admin of MAIN
let bob: Actor; // member of MAIN
let carol: Actor; // bootstrap admin of OPERATOR
let token = ''; // Alice's personal MCP token

type Key = 'reports' | 'planning' | 'transfer' | 'automation' | 'mcp';
/** A representative REST route per module (GET) and the navigation link that disappears with it (none for mcp). */
const ROUTES: Record<Key, { path: string; page: string; nav?: string }> = {
	reports: { path: '/api/v1/reports/learning-fields', page: '/reports', nav: 'Berichtsheft' },
	planning: { path: '/api/v1/absences?from=2026-01-01&to=2026-01-31', page: '/absences', nav: 'Abwesenheiten' },
	transfer: { path: '/api/v1/import-templates', page: '/export', nav: 'Export' },
	automation: { path: '/api/v1/time/suggestions', page: '/suggestions', nav: 'Vorschläge' },
	mcp: { path: '/api/v1/me/api-tokens', page: '/settings/api-tokens' }
};
const REPORT_TOOLS = ['get_report_week', 'get_report_week_text', 'list_learning_fields', 'create_report_entry', 'update_report_entry'];
const PLANNING_TOOLS = ['list_absences', 'get_vacation_balance', 'list_holidays', 'list_plan_days', 'view_shared', 'create_absence', 'set_plan_day'];

test.afterAll(async () => {
	await alice?.context.close();
	await bob?.context.close();
	await carol?.context.close();
});

async function statusOf(actor: Actor, key: Key) {
	const res = await api(actor.page, 'GET', ROUTES[key].path);
	return res;
}

test('accounts: Alice (admin) and Bob register via invite, personal token with all scopes', async ({ browser }) => {
	alice = await newActor(browser);
	await registerViaInvite(alice, new URL(process.env.E2E_MODULES_BOOTSTRAP_LINK!).pathname, 'alice.mod', 'Alice Module', 'Passkey');
	await alice.page.getByRole('button', { name: 'Später einrichten' }).click();
	await expect(alice.page.getByRole('heading', { name: 'Hallo, Alice Module' })).toBeVisible();
	const invite = await api(alice.page, 'POST', '/api/v1/admin/invitations', { note: 'Bob' });
	expect(invite.status).toBe(201);
	bob = await newActor(browser);
	await registerViaInvite(bob, `/invite/${invite.body.token}`, 'bob.mod', 'Bob Module', 'Passkey');
	await bob.page.getByRole('button', { name: 'Später einrichten' }).click();
	await expect(bob.page.getByRole('heading', { name: 'Hallo, Bob Module' })).toBeVisible();

	await alice.page.goto('/settings/api-tokens');
	await alice.page.getByRole('button', { name: 'Neues Token' }).click();
	await alice.page.getByLabel('Name', { exact: true }).fill('E2E Module');
	await alice.page.getByRole('button', { name: 'Lesen und schreiben', exact: true }).click();
	await alice.page.getByRole('button', { name: 'Token erzeugen' }).click();
	token = (await alice.page.getByTestId('token-value').textContent())!.trim();
	await alice.page.getByRole('button', { name: 'Ich habe es gespeichert' }).click();
	expect(token).toMatch(/^ttp_/);
});

test('baseline: all modules effective, every representative route answers, MCP lists report and planning tools', async () => {
	const modules = await api(alice.page, 'GET', '/api/v1/modules');
	expect(modules.status).toBe(200);
	expect(modules.body.map((m: { key: string }) => m.key).sort()).toEqual(['automation', 'mcp', 'planning', 'reports', 'transfer']);
	for (const m of modules.body) expect(m).toMatchObject({ effective: true, lockedByOperator: false });
	for (const key of Object.keys(ROUTES) as Key[]) expect((await statusOf(alice, key)).status, key).toBe(200);
	const names = await new McpClient(BASE, token).toolNames();
	for (const tool of [...REPORT_TOOLS, ...PLANNING_TOOLS]) expect(names).toContain(tool);
});

for (const key of ['reports', 'planning', 'transfer', 'automation', 'mcp'] as Key[]) {
	test(`account switch ${key}: UI hidden, API 404 module_disabled, MCP reacts, re-enabling restores`, async () => {
		const { page } = alice;
		const before = await new McpClient(BASE, token).toolNames();
		const off = await api(page, 'PUT', '/api/v1/me/modules', { modules: { [key]: false } });
		expect(off.status).toBe(200);
		expect(off.body.find((m: { key: string }) => m.key === key)).toMatchObject({ accountEnabled: false, effective: false });

		// API: 404 module_disabled
		const res = await statusOf(alice, key);
		expect(res.status).toBe(404);
		expect(res.body?.error?.code).toBe('module_disabled');

		// UI: navigation entry gone, direct visit explains
		await page.goto('/');
		const nav = ROUTES[key].nav;
		if (nav) await expect(page.getByRole('navigation').getByRole('link', { name: nav, exact: true })).toHaveCount(0);
		await page.goto(ROUTES[key].page);
		await expect(page.getByRole('heading', { name: 'Dieses Modul ist deaktiviert' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Zu den Moduleinstellungen' })).toBeVisible();

		// MCP: tools of the module vanish from tools/list; with mcp off the personal token is rejected
		const client = new McpClient(BASE, token);
		if (key === 'mcp') {
			expect((await client.request('tools/list')).status).toBe(401);
		} else {
			const after = await client.toolNames();
			if (key === 'reports') for (const tool of REPORT_TOOLS) expect(after).not.toContain(tool);
			if (key === 'planning') for (const tool of PLANNING_TOOLS) expect(after).not.toContain(tool);
			if (key === 'transfer') expect(after).not.toContain('list_absence_attachments');
			if (key === 'reports' || key === 'planning' || key === 'transfer') expect(after.length).toBeLessThan(before.length);
			else expect(after).toEqual(before);
		}

		// re-enable restores everything
		const on = await api(page, 'PUT', '/api/v1/me/modules', { modules: { [key]: true } });
		expect(on.status).toBe(200);
		expect((await statusOf(alice, key)).status).toBe(200);
		expect(await new McpClient(BASE, token).toolNames()).toEqual(before);
		await page.goto(ROUTES[key].page);
		await expect(page.getByRole('heading', { name: 'Dieses Modul ist deaktiviert' })).toHaveCount(0);
		if (nav) await expect(page.getByRole('navigation').getByRole('link', { name: nav, exact: true })).toBeVisible();
	});
}

test('account switch in the UI: the switch on /settings/modules turns the module off and on', async () => {
	const { page } = alice;
	await page.goto('/settings/modules');
	const toggle = page.getByTestId('module-switch-reports');
	await expect(toggle).toBeChecked();
	await toggle.click();
	await expect(toggle).not.toBeChecked();
	await expect.poll(async () => (await statusOf(alice, 'reports')).status).toBe(404);
	await expect(page.getByRole('navigation').getByRole('link', { name: 'Berichtsheft', exact: true })).toHaveCount(0);
	await toggle.click();
	await expect(toggle).toBeChecked();
	await expect.poll(async () => (await statusOf(alice, 'reports')).status).toBe(200);
});

test('server-wide switch: only admins, a second user cannot re-enable (409 module_locked), re-enabling restores', async () => {
	const forbidden = await api(bob.page, 'PUT', '/api/v1/admin/modules', { modules: { planning: false } });
	expect(forbidden.status).toBe(403);
	const admin = await api(alice.page, 'GET', '/api/v1/admin/modules');
	expect(admin.status).toBe(200);
	expect(admin.body.find((m: { key: string }) => m.key === 'planning')).toMatchObject({ enabled: true, lockedByOperator: false });

	const off = await api(alice.page, 'PUT', '/api/v1/admin/modules', { modules: { planning: false } });
	expect(off.status).toBe(200);
	// Bob: 404 module_disabled, status shows the server switch, cannot switch on
	const res = await statusOf(bob, 'planning');
	expect(res.status).toBe(404);
	expect(res.body?.error?.code).toBe('module_disabled');
	const status = (await api(bob.page, 'GET', '/api/v1/modules')).body.find((m: { key: string }) => m.key === 'planning');
	expect(status).toMatchObject({ serverEnabled: false, effective: false });
	const enable = await api(bob.page, 'PUT', '/api/v1/me/modules', { modules: { planning: true } });
	expect(enable.status).toBe(409);
	expect(enable.body?.error?.code).toBe('module_locked');
	// MCP of the admin loses the planning tools
	expect(await new McpClient(BASE, token).toolNames()).not.toContain('list_absences');

	// Bob's settings page: switch locked with the German explanation
	await bob.page.goto('/settings/modules');
	await expect(bob.page.getByTestId('module-switch-planning')).toBeDisabled();
	await expect(bob.page.getByTestId('module-list')).toContainText('Server deaktiviert');
	// the admin page shows it as switched off for everybody
	await alice.page.goto('/admin/modules');
	await expect(alice.page.getByRole('heading', { name: 'Module des Servers' })).toBeVisible();

	const back = await api(alice.page, 'PUT', '/api/v1/admin/modules', { modules: { planning: true } });
	expect(back.status).toBe(200);
	expect((await statusOf(bob, 'planning')).status).toBe(200);
	expect(await new McpClient(BASE, token).toolNames()).toContain('list_absences');
});

test('operator lock MODULES_DISABLED: locked in status, not switchable by anybody, API 404, UI explains, MCP metadata 404', async ({ browser }) => {
	carol = await newActor(browser, OP_BASE);
	await registerViaInvite(carol, new URL(process.env.E2E_MODULES_OPERATOR_BOOTSTRAP_LINK!).pathname, 'carol.mod', 'Carol Module', 'Passkey');
	await carol.page.getByRole('button', { name: 'Später einrichten' }).click();
	await expect(carol.page.getByRole('heading', { name: 'Hallo, Carol Module' })).toBeVisible();

	const modules = (await api(carol.page, 'GET', '/api/v1/modules')).body as { key: string; effective: boolean; lockedByOperator: boolean }[];
	for (const key of ['reports', 'mcp']) expect(modules.find((m) => m.key === key)).toMatchObject({ lockedByOperator: true, effective: false });
	for (const key of ['planning', 'transfer', 'automation']) expect(modules.find((m) => m.key === key)).toMatchObject({ lockedByOperator: false, effective: true });

	for (const key of ['reports', 'mcp'] as Key[]) {
		const res = await statusOf(carol, key);
		expect(res.status, key).toBe(404);
		expect(res.body?.error?.code).toBe('module_disabled');
	}
	const own = await api(carol.page, 'PUT', '/api/v1/me/modules', { modules: { reports: true } });
	expect(own.status).toBe(409);
	expect(own.body?.error?.code).toBe('module_locked');
	const server = await api(carol.page, 'PUT', '/api/v1/admin/modules', { modules: { mcp: true } });
	expect(server.status).toBe(409);
	expect(server.body?.error?.code).toBe('module_locked');
	const list = (await api(carol.page, 'GET', '/api/v1/admin/modules')).body as { key: string; lockedByOperator: boolean }[];
	expect(list.find((m) => m.key === 'reports')?.lockedByOperator).toBe(true);

	// OAuth/MCP server-wide off: metadata and /mcp answer 404
	expect((await fetch(`${OP_BASE}/.well-known/oauth-authorization-server`)).status).toBe(404);
	expect((await fetch(`${OP_BASE}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(404);

	// UI: operator badge, locked switch, disabled pages, no navigation entry
	await carol.page.goto('/settings/modules');
	await expect(carol.page.getByTestId('module-switch-reports')).toBeDisabled();
	await expect(carol.page.getByTestId('module-list')).toContainText('Vom Betreiber deaktiviert');
	await carol.page.goto('/reports');
	await expect(carol.page.getByRole('heading', { name: 'Dieses Modul ist deaktiviert' })).toBeVisible();
	await expect(carol.page.getByRole('navigation').getByRole('link', { name: 'Berichtsheft', exact: true })).toHaveCount(0);
	await carol.page.goto('/admin/modules');
	await expect(carol.page.getByText('Vom Betreiber gesperrt').first()).toBeVisible();
});
