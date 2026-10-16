<script lang="ts">
	import { goto } from '$app/navigation';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { t } from '#lib/i18n/index.js';
	import { sessionStore } from '#lib/session.svelte.js';

	/** Shown after a 403 reauth_required: the server wants a session younger than ten minutes, so the user signs in again. */
	let { next }: { next: string } = $props();

	async function signInAgain() {
		await sessionStore.signOut();
		await goto('/login?next=' + encodeURIComponent(next));
	}
</script>

<Alert variant="warning" class="flex flex-col gap-3" data-testid="reauth">
	<p class="font-medium">{t('reauth.title')}</p>
	<p>{t('reauth.body')}</p>
	<div><Button size="sm" onclick={signInAgain} data-testid="reauth-action">{t('reauth.action')}</Button></div>
</Alert>
