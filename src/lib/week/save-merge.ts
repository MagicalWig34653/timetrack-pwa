import { draftsEqual, type DayDraft } from './plan-draft.js';

export interface SettledSave {
	/** drafts to show after the save */
	drafts: DayDraft[];
	/** new baseline (what the server now holds) */
	baseline: DayDraft[];
	/** true when the undo history still matches the shown drafts and must be kept */
	keepHistory: boolean;
}

/**
 * The planner stays editable while a save is in flight. When the response arrives, only edit-free state may be replaced
 * wholesale: if the drafts changed since the request was sent, the newer drafts and the undo history are kept and only
 * the baseline (the server version) is updated, so the newer edits stay unsaved (dirty) instead of being lost.
 */
export function settleSave(sent: DayDraft[], current: DayDraft[], saved: DayDraft[]): SettledSave {
	if (draftsEqual(sent, current)) return { drafts: saved.map((d) => ({ ...d })), baseline: saved.map((d) => ({ ...d })), keepHistory: false };
	return { drafts: current, baseline: saved.map((d) => ({ ...d })), keepHistory: true };
}
