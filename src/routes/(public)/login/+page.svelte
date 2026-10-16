<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '#lib/api/client.js';
	import AuthShell from '#lib/components/app/AuthShell.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { errorMessage, oidcErrorMessage, t } from '#lib/i18n/index.js';
	import { loadOidcConfig, providerLabel, startOidc } from '#lib/oidc.js';
	import { safeNext, sessionStore } from '#lib/session.svelte.js';
	import { getPasskey, isWebAuthnSupported } from '#lib/webauthn.js';
	import { onMount } from 'svelte';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import KeyRoundIcon from '@lucide/svelte/icons/key-round';

	let busy = $state(false);
	let error = $state('');
	const supported = isWebAuthnSupported() || import.meta.env.VITE_MOCK === '1';
	const deleted = page.url.searchParams.get('deleted') === '1';
	const recovered = page.url.searchParams.get('recovered') === '1';
	const oidcErrorCode = page.url.searchParams.get('oidc_error');
	let oidc = $state<{ enabled: boolean; name?: string }>({ enabled: false });
	let oidcBusy = $state(false);

	onMount(async () => {
		if (oidcErrorCode) {
			error = oidcErrorMessage(oidcErrorCode);
			// Clean the URL so a reload does not repeat the message; keep other parameters such as `next`.
			const rest = new URLSearchParams(page.url.search);
			rest.delete('oidc_error');
			const query = rest.toString();
			await goto(page.url.pathname + (query ? `?${query}` : ''), { replaceState: true });
		}
		oidc = await loadOidcConfig();
	});

	async function signInWithOidc() {
		oidcBusy = true;
		error = '';
		try {
			await startOidc('login');
		} catch (e) {
			error = errorMessage(e);
			oidcBusy = false;
		}
	}

	async function signIn() {
		busy = true;
		error = '';
		try {
			const options = await api.loginOptions();
			const credential = await getPasskey(options.publicKey);
			sessionStore.set(await api.loginVerify(options.challengeId, credential));
			await goto(safeNext(page.url.searchParams.get('next')), { replaceState: true });
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}
</script>

<AuthShell title={t('login.title')} description={t('login.description')}>
	{#if deleted}<Alert variant="success" data-testid="login-deleted">{t('login.deleted')}</Alert>{/if}
	{#if recovered}<Alert variant="success">{t('login.recovered')}</Alert>{/if}
	{#if !supported}<Alert variant="warning">{t('webauthn.unsupported')}</Alert>{/if}
	{#if error}<Alert variant="destructive">{error}</Alert>{/if}
	<Button size="lg" onclick={signIn} disabled={busy || !supported}>
		<KeyRoundIcon />
		{busy ? t('login.waiting') : t('login.button')}
	</Button>
	{#if oidc.enabled}
		<Button size="lg" variant="outline" onclick={signInWithOidc} disabled={oidcBusy || busy}>
			<ExternalLinkIcon />
			{oidcBusy ? t('oidc.redirecting', { name: providerLabel(oidc) }) : t('oidc.login_button', { name: providerLabel(oidc) })}
		</Button>
	{/if}
	<div class="flex flex-col gap-1 text-center text-sm text-muted-foreground">
		<a class="underline underline-offset-4 hover:text-foreground" href="/recover">{t('login.lost_access')}</a>
		<span>{t('login.invite_hint')}</span>
	</div>
</AuthShell>
