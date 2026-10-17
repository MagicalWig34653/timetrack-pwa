<script lang="ts">
	import { api } from '#lib/api/client.js';
	import type { TimeAccount, WorkModel } from '#lib/api/types.js';
	import Panel from '#lib/components/app/Panel.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button, buttonVariants } from '#lib/components/ui/button/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { formatDateNumeric } from '#lib/time/dates.js';
	import { formatDuration } from '#lib/time/format.js';
	import { buildWorkModelInput, defaultWorkModelForm, formFromModel, type WorkModelFormErrors, type WorkModelFormValues } from '#lib/time/work-model-form.js';
	import { zoneStore } from '#lib/time/zone.svelte.js';
	import { untrack } from 'svelte';
	import Field from '#lib/components/app/Field.svelte';
	import { canCreateModel, modelStartHint } from '#lib/transfer/worktime-flow.js';

	/**
	 * The ONE next step after a work-time import: create the work model from the first day of the table, so that the app knows the
	 * target hours. Failure keeps everything as it is and offers "Erneut versuchen"; success shows the time account against the table.
	 */
	let {
		firstDate,
		initialModels,
		sheetBalanceSeconds,
		continueHref
	}: { firstDate: string; initialModels: WorkModel[] | null; sheetBalanceSeconds: number | null; continueHref: string } = $props();

	// the parent mounts this component once per result; the model list is read once and refreshed after a successful creation
	let models = $state<WorkModel[]>(untrack(() => [...(initialModels ?? [])]));
	let status = $state<'idle' | 'creating' | 'done'>('idle');
	let failure = $state('');
	let attempted = $state(false);
	let errors = $state<WorkModelFormErrors>({});
	let account = $state<TimeAccount | null>(null);
	let accountFailed = $state(false);

	const hint = $derived(modelStartHint(firstDate, models));
	const creatable = $derived(canCreateModel(hint));
	/** values of the newest existing version, else the defaults; only the weekly target is edited here */
	let form = $state<WorkModelFormValues>(
		untrack(() => {
			const newest = [...(initialModels ?? [])].sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];
			return newest ? formFromModel(newest, firstDate) : defaultWorkModelForm(firstDate, zoneStore.value);
		})
	);

	const fmtSigned = (seconds: number) => `${seconds < 0 ? '-' : '+'}${formatDuration(Math.abs(seconds))}`;
	const settingsHref = $derived(`/settings/work-model?validFrom=${firstDate}`);
	const settled = $derived(status === 'done' || hint?.kind === 'ok');

	async function loadAccount() {
		accountFailed = false;
		try {
			account = await api.getTimeAccount();
		} catch {
			accountFailed = true;
		}
	}

	$effect(() => {
		if (settled && !account && !accountFailed) void loadAccount();
	});

	async function create() {
		if (status === 'creating') return;
		attempted = true;
		failure = '';
		const built = buildWorkModelInput({ ...form, validFrom: firstDate });
		if ('errors' in built) {
			errors = built.errors;
			return;
		}
		errors = {};
		status = 'creating';
		try {
			await api.createWorkModel(built.input);
			models = await api.listWorkModels();
			account = null;
			status = 'done';
		} catch (e) {
			status = 'idle';
			failure = errorMessage(e);
		}
	}
</script>

<Panel title={t('worktime.next_title')} data-testid="wt-next-step">
	<div class="flex flex-col gap-4 text-sm" data-testid="wt-model-start" data-kind={status === 'done' ? 'done' : (hint?.kind ?? 'none')}>
		{#if status === 'done'}
			<Alert variant="success" data-testid="wt-model-done">{t('worktime.next_done', { date: formatDateNumeric(firstDate) })}</Alert>
		{:else if hint?.kind === 'ok'}
			<p data-testid="wt-model-ok">{t('worktime.next_ok', { modelFrom: formatDateNumeric(hint.modelFrom) })}</p>
		{:else if hint?.kind === 'late'}
			<p>{t('worktime.next_late', { modelFrom: formatDateNumeric(hint.modelFrom), date: formatDateNumeric(firstDate) })}</p>
		{:else if creatable}
			<div>
				<p class="text-base font-medium">{t('worktime.next_create', { date: formatDateNumeric(firstDate) })}</p>
				<p class="mt-1 text-muted-foreground" data-testid="wt-next-why">{t('worktime.next_why')}</p>
				{#if hint?.kind === 'earlier' && !hint.beforeWeek}
					<p class="mt-1 text-[13px] text-muted-foreground">{t('worktime.model_start_midweek', { days: hint.emptyDays })}</p>
				{/if}
			</div>
			<div class="max-w-sm">
				<Field id="wt-next-weekly" label={t('worktime.next_weekly')} hint={t('worktime.next_weekly_hint')} placeholder="38:30" inputmode="numeric" bind:value={form.weeklyTarget} error={errors.weeklyTarget} disabled={status === 'creating'} />
			</div>
			{#if failure}
				<Alert variant="destructive" data-testid="wt-model-error">
					<p>{t('worktime.next_failed', { reason: failure })}</p>
					<p class="mt-1 text-[13px]">{t('worktime.next_failed_keep')}</p>
				</Alert>
			{/if}
			<div class="flex flex-wrap items-center gap-3">
				<Button type="button" onclick={create} disabled={status === 'creating'} data-testid="wt-model-create">
					{status === 'creating' ? t('worktime.next_creating') : failure && attempted ? t('worktime.next_retry') : t('worktime.next_create', { date: formatDateNumeric(firstDate) })}
				</Button>
				{#if failure}<a class={buttonVariants({ variant: 'ghost', size: 'sm' })} href={settingsHref} data-testid="wt-model-start-link">{t('worktime.next_settings')}</a>{/if}
			</div>
		{/if}

		{#if hint?.kind === 'late'}
			<div><a class={buttonVariants()} href={settingsHref} data-testid="wt-model-start-link">{t('worktime.next_settings')}</a></div>
		{/if}

		{#if settled}
			{#if sheetBalanceSeconds != null && account}
				<div class="rounded-lg border bg-muted/40 p-3" data-testid="wt-compare">
					<p class="font-medium">{t('worktime.result_compare_title')}</p>
					<p class="mt-1">{t('worktime.result_compare_text', { sheet: fmtSigned(sheetBalanceSeconds), app: fmtSigned(account.balanceSeconds) })}</p>
					<p class="mt-1 text-[13px] text-muted-foreground">{t('worktime.result_compare_note')}</p>
				</div>
			{/if}
			<div><a class={buttonVariants()} href={continueHref} data-testid="wt-continue">{t('worktime.next_continue')}</a></div>
		{/if}
	</div>
</Panel>
