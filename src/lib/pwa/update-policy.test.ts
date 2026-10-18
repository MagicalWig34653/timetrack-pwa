import { describe, expect, it } from 'vitest';
import { isSuppressed, parseServerRevision, readStamp, shouldShowUpdateBanner, SUPPRESS_MS, writeStamp } from './update-policy';

const base = { waitingWorker: true, ownRevision: 'aaaaaaa1', serverRevision: 'bbbbbbb2', suppressed: false };

describe('shouldShowUpdateBanner', () => {
	it('never shows without a waiting worker', () => {
		expect(shouldShowUpdateBanner({ ...base, waitingWorker: false })).toBe(false);
	});
	it('shows when the server revision differs', () => {
		expect(shouldShowUpdateBanner(base)).toBe(true);
	});
	it('shows a real difference even inside the suppression window', () => {
		expect(shouldShowUpdateBanner({ ...base, suppressed: true })).toBe(true);
	});
	it('hides a waiting worker when the server revision equals ours (case-insensitive)', () => {
		expect(shouldShowUpdateBanner({ ...base, serverRevision: 'AAAAAAA1' })).toBe(false);
	});
	it('falls back to the old logic when system/info is unavailable, honouring the window', () => {
		expect(shouldShowUpdateBanner({ ...base, serverRevision: null })).toBe(true);
		expect(shouldShowUpdateBanner({ ...base, serverRevision: undefined, suppressed: true })).toBe(false);
	});
	it('treats unknown revisions like unavailable info', () => {
		expect(shouldShowUpdateBanner({ ...base, serverRevision: 'unknown' })).toBe(true);
		expect(shouldShowUpdateBanner({ ...base, ownRevision: 'unknown', suppressed: true })).toBe(false);
	});
});

describe('suppression window and storage', () => {
	it('suppresses for ten minutes after an attempt', () => {
		expect(isSuppressed(null, 1000)).toBe(false);
		expect(isSuppressed(1000, 1000 + SUPPRESS_MS - 1)).toBe(true);
		expect(isSuppressed(1000, 1000 + SUPPRESS_MS)).toBe(false);
		expect(isSuppressed(5000, 1000)).toBe(false); // clock moved backwards
	});
	it('round-trips a stamp and survives broken storage', () => {
		const data = new Map<string, string>();
		const ok = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
		writeStamp(ok, 'k', 42);
		expect(readStamp(ok, 'k')).toBe(42);
		expect(readStamp(ok, 'missing')).toBeNull();
		const broken = {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('blocked');
			}
		};
		expect(() => writeStamp(broken, 'k', 1)).not.toThrow();
		expect(readStamp(broken, 'k')).toBeNull();
		expect(readStamp(null, 'k')).toBeNull();
		expect(readStamp({ getItem: () => 'garbage' }, 'k')).toBeNull();
	});
	it('parses the server revision defensively', () => {
		expect(parseServerRevision({ pwa: { revision: 'abc' } })).toBe('abc');
		expect(parseServerRevision({ pwa: {} })).toBeNull();
		expect(parseServerRevision(null)).toBeNull();
	});
});
