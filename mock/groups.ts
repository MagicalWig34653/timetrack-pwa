import type { MockResponse } from './api.ts';

// Mock of the groups module (contract v0.37.0, ADR-0033): public polls and group orders with catalogs.
// Owner API /api/v1/groups/** (session, module `groups`) and the public participant API /api/v1/public/groups/{token}/** that
// needs no login: the 43-character link token is the only credential, own votes/entries are changed with the edit secret
// (header X-Edit-Secret). The rules follow the backend (limits, name_taken, group_closed, answers_invalid, hidden results,
// deadline_in_past, CSV formula guard); rate limiting is not mocked.

export type OwnerModuleState = 'ok' | 'off' | 'locked';

interface Deps {
	clock: () => number;
	/** module state of the link owner: `off` hides the links (404 not_found), `locked` is the operator lock (404 module_disabled) */
	ownerState: (ownerId: string) => OwnerModuleState;
}

interface Answer {
	optionId: string;
	answer: 'yes' | 'maybe' | 'no';
}
interface Vote {
	id: string;
	name: string;
	answers: Answer[];
	secret: string;
	createdAt: string;
	updatedAt: string;
}
interface Option {
	id: string;
	label: string | null;
	date: string | null;
	startTime: string | null;
	endTime: string | null;
}
interface Poll {
	id: string;
	ownerId: string;
	token: string;
	title: string;
	description: string | null;
	kind: 'text' | 'date';
	choiceMode: 'single' | 'multi';
	timeZone: string | null;
	options: Option[];
	deadline: string | null;
	hideResults: boolean;
	closedAt: string | null;
	finalOptionId: string | null;
	votes: Vote[];
	createdAt: string;
	updatedAt: string;
}
interface Entry {
	id: string;
	name: string;
	item: string;
	note: string | null;
	quantity: number;
	priceCents: number | null;
	secret: string;
	createdAt: string;
	updatedAt: string;
}
interface Order {
	id: string;
	ownerId: string;
	token: string;
	title: string;
	note: string | null;
	deadline: string | null;
	closedAt: string | null;
	catalogId: string | null;
	entries: Entry[];
	createdAt: string;
}
interface CatalogItem {
	name: string;
	priceCents: number | null;
}
interface Catalog {
	id: string;
	ownerId: string;
	name: string;
	items: CatalogItem[];
	createdAt: string;
	updatedAt: string;
}

const LIMITS = { polls: 200, orders: 200, catalogs: 30, options: 50, votes: 500, entries: 200, catalogItems: 200 };

const fail = (status: number, code: string, message = code): MockResponse => ({ status, body: { error: { code, message } } });
const bad = () => fail(400, 'bad_request');
const uuid = () => crypto.randomUUID();
const randomUrlSafe = (): string => {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const isTokenShape = (value: string) => /^[A-Za-z0-9_-]{43}$/.test(value);
const norm = (value: string | null | undefined) => (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** Trims and rejects control and bidi-override characters; null = invalid. Length is counted in Unicode scalars. */
function cleanText(value: unknown, max: number, required: boolean): string | null | undefined {
	if (value === undefined || value === null) return required ? null : undefined;
	if (typeof value !== 'string') return null;
	const text = value.trim();
	// eslint-disable-next-line no-control-regex
	if (/[\u0000-\u0008\u000b-\u001f\u007f‪-‮⁦-⁩]/.test(text)) return null;
	if ([...text].length > max) return null;
	if (required && text === '') return null;
	return text;
}

const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z'));
const isTime = (value: unknown): value is string => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

export function createGroupsMock(deps: Deps) {
	const now = () => deps.clock();
	const iso = () => new Date(now()).toISOString();
	const polls: Poll[] = [];
	const orders: Order[] = [];
	const catalogs: Catalog[] = [];

	const isClosed = (group: { closedAt: string | null; deadline: string | null }) => !!group.closedAt || (!!group.deadline && Date.parse(group.deadline) <= now());

	/** deadline input: undefined = absent, null = remove; returns an error response for the past or garbage */
	function parseDeadline(value: unknown): { value: string | null | undefined } | MockResponse {
		if (value === undefined) return { value: undefined };
		if (value === null) return { value: null };
		if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return bad();
		if (Date.parse(value) <= now()) return fail(400, 'deadline_in_past', 'Die Frist liegt in der Vergangenheit.');
		return { value: new Date(value).toISOString() };
	}
	const isResponse = (value: unknown): value is MockResponse => typeof value === 'object' && value !== null && 'status' in value;

	// ---- views ----
	function pollOptionView(option: Option) {
		return { id: option.id, label: option.label, date: option.date, startTime: option.startTime, endTime: option.endTime };
	}
	function voteView(vote: Vote) {
		return { id: vote.id, name: vote.name, answers: vote.answers.filter((a) => a.answer !== 'no'), createdAt: vote.createdAt, updatedAt: vote.updatedAt };
	}
	function pollView(poll: Poll, owner: boolean, withToken = false) {
		const closed = isClosed(poll);
		const visible = owner || !poll.hideResults || closed;
		const tally = poll.options.map((option) => {
			const count = { optionId: option.id, yes: 0, maybe: 0, no: 0 };
			for (const vote of poll.votes) count[vote.answers.find((a) => a.optionId === option.id)?.answer ?? 'no'] += 1;
			return count;
		});
		return {
			...(owner ? { id: poll.id } : {}),
			title: poll.title,
			description: poll.description,
			kind: poll.kind,
			choiceMode: poll.choiceMode,
			timeZone: poll.timeZone,
			options: poll.options.map(pollOptionView),
			deadline: poll.deadline,
			hideResults: poll.hideResults,
			closed,
			closedAt: closed ? (poll.closedAt ?? poll.deadline) : null,
			finalOptionId: poll.finalOptionId,
			resultsVisible: visible,
			voteCount: poll.votes.length,
			...(visible ? { votes: poll.votes.map(voteView), tally } : {}),
			...(owner ? { createdAt: poll.createdAt, updatedAt: poll.updatedAt } : {}),
			...(withToken ? { token: poll.token, path: `/g/${poll.token}` } : {})
		};
	}
	function entryView(entry: Entry) {
		return { id: entry.id, name: entry.name, item: entry.item, note: entry.note, quantity: entry.quantity, priceCents: entry.priceCents, createdAt: entry.createdAt, updatedAt: entry.updatedAt };
	}
	function aggregate(order: Order) {
		const lines = new Map<string, { item: string; note: string | null; priceCents: number | null; quantity: number; names: string[] }>();
		for (const entry of order.entries) {
			const key = `${norm(entry.item)}|${norm(entry.note)}|${entry.priceCents ?? ''}`;
			const line = lines.get(key) ?? { item: entry.item, note: entry.note, priceCents: entry.priceCents, quantity: 0, names: [] };
			line.quantity += entry.quantity;
			if (!line.names.includes(entry.name)) line.names.push(entry.name);
			lines.set(key, line);
		}
		return [...lines.values()].sort((a, b) => b.quantity - a.quantity);
	}
	function orderView(order: Order, owner: boolean, withToken = false) {
		const catalog = order.catalogId ? catalogs.find((c) => c.id === order.catalogId) : undefined;
		const priced = order.entries.filter((e) => e.priceCents !== null);
		const closed = isClosed(order);
		return {
			...(owner ? { id: order.id, catalogId: order.catalogId, createdAt: order.createdAt } : {}),
			title: order.title,
			note: order.note,
			deadline: order.deadline,
			closed,
			closedAt: closed ? (order.closedAt ?? order.deadline) : null,
			entryCount: order.entries.length,
			entries: order.entries.map(entryView),
			aggregated: aggregate(order),
			totalCents: priced.reduce((sum, e) => sum + e.quantity * (e.priceCents ?? 0), 0),
			unpricedQuantity: order.entries.filter((e) => e.priceCents === null).reduce((sum, e) => sum + e.quantity, 0),
			suggestions: catalog ? catalog.items.map((i) => ({ name: i.name, priceCents: i.priceCents })) : [],
			...(withToken ? { token: order.token, path: `/g/${order.token}` } : {})
		};
	}
	const catalogView = (catalog: Catalog) => ({ id: catalog.id, name: catalog.name, items: catalog.items, itemCount: catalog.items.length, createdAt: catalog.createdAt, updatedAt: catalog.updatedAt });

	// ---- shared validation ----
	function parseAnswers(poll: Poll, raw: unknown): Answer[] | MockResponse {
		if (!Array.isArray(raw)) return bad();
		const seen = new Set<string>();
		const answers: Answer[] = [];
		for (const item of raw) {
			if (typeof item !== 'object' || item === null) return bad();
			const { optionId, answer } = item as { optionId?: unknown; answer?: unknown };
			if (typeof optionId !== 'string' || !poll.options.some((o) => o.id === optionId) || seen.has(optionId)) return fail(400, 'answers_invalid', 'Die Antworten passen nicht zu den Optionen.');
			if (answer !== 'yes' && answer !== 'maybe' && answer !== 'no') return fail(400, 'answers_invalid', 'Die Antworten passen nicht zu den Optionen.');
			if (answer === 'maybe' && poll.kind === 'text') return fail(400, 'answers_invalid', 'Bei dieser Umfrage ist „Vielleicht“ nicht möglich.');
			seen.add(optionId);
			if (answer !== 'no') answers.push({ optionId, answer });
		}
		const yes = answers.filter((a) => a.answer === 'yes').length;
		const maybe = answers.filter((a) => a.answer === 'maybe').length;
		const invalid = fail(400, 'answers_invalid', poll.choiceMode === 'single' ? 'Wähle genau eine Möglichkeit.' : 'Wähle mindestens eine Möglichkeit.');
		if (poll.choiceMode === 'single' && (yes !== 1 || maybe > 0)) return invalid;
		if (poll.choiceMode === 'multi' && poll.kind === 'text' && yes < 1) return invalid;
		return answers;
	}
	function parseVote(poll: Poll, body: any, ownVoteId?: string): { name: string; answers: Answer[] } | MockResponse {
		const name = cleanText(body?.name, 60, true);
		if (!name) return bad();
		const answers = parseAnswers(poll, body?.answers);
		if (isResponse(answers)) return answers;
		if (poll.votes.some((v) => v.id !== ownVoteId && norm(v.name) === norm(name))) return fail(409, 'name_taken', 'Dieser Name ist schon vergeben.');
		return { name, answers };
	}
	function parseEntry(body: any): Omit<Entry, 'id' | 'secret' | 'createdAt' | 'updatedAt'> | MockResponse {
		const name = cleanText(body?.name, 60, true);
		const item = cleanText(body?.item, 200, true);
		const note = cleanText(body?.note, 200, false);
		if (!name || !item || note === null) return bad();
		const quantity = body?.quantity ?? 1;
		if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) return bad();
		const price = body?.priceCents ?? null;
		if (price !== null && (!Number.isInteger(price) || price < 0 || price > 1_000_000)) return bad();
		return { name, item, note: note || null, quantity, priceCents: price };
	}

	// ---- owner API ----
	function ownerPoll(accountId: string, id: string): Poll | undefined {
		return polls.find((p) => p.id === id && p.ownerId === accountId);
	}
	function ownerOrder(accountId: string, id: string): Order | undefined {
		return orders.find((o) => o.id === id && o.ownerId === accountId);
	}

	function createPoll(accountId: string, body: any): MockResponse {
		if (polls.filter((p) => p.ownerId === accountId).length >= LIMITS.polls) return fail(409, 'too_many_polls');
		const title = cleanText(body?.title, 120, true);
		const description = cleanText(body?.description, 2000, false);
		if (!title || description === null) return bad();
		if (body?.kind !== 'text' && body?.kind !== 'date') return bad();
		if (body?.choiceMode !== 'single' && body?.choiceMode !== 'multi') return bad();
		if (!Array.isArray(body.options) || body.options.length < 1 || body.options.length > LIMITS.options) return bad();
		const options: Option[] = [];
		for (const raw of body.options) {
			const label = cleanText(raw?.label, 200, body.kind === 'text');
			if (label === null) return bad();
			let date: string | null = null;
			let startTime: string | null = null;
			let endTime: string | null = null;
			if (body.kind === 'date') {
				if (!isDate(raw?.date)) return bad();
				date = raw.date;
				if (raw.startTime !== undefined && raw.startTime !== null && raw.startTime !== '') {
					if (!isTime(raw.startTime)) return bad();
					startTime = raw.startTime;
				}
				if (raw.endTime !== undefined && raw.endTime !== null && raw.endTime !== '') {
					if (!startTime || !isTime(raw.endTime) || raw.endTime <= startTime) return bad();
					endTime = raw.endTime;
				}
			}
			options.push({ id: uuid(), label: label || null, date, startTime, endTime });
		}
		const deadline = parseDeadline(body.deadline);
		if (isResponse(deadline)) return deadline;
		const stamp = iso();
		const poll: Poll = {
			id: uuid(), ownerId: accountId, token: randomUrlSafe(), title, description: description || null, kind: body.kind, choiceMode: body.choiceMode,
			timeZone: body.kind === 'date' ? (typeof body.timeZone === 'string' ? body.timeZone : 'Europe/Berlin') : null,
			options, deadline: deadline.value ?? null, hideResults: body.hideResults === true, closedAt: null, finalOptionId: null, votes: [], createdAt: stamp, updatedAt: stamp
		};
		polls.unshift(poll);
		return { status: 201, body: pollView(poll, true, true) };
	}

	function createOrder(accountId: string, body: any): MockResponse {
		if (orders.filter((o) => o.ownerId === accountId).length >= LIMITS.orders) return fail(409, 'too_many_orders');
		const title = cleanText(body?.title, 120, true);
		const note = cleanText(body?.note, 2000, false);
		if (!title || note === null) return bad();
		if (body.catalogId && !catalogs.some((c) => c.id === body.catalogId && c.ownerId === accountId)) return bad();
		const deadline = parseDeadline(body.deadline);
		if (isResponse(deadline)) return deadline;
		const order: Order = { id: uuid(), ownerId: accountId, token: randomUrlSafe(), title, note: note || null, deadline: deadline.value ?? null, closedAt: null, catalogId: body.catalogId ?? null, entries: [], createdAt: iso() };
		orders.unshift(order);
		return { status: 201, body: orderView(order, true, true) };
	}

	function parseCatalog(body: any): { name: string; items: CatalogItem[] } | MockResponse {
		const name = cleanText(body?.name, 80, true);
		if (!name || !Array.isArray(body.items) || body.items.length > LIMITS.catalogItems) return bad();
		const items: CatalogItem[] = [];
		for (const raw of body.items) {
			const itemName = cleanText(raw?.name, 200, true);
			const price = raw?.priceCents ?? null;
			if (!itemName || (price !== null && (!Number.isInteger(price) || price < 0 || price > 1_000_000))) return bad();
			items.push({ name: itemName, priceCents: price });
		}
		return { name, items };
	}

	function handleOwner(accountId: string, req: { method: string; path: string; query?: string; body?: any }): MockResponse | null {
		const { method, path } = req;
		const body = req.body ?? {};
		let m: RegExpMatchArray | null;
		if (!path.startsWith('/api/v1/groups/')) return null;

		if (path === '/api/v1/groups/polls') {
			if (method === 'GET') return { status: 200, body: polls.filter((p) => p.ownerId === accountId).map((p) => ({ id: p.id, title: p.title, kind: p.kind, choiceMode: p.choiceMode, deadline: p.deadline, closed: isClosed(p), closedAt: isClosed(p) ? (p.closedAt ?? p.deadline) : null, voteCount: p.votes.length, createdAt: p.createdAt })) };
			if (method === 'POST') return createPoll(accountId, body);
		}
		if (path === '/api/v1/groups/orders') {
			if (method === 'GET') return { status: 200, body: orders.filter((o) => o.ownerId === accountId).map((o) => ({ id: o.id, title: o.title, deadline: o.deadline, closed: isClosed(o), closedAt: isClosed(o) ? (o.closedAt ?? o.deadline) : null, entryCount: o.entries.length, createdAt: o.createdAt })) };
			if (method === 'POST') return createOrder(accountId, body);
		}
		if (path === '/api/v1/groups/orders/suggestions' && method === 'GET') {
			const counts = new Map<string, { item: string; priceCents: number | null; count: number }>();
			for (const order of orders.filter((o) => o.ownerId === accountId).slice(0, 50)) {
				for (const entry of order.entries) {
					const key = norm(entry.item);
					const hit = counts.get(key) ?? { item: entry.item, priceCents: entry.priceCents, count: 0 };
					hit.count += 1;
					counts.set(key, hit);
				}
			}
			return { status: 200, body: [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 20) };
		}

		if ((m = path.match(/^\/api\/v1\/groups\/polls\/([^/]+)(?:\/([a-z-]+))?(?:\/([^/]+))?$/))) {
			const poll = ownerPoll(accountId, m[1]);
			if (!poll) return fail(404, 'not_found');
			const action = m[2];
			if (!action) {
				if (method === 'GET') return { status: 200, body: pollView(poll, true) };
				if (method === 'DELETE') {
					polls.splice(polls.indexOf(poll), 1);
					return { status: 204 };
				}
				if (method === 'PATCH') {
					const title = body.title === undefined ? undefined : cleanText(body.title, 120, true);
					let description: string | undefined = '';
					if (body.description !== null) {
						const parsed = cleanText(body.description, 2000, false);
						if (parsed === null) return bad();
						description = parsed;
					}
					if (title === null) return bad();
					const deadline = parseDeadline(body.deadline);
					if (isResponse(deadline)) return deadline;
					if (title) poll.title = title;
					if (description !== undefined && body.description !== undefined) poll.description = description || null;
					if (deadline.value !== undefined) poll.deadline = deadline.value;
					if (typeof body.hideResults === 'boolean') poll.hideResults = body.hideResults;
					poll.updatedAt = iso();
					return { status: 200, body: pollView(poll, true) };
				}
			}
			if (action === 'close' && method === 'POST') {
				poll.closedAt ??= iso();
				return { status: 200, body: pollView(poll, true) };
			}
			if (action === 'reopen' && method === 'POST') {
				poll.closedAt = null;
				if (poll.deadline && Date.parse(poll.deadline) <= now()) poll.deadline = null;
				return { status: 200, body: pollView(poll, true) };
			}
			if (action === 'final' && method === 'POST') {
				if (body.optionId === null) poll.finalOptionId = null;
				else if (typeof body.optionId === 'string' && poll.options.some((o) => o.id === body.optionId)) {
					poll.finalOptionId = body.optionId;
					poll.closedAt ??= iso();
				} else return bad();
				return { status: 200, body: pollView(poll, true) };
			}
			if (action === 'rotate-token' && method === 'POST') {
				poll.token = randomUrlSafe();
				return { status: 200, body: pollView(poll, true, true) };
			}
			if (action === 'votes' && m[3] && method === 'DELETE') {
				const index = poll.votes.findIndex((v) => v.id === m![3]);
				if (index < 0) return fail(404, 'not_found');
				poll.votes.splice(index, 1);
				return { status: 204 };
			}
			return null;
		}

		if ((m = path.match(/^\/api\/v1\/groups\/orders\/([^/]+)(?:\/([a-z-]+))?(?:\/([^/]+))?$/))) {
			const order = ownerOrder(accountId, m[1]);
			if (!order) return fail(404, 'not_found');
			const action = m[2];
			if (!action) {
				if (method === 'GET') return { status: 200, body: orderView(order, true) };
				if (method === 'DELETE') {
					orders.splice(orders.indexOf(order), 1);
					return { status: 204 };
				}
				if (method === 'PATCH') {
					const title = body.title === undefined ? undefined : cleanText(body.title, 120, true);
					let note: string | undefined = '';
					if (body.note !== null) {
						const parsed = cleanText(body.note, 2000, false);
						if (parsed === null) return bad();
						note = parsed;
					}
					if (title === null) return bad();
					if (body.catalogId && !catalogs.some((c) => c.id === body.catalogId && c.ownerId === accountId)) return bad();
					const deadline = parseDeadline(body.deadline);
					if (isResponse(deadline)) return deadline;
					if (title) order.title = title;
					if (note !== undefined && body.note !== undefined) order.note = note || null;
					if (deadline.value !== undefined) order.deadline = deadline.value;
					if (body.catalogId !== undefined) order.catalogId = body.catalogId;
					return { status: 200, body: orderView(order, true) };
				}
			}
			if (action === 'close' && method === 'POST') {
				order.closedAt ??= iso();
				return { status: 200, body: orderView(order, true) };
			}
			if (action === 'reopen' && method === 'POST') {
				order.closedAt = null;
				if (order.deadline && Date.parse(order.deadline) <= now()) order.deadline = null;
				return { status: 200, body: orderView(order, true) };
			}
			if (action === 'rotate-token' && method === 'POST') {
				order.token = randomUrlSafe();
				return { status: 200, body: orderView(order, true, true) };
			}
			if (action === 'entries' && m[3] && method === 'DELETE') {
				const index = order.entries.findIndex((e) => e.id === m![3]);
				if (index < 0) return fail(404, 'not_found');
				order.entries.splice(index, 1);
				return { status: 204 };
			}
			if (action === 'export' && method === 'GET') {
				const format = new URLSearchParams(req.query ?? '').get('format') ?? 'csv';
				if (format !== 'csv' && format !== 'txt') return bad();
				return exportOrder(order, format);
			}
			return null;
		}

		if (path === '/api/v1/groups/catalogs') {
			if (method === 'GET') return { status: 200, body: catalogs.filter((c) => c.ownerId === accountId).map(catalogView) };
			if (method === 'POST') {
				if (catalogs.filter((c) => c.ownerId === accountId).length >= LIMITS.catalogs) return fail(409, 'too_many_catalogs');
				const parsed = parseCatalog(body);
				if (isResponse(parsed)) return parsed;
				const stamp = iso();
				const catalog: Catalog = { id: uuid(), ownerId: accountId, ...parsed, createdAt: stamp, updatedAt: stamp };
				catalogs.push(catalog);
				return { status: 201, body: catalogView(catalog) };
			}
		}
		if ((m = path.match(/^\/api\/v1\/groups\/catalogs\/([^/]+)$/))) {
			const catalog = catalogs.find((c) => c.id === m![1] && c.ownerId === accountId);
			if (!catalog) return fail(404, 'not_found');
			if (method === 'GET') return { status: 200, body: catalogView(catalog) };
			if (method === 'PUT') {
				const parsed = parseCatalog(body);
				if (isResponse(parsed)) return parsed;
				Object.assign(catalog, parsed, { updatedAt: iso() });
				return { status: 200, body: catalogView(catalog) };
			}
			if (method === 'DELETE') {
				catalogs.splice(catalogs.indexOf(catalog), 1);
				for (const order of orders) if (order.catalogId === catalog.id) order.catalogId = null;
				return { status: 204 };
			}
		}
		return null;
	}

	// ---- export ----
	const csvCell = (value: string | number | null) => {
		let text = value === null ? '' : String(value);
		if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
		return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
	};
	const euros = (cents: number | null) => (cents === null ? '' : (cents / 100).toFixed(2).replace('.', ','));
	function exportOrder(order: Order, format: 'csv' | 'txt'): MockResponse {
		let text: string;
		if (format === 'csv') {
			const rows = [['Name', 'Gericht', 'Notiz', 'Menge', 'Preis (EUR)'], ...order.entries.map((e) => [e.name, e.item, e.note, e.quantity, euros(e.priceCents)])];
			text = rows.map((row) => row.map(csvCell).join(';')).join('\r\n') + '\r\n';
		} else {
			const lines = [order.title, ''];
			for (const line of aggregate(order)) lines.push(`${line.quantity}x ${line.item}${line.note ? ` (${line.note})` : ''} - ${line.names.join(', ')}`);
			const view = orderView(order, false);
			lines.push('', `Summe: ${euros(view.totalCents)} EUR${view.unpricedQuantity ? ` (+ ${view.unpricedQuantity} Stück ohne Preis)` : ''}`);
			text = lines.join('\n') + '\n';
		}
		return {
			status: 200,
			binary: {
				bytes: new TextEncoder().encode(text),
				contentType: format === 'csv' ? 'text/csv; charset=utf-8' : 'text/plain; charset=utf-8',
				headers: { 'Content-Disposition': `attachment; filename="bestellung.${format}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
			}
		};
	}

	// ---- public API ----
	function findByToken(token: string): { poll?: Poll; order?: Order } | null {
		if (!isTokenShape(token)) return null;
		const poll = polls.find((p) => p.token === token);
		if (poll) return { poll };
		const order = orders.find((o) => o.token === token);
		return order ? { order } : null;
	}

	/** Mock control (no auth in the real API either; only reachable in the mock): GET /api/v1/mock/groups/tokens lists the links. */
	function handlePublic(req: { method: string; path: string; body?: any; editSecret?: string; query?: string }): MockResponse | null {
		const m = req.path.match(/^\/api\/v1\/public\/groups\/([^/]+)(?:\/([a-z]+)(?:\/([^/]+)(?:\/([a-z]+))?)?)?$/);
		if (!m) return null;
		const { method, body } = req;
		const found = findByToken(decodeURIComponent(m[1]));
		const notFound = fail(404, 'not_found', 'Nicht gefunden.');
		if (!found) return notFound;
		const ownerId = (found.poll ?? found.order)!.ownerId;
		const state = deps.ownerState(ownerId);
		if (state === 'locked') return fail(404, 'module_disabled');
		if (state === 'off') return notFound;
		const [, , part, id, sub] = m;

		if (!part) {
			if (method !== 'GET') return null;
			return { status: 200, body: found.poll ? { type: 'poll', poll: pollView(found.poll, false) } : { type: 'order', order: orderView(found.order!, false) } };
		}
		const secretOk = (secret: string) => !!req.editSecret && req.editSecret === secret;

		if (found.poll) {
			const poll = found.poll;
			if (part === 'votes') {
				if (!id && method === 'POST') {
					if (isClosed(poll)) return fail(409, 'group_closed', 'Die Umfrage ist beendet.');
					if (poll.votes.length >= LIMITS.votes) return fail(409, 'group_full', 'Die Umfrage ist voll.');
					const parsed = parseVote(poll, body);
					if (isResponse(parsed)) return parsed;
					const stamp = iso();
					const vote: Vote = { id: uuid(), ...parsed, secret: randomUrlSafe(), createdAt: stamp, updatedAt: stamp };
					poll.votes.push(vote);
					return { status: 201, body: { vote: voteView(vote), editSecret: vote.secret } };
				}
				if (id && !sub) {
					const vote = poll.votes.find((v) => v.id === id);
					if (!vote) return notFound;
					if (!secretOk(vote.secret)) return fail(403, 'edit_secret_invalid', 'Der Bearbeitungsschlüssel passt nicht.');
					if (isClosed(poll)) return fail(409, 'group_closed', 'Die Umfrage ist beendet.');
					if (method === 'PUT') {
						const parsed = parseVote(poll, body, vote.id);
						if (isResponse(parsed)) return parsed;
						Object.assign(vote, parsed, { updatedAt: iso() });
						return { status: 200, body: voteView(vote) };
					}
					if (method === 'DELETE') {
						poll.votes.splice(poll.votes.indexOf(vote), 1);
						return { status: 204 };
					}
				}
			}
			return notFound;
		}

		const order = found.order!;
		if (part === 'export' && method === 'GET') {
			const format = new URLSearchParams(req.query ?? '').get('format') ?? 'csv';
			if (format !== 'csv' && format !== 'txt') return bad();
			return exportOrder(order, format);
		}
		if (part === 'entries') {
			if (!id && method === 'POST') {
				if (isClosed(order)) return fail(409, 'group_closed', 'Die Bestellrunde ist beendet.');
				if (order.entries.length >= LIMITS.entries) return fail(409, 'group_full', 'Die Bestellrunde ist voll.');
				const parsed = parseEntry(body);
				if (isResponse(parsed)) return parsed;
				const stamp = iso();
				const entry: Entry = { id: uuid(), ...parsed, secret: randomUrlSafe(), createdAt: stamp, updatedAt: stamp };
				order.entries.push(entry);
				return { status: 201, body: { entry: entryView(entry), editSecret: entry.secret } };
			}
			if (id && sub === 'take' && method === 'POST') {
				const source = order.entries.find((e) => e.id === id);
				if (!source) return notFound;
				if (isClosed(order)) return fail(409, 'group_closed', 'Die Bestellrunde ist beendet.');
				if (order.entries.length >= LIMITS.entries) return fail(409, 'group_full', 'Die Bestellrunde ist voll.');
				const parsed = parseEntry({ name: body?.name, quantity: body?.quantity, note: body?.note || source.note || undefined, item: source.item, priceCents: source.priceCents });
				if (isResponse(parsed)) return parsed;
				const stamp = iso();
				const entry: Entry = { id: uuid(), ...parsed, secret: randomUrlSafe(), createdAt: stamp, updatedAt: stamp };
				order.entries.push(entry);
				return { status: 201, body: { entry: entryView(entry), editSecret: entry.secret } };
			}
			if (id && !sub) {
				const entry = order.entries.find((e) => e.id === id);
				if (!entry) return notFound;
				if (!secretOk(entry.secret)) return fail(403, 'edit_secret_invalid', 'Der Bearbeitungsschlüssel passt nicht.');
				if (isClosed(order)) return fail(409, 'group_closed', 'Die Bestellrunde ist beendet.');
				if (method === 'PUT') {
					const parsed = parseEntry(body);
					if (isResponse(parsed)) return parsed;
					Object.assign(entry, parsed, { updatedAt: iso() });
					return { status: 200, body: entryView(entry) };
				}
				if (method === 'DELETE') {
					order.entries.splice(order.entries.indexOf(entry), 1);
					return { status: 204 };
				}
			}
		}
		return notFound;
	}

	/** Mock-only helpers for tests: raw access to the stores (never part of the API). */
	return { handleOwner, handlePublic, state: { polls, orders, catalogs } };
}
