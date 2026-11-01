import { sourceDef } from './sources';
import type { DetectedField } from './pdf';
import type { Binding, FormMapping, OverlayItem } from './types';

/** What a replaced template did to the assignment, for the review shown after the upload. */
export interface ReplaceReview {
	/** same name and a compatible type: the assignment was carried over */
	kept: string[];
	/** in the new file only: nothing to carry over, needs an assignment */
	fresh: string[];
	/** assigned in the old mapping, missing in the new file: the assignment was dropped */
	removed: string[];
	/** same name, but the type no longer fits the chosen source: the assignment was dropped */
	changed: string[];
	overlaysKept: number;
	overlaysDropped: number;
}

export interface CarryResult {
	mapping: FormMapping;
	review: ReplaceReview;
}

const normal = (name: string) => name.trim().toLowerCase();

/**
 * Carries the assignment of the old template over to a new version. A field keeps its assignment when the new file has a
 * field of the same name (exact, else the same name ignoring case and surrounding blanks, if that is unambiguous) and the
 * assigned source can still fill that kind of field. Personal values, date format and flatten stay as they are. Overlay
 * positions on a flat template stay when the page still exists. `oldFields` are the fields of the old file (to tell new fields from fields that were just never assigned). Pure: the caller saves the result.
 */
export function carryMapping(old: FormMapping, oldFields: DetectedField[], newFields: DetectedField[], newPageCount: number): CarryResult {
	const mappable = newFields.filter((field) => field.type !== 'other');
	const exact = new Map(mappable.map((field) => [field.name, field]));
	const byNormal = new Map<string, DetectedField[]>();
	for (const field of mappable) byNormal.set(normal(field.name), [...(byNormal.get(normal(field.name)) ?? []), field]);

	const fields: Record<string, Binding> = {};
	const kept: string[] = [];
	const changed: string[] = [];
	const removed: string[] = [];
	for (const [oldName, binding] of Object.entries(old.fields)) {
		const candidates = byNormal.get(normal(oldName)) ?? [];
		const target = exact.get(oldName) ?? (candidates.length === 1 ? candidates[0] : undefined);
		if (!target || target.name in fields) {
			removed.push(oldName);
			continue;
		}
		if (sourceDef(binding.source).targets.includes(target.type as 'text' | 'checkbox' | 'dropdown')) {
			fields[target.name] = binding;
			kept.push(target.name);
		} else {
			changed.push(target.name);
		}
	}
	// "New" means the field did not exist in the old file; an old field that was simply never assigned is not new.
	const hadBefore = new Set([...oldFields.map((field) => normal(field.name)), ...Object.keys(old.fields).map(normal)]);
	const fresh = mappable.map((field) => field.name).filter((name) => !hadBefore.has(normal(name)));

	const overlays: OverlayItem[] = old.overlays.filter((overlay) => overlay.page < newPageCount);
	return {
		mapping: { ...old, fields, overlays },
		review: { kept, fresh, removed, changed, overlaysKept: overlays.length, overlaysDropped: old.overlays.length - overlays.length }
	};
}

/** True when a replaced file needs the user's attention (something new, dropped or changed). */
export const reviewNeedsAttention = (review: ReplaceReview) => review.fresh.length + review.removed.length + review.changed.length + review.overlaysDropped > 0;
