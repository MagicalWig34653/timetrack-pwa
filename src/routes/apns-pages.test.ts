import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFetch } from '../../mock/fetch.ts';
import { api, setCsrfToken } from '#lib/api/client.js';
import { moduleStore } from '#lib/modules/store.svelte.js';
import { sessionStore } from '#lib/session.svelte.js';

const goto = vi.hoisted(() => vi.fn());
const pageState = vi.hoisted(() => ({ url: new URL('http://localhost/admin/apns'), params: {} as Record<string, string> }));
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$app/state', () => ({ page: pageState }));

import ApnsPage from './(app)/admin/apns/+page.svelte';
import SettingsPage from './(app)/settings/notifications/+page.svelte';

let mock: ReturnType<typeof createMockFetch>;

async function hook(body: Record<string, unknown>) {
	await mock.fetch('/api/v1/mock/apns', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': sessionStore.current!.csrfToken }, body: JSON.stringify(body) });
}

async function signIn(body?: Record<string, unknown>) {
	mock = createMockFetch();
	vi.stubGlobal('fetch', mock.fetch);
	const login = await api.loginOptions();
	sessionStore.set(await api.loginVerify(login.challengeId, { id: 'mock-login' }));
	await moduleStore.ensure(sessionStore.current!.account.id);
	if (body) await hook(body);
}

beforeEach(() => {
	moduleStore.reset();
	setCsrfToken(null);
	sessionStore.current = null;
	goto.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('/admin/apns', () => {
	it('explains the missing setup without a check button when APNs is not configured', async () => {
		await signIn();
		render(ApnsPage);
		expect(await screen.findByTestId('apns-configured')).toHaveTextContent('Nicht eingerichtet');
		expect(screen.getByTestId('apns-hint-not_configured')).toBeInTheDocument();
		expect(screen.getByTestId('apns-example')).toHaveTextContent('APNS_KEY_ID');
		expect(screen.getByTestId('apns-docs')).toHaveAttribute('href', 'https://magicalwig34653.github.io/timetrack-backend/docs/deployment');
		expect(screen.getByTestId('apns-checklist')).toHaveTextContent('docker stack deploy');
		expect(screen.queryByTestId('apns-check-run')).toBeNull();
	});

	it('shows the settings without the key and a successful check per bundle id and environment', async () => {
		await signIn({ configured: true });
		render(ApnsPage);
		expect(await screen.findByTestId('apns-configured')).toHaveTextContent('Eingerichtet');
		expect(screen.getByTestId('apns-key-id')).toHaveTextContent('ABC123DEFG');
		expect(screen.getByTestId('apns-bundles')).toHaveTextContent('com.example.timetrack.watchkitapp');
		expect(screen.getByTestId('apns-hint-no_devices')).toBeInTheDocument();
		await userEvent.click(screen.getByTestId('apns-check-run'));
		const result = await screen.findByTestId('apns-result');
		expect(result).toHaveAttribute('data-ok', 'true');
		expect(screen.getAllByTestId('apns-probe')).toHaveLength(4);
		expect(screen.getAllByTestId('apns-probe').every((p) => p.getAttribute('data-status') === 'ok')).toBe(true);
	});

	it('explains a rejected key and a rate limit', async () => {
		await signIn({ configured: true, scenario: 'key' });
		render(ApnsPage);
		await userEvent.click(await screen.findByTestId('apns-check-run'));
		expect(await screen.findByTestId('apns-result')).toHaveAttribute('data-ok', 'false');
		expect(within(screen.getAllByTestId('apns-probe')[0]).getByText(/APNS_KEY_ID zur \.p8-Datei/)).toBeInTheDocument();
		await hook({ rateLimit: true });
		await userEvent.click(screen.getByTestId('apns-check-run'));
		expect(await screen.findByTestId('apns-check-error')).toHaveTextContent('Zu viele Prüfungen');
	});

	it('tells a non-admin and an old server apart', async () => {
		await signIn({ configured: true, old: true });
		render(ApnsPage);
		expect(await screen.findByTestId('apns-unsupported')).toBeInTheDocument();
	});
});

describe('Apple devices in the notification settings', () => {
	it('hides the card while APNs is off and no device exists', async () => {
		await signIn();
		render(SettingsPage);
		await screen.findByTestId('push-card');
		expect(screen.queryByTestId('apns-card')).toBeNull();
	});

	it('lists devices, sends a test message, reports failure and rate limit, and removes a device', async () => {
		await signIn({ configured: true, devices: [{ platform: 'ios', label: 'iPhone von Lena' }, { platform: 'macos', environment: 'production', label: 'MacBook' }] });
		render(SettingsPage);
		const list = await screen.findByTestId('apns-device-list');
		expect(within(list).getAllByTestId('apns-device')).toHaveLength(2);
		expect(list).toHaveTextContent('iPhone von Lena');
		expect(list).toHaveTextContent('Produktion');
		const first = within(list).getAllByTestId('apns-device')[0];
		await userEvent.click(within(first).getByRole('button', { name: 'Testmitteilung senden' }));
		expect(await screen.findByTestId('apns-notice')).toHaveTextContent('Testmitteilung an Apple übergeben');
		await hook({ testResult: 'failed' });
		await userEvent.click(within(list).getAllByRole('button', { name: 'Testmitteilung senden' })[0]);
		expect(await screen.findByTestId('apns-error')).toHaveTextContent('Apple hat die Testmitteilung nicht angenommen');
		await hook({ testResult: 'ok', testLimit: 1 });
		await userEvent.click(within(list).getAllByRole('button', { name: 'Testmitteilung senden' })[0]);
		expect(await screen.findByTestId('apns-error')).toHaveTextContent('Zu viele Testmitteilungen');
		await userEvent.click(within(list).getAllByRole('button', { name: 'Entfernen' })[0]);
		await screen.findByTestId('apns-notice');
		expect(within(screen.getByTestId('apns-device-list')).getAllByTestId('apns-device')).toHaveLength(1);
	});
});
