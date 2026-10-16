<script lang="ts">
	import { goto } from '$app/navigation';
	import { api } from '#lib/api/client.js';
	import { ApiError } from '#lib/api/errors.js';
	import ConfirmDialog from '#lib/components/app/ConfirmDialog.svelte';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#lib/components/ui/card/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { moduleStore } from '#lib/modules/store.svelte.js';
	import { sessionStore } from '#lib/session.svelte.js';
	import { saveBlob } from '#lib/transfer/export.js';

	const handle = $derived(sessionStore.current?.account.handle ?? '');

	let exporting = $state(false);
	let exportError = $state('');
	let exportDone = $state('');

	let dialogOpen = $state(false);
	let deleting = $state(false);
	let dialogError = $state('');
	let reauth = $state(false);
	/** the server could not remove stored files: the account is disabled and the session revoked */
	let incomplete = $state(false);

	async function download() {
		exporting = true;
		exportError = '';
		exportDone = '';
		try {
			const file = await api.exportMyData();
			const name = file.filename ?? 'timetrack-export.zip';
			saveBlob(file.blob, name);
			exportDone = t('privacy.export.done', { name });
		} catch (e) {
			exportError = e instanceof ApiError && e.status === 403 && e.code !== 'reauth_required' ? t('privacy.export.forbidden') : errorMessage(e);
		} finally {
			exporting = false;
		}
	}

	function openDialog() {
		dialogError = '';
		reauth = false;
		dialogOpen = true;
	}

	async function leave() {
		moduleStore.reset();
		sessionStore.current = null;
		await goto('/login?deleted=1', { replaceState: true, invalidateAll: true });
	}

	async function confirmDelete() {
		deleting = true;
		dialogError = '';
		reauth = false;
		try {
			await api.deleteMyAccount(handle);
			// the server cleared the cookie; forget everything held in memory and show the goodbye notice on the login page
			dialogOpen = false;
			await leave();
		} catch (e) {
			if (e instanceof ApiError && e.code === 'reauth_required') reauth = true;
			else if (e instanceof ApiError && e.code === 'account_deletion_incomplete') {
				incomplete = true;
				dialogOpen = false;
			} else if (e instanceof ApiError && e.code === 'last_admin') dialogError = t('privacy.delete.last_admin');
			else dialogError = errorMessage(e);
		} finally {
			deleting = false;
		}
	}
</script>

<PageHeader title={t('privacy.title')} description={t('privacy.description')} />

<div class="flex flex-col gap-6">
	<Card>
		<CardHeader>
			<CardTitle>{t('privacy.export.title')}</CardTitle>
			<CardDescription>{t('privacy.export.text')}</CardDescription>
		</CardHeader>
		<CardContent class="flex flex-col gap-3">
			{#if exportError}<Alert variant="destructive" data-testid="export-error">{exportError}</Alert>{/if}
			{#if exportDone}<Alert variant="success" data-testid="export-done">{exportDone}</Alert>{/if}
			<div>
				<Button onclick={download} disabled={exporting} data-testid="export-button">
					{exporting ? t('privacy.export.busy') : t('privacy.export.button')}
				</Button>
			</div>
		</CardContent>
	</Card>

	<Card class="border-destructive/30">
		<CardHeader>
			<CardTitle>{t('privacy.delete.title')}</CardTitle>
			<CardDescription>{t('privacy.delete.text')}</CardDescription>
		</CardHeader>
		<CardContent class="flex flex-col gap-3">
			{#if incomplete}
				<Alert variant="warning" class="flex flex-col gap-3" data-testid="delete-incomplete">
					<p>{t('privacy.delete.incomplete')}</p>
					<div><Button size="sm" variant="outline" onclick={leave}>{t('privacy.delete.to_login')}</Button></div>
				</Alert>
			{:else}
				<div>
					<Button variant="destructive" onclick={openDialog} data-testid="delete-open">{t('privacy.delete.button')}</Button>
				</div>
			{/if}
		</CardContent>
	</Card>
</div>

<ConfirmDialog
	bind:open={dialogOpen}
	title={t('privacy.delete.dialog_title')}
	confirmLabel={t('privacy.delete.confirm')}
	tone="danger"
	typedHandle={handle}
	busy={deleting}
	error={dialogError}
	reauthNext={reauth ? '/settings/privacy' : undefined}
	onconfirm={confirmDelete}
	oncancel={() => (dialogOpen = false)}
>
	<p class="font-medium text-destructive">{t('privacy.delete.dialog_body')}</p>
	<ul class="list-disc space-y-1 pl-5">
		<li>{t('accounts.delete.item_data')}</li>
		<li>{t('accounts.delete.item_files')}</li>
		<li>{t('accounts.delete.item_access')}</li>
		<li>{t('accounts.delete.item_shares')}</li>
	</ul>
	<p class="text-muted-foreground">{t('accounts.delete.backups')}</p>
</ConfirmDialog>
