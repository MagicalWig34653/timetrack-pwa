<script lang="ts">
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import Field from '#lib/components/app/Field.svelte';
	import type { Poll, PollAnswer, PollAnswerValue } from '#lib/api/types.js';
	import { optionTime, optionTitle } from '#lib/groups/format.js';
	import { t } from '#lib/i18n/index.js';

	/**
	 * Vote form of a public poll. Control per option depends on the poll: date + multi -> yes/maybe/no segments;
	 * single -> radio (exactly one); text + multi -> checkbox. The backend validates again (answers_invalid).
	 */
	let {
		poll,
		name = $bindable(''),
		initial = [],
		editing = false,
		busy = false,
		nameError = '',
		formError = '',
		onsubmit,
		oncancel,
		ondelete
	}: {
		poll: Poll;
		name?: string;
		initial?: PollAnswer[];
		editing?: boolean;
		busy?: boolean;
		nameError?: string;
		formError?: string;
		onsubmit: (answers: PollAnswer[]) => void;
		oncancel?: () => void;
		ondelete?: () => void;
	} = $props();

	const threeWay = $derived(poll.kind === 'date' && poll.choiceMode === 'multi');
	let choice = $state<Record<string, PollAnswerValue>>({});
	let localError = $state('');

	// (re)initialise whenever another vote is loaded into the form
	$effect(() => {
		const next: Record<string, PollAnswerValue> = {};
		for (const option of poll.options) next[option.id] = initial.find((a) => a.optionId === option.id)?.answer ?? 'no';
		choice = next;
		localError = '';
	});

	const yesCount = $derived(Object.values(choice).filter((a) => a === 'yes').length);

	function submit(event: Event) {
		event.preventDefault();
		if (busy) return;
		if (poll.choiceMode === 'single' && yesCount !== 1) return void (localError = t('groups.vote_error_single'));
		if (poll.choiceMode === 'multi' && poll.kind === 'text' && yesCount < 1) return void (localError = t('groups.vote_error_multi'));
		localError = '';
		onsubmit(poll.options.map((option) => ({ optionId: option.id, answer: choice[option.id] ?? 'no' })));
	}

	const segments: { value: PollAnswerValue; label: 'groups.answer_yes' | 'groups.answer_maybe' | 'groups.answer_no' }[] = [
		{ value: 'yes', label: 'groups.answer_yes' },
		{ value: 'maybe', label: 'groups.answer_maybe' },
		{ value: 'no', label: 'groups.answer_no' }
	];
</script>

<form class="flex flex-col gap-4" onsubmit={submit} data-testid="vote-form" novalidate>
	<Field id="vote-name" label={t('groups.your_name')} bind:value={name} maxlength={60} autocomplete="nickname" required error={nameError} />
	<fieldset class="flex min-w-0 flex-col gap-2">
		<legend class="mb-1 text-sm font-medium">{poll.choiceMode === 'single' ? t('groups.vote_hint_single') : poll.kind === 'date' ? t('groups.vote_hint_date') : t('groups.vote_hint_multi')}</legend>
		{#each poll.options as option (option.id)}
			<div class="flex flex-col gap-2 rounded-[10px] border px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-x-4 {choice[option.id] === 'yes' ? 'border-ui-accent bg-ui-accent-soft/50' : ''}" data-testid="vote-option">
				{#if threeWay}
					<div class="min-w-0 sm:flex-1" id="opt-{option.id}">
						<span class="font-medium">{optionTitle(option)}</span>
						{#if optionTime(option)}<span class="ml-2 text-sm text-muted-foreground">{optionTime(option)}</span>{/if}
					</div>
					<div role="radiogroup" aria-labelledby="opt-{option.id}" class="flex w-full shrink-0 rounded-lg bg-muted p-0.5 sm:inline-flex sm:w-auto">
						{#each segments as segment (segment.value)}
							<label class="relative inline-flex h-9 min-w-[4.25rem] flex-1 cursor-pointer items-center justify-center rounded-md px-3 text-[13px] font-medium text-muted-foreground has-[:checked]:bg-background has-[:checked]:text-foreground has-[:checked]:shadow-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
								<input type="radio" class="absolute inset-0 m-0 size-full cursor-pointer opacity-0" name="answer-{option.id}" value={segment.value} checked={choice[option.id] === segment.value} onchange={() => (choice[option.id] = segment.value)} />
								{t(segment.label)}
							</label>
						{/each}
					</div>
				{:else if poll.choiceMode === 'single'}
					<label class="flex min-h-9 w-full cursor-pointer items-center gap-3">
						<input type="radio" class="size-4 accent-[var(--ui-accent)]" name="single-choice" checked={choice[option.id] === 'yes'} onchange={() => { for (const o of poll.options) choice[o.id] = o.id === option.id ? 'yes' : 'no'; }} />
						<span class="min-w-0 break-words"><span class="font-medium">{optionTitle(option)}</span>{#if optionTime(option)}<span class="ml-2 text-sm text-muted-foreground">{optionTime(option)}</span>{/if}</span>
					</label>
				{:else}
					<label class="flex min-h-9 w-full cursor-pointer items-center gap-3">
						<input type="checkbox" class="size-4 accent-[var(--ui-accent)]" checked={choice[option.id] === 'yes'} onchange={(e) => (choice[option.id] = e.currentTarget.checked ? 'yes' : 'no')} />
						<span class="min-w-0 break-words font-medium">{optionTitle(option)}</span>
					</label>
				{/if}
			</div>
		{/each}
	</fieldset>
	{#if localError}<p class="text-sm text-destructive" role="alert" data-testid="vote-error">{localError}</p>{/if}
	{#if formError}<Alert variant="destructive" data-testid="vote-form-error">{formError}</Alert>{/if}
	<div class="flex flex-wrap items-center gap-2">
		<Button type="submit" disabled={busy}>{editing ? t('groups.vote_save') : t('groups.vote_submit')}</Button>
		{#if editing && oncancel}<Button type="button" variant="outline" onclick={oncancel} disabled={busy}>{t('common.cancel')}</Button>{/if}
		{#if editing && ondelete}<Button type="button" variant="destructive" onclick={ondelete} disabled={busy} class="sm:ml-auto">{t('groups.vote_withdraw')}</Button>{/if}
	</div>
</form>
