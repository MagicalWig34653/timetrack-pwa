<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api, ApiError } from '#lib/api/client.js';
	import AuthShell from '#lib/components/app/AuthShell.svelte';
	import Field from '#lib/components/app/Field.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { sessionStore } from '#lib/session.svelte.js';
	import { createPasskey, isWebAuthnSupported } from '#lib/webauthn.js';

	const token = page.params.token ?? '';
	const supported = isWebAuthnSupported() || import.meta.env.VITE_MOCK === '1';

	let phase = $state<'checking' | 'invalid' | 'form' | 'unreachable'>('checking');
	let handle = $state('');
	let displayName = $state('');
	let email = $state('');
	let passkeyName = $state('');
	let busy = $state(false);
	let error = $state('');

	const handlePattern = '^[a-z0-9][a-z0-9._-]{2,31}$';
	const handleValid = $derived(new RegExp(handlePattern).test(handle));
	const handleError = $derived(handle && !handleValid ? t('invite.handle_invalid') : '');

	onMount(async () => {
		try {
			await api.inspectInvitation(token);
			phase = 'form';
		} catch (e) {
			phase = e instanceof ApiError && e.status === 404 ? 'invalid' : 'unreachable';
			if (phase === 'unreachable') error = errorMessage(e);
		}
	});

	async function register(event: Event) {
		event.preventDefault();
		if (!handleValid) return;
		busy = true;
		error = '';
		try {
			const options = await api.registerOptions({
				inviteToken: token,
				handle,
				displayName: displayName.trim(),
				email: email.trim() || undefined
			});
			const credential = await createPasskey(options.publicKey);
			const session = await api.registerVerify(options.challengeId, credential, passkeyName.trim() || undefined);
			sessionStore.set(session);
			await goto('/setup/recovery', { replaceState: true });
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}
</script>

<AuthShell title={t('invite.title')} description={phase === 'form' ? t('invite.description') : undefined}>
	{#if phase === 'checking'}
		<p class="text-sm text-muted-foreground" role="status">{t('common.loading')}</p>
	{:else if phase === 'invalid'}
		<Alert variant="destructive">{t('invite.invalid')}</Alert>
		<a class="text-sm underline underline-offset-4" href="/login">{t('invite.to_login')}</a>
	{:else if phase === 'unreachable'}
		<Alert variant="destructive">{error}</Alert>
	{:else}
		{#if !supported}<Alert variant="warning">{t('webauthn.unsupported')}</Alert>{/if}
		{#if error}<Alert variant="destructive">{error}</Alert>{/if}
		<form class="flex flex-col gap-4" onsubmit={register}>
			<Field
				id="handle"
				label={t('invite.handle')}
				hint={t('invite.handle_hint')}
				bind:value={handle}
				error={handleError}
				autocomplete="username"
				autocapitalize="none"
				spellcheck={false}
				required
			/>
			<Field
				id="display-name"
				label={t('invite.display_name')}
				bind:value={displayName}
				maxlength={80}
				autocomplete="name"
				required
			/>
			<Field
				id="email"
				type="email"
				label={t('invite.email')}
				hint={t('invite.email_hint')}
				bind:value={email}
				autocomplete="email"
			/>
			<Field
				id="passkey-name"
				label={t('invite.passkey_name')}
				hint={t('invite.passkey_name_hint')}
				bind:value={passkeyName}
				maxlength={80}
			/>
			<Button type="submit" size="lg" disabled={busy || !supported}>
				{busy ? t('invite.waiting') : t('invite.submit')}
			</Button>
		</form>
	{/if}
</AuthShell>
