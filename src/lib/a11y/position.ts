export interface Size {
	width: number;
	height: number;
}
export interface Point {
	x: number;
	y: number;
}
export interface Box extends Point, Size {}

/**
 * Position of a context menu opened at a pointer position: flips to the left/up when it would overflow the right/bottom
 * edge and is finally clamped, so it always stays fully inside the viewport (as far as it fits at all).
 */
export function clampMenu(point: Point, size: Size, viewport: Size, margin = 8): Point {
	let x = point.x;
	let y = point.y;
	if (x + size.width > viewport.width - margin) x = point.x - size.width;
	if (y + size.height > viewport.height - margin) y = point.y - size.height;
	x = Math.min(x, viewport.width - margin - size.width);
	y = Math.min(y, viewport.height - margin - size.height);
	return { x: Math.max(margin, x), y: Math.max(margin, y) };
}

export interface Placement extends Point {
	placement: 'below' | 'above';
}

/**
 * Position of a popover anchored to a trigger: below the trigger, flipped above when there is more room there,
 * horizontally aligned with the trigger's start and clamped into the viewport.
 */
export function placePopover(anchor: Box, size: Size, viewport: Size, margin = 8, gap = 6): Placement {
	const below = viewport.height - (anchor.y + anchor.height) - margin;
	const above = anchor.y - margin;
	const placement = size.height + gap <= below || below >= above ? 'below' : 'above';
	let y = placement === 'below' ? anchor.y + anchor.height + gap : anchor.y - gap - size.height;
	y = Math.max(margin, Math.min(y, viewport.height - margin - size.height));
	const x = Math.max(margin, Math.min(anchor.x, viewport.width - margin - size.width));
	return { x, y, placement };
}
