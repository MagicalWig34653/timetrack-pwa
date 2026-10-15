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
			VAPID_SUBJECT: 'mailto:e2e@example.com'
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

	return async () => {
		await stage7.stop();
		await stage6.stop();
		await stage5.stop();
		await stage4.stop();
		await stage3.stop();
		await stage2.stop();
		await stage1.stop();
	};
}
