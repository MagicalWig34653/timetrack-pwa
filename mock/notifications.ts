import type { MockResponse } from './api.ts';

// Mock of notifications, settings and Web Push subscriptions (contract v0.8.0, ADR-0010, behaviour per handoff C18).
// Mock-only hooks (authenticated):
//   POST /api/v1/mock/notify {kind?, title?, body?, url?, ageMinutes?, read?, count?}  creates notifications
//   POST /api/v1/mock/push {available?, testResult?: 'ok'|'failed', testLimit?}        configures the push service

const KINDS = ['running_timer', 'pending_suggestions', 'report_gap', 'document_submission', 'system'] as const;
const CATEGORIES = KINDS.filter((k) => k !== 'system');
type Kind = (typeof KINDS)[number];
const TIME = /^[0-2][0-9]:[0-5][0-9]$/;
const MAX_SUBSCRIPTIONS = 10;
const TEST_LIMIT_PER_HOUR = 5;

/** Valid uncompressed P-256 public key (base64url), so `pushManager.subscribe` accepts it in a real browser. */
export const MOCK_VAPID_PUBLIC_KEY = 'BBBor-TQmvD66r1vNEeVc7YYNaBaQZ20EWY8wS8fJ-FK305b4uT_i8mI444mmfMe7699EtyIV6zHkjH0d90k_Dw';

const DEFAULT_TEXT: Record<Kind, { title: string; body: string; url: string | null }> = {
	running_timer: { title: 'Timer läuft noch', body: 'Dein Timer läuft seit mehr als 10:00 Stunden.', url: '/' },
	pending_suggestions: { title: 'Offene Vorschläge', body: 'Du hast 2 offene Vorschläge der Automatik.', url: '/' },
	report_gap: { title: 'Berichtsheft-Erinnerung', body: 'Für diese Woche gibt es noch keine Berichtsheft-Einträge.', url: '/reports' },
	document_submission: { title: 'Unterlagen offen', body: 'Zu einer Abwesenheit fehlen noch Unterlagen.', url: '/absences' },
	system: { title: 'Hinweis', body: 'Eine Systemmeldung.', url: null }
};

const uuid = () => crypto.randomUUID();
const error = (status: number, code: string): MockResponse => ({ status, body: { error: { code, message: code } } });

interface Item {
	id: string;
	kind: Kind;
	title: string;
	body: string;
	url: string | null;
	createdAt: string;
	read: boolean;
	deleted: boolean;
}

interface Subscription {
	id: string;
	endpoint: string;
	host: string;
	userAgent: string | null;
	createdAt: string;
	lastSuccessAt: string | null;
	tests: number[];
}

interface CategorySettings {
	inApp: boolean;
	push: boolean;
	thresholdMinutes?: number;
	weekday?: number;
	time?: string;
}

interface Settings {
	categories: Record<string, CategorySettings>;
	quietStart: string | null;
	quietEnd: string | null;
}

function defaults(): Settings {
	return {
		categories: {
			running_timer: { inApp: true, push: true, thresholdMinutes: 600 },
			pending_suggestions: { inApp: true, push: true },
			report_gap: { inApp: true, push: true, weekday: 5, time: '15:00' },
			document_submission: { inApp: true, push: true }
		},
		quietStart: '22:00',
		quietEnd: '07:00'
	};
}

/** Validation of PUT /notifications/settings; returns the normalized document or null for 400. Mirrors the C18 rules. */
export function normalizeSettings(body: any): Settings | null {
	if (typeof body !== 'object' || body === null || typeof body.categories !== 'object' || body.categories === null || Array.isArray(body.categories)) return null;
	const result = defaults();
	for (const [kind, entry] of Object.entries<any>(body.categories)) {
		if (!(CATEGORIES as readonly string[]).includes(kind)) return null;
		if (typeof entry !== 'object' || entry === null) return null;
		if (typeof entry.inApp !== 'boolean' || typeof entry.push !== 'boolean') return null;
		const next: CategorySettings = { inApp: entry.inApp, push: entry.push };
		if (kind === 'running_timer') {
			const minutes = entry.thresholdMinutes ?? 600;
			if (!Number.isInteger(minutes) || minutes < 30 || minutes > 1440) return null;
			next.thresholdMinutes = minutes;
		} else if (entry.thresholdMinutes !== undefined) return null;
		if (kind === 'report_gap') {
			const weekday = entry.weekday ?? 5;
			const time = entry.time ?? '15:00';
			if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) return null;
			if (typeof time !== 'string' || !TIME.test(time) || Number(time.slice(0, 2)) > 23) return null;
			next.weekday = weekday;
			next.time = time;
		} else if (entry.weekday !== undefined || entry.time !== undefined) return null;
		result.categories[kind] = next;
	}
	const start = body.quietStart ?? null;
	const end = body.quietEnd ?? null;
	if ((start === null) !== (end === null)) return null;
	for (const value of [start, end]) {
		if (value !== null && (typeof value !== 'string' || !TIME.test(value) || Number(value.slice(0, 2)) > 23)) return null;
	}
	result.quietStart = start;
	result.quietEnd = end;
	return result;
}

export interface NotificationsMockOptions {
	clock: () => number;
	/** APNs is configured on the (mock) server; reported as `apnsAvailable` by /push/config */
	apnsAvailable?: () => boolean;
}

export function createNotificationsMock(options: NotificationsMockOptions) {
	const now = options.clock;
	const apnsAvailable = options.apnsAvailable ?? (() => false);
	const items = new Map<string, Item[]>();
	const settings = new Map<string, Settings>();
	const subscriptions = new Map<string, Subscription[]>();
	const push = { available: true, testResult: 'ok' as 'ok' | 'failed', testLimit: TEST_LIMIT_PER_HOUR, maxSubscriptions: MAX_SUBSCRIPTIONS };

	const itemsOf = (accountId: string) => items.get(accountId) ?? items.set(accountId, []).get(accountId)!;
	const subsOf = (accountId: string) => subscriptions.get(accountId) ?? subscriptions.set(accountId, []).get(accountId)!;
	const visible = (accountId: string) => itemsOf(accountId).filter((i) => !i.deleted);
	const unreadCount = (accountId: string) => visible(accountId).filter((i) => !i.read).length;

	const publicItem = ({ deleted: _deleted, ...rest }: Item) => rest;
	const publicSub = ({ endpoint: _e, tests: _t, ...rest }: Subscription) => rest;

	function create(accountId: string, input: Partial<Item> & { ageMinutes?: number }): Item {
		const kind = (KINDS as readonly string[]).includes(input.kind as string) ? (input.kind as Kind) : 'system';
		const text = DEFAULT_TEXT[kind];
		const item: Item = {
			id: uuid(),
			kind,
			title: input.title ?? text.title,
			body: input.body ?? text.body,
			url: input.url === undefined ? text.url : input.url,
			createdAt: new Date(now() - (input.ageMinutes ?? 0) * 60_000).toISOString(),
			read: input.read ?? false,
			deleted: false
		};
		itemsOf(accountId).push(item);
		return item;
	}

	function handle(accountId: string, req: { method: string; path: string; body?: any }): MockResponse | null {
		const [rawPath, rawQuery = ''] = req.path.split('?');
		const path = rawPath.replace(/\/+$/, '');
		const method = req.method.toUpperCase();
		const body = req.body ?? {};
		let m: RegExpMatchArray | null;

		if (path === '/api/v1/mock/notify' && method === 'POST') {
			const count = Math.min(Math.max(Number(body.count ?? 1), 1), 200);
			const created: Item[] = [];
			for (let i = 0; i < count; i++) {
				// consecutive items are one minute apart so the cursor paging is deterministic
				created.push(create(accountId, { ...body, ageMinutes: (body.ageMinutes ?? 0) + i }));
			}
			return { status: 201, body: created.map(publicItem) };
		}
		if (path === '/api/v1/mock/push' && method === 'POST') {
			if (typeof body.available === 'boolean') push.available = body.available;
			if (body.testResult === 'ok' || body.testResult === 'failed') push.testResult = body.testResult;
			if (Number.isInteger(body.testLimit)) push.testLimit = body.testLimit;
			if (Number.isInteger(body.maxSubscriptions)) push.maxSubscriptions = body.maxSubscriptions;
			return { status: 200, body: { ...push } };
		}

		if (path === '/api/v1/notifications' && method === 'GET') {
			const query = new URLSearchParams(rawQuery);
			const limitText = query.get('limit');
			const limit = limitText === null ? 50 : Number(limitText);
			if (!Number.isInteger(limit) || limit < 1 || limit > 100) return error(400, 'bad_request');
			const before = query.get('before');
			if (before !== null && Number.isNaN(Date.parse(before))) return error(400, 'bad_request');
			let list = visible(accountId).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
			if (query.get('unreadOnly') === 'true') list = list.filter((i) => !i.read);
			if (before !== null) list = list.filter((i) => Date.parse(i.createdAt) < Date.parse(before));
			return { status: 200, body: { items: list.slice(0, limit).map(publicItem), unreadCount: unreadCount(accountId) } };
		}
		if (path === '/api/v1/notifications/read' && method === 'POST') {
			const ids: unknown = body.ids;
			if (body.all === true) visible(accountId).forEach((i) => (i.read = true));
			else if (Array.isArray(ids) && ids.length <= 200 && ids.every((id) => typeof id === 'string')) {
				for (const item of visible(accountId)) if (ids.includes(item.id)) item.read = true;
			} else return error(400, 'bad_request');
			return { status: 200, body: { unreadCount: unreadCount(accountId) } };
		}
		if (path === '/api/v1/notifications/settings') {
			if (method === 'GET') return { status: 200, body: settings.get(accountId) ?? defaults() };
			if (method === 'PUT') {
				const next = normalizeSettings(body);
				if (!next) return error(400, 'bad_request');
				settings.set(accountId, next);
				return { status: 200, body: next };
			}
		}
		if ((m = path.match(/^\/api\/v1\/notifications\/([^/]+)$/)) && method === 'DELETE') {
			const item = visible(accountId).find((i) => i.id === m![1]);
			if (!item) return error(404, 'not_found');
			item.deleted = true;
			return { status: 204 };
		}

		if (path === '/api/v1/push/config' && method === 'GET') {
			return { status: 200, body: { ...(push.available ? { available: true, vapidPublicKey: MOCK_VAPID_PUBLIC_KEY } : { available: false }), ...(apnsAvailable() ? { apnsAvailable: true } : {}) } };
		}
		if (path === '/api/v1/me/push-subscriptions') {
			if (method === 'GET') return { status: 200, body: subsOf(accountId).map(publicSub) };
			if (method === 'POST') {
				if (!push.available) return error(501, 'push_unavailable');
				let endpoint: URL;
				try {
					endpoint = new URL(String(body.endpoint));
				} catch {
					return error(400, 'bad_request');
				}
				const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
				if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && loopback)) return error(400, 'bad_request');
				if (typeof body.keys?.p256dh !== 'string' || !body.keys.p256dh || typeof body.keys?.auth !== 'string' || !body.keys.auth) return error(400, 'bad_request');
				const existing = subsOf(accountId).find((s) => s.endpoint === endpoint.toString());
				if (existing) return { status: 201, body: publicSub(existing) };
				if (subsOf(accountId).length >= push.maxSubscriptions) return error(409, 'too_many_subscriptions');
				const created: Subscription = {
					id: uuid(),
					endpoint: endpoint.toString(),
					host: endpoint.host,
					userAgent: typeof body.userAgent === 'string' ? body.userAgent.slice(0, 200) : null,
					createdAt: new Date(now()).toISOString(),
					lastSuccessAt: null,
					tests: []
				};
				subsOf(accountId).push(created);
				return { status: 201, body: publicSub(created) };
			}
		}
		if ((m = path.match(/^\/api\/v1\/me\/push-subscriptions\/([^/]+)$/)) && method === 'DELETE') {
			const list = subsOf(accountId);
			const index = list.findIndex((s) => s.id === m![1]);
			if (index < 0) return error(404, 'not_found');
			list.splice(index, 1);
			return { status: 204 };
		}
		if ((m = path.match(/^\/api\/v1\/me\/push-subscriptions\/([^/]+)\/test$/)) && method === 'POST') {
			const sub = subsOf(accountId).find((s) => s.id === m![1]);
			if (!sub) return error(404, 'not_found');
			if (!push.available) return error(501, 'push_unavailable');
			const hourAgo = now() - 3_600_000;
			sub.tests = sub.tests.filter((t) => t > hourAgo);
			if (sub.tests.length >= push.testLimit) return error(429, 'too_many_requests');
			sub.tests.push(now());
			if (push.testResult === 'failed') return error(502, 'push_failed');
			sub.lastSuccessAt = new Date(now()).toISOString();
			return { status: 202 };
		}
		return null;
	}

	return { handle, state: { items, settings, subscriptions, push } };
}
