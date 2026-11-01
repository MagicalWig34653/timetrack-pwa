import type { ApnsCheckResult, ApnsProbe, ApnsStatus, PushDeviceInfo } from '../src/lib/api/types.ts';

// Mock of the APNs diagnosis (contract v0.38.0, package P14e) and of the Apple device list of contract v0.33.0:
// GET /admin/apns, POST /admin/apns/check, GET /me/push-devices, DELETE /me/push-devices/{id}, POST /me/push-devices/{id}/test.
// Mock-only hook (authenticated): POST /api/v1/mock/apns {configured?, scenario?, rateLimit?, testResult?, old?, devices?}
//   scenario: 'ok' | 'key' | 'topic' | 'network'; devices adds registered Apple devices to the calling account.

export type ApnsScenario = 'ok' | 'key' | 'topic' | 'network';
export interface ApnsResponse {
	status: number;
	body?: unknown;
}
const fail = (status: number, code: string): ApnsResponse => ({ status, body: { error: { code, message: code } } });
const BUNDLES = ['com.example.timetrack', 'com.example.timetrack.watchkitapp'];

export function createApnsMock(options: { now?: () => number } = {}) {
	const now = options.now ?? Date.now;
	const state = { configured: false, scenario: 'ok' as ApnsScenario, rateLimit: false, old: false, testResult: 'ok' as 'ok' | 'failed', testLimit: 5 };
	const devices = new Map<string, (PushDeviceInfo & { tests: number[] })[]>();
	const of = (accountId: string) => devices.get(accountId) ?? devices.set(accountId, []).get(accountId)!;
	const publicDevice = ({ tests: _tests, ...device }: PushDeviceInfo & { tests: number[] }): PushDeviceInfo => device;
	const total = () => [...devices.values()].reduce((sum, list) => sum + list.length, 0);

	const status = (): ApnsStatus =>
		state.configured
			? {
					configured: true,
					keyId: 'ABC123DEFG',
					teamId: 'ABCDE12345',
					bundleIds: BUNDLES,
					problems: [],
					deviceCount: total(),
					source: 'environment',
					hints: total() === 0 ? [{ severity: 'info', code: 'no_devices', message: 'Es ist noch kein Apple-Gerät registriert.' }] : []
				}
			: { configured: false, bundleIds: [], problems: [], deviceCount: total(), source: 'environment', hints: [{ severity: 'info', code: 'not_configured', message: 'Auf diesem Server ist APNs nicht eingerichtet.' }] };

	function check(): ApnsCheckResult {
		const probes: ApnsProbe[] = [];
		for (const bundleId of BUNDLES) {
			for (const environment of ['production', 'sandbox'] as const) {
				if (state.scenario === 'key') probes.push({ bundleId, environment, status: 'failed', httpStatus: 403, reason: 'InvalidProviderToken', advice: 'Apple lehnt den Schlüssel ab. Prüfe, ob APNS_KEY_ID zur .p8-Datei und APNS_TEAM_ID zu deinem Team gehört.' });
				else if (state.scenario === 'topic' && bundleId.endsWith('watchkitapp')) probes.push({ bundleId, environment, status: 'failed', httpStatus: 403, reason: 'TopicDisallowed', advice: 'Der Schlüssel darf für diese Bundle-ID nicht senden.' });
				else if (state.scenario === 'network') probes.push({ bundleId, environment, status: 'failed', reason: 'network', advice: 'Die Verbindung zu Apple ist fehlgeschlagen.' });
				else probes.push({ bundleId, environment, status: 'ok', httpStatus: 400, reason: 'BadDeviceToken' });
			}
		}
		const failed = probes.filter((p) => p.status === 'failed').length;
		return {
			ok: failed === 0,
			summary: failed === 0 ? 'Apple akzeptiert den Schlüssel für alle Bundle-IDs (Produktion und Sandbox). Es wurde nichts zugestellt.' : `Bei ${failed} von ${probes.length} Prüfungen hat Apple die Anfrage abgelehnt oder war nicht erreichbar.`,
			checkedAt: new Date(now()).toISOString(),
			totalMs: 180,
			probes
		};
	}

	function handle(ctx: { admin: boolean; accountId: string }, req: { method: string; path: string }): ApnsResponse | null {
		const { method, path } = req;
		let m: RegExpMatchArray | null;
		if (path.startsWith('/api/v1/admin/apns')) {
			if (state.old) return fail(404, 'not_found');
			if (!ctx.admin) return fail(403, 'forbidden');
			if (path === '/api/v1/admin/apns' && method === 'GET') return { status: 200, body: status() };
			if (path === '/api/v1/admin/apns/check' && method === 'POST') {
				if (!state.configured) return fail(501, 'push_unavailable');
				if (state.rateLimit) return fail(429, 'too_many_requests');
				return { status: 200, body: check() };
			}
			return null;
		}
		if (path === '/api/v1/me/push-devices' && method === 'GET') return { status: 200, body: of(ctx.accountId).map(publicDevice) };
		if ((m = path.match(/^\/api\/v1\/me\/push-devices\/([^/]+)$/)) && method === 'DELETE') {
			const list = of(ctx.accountId);
			const index = list.findIndex((d) => d.id === m![1]);
			if (index < 0) return fail(404, 'not_found');
			list.splice(index, 1);
			return { status: 204 };
		}
		if ((m = path.match(/^\/api\/v1\/me\/push-devices\/([^/]+)\/test$/)) && method === 'POST') {
			const device = of(ctx.accountId).find((d) => d.id === m![1]);
			if (!device) return fail(404, 'not_found');
			if (!state.configured) return fail(501, 'push_unavailable');
			device.tests = device.tests.filter((t) => t > now() - 3_600_000);
			if (device.tests.length >= state.testLimit) return fail(429, 'too_many_requests');
			device.tests.push(now());
			if (state.testResult === 'failed') return fail(502, 'push_failed');
			device.lastSuccessAt = new Date(now()).toISOString();
			return { status: 202 };
		}
		return null;
	}

	function hook(accountId: string, body: any): ApnsResponse {
		if (typeof body?.configured === 'boolean') state.configured = body.configured;
		if (typeof body?.scenario === 'string') state.scenario = body.scenario as ApnsScenario;
		if (typeof body?.rateLimit === 'boolean') state.rateLimit = body.rateLimit;
		if (typeof body?.old === 'boolean') state.old = body.old;
		if (body?.testResult === 'ok' || body?.testResult === 'failed') state.testResult = body.testResult;
		if (Number.isInteger(body?.testLimit)) state.testLimit = body.testLimit;
		if (Array.isArray(body?.devices)) {
			for (const input of body.devices as { platform?: PushDeviceInfo['platform']; environment?: PushDeviceInfo['environment']; label?: string }[]) {
				of(accountId).push({
					id: crypto.randomUUID(),
					platform: input.platform ?? 'ios',
					environment: input.environment ?? 'sandbox',
					appBundleId: BUNDLES[0],
					label: input.label ?? 'iPhone',
					createdAt: new Date(now()).toISOString(),
					lastSuccessAt: null,
					tests: []
				});
			}
		}
		return { status: 200, body: { ...state, devices: of(accountId).length } };
	}

	return { handle, hook, state };
}
