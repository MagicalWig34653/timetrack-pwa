<script lang="ts">
	import { api } from '#lib/api/client.js';
	import type { OAuthGrant } from '#lib/api/types.js';
	import { formatDateTime } from '#lib/browser.js';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import ScopeList from '#lib/components/mcp/ScopeList.svelte';
	import Unavailable from '#lib/components/time/Unavailable.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#lib/components/ui/card/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { toLoadState, type LoadState } from '#lib/time/load.js';
	import { onMount } from 'svelte';

	let load = $state<LoadState>({ status: 'loading' });
	let grants = $state<OAuthGrant[]>([]);
	let confirmRevoke = $state<string | null>(null);
	let pending = $state(false);
	let error = $state('');
	let notice = $state('');

	async function refresh() {
		try {
			grants = await api.listOAuthGrants();
			load = { status: 'ready' };
		} catch (e) {
			load = toLoadState(e);
		}
	}
	onMount(refresh);

	async function revoke(grant: OAuthGrant) {
		if (pending) return;
		pending = true;
		error = '';
		try {
			await api.revokeOAuthGrant(grant.id);
			confirmRevoke = null;
			notice = t('connections.revoked');
			await refresh();
		} catch (e) {
			error = errorMessage(e);
		} finally {
			pending = false;
		}
	}
</script>

<PageHeader title={t('connections.title')} description={t('connections.description')} />

{#if load.status === 'loading'}
	<p class="text-sm text-muted-foreground" role="status">{t('common.loading')}</p>
{:else if load.status === 'unavailable'}
	<Unavailable />
{:else if load.status === 'error'}
	<Alert variant="destructive">{load.message}</Alert>
{:else}
	<div class="flex flex-col gap-4">
		{#if notice}<Alert variant="success">{notice}</Alert>{/if}
		{#if error}<Alert variant="destructive">{error}</Alert>{/if}
		<Card>
			<CardHeader>
				<CardTitle>{t('connections.title')}</CardTitle>
				<CardDescription><a class="underline underline-offset-4" href="/settings/mcp-help">{t('connections.help_link')}</a></CardDescription>
			</CardHeader>
			<CardContent>
				{#if grants.length === 0}
					<p class="text-sm text-muted-foreground">{t('connections.empty')}</p>
				{:else}
					<ul class="divide-y" data-testid="grant-list">
						{#each grants as grant (grant.id)}
							<li class="flex flex-col gap-2 py-3">
								<div class="flex flex-wrap items-start justify-between gap-3">
									<div class="min-w-0">
										<p class="font-medium break-words">{grant.clientName}</p>
										<p class="text-xs text-muted-foreground">
											{t('connections.created_at', { date: formatDateTime(grant.createdAt) })}
											·
											{grant.lastUsedAt ? t('connections.last_used', { date: formatDateTime(grant.lastUsedAt) }) : t('connections.never_used')}
										</p>
									</div>
									{#if confirmRevoke !== grant.id}
										<Button variant="outline" size="sm" onclick={() => (confirmRevoke = grant.id)}>{t('connections.revoke')}</Button>
									{/if}
								</div>
								<ScopeList scopes={grant.scopes} />
								{#if confirmRevoke === grant.id}
									<Alert variant="warning" class="flex flex-col gap-3">
										<p>{t('connections.revoke_warning', { client: grant.clientName })}</p>
										<div class="flex gap-2">
											<Button variant="destructive" size="sm" onclick={() => revoke(grant)} disabled={pending}>{t('connections.revoke_confirm')}</Button>
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
	</div>
{/if}
