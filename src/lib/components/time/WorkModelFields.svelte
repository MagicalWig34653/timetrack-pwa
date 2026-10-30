<script lang="ts">
	import Field from '#lib/components/app/Field.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Select } from '#lib/components/ui/select/index.js';
	import type { LegalProfile } from '#lib/api/types.js';
	import { t } from '#lib/i18n/index.js';
	import { formatDuration, parseDuration } from '#lib/time/format.js';
	import { weekdayLabel } from '#lib/time/labels.js';
	import type { WorkModelFormErrors, WorkModelFormValues } from '#lib/time/work-model-form.js';

	/** All editable fields of a work model version, shared by "change from a date" and "correct this version". */
	let {
		form = $bindable(),
		errors,
		pending,
		mode,
		profiles
	}: { form: WorkModelFormValues; errors: WorkModelFormErrors; pending: boolean; mode: 'new' | 'correct'; profiles: LegalProfile[] } = $props();
	const selectedProfile = $derived(profiles.find((profile) => profile.id === form.legalProfileId));

	const dailyPreview = $derived.by(() => {
		const weekly = parseDuration(form.weeklyTarget);
		return weekly !== null && form.workdays.length > 0 ? Math.round(weekly / form.workdays.length) : null;
	});

	function toggleWorkday(day: number, checked: boolean) {
		form.workdays = checked ? [...form.workdays, day] : form.workdays.filter((d) => d !== day);
	}
</script>

<div class="flex flex-col gap-5">
	<div class="flex flex-col gap-1.5">
		<Label for="wm-legal-profile">{t('work_model.legal_profile')}</Label>
		<Select id="wm-legal-profile" bind:value={form.legalProfileId} disabled={pending || profiles.length === 0}>
			{#each profiles as profile (profile.id)}<option value={profile.id}>{profile.name}</option>{/each}
		</Select>
		<p class="text-xs text-muted-foreground">{t('work_model.legal_profile_hint')}</p>
		{#if selectedProfile}
			<p class="text-xs text-muted-foreground">{t('work_model.legal_disclaimer')}</p>
			<p class="text-xs text-muted-foreground">{t('work_model.legal_sources')}: {#each selectedProfile.sources as source (source)}<a href={source} target="_blank" rel="noopener noreferrer" class="mr-2 underline">{source}</a>{/each}</p>
		{/if}
	</div>
		<div class="grid gap-3 sm:grid-cols-2">
			<Field id="wm-from" type="date" label={t('work_model.valid_from')} hint={mode === 'correct' ? t('work_model.valid_from_correct_hint') : t('work_model.valid_from_hint')} bind:value={form.validFrom} error={errors.validFrom} disabled={pending} />
			{#if mode === 'correct'}
				<Field id="wm-to" type="date" label={t('work_model.valid_to')} hint={t('work_model.valid_to_hint')} bind:value={form.validTo} error={errors.validTo} disabled={pending} />
			{/if}
			<Field id="wm-zone" label={t('work_model.timezone')} bind:value={form.timezone} error={errors.timezone} disabled={pending} />
			<Field id="wm-weekly" label={t('work_model.weekly')} hint={dailyPreview === null ? t('work_model.weekly_hint') : t('work_model.daily_preview', { duration: formatDuration(dailyPreview) })} placeholder="38:30" inputmode="numeric" bind:value={form.weeklyTarget} error={errors.weeklyTarget} disabled={pending} />
			<Field id="wm-boundary" type="number" min="0" max="719" label={t('work_model.day_boundary_label')} hint={t('work_model.day_boundary_hint')} bind:value={form.dayBoundaryMinutes} error={errors.dayBoundaryMinutes} disabled={pending} />
		</div>

		<fieldset class="flex flex-col gap-2">
			<legend class="mb-1 text-sm font-medium">{t('work_model.workdays')}</legend>
			<div class="flex flex-wrap gap-x-4 gap-y-2">
				{#each [1, 2, 3, 4, 5, 6, 7] as day (day)}
					<div class="flex items-center gap-1.5">
						<Checkbox id="wm-day-{day}" checked={form.workdays.includes(day)} onchange={(e) => toggleWorkday(day, e.currentTarget.checked)} disabled={pending} />
						<Label for="wm-day-{day}">{weekdayLabel(day)}</Label>
					</div>
				{/each}
			</div>
			{#if errors.workdays}<p class="text-xs text-destructive">{errors.workdays}</p>{/if}
		</fieldset>

		<fieldset class="flex flex-col gap-3">
			<legend class="mb-1 text-sm font-medium">{t('work_model.rounding')}</legend>
			<div class="flex items-center gap-2">
				<Switch id="wm-rounding" bind:checked={form.roundingEnabled} disabled={pending} />
				<Label for="wm-rounding">{t('work_model.rounding_enabled')}</Label>
			</div>
			{#if form.roundingEnabled}
				<div class="max-w-xs">
					<Field id="wm-rounding-min" type="number" min="1" max="60" label={t('work_model.rounding_minutes')} hint={t('work_model.rounding_hint')} bind:value={form.roundingMinutes} error={errors.roundingMinutes} disabled={pending} />
				</div>
			{/if}
		</fieldset>

		<div class="flex items-center gap-2">
			<Switch id="wm-travel" bind:checked={form.travelCountsAsWork} disabled={pending} />
			<Label for="wm-travel">{t('work_model.travel_counts')}</Label>
		</div>

		<fieldset class="grid gap-3 sm:grid-cols-2">
			<legend class="mb-1 text-sm font-medium">{t('work_model.school')}</legend>
			<Field id="wm-school-threshold" label={t('work_model.school_threshold')} hint={t('work_model.school_threshold_hint')} placeholder="3:00" inputmode="numeric" bind:value={form.schoolThreshold} error={errors.schoolThreshold} disabled={pending} />
			<Field id="wm-school-credit" label={t('work_model.school_credit')} hint={t('work_model.school_credit_hint')} placeholder="7:42" inputmode="numeric" bind:value={form.schoolCredit} error={errors.schoolCredit} disabled={pending} />
		</fieldset>

		<fieldset class="flex flex-col gap-2">
			<legend class="mb-1 text-sm font-medium">{t('work_model.fixed_breaks')}</legend>
			<p class="text-xs text-muted-foreground">{t('work_model.fixed_breaks_hint')}</p>
			{#each form.fixedBreaks as item, index (index)}
				<div class="flex flex-wrap items-end gap-2">
					<div class="flex flex-col gap-1.5">
						<Label for="wm-break-start-{index}">{t('work_model.break_start')}</Label>
						<input id="wm-break-start-{index}" type="time" bind:value={item.start} disabled={pending} class="h-9 rounded-lg border border-input bg-transparent px-3 text-base md:text-sm dark:bg-input/30" />
					</div>
					<div class="flex flex-col gap-1.5">
						<Label for="wm-break-end-{index}">{t('work_model.break_end')}</Label>
						<input id="wm-break-end-{index}" type="time" bind:value={item.end} disabled={pending} class="h-9 rounded-lg border border-input bg-transparent px-3 text-base md:text-sm dark:bg-input/30" />
					</div>
					<Button type="button" variant="ghost" size="sm" onclick={() => (form.fixedBreaks = form.fixedBreaks.filter((_, i) => i !== index))}>{t('common.remove')}</Button>
				</div>
			{/each}
			{#if errors.fixedBreaks}<p class="text-xs text-destructive">{errors.fixedBreaks}</p>{/if}
			<div><Button type="button" variant="outline" size="sm" onclick={() => (form.fixedBreaks = [...form.fixedBreaks, { start: '12:00', end: '12:30' }])}>{t('work_model.add_break')}</Button></div>
		</fieldset>

	{#if form.dailyTargetSeconds}
		<div class="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm" data-testid="wm-daily-override">
			<span class="min-w-0 flex-1">{t('work_model.daily_override_note')}</span>
			<Button type="button" variant="outline" size="sm" onclick={() => (form.dailyTargetSeconds = undefined)} disabled={pending}>{t('work_model.daily_override_remove')}</Button>
		</div>
	{/if}
</div>
