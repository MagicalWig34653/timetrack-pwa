import { describe, expect, it } from 'vitest';
import { createMockApi } from './api.ts';
import { createMockFetch } from './fetch.ts';

// The groups mock must behave like the backend contract 0.37.0 (ADR-0033): these tests pin the rules the PWA relies on.

async function setup(options?: Parameters<typeof createMockFetch>[0]) {
	const mock = createMockFetch(options);
	const raw = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
		const response = await mock.fetch(path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
		const text = await response.text();
		let parsed: any;
		try {
			parsed = text ? JSON.parse(text) : undefined;
		} catch {
			parsed = text;
		}
		return { status: response.status, body: parsed, headers: response.headers };
	};
	const options1 = await raw('POST', '/api/v1/auth/login/options', {});
	const login = await raw('POST', '/api/v1/auth/login/verify', { challengeId: options1.body.challengeId, credential: { id: 'mock-login' } });
	const csrf = login.body.csrfToken as string;
	return {
		mock,
		get: (p: string) => raw('GET', p),
		post: (p: string, b?: unknown) => raw('POST', p, b ?? {}, { 'X-CSRF-Token': csrf }),
		put: (p: string, b: unknown) => raw('PUT', p, b, { 'X-CSRF-Token': csrf }),
		patch: (p: string, b: unknown) => raw('PATCH', p, b, { 'X-CSRF-Token': csrf }),
		del: (p: string) => raw('DELETE', p, undefined, { 'X-CSRF-Token': csrf }),
		raw
	};
}

const future = () => new Date(Date.now() + 7 * 86_400_000).toISOString();

describe('groups mock: owner polls', () => {
	it('creates a poll, returns the link, shows it again in the owner detail and never lists it', async () => {
		const s = await setup();
		const created = await s.post('/api/v1/groups/polls', { title: 'Teamabend', kind: 'text', choiceMode: 'single', options: [{ label: 'Pizza' }, { label: 'Sushi' }] });
		expect(created.status).toBe(201);
		expect(created.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(created.body.path).toBe(`/g/${created.body.token}`);
		const detail = await s.get(`/api/v1/groups/polls/${created.body.id}`);
		expect(detail.body.token).toBe(created.body.token);
	expect(detail.body.path).toBe(created.body.path);
		expect(JSON.stringify((await s.get('/api/v1/groups/polls')).body)).not.toContain(created.body.token);
	});

	it('validates input like the backend', async () => {
		const s = await setup();
		const bad = (body: unknown) => s.post('/api/v1/groups/polls', body).then((r) => `${r.status} ${r.body.error?.code}`);
		expect(await bad({ title: '', kind: 'text', choiceMode: 'single', options: [{ label: 'a' }] })).toBe('400 bad_request');
		expect(await bad({ title: 'x', kind: 'text', choiceMode: 'single', options: [] })).toBe('400 bad_request');
		expect(await bad({ title: 'x', kind: 'date', choiceMode: 'multi', options: [{ date: '2026-13-40' }] })).toBe('400 bad_request');
		expect(await bad({ title: 'x', kind: 'date', choiceMode: 'multi', options: [{ date: '2026-11-12', startTime: '18:00', endTime: '17:00' }] })).toBe('400 bad_request');
		expect(await bad({ title: 'x', kind: 'text', choiceMode: 'single', options: [{ label: 'a' }], deadline: '2020-01-01T00:00:00Z' })).toBe('400 deadline_in_past');
	});

	it('closes, reopens, chooses and clears a final option, rotates the token and deletes', async () => {
		const s = await setup();
		const created = (await s.post('/api/v1/groups/polls', { title: 'T', kind: 'date', choiceMode: 'multi', options: [{ date: '2026-12-01' }, { date: '2026-12-02', startTime: '18:00' }] })).body;
		const id = created.id;
		expect((await s.post(`/api/v1/groups/polls/${id}/close`)).body.closed).toBe(true);
		expect((await s.post(`/api/v1/groups/polls/${id}/reopen`)).body.closed).toBe(false);
		const chosen = await s.post(`/api/v1/groups/polls/${id}/final`, { optionId: created.options[1].id });
		expect(chosen.body.finalOptionId).toBe(created.options[1].id);
		expect(chosen.body.closed).toBe(true);
		expect((await s.post(`/api/v1/groups/polls/${id}/final`, { optionId: null })).body.finalOptionId).toBeNull();
		expect((await s.post(`/api/v1/groups/polls/${id}/final`, { optionId: 'nope' })).status).toBe(400);

		const rotated = await s.post(`/api/v1/groups/polls/${id}/rotate-token`);
		expect(rotated.body.token).not.toBe(created.token);
		expect((await s.get(`/api/v1/public/groups/${created.token}`)).status).toBe(404);
		expect((await s.get(`/api/v1/public/groups/${rotated.body.token}`)).status).toBe(200);

		expect((await s.del(`/api/v1/groups/polls/${id}`)).status).toBe(204);
		expect((await s.get(`/api/v1/public/groups/${rotated.body.token}`)).status).toBe(404);
	});
});

describe('groups mock: public poll', () => {
	const make = async (extra: Record<string, unknown> = {}) => {
		const s = await setup();
		const poll = (await s.post('/api/v1/groups/polls', { title: 'Wann?', kind: 'date', choiceMode: 'multi', options: [{ date: '2026-12-01' }, { date: '2026-12-02' }], ...extra })).body;
		return { s, poll, base: `/api/v1/public/groups/${poll.token}` };
	};

	it('works without a session or CSRF token and exposes no ids or owner data', async () => {
		const api = createMockApi();
		const options = api.handle({ method: 'POST', path: '/api/v1/auth/login/options', body: {}, cookies: {} });
		const login = api.handle({ method: 'POST', path: '/api/v1/auth/login/verify', body: { challengeId: (options.body as any).challengeId, credential: { id: 'mock-login' } }, cookies: {} });
		const cookies = { tt_session: login.sessionCookie as string };
		const csrfToken = (login.body as any).csrfToken as string;
		const poll = api.handle({ method: 'POST', path: '/api/v1/groups/polls', body: { title: 'Wann?', kind: 'text', choiceMode: 'multi', options: [{ label: 'a' }] }, cookies, csrfToken }).body as any;
		const base = `/api/v1/public/groups/${poll.token}`;
		const view = api.handle({ method: 'GET', path: base, cookies: {} });
		expect(view.status).toBe(200);
		const shown = (view.body as any).poll;
		expect(shown.id).toBeUndefined();
		expect(shown.createdAt).toBeUndefined();
		expect(shown.token).toBeUndefined();
		// writes need neither a session nor a CSRF token, only the link
		const cast = api.handle({ method: 'POST', path: `${base}/votes`, body: { name: 'Gast', answers: [{ optionId: shown.options[0].id, answer: 'yes' }] }, cookies: {} });
		expect(cast.status).toBe(201);
		// the owner endpoints still refuse anonymous callers
		expect(api.handle({ method: 'GET', path: '/api/v1/groups/polls', cookies: {} }).status).toBe(401);
	});

	it('answers unknown and malformed tokens with 404', async () => {
		const { s } = await make();
		expect((await s.raw('GET', '/api/v1/public/groups/short')).status).toBe(404);
		expect((await s.raw('GET', `/api/v1/public/groups/${'x'.repeat(43)}`)).status).toBe(404);
	});

	it('casts, edits and withdraws a vote with the edit secret and refuses duplicates', async () => {
		const { s, poll, base } = await make();
		const [a, b] = poll.options;
		const cast = await s.raw('POST', `${base}/votes`, { name: 'Anna', answers: [{ optionId: a.id, answer: 'yes' }, { optionId: b.id, answer: 'maybe' }] });
		expect(cast.status).toBe(201);
		expect(cast.body.editSecret).toBeTruthy();
		expect(cast.body.vote.name).toBe('Anna');
		const taken = await s.raw('POST', `${base}/votes`, { name: '  anna ', answers: [{ optionId: a.id, answer: 'yes' }] });
		expect(taken.status).toBe(409);
		expect(taken.body.error.code).toBe('name_taken');

		const id = cast.body.vote.id;
		expect((await s.raw('PUT', `${base}/votes/${id}`, { name: 'Anna', answers: [{ optionId: a.id, answer: 'no' }] })).body.error.code).toBe('edit_secret_invalid');
		expect((await s.raw('PUT', `${base}/votes/${id}`, { name: 'Anna', answers: [{ optionId: a.id, answer: 'no' }] }, { 'X-Edit-Secret': 'wrong' })).status).toBe(403);
		const updated = await s.raw('PUT', `${base}/votes/${id}`, { name: 'Anna K.', answers: [{ optionId: a.id, answer: 'no' }, { optionId: b.id, answer: 'yes' }] }, { 'X-Edit-Secret': cast.body.editSecret });
		expect(updated.status).toBe(200);
		expect(updated.body.name).toBe('Anna K.');
		const view = (await s.raw('GET', base)).body.poll;
		expect(view.tally.find((t: any) => t.optionId === b.id)).toMatchObject({ yes: 1, maybe: 0, no: 0 });
		expect(view.votes[0].answers).toEqual([{ optionId: b.id, answer: 'yes' }]);
		expect((await s.raw('DELETE', `${base}/votes/${id}`, undefined, { 'X-Edit-Secret': cast.body.editSecret })).status).toBe(204);
		expect((await s.raw('GET', base)).body.poll.voteCount).toBe(0);
	});

	it('enforces the answer rules of single and multi polls', async () => {
		const single = await make({ kind: 'text', choiceMode: 'single', options: [{ label: 'A' }, { label: 'B' }] });
		const [a, b] = single.poll.options;
		const vote = (answers: unknown[]) => single.s.raw('POST', `${single.base}/votes`, { name: `n${Math.random()}`, answers }).then((r) => `${r.status} ${r.body.error?.code ?? ''}`.trim());
		expect(await vote([{ optionId: a.id, answer: 'yes' }, { optionId: b.id, answer: 'yes' }])).toBe('400 answers_invalid');
		expect(await vote([{ optionId: a.id, answer: 'no' }])).toBe('400 answers_invalid');
		expect(await vote([{ optionId: a.id, answer: 'maybe' }])).toBe('400 answers_invalid');
		expect(await vote([{ optionId: 'unknown', answer: 'yes' }])).toBe('400 answers_invalid');
		expect(await vote([{ optionId: a.id, answer: 'yes' }])).toBe('201');
	});

	it('hides votes and tally while open and shows them after closing; the owner always sees them', async () => {
		const { s, poll, base } = await make({ hideResults: true });
		await s.raw('POST', `${base}/votes`, { name: 'Ben', answers: [{ optionId: poll.options[0].id, answer: 'yes' }] });
		const open = (await s.raw('GET', base)).body.poll;
		expect(open.resultsVisible).toBe(false);
		expect(open.votes).toBeUndefined();
		expect(open.tally).toBeUndefined();
		expect(open.voteCount).toBe(1);
		expect((await s.get(`/api/v1/groups/polls/${poll.id}`)).body.votes).toHaveLength(1);
		await s.post(`/api/v1/groups/polls/${poll.id}/close`);
		expect((await s.raw('GET', base)).body.poll.votes).toHaveLength(1);
	});

	it('refuses changes after closing or when the deadline has passed', async () => {
		let now = Date.now();
		const s = await setup({ now: () => now });
		const poll = (await s.post('/api/v1/groups/polls', { title: 'T', kind: 'text', choiceMode: 'multi', options: [{ label: 'A' }], deadline: new Date(now + 3_600_000).toISOString() })).body;
		const base = `/api/v1/public/groups/${poll.token}`;
		const cast = await s.raw('POST', `${base}/votes`, { name: 'C', answers: [{ optionId: poll.options[0].id, answer: 'yes' }] });
		expect(cast.status).toBe(201);
		now += 2 * 3_600_000;
		const late = await s.raw('POST', `${base}/votes`, { name: 'D', answers: [{ optionId: poll.options[0].id, answer: 'yes' }] });
		expect(late.status).toBe(409);
		expect(late.body.error.code).toBe('group_closed');
		expect((await s.raw('PUT', `${base}/votes/${cast.body.vote.id}`, { name: 'C', answers: [{ optionId: poll.options[0].id, answer: 'yes' }] }, { 'X-Edit-Secret': cast.body.editSecret })).status).toBe(409);
		expect((await s.raw('GET', base)).body.poll.closed).toBe(true);
		// the owner can still remove the vote and reopen (clears the elapsed deadline)
		expect((await s.del(`/api/v1/groups/polls/${poll.id}/votes/${cast.body.vote.id}`)).status).toBe(204);
		const reopened = await s.post(`/api/v1/groups/polls/${poll.id}/reopen`);
		expect(reopened.body.closed).toBe(false);
		expect(reopened.body.deadline).toBeNull();
	});
});

describe('groups mock: orders, entries, catalogs', () => {
	it('adds, groups, takes over, edits and exports entries', async () => {
		const s = await setup();
		const catalog = (await s.post('/api/v1/groups/catalogs', { name: 'Döner', items: [{ name: 'Döner', priceCents: 700 }, { name: 'Falafel' }] })).body;
		const order = (await s.post('/api/v1/groups/orders', { title: 'Dönerstag', catalogId: catalog.id })).body;
		const base = `/api/v1/public/groups/${order.token}`;
		const first = await s.raw('POST', `${base}/entries`, { name: 'Anna', item: 'Döner', quantity: 2, priceCents: 700, note: 'ohne Zwiebeln' });
		expect(first.status).toBe(201);
		const taken = await s.raw('POST', `${base}/entries/${first.body.entry.id}/take`, { name: 'Ben', quantity: 1 });
		expect(taken.status).toBe(201);
		expect(taken.body.entry).toMatchObject({ name: 'Ben', item: 'Döner', priceCents: 700, note: 'ohne Zwiebeln', quantity: 1 });
		expect(taken.body.editSecret).not.toBe(first.body.editSecret);

		const view = (await s.raw('GET', base)).body.order;
		expect(view.id).toBeUndefined();
		expect(view.catalogId).toBeUndefined();
		expect(view.aggregated).toEqual([{ item: 'Döner', note: 'ohne Zwiebeln', priceCents: 700, quantity: 3, names: ['Anna', 'Ben'] }]);
		expect(view.totalCents).toBe(2100);
		expect(view.suggestions.map((i: any) => i.name)).toEqual(['Döner', 'Falafel']);

		expect((await s.raw('PUT', `${base}/entries/${taken.body.entry.id}`, { name: 'Ben', item: 'Falafel', quantity: 1 }, { 'X-Edit-Secret': first.body.editSecret })).status).toBe(403);
		const edited = await s.raw('PUT', `${base}/entries/${taken.body.entry.id}`, { name: 'Ben', item: 'Falafel', quantity: 1 }, { 'X-Edit-Secret': taken.body.editSecret });
		expect(edited.body).toMatchObject({ item: 'Falafel', priceCents: null });
		expect((await s.raw('GET', base)).body.order.unpricedQuantity).toBe(1);

		const csv = await s.mock.fetch(`${base}/export?format=csv`);
		expect(csv.status).toBe(200);
		expect(csv.headers.get('Content-Disposition')).toContain('attachment');
		expect(await csv.text()).toContain('Name;Gericht;Notiz;Menge;Preis (EUR)');
		const txt = await s.mock.fetch(`${base}/export?format=txt`);
		expect(await txt.text()).toContain('2x Döner (ohne Zwiebeln) - Anna');
		expect((await s.raw('GET', `${base}/export?format=pdf`)).status).toBe(400);
		// polls have no export
		const poll = (await s.post('/api/v1/groups/polls', { title: 'P', kind: 'text', choiceMode: 'single', options: [{ label: 'a' }] })).body;
		expect((await s.raw('GET', `/api/v1/public/groups/${poll.token}/export`)).status).toBe(404);
	});

	it('guards CSV against formula injection and validates entries', async () => {
		const s = await setup();
		const order = (await s.post('/api/v1/groups/orders', { title: 'O' })).body;
		const base = `/api/v1/public/groups/${order.token}`;
		await s.raw('POST', `${base}/entries`, { name: '=cmd', item: '+SUM(A1)' });
		expect(await (await s.mock.fetch(`${base}/export?format=csv`)).text()).toContain("'=cmd;'+SUM(A1)");
		const code = (body: unknown) => s.raw('POST', `${base}/entries`, body).then((r) => r.status);
		expect(await code({ name: 'a', item: '' })).toBe(400);
		expect(await code({ name: 'a', item: 'x', quantity: 100 })).toBe(400);
		expect(await code({ name: 'a', item: 'x', priceCents: -1 })).toBe(400);
		expect(await code({ name: 'a‮b', item: 'x' })).toBe(400);
	});

	it('refuses entries after closing and lets the owner remove entries and rotate the link', async () => {
		const s = await setup();
		const order = (await s.post('/api/v1/groups/orders', { title: 'O', deadline: future() })).body;
		const base = `/api/v1/public/groups/${order.token}`;
		const entry = (await s.raw('POST', `${base}/entries`, { name: 'a', item: 'x' })).body;
		await s.post(`/api/v1/groups/orders/${order.id}/close`);
		const closed = await s.raw('POST', `${base}/entries`, { name: 'b', item: 'y' });
		expect(closed.body.error.code).toBe('group_closed');
		expect((await s.raw('DELETE', `${base}/entries/${entry.entry.id}`, undefined, { 'X-Edit-Secret': entry.editSecret })).status).toBe(409);
		expect((await s.del(`/api/v1/groups/orders/${order.id}/entries/${entry.entry.id}`)).status).toBe(204);
		expect((await s.get(`/api/v1/groups/orders/${order.id}`)).body.entryCount).toBe(0);
	});

	it('manages catalogs and suggests dishes from earlier orders', async () => {
		const s = await setup();
		const catalog = await s.post('/api/v1/groups/catalogs', { name: 'K', items: [{ name: 'A', priceCents: 100 }] });
		expect(catalog.status).toBe(201);
		expect((await s.put(`/api/v1/groups/catalogs/${catalog.body.id}`, { name: 'K2', items: [] })).body).toMatchObject({ name: 'K2', itemCount: 0 });
		expect((await s.post('/api/v1/groups/catalogs', { name: '', items: [] })).status).toBe(400);
		expect((await s.post('/api/v1/groups/orders', { title: 'O', catalogId: crypto.randomUUID() })).status).toBe(400);
		const order = (await s.post('/api/v1/groups/orders', { title: 'O', catalogId: catalog.body.id })).body;
		await s.raw('POST', `/api/v1/public/groups/${order.token}/entries`, { name: 'a', item: 'Pizza', priceCents: 900 });
		expect((await s.get('/api/v1/groups/orders/suggestions')).body).toEqual([{ item: 'Pizza', priceCents: 900, count: 1 }]);
		expect((await s.del(`/api/v1/groups/catalogs/${catalog.body.id}`)).status).toBe(204);
		expect((await s.get(`/api/v1/groups/orders/${order.id}`)).body.catalogId).toBeNull();
	});
});

describe('groups mock: module switch', () => {
	it('answers 404 module_disabled on the owner API and hides the public links when the owner switched the module off', async () => {
		const s = await setup();
		const poll = (await s.post('/api/v1/groups/polls', { title: 'T', kind: 'text', choiceMode: 'single', options: [{ label: 'a' }] })).body;
		await s.put('/api/v1/me/modules', { modules: { groups: false } });
		expect((await s.get('/api/v1/groups/polls')).body.error.code).toBe('module_disabled');
		expect((await s.get(`/api/v1/public/groups/${poll.token}`)).body.error.code).toBe('not_found');
		await s.put('/api/v1/me/modules', { modules: { groups: true } });
		expect((await s.get(`/api/v1/public/groups/${poll.token}`)).status).toBe(200);
	});

	it('reports the operator lock on the public API', async () => {
		const s = await setup({ modulesDisabled: ['groups'] });
		expect((await s.get('/api/v1/groups/polls')).body.error.code).toBe('module_disabled');
		expect((await s.raw('GET', `/api/v1/public/groups/${'a'.repeat(43)}`)).status).toBe(404);
		const modules = (await s.get('/api/v1/modules')).body as any[];
		expect(modules.find((m) => m.key === 'groups')).toMatchObject({ effective: false, lockedByOperator: true });
	});
});
