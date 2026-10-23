import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import ErrorPage from './ErrorPage.svelte';

describe('ErrorPage', () => {
	it('404 shows a German heading, the requested path and links back into the app', () => {
		render(ErrorPage, { status: 404, path: '/gibt/es/nicht', standalone: true });
		expect(screen.getByRole('alert')).toBeInTheDocument();
		const heading = screen.getByRole('heading', { level: 1, name: 'Seite nicht gefunden' });
		expect(heading).toHaveFocus();
		expect(screen.getByTestId('error-path')).toHaveTextContent('/gibt/es/nicht');
		for (const name of ['Heute', 'Kalender', 'Zeit']) expect(screen.getAllByRole('link', { name }).length).toBeGreaterThan(0);
		expect(screen.queryByTestId('error-retry')).toBeNull();
	});

	it('403 explains the missing permission without a retry button', () => {
		render(ErrorPage, { status: 403 });
		expect(screen.getByRole('heading', { name: 'Kein Zugriff' })).toBeInTheDocument();
		expect(screen.queryByTestId('error-retry')).toBeNull();
	});

	it('500 offers retry and reload, shows status and error id but no stack trace', () => {
		let retried = 0;
		render(ErrorPage, { status: 500, errorId: 'AB12CD34', onretry: () => retried++ });
		expect(screen.getByRole('heading', { name: 'Der Server antwortet gerade nicht richtig' })).toBeInTheDocument();
		expect(screen.getByTestId('error-id')).toHaveTextContent('AB12CD34');
		expect(screen.getByRole('button', { name: 'Neu laden' })).toBeInTheDocument();
		screen.getByRole('button', { name: 'Erneut versuchen' }).click();
		expect(retried).toBe(1);
		expect(document.body.textContent).not.toMatch(/\bat \w+.*\(.*:\d+:\d+\)/);
	});

	it('an unexpected status falls back to the generic text', () => {
		render(ErrorPage, { status: 418, errorId: 'FF00FF00' });
		expect(screen.getByRole('heading', { name: 'Etwas ist schiefgelaufen' })).toBeInTheDocument();
	});

	it('401 points to the sign-in page', () => {
		render(ErrorPage, { status: 401 });
		expect(screen.getByRole('link', { name: 'Zur Anmeldung' })).toHaveAttribute('href', '/login');
	});
});
