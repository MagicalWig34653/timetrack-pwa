/** Size helpers shared by import, file storage and attachments. */

export const KIB = 1024;
export const MIB = 1024 * 1024;
/** Contract v0.4.0 / ADR-0006: import files are limited to 5 MiB. */
export const MAX_IMPORT_BYTES = 5 * MIB;
/** ADR-0006: default upload limit of the file storage. */
export const DEFAULT_MAX_UPLOAD_BYTES = 10 * MIB;
/** Backend defaults of the per-account quota (contract 0.41.0). */
export const DEFAULT_QUOTA_BYTES = 200 * MIB;
export const DEFAULT_QUOTA_FILES = 500;
export const MAX_QUOTA_FILES = 1_000_000;

export type SizeUnit = 'B' | 'KiB' | 'MiB';
export const SIZE_UNITS: SizeUnit[] = ['B', 'KiB', 'MiB'];
const FACTOR: Record<SizeUnit, number> = { B: 1, KiB: KIB, MiB: MIB };

const number = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

/** 1536 -> "1,5 KiB"; 12 -> "12 B". */
export function formatBytes(bytes: number): string {
	if (bytes >= MIB) return `${number.format(bytes / MIB)} MiB`;
	if (bytes >= KIB) return `${number.format(bytes / KIB)} KiB`;
	return `${bytes} B`;
}

/** Parses a user entered amount ("2", "1,5") in the unit; returns whole bytes or null when invalid (<= 0, not a number). */
export function toBytes(amount: string, unit: SizeUnit): number | null {
	const text = amount.trim().replace(',', '.');
	if (!/^\d+(\.\d+)?$/.test(text)) return null;
	const bytes = Math.round(Number(text) * FACTOR[unit]);
	return Number.isSafeInteger(bytes) && bytes >= 1 ? bytes : null;
}

/** Like toBytes, but 0 is valid (quota: unlimited). */
export function toBytesOrZero(amount: string, unit: SizeUnit): number | null {
	const text = amount.trim().replace(',', '.');
	if (!/^\d+(\.\d+)?$/.test(text)) return null;
	const bytes = Math.round(Number(text) * FACTOR[unit]);
	return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null;
}

/** Whole non-negative number within `max` (quota file count: 0 = unlimited), else null. */
export function toCount(text: string, max: number): number | null {
	if (!/^\d+$/.test(text.trim())) return null;
	const value = Number(text.trim());
	return Number.isSafeInteger(value) && value <= max ? value : null;
}

/** Picks the largest unit that represents the byte count exactly: 2097152 -> { amount: "2", unit: "MiB" }. */
export function fromBytes(bytes: number): { amount: string; unit: SizeUnit } {
	if (bytes === 0) return { amount: '0', unit: 'MiB' };
	for (const unit of ['MiB', 'KiB'] as const) {
		if (bytes % FACTOR[unit] === 0) return { amount: String(bytes / FACTOR[unit]), unit };
	}
	return { amount: String(bytes), unit: 'B' };
}
