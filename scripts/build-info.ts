import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Version information embedded into the app and written to `build/version.json` (ADR-0023 of the backend repository). */
export interface BuildInfo {
	version: string;
	revision: string;
	buildDate: string;
}

/**
 * `PWA_VERSION` (Docker build: tag without "v" or "main") wins over package.json; `PWA_REVISION` (Docker build: the PWA
 * checkout has no .git) wins over `git rev-parse HEAD`; `PWA_BUILD_DATE` over the current time. Unknown values stay "unknown".
 */
export function resolveBuildInfo(env: Record<string, string | undefined> = process.env, now: () => Date = () => new Date()): BuildInfo {
	const clean = (value: string | undefined) => value?.trim() || undefined;
	let revision = clean(env.PWA_REVISION);
	if (!revision) {
		try {
			revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
		} catch {
			revision = undefined;
		}
	}
	const packageVersion = (JSON.parse(readFileSync('package.json', 'utf8')) as { version?: string }).version;
	return {
		version: clean(env.PWA_VERSION) ?? packageVersion ?? 'dev',
		revision: revision && /^[0-9a-f]{7,64}$/i.test(revision) ? revision.toLowerCase() : 'unknown',
		buildDate: clean(env.PWA_BUILD_DATE) ?? now().toISOString()
	};
}
