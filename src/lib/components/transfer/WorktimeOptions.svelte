<script lang="ts">
	import type { ImportTemplate, WorktimeAction, WorktimePreview } from '#lib/api/types.js';
	import StatusChip from '#lib/components/app/StatusChip.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Select } from '#lib/components/ui/select/index.js';
	import { t, type MessageKey } from '#lib/i18n/index.js';
	import { moveRule, removeRule, WORKTIME_ACTIONS } from '#lib/transfer/worktime.js';
	import { worktimeIssues, type WorktimeForm } from '#lib/transfer/worktime-flow.js';
	import { ArrowDown, ArrowUp, ChevronRight, Plus, Trash2 } from '@lucide/svelte';
	import OptionRadio from './OptionRadio.svelte';
	import TemplatesPanel from './TemplatesPanel.svelte';

	/**
	 * Every option of the work-time import in ONE collapsed section below the primary button. Each option has a plain sentence,
	 * an example and the recommendation; technical options sit in the second-level "Expertenoptionen".
	 */
	let {
		form = $bindable(),
		open = $bindable(false),
		changed,
		worktime,
		sheets,
		templates,
		templatesUnavailable,
		busy,
		onapply,
		onsave,
		ondelete,
		onresetrules,
		onreset
	}: {
		form: WorktimeForm;
		open?: boolean;
		/** at least one option differs from the recommendation */
		changed: boolean;
		worktime: WorktimePreview | undefined;
		sheets: string[];
		templates: ImportTemplate[];
		templatesUnavailable: boolean;
		busy: boolean;
		onapply: (template: ImportTemplate) => void;
		onsave: (name: string) => void;
		ondelete: (template: ImportTemplate) => void;
		onresetrules: () => void;
		onreset: () => void;
	} = $props();

	const issues = $derived(worktimeIssues(form));
	const actionLabel = (action: WorktimeAction) => t(`worktime.action.${action}` as MessageKey);
	const issueText = (issue: ReturnType<typeof worktimeIssues>[number]) =>
		issue.kind === 'pause'
			? t('worktime.issue.pause')
			: issue.kind === 'pause_start'
				? t('worktime.issue.pause_start')
				: t(`worktime.issue.${issue.issue}` as MessageKey, { number: issue.index + 1 });
	const ruleHasIssue = (index: number) => issues.some((i) => i.kind === 'rule' && i.index === index);
	const dateSystem = $derived(worktime?.dateSystem ? t(`worktime.date_system_${worktime.dateSystem}` as MessageKey) : '–');
</script>

<details class="group rounded-[10px] border bg-card" bind:open data-testid="wt-customize">
	<summary class="flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-[10px] px-[17px] py-3 text-[15px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
		<ChevronRight class="size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />
		<span>{t('worktime.customize_title')}</span>
		{#if changed}<StatusChip tone="accent">{t('worktime.customize_changed')}</StatusChip>{/if}
	</summary>

	<div class="flex flex-col gap-6 border-t px-[17px] py-5" data-testid="worktime-step">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<p class="max-w-prose text-sm text-muted-foreground">{t('worktime.customize_intro')}</p>
			<Button type="button" variant="outline" size="sm" onclick={onreset} disabled={busy || !changed} data-testid="wt-reset">{t('worktime.customize_reset')}</Button>
		</div>

		{#if issues.length > 0}
			<Alert variant="destructive" data-testid="mapping-issues">
				<p class="font-medium">{t('worktime.issues_title')}</p>
				<ul class="mt-1 list-disc pl-5">
					{#each issues as issue, i (i)}<li>{issueText(issue)}</li>{/each}
				</ul>
			</Alert>
		{/if}

		<fieldset class="flex flex-col gap-2">
			<legend class="mb-1 text-sm font-medium">{t('worktime.pause_mode')}</legend>
			<OptionRadio name="wt-pause-mode" value="split" bind:group={form.pauseMode} label={t('worktime.pause_mode_split')} text={t('worktime.pause_mode_split_text')} example={t('worktime.pause_mode_split_example')} testid="wt-pause-split" />
			<OptionRadio name="wt-pause-mode" value="none" bind:group={form.pauseMode} label={t('worktime.pause_mode_none')} text={t('worktime.pause_mode_none_text')} example={t('worktime.pause_mode_none_example')} testid="wt-pause-none" />
		</fieldset>

		<div class="grid gap-4 sm:grid-cols-2">
			<div class="flex flex-col gap-1.5">
				<Label for="wt-pause-source">{t('worktime.pause_source')}</Label>
				<Select id="wt-pause-source" bind:value={form.pauseSource}>
					<option value="table">{t('worktime.pause_source_table')}</option>
					<option value="override">{t('worktime.pause_source_override')}</option>
				</Select>
				<p class="text-[13px] text-muted-foreground">{t('worktime.pause_source_text')}</p>
				<p class="text-[13px] text-muted-foreground">{t('worktime.example', { text: t('worktime.pause_source_example') })}</p>
			</div>
			{#if form.pauseSource === 'override'}
				<div class="flex flex-col gap-1.5">
					<Label for="wt-pause-minutes">{t('worktime.pause_minutes')}</Label>
					<Input id="wt-pause-minutes" type="text" inputmode="numeric" bind:value={form.pauseMinutes} />
					<p class="text-[13px] text-muted-foreground">{t('worktime.pause_minutes_hint')}</p>
				</div>
			{/if}
			{#if form.pauseMode === 'split'}
				<div class="flex flex-col gap-1.5">
					<Label for="wt-pause-start">{t('worktime.pause_start')}</Label>
					<Input id="wt-pause-start" type="time" bind:value={form.pauseStart} />
					<p class="text-[13px] text-muted-foreground">{t('worktime.pause_start_hint')}</p>
					<p class="text-[13px] text-muted-foreground">{t('worktime.example', { text: t('worktime.pause_start_example') })}</p>
				</div>
			{/if}
		</div>

		<label class="flex items-start gap-3 text-sm">
			<Checkbox id="wt-round" class="mt-0.5" bind:checked={form.roundToMinutes} />
			<span>
				<span class="block font-medium">{t('worktime.round')}</span>
				<span class="mt-0.5 block text-[13px] text-muted-foreground">{t('worktime.round_hint')}</span>
				<span class="mt-1 block text-[13px] text-muted-foreground">{t('worktime.example', { text: t('worktime.round_example') })}</span>
			</span>
		</label>

		<div class="flex flex-col gap-6" data-testid="wt-day-options">
			<fieldset class="flex flex-col gap-2">
				<legend class="text-sm font-medium">{t('worktime.holiday_times')}</legend>
				<p class="mb-1 text-[13px] text-muted-foreground">{t('worktime.holiday_times_text')}</p>
				<OptionRadio name="wt-holiday-times" value="discard" bind:group={form.holidayTimes} label={t('worktime.holiday_times_discard')} text={t('worktime.holiday_times_discard_text')} example={t('worktime.holiday_times_discard_example')} testid="wt-holiday-discard" />
				<OptionRadio name="wt-holiday-times" value="keep" bind:group={form.holidayTimes} label={t('worktime.holiday_times_keep')} text={t('worktime.holiday_times_keep_text')} example={t('worktime.holiday_times_keep_example')} testid="wt-holiday-keep" />
			</fieldset>

			<fieldset class="flex flex-col gap-2">
				<legend class="text-sm font-medium">{t('worktime.partial_credit')}</legend>
				<p class="mb-1 text-[13px] text-muted-foreground">{t('worktime.partial_credit_text')}</p>
				<OptionRadio name="wt-partial-credit" value="work" bind:group={form.partialCredit} label={t('worktime.partial_credit_work')} text={t('worktime.partial_credit_work_text')} example={t('worktime.partial_credit_work_example')} testid="wt-credit-work" />
				<OptionRadio name="wt-partial-credit" value="absence" bind:group={form.partialCredit} label={t('worktime.partial_credit_absence')} text={t('worktime.partial_credit_absence_text')} example={t('worktime.partial_credit_absence_example')} testid="wt-credit-absence" />
			</fieldset>
		</div>

		<details class="group/expert rounded-lg border" data-testid="wt-expert">
			<summary class="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
				<ChevronRight class="size-4 shrink-0 transition-transform group-open/expert:rotate-90" aria-hidden="true" />
				{t('worktime.expert_title')}
			</summary>
			<div class="flex flex-col gap-6 border-t p-3">
				<p class="text-[13px] text-muted-foreground">{t('worktime.expert_intro')}</p>

				<section class="flex flex-col gap-3" aria-labelledby="wt-rules-heading">
					<h4 id="wt-rules-heading" class="text-sm font-medium">{t('worktime.rules_title')}</h4>
					<p class="text-[13px] text-muted-foreground" data-testid="wt-rules-intro">{t('worktime.rules_intro')}</p>
					<p class="text-[13px] text-muted-foreground">{t('worktime.example', { text: t('worktime.rules_example') })}</p>
					<Alert data-testid="wt-rules-absence-note">{t('worktime.rules_absence_note')}</Alert>
					<p class="text-[13px] text-muted-foreground">{t('worktime.rules_pattern_hint')}</p>

					{#if form.rules.length === 0}
						<p class="text-sm text-muted-foreground" data-testid="wt-rules-empty">{t('worktime.rules_empty')}</p>
					{/if}
					<ol class="flex flex-col gap-2" data-testid="wt-rules">
						{#each form.rules as rule, index (index)}
							<li class="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_14rem_auto] sm:items-end" data-testid="wt-rule" aria-label={t('worktime.rule_row', { number: index + 1 })}>
								<div class="flex flex-col gap-1.5">
									<Label for="wt-rule-pattern-{index}">{t('worktime.rule_pattern')}</Label>
									<Input id="wt-rule-pattern-{index}" bind:value={rule.pattern} maxlength={80} autocomplete="off" aria-invalid={ruleHasIssue(index) ? true : undefined} />
								</div>
								<div class="flex flex-col gap-1.5">
									<Label for="wt-rule-action-{index}">{t('worktime.rule_action')}</Label>
									<Select id="wt-rule-action-{index}" bind:value={rule.action}>
										{#each WORKTIME_ACTIONS as action (action)}<option value={action}>{actionLabel(action)}</option>{/each}
									</Select>
								</div>
								<div class="flex gap-1">
									<Button type="button" variant="outline" size="icon" disabled={index === 0} aria-label={t('worktime.rule_up', { number: index + 1 })} onclick={() => (form.rules = moveRule(form.rules, index, -1))}><ArrowUp /></Button>
									<Button type="button" variant="outline" size="icon" disabled={index === form.rules.length - 1} aria-label={t('worktime.rule_down', { number: index + 1 })} onclick={() => (form.rules = moveRule(form.rules, index, 1))}><ArrowDown /></Button>
									<Button type="button" variant="outline" size="icon" aria-label={t('worktime.rule_remove', { number: index + 1 })} onclick={() => (form.rules = removeRule(form.rules, index))}><Trash2 /></Button>
								</div>
							</li>
						{/each}
					</ol>
					<div class="flex flex-wrap gap-2">
						<Button type="button" variant="outline" size="sm" onclick={() => (form.rules = [...form.rules, { pattern: '', action: 'work' }])} data-testid="wt-rule-add"><Plus />{t('worktime.rule_add')}</Button>
						<Button type="button" variant="ghost" size="sm" onclick={onresetrules} disabled={busy} data-testid="wt-rules-reset">{t('worktime.rules_reset')}</Button>
					</div>
					<p class="text-[13px] text-muted-foreground">{t('worktime.action_text.holiday')}</p>
				</section>

				<section aria-labelledby="wt-date-system-heading">
					<h4 id="wt-date-system-heading" class="text-sm font-medium">{t('worktime.date_system_title')}</h4>
					<p class="mt-1 text-[13px] text-muted-foreground">{t('worktime.date_system_text')}</p>
					<p class="mt-1 text-[13px] text-muted-foreground" data-testid="wt-date-system-expert">{t('worktime.example', { text: t('worktime.date_system_example', { system: dateSystem }) })}</p>
				</section>

				<section aria-labelledby="wt-sheets-heading">
					<h4 id="wt-sheets-heading" class="text-sm font-medium">{t('worktime.sheets_title')}</h4>
					<p class="mt-1 text-[13px] text-muted-foreground">{t('worktime.sheets_text')}</p>
					<p class="mt-1 text-[13px] text-muted-foreground">{t('worktime.example', { text: t('worktime.sheets_example', { names: sheets.join(', ') }) })}</p>
				</section>

				<TemplatesPanel {templates} {templatesUnavailable} {busy} {onapply} {onsave} {ondelete} title={t('worktime.templates_title')} text={t('worktime.templates_text')} bare />
			</div>
		</details>
	</div>
</details>
