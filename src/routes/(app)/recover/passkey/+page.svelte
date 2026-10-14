<script lang="ts">
	import { goto } from '$app/navigation';
	import { api } from '#lib/api/client.js';
	import Field from '#lib/components/app/Field.svelte';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { sessionStore } from '#lib/session.svelte.js';
	import { createPasskey, isWebAuthnSupported } from '#lib/webauthn.js';

	const supported = isWebAuthnSupported() || import.meta.env.VITE_MOCK === '1';
	let name = $state('');
	let busy = $state(false);
	let error = $state('');

	async function setup(event: Event) {
		event.preventDefault();
		busy = true;
		error = '';
		try {
			const options = await api.addPasskeyOptions();
			const credential = await createPasskey(options.publicKey);
			await api.addPasskeyVerify(options.challengeId, credential, name.trim() || undefined);
			const session = await sessionStore.refresh();
			if (session && !session.recovery) {
				await goto('/settings/passkeys', { replaceState: true });
			} else {
				// The restricted session persists: end it and sign in with the new passkey.
				await sessionStore.signOut();
				await goto('/login?recovered=1', { replaceState: true, invalidateAll: true });
			}
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}
</script>

<div class="mx-auto max-w-md">
	<PageHeader title={t('recover_passkey.title')} description={t('recover_passkey.description')} />
	<Alert variant="warning" class="mb-4">{t('recover_passkey.restricted')}</Alert>
	{#if !supported}<Alert variant="warning" class="mb-4">{t('webauthn.unsupported')}</Alert>{/if}
	{#if error}<Alert variant="destructive" class="mb-4">{error}</Alert>{/if}
	<form class="flex flex-col gap-4" onsubmit={setup}>
		<Field id="new-passkey-name" label={t('invite.passkey_name')} hint={t('invite.passkey_name_hint')} bind:value={name} maxlength={80} />
		<div><Button type="submit" size="lg" disabled={busy || !supported}>{t('passkeys.add')}</Button></div>
	</form>
</div>
