<script lang="ts">
	import { api } from '#lib/api/client.js';
	import type { AutomationMode, Place, PlaceInput, PlaceKind, SegmentKind } from '#lib/api/types.js';
	import CopyButton from '#lib/components/app/CopyButton.svelte';
	import Field from '#lib/components/app/Field.svelte';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import Unavailable from '#lib/components/time/Unavailable.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#lib/components/ui/card/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Select } from '#lib/components/ui/select/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { AUTOMATION_MODES, automationLabel, kindLabel, PLACE_KINDS, placeKindLabel, SEGMENT_KINDS } from '#lib/time/labels.js';
	import { toLoadState, type LoadState } from '#lib/time/load.js';
	import { onMount } from 'svelte';

	interface PlaceForm {
		name: string;
		kind: PlaceKind;
		automationMode: AutomationMode;
		defaultSegmentKind: SegmentKind;
		latitude: string;
		longitude: string;
		radiusMeters: string;
		confirmMinutes: string;
	}

	const blank = (): PlaceForm => ({
		name: '',
		kind: 'office',
		automationMode: 'suggest',
		defaultSegmentKind: 'work',
		latitude: '',
		longitude: '',
		radiusMeters: '',
		confirmMinutes: '5'
	});

	let load = $state<LoadState>({ status: 'loading' });
	let places = $state<Place[]>([]);
	let editing = $state<Place | 'new' | null>(null);
	let form = $state<PlaceForm>(blank());
	let errors = $state<Partial<Record<keyof PlaceForm, string>>>({});
	let formError = $state('');
	let notice = $state('');
	let pending = $state(false);
	let archiving = $state<string | null>(null);

	async function refresh() {
		try {
			places = await api.listPlaces();
			load = { status: 'ready' };
		} catch (error) {
			load = toLoadState(error);
		}
	}
	onMount(refresh);

	function edit(place: Place | 'new') {
		editing = place;
		errors = {};
		formError = '';
		archiving = null;
		form =
			place === 'new'
				? blank()
				: {
						name: place.name,
						kind: place.kind,
						automationMode: place.automationMode,
						defaultSegmentKind: place.defaultSegmentKind ?? 'work',
						latitude: place.latitude == null ? '' : String(place.latitude),
						longitude: place.longitude == null ? '' : String(place.longitude),
						radiusMeters: place.radiusMeters == null ? '' : String(place.radiusMeters),
						confirmMinutes: String(Math.round((place.confirmAfterSeconds ?? 300) / 60))
					};
	}

	function build(): { input: PlaceInput } | { errors: typeof errors } {
		const next: typeof errors = {};
		if (!form.name.trim()) next.name = t('places.error_name');
		const lat = form.latitude.trim() === '' ? null : Number(form.latitude.replace(',', '.'));
		const lon = form.longitude.trim() === '' ? null : Number(form.longitude.replace(',', '.'));
		const radius = form.radiusMeters.trim() === '' ? null : Number(form.radiusMeters);
		if (lat !== null && (Number.isNaN(lat) || lat < -90 || lat > 90)) next.latitude = t('places.error_latitude');
		if (lon !== null && (Number.isNaN(lon) || lon < -180 || lon > 180)) next.longitude = t('places.error_longitude');
		if ((lat === null) !== (lon === null)) next.longitude = next.longitude ?? t('places.error_pair');
		if (radius !== null && (!Number.isInteger(radius) || radius < 20)) next.radiusMeters = t('places.error_radius');
		const minutes = Number(form.confirmMinutes);
		if (!Number.isInteger(minutes) || minutes < 0 || minutes > 720) next.confirmMinutes = t('places.error_confirm');
		if (Object.keys(next).length > 0) return { errors: next };
		return {
			input: {
				name: form.name.trim(),
				kind: form.kind,
				automationMode: form.automationMode,
				defaultSegmentKind: form.defaultSegmentKind,
				latitude: lat,
				longitude: lon,
				radiusMeters: radius,
				confirmAfterSeconds: minutes * 60
			}
		};
	}

	async function save(event: Event) {
		event.preventDefault();
		if (pending || !editing) return;
		formError = '';
		const result = build();
		if ('errors' in result) {
			errors = result.errors;
			return;
		}
		errors = {};
		pending = true;
		try {
			if (editing === 'new') await api.createPlace(result.input);
			else await api.updatePlace(editing.id, result.input);
			notice = editing === 'new' ? t('places.created') : t('places.updated');
			editing = null;
			await refresh();
		} catch (e) {
			formError = errorMessage(e);
		} finally {
			pending = false;
		}
	}

	async function archive(place: Place) {
		if (pending) return;
		pending = true;
		try {
			await api.archivePlace(place.id);
			archiving = null;
			notice = t('places.archived');
			await refresh();
		} catch (e) {
			notice = '';
			formError = errorMessage(e);
		} finally {
			pending = false;
		}
	}
</script>

<PageHeader title={t('places.title')} description={t('places.description')} />

{#if load.status === 'loading'}
	<p class="text-sm text-muted-foreground">{t('common.loading')}</p>
{:else if load.status === 'unavailable'}
	<Unavailable />
{:else if load.status === 'error'}
	<Alert variant="destructive">{load.message}</Alert>
{:else}
	<div class="flex flex-col gap-4">
		{#if notice}<Alert variant="success">{notice}</Alert>{/if}
		{#if formError && editing === null}<Alert variant="destructive">{formError}</Alert>{/if}
		<Alert>{t('places.automation_note')}</Alert>

		{#if places.length === 0 && editing === null}
			<p class="text-sm text-muted-foreground">{t('places.empty')}</p>
		{/if}

		<ul class="flex flex-col gap-3" data-testid="place-list">
			{#each places as place (place.id)}
				<li>
					<Card>
						<CardHeader>
							<CardTitle class="flex flex-wrap items-center gap-2">
								{place.name}
								<Badge variant="outline">{placeKindLabel(place.kind)}</Badge>
								<Badge variant={place.automationMode === 'off' ? 'secondary' : 'default'}>{t('places.automation_badge', { mode: automationLabel(place.automationMode) })}</Badge>
							</CardTitle>
							<CardDescription>
								{t('places.default_kind_value', { kind: kindLabel(place.defaultSegmentKind ?? 'work') })}
								{#if place.latitude != null && place.longitude != null}
									· {place.latitude}, {place.longitude}{#if place.radiusMeters} · {place.radiusMeters} m{/if}
								{/if}
							</CardDescription>
						</CardHeader>
						<CardContent class="flex flex-col gap-3">
							<div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
								<span>{t('places.id')}</span>
								<code class="break-all rounded bg-muted px-1.5 py-0.5">{place.id}</code>
								<CopyButton text={place.id} />
							</div>
							{#if archiving === place.id}
								<div class="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
									<p>{t('places.archive_text')}</p>
									<div class="flex gap-2">
										<Button variant="destructive" size="sm" onclick={() => archive(place)} disabled={pending}>{t('places.archive_confirm')}</Button>
										<Button variant="outline" size="sm" onclick={() => (archiving = null)}>{t('common.cancel')}</Button>
									</div>
								</div>
							{:else}
								<div class="flex gap-2">
									<Button variant="outline" size="sm" onclick={() => edit(place)}>{t('places.edit')}</Button>
									<Button variant="ghost" size="sm" onclick={() => (archiving = place.id)}>{t('places.archive')}</Button>
								</div>
							{/if}
						</CardContent>
					</Card>
				</li>
			{/each}
		</ul>

		{#if editing !== null}
			<Card>
				<CardHeader><CardTitle>{editing === 'new' ? t('places.new') : t('places.edit_title')}</CardTitle></CardHeader>
				<CardContent>
					<form class="flex flex-col gap-4" onsubmit={save} novalidate aria-label={editing === 'new' ? t('places.new') : t('places.edit_title')}>
						{#if formError}<Alert variant="destructive">{formError}</Alert>{/if}
						<div class="grid gap-3 sm:grid-cols-2">
							<Field id="place-name" label={t('places.name')} bind:value={form.name} error={errors.name} maxlength={80} disabled={pending} required />
							<div class="flex flex-col gap-1.5">
								<Label for="place-kind">{t('places.kind')}</Label>
								<Select id="place-kind" bind:value={form.kind} disabled={pending}>
									{#each PLACE_KINDS as option (option)}<option value={option}>{placeKindLabel(option)}</option>{/each}
								</Select>
							</div>
							<div class="flex flex-col gap-1.5">
								<Label for="place-mode">{t('places.automation')}</Label>
								<Select id="place-mode" bind:value={form.automationMode} disabled={pending}>
									{#each AUTOMATION_MODES as option (option)}<option value={option}>{automationLabel(option)}</option>{/each}
								</Select>
								<p class="text-xs text-muted-foreground">{t(`automation_hint.${form.automationMode}`)}</p>
							</div>
							<div class="flex flex-col gap-1.5">
								<Label for="place-default-kind">{t('places.default_kind')}</Label>
								<Select id="place-default-kind" bind:value={form.defaultSegmentKind} disabled={pending}>
									{#each SEGMENT_KINDS as option (option)}<option value={option}>{kindLabel(option)}</option>{/each}
								</Select>
							</div>
							<Field id="place-lat" label={t('places.latitude')} inputmode="decimal" bind:value={form.latitude} error={errors.latitude} disabled={pending} />
							<Field id="place-lon" label={t('places.longitude')} inputmode="decimal" bind:value={form.longitude} error={errors.longitude} disabled={pending} />
							<Field id="place-radius" label={t('places.radius')} hint={t('places.radius_hint')} inputmode="numeric" bind:value={form.radiusMeters} error={errors.radiusMeters} disabled={pending} />
							<Field id="place-confirm" label={t('places.confirm_after')} hint={t('places.confirm_after_hint')} inputmode="numeric" bind:value={form.confirmMinutes} error={errors.confirmMinutes} disabled={pending} />
						</div>
						<div class="flex gap-2">
							<Button type="submit" disabled={pending}>{t('common.save')}</Button>
							<Button type="button" variant="outline" onclick={() => (editing = null)} disabled={pending}>{t('common.cancel')}</Button>
						</div>
					</form>
				</CardContent>
			</Card>
		{:else}
			<div><Button onclick={() => edit('new')}>{t('places.new')}</Button></div>
		{/if}
	</div>
{/if}
