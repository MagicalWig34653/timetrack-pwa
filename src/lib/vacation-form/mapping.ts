import { DATE_FORMATS, type DateFormatId } from './format';
import { MAX_FREE_RANGES, isSourceId, sourceDef } from './sources';
import type { Binding, FormMapping, OverlayItem, PersonValues, SourceId, TargetKind } from './types';

/** The server stores the mapping as opaque JSON up to this size (contract proposal B7). */
export const MAPPING_MAX_BYTES = 64 * 1024;
export const MAX_FIELD_NAME_LENGTH = 256;
export const MAX_TEXT_LENGTH = 500;
export const MAX_OVERLAYS = 200;
export const DEFAULT_OVERLAY_FONT_SIZE = 11;

export const EMPTY_PERSON: PersonValues = { lastName: '', firstName: '', personnelNo: '', department: '', place: '' };

export function emptyMapping(): FormMapping {
	return { version: 1, person: { ...EMPTY_PERSON }, dateFormat: 'dd.MM.yyyy', flatten: false, fields: {}, overlays: [] };
}

export class MappingTooLargeError extends Error {
	constructor(public readonly bytes: number) {
		super(`mapping is ${bytes} bytes, limit is ${MAPPING_MAX_BYTES}`);
		this.name = 'MappingTooLargeError';
	}
}

export function serializeMapping(mapping: FormMapping): string {
	const json = JSON.stringify(mapping);
	const bytes = new TextEncoder().encode(json).length;
	if (bytes > MAPPING_MAX_BYTES) throw new MappingTooLargeError(bytes);
	return json;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown, max = MAX_TEXT_LENGTH) => (typeof value === 'string' ? value.slice(0, max) : '');
const finite = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

function parseBinding(value: unknown): Binding | null {
	if (!isRecord(value) || !isSourceId(value.source)) return null;
	const binding: Binding = { source: value.source };
	const def = sourceDef(value.source);
	if (def.option === 'text') binding.text = str(value.text);
	if (def.option === 'checked') binding.checked = value.checked === true;
	if (def.option === 'index') binding.index = Math.min(Math.max(Math.trunc(finite(value.index, 1)), 1), MAX_FREE_RANGES);
	if (typeof value.dateFormat === 'string' && (DATE_FORMATS as readonly string[]).includes(value.dateFormat)) binding.dateFormat = value.dateFormat as DateFormatId;
	return binding;
}

/**
 * Reads a stored mapping defensively (it may come from an older client, another browser or a hand-edited backup):
 * unknown sources and malformed entries are dropped, numbers clamped, everything else falls back to defaults.
 */
export function parseMapping(value: unknown): FormMapping {
	const mapping = emptyMapping();
	if (!isRecord(value)) return mapping;
	if (isRecord(value.person)) {
		for (const key of Object.keys(EMPTY_PERSON) as (keyof PersonValues)[]) mapping.person[key] = str(value.person[key], 200);
	}
	if (typeof value.dateFormat === 'string' && (DATE_FORMATS as readonly string[]).includes(value.dateFormat)) mapping.dateFormat = value.dateFormat as DateFormatId;
	mapping.flatten = value.flatten === true;
	if (isRecord(value.fields)) {
		for (const [name, raw] of Object.entries(value.fields)) {
			const binding = parseBinding(raw);
			if (binding && name.length <= MAX_FIELD_NAME_LENGTH) mapping.fields[name] = binding;
		}
	}
	if (Array.isArray(value.overlays)) {
		for (const raw of value.overlays.slice(0, MAX_OVERLAYS)) {
			if (!isRecord(raw)) continue;
			const binding = parseBinding(raw.binding);
			if (!binding || typeof raw.id !== 'string') continue;
			const overlay: OverlayItem = {
				id: raw.id.slice(0, 64),
				page: Math.max(0, Math.trunc(finite(raw.page, 0))),
				x: finite(raw.x, 0),
				y: finite(raw.y, 0),
				fontSize: Math.min(Math.max(finite(raw.fontSize, DEFAULT_OVERLAY_FONT_SIZE), 4), 48),
				binding
			};
			mapping.overlays.push(overlay);
		}
	}
	return mapping;
}

export function parseMappingJson(json: string): FormMapping {
	try {
		return parseMapping(JSON.parse(json));
	} catch {
		return emptyMapping();
	}
}

/** A fresh binding for a source with sensible option defaults. */
export function newBinding(source: SourceId): Binding {
	const def = sourceDef(source);
	const binding: Binding = { source };
	if (def.option === 'text') binding.text = '';
	if (def.option === 'checked') binding.checked = true;
	if (def.option === 'index') binding.index = 1;
	return binding;
}

/**
 * Suggests a source from a field's name (German form labels are typical). Only a hint: the settings page offers it as
 * a button and never applies it silently.
 */
export function suggestSource(fieldName: string, kind: TargetKind): SourceId | null {
	const n = fieldName.toLowerCase().replace(/[^a-zäöüß0-9]+/g, ' ').trim();
	const tokens = n.split(' ');
	const has = (...words: string[]) => words.some((w) => n.includes(w));
	const word = (...words: string[]) => words.some((w) => tokens.includes(w));
	if (kind === 'checkbox') return null;
	if (has('vertret')) return 'substitute';
	if (has('anspruch') && has('gesamt')) return 'entitlementTotal';
	if (has('anspruch') && has('verbleib', 'rest')) return 'restAfter';
	if (has('anspruch')) return 'entitlementYear';
	if (has('übertrag', 'uebertrag', 'vorjahr')) return 'carryOver';
	if (has('zusatz')) return 'additional';
	if (has('abgegolten')) return 'paidOut';
	if (has('resttage', 'rest')) return 'restAfter';
	if (has('arbeitstage')) return 'workingDays';
	if (has('nachname', 'familienname') || (word('last', 'family', 'surname') && word('name'))) return 'lastName';
	if (has('vorname') || (word('first', 'given') && word('name'))) return 'firstName';
	if (has('personal')) return 'personnelNo';
	if (has('abteilung', 'bereich')) return 'department';
	if (word('ort', 'standort')) return 'place';
	if (has('name')) return 'fullName';
	if (has('heute', 'datum')) return 'today';
	if (word('von', 'ab') || has('beginn')) return 'dateFrom';
	if (word('bis') || has('ende')) return 'dateTo';
	return null;
}
