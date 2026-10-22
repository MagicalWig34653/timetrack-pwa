<script lang="ts">
	import { api } from '#lib/api/client.js';
	import type { Place, SegmentKind, TriggerAction, TriggerLink } from '#lib/api/types.js';
	import CopyButton from '#lib/components/app/CopyButton.svelte';
	import Field from '#lib/components/app/Field.svelte';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import Unavailable from '#lib/components/time/Unavailable.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#lib/components/ui/card/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Select } from '#lib/components/ui/select/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { formatDateNumeric, localDateOf, localTimeOf } from '#lib/time/dates.js';
	import { toLoadState, type LoadState } from '#lib/time/load.js';
	import { zoneStore } from '#lib/time/zone.svelte.js';
	import { onMount } from 'svelte';

	const ACTIONS: TriggerAction[] = ['start', 'stop', 'toggle'];
	const KINDS: SegmentKind[] = ['work', 'travel', 'school'];

	let load = $state<LoadState>({ status: 'loading' });
	let links = $state<TriggerLink[]>([]);
	let places = $state<Place[]>([]);
	let label = $state('');
	let actions = $state<Record<TriggerAction, boolean>>({ start: true, stop: true, toggle: false });
	let placeId = $state('');
	let kind = $state<SegmentKind>('work');
	let expiresInDays = $state('');
	let errors = $state<{ label?: string; actions?: string; expires?: string }>({});
	let formError = $state('');
	let pending = $state(false);
	let created = $state<{ label: string; urls: { action: TriggerAction; url: string }[] } | null>(null);
	let confirmRevoke = $state<string | null>(null);
	let notice = $state('');

	const timeZone = $derived(zoneStore.value);
	const when = (instant: string) => `${formatDateNumeric(localDateOf(instant, timeZone))} ${localTimeOf(instant, timeZone)}`;
	const origin = typeof location === 'undefined' ? 'https://timetrack.example.org' : location.origin;
	const actionLabel = (action: TriggerAction) => t(`trigger.action.${action}`);
	const placeName = (link: TriggerLink) => {
		if (!link.placeId) return t('trigger.place_any');
		const place = places.find((p) => p.id === link.placeId);
		return place ? t('trigger.place_bound', { place: place.name }) : t('trigger.place_unknown');
	};

	async function refresh() {
		try {
			await zoneStore.ensure();
			[links, places] = await Promise.all([api.listTriggerLinks(), api.listPlaces()]);
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
		const chosen = ACTIONS.filter((a) => actions[a]);
		const days = expiresInDays.trim() === '' ? undefined : Number(expiresInDays);
		if (!label.trim()) errors.label = t('trigger.error_label');
		if (chosen.length === 0) errors.actions = t('trigger.error_actions');
		if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > 730)) errors.expires = t('trigger.error_expires');
		if (errors.label || errors.actions || errors.expires) return;
		pending = true;
		try {
			const result = await api.createTriggerLink({
				label: label.trim(),
				actions: chosen,
				kind,
				...(placeId ? { placeId } : {}),
				...(days ? { expiresInDays: days } : {})
			});
			// The token exists only in this response; it is kept in component memory and never persisted.
			const base = origin + (result.path ?? '');
			created = { label: result.label, urls: result.path ? result.actions.map((action) => ({ action, url: `${base}/${action}` })) : [] };
			label = '';
			expiresInDays = '';
			notice = '';
			await refresh();
		} catch (e) {
			formError = errorMessage(e);
		} finally {
			pending = false;
		}
	}

	async function revoke(link: TriggerLink) {
		if (pending) return;
		pending = true;
		formError = '';
		try {
			await api.revokeTriggerLink(link.id);
			confirmRevoke = null;
			notice = t('trigger.revoked');
			await refresh();
		} catch (e) {
			formError = errorMessage(e);
		} finally {
			pending = false;
		}
	}
</script>

<PageHeader title={t('trigger.title')} description={t('trigger.description')} />

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
			<Alert variant="warning" data-testid="created-link">
				<p class="font-medium">{t('trigger.created_title', { label: created.label })}</p>
				<p class="mt-1">{t('trigger.created_warning')}</p>
				<div class="mt-3 flex flex-col gap-3">
					{#each created.urls as entry (entry.action)}
						<div>
							<p class="text-xs text-muted-foreground">{t('trigger.created_url_for', { action: actionLabel(entry.action) })}</p>
							<div class="mt-1 flex flex-wrap items-center gap-2">
								<code class="rounded bg-background px-2 py-1 text-sm break-all" data-testid="link-url-{entry.action}">{entry.url}</code>
								<CopyButton text={entry.url} />
							</div>
						</div>
					{/each}
				</div>
				<div class="mt-3"><Button size="sm" variant="outline" onclick={() => (created = null)}>{t('trigger.created_done')}</Button></div>
			</Alert>
		{/if}

		<Alert variant="warning" data-testid="trigger-security">
			<p class="font-medium">{t('trigger.security_title')}</p>
			<ul class="mt-2 list-disc space-y-1 pl-5 text-sm">
				<li>{t('trigger.security_url')}</li>
				<li>{t('trigger.security_one_per_purpose')}</li>
				<li>{t('trigger.security_history')}</li>
				<li>{t('trigger.security_revoke')}</li>
				<li>{t('trigger.security_header')}</li>
			</ul>
		</Alert>

		<Card>
			<CardHeader>
				<CardTitle>{t('trigger.list_title')}</CardTitle>
				<CardDescription>{t('trigger.list_text')}</CardDescription>
			</CardHeader>
			<CardContent>
				{#if links.length === 0}
					<p class="text-sm text-muted-foreground">{t('trigger.empty')}</p>
				{:else}
					<ul class="divide-y" data-testid="link-list">
						{#each links as link (link.id)}
							<li class="flex flex-wrap items-center justify-between gap-3 py-3">
								<div class="min-w-0">
									<p class="font-medium">{link.label}</p>
									<p class="text-xs text-muted-foreground">
										{t('trigger.actions_list', { actions: link.actions.map(actionLabel).join(', ') })}
										· {t(`kind.${link.kind}`)}
										· {placeName(link)}
									</p>
									<p class="text-xs text-muted-foreground">
										{t('trigger.created_at', { time: when(link.createdAt) })}
										· {link.lastUsedAt
											? t('trigger.last_used', { time: when(link.lastUsedAt), action: link.lastAction ? actionLabel(link.lastAction) : '–' })
											: t('trigger.never_used')}
										· {link.expiresAt ? t('trigger.expires', { time: when(link.expiresAt) }) : t('trigger.no_expiry')}
									</p>
								</div>
								{#if confirmRevoke === link.id}
									<div class="flex flex-col items-end gap-2">
										<p class="max-w-xs text-right text-xs">{t('trigger.revoke_text', { label: link.label })}</p>
										<div class="flex items-center gap-2">
											<Button variant="destructive" size="sm" onclick={() => revoke(link)} disabled={pending}>{t('trigger.revoke_confirm')}</Button>
											<Button variant="outline" size="sm" onclick={() => (confirmRevoke = null)}>{t('common.cancel')}</Button>
										</div>
									</div>
								{:else}
									<Button variant="outline" size="sm" aria-label={t('trigger.revoke_aria', { label: link.label })} onclick={() => (confirmRevoke = link.id)}>{t('trigger.revoke')}</Button>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</CardContent>
		</Card>

		<Card>
			<CardHeader>
				<CardTitle>{t('trigger.new_title')}</CardTitle>
				<CardDescription>{t('trigger.new_text')}</CardDescription>
			</CardHeader>
			<CardContent>
				<form class="flex flex-col gap-4" onsubmit={create} novalidate aria-label={t('trigger.new_title')}>
					<Field id="trigger-label" label={t('trigger.label')} hint={t('trigger.label_hint')} bind:value={label} error={errors.label} maxlength={80} disabled={pending} />
					<fieldset class="flex flex-col gap-2" aria-describedby="trigger-actions-hint">
						<legend class="mb-1 text-sm font-medium">{t('trigger.actions')}</legend>
						{#each ACTIONS as action (action)}
							<label class="flex items-start gap-2 text-sm">
								<Checkbox id="trigger-action-{action}" class="mt-0.5" bind:checked={actions[action]} disabled={pending} />
								<span>
									<span class="font-medium">{actionLabel(action)}</span>
									<span class="block text-xs text-muted-foreground">{t(`trigger.action_text.${action}`)}</span>
								</span>
							</label>
						{/each}
						<p id="trigger-actions-hint" class="text-xs text-muted-foreground">{t('trigger.actions_hint')}</p>
						{#if errors.actions}<p class="text-xs text-destructive">{errors.actions}</p>{/if}
					</fieldset>
					<div class="grid gap-3 sm:grid-cols-2">
						<div class="flex flex-col gap-1.5">
							<Label for="trigger-place">{t('trigger.place')}</Label>
							<Select id="trigger-place" bind:value={placeId} disabled={pending}>
								<option value="">{t('trigger.place_none')}</option>
								{#each places.filter((p) => !p.archived) as place (place.id)}<option value={place.id}>{place.name}</option>{/each}
							</Select>
							<p class="text-xs text-muted-foreground">{t('trigger.place_hint')}</p>
						</div>
						<div class="flex flex-col gap-1.5">
							<Label for="trigger-kind">{t('trigger.kind')}</Label>
							<Select id="trigger-kind" bind:value={kind} disabled={pending}>
								{#each KINDS as k (k)}<option value={k}>{t(`kind.${k}`)}</option>{/each}
							</Select>
						</div>
					</div>
					<div class="sm:max-w-xs">
						<Field id="trigger-expires" label={t('trigger.expires_in')} hint={t('trigger.expires_hint')} inputmode="numeric" bind:value={expiresInDays} error={errors.expires} disabled={pending} />
					</div>
					<div><Button type="submit" disabled={pending}>{t('trigger.create')}</Button></div>
				</form>
			</CardContent>
		</Card>

		<Card>
			<CardHeader>
				<CardTitle>{t('trigger.help_title')}</CardTitle>
				<CardDescription>{t('trigger.help_intro')}</CardDescription>
			</CardHeader>
			<CardContent class="text-sm">
				<ul class="list-disc space-y-1 pl-5">
					<li>{t('trigger.help_call', { origin })}</li>
					<li>{t('trigger.help_at')}</li>
					<li>{t('trigger.help_place')}</li>
					<li>{t('trigger.help_format')}</li>
					<li>{t('trigger.help_results')}</li>
					<li>{t('trigger.help_errors')}</li>
					<li>{t('trigger.help_prefetch')}</li>
				</ul>
			</CardContent>
		</Card>
	</div>
{/if}
