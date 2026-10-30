import type { PollAnswer } from '../api/types';

/**
 * Per-link browser memory of the participant (ADR-0033): the display name and the edit secrets of the own votes and entries.
 * Stored under `tt-groups:<token>` in localStorage; the server never sees these secrets except as the X-Edit-Secret header.
 * `answers` keeps the last submitted answers of a vote so it can be edited while the results are hidden.
 */
export interface GroupMemory {
	name?: string;
	votes: Record<string, string>;
	entries: Record<string, string>;
	answers: Record<string, PollAnswer[]>;
}

const PREFIX = 'tt-groups:';
/** fallback when localStorage is blocked (private mode): lives as long as the page */
const volatile = new Map<string, GroupMemory>();

const empty = (): GroupMemory => ({ votes: {}, entries: {}, answers: {} });
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const stringMap = (value: unknown): Record<string, string> => {
	const result: Record<string, string> = {};
	if (isRecord(value)) for (const [key, entry] of Object.entries(value)) if (typeof entry === 'string') result[key] = entry;
	return result;
};

export function loadMemory(token: string): GroupMemory {
	try {
		const raw = localStorage.getItem(PREFIX + token);
		if (!raw) return volatile.get(token) ?? empty();
		const data: unknown = JSON.parse(raw);
		if (!isRecord(data)) return empty();
		const answers: Record<string, PollAnswer[]> = {};
		if (isRecord(data.answers)) for (const [id, list] of Object.entries(data.answers)) if (Array.isArray(list)) answers[id] = list as PollAnswer[];
		return { name: typeof data.name === 'string' ? data.name : undefined, votes: stringMap(data.votes), entries: stringMap(data.entries), answers };
	} catch {
		return volatile.get(token) ?? empty();
	}
}

export function saveMemory(token: string, memory: GroupMemory): void {
	volatile.set(token, memory);
	try {
		localStorage.setItem(PREFIX + token, JSON.stringify(memory));
	} catch {
		// storage blocked or full: the in-memory copy still serves this page visit
	}
}

export function clearMemory(token: string): void {
	volatile.delete(token);
	try {
		localStorage.removeItem(PREFIX + token);
	} catch {
		// nothing to clear
	}
}

/** Updates the memory in one step: `change` mutates a copy that is saved afterwards. */
export function updateMemory(token: string, change: (memory: GroupMemory) => void): GroupMemory {
	const memory = loadMemory(token);
	change(memory);
	saveMemory(token, memory);
	return memory;
}
