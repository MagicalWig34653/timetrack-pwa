<script lang="ts">
	import { goto } from '$app/navigation';
	import { api } from '#lib/api/client.js';
	import { MODULE_KEYS, type ModuleKey, type VacationSettings, type WorkModel } from '#lib/api/types.js';
	import Field from '#lib/components/app/Field.svelte';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import Panel from '#lib/components/app/Panel.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Select } from '#lib/components/ui/select/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import { errorMessage, t, type MessageKey } from '#lib/i18n/index.js';
	import { moduleStore } from '#lib/modules/store.svelte.js';
	import { buildModelPlan, buildVacationPlan, dailyTargetSeconds, initialDraft, visibleSteps, type SetupDraft, type StepId } from '#lib/onboarding/plan.js';
	import { REGIONS, regionName } from '#lib/planning/regions.js';
	import { sessionStore } from '#lib/session.svelte.js';
	import { formatDateNumeric, todayLocal } from '#lib/time/dates.js';
	import { formatDuration, parseDuration } from '#lib/time/format.js';
	import { weekdayLabel } from '#lib/time/labels.js';
	import type { WorkModelFormErrors } from '#lib/time/work-model-form.js';
	import { zoneStore } from '#lib/time/zone.svelte.js';
	import { formatHalfDays } from '#lib/vacation/halfdays.js';
	import { onMount } from 'svelte';

	let ready = $state(false);
	let loadError = $state('');
	let draft = $state<SetupDraft | null>(null);
	let existingModel = $state(false);
	let currentVacation = $state<VacationSettings | null>(null);
	let stepIndex = $state(0);
	let modelErrors = $state<WorkModelFormErrors>({});
	let vacationErrors = $state<{ days?: string; snapshot?: string }>({});
	let saving = $state(false);
	let saveError = $state('');
	/** parts already stored by an earlier, partly failed attempt; retrying does not repeat them */
	let stored = $state<Set<string>>(new Set());

	const steps = $derived(visibleSteps(moduleStore.statuses));
	const step = $derived<StepId>(steps[Math.min(stepIndex, steps.length - 1)]);
	const offerable = $derived((moduleStore.statuses ?? []).filter((s) => s.serverEnabled && !s.lockedByOperator));
	const weekly = $derived(draft ? parseDuration(draft.model.weeklyTarget) : null);
	const daily = $derived(draft ? dailyTargetSeconds(weekly, draft.model.workdays.length) : null);

	onMount(async () => {
		try {
			const zone = await zoneStore.ensure();
			const [models, vacation] = await Promise.all([
				api.listWorkModels(),
				moduleStore.enabled('planning') ? api.getVacationSettings().catch(() => null) : Promise.resolve(null)
			]);
			const newest = [...models].sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0] as WorkModel | undefined;
			existingModel = !!newest;
			currentVacation = vacation;
			draft = initialDraft(todayLocal(zone), zone, newest, vacation);
			ready = true;
		} catch (e) {
			loadError = errorMessage(e);
		}
	});

	function toggleWorkday(day: number, on: boolean) {
		if (!draft) return;
		draft.model.workdays = on ? [...draft.model.workdays, day] : draft.model.workdays.filter((d) => d !== day);
	}

	/** Validates the current step before leaving it forward. */
	function validate(): boolean {
		if (!draft) return false;
		if (step === 'model' && !draft.skipped.model) {
			const plan = buildModelPlan(draft.model);
			// breaks and school are validated on their own steps, here only the fields of this step count
			const own = 'errors' in plan ? Object.fromEntries(Object.entries(plan.errors).filter(([k]) => ['validFrom', 'timezone', 'weeklyTarget', 'workdays', 'roundingMinutes', 'dayBoundaryMinutes'].includes(k))) : {};
			modelErrors = own;
			return Object.keys(own).length === 0;
		}
		if (step === 'breaks' && !draft.skipped.model) {
			const plan = buildModelPlan(draft.model);
			modelErrors = 'errors' in plan && plan.errors.fixedBreaks ? { fixedBreaks: plan.errors.fixedBreaks } : {};
			return Object.keys(modelErrors).length === 0;
		}
		if (step === 'school' && !draft.skipped.model) {
			const plan = buildModelPlan(draft.model);
			modelErrors = 'errors' in plan ? Object.fromEntries(Object.entries(plan.errors).filter(([k]) => ['schoolThreshold', 'schoolCredit'].includes(k))) : {};
			return Object.keys(modelErrors).length === 0;
		}
		if (step === 'vacation' && !draft.skipped.vacation) {
			const plan = buildVacationPlan(draft.vacation, currentVacation, { days: t('onboarding.vacation.days_invalid'), snapshot: t('onboarding.vacation.snapshot_both') });
			vacationErrors = 'errors' in plan ? plan.errors : {};
			return !('errors' in plan);
		}
		return true;
	}

	function next() {
		if (!validate()) return;
		stepIndex = Math.min(stepIndex + 1, steps.length - 1);
	}
	function back() {
		stepIndex = Math.max(stepIndex - 1, 0);
	}
	function skip() {
		if (!draft) return;
		if (step === 'model') {
			// breaks and school belong to the work model: skipping it skips all three
			draft.skipped.model = draft.skipped.breaks = draft.skipped.school = true;
			stepIndex = steps.indexOf('vacation') >= 0 ? steps.indexOf('vacation') : steps.indexOf('modules') >= 0 ? steps.indexOf('modules') : steps.indexOf('summary');
			return;
		}
		if (step === 'vacation') draft.skipped.vacation = true;
		if (step === 'modules') draft.skipped.modules = true;
		stepIndex = Math.min(stepIndex + 1, steps.length - 1);
	}

	/** Skipping the whole setup only remembers the decision; nothing else is stored. */
	async function later() {
		saving = true;
		try {
			await api.setOnboarding('skipped');
			if (sessionStore.current) sessionStore.current = { ...sessionStore.current, account: { ...sessionStore.current.account, onboardingState: 'skipped' } };
			await goto('/');
		} catch (e) {
			saveError = errorMessage(e);
		} finally {
			saving = false;
		}
	}

	async function finish() {
		if (!draft || saving) return;
		saving = true;
		saveError = '';
		try {
			if (!draft.skipped.model && !stored.has('model')) {
				const plan = buildModelPlan(draft.model);
				if ('errors' in plan) throw new Error('invalid');
				await api.createWorkModel(plan.input);
				stored = new Set([...stored, 'model']);
			}
			if (steps.includes('vacation') && !draft.skipped.vacation) {
				const plan = buildVacationPlan(draft.vacation, currentVacation, { days: '', snapshot: '' });
				if ('errors' in plan) throw new Error('invalid');
				if (!stored.has('vacation')) {
					await api.putVacationSettings(plan.settings);
					stored = new Set([...stored, 'vacation']);
				}
				if (plan.snapshot && !stored.has('snapshot')) {
					await api.createVacationSnapshot(plan.snapshot);
					stored = new Set([...stored, 'snapshot']);
				}
			}
			if (steps.includes('modules') && !draft.skipped.modules && draft.modulesOff.length > 0 && !stored.has('modules')) {
				moduleStore.set(await api.putMyModules(Object.fromEntries(draft.modulesOff.map((key) => [key, false]))));
				stored = new Set([...stored, 'modules']);
			}
			await api.setOnboarding('completed');
			if (sessionStore.current) sessionStore.current = { ...sessionStore.current, account: { ...sessionStore.current.account, onboardingState: 'completed' } };
			await goto('/');
		} catch (e) {
			saveError = errorMessage(e);
		} finally {
			saving = false;
		}
	}

	const partLabel = (key: string) => t(`onboarding.part.${key}` as MessageKey);
	const skippedText = () => t('onboarding.summary.skipped');
</script>

<PageHeader title={t('onboarding.title')} description={t('onboarding.description')} />

{#if loadError}
	<Alert variant="destructive">{loadError}</Alert>
{:else if !ready || !draft}
	<p class="text-sm text-muted-foreground">{t('common.loading')}</p>
{:else}
	<div class="flex max-w-[720px] flex-col gap-5" data-testid="onboarding">
		<nav aria-label={t('onboarding.steps')}>
			<ol class="flex flex-wrap gap-x-4 gap-y-1 text-sm" data-testid="onboarding-steps">
				{#each steps as id, index (id)}
					<li aria-current={id === step ? 'step' : undefined} class={id === step ? 'font-semibold text-ui-accent-ink' : index < stepIndex ? 'text-foreground' : 'text-muted-foreground'}>
						{index + 1}. {t(`onboarding.step.${id}` as MessageKey)}
					</li>
				{/each}
			</ol>
		</nav>
		<p class="text-xs text-muted-foreground" data-testid="onboarding-progress">{t('onboarding.progress', { current: stepIndex + 1, total: steps.length })}</p>
		<Alert data-testid="suggestion-note">{t('onboarding.suggestion_note')}</Alert>
		{#if existingModel && step === 'model'}<Alert data-testid="repeat-note">{t('onboarding.repeat_note')}</Alert>{/if}

		{#if step === 'model'}
			<Panel title={t('onboarding.model.title')} description={t('onboarding.model.text')} data-testid="step-model">
				<div class="flex flex-col gap-5">
					<div class="grid gap-3 sm:grid-cols-2">
						<Field id="ob-from" type="date" label={t('onboarding.model.valid_from')} hint={t('onboarding.model.valid_from_hint')} bind:value={draft.model.validFrom} error={modelErrors.validFrom} />
						<Field id="ob-weekly" label={t('onboarding.model.weekly')} hint={t('onboarding.model.weekly_hint')} inputmode="numeric" placeholder="38:30" bind:value={draft.model.weeklyTarget} error={modelErrors.weeklyTarget} />
					</div>
					<fieldset class="flex flex-col gap-2">
						<legend class="mb-1 text-sm font-medium">{t('onboarding.model.workdays')}</legend>
						<div class="flex flex-wrap gap-x-4 gap-y-2">
							{#each [1, 2, 3, 4, 5, 6, 7] as day (day)}
								<div class="flex items-center gap-1.5">
									<Checkbox id="ob-day-{day}" checked={draft.model.workdays.includes(day)} onchange={(e) => toggleWorkday(day, e.currentTarget.checked)} />
									<Label for="ob-day-{day}">{weekdayLabel(day)}</Label>
								</div>
							{/each}
						</div>
						{#if modelErrors.workdays}<p class="text-xs text-destructive">{modelErrors.workdays}</p>{/if}
					</fieldset>
					<p class="text-sm" data-testid="daily-target">{daily === null ? t('onboarding.model.daily_unknown') : t('onboarding.model.daily', { duration: formatDuration(daily) })}</p>
					<fieldset class="flex flex-col gap-3">
						<legend class="mb-1 text-sm font-medium">{t('onboarding.model.rounding')}</legend>
						<div class="flex items-center gap-2">
							<Checkbox id="ob-rounding" bind:checked={draft.model.roundingEnabled} />
							<Label for="ob-rounding">{t('onboarding.model.rounding_on')}</Label>
						</div>
						{#if draft.model.roundingEnabled}
							<div class="max-w-xs"><Field id="ob-rounding-min" type="number" min="1" max="60" label={t('onboarding.model.rounding_minutes')} hint={t('onboarding.model.rounding_hint')} bind:value={draft.model.roundingMinutes} error={modelErrors.roundingMinutes} /></div>
						{/if}
					</fieldset>
					<p class="text-xs text-muted-foreground">{t('onboarding.model.skip_note')}</p>
				</div>
			</Panel>
		{:else if step === 'breaks'}
			<Panel title={t('onboarding.breaks.title')} description={t('onboarding.breaks.text')} data-testid="step-breaks">
				<div class="flex flex-col gap-3">
					{#if draft.skipped.model}<Alert>{t('onboarding.model.skip_note')}</Alert>{/if}
					{#if draft.model.fixedBreaks.length === 0}<p class="text-sm text-muted-foreground">{t('onboarding.breaks.none')}</p>{/if}
					{#each draft.model.fixedBreaks as item, index (index)}
						<div class="flex flex-wrap items-end gap-2">
							<div class="flex flex-col gap-1.5">
								<Label for="ob-break-start-{index}">{t('onboarding.breaks.start')}</Label>
								<input id="ob-break-start-{index}" type="time" bind:value={item.start} class="h-9 rounded-lg border border-input bg-transparent px-3 text-base md:text-sm dark:bg-input/30" />
							</div>
							<div class="flex flex-col gap-1.5">
								<Label for="ob-break-end-{index}">{t('onboarding.breaks.end')}</Label>
								<input id="ob-break-end-{index}" type="time" bind:value={item.end} class="h-9 rounded-lg border border-input bg-transparent px-3 text-base md:text-sm dark:bg-input/30" />
							</div>
							<Button type="button" variant="ghost" size="sm" onclick={() => draft && (draft.model.fixedBreaks = draft.model.fixedBreaks.filter((_, i) => i !== index))}>{t('onboarding.breaks.remove')}</Button>
						</div>
					{/each}
					{#if modelErrors.fixedBreaks}<p class="text-xs text-destructive">{modelErrors.fixedBreaks}</p>{/if}
					<div><Button type="button" variant="outline" size="sm" onclick={() => draft && (draft.model.fixedBreaks = [...draft.model.fixedBreaks, { start: '12:00', end: '12:30' }])}>{t('onboarding.breaks.add')}</Button></div>
				</div>
			</Panel>
		{:else if step === 'school'}
			<Panel title={t('onboarding.school.title')} description={t('onboarding.school.text')} data-testid="step-school">
				<div class="grid gap-3 sm:grid-cols-2">
					<Field id="ob-school-threshold" label={t('onboarding.school.threshold')} hint={t('onboarding.school.threshold_hint')} inputmode="numeric" placeholder="3:00" bind:value={draft.model.schoolThreshold} error={modelErrors.schoolThreshold} />
					<Field id="ob-school-credit" label={t('onboarding.school.credit')} hint={t('onboarding.school.credit_hint')} inputmode="numeric" placeholder="7:42" bind:value={draft.model.schoolCredit} error={modelErrors.schoolCredit} />
				</div>
			</Panel>
		{:else if step === 'vacation'}
			<Panel title={t('onboarding.vacation.title')} description={t('onboarding.vacation.text')} data-testid="step-vacation">
				<div class="flex flex-col gap-5">
					<div class="grid gap-3 sm:grid-cols-2">
						<Field id="ob-vac-days" label={t('onboarding.vacation.days')} hint={t('onboarding.vacation.days_hint')} inputmode="decimal" bind:value={draft.vacation.days} error={vacationErrors.days} />
						<div class="flex flex-col gap-1.5">
							<Label for="ob-vac-region">{t('onboarding.vacation.region')}</Label>
							<Select id="ob-vac-region" bind:value={draft.vacation.region}>
								{#each REGIONS as region (region.code)}<option value={region.code}>{region.name}</option>{/each}
							</Select>
							<p class="text-xs text-muted-foreground">{t('onboarding.vacation.region_hint')}</p>
						</div>
					</div>
					<fieldset class="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3">
						<legend class="px-1 text-sm font-medium">{t('onboarding.vacation.snapshot_title')}</legend>
						<p class="text-xs text-muted-foreground">{t('onboarding.vacation.snapshot_text')}</p>
						<div class="grid gap-3 sm:grid-cols-2">
							<Field id="ob-snap-date" type="date" label={t('onboarding.vacation.snapshot_date')} bind:value={draft.vacation.snapshotDate} />
							<Field id="ob-snap-days" label={t('onboarding.vacation.snapshot_days')} inputmode="decimal" bind:value={draft.vacation.snapshotDays} />
						</div>
						{#if vacationErrors.snapshot}<p class="text-xs text-destructive">{vacationErrors.snapshot}</p>{/if}
					</fieldset>
				</div>
			</Panel>
		{:else if step === 'modules'}
			<Panel title={t('onboarding.modules.title')} description={t('onboarding.modules.text')} data-testid="step-modules">
				<ul class="flex flex-col gap-3">
					{#each MODULE_KEYS.filter((key) => offerable.some((s) => s.key === key)) as key (key)}
						<li class="flex items-start justify-between gap-3">
							<div class="min-w-0">
								<p class="text-sm font-medium">{t(`module.${key}.name` as MessageKey)}</p>
								<p class="text-xs text-muted-foreground">{t(`module.${key}.desc` as MessageKey)}</p>
							</div>
							<Switch
								class="mt-0.5"
								checked={!draft.modulesOff.includes(key)}
								aria-label={t('onboarding.modules.switch', { name: t(`module.${key}.name` as MessageKey) })}
								data-testid="ob-module-{key}"
								onchange={(e) => draft && (draft.modulesOff = e.currentTarget.checked ? draft.modulesOff.filter((k) => k !== key) : [...draft.modulesOff, key as ModuleKey])}
							/>
						</li>
					{/each}
				</ul>
			</Panel>
		{:else}
			<Panel title={t('onboarding.summary.title')} description={t('onboarding.summary.text')} data-testid="step-summary">
				<dl class="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
					<dt class="text-muted-foreground">{t('onboarding.step.model')}</dt>
					<dd data-testid="sum-model">
						{#if draft.skipped.model}{skippedText()}{:else}
							{t('onboarding.summary.model', { weekly: formatDuration(weekly ?? 0), days: [...draft.model.workdays].sort((a, b) => a - b).map(weekdayLabel).join(', '), daily: daily === null ? '–' : formatDuration(daily), from: formatDateNumeric(draft.model.validFrom) })}<br />
							{draft.model.roundingEnabled ? t('onboarding.summary.rounding_on', { minutes: draft.model.roundingMinutes }) : t('onboarding.summary.rounding_off')}
						{/if}
					</dd>
					<dt class="text-muted-foreground">{t('onboarding.step.breaks')}</dt>
					<dd data-testid="sum-breaks">{draft.skipped.model ? skippedText() : draft.model.fixedBreaks.length === 0 ? t('onboarding.summary.breaks_none') : draft.model.fixedBreaks.map((b) => `${b.start}–${b.end}`).join(', ')}</dd>
					<dt class="text-muted-foreground">{t('onboarding.step.school')}</dt>
					<dd data-testid="sum-school">{draft.skipped.model ? skippedText() : t('onboarding.summary.school', { threshold: draft.model.schoolThreshold, credit: draft.model.schoolCredit.trim() || t('onboarding.summary.credit_daily') })}</dd>
					{#if steps.includes('vacation')}
						<dt class="text-muted-foreground">{t('onboarding.step.vacation')}</dt>
						<dd data-testid="sum-vacation">
							{#if draft.skipped.vacation}{skippedText()}{:else}
								{t('onboarding.summary.vacation', { days: formatHalfDays(Math.round(Number(draft.vacation.days.replace(',', '.')) * 2)), region: regionName(draft.vacation.region) })}
								{#if draft.vacation.snapshotDate}<br />{t('onboarding.summary.vacation_snapshot', { date: formatDateNumeric(draft.vacation.snapshotDate), days: draft.vacation.snapshotDays })}{/if}
							{/if}
						</dd>
					{/if}
					{#if steps.includes('modules')}
						<dt class="text-muted-foreground">{t('onboarding.step.modules')}</dt>
						<dd data-testid="sum-modules">{draft.skipped.modules || draft.modulesOff.length === 0 ? (draft.skipped.modules ? skippedText() : t('onboarding.summary.modules_all')) : t('onboarding.summary.modules', { names: draft.modulesOff.map((k) => t(`module.${k}.name` as MessageKey)).join(', ') })}</dd>
					{/if}
				</dl>
				{#if saveError}
					<Alert variant="destructive" class="mt-4" data-testid="save-error">
						<p class="font-medium">{t('onboarding.error_title')}</p>
						<p>{saveError}</p>
						{#if stored.size > 0}<p class="mt-1">{t('onboarding.done_part', { parts: [...stored].map(partLabel).join(', ') })}</p>{/if}
					</Alert>
				{/if}
			</Panel>
		{/if}

		<div class="flex flex-wrap items-center gap-2">
			{#if stepIndex > 0}<Button type="button" variant="outline" onclick={back} disabled={saving}>{t('onboarding.back')}</Button>{/if}
			{#if step === 'summary'}
				<Button type="button" onclick={finish} disabled={saving} data-testid="onboarding-finish">{saving ? t('onboarding.saving') : t('onboarding.finish')}</Button>
			{:else}
				<Button type="button" onclick={next} data-testid="onboarding-next">{t('onboarding.next')}</Button>
				{#if step === 'model' || step === 'vacation' || step === 'modules'}
					<Button type="button" variant="ghost" onclick={skip} data-testid="onboarding-skip">{t('onboarding.skip')}</Button>
				{/if}
			{/if}
			<span class="grow"></span>
			<Button type="button" variant="ghost" size="sm" onclick={later} disabled={saving} data-testid="onboarding-later">{t('onboarding.skip_all')}</Button>
		</div>
		<p class="text-xs text-muted-foreground">{t('onboarding.skip_all_hint')}</p>
	</div>
{/if}
