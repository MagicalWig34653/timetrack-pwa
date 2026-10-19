import { expect, test } from '@playwright/test';
import { samplePdf, samplePng } from '../mock/sample-files';
import { apiCall as api, apiDownload, apiUpload, newActor as baseActor, registerViaInvite, type Actor } from './helpers';

// Package P5 against the real backend: absence list filters/sorting, attachment preview (PDF, image, text) and calendar tiles.
test.describe.configure({ mode: 'serial' });

const BASE = process.env.E2E_ABSENCES_BASE_URL ?? `http://localhost:${Number(process.env.E2E_PORT ?? 18090) + 16}`;
test.use({ baseURL: BASE });

let alice: Actor;
const ids: { sick?: string; vacation?: string; other?: string } = {};

test.afterAll(async () => {
	await alice?.context.close();
});

test('setup: account, absences and three attachments on the sick absence', async ({ browser }) => {
	alice = await baseActor(browser, [], BASE);
	await registerViaInvite(alice, new URL(process.env.E2E_ABSENCES_BOOTSTRAP_LINK!).pathname, 'alice.abs', 'Alice Abwesend', 'Passkey');
	await alice.page.getByRole('button', { name: 'Später einrichten' }).click();
	await expect(alice.page.getByRole('heading', { name: 'Hallo, Alice Abwesend' })).toBeVisible();
	const { page } = alice;
	const create = async (body: object) => {
		const res = await api(page, 'POST', '/api/v1/absences', body);
		expect(res.status).toBe(201);
		return (res.body as { id: string }).id;
	};
	ids.sick = await create({ kind: 'sick', startDate: '2026-03-02', endDate: '2026-03-03', status: 'taken', note: 'Grippe' });
	ids.vacation = await create({ kind: 'vacation', startDate: '2026-07-06', endDate: '2026-07-10', status: 'approved', note: 'Sommer' });
	ids.other = await create({ kind: 'other', startDate: '2026-05-04', endDate: '2026-05-04', status: 'planned' });
	const upload = async (name: string, bytes: Buffer, type: string) => {
		const up = await apiUpload(page, '/api/v1/files', name, bytes, type);
		expect(up.status).toBe(201);
		const fileId = (up.body as { id: string }).id;
		expect((await api(page, 'POST', `/api/v1/absences/${ids.sick}/attachments`, { fileId })).status).toBe(201);
		return fileId;
	};
	const pdfId = await upload('Krankmeldung.pdf', Buffer.from(samplePdf('Krankmeldung')), 'application/pdf');
	await upload('Scan.png', Buffer.from(samplePng()), 'image/png');
	await upload('Notiz.txt', Buffer.from('Hallo Praxis'), 'text/plain');
	// the backend answers downloads as an attachment, so the PWA has to render from a fetched blob
	const download = await apiDownload(page, `/api/v1/files/${pdfId}`);
	expect(download.headers['content-disposition']).toContain('attachment');
});

test('sorts, filters, counts and mirrors the filters in the URL', async () => {
	const { page } = alice;
	await page.goto('/absences?year=2026');
	await expect(page.getByTestId('absence-row')).toHaveCount(3);
	await expect(page.getByTestId('absences-count')).toHaveText('3 von 3 Abwesenheiten');
	await expect(page.getByTestId('absence-row').first()).toContainText('02.03.2026');
	await page.getByLabel('Sortierung').selectOption('date_desc');
	await expect(page.getByTestId('absence-row').first()).toContainText('06.07.2026');
	await expect(page).toHaveURL(/sort=date_desc/);
	await page.getByLabel('Suche in der Notiz').fill('grippe');
	await expect(page.getByTestId('absence-row')).toHaveCount(1);
	await expect(page).toHaveURL(/q=grippe/);
	// remembered per browser: a plain visit restores the filters
	await page.goto('/absences');
	await expect(page.getByLabel('Suche in der Notiz')).toHaveValue('grippe');
	await expect(page.getByTestId('absence-row')).toHaveCount(1);
	// a link with parameters wins over the remembered filters
	await page.goto('/absences?kind=vacation');
	await expect(page.getByLabel('Suche in der Notiz')).toHaveValue('');
	await expect(page.getByTestId('absence-row')).toHaveCount(1);
	await expect(page.getByTestId('absence-row')).toContainText('Urlaub');
	await page.getByTestId('absences-reset').click();
	await expect(page.getByTestId('absence-row')).toHaveCount(3);
	// attachment filter after the counts are loaded
	await expect(page.getByRole('button', { name: 'Anhänge (3)' })).toBeVisible();
	await page.getByLabel('Anhang').selectOption('with');
	await expect(page.getByTestId('absence-row')).toHaveCount(1);
	await page.getByLabel('Anhang').selectOption('without');
	await expect(page.getByTestId('absence-row')).toHaveCount(2);
	await page.getByLabel('Suche in der Notiz').fill('gibt es nicht');
	await expect(page.getByTestId('absences-empty')).toBeVisible();
	await page.getByTestId('absences-empty').getByRole('button', { name: 'Filter zurücksetzen' }).click();
	await expect(page.getByTestId('absence-row')).toHaveCount(3);
});

test('previews PDF, image and text attachments in a dialog, keyboard accessible', async () => {
	const { page } = alice;
	await page.goto('/absences?year=2026&kind=sick');
	const row = page.getByTestId('absence-row');
	await row.getByRole('button', { name: 'Anhänge (3)' }).click();
	const items = row.getByTestId('attachment');
	await expect(items).toHaveCount(3);
	await expect(items.filter({ hasText: 'Krankmeldung.pdf' })).toContainText('PDF');
	// keyboard: focus the view button of the PDF and press Enter
	const view = row.getByRole('button', { name: 'Krankmeldung.pdf ansehen' });
	await view.focus();
	await page.keyboard.press('Enter');
	const dialog = page.getByTestId('preview-dialog');
	await expect(dialog).toBeVisible();
	await expect(dialog.getByTestId('preview-title')).toHaveText('Krankmeldung.pdf');
	// headless browsers have no PDF viewer: the dialog then explains that and keeps "new tab" and "download"
	const pdfViewer = await page.evaluate(() => navigator.pdfViewerEnabled !== false);
	if (pdfViewer) await expect(dialog.getByTestId('preview-pdf')).toHaveAttribute('src', /^blob:/);
	else await expect(dialog.getByTestId('preview-unsupported')).toContainText('PDFs nicht selbst anzeigen');
	await expect(dialog.getByTestId('preview-close')).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	await expect(view).toBeFocused();

	await row.getByRole('button', { name: 'Scan.png ansehen' }).click();
	const image = dialog.getByTestId('preview-image');
	await expect(image).toBeVisible();
	await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(240);
	await dialog.getByTestId('preview-close').click();

	await row.getByRole('button', { name: 'Notiz.txt ansehen' }).click();
	await expect(dialog.getByTestId('preview-text')).toHaveText('Hallo Praxis');
	const [saved] = await Promise.all([page.waitForEvent('download'), dialog.getByTestId('preview-download').click()]);
	expect(saved.suggestedFilename()).toBe('Notiz.txt');
	await page.keyboard.press('Escape');
});

test('calendar tiles are coloured by working day, free day and absence', async () => {
	const { page } = alice;
	await page.goto('/calendar?date=2026-07-15');
	const grid = page.getByTestId('month-grid');
	const state = (date: string) => grid.locator(`[data-date="${date}"]`).getAttribute('data-work-state');
	await expect.poll(() => state('2026-07-14')).toBe('work');
	expect(await state('2026-07-11')).toBe('free'); // Saturday
	expect(await state('2026-07-08')).toBe('vacation_booked');
	await expect(page.getByTestId('tile-legend').getByRole('listitem')).toHaveCount(6);
});
