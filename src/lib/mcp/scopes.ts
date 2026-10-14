import type { McpScope } from '#lib/api/types.js';

/** All scopes of ADR-0009 in display order (read before write, per area). */
export const MCP_SCOPES: readonly McpScope[] = [
	'time:read',
	'time:write',
	'schedule:read',
	'schedule:write',
	'reports:read',
	'reports:write',
	'documents:read'
];

export function isMcpScope(value: unknown): value is McpScope {
	return typeof value === 'string' && (MCP_SCOPES as readonly string[]).includes(value);
}

/** Write scopes change data and are highlighted in the UI. */
export function isWriteScope(scope: McpScope): boolean {
	return scope.endsWith(':write');
}

/** Presets for the token form: read-only = every `:read` scope, read and write = everything. */
export const READ_ONLY_SCOPES: readonly McpScope[] = MCP_SCOPES.filter((s) => !isWriteScope(s));
export const READ_WRITE_SCOPES: readonly McpScope[] = MCP_SCOPES;

/** Sorts into the canonical order and drops duplicates and unknown values. */
export function normalizeScopes(scopes: readonly string[]): McpScope[] {
	return MCP_SCOPES.filter((s) => scopes.includes(s));
}

export function toggleScope(selected: readonly McpScope[], scope: McpScope, on: boolean): McpScope[] {
	return normalizeScopes(on ? [...selected, scope] : selected.filter((s) => s !== scope));
}

export function sameScopes(a: readonly McpScope[], b: readonly McpScope[]): boolean {
	const x = normalizeScopes(a);
	const y = normalizeScopes(b);
	return x.length === y.length && x.every((s, i) => s === y[i]);
}

export function isSubset(subset: readonly McpScope[], of: readonly McpScope[]): boolean {
	return subset.every((s) => of.includes(s));
}

export function hasWriteScope(scopes: readonly McpScope[]): boolean {
	return scopes.some(isWriteScope);
}

/** Token expiry choices in days (contract: 1 to 365). */
export const TOKEN_EXPIRY_DAYS = [30, 90, 365] as const;

/** `<origin>/mcp`, the URL to enter in ChatGPT/Claude. */
export function mcpServerUrl(origin: string): string {
	return origin.replace(/\/+$/, '') + '/mcp';
}
