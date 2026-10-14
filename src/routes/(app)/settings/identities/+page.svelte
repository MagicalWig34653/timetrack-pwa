<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api, ApiError } from '#lib/api/client.js';
	import type { ExternalIdentity } from '#lib/api/types.js';
	import { formatDateTime } from '#lib/browser.js';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card, CardContent } from '#lib/components/ui/card/index.js';
	import { errorMessage, oidcErrorMessage, t } from '#lib/i18n/index.js';
	import { loadOidcConfig, providerLabel, startOidc } from '#lib/oidc.js';
	import { sessionStore } from '#lib/session.svelte.js';
	import LinkIcon from '@lucide/svelte/icons/link-2';

	const linkedBanner = page.url.searchParams.get('linked') === '1';
	const oidcErrorCode = page.url.searchParams.get('oidc_error');

	let identities = $state<ExternalIdentity[]>([]);
	let oidc = $state<{ enabled: boolean; name?: string }>({ enabled: false });
	let loading = $state(true);
	let busy = $state(false);
	let error = $state('');
	let notice = $state(linkedBanner ? t('identities.linked_ok') : '');
	let reauth = $state(oidcErrorCode === 'oidc_reauth_required');
	let unlinkingId = $state<string | null>(null);

	onMount(async () => {
		if (oidcErrorCode && oidcErrorCode !== 'oidc_reauth_required') error = oidcErrorMessage(oidcErrorCode);
		if (linkedBanner || oidcErrorCode) {
			// Clean the URL so a reload does not repeat the banner.
			await goto(page.url.pathname, { replaceState: true });
		}
		oidc = await loadOidcConfig();
		try {
			identities = await api.listIdentities();
		} catch (e) {
			// 404/501: the server has no OIDC support, show the empty state instead of an error
			if (!(e instanceof ApiError && (e.status === 404 || e.status === 501))) error = errorMessage(e);
		} finally {
			loading = false;
		}
	});

	/** A fresh session is required for linking and unlinking; the server answers 403 reauth_required. */
	function handleFailure(e: unknown) {
		if (e instanceof ApiError && e.code === 'reauth_required') {
			reauth = true;
			error = '';
		} else error = errorMessage(e);
	}

	async function link() {
		busy = true;
		error = '';
		notice = '';
		reauth = false;
		try {
			await startOidc('link');
		} catch (e) {
			handleFailure(e);
			busy = false;
		}
	}

	async function unlink(id: string) {
		busy = true;
		error = '';
		notice = '';
		reauth = false;
		try {
			await api.unlinkIdentity(id);
			unlinkingId = null;
			notice = t('identities.unlinked');
			identities = await api.listIdentities();
		} catch (e) {
			handleFailure(e);
		} finally {
			busy = false;
		}
	}

	async function signInAgain() {
		await sessionStore.signOut();
		await goto('/login?next=' + encodeURIComponent('/settings/identities'));
	}
</script>

<PageHeader title={t('identities.title')} description={t('identities.description')} />

{#if notice}<Alert variant="success" class="mb-4">{notice}</Alert>{/if}
{#if error}<Alert variant="destructive" class="mb-4">{error}</Alert>{/if}
{#if reauth}
	<Alert variant="warning" class="mb-4 flex flex-col gap-3">
		<p class="font-medium">{t('identities.reauth_title')}</p>
		<p>{t('identities.reauth_body')}</p>
		<div><Button size="sm" onclick={signInAgain}>{t('identities.reauth_action')}</Button></div>
	</Alert>
{/if}

{#if loading}
	<p class="text-sm text-muted-foreground" role="status">{t('common.loading')}</p>
{:else}
	<ul class="flex flex-col gap-3" aria-label={t('identities.title')}>
		{#each identities as identity (identity.id)}
			<li>
				<Card class="py-4">
					<CardContent class="flex flex-col gap-3">
						<div class="flex flex-wrap items-start justify-between gap-3">
							<div class="flex min-w-0 items-start gap-3">
								<LinkIcon class="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
								<div class="min-w-0">
									<p class="font-medium">{identity.providerName}</p>
									{#if identity.emailHint}
										<p class="text-xs break-words text-muted-foreground">{t('identities.email_hint', { email: identity.emailHint })}</p>
									{/if}
									<p class="text-xs text-muted-foreground">
										{t('identities.linked_at', { date: formatDateTime(identity.linkedAt) })}
										·
										{identity.lastUsedAt
											? t('identities.last_used', { date: formatDateTime(identity.lastUsedAt) })
											: t('identities.never_used')}
									</p>
								</div>
							</div>
							<Button variant="destructive" size="sm" onclick={() => (unlinkingId = identity.id)} disabled={busy}>
								{t('identities.unlink')}
							</Button>
						</div>
						{#if unlinkingId === identity.id}
							<Alert variant="warning" class="flex flex-col gap-3">
								<p>{t('identities.unlink_warning', { name: identity.providerName })}</p>
								<div class="flex gap-2">
									<Button variant="destructive" size="sm" onclick={() => unlink(identity.id)} disabled={busy}>
										{t('identities.unlink_confirm')}
									</Button>
									<Button variant="ghost" size="sm" onclick={() => (unlinkingId = null)}>{t('common.cancel')}</Button>
								</div>
							</Alert>
						{/if}
					</CardContent>
				</Card>
			</li>
		{:else}
			<li class="text-sm text-muted-foreground">{t('identities.empty')}</li>
		{/each}
	</ul>

	<div class="mt-6">
		{#if oidc.enabled}
			<Button onclick={link} disabled={busy}>{t('identities.link')}</Button>
			<p class="mt-2 text-xs text-muted-foreground">{t('identities.link_with', { name: providerLabel(oidc) })}</p>
		{:else}
			<p class="text-sm text-muted-foreground">{t('identities.disabled')}</p>
		{/if}
	</div>
{/if}
