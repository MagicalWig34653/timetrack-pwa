import { describe, expect, it } from 'vitest';
import {
	hasWriteScope,
	isMcpScope,
	isSubset,
	isWriteScope,
	MCP_SCOPES,
	mcpServerUrl,
	normalizeScopes,
	READ_ONLY_SCOPES,
	READ_WRITE_SCOPES,
	sameScopes,
	toggleScope
} from './scopes.js';

describe('scope helpers', () => {
	it('knows the seven ADR-0009 scopes', () => {
		expect([...MCP_SCOPES]).toEqual(['time:read', 'time:write', 'schedule:read', 'schedule:write', 'reports:read', 'reports:write', 'documents:read']);
		expect(isMcpScope('time:read')).toBe(true);
		expect(isMcpScope('admin:all')).toBe(false);
		expect(isMcpScope(3)).toBe(false);
	});

	it('marks exactly the :write scopes', () => {
		expect(MCP_SCOPES.filter(isWriteScope)).toEqual(['time:write', 'schedule:write', 'reports:write']);
	});

	it('read-only preset has no write scope; read and write contains everything', () => {
		expect(READ_ONLY_SCOPES.some(isWriteScope)).toBe(false);
		expect([...READ_ONLY_SCOPES]).toEqual(['time:read', 'schedule:read', 'reports:read', 'documents:read']);
		expect([...READ_WRITE_SCOPES]).toEqual([...MCP_SCOPES]);
	});

	it('normalizes into canonical order and drops duplicates and unknown values', () => {
		expect(normalizeScopes(['reports:read', 'time:read', 'time:read', 'bogus'])).toEqual(['time:read', 'reports:read']);
	});

	it('toggles scopes without duplicates and keeps the canonical order', () => {
		expect(toggleScope(['reports:read'], 'time:read', true)).toEqual(['time:read', 'reports:read']);
		expect(toggleScope(['time:read'], 'time:read', true)).toEqual(['time:read']);
		expect(toggleScope(['time:read', 'time:write'], 'time:write', false)).toEqual(['time:read']);
	});

	it('compares sets regardless of order and detects subsets', () => {
		expect(sameScopes(['time:write', 'time:read'], ['time:read', 'time:write'])).toBe(true);
		expect(sameScopes(['time:read'], ['time:read', 'time:write'])).toBe(false);
		expect(isSubset(['time:read'], ['time:read', 'time:write'])).toBe(true);
		expect(isSubset(['reports:read'], ['time:read'])).toBe(false);
		expect(isSubset([], [])).toBe(true);
		expect(hasWriteScope(['time:read', 'reports:write'])).toBe(true);
		expect(hasWriteScope(READ_ONLY_SCOPES)).toBe(false);
	});

	it('builds the MCP server URL from the origin', () => {
		expect(mcpServerUrl('https://tt.example.org')).toBe('https://tt.example.org/mcp');
		expect(mcpServerUrl('https://tt.example.org/')).toBe('https://tt.example.org/mcp');
	});
});
