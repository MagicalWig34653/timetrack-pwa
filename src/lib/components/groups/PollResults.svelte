<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Minus from '@lucide/svelte/icons/minus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Pencil from '@lucide/svelte/icons/pencil';
	import type { Poll, PollVote } from '#lib/api/types.js';
	import StatusChip from '#lib/components/app/StatusChip.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { t } from '#lib/i18n/index.js';
	import { answerOf, bestOptionIds, optionTime, optionTitle, tallyOf } from '#lib/groups/format.js';

	/**
	 * Result matrix of a poll: one column per option, one row per participant, counts at the bottom.
	 * The best option (most "yes", ties by "maybe") and the owner's final choice are highlighted with text, not by colour alone.
	 * `owner` adds "choose as result" and "remove vote"; `own` marks the rows of the current browser (public page).
	 */
	let {
		poll,
		owner = false,
		own = [],
		busy = false,
		onfinal,
		onremove,
		onedit
	}: {
		poll: Poll;
		owner?: boolean;
		own?: string[];
		busy?: boolean;
		onfinal?: (optionId: string | null) => void;
		onremove?: (vote: PollVote) => void;
		onedit?: (vote: PollVote) => void;
	} = $props();

	const PAGE_SIZE = 25;
	const votes = $derived(poll.votes ?? []);
	let page = $state(0);
	const pageCount = $derived(Math.max(1, Math.ceil(votes.length / PAGE_SIZE)));
	// removing votes can leave the current page past the end
	const current = $derived(Math.min(page, pageCount - 1));
	const visibleVotes = $derived(votes.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE));
	const best = $derived(bestOptionIds(poll));
	const maybeUsed = $derived(poll.kind === 'date' && poll.choiceMode === 'multi');
	const cellWidth = $derived(poll.options.length > 6 ? 'min-w-[5.5rem]' : 'min-w-[6.5rem]');
</script>

{#if votes.length === 0 && poll.options.length > 0}
	<p class="text-sm text-muted-foreground" data-testid="poll-no-votes">{t('groups.results_empty')}</p>
{/if}
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- a scrollable region must be keyboard reachable (axe: scrollable-region-focusable) -->
<div class="relative overflow-x-auto rounded-[10px] border" role="region" tabindex="0" aria-label={t('groups.results_caption', { title: poll.title })} data-testid="poll-results">
	<table class="w-full border-collapse text-sm">
		<caption class="sr-only">{t('groups.results_caption', { title: poll.title })}</caption>
		<thead class="bg-card">
			<tr class="align-bottom">
				<th scope="col" class="sticky left-0 z-10 min-w-[8rem] bg-card px-3 py-2 text-left text-xs font-medium text-muted-foreground">{t('groups.col_name')}</th>
				{#each poll.options as option (option.id)}
					{@const isFinal = poll.finalOptionId === option.id}
					{@const isBest = !poll.finalOptionId && best.includes(option.id)}
					<th scope="col" class="{cellWidth} px-2 py-2 text-center align-bottom font-medium {isFinal ? 'bg-ui-accent-soft' : isBest ? 'bg-ui-accent-soft/60' : ''}" data-testid="option-head-{option.id}">
						<div class="flex flex-col items-center gap-1">
							<span class="break-words">{optionTitle(option)}</span>
							{#if optionTime(option)}<span class="text-xs font-normal text-muted-foreground">{optionTime(option)}</span>{/if}
							{#if isFinal}
								<StatusChip tone="accent">{t('groups.final_chosen')}</StatusChip>
							{:else if isBest}
								<StatusChip tone="success">{t('groups.best')}</StatusChip>
							{/if}
							{#if owner}
								{#if isFinal}
									<Button size="sm" variant="ghost" disabled={busy} onclick={() => onfinal?.(null)}>{t('groups.final_undo')}</Button>
								{:else}
									<Button size="sm" variant="outline" disabled={busy} aria-label={t('groups.final_choose_aria', { option: optionTitle(option) })} onclick={() => onfinal?.(option.id)}>{t('groups.final_choose')}</Button>
								{/if}
							{/if}
						</div>
					</th>
				{/each}
				{#if owner || onedit}<th scope="col" class="w-px px-2 py-2"><span class="sr-only">{t('groups.col_actions')}</span></th>{/if}
			</tr>
		</thead>
		<tbody>
			{#each visibleVotes as vote (vote.id)}
				<tr class="border-t" data-testid="vote-row">
					<th scope="row" class="sticky left-0 z-10 bg-card px-3 py-2 text-left font-medium break-words">
						{vote.name}
						{#if own.includes(vote.id)}<span class="ml-1 text-xs font-normal text-muted-foreground">{t('groups.you')}</span>{/if}
					</th>
					{#each poll.options as option (option.id)}
						{@const answer = answerOf(vote, option.id)}
						<td class="px-2 py-2 text-center {poll.finalOptionId === option.id ? 'bg-ui-accent-soft' : best.includes(option.id) && !poll.finalOptionId ? 'bg-ui-accent-soft/60' : ''}" data-answer={answer}>
							{#if answer === 'yes'}
								<Check class="mx-auto size-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" /><span class="sr-only">{t('groups.answer_yes')}</span>
							{:else if answer === 'maybe'}
								<span class="font-semibold text-amber-800 dark:text-amber-300" aria-hidden="true">(✓)</span><span class="sr-only">{t('groups.answer_maybe')}</span>
							{:else}
								<Minus class="mx-auto size-4 text-muted-foreground/60" aria-hidden="true" /><span class="sr-only">{t('groups.answer_no')}</span>
							{/if}
						</td>
					{/each}
					{#if owner || onedit}
						<td class="px-2 py-1 text-right whitespace-nowrap">
							{#if onedit && own.includes(vote.id)}
								<Button size="sm" variant="ghost" aria-label={t('groups.vote_edit_aria', { name: vote.name })} onclick={() => onedit?.(vote)}><Pencil />{t('groups.edit')}</Button>
							{/if}
							{#if owner}
								<Button size="sm" variant="ghost" disabled={busy} aria-label={t('groups.vote_remove_aria', { name: vote.name })} onclick={() => onremove?.(vote)}><Trash2 /></Button>
							{/if}
						</td>
					{/if}
				</tr>
			{/each}
		</tbody>
		<tfoot>
			<tr class="border-t-2 bg-muted/40 font-medium" data-testid="tally-row">
				<th scope="row" class="sticky left-0 z-10 bg-muted px-3 py-2 text-left">{t('groups.tally_label')}</th>
				{#each poll.options as option (option.id)}
					{@const tally = tallyOf(poll, option.id)}
					<td class="px-2 py-2 text-center" data-testid="tally-{option.id}">
						<span class="tabular-nums">{tally.yes}</span>{#if maybeUsed}{' '}<span class="text-xs font-normal text-muted-foreground tabular-nums">(+{tally.maybe})</span>{/if}
						<span class="sr-only">{t('groups.tally_sr', { yes: tally.yes, maybe: tally.maybe })}</span>
					</td>
				{/each}
				{#if owner || onedit}<td></td>{/if}
			</tr>
		</tfoot>
	</table>
</div>
{#if pageCount > 1}
	<nav class="mt-2 flex items-center justify-between gap-2 text-sm" aria-label={t('groups.pager_label')} data-testid="vote-pager">
		<Button size="sm" variant="outline" disabled={current === 0} onclick={() => (page = current - 1)}>{t('groups.pager_prev')}</Button>
		<span class="text-muted-foreground" aria-live="polite">{t('groups.pager_status', { page: current + 1, pages: pageCount, count: votes.length })}</span>
		<Button size="sm" variant="outline" disabled={current >= pageCount - 1} onclick={() => (page = current + 1)}>{t('groups.pager_next')}</Button>
	</nav>
{/if}
{#if maybeUsed}<p class="mt-1.5 text-xs text-muted-foreground">{t('groups.legend_maybe')}</p>{/if}
