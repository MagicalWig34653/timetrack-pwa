// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';

const FIXED_UUID = [11, 1, 1]; // GHSA-w5hq-g745-h8pq: missing buffer bounds check below this version

describe('dependency floors', () => {
	it('locks no uuid below 11.1.1', () => {
		const lock = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package-lock.json'), 'utf8'));
		const versions = Object.entries(lock.packages as Record<string, { version: string }>)
			.filter(([key]) => key.endsWith('node_modules/uuid'))
			.map(([, entry]) => entry.version);
		expect(versions.length).toBeGreaterThan(0);
		for (const version of versions) {
			const parts = version.split('.').map(Number);
			const diff = parts.map((part, i) => part - FIXED_UUID[i]).find((d) => d !== 0) ?? 0;
			expect(diff, `uuid ${version} is vulnerable`).toBeGreaterThanOrEqual(0);
		}
	});

	// exceljs asks for uuid ^8, so the override needs proof. A data bar rule is the only place exceljs calls uuid.
	it('lets exceljs write and read a data bar rule with the overridden uuid', async () => {
		const workbook = new ExcelJS.Workbook();
		const sheet = workbook.addWorksheet('bars');
		sheet.addRows([[1], [2]]);
		sheet.addConditionalFormatting({
			ref: 'A1:A2',
			rules: [{ type: 'dataBar', priority: 1, gradient: false, cfvo: [{ type: 'min' }, { type: 'max' }] } as unknown as ExcelJS.ConditionalFormattingRule]
		});
		const buffer = await workbook.xlsx.writeBuffer();
		const reader = new ExcelJS.Workbook();
		await reader.xlsx.load(buffer);
		const [format] = (reader.getWorksheet('bars') as unknown as { conditionalFormattings: { rules: { type: string; x14Id?: string }[] }[] }).conditionalFormattings;
		expect(format.rules[0].type).toBe('dataBar');
		expect(format.rules[0].x14Id).toMatch(/^\{[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}\}$/);
	});
});
