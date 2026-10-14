import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
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

export default async function globalSetup() {
	const port = Number(process.env.E2E_PORT ?? 18090);
	const backendDir = path.resolve(pwaDir, process.env.E2E_BACKEND_DIR ?? '../timetrack-backend');
	const base = `http://localhost:${port}`;

	if (await portInUse(port)) {
		throw new Error(
			`Port ${port} is already in use. Not killing foreign processes; set E2E_PORT to a free port ` +
				`(18080 is usually the compose backend).`
		);
	}
	if (!fs.existsSync(path.join(pwaDir, 'build', 'index.html'))) {
		throw new Error('build/index.html missing. Run `npm run build` first (`npm run test:e2e` does this).');
	}

	if (process.env.E2E_SKIP_BUILD !== '1') {
		const build = spawnSync('swift', ['build', '--build-system', 'native'], { cwd: backendDir, stdio: 'inherit' });
		if (build.status !== 0) throw new Error('swift build failed');
	}
	const binary = path.join(backendDir, '.build', 'debug', 'App');
	if (!fs.existsSync(binary)) throw new Error(`backend binary not found: ${binary}`);

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
		SESSION_TTL_HOURS: '24'
	};
	process.env.E2E_SQLITE_PATH = sqlitePath;

	// Bootstrap admin: the invite link is printed on stdout. It is kept in memory only (env of this process tree).
	const boot = spawnSync(binary, ['bootstrap-admin'], { env, encoding: 'utf8' });
	if (boot.status !== 0) throw new Error(`bootstrap-admin failed (exit ${boot.status})`);
	const match = boot.stdout.match(/https?:\/\/\S+\/invite\/\S+/);
	if (!match) throw new Error('bootstrap-admin printed no invite link');
	process.env.E2E_BOOTSTRAP_LINK = match[0];

	const server = spawn(binary, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], {
		env,
		stdio: 'ignore'
	});
	try {
		await waitReady(base, server);
	} catch (e) {
		server.kill('SIGTERM');
		fs.rmSync(tmp, { recursive: true, force: true });
		throw e;
	}

	return async () => {
		server.kill('SIGTERM');
		await new Promise((r) => setTimeout(r, 500));
		if (server.exitCode === null) server.kill('SIGKILL');
		fs.rmSync(tmp, { recursive: true, force: true });
	};
}
