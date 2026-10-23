import type { DayDraft } from './plan-draft.js';

/**
 * Local undo/redo of the unsaved planner draft (P11). The week is edited in memory and saved as a whole, so a history of
 * snapshots is enough: no server round trip, nothing to roll back. A new edit clears the redo branch.
 */
export interface Snapshot {
	label: string;
	before: DayDraft[];
	after: DayDraft[];
}

export class DraftHistory {
	#past: Snapshot[] = [];
	#future: Snapshot[] = [];

	constructor(private readonly limit = 100) {}

	record(label: string, before: DayDraft[], after: DayDraft[]): void {
		if (JSON.stringify(before) === JSON.stringify(after)) return;
		this.#past.push({ label, before, after });
		if (this.#past.length > this.limit) this.#past.shift();
		this.#future = [];
	}

	get canUndo() {
		return this.#past.length > 0;
	}
	get canRedo() {
		return this.#future.length > 0;
	}
	get undoLabel() {
		return this.#past[this.#past.length - 1]?.label ?? null;
	}
	get redoLabel() {
		return this.#future[this.#future.length - 1]?.label ?? null;
	}

	/** Returns the drafts to show and the label, or null when there is nothing to undo. */
	undo(): { drafts: DayDraft[]; label: string } | null {
		const snap = this.#past.pop();
		if (!snap) return null;
		this.#future.push(snap);
		return { drafts: snap.before, label: snap.label };
	}

	redo(): { drafts: DayDraft[]; label: string } | null {
		const snap = this.#future.pop();
		if (!snap) return null;
		this.#past.push(snap);
		return { drafts: snap.after, label: snap.label };
	}

	clear(): void {
		this.#past = [];
		this.#future = [];
	}
}
