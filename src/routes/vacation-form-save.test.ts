import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { emptyMapping } from '#lib/vacation-form/mapping.js';
import { makeFormPdf } from '#lib/vacation-form/test-pdf.js';
import type { FormMapping } from '#lib/vacation-form/types.js';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/settings/vacation-form'), params: {} } }));

const gate = vi.hoisted(() => ({ release: () => undefined as void, saved: [] as unknown[], bytes: null as Uint8Array | null }));
vi.mock('#lib/vacation-form/store-instance.js', () => ({
	currentFormStore: () => ({
		storage: 'server',
		load: async () => ({ fileName: 'form.pdf', bytes: gate.bytes, mapping: emptyMapping() }),
		saveMapping: (mapping: FormMapping) => {
			gate.saved.push(JSON.parse(JSON.stringify(mapping)));
			return new Promise<void>((resolve) => (gate.release = resolve));
		},
		saveFile: async () => undefined,
		remove: async () => undefined
	})
}));

import VacationFormPage from './(app)/settings/vacation-form/+page.svelte';

describe('vacation form mapping: editing while saving (review finding 8)', () => {
	it('keeps edits made during a save marked as unsaved', async () => {
		vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
		gate.bytes = await makeFormPdf();
		const u = userEvent.setup();
		render(VacationFormPage);
		const last = await screen.findByLabelText('Nachname');
		await u.type(last, 'Muster');
		await u.click(screen.getByTestId('vform-save'));
		await waitFor(() => expect(gate.saved).toHaveLength(1));
		await u.type(screen.getByLabelText('Vorname'), 'Erika');
		gate.release();
		await waitFor(() => expect(screen.getByTestId('vform-save')).toBeEnabled());
		expect(screen.getByTestId('vform-dirty')).toBeInTheDocument();
		vi.unstubAllGlobals();
	});
});
