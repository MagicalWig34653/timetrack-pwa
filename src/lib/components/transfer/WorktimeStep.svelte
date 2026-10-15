<script lang="ts">
	import type { ImportTemplate, WorktimeAction } from '#lib/api/types.js';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Select } from '#lib/components/ui/select/index.js';
	import { t, type MessageKey } from '#lib/i18n/index.js';
	import { moveRule, removeRule, WORKTIME_ACTIONS } from '#lib/transfer/worktime.js';
	import { worktimeIssues, type WorktimeForm } from '#lib/transfer/worktime-flow.js';
	import { ArrowDown, ArrowUp, Plus, Trash2 } from '@lucide/svelte';
	import TemplatesPanel from './TemplatesPanel.svelte';

	let {
		form = $bindable(),
		templates,
		templatesUnavailable,
		busy,
		showIssues,
		onapply,
		onsave,
		ondelete,
		onresetrules,
		onsubmit,
		onback
	}: {
		form: WorktimeForm;
		templates: ImportTemplate[];
		templatesUnavailable: boolean;
		busy: boolean;
		showIssues: boolean;
		onapply: (template: ImportTemplate) => void;
		onsave: (name: string) => void;
		ondelete: (template: ImportTemplate) => void;
		onresetrules: () => void;
		onsubmit: () => void;
		onback: () => void;
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
</script>

<div class="flex flex-col gap-6" data-testid="worktime-step">
	<p class="text-sm text-muted-foreground">{t('import.profile_text')}</p>

	<TemplatesPanel {templates} {templatesUnavailable} {busy} {onapply} {onsave} {ondelete} />

	<section class="flex flex-col gap-4 rounded-lg border p-4" aria-labelledby="wt-options-heading">
		<h4 id="wt-options-heading" class="text-sm font-medium">{t('worktime.options_title')}</h4>

		<fieldset class="flex flex-col gap-2">
			<legend class="mb-1 text-sm font-medium">{t('worktime.pause_mode')}</legend>
			<label class="flex items-start gap-2 text-sm">
				<input type="radio" class="mt-0.5 size-4 accent-primary" name="wt-pause-mode" value="split" bind:group={form.pauseMode} data-testid="wt-pause-split" />
				<span>{t('worktime.pause_mode_split')}<span class="block text-xs text-muted-foreground">{t('worktime.pause_mode_split_text')}</span></span>
			</label>
			<label class="flex items-start gap-2 text-sm">
				<input type="radio" class="mt-0.5 size-4 accent-primary" name="wt-pause-mode" value="none" bind:group={form.pauseMode} data-testid="wt-pause-none" />
				<span>{t('worktime.pause_mode_none')}<span class="block text-xs text-muted-foreground">{t('worktime.pause_mode_none_text')}</span></span>
			</label>
		</fieldset>

		<div class="grid gap-3 sm:grid-cols-2">
			<div class="flex flex-col gap-1.5">
				<Label for="wt-pause-source">{t('worktime.pause_source')}</Label>
				<Select id="wt-pause-source" bind:value={form.pauseSource}>
					<option value="table">{t('worktime.pause_source_table')}</option>
					<option value="override">{t('worktime.pause_source_override')}</option>
				</Select>
			</div>
			{#if form.pauseSource === 'override'}
				<div class="flex flex-col gap-1.5">
					<Label for="wt-pause-minutes">{t('worktime.pause_minutes')}</Label>
					<Input id="wt-pause-minutes" type="number" min={0} max={240} inputmode="numeric" bind:value={form.pauseMinutes} />
					<p class="text-xs text-muted-foreground">{t('worktime.pause_minutes_hint')}</p>
				</div>
			{/if}
			{#if form.pauseMode === 'split'}
				<div class="flex flex-col gap-1.5">
					<Label for="wt-pause-start">{t('worktime.pause_start')}</Label>
					<Input id="wt-pause-start" type="time" bind:value={form.pauseStart} />
					<p class="text-xs text-muted-foreground">{t('worktime.pause_start_hint')}</p>
				</div>
			{/if}
		</div>

		<label class="flex items-start gap-2 text-sm">
			<Checkbox id="wt-round" class="mt-0.5" bind:checked={form.roundToMinutes} />
			<span>{t('worktime.round')}<span class="block text-xs text-muted-foreground">{t('worktime.round_hint')}</span></span>
		</label>
	</section>

	<section class="flex flex-col gap-3 rounded-lg border p-4" aria-labelledby="wt-rules-heading">
		<h4 id="wt-rules-heading" class="text-sm font-medium">{t('worktime.rules_title')}</h4>
		<p class="text-sm text-muted-foreground" data-testid="wt-rules-intro">{t('worktime.rules_intro')}</p>
		<Alert data-testid="wt-rules-absence-note">{t('worktime.rules_absence_note')}</Alert>
		<p class="text-xs text-muted-foreground">{t('worktime.rules_pattern_hint')}</p>

		{#if form.rules.length === 0}
			<p class="text-sm text-muted-foreground" data-testid="wt-rules-empty">{t('worktime.rules_empty')}</p>
		{/if}
		<ol class="flex flex-col gap-2" data-testid="wt-rules">
			{#each form.rules as rule, index (index)}
				<li class="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_14rem_auto] sm:items-end" data-testid="wt-rule" aria-label={t('worktime.rule_row', { number: index + 1 })}>
					<div class="flex flex-col gap-1.5">
						<Label for="wt-rule-pattern-{index}">{t('worktime.rule_pattern')}</Label>
						<Input id="wt-rule-pattern-{index}" bind:value={rule.pattern} maxlength={80} autocomplete="off" aria-invalid={showIssues && ruleHasIssue(index) ? true : undefined} />
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
		<p class="text-xs text-muted-foreground">{t('worktime.action_text.holiday')}</p>
	</section>

	{#if showIssues && issues.length > 0}
		<Alert variant="destructive" data-testid="mapping-issues">
			<ul class="list-disc pl-5">
				{#each issues as issue, i (i)}<li>{issueText(issue)}</li>{/each}
			</ul>
		</Alert>
	{/if}

	<div class="flex flex-wrap gap-2">
		<Button type="button" variant="outline" onclick={onback} disabled={busy}>{t('common.back')}</Button>
		<Button type="button" onclick={onsubmit} disabled={busy} data-testid="wt-validate">{busy ? t('import.validating') : t('import.validate')}</Button>
	</div>
</div>
