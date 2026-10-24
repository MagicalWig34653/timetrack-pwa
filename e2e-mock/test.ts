import { test as base, expect } from '@playwright/test';

let activeFile: string | undefined;

export const test = base.extend<{ resetMock: void }>({
	resetMock: [async ({ request }, use, testInfo) => {
		if (activeFile !== testInfo.file) {
			const response = await request.post('/__test/reset');
			expect(response.status()).toBe(204);
			activeFile = testInfo.file;
		}
		await use();
	}, { auto: true }]
});

export { expect };
