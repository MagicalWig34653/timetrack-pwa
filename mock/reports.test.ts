import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, setCsrfToken } from '../src/lib/api/client.ts';
import { sessionStore } from '../src/lib/session.svelte.ts';
import { createMockFetch } from './fetch.ts';

const NOW = new Date('2026-10-14T09:30:00Z');
let mock: ReturnType<typeof createMockFetch>;

async function signIn() {
	const options = await api.loginOptions();
	sessionStore.set(await api.loginVerify(options.challengeId, { id: 'mock-login' }));
}

beforeEach(async () => {
	mock = createMockFetch({ now: () => NOW.getTime() });
	vi.stubGlobal('fetch', mock.fetch);
	setCsrfToken(null);
	await signIn();
});
afterEach(() => vi.unstubAllGlobals());

const status = async (promise: Promise<unknown>) => ((await promise.then(() => null, (e) => e)) as ApiError | null)?.status ?? 200;
const entry = (extra = {}) => ({ date: '2026-10-13', learningField: 'Lernfeld 4', durationSeconds: 3600, notes: 'x', ...extra });

describe('reports mock: learning fields', () => {
	it('creates, sorts, renames and deletes; names are unique per account', async () => {
		const b = await api.createLearningField({ number: 2, name: 'Betrieb', sortOrder: 1 });
		const a = await api.createLearningField({ number: 1, name: 'Netzwerke', sortOrder: 0 });
		expect((await api.listLearningFields()).map((f) => f.name)).toEqual(['Netzwerke', 'Betrieb']);
		expect(await status(api.createLearningField({ name: 'netzwerke' }))).toBe(409);
		expect(await status(api.createLearningField({ name: '  ' }))).toBe(400);
		expect(await status(api.createLearningField({ name: 'X', number: -1 }))).toBe(400);
		expect((await api.updateLearningField(a.id, { number: 1, name: 'Netze', sortOrder: 5 })).name).toBe('Netze');
		expect(await status(api.updateLearningField(a.id, { name: 'Betrieb' }))).toBe(409);
		await api.deleteLearningField(b.id);
		expect(await status(api.deleteLearningField(b.id))).toBe(404);
	});
});

describe('reports mock: entries and weeks', () => {
	it('puts an entry into its ISO week with totals per learning field', async () => {
		await api.createReportEntry(entry());
		await api.createReportEntry(entry({ durationSeconds: 1800, date: '2026-10-14' }));
		await api.createReportEntry(entry({ learningField: 'Betrieb', durationSeconds: 900 }));
		const week = await api.getReportWeek(2026, 42);
		expect(week).toMatchObject({ year: 2026, week: 42, startDate: '2026-10-12', endDate: '2026-10-18', status: 'draft', totalSeconds: 6300, sourceCount: 0 });
		expect(week.entries).toHaveLength(3);
		expect(week.byLearningField).toEqual([
			{ learningField: 'Lernfeld 4', seconds: 5400 },
			{ learningField: 'Betrieb', seconds: 900 }
		]);
		expect((await api.getReportWeek(2026, 43)).entries).toHaveLength(0);
	});

	it('knows week 53 only for years that have it, and the border days belong to it', async () => {
		await api.createReportEntry(entry({ date: '2027-01-01' }));
		expect((await api.getReportWeek(2026, 53)).entries).toHaveLength(1);
		expect((await api.getReportWeek(2027, 1)).entries).toHaveLength(0);
		expect(await status(api.getReportWeek(2027, 53))).toBe(400);
		expect(await status(api.getReportWeek(2026, 0))).toBe(400);
	});

	it('takes the current name as snapshot with learningFieldId and keeps old names after a rename', async () => {
		const field = await api.createLearningField({ name: 'Alt' });
		const created = await api.createReportEntry(entry({ learningFieldId: field.id, learningField: 'ignored' }));
		expect(created.learningField).toBe('Alt');
		await api.updateLearningField(field.id, { name: 'Neu' });
		expect((await api.getReportWeek(2026, 42)).entries[0].learningField).toBe('Alt');
		await api.deleteLearningField(field.id);
		expect((await api.getReportWeek(2026, 42)).entries[0].learningField).toBe('Alt');
	});

	it('validates entries', async () => {
		for (const bad of [{ date: '2026-02-30' }, { learningField: '' }, { durationSeconds: 86401 }, { durationSeconds: -1 }, { durationSeconds: 1.5 }, { notes: 'x'.repeat(4001) }]) {
			expect(await status(api.createReportEntry(entry(bad))), JSON.stringify(bad).slice(0, 40)).toBe(400);
		}
		expect(await status(api.createReportEntry(entry({ learningFieldId: crypto.randomUUID() })))).toBe(404);
		expect((await api.createReportEntry({ date: '2026-10-13', learningField: 'A' })).durationSeconds).toBe(0);
	});

	it('enforces If-Match: stale version answers 412, success bumps the version', async () => {
		const created = await api.createReportEntry(entry());
		expect(created.version).toBe(1);
		const updated = await api.updateReportEntry(created.id, entry({ durationSeconds: 7200 }), 1);
		expect(updated).toMatchObject({ version: 2, durationSeconds: 7200 });
		const error = await api.updateReportEntry(created.id, entry(), 1).catch((e) => e);
		expect(error).toBeInstanceOf(ApiError);
		expect(error).toMatchObject({ status: 412, code: 'stale_version' });
		expect(await status(api.updateReportEntry(crypto.randomUUID(), entry(), 1))).toBe(404);
	});

	it('deletes entries and stores the week status without touching entries', async () => {
		const created = await api.createReportEntry(entry());
		expect((await api.putReportWeekStatus(2026, 42, 'done')).status).toBe('done');
		await api.updateReportEntry(created.id, entry({ notes: 'edit' }), 1);
		expect((await api.getReportWeek(2026, 42)).status).toBe('done');
		await api.deleteReportEntry(created.id);
		expect((await api.getReportWeek(2026, 42)).entries).toHaveLength(0);
		expect(await status(api.deleteReportEntry(created.id))).toBe(404);
	});

	it('adds the evaluated working time of the week as a hint', async () => {
		const week = await api.getReportWeek(2026, 42);
		expect(typeof week.trackedWorkSeconds).toBe('number');
	});

	it('separates accounts', async () => {
		await api.createReportEntry(entry());
		const other = createMockFetch({ now: () => NOW.getTime() });
		vi.stubGlobal('fetch', other.fetch);
		setCsrfToken(null);
		await signIn();
		expect((await api.getReportWeek(2026, 42)).entries).toHaveLength(0);
	});
});

describe('reports mock: text output', () => {
	it('answers text/plain in the standard format', async () => {
		await api.createReportEntry(entry({ notes: 'Subnetze' }));
		const text = await api.getReportWeekText(2026, 42);
		expect(text).toBe('Berichtsheft KW 42/2026 (12.10.2026 – 18.10.2026)\n\nDienstag, 13.10.2026\nLernfeld 4 | 1:00 h | Subnetze\n\nSumme: 1:00 h\n');
		expect(await status(api.getReportWeekText(2027, 53))).toBe(400);
	});
});

describe('reports mock: sources', () => {
	it('stores text notes per week or day and counts them', async () => {
		const note = await api.createReportSource({ year: 2026, week: 42, note: ' Stichpunkte ' });
		expect(note).toMatchObject({ note: 'Stichpunkte', date: null, file: null });
		await api.createReportSource({ year: 2026, week: 42, date: '2026-10-14', note: 'Mittwoch' });
		expect(await api.listReportSources(2026, 42)).toHaveLength(2);
		expect(await api.listReportSources(2026, 43)).toHaveLength(0);
		expect((await api.getReportWeek(2026, 42)).sourceCount).toBe(2);
		await api.deleteReportSource(note.id);
		expect(await status(api.deleteReportSource(note.id))).toBe(404);
		expect(await api.listReportSources(2026, 42)).toHaveLength(1);
	});

	it('requires exactly one of note and file, a day inside the week, and an owned file', async () => {
		expect(await status(api.createReportSource({ year: 2026, week: 42 }))).toBe(400);
		expect(await status(api.createReportSource({ year: 2026, week: 42, note: 'x', fileId: crypto.randomUUID() }))).toBe(400);
		expect(await status(api.createReportSource({ year: 2026, week: 42, note: 'x', date: '2026-10-20' }))).toBe(400);
		expect(await status(api.createReportSource({ year: 2026, week: 42, fileId: crypto.randomUUID() }))).toBe(404);
		expect(await status(api.listReportSources(2027, 53))).toBe(400);
	});

	it('links an uploaded file and shows its metadata', async () => {
		const meta = await api.uploadFile(new File(['hello'], 'notizen.txt', { type: 'text/plain' }));
		const source = await api.createReportSource({ year: 2026, week: 42, fileId: meta.id });
		expect(source.file).toMatchObject({ id: meta.id, name: 'notizen.txt' });
		expect((await api.listReportSources(2026, 42))[0].file?.name).toBe('notizen.txt');
	});
});
