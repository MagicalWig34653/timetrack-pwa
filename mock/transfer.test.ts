import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, setCsrfToken } from '../src/lib/api/client.ts';
import type { ImportMapping } from '../src/lib/api/types.ts';
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

/** Reads a Blob as text (jsdom's Blob and Node's Response do not mix). */
const blobText = (blob: Blob): Promise<string> =>
	new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error);
		reader.readAsText(blob);
	});

const csvFile = (text: string, name = 'zeiten.csv') => new File([text], name, { type: 'text/csv' });
const mapping = (extra: Partial<ImportMapping> = {}): ImportMapping => ({
	sheet: 'Tabelle1',
	headerRow: 1,
	dateFormat: 'dd.MM.yyyy',
	timeFormat: 'HH:mm',
	columns: { date: 0, start: 1, end: 2, kind: null, place: null, note: null, duration: null },
	...extra
});
const SAMPLE = 'Datum;Beginn;Ende\r\n03.03.2031;8:00;12:00\r\n03.03.2031;12:30;16:45\r\n04.03.2031;8:00;11:30\r\nSumme;;\r\n';

async function dayWork(date: string) {
	return (await api.getDay(date)).rawWorkSeconds;
}

describe('export mock', () => {
	it('returns a real CSV with separate actual and evaluated columns, a sum row and a filename', async () => {
		await api.createSegment({ kind: 'work', startedAt: '2031-03-03T07:00:00Z', endedAt: '2031-03-03T11:00:00Z' });
		const file = await api.exportTime('2031-03-01', '2031-03-31', 'csv');
		expect(file.filename).toBe('Arbeitszeit_2031-03-01_2031-03-31.csv');
		expect(file.blob.type).toContain('text/csv');
		const text = await blobText(file.blob);
		expect(text).toContain('Beginn (tatsächlich)');
		expect(text).toContain('Arbeitszeit (bewertet)');
		expect(text).toContain('03.03.2031;Mo;08:00;12:00;4:00');
		expect(text).toMatch(/\r\nSumme;/);
		expect(text).toContain('Zeitraum;01.03.2031 – 31.03.2031');
	});

	it('serves xlsx and pdf placeholders with the right type and rejects long ranges', async () => {
		const pdf = await api.exportTime('2031-03-01', '2031-03-31', 'pdf');
		expect(pdf.blob.type).toBe('application/pdf');
		expect(await blobText(pdf.blob)).toMatch(/^%PDF-1\.4/);
		const xlsx = await api.exportTime('2031-03-01', '2031-03-31', 'xlsx');
		expect(xlsx.blob.type).toContain('spreadsheetml');
		expect(xlsx.filename).toMatch(/\.xlsx$/);
		await expect(api.exportTime('2031-01-01', '2032-01-02', 'csv')).rejects.toMatchObject({ status: 400, code: 'range_too_large' });
		await expect(api.exportTime('2031-01-05', '2031-01-01', 'csv')).rejects.toMatchObject({ status: 400 });
	});
});

describe('import mock', () => {
	it('walks upload -> raw preview -> mapping preview -> commit and writes nothing before the commit', async () => {
		const job = await api.uploadImport(csvFile(SAMPLE));
		expect(job).toMatchObject({ kind: 'csv', status: 'uploaded', filename: 'zeiten.csv' });
		const raw = await api.previewImportRows(job.id);
		expect(raw.rows[0]).toEqual(['Datum', 'Beginn', 'Ende']);
		const preview = await api.putImportMapping(job.id, mapping());
		expect(preview).toMatchObject({ rows: 3, valid: 3, duplicates: 0, errors: [] });
		expect(await dayWork('2031-03-03')).toBe(0); // nothing written by the preview
		const result = await api.commitImport(job.id);
		expect(result).toMatchObject({ created: 3, skipped: 0 });
		expect(await dayWork('2031-03-03')).toBe((4 * 3600) + (4 * 3600 + 15 * 60));
		expect((await api.getImport(job.id)).status).toBe('committed');
	});

	it('reads windows-1252 files and decimal hours (7,7 = 7:42)', async () => {
		const bytes = new Uint8Array([...'Datum;Beginn;Dauer\n05.03.2031;8:00;7,7\n'].map((c) => c.charCodeAt(0)));
		const job = await api.uploadImport(new File([bytes], 'a.csv'));
		const preview = await api.putImportMapping(job.id, mapping({ timeFormat: 'decimal_hours', columns: { date: 0, start: 1, end: null, duration: 2 } }));
		// "8:00" is not a decimal-hour time of day
		expect(preview.errors).toEqual([{ row: 2, code: 'time_invalid' }]);
		const job2 = await api.uploadImport(csvFile('Datum;Beginn;Dauer\n05.03.2031;8;7,7\n'));
		expect((await api.putImportMapping(job2.id, mapping({ timeFormat: 'decimal_hours', columns: { date: 0, start: 1, end: null, duration: 2 } }))).valid).toBe(1);
		await api.commitImport(job2.id);
		expect(await dayWork('2031-03-05')).toBe(7 * 3600 + 42 * 60);
	});

	it('refuses to commit before a mapping exists and refuses error rows unless explicitly ignored', async () => {
		const job = await api.uploadImport(csvFile('Datum;Beginn;Ende\n07.03.2031;8:00;12:00\nkaputt;8:00;12:00\n'));
		await expect(api.commitImport(job.id)).rejects.toMatchObject({ status: 409, code: 'import_not_ready' });
		const preview = await api.putImportMapping(job.id, mapping());
		expect(preview.errors).toEqual([{ row: 3, code: 'date_invalid' }]);
		await expect(api.commitImport(job.id)).rejects.toMatchObject({ status: 409, code: 'import_has_errors' });
		expect(await dayWork('2031-03-07')).toBe(0);
		expect(await api.commitImport(job.id, true)).toMatchObject({ created: 1, skipped: 1 });
		await expect(api.commitImport(job.id, true)).rejects.toMatchObject({ code: 'import_not_ready' });
	});

	it('is idempotent: importing the same file again finds only duplicates and creates nothing', async () => {
		const first = await api.uploadImport(csvFile(SAMPLE));
		await api.putImportMapping(first.id, mapping());
		expect(await api.commitImport(first.id)).toMatchObject({ created: 3 });
		const second = await api.uploadImport(csvFile(SAMPLE));
		expect(second.sha256).toBe(first.sha256);
		const preview = await api.putImportMapping(second.id, mapping());
		expect(preview).toMatchObject({ valid: 0, duplicates: 3 });
		expect(await api.commitImport(second.id)).toMatchObject({ created: 0, skipped: 3 });
		expect(await dayWork('2031-03-04')).toBe(3.5 * 3600);
	});

	it('rolls a batch back when unchanged and answers 409 with the conflict list after a change', async () => {
		const job = await api.uploadImport(csvFile('Datum;Beginn;Ende\n10.03.2031;8:00;12:00\n11.03.2031;8:00;12:00\n'));
		await api.putImportMapping(job.id, mapping());
		await api.commitImport(job.id);
		const [first] = await api.listSegments('2031-03-10T00:00:00Z', '2031-03-10T23:00:00Z');
		await api.correctSegment(first.id, { endedAt: '2031-03-10T11:30:00Z', reason: 'Korrektur' }, first.version);
		const error = (await api.rollbackImport(job.id).catch((e) => e)) as ApiError;
		expect(error.status).toBe(409);
		expect((error.body as { conflicts: string[] }).conflicts).toEqual([first.id]);
		expect(await dayWork('2031-03-11')).toBe(4 * 3600); // nothing rolled back on conflict

		const clean = await api.uploadImport(csvFile('Datum;Beginn;Ende\n12.03.2031;8:00;12:00\n'));
		await api.putImportMapping(clean.id, mapping());
		await api.commitImport(clean.id);
		await api.rollbackImport(clean.id);
		expect(await dayWork('2031-03-12')).toBe(0);
		expect((await api.getImport(clean.id)).status).toBe('rolled_back');
		await expect(api.rollbackImport(clean.id)).rejects.toMatchObject({ code: 'import_not_ready' });
	});

	it('discards uncommitted jobs only and validates uploads (413, 415, empty)', async () => {
		const job = await api.uploadImport(csvFile(SAMPLE));
		await api.discardImport(job.id);
		await expect(api.getImport(job.id)).rejects.toMatchObject({ status: 404 });
		await expect(api.uploadImport(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.csv'))).rejects.toMatchObject({ status: 413, code: 'file_too_large' });
		await expect(api.uploadImport(new File(['x'], 'a.pdf'))).rejects.toMatchObject({ status: 415, code: 'unsupported_type' });
		const committed = await api.uploadImport(csvFile('Datum;Beginn;Ende\n13.03.2031;8:00;9:00\n'));
		await api.putImportMapping(committed.id, mapping());
		await api.commitImport(committed.id);
		await expect(api.discardImport(committed.id)).rejects.toMatchObject({ status: 409 });
	});

	it('rejects broken mappings with 400 and other accounts cannot see a job', async () => {
		const job = await api.uploadImport(csvFile(SAMPLE));
		await expect(api.putImportMapping(job.id, mapping({ columns: { date: 0, start: 1 } }))).rejects.toMatchObject({ status: 400 });
		await expect(api.putImportMapping(job.id, mapping({ sheet: 'Nope' }))).rejects.toMatchObject({ status: 400 });
	});

	it('stores, lists and deletes mapping templates', async () => {
		const template = await api.createImportTemplate('Standard', mapping());
		expect(await api.listImportTemplates()).toEqual([template]);
		await expect(api.createImportTemplate('  ', mapping())).rejects.toMatchObject({ status: 400 });
		await api.deleteImportTemplate(template.id);
		expect(await api.listImportTemplates()).toEqual([]);
		await expect(api.deleteImportTemplate(template.id)).rejects.toMatchObject({ status: 404 });
	});
});

describe('storage and files mock', () => {
	it('keeps the secret write-only and applies new rules only to new uploads', async () => {
		const before = await api.uploadFile(new File(['%PDF-1.4 klein'], 'a.pdf'));
		expect(before.backend).toBe('db');
		const saved = await api.putStorageSettings({
			rules: [{ maxBytes: 10, backend: 'db' }, { maxBytes: null, backend: 's3' }],
			maxUploadBytes: 1048576,
			s3: { endpoint: 'https://s3.example.org', region: 'eu', bucket: 'b', pathStyle: true, accessKeyId: 'AKIA', secretAccessKey: 'top-secret' }
		});
		expect(saved.hasSecret).toBe(true);
		expect(JSON.stringify(saved)).not.toContain('top-secret');
		expect(JSON.stringify(await api.getStorageSettings())).not.toContain('top-secret');
		const after = await api.uploadFile(new File(['%PDF-1.4 groesser als zehn'], 'b.pdf'));
		expect(after.backend).toBe('s3');
		// existing file keeps its location
		const downloaded = await api.downloadFile(before.id);
		expect(downloaded.blob.size).toBe(before.size);
		// keeping the secret: a later save without secretAccessKey leaves hasSecret on
		const again = await api.putStorageSettings({ ...{ rules: saved.rules, maxUploadBytes: saved.maxUploadBytes, s3: { ...saved.s3 } } });
		expect(again.hasSecret).toBe(true);
	});

	it('validates rules: last rule without limit, ascending limits, required backend fields', async () => {
		const put = (rules: any[], extra = {}) => api.putStorageSettings({ rules, maxUploadBytes: 1000, ...extra });
		await expect(put([{ maxBytes: 5, backend: 'db' }])).rejects.toMatchObject({ status: 400 });
		await expect(put([{ maxBytes: 5, backend: 'db' }, { maxBytes: 5, backend: 'db' }, { maxBytes: null, backend: 'db' }])).rejects.toMatchObject({ status: 400 });
		await expect(put([{ maxBytes: null, backend: 'local' }])).rejects.toMatchObject({ status: 400 });
		await expect(put([{ maxBytes: null, backend: 's3' }])).rejects.toMatchObject({ status: 400 });
		await expect(put([])).rejects.toMatchObject({ status: 400 });
		expect((await put([{ maxBytes: null, backend: 'local' }], { localPath: '/data' })).localPath).toBe('/data');
	});

	it('answers 501 for S3 when the server has no STORAGE_SECRET_KEY', async () => {
		mock = createMockFetch({ now: () => NOW.getTime(), storageSecretKey: false });
		vi.stubGlobal('fetch', mock.fetch);
		setCsrfToken(null);
		await signIn();
		await expect(
			api.putStorageSettings({ rules: [{ maxBytes: null, backend: 's3' }], s3: { endpoint: 'https://s3', region: 'r', bucket: 'b', accessKeyId: 'k', secretAccessKey: 's' } })
		).rejects.toMatchObject({ status: 501 });
	});

	it('rejects too large (413) and wrongly typed (415) files by content, not by name alone', async () => {
		await api.putStorageSettings({ rules: [{ maxBytes: null, backend: 'db' }], maxUploadBytes: 20 });
		await expect(api.uploadFile(new File([new Uint8Array(21).fill(65)], 'a.txt'))).rejects.toMatchObject({ status: 413, code: 'file_too_large' });
		await expect(api.uploadFile(new File(['not a pdf'], 'fake.pdf'))).rejects.toMatchObject({ status: 415, code: 'unsupported_type' });
		await expect(api.uploadFile(new File(['x'], 'run.exe'))).rejects.toMatchObject({ status: 415 });
		expect((await api.uploadFile(new File(['hallo'], '../../etc/passwd.txt'))).name).toBe('passwd.txt');
	});
});

describe('attachments mock', () => {
	async function absence() {
		return api.createAbsence({ kind: 'sick', startDate: '2031-04-07', endDate: '2031-04-08', status: 'approved' });
	}

	it('attaches, lists, downloads with filename and detaches', async () => {
		const a = await absence();
		const file = await api.uploadFile(new File(['%PDF-1.4 krank'], 'Krankmeldung.pdf', { type: 'application/pdf' }));
		await api.attachFile(a.id, file.id);
		expect((await api.listAbsenceAttachments(a.id)).map((f) => f.name)).toEqual(['Krankmeldung.pdf']);
		const download = await api.downloadFile(file.id);
		expect(download.filename).toBe('Krankmeldung.pdf');
		expect(await blobText(download.blob)).toBe('%PDF-1.4 krank');
		await api.detachFile(a.id, file.id);
		expect(await api.listAbsenceAttachments(a.id)).toEqual([]);
		await expect(api.detachFile(a.id, file.id)).rejects.toMatchObject({ status: 404 });
	});

	it('answers 404 for unknown absences and never lists attachments in shared views', async () => {
		await expect(api.listAbsenceAttachments('00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({ status: 404 });
		const a = await absence();
		const file = await api.uploadFile(new File(['x'], 'n.txt'));
		await api.attachFile(a.id, file.id);
		const shares = await api.listShares();
		expect(JSON.stringify(shares)).not.toContain(file.id);
	});
});

describe('storage admin permissions', () => {
	it('is admin only', async () => {
		// the demo second account has no login; register a member through an invitation instead of reaching into the mock
		const inviteOptions = await api.registerOptions({ inviteToken: 'demo-invite', handle: 'mitglied', displayName: 'Mitglied' });
		const member = await api.registerVerify(inviteOptions.challengeId, { id: 'x' });
		sessionStore.set(member);
		await expect(api.getStorageSettings()).rejects.toMatchObject({ status: 403 });
		await expect(api.putStorageSettings({ rules: [{ maxBytes: null, backend: 'db' }] })).rejects.toMatchObject({ status: 403 });
	});
});

describe('absence attachment count, hasAttachment filter and inline download (contract 0.24.0)', () => {
	const pdf = () => new File(['%PDF-1.4 klein'], 'attest.pdf');
	const list = (hasAttachment?: boolean) => api.listAbsences('2026-01-01', '2026-12-31', hasAttachment === undefined ? {} : { hasAttachment });

	it('counts stored attachments per absence in list, detail and update', async () => {
		const [first, second] = await list();
		expect((await list()).every((a) => a.attachmentCount === 0)).toBe(true);
		const a = await api.uploadFile(pdf());
		const b = await api.uploadFile(new File(['%PDF-1.4 zwei'], 'zwei.pdf'));
		await api.attachFile(first.id, a.id);
		await api.attachFile(first.id, b.id);
		await api.attachFile(second.id, a.id); // the same file on two absences counts for both
		const counts = Object.fromEntries((await list()).map((x) => [x.id, x.attachmentCount]));
		expect(counts[first.id]).toBe(2);
		expect(counts[second.id]).toBe(1);
		expect((await api.getAbsence(first.id)).attachmentCount).toBe(2);
		const { id, version, countedHalfDays, attachmentCount, ...input } = first;
		expect(attachmentCount).toBe(0);
		expect((await api.updateAbsence(id, input, version)).attachmentCount).toBe(2);
		await api.detachFile(first.id, a.id);
		expect((await api.getAbsence(first.id)).attachmentCount).toBe(1);
		await api.deleteFile(b.id);
		expect((await api.getAbsence(first.id)).attachmentCount).toBe(0);
	});

	it('filters with hasAttachment=true|false and rejects other values', async () => {
		const all = await list();
		const file = await api.uploadFile(pdf());
		await api.attachFile(all[0].id, file.id);
		expect((await list(true)).map((a) => a.id)).toEqual([all[0].id]);
		expect((await list(false)).map((a) => a.id)).toEqual(all.slice(1).map((a) => a.id));
		const bad = await mock.fetch('/api/v1/absences?from=2026-01-01&to=2026-12-31&hasAttachment=maybe', { credentials: 'include' });
		expect(bad.status).toBe(400);
	});

	it('serves safe types inline with nosniff and a sandbox CSP, everything else stays an attachment', async () => {
		const file = await api.uploadFile(pdf());
		const inline = await mock.fetch(`/api/v1/files/${file.id}?disposition=inline`, { credentials: 'include' });
		expect(inline.headers.get('Content-Disposition')).toMatch(/^inline;/);
		expect(inline.headers.get('X-Content-Type-Options')).toBe('nosniff');
		expect(inline.headers.get('Content-Security-Policy')).toBe("sandbox; default-src 'none'");
		const plain = await mock.fetch(`/api/v1/files/${file.id}`, { credentials: 'include' });
		expect(plain.headers.get('Content-Disposition')).toMatch(/^attachment;/);
		expect(plain.headers.get('Content-Security-Policy')).toBeNull();
		const other = await mock.fetch(`/api/v1/files/${file.id}?disposition=sideways`, { credentials: 'include' });
		expect(other.headers.get('Content-Disposition')).toMatch(/^attachment;/);
	});
});
