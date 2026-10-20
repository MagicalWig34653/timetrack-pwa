import type { Component } from 'svelte';
import type { Point } from './position.js';

export interface MenuItem {
	id: string;
	label: string;
	icon?: Component<{ class?: string }>;
	/** Hint such as "Entf"; display only, the shortcut itself is handled by the page. */
	shortcut?: string;
	disabled?: boolean;
	danger?: boolean;
	separator?: false;
	onselect: () => void;
}
export interface MenuSeparator {
	id?: string;
	label?: undefined;
	separator: true;
}
export type MenuEntry = MenuItem | MenuSeparator;

export interface OpenMenu {
	items: MenuEntry[];
	point: Point;
	/** Element that regains focus when the menu closes. */
	opener: HTMLElement | null;
	label: string;
}

class ContextMenuState {
	current = $state<OpenMenu | null>(null);

	show(items: MenuEntry[], point: Point, opener: HTMLElement | null, label = '') {
		// Menus never start or end with a separator and never show two in a row.
		const cleaned = items.filter((entry, i, all) => !entry.separator || (i > 0 && i < all.length - 1 && !all[i - 1].separator));
		if (!cleaned.some((e) => !e.separator)) return;
		this.current = { items: cleaned, point, opener, label };
	}

	close(restoreFocus = true) {
		const menu = this.current;
		this.current = null;
		if (restoreFocus && menu?.opener?.isConnected) menu.opener.focus();
	}
}

export const contextMenu = new ContextMenuState();

const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
export const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 10;

/** True where the system menu must stay: text fields, and a deliberate Ctrl/Shift+right-click. */
export function keepsSystemMenu(event: Pick<MouseEvent, 'ctrlKey' | 'shiftKey' | 'target'>): boolean {
	if (event.ctrlKey || event.shiftKey) return true;
	return event.target instanceof Element && event.target.closest(EDITABLE) !== null;
}

/**
 * Svelte action: opens the items returned by `getItems` as a context menu on right-click, the context-menu key,
 * Shift+F10 and a long press on touch. Returning no items keeps the system menu.
 */
export function contextmenu(node: HTMLElement, getItems: (target: Element) => MenuEntry[] | null | undefined, label = '') {
	let current = getItems;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let start: Point | null = null;
	let swallowClickUntil = 0;

	const open = (point: Point, opener: HTMLElement, target: Element = node) => {
		const items = current(target);
		if (!items || items.length === 0) return false;
		contextMenu.show(items, point, opener, label);
		return contextMenu.current !== null;
	};

	function onContextmenu(event: MouseEvent) {
		if (event.defaultPrevented || keepsSystemMenu(event)) return;
		const target = event.target as Element;
		if (open({ x: event.clientX, y: event.clientY }, target.closest<HTMLElement>('button, [tabindex], a') ?? node, target)) event.preventDefault();
	}

	function onKeydown(event: KeyboardEvent) {
		const isMenuKey = event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
		if (!isMenuKey || event.defaultPrevented) return;
		const target = event.target instanceof HTMLElement ? event.target : node;
		if (target.closest(EDITABLE)) return;
		const rect = target.getBoundingClientRect();
		if (open({ x: rect.left + 12, y: rect.bottom - 6 }, target, target)) event.preventDefault();
	}

	function cancel() {
		clearTimeout(timer);
		timer = undefined;
		start = null;
	}

	function onPointerdown(event: PointerEvent) {
		if (event.pointerType !== 'touch') return;
		if (event.target instanceof Element && event.target.closest(EDITABLE)) return;
		const target = event.target instanceof HTMLElement ? event.target : node;
		start = { x: event.clientX, y: event.clientY };
		const point = start;
		timer = setTimeout(() => {
			timer = undefined;
			if (open(point, target.closest<HTMLElement>('button, [tabindex], a') ?? node, target)) swallowClickUntil = Date.now() + 800;
		}, LONG_PRESS_MS);
	}

	function onPointermove(event: PointerEvent) {
		if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > MOVE_TOLERANCE_PX) cancel();
	}

	function onClickCapture(event: MouseEvent) {
		if (Date.now() < swallowClickUntil) {
			event.stopPropagation();
			event.preventDefault();
			swallowClickUntil = 0;
		}
	}

	node.addEventListener('contextmenu', onContextmenu);
	node.addEventListener('keydown', onKeydown);
	node.addEventListener('pointerdown', onPointerdown);
	node.addEventListener('pointermove', onPointermove);
	node.addEventListener('pointerup', cancel);
	node.addEventListener('pointercancel', cancel);
	node.addEventListener('click', onClickCapture, true);

	return {
		update(next: (target: Element) => MenuEntry[] | null | undefined) {
			current = next;
		},
		destroy() {
			cancel();
			node.removeEventListener('contextmenu', onContextmenu);
			node.removeEventListener('keydown', onKeydown);
			node.removeEventListener('pointerdown', onPointerdown);
			node.removeEventListener('pointermove', onPointermove);
			node.removeEventListener('pointerup', cancel);
			node.removeEventListener('pointercancel', cancel);
			node.removeEventListener('click', onClickCapture, true);
		}
	};
}
