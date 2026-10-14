<script lang="ts">
	import { api, ApiError } from '#lib/api/client.js';
	import Field from '#lib/components/app/Field.svelte';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import Unavailable from '#lib/components/planning/Unavailable.svelte';
	import StorageRulesEditor from '#lib/components/transfer/StorageRulesEditor.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#lib/components/ui/card/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Select } from '#lib/components/ui/select/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { sessionStore } from '#lib/session.svelte.js';
	import { toLoadState, type LoadState } from '#lib/time/load.js';
	import { SIZE_UNITS } from '#lib/transfer/bytes.js';
	import { backendIssues, emptyForm, formFromSettings, inputFromForm, validateRules, type StorageForm } from '#lib/transfer/storage-rules.js';
	import { onMount } from 'svelte';

	const isAdmin = $derived(sessionStore.current?.account.role === 'admin');
	let load = $state<LoadState>({ status: 'loading' });
	let form = $state<StorageForm>(emptyForm());
	let hasSecret = $state(false);
	let forbidden = $state(false);
	let showIssues = $state(false);
	let busy = $state(false);
	let error = $state('');
	let notice = $state('');

	const backend = $derived(backendIssues(form));
	const maxIssue = $derived(validateRules(form).maxUpload);

	onMount(async () => {
		if (!isAdmin) {
			forbidden = true;
			load = { status: 'ready' };
			return;
		}
		try {
			const settings = await api.getStorageSettings();
			form = formFromSettings(settings);
			hasSecret = settings.hasSecret;
			load = { status: 'ready' };
		} catch (e) {
			if (e instanceof ApiError && e.status === 403) {
				forbidden = true;
				load = { status: 'ready' };
			} else load = toLoadState(e);
		}
	});

	async function save(event: Event) {
		event.preventDefault();
		if (busy) return;
		showIssues = true;
		error = notice = '';
		const input = inputFromForm(form);
		if (!input || backend.length > 0) {
			error = t('storage.fix_form');
			return;
		}
		busy = true;
		try {
			const saved = await api.putStorageSettings(input);
			form = formFromSettings(saved);
			hasSecret = saved.hasSecret;
			showIssues = false;
			notice = t('storage.saved');
		} catch (e) {
			error = e instanceof ApiError && e.status === 501 ? t('storage.error_no_secret_key') : errorMessage(e);
		} finally {
			busy = false;
		}
	}
</script>

<PageHeader title={t('storage.title')} description={t('storage.description')} />

{#if load.status === 'loading'}
	<p class="text-sm text-muted-foreground" role="status">{t('common.loading')}</p>
{:else if forbidden}
	<Alert variant="warning" data-testid="storage-forbidden">{t('storage.forbidden')}</Alert>
{:else if load.status === 'unavailable'}
	<Unavailable />
{:else if load.status === 'error'}
	<Alert variant="destructive">{load.message}</Alert>
{:else}
	<form class="flex flex-col gap-6" onsubmit={save} novalidate>
		<Alert variant="warning" data-testid="storage-only-new">{t('storage.only_new')}</Alert>
		{#if error}<Alert variant="destructive" data-testid="storage-error">{error}</Alert>{/if}
		{#if notice}<Alert variant="success" data-testid="storage-saved">{notice}</Alert>{/if}

		<Card>
			<CardHeader>
				<CardTitle>{t('storage.rules_title')}</CardTitle>
				<CardDescription>{t('storage.rules_text')}</CardDescription>
			</CardHeader>
			<CardContent><StorageRulesEditor bind:form {showIssues} /></CardContent>
		</Card>

		<Card>
			<CardHeader><CardTitle>{t('storage.max_title')}</CardTitle></CardHeader>
			<CardContent class="flex flex-wrap items-end gap-2">
				<div class="flex flex-col gap-1.5">
					<Label for="max-upload">{t('storage.max_amount')}</Label>
					<Input id="max-upload" class="w-28" inputmode="decimal" bind:value={form.maxUploadAmount} aria-invalid={showIssues && maxIssue ? true : undefined} />
				</div>
				<Select class="w-24" aria-label={t('storage.max_unit')} bind:value={form.maxUploadUnit}>
					{#each SIZE_UNITS as unit (unit)}<option value={unit}>{unit}</option>{/each}
				</Select>
				{#if showIssues && maxIssue}<p class="w-full text-xs text-destructive">{t('storage.max_issue')}</p>{/if}
			</CardContent>
		</Card>

		<Card>
			<CardHeader><CardTitle>{t('storage.local_title')}</CardTitle></CardHeader>
			<CardContent>
				<Field
					id="local-path"
					label={t('storage.local_path')}
					bind:value={form.localPath}
					hint={t('storage.local_hint')}
					error={showIssues && backend.includes('local_path') ? t('storage.local_required') : undefined}
				/>
			</CardContent>
		</Card>

		<Card>
			<CardHeader>
				<CardTitle>{t('storage.s3_title')}</CardTitle>
				{#if showIssues && backend.includes('s3_fields')}<CardDescription class="text-destructive">{t('storage.s3_required')}</CardDescription>{/if}
			</CardHeader>
			<CardContent class="grid gap-3 sm:grid-cols-2">
				<Field id="s3-endpoint" label={t('storage.s3_endpoint')} bind:value={form.endpoint} placeholder="https://s3.example.org" />
				<Field id="s3-region" label={t('storage.s3_region')} bind:value={form.region} />
				<Field id="s3-bucket" label={t('storage.s3_bucket')} bind:value={form.bucket} />
				<Field id="s3-key-id" label={t('storage.s3_key_id')} bind:value={form.accessKeyId} autocomplete="off" />
				<label class="flex items-center gap-2 text-sm sm:col-span-2"><Checkbox id="s3-path-style" bind:checked={form.pathStyle} />{t('storage.s3_path_style')}</label>
				<div class="flex flex-col gap-1.5 sm:col-span-2">
					<Label for="s3-secret">{t('storage.s3_secret')}</Label>
					<Input id="s3-secret" type="password" autocomplete="new-password" bind:value={form.secret} aria-describedby="s3-secret-hint" />
					<p id="s3-secret-hint" class="text-xs text-muted-foreground">
						{#if hasSecret}
							<strong data-testid="secret-stored">{t('storage.s3_secret_stored')}</strong> · {t('storage.s3_secret_stored_hint')}
						{:else}
							{t('storage.s3_secret_none')} {t('storage.s3_secret_write_only')}
						{/if}
					</p>
				</div>
			</CardContent>
		</Card>

		<div><Button type="submit" disabled={busy}>{t('storage.save')}</Button></div>
	</form>
{/if}
