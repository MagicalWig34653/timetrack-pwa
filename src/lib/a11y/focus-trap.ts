const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Svelte action: keeps Tab inside `node`, closes on Escape and restores the previous focus on destroy.
 * Used by the off-canvas menu and popovers.
 */
export function focusTrap(node: HTMLElement, options: { onclose?: () => void; autofocus?: boolean } = {}) {
	let current = options;
	const previous = document.activeElement as HTMLElement | null;

	const items = () => Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.stopPropagation();
			current.onclose?.();
			return;
		}
		if (event.key !== 'Tab') return;
		const list = items();
		if (list.length === 0) {
			event.preventDefault();
			return;
		}
		const first = list[0];
		const last = list[list.length - 1];
		const active = document.activeElement;
		if (event.shiftKey && (active === first || !node.contains(active))) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && (active === last || !node.contains(active))) {
			event.preventDefault();
			first.focus();
		}
	}

	node.addEventListener('keydown', onKeydown);
	if (current.autofocus !== false) queueMicrotask(() => (items()[0] ?? node).focus());

	return {
		update(next: typeof options) {
			current = next;
		},
		destroy() {
			node.removeEventListener('keydown', onKeydown);
			if (previous && document.contains(previous)) previous.focus();
		}
	};
}
