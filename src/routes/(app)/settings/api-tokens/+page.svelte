<script lang="ts">
	import { goto } from '$app/navigation';
	import { api, ApiError } from '#lib/api/client.js';
	import type { ApiToken, ApiTokenCreated, McpScope } from '#lib/api/types.js';
	import { formatDateTime } from '#lib/browser.js';
	import CopyButton from '#lib/components/app/CopyButton.svelte';
	import Field from '#lib/components/app/Field.svelte';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import ScopeList from '#lib/components/mcp/ScopeList.svelte';
	import ScopePicker from '#lib/components/mcp/ScopePicker.svelte';
	import Unavailable from '#lib/components/time/Unavailable.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#lib/components/ui/card/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Select } from '#lib/components/ui/select/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { MCP_SCOPES, READ_ONLY_SCOPES, READ_WRITE_SCOPES, TOKEN_EXPIRY_DAYS } from '#lib/mcp/scopes.js';
	import { sessionStore } from '#lib/session.svelte.js';
	import { toLoadState, type LoadState } from '#lib/time/load.js';
	import { onMount } from 'svelte';

	let load = $state<LoadState>({ status: 'loading' });
	let tokens = $state<ApiToken[]>([]);
	let creating = $state(false);
	let name = $state('');
	let scopes = $state<McpScope[]>([...READ_ONLY_SCOPES]);
	let expiresInDays = $state(String(TOKEN_EXPIRY_DAYS[0]));
	let errors = $state<{ name?: string; scopes?: string }>({});
	let formError = $state('');
	let reauth = $state(false);
	let pending = $state(false);
	let created = $state<ApiTokenCreated | null>(null);
	let confirmRevoke = $state<string | null>(null);
	let notice = $state('');

	async function refresh() {
		try {
			tokens = await api.listApiTokens();
			load = { status: 'ready' };
		} catch (e) {
			load = toLoadState(e);
		}
	}
	onMount(refresh);

	const isExpired = (token: ApiToken) => Date.parse(token.expiresAt) < Date.now();

	function openForm() {
		creating = true;
		created = null;
		notice = '';
		reauth = false;
		formError = '';
	}

	async function create(event: Event) {
		event.preventDefault();
		if (pending) return;
		errors = {};
		formError = '';
		reauth = false;
		if (!name.trim()) errors.name = t('tokens.error_name');
		if (scopes.length === 0) errors.scopes = t('tokens.error_scopes');
		if (errors.name || errors.scopes) return;
		pending = true;
		try {
			created = await api.createApiToken({ name: name.trim(), scopes, expiresInDays: Number(expiresInDays) });
			name = '';
			scopes = [...READ_ONLY_SCOPES];
			creating = false;
			await refresh();
		} catch (e) {
			if (e instanceof ApiError && e.code === 'reauth_required') reauth = true;
			else formError = errorMessage(e);
		} finally {
			pending = false;
		}
	}

	async function revoke(token: ApiToken) {
		if (pending) return;
		pending = true;
		formError = '';
		try {
			await api.revokeApiToken(token.id);
			confirmRevoke = null;
			notice = t('tokens.revoked');
			await refresh();
		} catch (e) {
			formError = errorMessage(e);
		} finally {
			pending = false;
		}
	}

	async function signInAgain() {
		await sessionStore.signOut();
		await goto('/login?next=' + encodeURIComponent('/settings/api-tokens'));
	}
</script>

<PageHeader title={t('tokens.title')} description={t('tokens.description')} />

{#if load.status === 'loading'}
	<p class="text-sm text-muted-foreground" role="status">{t('common.loading')}</p>
{:else if load.status === 'unavailable'}
	<Unavailable />
{:else if load.status === 'error'}
	<Alert variant="destructive">{load.message}</Alert>
{:else}
	<div class="flex flex-col gap-4">
		{#if notice}<Alert variant="success">{notice}</Alert>{/if}
		{#if formError}<Alert variant="destructive">{formError}</Alert>{/if}
		{#if reauth}
			<Alert variant="warning" class="flex flex-col gap-3" data-testid="reauth">
				<p class="font-medium">{t('tokens.reauth_title')}</p>
				<p>{t('tokens.reauth_body')}</p>
				<div><Button size="sm" onclick={signInAgain}>{t('tokens.reauth_action')}</Button></div>
			</Alert>
		{/if}

		{#if created}
			<Alert variant="warning" data-testid="created-token">
				<p class="font-medium">{t('tokens.created_title', { name: created.name })}</p>
				<p class="mt-1">{t('tokens.created_text')}</p>
				<div class="mt-3 flex flex-wrap items-center gap-2">
					<code class="rounded bg-background px-2 py-1 text-sm break-all" data-testid="token-value">{created.token}</code>
					<CopyButton text={created.token} />
				</div>
				<div class="mt-3"><Button size="sm" variant="outline" onclick={() => (created = null)}>{t('tokens.created_done')}</Button></div>
			</Alert>
		{/if}

		<Card>
			<CardHeader>
				<CardTitle>{t('tokens.list_title')}</CardTitle>
				<CardDescription><a class="underline underline-offset-4" href="/settings/mcp-help">{t('tokens.help_link')}</a></CardDescription>
			</CardHeader>
			<CardContent>
				{#if tokens.length === 0}
					<p class="text-sm text-muted-foreground">{t('tokens.empty')}</p>
				{:else}
					<ul class="divide-y" data-testid="token-list">
						{#each tokens as token (token.id)}
							<li class="flex flex-col gap-2 py-3">
								<div class="flex flex-wrap items-start justify-between gap-3">
									<div class="min-w-0">
										<p class="font-medium break-words">{token.name}</p>
										<p class="text-xs text-muted-foreground">
											{t('tokens.created_at', { date: formatDateTime(token.createdAt) })}
											·
											{#if isExpired(token)}<span class="font-medium text-destructive">{t('tokens.expired')}</span>{:else}{t('tokens.expires_at', { date: formatDateTime(token.expiresAt) })}{/if}
											·
											{token.lastUsedAt ? t('tokens.last_used', { date: formatDateTime(token.lastUsedAt) }) : t('tokens.never_used')}
										</p>
									</div>
									{#if confirmRevoke !== token.id}
										<Button variant="outline" size="sm" onclick={() => (confirmRevoke = token.id)}>{t('tokens.revoke')}</Button>
									{/if}
								</div>
								<ScopeList scopes={token.scopes} />
								{#if confirmRevoke === token.id}
									<Alert variant="warning" class="flex flex-col gap-3">
										<p>{t('tokens.revoke_warning')}</p>
										<div class="flex gap-2">
											<Button variant="destructive" size="sm" onclick={() => revoke(token)} disabled={pending}>{t('tokens.revoke_confirm')}</Button>
											<Button variant="ghost" size="sm" onclick={() => (confirmRevoke = null)}>{t('common.cancel')}</Button>
										</div>
									</Alert>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</CardContent>
		</Card>

		{#if creating}
			<Card>
				<CardHeader><CardTitle>{t('tokens.new_title')}</CardTitle></CardHeader>
				<CardContent>
					<form class="flex flex-col gap-4" onsubmit={create} novalidate aria-label={t('tokens.new_title')}>
						<Field id="token-name" label={t('tokens.name')} hint={t('tokens.name_hint')} bind:value={name} error={errors.name} maxlength={80} disabled={pending} />
						<div class="flex flex-col gap-2">
							<div class="flex flex-wrap gap-2" role="group" aria-label={t('tokens.scopes')}>
								<Button type="button" size="sm" variant="outline" onclick={() => (scopes = [...READ_ONLY_SCOPES])}>{t('scope.preset_read')}</Button>
								<Button type="button" size="sm" variant="outline" onclick={() => (scopes = [...READ_WRITE_SCOPES])}>{t('scope.preset_write')}</Button>
							</div>
							<ScopePicker scopes={MCP_SCOPES} bind:selected={scopes} legend={t('tokens.scopes')} hint={t('tokens.scopes_hint')} disabled={pending} idPrefix="token-scope" />
							{#if errors.scopes}<p class="text-xs text-destructive">{errors.scopes}</p>{/if}
						</div>
						<div class="flex flex-col gap-1.5">
							<Label for="token-expiry">{t('tokens.expiry')}</Label>
							<Select id="token-expiry" bind:value={expiresInDays} disabled={pending}>
								{#each TOKEN_EXPIRY_DAYS as days (days)}
									<option value={String(days)}>{t('tokens.expiry_option', { days })}</option>
								{/each}
							</Select>
						</div>
						<div class="flex gap-2">
							<Button type="submit" disabled={pending}>{pending ? t('tokens.creating') : t('tokens.create')}</Button>
							<Button type="button" variant="ghost" onclick={() => (creating = false)} disabled={pending}>{t('common.cancel')}</Button>
						</div>
					</form>
				</CardContent>
			</Card>
		{:else}
			<div><Button onclick={openForm}>{t('tokens.new')}</Button></div>
		{/if}
	</div>
{/if}
