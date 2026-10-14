<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '#lib/api/client.js';
	import type { Passkey } from '#lib/api/types.js';
	import { formatDateTime } from '#lib/browser.js';
	import Field from '#lib/components/app/Field.svelte';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card, CardContent } from '#lib/components/ui/card/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { createPasskey, isWebAuthnSupported } from '#lib/webauthn.js';
	import KeyRoundIcon from '@lucide/svelte/icons/key-round';

	let passkeys = $state<Passkey[]>([]);
	let loading = $state(true);
	let busy = $state(false);
	let error = $state('');
	let notice = $state('');
	let newName = $state('');
	let renamingId = $state<string | null>(null);
	let renameValue = $state('');
	let revokingId = $state<string | null>(null);

	const supported = isWebAuthnSupported() || import.meta.env.VITE_MOCK === '1';

	async function load() {
		try {
			passkeys = await api.listPasskeys();
		} catch (e) {
			error = errorMessage(e);
		} finally {
			loading = false;
		}
	}
	onMount(load);

	async function run(action: () => Promise<void>, success = '') {
		busy = true;
		error = '';
		notice = '';
		try {
			await action();
			notice = success;
			passkeys = await api.listPasskeys();
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}

	const add = (event: Event) => {
		event.preventDefault();
		return run(async () => {
			const options = await api.addPasskeyOptions();
			const credential = await createPasskey(options.publicKey);
			await api.addPasskeyVerify(options.challengeId, credential, newName.trim() || undefined);
			newName = '';
		}, t('passkeys.added'));
	};

	const rename = (event: Event) => {
		event.preventDefault();
		const id = renamingId!;
		return run(async () => {
			await api.renamePasskey(id, renameValue.trim());
			renamingId = null;
		}, t('passkeys.renamed'));
	};

	const revoke = (id: string) =>
		run(async () => {
			await api.revokePasskey(id);
			revokingId = null;
		}, t('passkeys.revoked'));
</script>

<PageHeader title={t('passkeys.title')} description={t('passkeys.description')} />

{#if error}<Alert variant="destructive" class="mb-4">{error}</Alert>{/if}
{#if notice}<Alert variant="success" class="mb-4">{notice}</Alert>{/if}
{#if !supported}<Alert variant="warning" class="mb-4">{t('webauthn.unsupported')}</Alert>{/if}

{#if loading}
	<p class="text-sm text-muted-foreground" role="status">{t('common.loading')}</p>
{:else}
	<ul class="flex flex-col gap-3" aria-label={t('passkeys.title')}>
		{#each passkeys as passkey (passkey.id)}
			<li>
				<Card class="py-4">
					<CardContent class="flex flex-col gap-3">
						{#if renamingId === passkey.id}
							<form class="flex flex-col gap-3 sm:flex-row sm:items-end" onsubmit={rename}>
								<div class="flex-1">
									<Field id="rename-{passkey.id}" label={t('passkeys.name')} bind:value={renameValue} maxlength={80} required />
								</div>
								<div class="flex gap-2">
									<Button type="submit" disabled={busy}>{t('common.save')}</Button>
									<Button variant="ghost" onclick={() => (renamingId = null)}>{t('common.cancel')}</Button>
								</div>
							</form>
						{:else}
							<div class="flex flex-wrap items-start justify-between gap-3">
								<div class="flex items-start gap-3">
									<KeyRoundIcon class="mt-0.5 size-5 text-muted-foreground" aria-hidden="true" />
									<div>
										<p class="font-medium">{passkey.name}</p>
										<p class="text-xs text-muted-foreground">
											{t('passkeys.created', { date: formatDateTime(passkey.createdAt) })}
											·
											{passkey.lastUsedAt
												? t('passkeys.last_used', { date: formatDateTime(passkey.lastUsedAt) })
												: t('passkeys.never_used')}
										</p>
									</div>
								</div>
								<div class="flex gap-2">
									<Button variant="outline" size="sm" onclick={() => ((renamingId = passkey.id), (renameValue = passkey.name))}>
										{t('passkeys.rename')}
									</Button>
									<Button variant="destructive" size="sm" onclick={() => (revokingId = passkey.id)} disabled={busy}>
										{t('passkeys.revoke')}
									</Button>
								</div>
							</div>
						{/if}
						{#if revokingId === passkey.id}
							<Alert variant="warning" class="flex flex-col gap-3">
								<p>{passkeys.length === 1 ? t('passkeys.revoke_last_warning') : t('passkeys.revoke_warning')}</p>
								<div class="flex gap-2">
									<Button variant="destructive" size="sm" onclick={() => revoke(passkey.id)} disabled={busy}>
										{t('passkeys.revoke_confirm')}
									</Button>
									<Button variant="ghost" size="sm" onclick={() => (revokingId = null)}>{t('common.cancel')}</Button>
								</div>
							</Alert>
						{/if}
					</CardContent>
				</Card>
			</li>
		{:else}
			<li class="text-sm text-muted-foreground">{t('passkeys.empty')}</li>
		{/each}
	</ul>

	<form class="mt-6 flex flex-col gap-3 sm:flex-row sm:items-end" onsubmit={add}>
		<div class="flex-1">
			<Field id="new-passkey" label={t('passkeys.new_name')} hint={t('invite.passkey_name_hint')} bind:value={newName} maxlength={80} />
		</div>
		<Button type="submit" disabled={busy || !supported}>{t('passkeys.add')}</Button>
	</form>
{/if}
