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
	import { loadOidcConfig, providerLabel, startOidc } from '#lib/oidc.js';
	import { sessionStore } from '#lib/session.svelte.js';
	import { createPasskey, isWebAuthnSupported } from '#lib/webauthn.js';

	const token = page.params.token ?? '';
	const supported = isWebAuthnSupported() || import.meta.env.VITE_MOCK === '1';

	// `oidc-form`: back from the provider with a pending identity; `passkey-prompt`: OIDC account created.
	let phase = $state<'checking' | 'invalid' | 'form' | 'unreachable' | 'oidc-form' | 'passkey-prompt'>('checking');
	const pendingId = page.url.searchParams.get('oidc');
	let oidc = $state<{ enabled: boolean; name?: string }>({ enabled: false });
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
		if (pendingId) {
			// The pending id is single use and not secret-bearing, but do not leave it in the address bar.
			phase = 'oidc-form';
			oidc = await loadOidcConfig();
			await goto(page.url.pathname, { replaceState: true });
			return;
		}
		try {
			await api.inspectInvitation(token);
			phase = 'form';
			oidc = await loadOidcConfig();
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

	async function registerWithOidc(event: Event) {
		event.preventDefault();
		if (!handleValid || !pendingId) return;
		busy = true;
		error = '';
		try {
			sessionStore.set(await api.oidcRegister({ pendingId, handle, displayName: displayName.trim() }));
			phase = 'passkey-prompt';
		} catch (e) {
			error = e instanceof ApiError && e.status === 404 ? t('oidc.register.expired') : errorMessage(e);
		} finally {
			busy = false;
		}
	}

	async function startRegisterWithOidc() {
		busy = true;
		error = '';
		try {
			await startOidc('register', token);
		} catch (e) {
			error = errorMessage(e);
			busy = false;
		}
	}
</script>

<AuthShell
	title={phase === 'oidc-form' ? t('oidc.register.title', { name: providerLabel(oidc) }) : phase === 'passkey-prompt' ? t('oidc.passkey_prompt.title') : t('invite.title')}
	description={phase === 'form' ? t('invite.description') : phase === 'oidc-form' ? t('oidc.register.description') : undefined}
>
	{#if phase === 'checking'}
		<p class="text-sm text-muted-foreground" role="status">{t('common.loading')}</p>
	{:else if phase === 'invalid'}
		<Alert variant="destructive">{t('invite.invalid')}</Alert>
		<a class="text-sm underline underline-offset-4" href="/login">{t('invite.to_login')}</a>
	{:else if phase === 'unreachable'}
		<Alert variant="destructive">{error}</Alert>
	{:else if phase === 'passkey-prompt'}
		<Alert variant="warning">{t('oidc.passkey_prompt.body')}</Alert>
		<Button size="lg" onclick={() => goto('/settings/passkeys')}>{t('oidc.passkey_prompt.setup')}</Button>
		<Button variant="ghost" onclick={() => goto('/setup/recovery')}>{t('oidc.passkey_prompt.later')}</Button>
	{:else if phase === 'oidc-form'}
		{#if error}<Alert variant="destructive">{error}</Alert>{/if}
		<form class="flex flex-col gap-4" onsubmit={registerWithOidc}>
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
			<Field id="display-name" label={t('invite.display_name')} bind:value={displayName} maxlength={80} autocomplete="name" required />
			<Button type="submit" size="lg" disabled={busy}>
				{busy ? t('oidc.register.waiting') : t('oidc.register.submit')}
			</Button>
		</form>
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
		{#if oidc.enabled}
			<div class="flex flex-col gap-2 border-t pt-4">
				<p class="text-sm text-muted-foreground">{t('oidc.register_hint')}</p>
				<Button variant="outline" onclick={startRegisterWithOidc} disabled={busy}>
					{t('oidc.register_button', { name: providerLabel(oidc) })}
				</Button>
			</div>
		{/if}
	{/if}
</AuthShell>
