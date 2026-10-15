<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api, ApiError } from '#lib/api/client.js';
	import type { McpScope, OAuthRequest } from '#lib/api/types.js';
	import { navigateTo } from '#lib/browser.js';
	import AuthShell from '#lib/components/app/AuthShell.svelte';
	import ScopePicker from '#lib/components/mcp/ScopePicker.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { hasWriteScope } from '#lib/mcp/scopes.js';
	import { moduleStore } from '#lib/modules/store.svelte.js';
	import ModuleDisabled from '#lib/components/app/ModuleDisabled.svelte';
	import { sessionStore } from '#lib/session.svelte.js';
	import { onMount } from 'svelte';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';

	type View = 'disabled' | 'loading' | 'ready' | 'missing' | 'expired' | 'decided' | 'error' | 'redirecting';

	const requestId = page.url.searchParams.get('request') ?? '';
	let view = $state<View>(!moduleStore.enabled('mcp') ? 'disabled' : requestId ? 'loading' : 'missing');
	let request = $state<OAuthRequest | null>(null);
	let selected = $state<McpScope[]>([]);
	let busy = $state<'allow' | 'deny' | null>(null);
	let error = $state('');

	const accountName = $derived(sessionStore.current?.account.displayName ?? '');
	const writes = $derived(hasWriteScope(selected));

	onMount(async () => {
		if (!requestId || view === 'disabled') return;
		try {
			request = await api.getOAuthRequest(requestId);
			// Everything the client asked for is preselected; the person removes what must not be allowed.
			selected = [...request.scopes];
			view = 'ready';
		} catch (e) {
			view = classify(e);
			if (view === 'error') error = errorMessage(e);
		}
	});

	/** 404: expired, invalid or not for this account. 409: already decided. */
	function classify(e: unknown): View {
		if (e instanceof ApiError && e.code === 'module_disabled') return 'disabled';
		if (e instanceof ApiError && e.status === 404) return 'expired';
		if (e instanceof ApiError && e.status === 409) return 'decided';
		return 'error';
	}

	async function decide(approve: boolean) {
		if (busy || !request) return;
		if (approve && selected.length === 0) {
			error = t('consent.no_scope');
			return;
		}
		busy = approve ? 'allow' : 'deny';
		error = '';
		try {
			const { redirectUrl } = await api.decideOAuthRequest(request.id, approve, approve ? selected : undefined);
			// Only ever leave for http(s) targets, whatever the server sends.
			if (!/^https?:\/\//i.test(redirectUrl)) throw new ApiError(0, 'unknown');
			view = 'redirecting';
			navigateTo(redirectUrl);
		} catch (e) {
			const next = e instanceof ApiError ? classify(e) : 'error';
			if (next === 'error') {
				error = errorMessage(e);
				busy = null;
			} else view = next;
		}
	}

	async function useOtherAccount() {
		try {
			await sessionStore.signOut();
		} finally {
			await goto('/login?next=' + encodeURIComponent(page.url.pathname + page.url.search), { replaceState: true, invalidateAll: true });
		}
	}
</script>

<AuthShell title={view === 'expired' ? t('consent.expired_title') : view === 'decided' ? t('consent.decided_title') : t('consent.title')}>
	{#if view === 'disabled'}
		<ModuleDisabled module="mcp" />
	{:else if view === 'loading'}
		<p class="text-sm text-muted-foreground" role="status">{t('common.loading')}</p>
	{:else if view === 'missing'}
		<Alert variant="destructive">{t('consent.missing_request')}</Alert>
	{:else if view === 'expired'}
		<Alert variant="warning">{t('consent.expired_body')}</Alert>
		<Button variant="outline" href="/">{t('consent.to_app')}</Button>
	{:else if view === 'decided'}
		<Alert variant="default">{t('consent.decided_body')}</Alert>
		<Button variant="outline" href="/">{t('consent.to_app')}</Button>
	{:else if view === 'error'}
		<Alert variant="destructive">{error}</Alert>
	{:else if view === 'redirecting'}
		<p class="text-sm text-muted-foreground" role="status">{t('consent.redirecting')}</p>
	{:else if request}
		<p class="text-sm">{t('consent.intro', { client: request.clientName })}</p>

		<div class="rounded-lg border bg-muted/40 px-3 py-2.5" data-testid="redirect-host">
			<p class="text-xs text-muted-foreground">{t('consent.redirect_label')}</p>
			<p class="flex items-center gap-2 font-medium break-all"><ExternalLinkIcon class="size-4 shrink-0" aria-hidden="true" />{t('consent.redirect', { host: request.redirectHost })}</p>
		</div>

		<div class="flex flex-wrap items-center justify-between gap-2 text-sm">
			<span data-testid="signed-in-as">{t('consent.account', { name: accountName })}</span>
			<Button variant="outline" size="sm" onclick={useOtherAccount} disabled={busy !== null}>{t('consent.other_account')}</Button>
		</div>
		<p class="-mt-2 text-xs text-muted-foreground" data-testid="other-account-hint">{t('consent.other_account_hint')}</p>

		<ScopePicker scopes={request.scopes} bind:selected legend={t('consent.scopes_title', { client: request.clientName })} hint={t('consent.scopes_hint')} disabled={busy !== null} idPrefix="consent-scope" />

		{#if writes}<Alert variant="warning" data-testid="write-warning">{t('consent.write_warning')}</Alert>{/if}
		{#if selected.length === 0}<p class="text-sm text-destructive" role="status">{t('consent.no_scope')}</p>{/if}
		{#if error && selected.length > 0}<Alert variant="destructive">{error}</Alert>{/if}
		<p class="text-xs text-muted-foreground">{t('consent.revoke_hint')}</p>

		<div class="flex flex-col gap-2 sm:flex-row-reverse">
			<Button class="flex-1" onclick={() => decide(true)} disabled={busy !== null || selected.length === 0}>
				{busy === 'allow' ? t('consent.allowing') : t('consent.allow')}
			</Button>
			<Button class="flex-1" variant="outline" onclick={() => decide(false)} disabled={busy !== null}>
				{busy === 'deny' ? t('consent.denying') : t('consent.deny')}
			</Button>
		</div>
	{/if}
</AuthShell>
