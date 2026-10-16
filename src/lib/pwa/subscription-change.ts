import { bytesToBase64url } from './core';

// Logic of the service worker's `pushsubscriptionchange` handler (B2, ADR-0017). Framework-free and free of DOM types so the
// service worker bundle and unit tests can both use it; all browser access goes through `ChangeDeps`.

/** The parts of a PushSubscription this module needs. */
export interface SubscriptionLike {
	endpoint: string;
	options?: { applicationServerKey?: ArrayBuffer | null };
	toJSON(): { keys?: { p256dh?: string; auth?: string } };
	getKey(name: 'p256dh' | 'auth'): ArrayBuffer | null;
}

export interface ChangeDeps {
	fetch: (input: string, init?: RequestInit) => Promise<Response>;
	/** subscribes with the given VAPID key (userVisibleOnly) */
	subscribe: (applicationServerKey: Uint8Array<ArrayBuffer>) => Promise<SubscriptionLike>;
	userAgent: string;
	/** base64url VAPID key to bytes */
	keyToBytes: (key: string) => Uint8Array<ArrayBuffer>;
}

/**
 * - `replaced`: the server accepted the new subscription (200 replaced or 201 registered)
 * - `no_session`: nobody is signed in, so the server cannot be told; the settings page re-syncs on the next visit
 * - `unavailable`: push is not configured on the server (501) or no VAPID key can be determined
 * - `failed`: network or server error
 */
export type ChangeResult = 'replaced' | 'no_session' | 'unavailable' | 'failed';

const API = '/api/v1';

function keyOf(subscription: SubscriptionLike, name: 'p256dh' | 'auth'): string {
	const fromJson = subscription.toJSON().keys?.[name];
	if (fromJson) return fromJson;
	const raw = subscription.getKey(name);
	return raw ? bytesToBase64url(new Uint8Array(raw)) : '';
}

/** Body for POST /me/push-subscriptions/replace. `previousEndpoint` is omitted when the old subscription is unknown. */
export function replaceBody(previous: SubscriptionLike | null, next: SubscriptionLike, userAgent: string) {
	return {
		...(previous?.endpoint ? { previousEndpoint: previous.endpoint } : {}),
		endpoint: next.endpoint,
		keys: { p256dh: keyOf(next, 'p256dh'), auth: keyOf(next, 'auth') },
		userAgent: userAgent.slice(0, 200)
	};
}

async function json<T>(response: Response): Promise<T | null> {
	try {
		return (await response.json()) as T;
	} catch {
		return null;
	}
}

/**
 * Re-subscribes (unless the browser already supplied `newSubscription`) with the VAPID key of the old subscription or,
 * failing that, the one the server publishes at GET /push/config, then replaces the stored subscription. The CSRF token
 * comes from GET /auth/session (the service worker keeps no state).
 */
export async function handleSubscriptionChange(
	oldSubscription: SubscriptionLike | null,
	newSubscription: SubscriptionLike | null,
	deps: ChangeDeps
): Promise<ChangeResult> {
	try {
		const sessionResponse = await deps.fetch(`${API}/auth/session`, { credentials: 'include', headers: { Accept: 'application/json' } });
		if (sessionResponse.status === 401) return 'no_session';
		if (!sessionResponse.ok) return 'failed';
		const csrf = (await json<{ csrfToken?: string }>(sessionResponse))?.csrfToken;
		if (!csrf) return 'failed';

		let next = newSubscription;
		if (!next) {
			let keyBytes: Uint8Array<ArrayBuffer> | null = null;
			const known = oldSubscription?.options?.applicationServerKey;
			if (known && known.byteLength > 0) keyBytes = new Uint8Array(known.slice(0)) as Uint8Array<ArrayBuffer>;
			else {
				const config = await deps.fetch(`${API}/push/config`, { credentials: 'include', headers: { Accept: 'application/json' } });
				const body = config.ok ? await json<{ available?: boolean; vapidPublicKey?: string }>(config) : null;
				if (!body?.available || !body.vapidPublicKey) return 'unavailable';
				keyBytes = deps.keyToBytes(body.vapidPublicKey);
			}
			next = await deps.subscribe(keyBytes);
		}

		const response = await deps.fetch(`${API}/me/push-subscriptions/replace`, {
			method: 'POST',
			credentials: 'include',
			headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
			body: JSON.stringify(replaceBody(oldSubscription, next, deps.userAgent))
		});
		if (response.status === 501) return 'unavailable';
		if (response.status === 401) return 'no_session';
		return response.status === 200 || response.status === 201 ? 'replaced' : 'failed';
	} catch {
		return 'failed';
	}
}
