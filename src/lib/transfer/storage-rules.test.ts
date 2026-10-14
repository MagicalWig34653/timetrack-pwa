import { describe, expect, it } from 'vitest';
import { backendIssues, emptyForm, formFromSettings, inputFromForm, validateRules } from './storage-rules';

const settings = {
	rules: [{ maxBytes: 262144, backend: 'db' as const }, { maxBytes: 5242880, backend: 'local' as const }, { maxBytes: null, backend: 's3' as const }],
	maxUploadBytes: 10485760,
	localPath: '/data/files',
	s3: { endpoint: 'https://s3.example.org', region: 'eu-1', bucket: 'tt', pathStyle: true, accessKeyId: 'AKIA' },
	hasSecret: true
};

describe('storage rules form', () => {
	it('shows ordered rows with fitting units and a catch-all row, never prefilling the secret', () => {
		const form = formFromSettings(settings);
		expect(form.rules.map((r) => [r.amount, r.unit, r.backend])).toEqual([['256', 'KiB', 'db'], ['5', 'MiB', 'local']]);
		expect(form.lastBackend).toBe('s3');
		expect(form.maxUploadAmount).toBe('10');
		expect(form.secret).toBe('');
	});

	it('round-trips to the request: ascending limits, last rule without limit, secret only when typed', () => {
		const form = formFromSettings(settings);
		const input = inputFromForm(form)!;
		expect(input.rules).toEqual([{ maxBytes: 262144, backend: 'db' }, { maxBytes: 5242880, backend: 'local' }, { maxBytes: null, backend: 's3' }]);
		expect(input.s3).not.toHaveProperty('secretAccessKey');
		form.secret = 'geheim';
		expect(inputFromForm(form)!.s3?.secretAccessKey).toBe('geheim');
	});

	it('flags empty, non-ascending and over-limit rows', () => {
		const form = formFromSettings(settings);
		form.rules[1].amount = '100'; // 100 MiB > max upload 10 MiB and bigger than previous
		expect(validateRules(form).rows).toEqual([null, 'above_max']);
		form.rules[1].amount = '128';
		form.rules[1].unit = 'KiB'; // smaller than the previous 256 KiB
		expect(validateRules(form).rows).toEqual([null, 'order']);
		form.rules[0].amount = '';
		expect(validateRules(form).rows[0]).toBe('amount');
		expect(inputFromForm(form)).toBeNull();
	});

	it('requires the fields of the backends that are used', () => {
		const form = emptyForm();
		expect(backendIssues(form)).toEqual([]);
		form.lastBackend = 'local';
		expect(backendIssues(form)).toEqual(['local_path']);
		form.lastBackend = 's3';
		expect(backendIssues(form)).toEqual(['s3_fields']);
		form.localPath = '/x';
		form.endpoint = 'https://s3';
		form.region = 'r';
		form.bucket = 'b';
		form.accessKeyId = 'k';
		expect(backendIssues(form)).toEqual([]);
	});
});
