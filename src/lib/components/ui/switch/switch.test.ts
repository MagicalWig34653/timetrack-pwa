import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import Switch from './switch.svelte';

describe('Switch', () => {
	it('is a switch with a name, toggles with Space and fires change', async () => {
		const onchange = vi.fn();
		render(Switch, { 'aria-label': 'Reports', checked: false, onchange });
		const sw = screen.getByRole('switch', { name: 'Reports' });
		expect(sw).not.toBeChecked();
		sw.focus();
		await userEvent.keyboard(' ');
		expect(sw).toBeChecked();
		expect(onchange).toHaveBeenCalledTimes(1);
	});

	it('does not toggle when disabled', async () => {
		render(Switch, { 'aria-label': 'Locked', checked: true, disabled: true });
		const sw = screen.getByRole('switch', { name: 'Locked' });
		await userEvent.click(sw);
		expect(sw).toBeChecked();
	});
});
