<script lang="ts">
	import { api } from '#lib/api/client.js';
	import type { Place, PlanDay } from '#lib/api/types.js';
	import Field from '#lib/components/app/Field.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button, type ButtonVariant } from '#lib/components/ui/button/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { moduleStore } from '#lib/modules/store.svelte.js';
	import { addDays, dayBounds, formatDateShort, zonedTimeToInstant } from '#lib/time/dates.js';
	import { lastSchoolTimes, schoolDayDefaults, schoolPlace, type SchoolTimesSource } from '#lib/time/school.js';
	import GraduationCap from '@lucide/svelte/icons/graduation-cap';

	/**
	 * "Schultag buchen" (docs/ux/schulzeit.md): always books one segment of the kind "Schule" at the school place. The times
	 * come from the plan of the day, else from the last school day (Lino 26.11.2026), and stay editable before saving.
	 */
	let {
		date,
		places,
		timeZone,
		plan = undefined,
		label = t('school.book'),
		variant = 'default',
		size = 'default',
		onsaved
	}: {
		date: string;
		places: Place[];
		timeZone: string;
		/** the plan of the day when the caller has it; undefined = load it */
		plan?: PlanDay | null;
		label?: string;
		variant?: ButtonVariant;
		size?: 'default' | 'sm';
		onsaved: (message: string) => void | Promise<void>;
	} = $props();

	let open = $state(false);
	let loading = $state(false);
	let pending = $state(false);
	let start = $state('');
	let end = $state('');
	let source = $state<SchoolTimesSource>('none');
	let lastDate = $state('');
	let error = $state('');

	const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

	async function openForm() {
		if (loading) return;
		loading = true;
		error = '';
		try {
			const [plans, recent] = await Promise.all([
				plan !== undefined ? Promise.resolve(plan ? [plan] : []) : moduleStore.enabled('planning') ? api.listPlanDays(date, date).catch(() => []) : Promise.resolve([]),
				api.listSegments(dayBounds(addDays(date, -90), timeZone).start.toISOString(), dayBounds(addDays(date, 60), timeZone).end.toISOString()).catch(() => [])
			]);
			const last = lastSchoolTimes(recent, date, timeZone);
			const defaults = schoolDayDefaults(plans[0] ?? null, last);
			start = defaults.start;
			end = defaults.end;
			source = defaults.source;
			lastDate = last?.date ?? '';
			open = true;
		} finally {
			loading = false;
		}
	}

	async function save(event: Event) {
		event.preventDefault();
		if (pending) return;
		if (!HM.test(start) || !HM.test(end) || end <= start) {
			error = t('school.book_error_times');
			return;
		}
		pending = true;
		error = '';
		try {
			await api.createSegment({
				kind: 'school',
				placeId: schoolPlace(places)?.id ?? null,
				startedAt: zonedTimeToInstant(date, start, timeZone).toISOString(),
				endedAt: zonedTimeToInstant(date, end, timeZone).toISOString()
			});
			open = false;
			await onsaved(t('school.booked', { start, end }));
		} catch (e) {
			error = errorMessage(e);
		} finally {
			pending = false;
		}
	}

	const hint = $derived(
		source === 'plan' ? t('school.book_hint_plan') : source === 'last' ? t('school.book_hint_last', { date: formatDateShort(lastDate) }) : t('school.book_hint_none')
	);
</script>

{#if open}
	<form class="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3" onsubmit={save} novalidate aria-label={t('school.book_title')} data-testid="school-book-form">
		<p class="flex items-center gap-2 text-sm font-medium"><GraduationCap class="size-4" aria-hidden="true" />{t('school.book_title')}</p>
		<p class="text-xs text-muted-foreground" data-testid="school-book-hint" data-source={source}>{hint}</p>
		{#if error}<Alert variant="destructive">{error}</Alert>{/if}
		<div class="grid grid-cols-2 gap-3 sm:max-w-xs">
			<Field id="school-start" type="time" label={t('school.book_start')} bind:value={start} disabled={pending} required />
			<Field id="school-end" type="time" label={t('school.book_end')} bind:value={end} disabled={pending} required />
		</div>
		<div class="flex flex-wrap gap-2">
			<Button type="submit" size="sm" disabled={pending} aria-busy={pending}>{t('school.book_save')}</Button>
			<Button type="button" variant="outline" size="sm" onclick={() => { open = false; error = ''; }}>{t('common.cancel')}</Button>
		</div>
	</form>
{:else}
	<Button {variant} {size} onclick={openForm} disabled={loading} aria-busy={loading} data-testid="school-book"><GraduationCap aria-hidden="true" />{label}</Button>
{/if}
