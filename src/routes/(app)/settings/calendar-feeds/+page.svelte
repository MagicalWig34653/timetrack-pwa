<script lang="ts">
	import { api } from '#lib/api/client.js';
	import type { CalendarFeed, CalendarFeedPart } from '#lib/api/types.js';
	import CopyButton from '#lib/components/app/CopyButton.svelte';
	import Field from '#lib/components/app/Field.svelte';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import Unavailable from '#lib/components/time/Unavailable.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#lib/components/ui/card/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { formatDateNumeric, localDateOf, localTimeOf } from '#lib/time/dates.js';
	import { toLoadState, type LoadState } from '#lib/time/load.js';
	import { zoneStore } from '#lib/time/zone.svelte.js';
	import { onMount } from 'svelte';

	const PARTS: CalendarFeedPart[] = ['absences', 'holidays', 'plan', 'tracked'];

	let load = $state<LoadState>({ status: 'loading' });
	let feeds = $state<CalendarFeed[]>([]);
	let label = $state('');
	let include = $state<Record<CalendarFeedPart, boolean>>({ absences: true, holidays: true, plan: false, tracked: false });
	let expiresInDays = $state('');
	let errors = $state<{ label?: string; include?: string; expires?: string }>({});
	let formError = $state('');
	let pending = $state(false);
	let created = $state<{ label: string; url: string } | null>(null);
	let confirmRevoke = $state<string | null>(null);
	let notice = $state('');

	const timeZone = $derived(zoneStore.value);
	const when = (instant: string) => `${formatDateNumeric(localDateOf(instant, timeZone))} ${localTimeOf(instant, timeZone)}`;
	const origin = typeof location === 'undefined' ? 'https://timetrack.example.org' : location.origin;
	const partLabel = (part: CalendarFeedPart) => t(`feeds.part.${part}`);

	async function refresh() {
		try {
			await zoneStore.ensure();
			feeds = await api.listCalendarFeeds();
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
		const chosen = PARTS.filter((p) => include[p]);
		const days = expiresInDays.trim() === '' ? undefined : Number(expiresInDays);
		if (!label.trim()) errors.label = t('feeds.error_label');
		if (chosen.length === 0) errors.include = t('feeds.error_include');
		if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > 730)) errors.expires = t('feeds.error_expires');
		if (errors.label || errors.include || errors.expires) return;
		pending = true;
		try {
			const result = await api.createCalendarFeed({ label: label.trim(), include: chosen, ...(days ? { expiresInDays: days } : {}) });
			// The token exists only in this response; it is kept in component memory and never persisted.
			created = { label: result.label, url: result.path ? origin + result.path : '' };
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

	async function revoke(feed: CalendarFeed) {
		if (pending) return;
		pending = true;
		formError = '';
		try {
			await api.revokeCalendarFeed(feed.id);
			confirmRevoke = null;
			notice = t('feeds.revoked');
			await refresh();
		} catch (e) {
			formError = errorMessage(e);
		} finally {
			pending = false;
		}
	}
</script>

<PageHeader title={t('feeds.title')} description={t('feeds.description')} />

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
			<Alert variant="warning" data-testid="created-feed">
				<p class="font-medium">{t('feeds.created_title', { label: created.label })}</p>
				<p class="mt-1">{t('feeds.created_warning')}</p>
				{#if created.url}
					<div class="mt-3">
						<p class="text-xs text-muted-foreground">{t('feeds.created_url')}</p>
						<div class="mt-1 flex flex-wrap items-center gap-2">
							<code class="rounded bg-background px-2 py-1 text-sm break-all" data-testid="feed-url">{created.url}</code>
							<CopyButton text={created.url} />
						</div>
					</div>
				{/if}
				<div class="mt-3"><Button size="sm" variant="outline" onclick={() => (created = null)}>{t('feeds.created_done')}</Button></div>
			</Alert>
		{/if}

		<Alert variant="warning" data-testid="feed-security">
			<p class="font-medium">{t('feeds.security_title')}</p>
			<ul class="mt-2 list-disc space-y-1 pl-5 text-sm">
				<li>{t('feeds.security_url')}</li>
				<li>{t('feeds.security_third_party')}</li>
				<li>{t('feeds.security_revoke')}</li>
			</ul>
		</Alert>

		<Card>
			<CardHeader>
				<CardTitle>{t('feeds.list_title')}</CardTitle>
				<CardDescription>{t('feeds.list_text')}</CardDescription>
			</CardHeader>
			<CardContent>
				{#if feeds.length === 0}
					<p class="text-sm text-muted-foreground">{t('feeds.empty')}</p>
				{:else}
					<ul class="divide-y" data-testid="feed-list">
						{#each feeds as feed (feed.id)}
							<li class="flex flex-wrap items-center justify-between gap-3 py-3">
								<div class="min-w-0">
									<p class="font-medium">{feed.label}</p>
									<p class="text-xs text-muted-foreground">{t('feeds.include_list', { parts: feed.include.map(partLabel).join(', ') })}</p>
									<p class="text-xs text-muted-foreground">
										{t('feeds.created_at', { time: when(feed.createdAt) })}
										· {feed.lastUsedAt ? t('feeds.last_used', { time: when(feed.lastUsedAt) }) : t('feeds.never_used')}
										· {feed.expiresAt ? t('feeds.expires', { time: when(feed.expiresAt) }) : t('feeds.no_expiry')}
									</p>
								</div>
								{#if confirmRevoke === feed.id}
									<div class="flex flex-col items-end gap-2">
										<p class="max-w-xs text-right text-xs">{t('feeds.revoke_text', { label: feed.label })}</p>
										<div class="flex items-center gap-2">
											<Button variant="destructive" size="sm" onclick={() => revoke(feed)} disabled={pending}>{t('feeds.revoke_confirm')}</Button>
											<Button variant="outline" size="sm" onclick={() => (confirmRevoke = null)}>{t('common.cancel')}</Button>
										</div>
									</div>
								{:else}
									<Button variant="outline" size="sm" aria-label={t('feeds.revoke_aria', { label: feed.label })} onclick={() => (confirmRevoke = feed.id)}>{t('feeds.revoke')}</Button>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</CardContent>
		</Card>

		<Card>
			<CardHeader>
				<CardTitle>{t('feeds.new_title')}</CardTitle>
				<CardDescription>{t('feeds.new_text')}</CardDescription>
			</CardHeader>
			<CardContent>
				<form class="flex flex-col gap-4" onsubmit={create} novalidate aria-label={t('feeds.new_title')}>
					<Field id="feed-label" label={t('feeds.label')} hint={t('feeds.label_hint')} bind:value={label} error={errors.label} maxlength={80} disabled={pending} />
					<fieldset class="flex flex-col gap-2" aria-describedby="feed-include-hint">
						<legend class="mb-1 text-sm font-medium">{t('feeds.include')}</legend>
						{#each PARTS as part (part)}
							<label class="flex items-start gap-2 text-sm">
								<Checkbox id="feed-part-{part}" class="mt-0.5" bind:checked={include[part]} disabled={pending} />
								<span>
									<span class="font-medium">{partLabel(part)}</span>
									<span class="block text-xs text-muted-foreground">{t(`feeds.part_text.${part}`)}</span>
								</span>
							</label>
						{/each}
						<p id="feed-include-hint" class="text-xs text-muted-foreground">{t('feeds.include_hint')}</p>
						{#if errors.include}<p class="text-xs text-destructive">{errors.include}</p>{/if}
					</fieldset>
					<div class="sm:max-w-xs">
						<Field id="feed-expires" label={t('feeds.expires_in')} hint={t('feeds.expires_hint')} inputmode="numeric" bind:value={expiresInDays} error={errors.expires} disabled={pending} />
					</div>
					<div><Button type="submit" disabled={pending}>{t('feeds.create')}</Button></div>
				</form>
			</CardContent>
		</Card>

		<Card>
			<CardHeader><CardTitle>{t('feeds.help_title')}</CardTitle></CardHeader>
			<CardContent class="text-sm">
				<ul class="list-disc space-y-1 pl-5">
					<li>{t('feeds.help_apple')}</li>
					<li>{t('feeds.help_google')}</li>
					<li>{t('feeds.help_outlook')}</li>
					<li>{t('feeds.help_window')}</li>
				</ul>
			</CardContent>
		</Card>
	</div>
{/if}
