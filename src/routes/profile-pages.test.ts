import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFetch } from '../../mock/fetch.ts';
import { api, setCsrfToken } from '#lib/api/client.js';
import { moduleStore } from '#lib/modules/store.svelte.js';
import { sessionStore } from '#lib/session.svelte.js';

const goto = vi.hoisted(() => vi.fn());
const pageState = vi.hoisted(() => ({ url: new URL('http://localhost/'), params: {} as Record<string, string> }));
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$app/state', () => ({ page: pageState }));

import OnboardingPage from './(app)/onboarding/+page.svelte';
import ProfilePage from './(app)/settings/profile/+page.svelte';

let mock: ReturnType<typeof createMockFetch>;

async function signIn(options?: Parameters<typeof createMockFetch>[0]) {
	mock = createMockFetch(options);
	vi.stubGlobal('fetch', mock.fetch);
	const login = await api.loginOptions();
	sessionStore.set(await api.loginVerify(login.challengeId, { id: 'mock-login' }));
	await moduleStore.ensure(sessionStore.current!.account.id);
}
const call = async (method: string, path: string, body?: unknown) => {
	const response = await mock.fetch('/api/v1' + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
	return response.json();
};

beforeEach(() => {
	moduleStore.reset();
	setCsrfToken(null);
	sessionStore.current = null;
	goto.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('/settings/profile', () => {
	it('renames the account and shows the handle read-only', async () => {
		await signIn();
		render(ProfilePage);
		const name = (await screen.findByLabelText('Anzeigename')) as HTMLInputElement;
		expect(screen.getByLabelText('Kontoname')).toHaveAttribute('readonly');
		expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled();
		await userEvent.clear(name);
		await userEvent.type(name, 'Neuer Name');
		await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
		await waitFor(() => expect(screen.getByTestId('name-notice')).toHaveTextContent('gespeichert'));
		expect(sessionStore.current?.account.displayName).toBe('Neuer Name');
	});

	it('changes the e-mail with a code and removes it again', async () => {
		await signIn();
		render(ProfilePage);
		await screen.findByTestId('email-none');
		await userEvent.click(screen.getByTestId('email-edit'));
		await userEvent.type(screen.getByLabelText('Neue E-Mail-Adresse'), 'kaputt');
		await userEvent.click(screen.getByRole('button', { name: 'Code senden' }));
		expect(await screen.findByText('Bitte eine gültige E-Mail-Adresse eingeben.')).toBeInTheDocument();
		await userEvent.clear(screen.getByLabelText('Neue E-Mail-Adresse'));
		await userEvent.type(screen.getByLabelText('Neue E-Mail-Adresse'), 'user@example.test');
		await userEvent.click(screen.getByRole('button', { name: 'Code senden' }));
		const pending = await screen.findByTestId('email-pending');
		expect(pending).toHaveTextContent('user@example.test');
		await userEvent.type(within(pending).getByLabelText('Bestätigungscode'), 'falsch');
		await userEvent.click(within(pending).getByRole('button', { name: 'Bestätigen' }));
		await waitFor(() => expect(screen.getByTestId('email-error')).toBeInTheDocument());
		await userEvent.clear(within(pending).getByLabelText('Bestätigungscode'));
		await userEvent.type(within(pending).getByLabelText('Bestätigungscode'), '123456');
		await userEvent.click(within(pending).getByRole('button', { name: 'Bestätigen' }));
		await waitFor(() => expect(screen.getByTestId('email-notice')).toHaveTextContent('bestätigt'));
		expect(screen.getByTestId('email-current')).toHaveTextContent('user@example.test');
		await userEvent.click(screen.getByTestId('email-remove'));
		await userEvent.click(screen.getByTestId('email-remove-confirm'));
		await screen.findByTestId('email-none');
	});

	it('explains the missing mail transport and offers no change', async () => {
		await signIn({ mailAvailable: false });
		render(ProfilePage);
		expect(await screen.findByTestId('no-mail')).toHaveTextContent('keine E-Mails versenden');
		expect(screen.queryByTestId('email-edit')).toBeNull();
	});

	it('asks for a fresh login when the server requires it', async () => {
		await signIn();
		await mock.fetch('/api/v1/mock/accounts', { method: 'POST', body: JSON.stringify({ staleSessions: true }) });
		render(ProfilePage);
		await userEvent.click(await screen.findByTestId('email-edit'));
		await userEvent.type(screen.getByLabelText('Neue E-Mail-Adresse'), 'user@example.test');
		await userEvent.click(screen.getByRole('button', { name: 'Code senden' }));
		expect(await screen.findByTestId('reauth')).toBeInTheDocument();
	});

	it('reports a taken address (409), drops the request and shows the German reason', async () => {
		await signIn();
		await call('POST', '/mock/accounts', { add: [{ handle: 'ben', email: 'taken@example.test' }] });
		render(ProfilePage);
		await userEvent.click(await screen.findByTestId('email-edit'));
		await userEvent.type(screen.getByLabelText('Neue E-Mail-Adresse'), 'taken@example.test');
		await userEvent.click(screen.getByRole('button', { name: 'Code senden' }));
		const pending = await screen.findByTestId('email-pending');
		await userEvent.type(within(pending).getByLabelText('Bestätigungscode'), '123456');
		await userEvent.click(within(pending).getByRole('button', { name: 'Bestätigen' }));
		expect(await screen.findByTestId('email-error')).toHaveTextContent('wird bereits von einem anderen Konto verwendet');
		await waitFor(() => expect(screen.queryByTestId('email-pending')).toBeNull());
		expect(screen.getByTestId('email-none')).toBeInTheDocument();
	});
});

describe('/onboarding', () => {
	async function openOnboarding() {
		await signIn();
		render(OnboardingPage);
		await screen.findByTestId('step-model');
	}
	const next = () => userEvent.click(screen.getByTestId('onboarding-next'));

	it('prefills visible suggestions and derives the daily target', async () => {
		await openOnboarding();
		expect(screen.getByLabelText('Wochenstunden')).toHaveValue('38:30');
		expect(screen.getByTestId('daily-target')).toHaveTextContent('Tages-Soll: 7:42');
		expect(screen.getByTestId('suggestion-note')).toHaveTextContent('Vorschläge');
		await userEvent.clear(screen.getByLabelText('Wochenstunden'));
		await userEvent.type(screen.getByLabelText('Wochenstunden'), '40:00');
		expect(screen.getByTestId('daily-target')).toHaveTextContent('8:00');
		expect(screen.getByLabelText(/Rundung zugunsten/)).toBeChecked();
	});

	it('walks through all steps and stores everything only at the end', async () => {
		await openOnboarding();
		await next();
		await screen.findByTestId('step-breaks');
		await next();
		await screen.findByTestId('step-school');
		await next();
		await screen.findByTestId('step-vacation');
		expect(screen.getByLabelText('Urlaubstage pro Jahr')).toHaveValue('30');
		expect(screen.getByLabelText('Bundesland')).toHaveValue('DE-ST');
		await next();
		await screen.findByTestId('step-modules');
		await userEvent.click(screen.getByTestId('ob-module-automation'));
		await next();
		const summary = await screen.findByTestId('step-summary');
		expect(within(summary).getByTestId('sum-model')).toHaveTextContent('Tages-Soll 7:42');
		expect(within(summary).getByTestId('sum-vacation')).toHaveTextContent('30 Tage');
		expect(within(summary).getByTestId('sum-modules')).toHaveTextContent('Automatik und Shortcuts');
		// nothing stored yet
		const before = (await call('GET', '/work-models')).length;
		expect((await call('GET', '/me/profile')).onboarding.state).toBe('skipped');
		await userEvent.click(screen.getByTestId('onboarding-finish'));
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/'));
		expect((await call('GET', '/work-models')).length).toBe(before + 1);
		expect((await call('GET', '/me/profile')).onboarding.state).toBe('completed');
		const modules = await call('GET', '/modules');
		expect(modules.find((m: any) => m.key === 'automation').accountEnabled).toBe(false);
		expect(sessionStore.current?.account.onboardingState).toBe('completed');
	});

	it('skipping the model skips breaks and school and stores nothing for them', async () => {
		await openOnboarding();
		const before = (await call('GET', '/work-models')).length;
		await userEvent.click(screen.getByTestId('onboarding-skip'));
		await screen.findByTestId('step-vacation');
		await userEvent.click(screen.getByTestId('onboarding-skip'));
		await screen.findByTestId('step-modules');
		await userEvent.click(screen.getByTestId('onboarding-skip'));
		const summary = await screen.findByTestId('step-summary');
		expect(within(summary).getByTestId('sum-model')).toHaveTextContent('Übersprungen');
		expect(within(summary).getByTestId('sum-breaks')).toHaveTextContent('Übersprungen');
		expect(within(summary).getByTestId('sum-school')).toHaveTextContent('Übersprungen');
		await userEvent.click(screen.getByTestId('onboarding-finish'));
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/'));
		expect((await call('GET', '/work-models')).length).toBe(before);
	});

	it('validates a step before moving on', async () => {
		await openOnboarding();
		await userEvent.clear(screen.getByLabelText('Wochenstunden'));
		await userEvent.type(screen.getByLabelText('Wochenstunden'), 'abc');
		await next();
		expect(screen.getByTestId('step-model')).toBeInTheDocument();
		expect(screen.getByTestId('onboarding-progress')).toHaveTextContent('Schritt 1 von 6');
	});

	it('"Einrichtung später" only stores the skipped flag', async () => {
		await signIn();
		render(OnboardingPage);
		await screen.findByTestId('step-model');
		await userEvent.click(screen.getByTestId('onboarding-later'));
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/'));
		expect((await call('GET', '/me/profile')).onboarding.state).toBe('skipped');
	});

	it('hides vacation and module steps when the operator disabled the modules', async () => {
		await signIn();
		moduleStore.set(['reports', 'planning', 'transfer', 'automation', 'mcp'].map((key) => ({ key, serverEnabled: false, accountEnabled: false, effective: false, lockedByOperator: true })) as any);
		render(OnboardingPage);
		await screen.findByTestId('step-model');
		const list = screen.getByTestId('onboarding-steps');
		expect(list).not.toHaveTextContent('Urlaub');
		expect(list).not.toHaveTextContent('Funktionen');
		expect(screen.getByTestId('onboarding-progress')).toHaveTextContent('Schritt 1 von 4');
	});
});
