import type { StorageBackend, StorageRule, StorageSettings, StorageSettingsInput } from '../api/types';
import { DEFAULT_MAX_UPLOAD_BYTES, fromBytes, toBytes, type SizeUnit } from './bytes';

/** Editable row of the rules table. The last row has no limit ("all larger"). */
export interface RuleRow {
	key: number;
	amount: string;
	unit: SizeUnit;
	backend: StorageBackend;
}

export interface StorageForm {
	rules: RuleRow[];
	/** backend of the final catch-all rule */
	lastBackend: StorageBackend;
	maxUploadAmount: string;
	maxUploadUnit: SizeUnit;
	localPath: string;
	endpoint: string;
	region: string;
	bucket: string;
	pathStyle: boolean;
	accessKeyId: string;
	/** write-only; never prefilled */
	secret: string;
}

export type RuleIssue = 'amount' | 'order' | 'above_max' | 'no_rules';

let nextKey = 1;
export const newRowKey = () => nextKey++;

export function formFromSettings(settings: StorageSettings): StorageForm {
	const limited = settings.rules.filter((r) => r.maxBytes != null);
	const last = settings.rules.find((r) => r.maxBytes == null) ?? settings.rules.at(-1);
	const max = fromBytes(settings.maxUploadBytes);
	return {
		rules: limited.map((r) => ({ key: newRowKey(), ...fromBytes(r.maxBytes as number), backend: r.backend })),
		lastBackend: last?.backend ?? 'db',
		maxUploadAmount: max.amount,
		maxUploadUnit: max.unit,
		localPath: settings.localPath ?? '',
		endpoint: settings.s3?.endpoint ?? '',
		region: settings.s3?.region ?? '',
		bucket: settings.s3?.bucket ?? '',
		pathStyle: settings.s3?.pathStyle ?? true,
		accessKeyId: settings.s3?.accessKeyId ?? '',
		secret: ''
	};
}

export function emptyForm(): StorageForm {
	return formFromSettings({ rules: [{ backend: 'db' }], maxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES, hasSecret: false });
}

/** Per-row problems (index = row; the catch-all row cannot be wrong) plus a form wide issue. */
export function validateRules(form: StorageForm): { rows: (RuleIssue | null)[]; maxUpload: boolean } {
	const maxUpload = toBytes(form.maxUploadAmount, form.maxUploadUnit);
	let previous = 0;
	const rows = form.rules.map((row): RuleIssue | null => {
		const bytes = toBytes(row.amount, row.unit);
		if (bytes === null) return 'amount';
		if (bytes <= previous) return 'order';
		previous = bytes;
		if (maxUpload !== null && bytes > maxUpload) return 'above_max';
		return null;
	});
	return { rows, maxUpload: maxUpload === null };
}

export function backendsInUse(form: StorageForm): Set<StorageBackend> {
	return new Set([...form.rules.map((r) => r.backend), form.lastBackend]);
}

/** Builds the PUT body; returns null when the rules are invalid. The secret is sent only when typed in. */
export function inputFromForm(form: StorageForm): StorageSettingsInput | null {
	const check = validateRules(form);
	if (check.maxUpload || check.rows.some((r) => r !== null)) return null;
	const rules: StorageRule[] = [
		...form.rules.map((r) => ({ maxBytes: toBytes(r.amount, r.unit) as number, backend: r.backend })),
		{ maxBytes: null, backend: form.lastBackend }
	];
	const used = backendsInUse(form);
	const input: StorageSettingsInput = {
		rules,
		maxUploadBytes: toBytes(form.maxUploadAmount, form.maxUploadUnit) as number,
		localPath: form.localPath.trim() || null
	};
	if (used.has('s3') || form.endpoint.trim() || form.bucket.trim()) {
		input.s3 = {
			endpoint: form.endpoint.trim(),
			region: form.region.trim(),
			bucket: form.bucket.trim(),
			pathStyle: form.pathStyle,
			accessKeyId: form.accessKeyId.trim(),
			...(form.secret ? { secretAccessKey: form.secret } : {})
		};
	} else input.s3 = null;
	return input;
}

export type BackendIssue = 'local_path' | 's3_fields';

/** Required fields of backends that the rules actually use. */
export function backendIssues(form: StorageForm): BackendIssue[] {
	const used = backendsInUse(form);
	const issues: BackendIssue[] = [];
	if (used.has('local') && !form.localPath.trim()) issues.push('local_path');
	if (used.has('s3') && !(form.endpoint.trim() && form.region.trim() && form.bucket.trim() && form.accessKeyId.trim())) issues.push('s3_fields');
	return issues;
}
