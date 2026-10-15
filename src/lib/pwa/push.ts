import { base64urlToBytes, bytesToBase64url } from './core';
import type { PushSubscriptionInput } from '../api/types';

// Thin wrappers around the browser push APIs so the settings page can be tested with replacements.

export type PermissionState = 'default' | 'granted' | 'denied';

export function pushSupported(): boolean {
	return typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof window !== 'undefined' && 'PushManager' in window && 'Notification' in window;
}

export function permissionState(): PermissionState {
	return 'Notification' in window ? (Notification.permission as PermissionState) : 'denied';
}

export async function requestPermission(): Promise<PermissionState> {
	return (await Notification.requestPermission()) as PermissionState;
}

/** The registration of the service worker, waiting a few seconds for a fresh install; null when none exists. */
async function registration(): Promise<ServiceWorkerRegistration | null> {
	const existing = await navigator.serviceWorker.getRegistration('/');
	if (!existing) return null;
	if (existing.active) return existing;
	return Promise.race([navigator.serviceWorker.ready, new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000))]);
}

export async function browserSubscription(): Promise<PushSubscription | null> {
	const reg = await registration();
	return reg ? reg.pushManager.getSubscription() : null;
}

/** Subscribes this browser with the server's VAPID key; reuses an existing subscription. */
export async function subscribeBrowser(vapidPublicKey: string): Promise<{ subscription: PushSubscription; created: boolean }> {
	const reg = await registration();
	if (!reg) throw new Error('no_service_worker');
	const existing = await reg.pushManager.getSubscription();
	if (existing) return { subscription: existing, created: false };
	const subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64urlToBytes(vapidPublicKey) });
	return { subscription, created: true };
}

export async function unsubscribeBrowser(): Promise<void> {
	const subscription = await browserSubscription();
	if (subscription) await subscription.unsubscribe();
}

/** API body for POST /me/push-subscriptions from a browser subscription (keys as unpadded base64url). */
export function toSubscriptionInput(subscription: PushSubscription, userAgent: string): PushSubscriptionInput {
	const json = subscription.toJSON();
	const p256dh = json.keys?.p256dh ?? (subscription.getKey('p256dh') ? bytesToBase64url(subscription.getKey('p256dh')!) : '');
	const auth = json.keys?.auth ?? (subscription.getKey('auth') ? bytesToBase64url(subscription.getKey('auth')!) : '');
	return { endpoint: subscription.endpoint, keys: { p256dh, auth }, userAgent: userAgent.slice(0, 200) };
}
