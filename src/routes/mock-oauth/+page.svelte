<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { t } from '#lib/i18n/index.js';
	import ScopePicker from '#lib/components/mcp/ScopePicker.svelte';
	import type { McpScope } from '#lib/api/types.js';
	import { MCP_SCOPES } from '#lib/mcp/scopes.js';

	// Stand-in for an MCP client (ChatGPT/Claude) in mock mode: registers itself like a public client (RFC 7591),
	// builds the /oauth/authorize link with PKCE S256 and shows the result of the redirect back to this page.
	// Not part of the real product: without VITE_MOCK the page only says that it does not exist.
	const mock = import.meta.env.VITE_MOCK === '1';
	const q = page.url.searchParams;
	const code = q.get('code');
	const errorParam = q.get('error');
	const returnedState = q.get('state');
	const returned = code !== null || errorParam !== null;

	let clientName = $state('Claude (Mock)');
	let redirectUri = $state(`${page.url.origin}/mock-oauth`);
	let scopes = $state<McpScope[]>(['time:read', 'time:write', 'reports:read']);
	let busy = $state(false);
	let failure = $state('');

	function base64url(bytes: Uint8Array): string {
		return btoa(String.fromCharCode(...bytes)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
	}

	async function start(event: Event) {
		event.preventDefault();
		busy = true;
		failure = '';
		try {
			const registered = await fetch('/oauth/register', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ client_name: clientName, redirect_uris: [redirectUri], token_endpoint_auth_method: 'none' })
			});
			if (!registered.ok) throw new Error(await registered.text());
			const { client_id } = await registered.json();
			const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
			const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
			const params = new URLSearchParams({
				response_type: 'code',
				client_id,
				redirect_uri: redirectUri,
				code_challenge: base64url(digest),
				code_challenge_method: 'S256',
				scope: scopes.join(' '),
				state: base64url(crypto.getRandomValues(new Uint8Array(9))),
				resource: `${page.url.origin}/mcp`
			});
			window.location.assign(`/oauth/authorize?${params}`);
		} catch (e) {
			failure = e instanceof Error ? e.message : String(e);
			busy = false;
		}
	}
</script>

<svelte:head><title>{t('mockoauth.title')} – Timetrack</title></svelte:head>
<main class="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 px-4 py-10">
	{#if !mock}
		<p class="text-sm text-muted-foreground">{t('error.status_404')}</p>
	{:else if returned}
		<h1 class="text-xl font-semibold">{t('mockoauth.result_title')}</h1>
		<div class="rounded-lg border bg-card p-4 text-sm break-all" data-testid="oauth-result">
			{#if code}<p data-testid="result-code">{t('mockoauth.result_code', { code })}</p>{/if}
			{#if errorParam}<p data-testid="result-error">{t('mockoauth.result_error', { error: errorParam })}</p>{/if}
			{#if returnedState}<p>{t('mockoauth.result_state', { state: returnedState })}</p>{/if}
		</div>
		<Button variant="outline" href="/mock-oauth">{t('mockoauth.again')}</Button>
	{:else}
		<h1 class="text-xl font-semibold">{t('mockoauth.title')}</h1>
		<p class="text-sm text-muted-foreground">{t('mockoauth.description')}</p>
		<form class="flex flex-col gap-4" onsubmit={start}>
			<div class="flex flex-col gap-1.5">
				<Label for="mock-client-name">{t('mockoauth.name')}</Label>
				<Input id="mock-client-name" bind:value={clientName} maxlength={100} />
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="mock-redirect">{t('mockoauth.redirect')}</Label>
				<Input id="mock-redirect" bind:value={redirectUri} />
			</div>
			<ScopePicker scopes={MCP_SCOPES} bind:selected={scopes} legend={t('scope.group')} idPrefix="mock-scope" />
			{#if failure}<p class="text-sm text-destructive" role="alert">{failure}</p>{/if}
			<Button type="submit" disabled={busy}>{t('mockoauth.start')}</Button>
		</form>
	{/if}
</main>
