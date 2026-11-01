/**
 * Feature gates by API contract version (GET /system/info -> backend.apiVersion). A client must not enable a feature the
 * server would silently ignore: before 0.35.0 a `blocks` list in a plan write is dropped and the old fields win.
 */
export const PLAN_BLOCKS_MIN_API = '0.35.0';

/** Numeric compare of "major.minor.patch" (extra suffixes such as "-mock" are ignored); unparsable input sorts lowest. */
export function compareVersions(a: string, b: string): number {
	const parse = (value: string) => {
		const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value.trim());
		return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [-1, -1, -1];
	};
	const left = parse(a);
	const right = parse(b);
	for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
	return 0;
}

export const supportsPlanBlocks = (apiVersion: string | null | undefined): boolean => !!apiVersion && compareVersions(apiVersion, PLAN_BLOCKS_MIN_API) >= 0;
