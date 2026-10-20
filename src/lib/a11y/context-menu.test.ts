import { afterEach, describe, expect, it, vi } from 'vitest';
import { contextMenu, contextmenu, keepsSystemMenu, LONG_PRESS_MS, type MenuEntry } from './context-menu.svelte.js';

const item = (id: string): MenuEntry => ({ id, label: id, onselect: () => {} });
const sep: MenuEntry = { separator: true };

afterEach(() => {
	contextMenu.close(false);
	document.body.innerHTML = '';
	vi.useRealTimers();
});

describe('keepsSystemMenu', () => {
	it('keeps the system menu with Ctrl/Shift and in editable fields', () => {
		const input = document.createElement('input');
		const div = document.createElement('div');
		expect(keepsSystemMenu({ ctrlKey: true, shiftKey: false, target: div })).toBe(true);
		expect(keepsSystemMenu({ ctrlKey: false, shiftKey: true, target: div })).toBe(true);
		expect(keepsSystemMenu({ ctrlKey: false, shiftKey: false, target: input })).toBe(true);
		expect(keepsSystemMenu({ ctrlKey: false, shiftKey: false, target: div })).toBe(false);
	});
});

describe('menu store', () => {
	it('drops leading, trailing and doubled separators and refuses empty menus', () => {
		contextMenu.show([sep, item('a'), sep, sep, item('b'), sep], { x: 1, y: 2 }, null);
		expect(contextMenu.current?.items.map((e) => e.id ?? '-')).toEqual(['a', '-', 'b']);
		contextMenu.close(false);
		contextMenu.show([sep], { x: 0, y: 0 }, null);
		expect(contextMenu.current).toBeNull();
	});
	it('restores focus to the opener on close', () => {
		const button = document.createElement('button');
		document.body.append(button);
		contextMenu.show([item('a')], { x: 0, y: 0 }, button);
		contextMenu.close();
		expect(document.activeElement).toBe(button);
	});
});

describe('contextmenu action', () => {
	function mount(items: () => MenuEntry[] | null) {
		const node = document.createElement('div');
		const input = document.createElement('input');
		node.append(input);
		document.body.append(node);
		const handle = contextmenu(node, items);
		return { node, input, handle };
	}

	it('opens on right-click and prevents the system menu', () => {
		const { node } = mount(() => [item('a')]);
		const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 20 });
		node.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(true);
		expect(contextMenu.current?.point).toEqual({ x: 10, y: 20 });
	});
	it('leaves the system menu in inputs, with Ctrl and without items', () => {
		const { node, input } = mount(() => [item('a')]);
		for (const [target, init] of [
			[input, {}],
			[node, { ctrlKey: true }],
			[node, { shiftKey: true }]
		] as const) {
			const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, ...init });
			target.dispatchEvent(event);
			expect(event.defaultPrevented).toBe(false);
		}
		expect(contextMenu.current).toBeNull();
		const empty = mount(() => null);
		const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
		empty.node.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(false);
	});
	it('opens on the context-menu key and Shift+F10', () => {
		const { node } = mount(() => [item('a')]);
		node.dispatchEvent(new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true, cancelable: true }));
		expect(contextMenu.current).not.toBeNull();
		contextMenu.close(false);
		node.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }));
		expect(contextMenu.current).not.toBeNull();
	});
	it('opens on a long touch press, not on a short tap or after moving', () => {
		vi.useFakeTimers();
		const { node } = mount(() => [item('a')]);
		const press = (type: string, init: PointerEventInit = {}) => node.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'touch', clientX: 5, clientY: 5, ...init }));
		press('pointerdown');
		vi.advanceTimersByTime(LONG_PRESS_MS - 100);
		press('pointerup');
		vi.advanceTimersByTime(500);
		expect(contextMenu.current).toBeNull();

		press('pointerdown');
		press('pointermove', { clientX: 40, clientY: 40 });
		vi.advanceTimersByTime(LONG_PRESS_MS + 50);
		expect(contextMenu.current).toBeNull();

		press('pointerdown');
		vi.advanceTimersByTime(LONG_PRESS_MS + 50);
		expect(contextMenu.current).not.toBeNull();
		// the click that ends the press must not trigger the element underneath
		const click = new MouseEvent('click', { bubbles: true, cancelable: true });
		const spy = vi.fn();
		node.addEventListener('click', spy);
		node.dispatchEvent(click);
		expect(click.defaultPrevented).toBe(true);
	});
});
