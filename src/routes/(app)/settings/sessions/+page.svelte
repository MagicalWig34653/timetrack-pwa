<script lang="ts">
	import { api } from '#lib/api/client.js';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#lib/components/ui/card/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';

	let busy = $state(false);
	let done = $state(false);
	let error = $state('');

	async function revoke() {
		busy = true;
		error = '';
		done = false;
		try {
			await api.revokeOtherSessions();
			done = true;
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}
</script>

<PageHeader title={t('sessions.title')} description={t('sessions.description')} />
<Card>
	<CardHeader>
		<CardTitle>{t('sessions.revoke_title')}</CardTitle>
		<CardDescription>{t('sessions.revoke_text')}</CardDescription>
	</CardHeader>
	<CardContent class="flex flex-col gap-3">
		{#if error}<Alert variant="destructive">{error}</Alert>{/if}
		{#if done}<Alert variant="success">{t('sessions.revoked')}</Alert>{/if}
		<div><Button variant="destructive" onclick={revoke} disabled={busy}>{t('sessions.revoke_button')}</Button></div>
	</CardContent>
</Card>
