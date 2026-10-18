import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pwaDir = path.resolve(here, '..');

function portInUse(port: number): Promise<boolean> {
	const probe = (host: string) =>
		new Promise<boolean>((resolve) => {
			const socket = net.connect({ port, host });
			socket.once('connect', () => (socket.destroy(), resolve(true)));
			socket.once('error', () => resolve(false));
		});
	return Promise.all([probe('127.0.0.1'), probe('::1')]).then((r) => r.some(Boolean));
}

async function waitReady(base: string, child: ChildProcess) {
	const deadline = Date.now() + 60_000;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) throw new Error(`backend exited early (code ${child.exitCode})`);
		try {
			const res = await fetch(`${base}/ready`);
			if (res.ok) return;
		} catch {
			/* not up yet */
		}
		await new Promise((r) => setTimeout(r, 300));
	}
	throw new Error('backend did not become ready within 60 s');
}

interface Instance {
	link: string;
	stop: () => Promise<void>;
}

/** Starts one backend instance with its own SQLite DB, mints the bootstrap invite and waits until it is ready. */
async function startInstance(
	binary: string,
	port: number,
	extraEnv: Record<string, string> = {},
	extraCleanup: string[] = []
): Promise<Instance & { sqlitePath: string }> {
	const base = `http://localhost:${port}`;
	if (await portInUse(port)) {
		throw new Error(
			`Port ${port} is already in use. Not killing foreign processes; set E2E_PORT to a free port ` +
				`(18080 is usually the compose backend).`
		);
	}
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'timetrack-e2e-'));
	const sqlitePath = path.join(tmp, 'e2e.sqlite');
	const env = {
		...process.env,
		DATABASE_DRIVER: 'sqlite',
		SQLITE_PATH: sqlitePath,
		AUTO_MIGRATE: 'true',
		PWA_STATIC_DIR: path.join(pwaDir, 'build'),
		PUBLIC_BASE_URL: base,
		WEBAUTHN_ORIGIN: base,
		WEBAUTHN_RP_ID: 'localhost',
		SESSION_TTL_HOURS: '24',
		// build metadata like the Docker image bakes in (Hilfe > Version und Build)
		TIMETRACK_VERSION: '0.0.0-e2e',
		TIMETRACK_REVISION: 'e2e0123456789abcdef0123456789abcdef01234',
		TIMETRACK_BUILD_DATE: '2026-10-18T08:00:00Z',
		...extraEnv
	};

	// Bootstrap admin: the invite link is printed on stdout. It is kept in memory only (env of this process tree).
	const boot = spawnSync(binary, ['bootstrap-admin'], { env, encoding: 'utf8' });
	if (boot.status !== 0) throw new Error(`bootstrap-admin failed (exit ${boot.status})`);
	const match = boot.stdout.match(/https?:\/\/\S+\/invite\/\S+/);
	if (!match) throw new Error('bootstrap-admin printed no invite link');

	const server = spawn(binary, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], { env, stdio: 'ignore' });
	const stop = async () => {
		server.kill('SIGTERM');
		await new Promise((r) => setTimeout(r, 500));
		if (server.exitCode === null) server.kill('SIGKILL');
		fs.rmSync(tmp, { recursive: true, force: true });
		for (const dir of extraCleanup) fs.rmSync(dir, { recursive: true, force: true });
	};
	try {
		await waitReady(base, server);
	} catch (e) {
		await stop();
		throw e;
	}
	return { link: match[0], sqlitePath, stop };
}

export default async function globalSetup() {
	const port = Number(process.env.E2E_PORT ?? 18090);
	const timePort = Number(process.env.E2E_TIME_PORT ?? port + 1);
	const planningPort = Number(process.env.E2E_PLANNING_PORT ?? port + 2);
	const transferPort = Number(process.env.E2E_TRANSFER_PORT ?? port + 3);
	const reportsPort = Number(process.env.E2E_REPORTS_PORT ?? port + 4);
	const mcpPort = Number(process.env.E2E_MCP_PORT ?? port + 5);
	const notificationsPort = Number(process.env.E2E_NOTIFICATIONS_PORT ?? port + 6);
	const modulesPort = Number(process.env.E2E_MODULES_PORT ?? port + 7);
	const modulesOperatorPort = Number(process.env.E2E_MODULES_OPERATOR_PORT ?? port + 8);
	const worktimePort = Number(process.env.E2E_WORKTIME_PORT ?? port + 9);
	const accountsPort = Number(process.env.E2E_ACCOUNTS_PORT ?? port + 10);
	const profilePort = Number(process.env.E2E_PROFILE_PORT ?? port + 11);
	const profileNoMailPort = Number(process.env.E2E_PROFILE_NOMAIL_PORT ?? port + 12);
	const profileSmtpPort = Number(process.env.E2E_PROFILE_SMTP_PORT ?? port + 13);
	const appearancePort = Number(process.env.E2E_APPEARANCE_PORT ?? port + 14);
	const vacationPlannerPort = Number(process.env.E2E_VACATION_PLANNER_PORT ?? port + 15);
	const backendDir = path.resolve(pwaDir, process.env.E2E_BACKEND_DIR ?? '../timetrack-backend');

	if (!fs.existsSync(path.join(pwaDir, 'build', 'index.html'))) {
		throw new Error('build/index.html missing. Run `npm run build` first (`npm run test:e2e` does this).');
	}
	if (process.env.E2E_SKIP_BUILD !== '1') {
		const build = spawnSync('swift', ['build', '--build-system', 'native'], { cwd: backendDir, stdio: 'inherit' });
		if (build.status !== 0) throw new Error('swift build failed');
	}
	const binary = path.join(backendDir, '.build', 'debug', 'App');
	if (!fs.existsSync(binary)) throw new Error(`backend binary not found: ${binary}`);

	// Stage 1 (accounts) and stage 2 (time tracking) each get their own instance and database, so the specs do not
	// depend on each other: a bootstrap invite can be used once, and only for the first account of a database.
	const stage1 = await startInstance(binary, port);
	process.env.E2E_SQLITE_PATH = stage1.sqlitePath;
	process.env.E2E_BOOTSTRAP_LINK = stage1.link;
	let stage2: Instance;
	try {
		stage2 = await startInstance(binary, timePort);
	} catch (e) {
		await stage1.stop();
		throw e;
	}
	process.env.E2E_TIME_BASE_URL = `http://localhost:${timePort}`;
	process.env.E2E_TIME_BOOTSTRAP_LINK = stage2.link;
	// Stage 3a (planning, vacation, sharing) gets a third instance with its own database.
	let stage3: Instance;
	try {
		stage3 = await startInstance(binary, planningPort);
	} catch (e) {
		await stage2.stop();
		await stage1.stop();
		throw e;
	}
	process.env.E2E_PLANNING_BASE_URL = `http://localhost:${planningPort}`;
	process.env.E2E_PLANNING_BOOTSTRAP_LINK = stage3.link;

	// Stage 3b (export, import, file storage) gets a fourth instance. It has a storage secret key (random per run, only
	// handed to the child process, never logged or written to process.env) and an empty temp dir for the local file backend.
	const storageDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'timetrack-e2e-files-')));
	let stage4: Instance;
	try {
		stage4 = await startInstance(binary, transferPort, { STORAGE_SECRET_KEY: randomBytes(32).toString('base64') }, [storageDir]);
	} catch (e) {
		fs.rmSync(storageDir, { recursive: true, force: true });
		await stage3.stop();
		await stage2.stop();
		await stage1.stop();
		throw e;
	}
	process.env.E2E_TRANSFER_BASE_URL = `http://localhost:${transferPort}`;
	process.env.E2E_TRANSFER_BOOTSTRAP_LINK = stage4.link;
	process.env.E2E_STORAGE_LOCAL_DIR = storageDir;

	// Stage 4a (Berichtsheft) gets a fifth instance with its own database. The default storage rules (database backend)
	// stay untouched, so report source uploads go through the DB backend.
	let stage5: Instance;
	try {
		stage5 = await startInstance(binary, reportsPort, { STORAGE_SECRET_KEY: randomBytes(32).toString('base64') });
	} catch (e) {
		await stage4.stop();
		await stage3.stop();
		await stage2.stop();
		await stage1.stop();
		throw e;
	}
	process.env.E2E_REPORTS_BASE_URL = `http://localhost:${reportsPort}`;
	process.env.E2E_REPORTS_BOOTSTRAP_LINK = stage5.link;

	// Package X1 (OAuth + MCP end to end) gets a sixth instance with its own database. PUBLIC_BASE_URL is the instance
	// origin, so the issuer / resource in the OAuth metadata can be asserted exactly.
	let stage6: Instance;
	try {
		stage6 = await startInstance(binary, mcpPort);
	} catch (e) {
		await stage5.stop();
		await stage4.stop();
		await stage3.stop();
		await stage2.stop();
		await stage1.stop();
		throw e;
	}
	process.env.E2E_MCP_BASE_URL = `http://localhost:${mcpPort}`;
	process.env.E2E_MCP_BOOTSTRAP_LINK = stage6.link;

	// Package L16 (notifications + Web Push) gets a seventh instance: background runner off (no timing dependence), generated
	// VAPID key (valid P-256 private scalar, base64url) so GET /push/config is available. The key lives only in the child env.
	const vapid = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'jwk' }).d as string;
	let stage7: Instance;
	try {
		stage7 = await startInstance(binary, notificationsPort, {
			NOTIFICATIONS_ENABLED: 'false',
			VAPID_PRIVATE_KEY: vapid,
			VAPID_SUBJECT: 'mailto:e2e@example.com',
			// C19 push endpoint policy: only allow-listed https hosts. This one never resolves, so tests never contact a real push service.
			PUSH_ALLOWED_HOSTS: '*.nx-e2e.timetrack-test.net'
		});
	} catch (e) {
		await stage6.stop();
		await stage5.stop();
		await stage4.stop();
		await stage3.stop();
		await stage2.stop();
		await stage1.stop();
		throw e;
	}
	process.env.E2E_NOTIFICATIONS_BASE_URL = `http://localhost:${notificationsPort}`;
	process.env.E2E_NOTIFICATIONS_BOOTSTRAP_LINK = stage7.link;

	// Package L18 (module switches against the real backend): one instance for account/server switches, a second one with the
	// operator lock MODULES_DISABLED (ADR-0012), each with its own database.
	const stopBase = async () => {
		await stage7.stop();
		await stage6.stop();
		await stage5.stop();
		await stage4.stop();
		await stage3.stop();
		await stage2.stop();
		await stage1.stop();
	};
	let stage8: Instance;
	try {
		stage8 = await startInstance(binary, modulesPort);
	} catch (e) {
		await stopBase();
		throw e;
	}
	process.env.E2E_MODULES_BASE_URL = `http://localhost:${modulesPort}`;
	process.env.E2E_MODULES_BOOTSTRAP_LINK = stage8.link;
	let stage9: Instance;
	try {
		stage9 = await startInstance(binary, modulesOperatorPort, { MODULES_DISABLED: 'reports,mcp' });
	} catch (e) {
		await stage8.stop();
		await stopBase();
		throw e;
	}
	process.env.E2E_MODULES_OPERATOR_BASE_URL = `http://localhost:${modulesOperatorPort}`;
	process.env.E2E_MODULES_OPERATOR_BOOTSTRAP_LINK = stage9.link;

	// Package L19 (worktime workbook import/export, ADR-0013): own instance and database, default settings.
	let stage10: Instance;
	try {
		stage10 = await startInstance(binary, worktimePort);
	} catch (e) {
		await stage9.stop();
		await stage8.stop();
		await stopBase();
		throw e;
	}
	process.env.E2E_WORKTIME_BASE_URL = `http://localhost:${worktimePort}`;
	process.env.E2E_WORKTIME_BOOTSTRAP_LINK = stage10.link;

	// Package L23 (account administration, export, self-deletion; ADR-0016): own instance and database, default settings.
	let stage11: Instance;
	try {
		stage11 = await startInstance(binary, accountsPort);
	} catch (e) {
		await stage10.stop();
		await stage9.stop();
		await stage8.stop();
		await stopBase();
		throw e;
	}
	process.env.E2E_ACCOUNTS_BASE_URL = `http://localhost:${accountsPort}`;
	process.env.E2E_ACCOUNTS_BOOTSTRAP_LINK = stage11.link;

	// Package P1 (profile, guided setup; ADR-0019): one instance with SMTP (the spec runs a tiny capturing SMTP server on
	// E2E_PROFILE_SMTP_PORT) and one without any mail transport.
	let stage12: Instance;
	try {
		stage12 = await startInstance(binary, profilePort, { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(profileSmtpPort), SMTP_TLS: 'off', SMTP_FROM: 'timetrack@example.test' });
	} catch (e) {
		await stage11.stop();
		await stage10.stop();
		await stage9.stop();
		await stage8.stop();
		await stopBase();
		throw e;
	}
	process.env.E2E_PROFILE_BASE_URL = `http://localhost:${profilePort}`;
	process.env.E2E_PROFILE_BOOTSTRAP_LINK = stage12.link;
	process.env.E2E_PROFILE_SMTP_PORT = String(profileSmtpPort);
	let stage13: Instance;
	try {
		stage13 = await startInstance(binary, profileNoMailPort);
	} catch (e) {
		await stage12.stop();
		await stage11.stop();
		await stage10.stop();
		await stage9.stop();
		await stage8.stop();
		await stopBase();
		throw e;
	}
	process.env.E2E_PROFILE_NOMAIL_BASE_URL = `http://localhost:${profileNoMailPort}`;
	process.env.E2E_PROFILE_NOMAIL_BOOTSTRAP_LINK = stage13.link;

	// Package P2 (appearance per account; ADR-0020): one plain instance.
	let stage14: Instance;
	try {
		stage14 = await startInstance(binary, appearancePort);
	} catch (e) {
		await stage13.stop();
		await stage12.stop();
		await stage11.stop();
		await stage10.stop();
		await stage9.stop();
		await stage8.stop();
		await stopBase();
		throw e;
	}
	process.env.E2E_APPEARANCE_BASE_URL = `http://localhost:${appearancePort}`;
	process.env.E2E_APPEARANCE_BOOTSTRAP_LINK = stage14.link;

	// Package V2-PWA (vacation planner against GET /vacation/suggestions): one plain instance.
	let stage15: Instance;
	try {
		stage15 = await startInstance(binary, vacationPlannerPort);
	} catch (e) {
		await stage14.stop();
		await stage13.stop();
		await stage12.stop();
		await stage11.stop();
		await stage10.stop();
		await stage9.stop();
		await stage8.stop();
		await stopBase();
		throw e;
	}
	process.env.E2E_VACATION_PLANNER_BASE_URL = `http://localhost:${vacationPlannerPort}`;
	process.env.E2E_VACATION_PLANNER_BOOTSTRAP_LINK = stage15.link;

	return async () => {
		await stage15.stop();
		await stage14.stop();
		await stage13.stop();
		await stage12.stop();
		await stage11.stop();
		await stage10.stop();
		await stage9.stop();
		await stage8.stop();
		await stopBase();
	};
}
