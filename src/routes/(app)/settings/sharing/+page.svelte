<script lang="ts">
	import { api, ApiError } from '#lib/api/client.js';
	import type { Share, ShareScopes } from '#lib/api/types.js';
	import Field from '#lib/components/app/Field.svelte';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import NeverShared from '#lib/components/planning/NeverShared.svelte';
	import Unavailable from '#lib/components/planning/Unavailable.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#lib/components/ui/card/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { sessionStore } from '#lib/session.svelte.js';
	import { SHARE_SCOPE_KEYS, scopeLabel } from '#lib/planning/labels.js';
	import { localDateOf } from '#lib/time/dates.js';
	import { formatDateNumeric } from '#lib/time/dates.js';
	import { toLoadState, type LoadState } from '#lib/time/load.js';
	import { onMount } from 'svelte';

	let load = $state<LoadState>({ status: 'loading' });
	let shares = $state<Share[]>([]);
	let handle = $state('');
	let scopes = $state<Required<ShareScopes>>({ plan: false, actual: false, vacation: false });
	let handleError = $state('');
	let formError = $state('');
	let notice = $state('');
	let pending = $state(false);
	let rowError = $state('');
	/** share id waiting for the second click on "Widerrufen" */
	let confirming = $state<string | null>(null);

	async function refresh() {
		try {
			shares = await api.listShares();
			load = { status: 'ready' };
		} catch (e) {
			load = toLoadState(e);
		}
	}
	onMount(refresh);

	async function create(event: Event) {
		event.preventDefault();
		if (pending) return;
		formError = '';
		notice = '';
		handleError = '';
		if (!handle.trim()) handleError = t('share.error_handle');
		else if (handle.trim().toLowerCase() === sessionStore.current?.account.handle.toLowerCase()) handleError = t('error.share_self');
		else if (!scopes.plan && !scopes.actual && !scopes.vacation) formError = t('share.error_scope');
		if (handleError || formError) return;
		pending = true;
		try {
			const created = await api.createShare({ recipientHandle: handle.trim(), scopes: { ...scopes } });
			notice = t('share.created', { handle: created.recipientHandle });
			handle = '';
			scopes = { plan: false, actual: false, vacation: false };
			await refresh();
		} catch (e) {
			// 409 share_exists and 404 recipient_not_found have their own texts; a plain 400 means e.g. a share to oneself (v0.3.1).
			formError = e instanceof ApiError && e.status === 400 ? t('error.share_invalid') : errorMessage(e);
		} finally {
			pending = false;
		}
	}

	async function toggle(share: Share, key: keyof ShareScopes, value: boolean) {
		if (pending) return;
		rowError = '';
		notice = '';
		pending = true;
		try {
			const updated = await api.updateShare(share.id, { plan: !!share.scopes.plan, actual: !!share.scopes.actual, vacation: !!share.scopes.vacation, [key]: value });
			shares = shares.map((s) => (s.id === share.id ? updated : s));
			notice = t('share.updated', { handle: share.recipientHandle });
		} catch (e) {
			rowError = errorMessage(e);
			await refresh();
		} finally {
			pending = false;
		}
	}

	async function revoke(share: Share) {
		if (confirming !== share.id) {
			confirming = share.id;
			return;
		}
		pending = true;
		rowError = '';
		notice = '';
		try {
			await api.revokeShare(share.id);
			notice = t('share.revoked', { handle: share.recipientHandle });
			confirming = null;
			await refresh();
		} catch (e) {
			rowError = errorMessage(e);
		} finally {
			pending = false;
		}
	}
</script>

<PageHeader title={t('share.title')} description={t('share.description')} />

{#if load.status === 'loading'}
	<p class="text-sm text-muted-foreground">{t('common.loading')}</p>
{:else if load.status === 'unavailable'}
	<Unavailable />
{:else if load.status === 'error'}
	<Alert variant="destructive">{load.message}</Alert>
{:else}
	<div class="flex flex-col gap-4">
		<NeverShared />
		{#if notice}<Alert variant="success" data-testid="share-notice">{notice}</Alert>{/if}

		<Card>
			<CardHeader>
				<CardTitle>{t('share.new_title')}</CardTitle>
				<CardDescription>{t('share.new_text')}</CardDescription>
			</CardHeader>
			<CardContent>
				<form class="flex flex-col gap-4" onsubmit={create} novalidate aria-label={t('share.new_title')}>
					{#if formError}<Alert variant="destructive" data-testid="share-error">{formError}</Alert>{/if}
					<Field id="share-handle" label={t('share.recipient')} hint={t('share.recipient_hint')} bind:value={handle} error={handleError} autocapitalize="none" autocomplete="off" disabled={pending} />
					<fieldset class="flex flex-col gap-3" disabled={pending}>
						<legend class="mb-1 text-sm font-medium">{t('share.scopes')}</legend>
						{#each SHARE_SCOPE_KEYS as key (key)}
							<label class="flex items-start gap-3 text-sm">
								<Checkbox id="new-scope-{key}" class="mt-0.5" bind:checked={scopes[key]} />
								<span>
									<span class="font-medium">{scopeLabel(key)}</span>
									<span class="block text-xs text-muted-foreground">{t(`share.scope_text.${key}`)}</span>
								</span>
							</label>
						{/each}
					</fieldset>
					<div><Button type="submit" disabled={pending}>{t('share.create')}</Button></div>
				</form>
			</CardContent>
		</Card>

		<Card>
			<CardHeader>
				<CardTitle>{t('share.list_title')}</CardTitle>
				<CardDescription>{t('share.list_text')}</CardDescription>
			</CardHeader>
			<CardContent class="flex flex-col gap-3">
				{#if rowError}<Alert variant="destructive">{rowError}</Alert>{/if}
				{#if shares.length === 0}
					<p class="text-sm text-muted-foreground" data-testid="shares-empty">{t('share.empty')}</p>
				{:else}
					<ul class="flex flex-col gap-3" data-testid="share-list">
						{#each shares as share (share.id)}
							<li class="rounded-lg border p-3" data-testid="share-row">
								<div class="flex flex-wrap items-center justify-between gap-2">
									<p class="font-medium">{share.recipientHandle} <span class="text-xs font-normal text-muted-foreground">{t('share.since', { date: formatDateNumeric(localDateOf(share.createdAt)) })}</span></p>
									<div class="flex items-center gap-2">
										{#if confirming === share.id}
											<span class="text-sm">{t('share.revoke_confirm')}</span>
											<Button variant="outline" size="sm" onclick={() => (confirming = null)} disabled={pending}>{t('common.cancel')}</Button>
										{/if}
										<Button variant="destructive" size="sm" onclick={() => revoke(share)} disabled={pending} aria-label="{confirming === share.id ? t('share.revoke_now') : t('share.revoke')} {share.recipientHandle}">
											{confirming === share.id ? t('share.revoke_now') : t('share.revoke')}
										</Button>
									</div>
								</div>
								<fieldset class="mt-2 flex flex-wrap gap-x-5 gap-y-2" disabled={pending}>
									<legend class="sr-only">{t('share.scopes_for', { handle: share.recipientHandle })}</legend>
									{#each SHARE_SCOPE_KEYS as key (key)}
										<label class="flex items-center gap-2 text-sm">
											<Checkbox checked={!!share.scopes[key]} onchange={(e) => toggle(share, key, e.currentTarget.checked)} aria-label="{scopeLabel(key)} {share.recipientHandle}" />
											{scopeLabel(key)}
										</label>
									{/each}
								</fieldset>
							</li>
						{/each}
					</ul>
				{/if}
			</CardContent>
		</Card>
		<p class="text-sm"><a class="underline underline-offset-4" href="/shared">{t('share.to_incoming')}</a></p>
	</div>
{/if}
