<script lang="ts">
	import { api } from '#lib/api/client.js';
	import type { DeviceToken, DeviceTokenCreated } from '#lib/api/types.js';
	import CopyButton from '#lib/components/app/CopyButton.svelte';
	import Field from '#lib/components/app/Field.svelte';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import Unavailable from '#lib/components/time/Unavailable.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#lib/components/ui/card/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { formatDateNumeric, localDateOf, localTimeOf } from '#lib/time/dates.js';
	import { toLoadState, type LoadState } from '#lib/time/load.js';
	import { zoneStore } from '#lib/time/zone.svelte.js';
	import { onMount } from 'svelte';

	let load = $state<LoadState>({ status: 'loading' });
	let tokens = $state<DeviceToken[]>([]);
	let name = $state('');
	let expiresInDays = $state('');
	let errors = $state<{ name?: string; expires?: string }>({});
	let formError = $state('');
	let pending = $state(false);
	let created = $state<DeviceTokenCreated | null>(null);
	let confirmRevoke = $state<string | null>(null);
	let notice = $state('');

	const timeZone = $derived(zoneStore.value);
	const when = (instant: string) => `${formatDateNumeric(localDateOf(instant, timeZone))} ${localTimeOf(instant, timeZone)}`;
	const origin = typeof location === 'undefined' ? 'https://example.org' : location.origin;
	const sample = $derived(`POST ${origin}/api/v1/automation/events
Authorization: Bearer <Gerätetoken>
Content-Type: application/json

{
  "eventId": "<neue UUID pro Ereignis>",
  "deviceId": "iphone-lino",
  "type": "presence_confirmed",
  "placeId": "<Orts-ID>",
  "occurredAt": "2026-10-14T06:58:00Z"
}`);

	async function refresh() {
		try {
			await zoneStore.ensure();
			tokens = await api.listDeviceTokens();
			load = { status: 'ready' };
		} catch (e) {
			load = toLoadState(e);
		}
	}
	onMount(refresh);

	async function create(event: Event) {
		event.preventDefault();
		if (pending) return;
		errors = {};
		formError = '';
		const days = expiresInDays.trim() === '' ? undefined : Number(expiresInDays);
		if (!name.trim()) errors.name = t('devices.error_name');
		if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > 730)) errors.expires = t('devices.error_expires');
		if (errors.name || errors.expires) return;
		pending = true;
		try {
			created = await api.createDeviceToken({ name: name.trim(), ...(days ? { expiresInDays: days } : {}) });
			name = '';
			expiresInDays = '';
			notice = '';
			await refresh();
		} catch (e) {
			formError = errorMessage(e);
		} finally {
			pending = false;
		}
	}

	async function revoke(token: DeviceToken) {
		if (pending) return;
		pending = true;
		formError = '';
		try {
			await api.revokeDeviceToken(token.id);
			confirmRevoke = null;
			notice = t('devices.revoked');
			await refresh();
		} catch (e) {
			formError = errorMessage(e);
		} finally {
			pending = false;
		}
	}
</script>

<PageHeader title={t('devices.title')} description={t('devices.description')} />

{#if load.status === 'loading'}
	<p class="text-sm text-muted-foreground">{t('common.loading')}</p>
{:else if load.status === 'unavailable'}
	<Unavailable />
{:else if load.status === 'error'}
	<Alert variant="destructive">{load.message}</Alert>
{:else}
	<div class="flex flex-col gap-4">
		{#if notice}<Alert variant="success">{notice}</Alert>{/if}
		{#if formError}<Alert variant="destructive">{formError}</Alert>{/if}

		{#if created}
			<Alert variant="warning" data-testid="created-token">
				<p class="font-medium">{t('devices.created_title', { name: created.name })}</p>
				<p class="mt-1">{t('devices.created_text')}</p>
				<div class="mt-3 flex flex-wrap items-center gap-2">
					<code class="rounded bg-background px-2 py-1 text-sm break-all" data-testid="token-value">{created.token}</code>
					<CopyButton text={created.token} />
				</div>
				<div class="mt-3"><Button size="sm" variant="outline" onclick={() => (created = null)}>{t('devices.created_done')}</Button></div>
			</Alert>
		{/if}

		<Card>
			<CardHeader>
				<CardTitle>{t('devices.list_title')}</CardTitle>
				<CardDescription>{t('devices.list_text')}</CardDescription>
			</CardHeader>
			<CardContent>
				{#if tokens.length === 0}
					<p class="text-sm text-muted-foreground">{t('devices.empty')}</p>
				{:else}
					<ul class="divide-y" data-testid="token-list">
						{#each tokens as token (token.id)}
							<li class="flex flex-wrap items-center justify-between gap-3 py-3">
								<div class="min-w-0">
									<p class="font-medium">{token.name}</p>
									<p class="text-xs text-muted-foreground">
										{t('devices.created_at', { time: when(token.createdAt) })}
										· {token.lastUsedAt ? t('devices.last_used', { time: when(token.lastUsedAt) }) : t('devices.never_used')}
										{#if token.expiresAt}· {t('devices.expires', { time: when(token.expiresAt) })}{/if}
									</p>
								</div>
								{#if confirmRevoke === token.id}
									<div class="flex items-center gap-2">
										<Button variant="destructive" size="sm" onclick={() => revoke(token)} disabled={pending}>{t('devices.revoke_confirm')}</Button>
										<Button variant="outline" size="sm" onclick={() => (confirmRevoke = null)}>{t('common.cancel')}</Button>
									</div>
								{:else}
									<Button variant="outline" size="sm" onclick={() => (confirmRevoke = token.id)}>{t('devices.revoke')}</Button>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</CardContent>
		</Card>

		<Card>
			<CardHeader>
				<CardTitle>{t('devices.new_title')}</CardTitle>
				<CardDescription>{t('devices.new_text')}</CardDescription>
			</CardHeader>
			<CardContent>
				<form class="flex flex-col gap-4" onsubmit={create} novalidate aria-label={t('devices.new_title')}>
					<div class="grid gap-3 sm:grid-cols-2">
						<Field id="token-name" label={t('devices.name')} hint={t('devices.name_hint')} bind:value={name} error={errors.name} maxlength={80} disabled={pending} />
						<Field id="token-expires" label={t('devices.expires_in')} hint={t('devices.expires_hint')} inputmode="numeric" bind:value={expiresInDays} error={errors.expires} disabled={pending} />
					</div>
					<div><Button type="submit" disabled={pending}>{t('devices.create')}</Button></div>
				</form>
			</CardContent>
		</Card>

		<Card>
			<CardHeader>
				<CardTitle>{t('devices.help_title')}</CardTitle>
				<CardDescription>{t('devices.help_intro')}</CardDescription>
			</CardHeader>
			<CardContent class="flex flex-col gap-3 text-sm">
				<ul class="list-disc space-y-1 pl-5">
					<li>{t('devices.help_auth')}</li>
					<li>{t('devices.help_types')}</li>
					<li>{t('devices.help_idempotent')}</li>
					<li>{t('devices.help_modes')}</li>
					<li>{t('devices.help_results')}</li>
					<li>{t('devices.help_no_departure')}</li>
				</ul>
				<pre class="overflow-x-auto rounded-lg border bg-muted/40 p-3 text-xs" data-testid="shortcut-sample"><code>{sample}</code></pre>
				<p class="text-xs text-muted-foreground">{t('devices.help_recipe')}</p>
			</CardContent>
		</Card>
	</div>
{/if}
