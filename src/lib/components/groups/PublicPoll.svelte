<script lang="ts">
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import StatusChip from '#lib/components/app/StatusChip.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { ApiError } from '#lib/api/errors.js';
	import type { Poll, PollAnswer, PollVote } from '#lib/api/types.js';
	import { formatDateTime } from '#lib/browser.js';
	import { optionTime, optionTitle } from '#lib/groups/format.js';
	import { publicGroups } from '#lib/groups/public-api.js';
	import { loadMemory, updateMemory } from '#lib/groups/secrets.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import PollResults from './PollResults.svelte';
	import PollVoteForm from './PollVoteForm.svelte';

	/** Participant view of a public poll (/g/<token>): description, results matrix, vote form with editing of the own vote. */
	let { token, poll, onrefresh }: { token: string; poll: Poll; onrefresh: () => Promise<void> } = $props();

	// the page remounts per link ({#key token} in the route), so the initial values are the right ones
	// svelte-ignore state_referenced_locally
	let memory = $state(loadMemory(token));
	// svelte-ignore state_referenced_locally
	let name = $state(memory.name ?? '');
	/** 'edit' targets the own vote `editingId`; 'new' creates another vote (e.g. for a second person) */
	let mode = $state<'new' | 'edit'>('new');
	let editingId = $state<string | null>(null);
	let busy = $state(false);
	let nameError = $state('');
	let formError = $state('');
	let notice = $state('');
	let refreshing = $state(false);
	let formAnchor: HTMLElement | undefined = $state();

	/** own votes of this browser that still exist (when the results are hidden the server cannot confirm them) */
	const ownIds = $derived(Object.keys(memory.votes).filter((id) => !poll.votes || poll.votes.some((vote) => vote.id === id)));
	const finalOption = $derived(poll.options.find((option) => option.id === poll.finalOptionId));
	const initialAnswers = $derived.by((): PollAnswer[] => {
		if (mode !== 'edit' || !editingId) return [];
		return poll.votes?.find((vote) => vote.id === editingId)?.answers ?? memory.answers[editingId] ?? [];
	});

	// start in edit mode for the own vote the first time one is known
	let started = false;
	$effect(() => {
		if (started || ownIds.length === 0) return;
		started = true;
		editingId = ownIds[0];
		mode = 'edit';
		const stored = poll.votes?.find((vote) => vote.id === ownIds[0]);
		if (stored && !name) name = stored.name;
	});
	// the edited vote vanished (removed by the owner): back to a new vote
	$effect(() => {
		if (mode === 'edit' && editingId && !ownIds.includes(editingId)) {
			mode = 'new';
			editingId = null;
		}
	});

	function remember(change: (m: typeof memory) => void) {
		memory = { ...updateMemory(token, change) };
	}

	function fail(error: unknown, voteId?: string) {
		if (error instanceof ApiError && error.code === 'name_taken') nameError = t('groups.error_name_taken');
		else if (error instanceof ApiError && error.code === 'edit_secret_invalid' && voteId) {
			remember((m) => {
				delete m.votes[voteId];
				delete m.answers[voteId];
			});
			mode = 'new';
			editingId = null;
			formError = t('groups.error_secret_lost');
		} else if (error instanceof ApiError && error.status === 404 && voteId) {
			remember((m) => {
				delete m.votes[voteId];
				delete m.answers[voteId];
			});
			mode = 'new';
			editingId = null;
			formError = t('groups.error_vote_gone');
		} else formError = errorMessage(error);
		if (error instanceof ApiError && (error.code === 'group_closed' || error.code === 'group_full')) void onrefresh();
	}

	async function submit(answers: PollAnswer[]) {
		busy = true;
		nameError = '';
		formError = '';
		notice = '';
		const trimmed = name.trim();
		if (!trimmed) {
			nameError = t('groups.error_name_required');
			busy = false;
			return;
		}
		try {
			if (mode === 'edit' && editingId) {
				const secret = memory.votes[editingId];
				await publicGroups.updateVote(token, editingId, secret, { name: trimmed, answers });
				const id = editingId;
				remember((m) => {
					m.name = trimmed;
					m.answers[id] = answers;
				});
				notice = t('groups.vote_updated');
			} else {
				const created = await publicGroups.castVote(token, { name: trimmed, answers });
				remember((m) => {
					m.name = trimmed;
					m.votes[created.vote.id] = created.editSecret;
					m.answers[created.vote.id] = answers;
				});
				editingId = created.vote.id;
				mode = 'edit';
				notice = t('groups.vote_saved');
			}
			await onrefresh();
		} catch (error) {
			fail(error, mode === 'edit' ? (editingId ?? undefined) : undefined);
		} finally {
			busy = false;
		}
	}

	async function withdraw() {
		if (!editingId) return;
		busy = true;
		formError = '';
		const id = editingId;
		try {
			await publicGroups.deleteVote(token, id, memory.votes[id]);
			remember((m) => {
				delete m.votes[id];
				delete m.answers[id];
			});
			mode = 'new';
			editingId = null;
			name = memory.name ?? '';
			notice = t('groups.vote_withdrawn');
			await onrefresh();
		} catch (error) {
			fail(error, id);
		} finally {
			busy = false;
		}
	}

	function editVote(vote: PollVote) {
		editingId = vote.id;
		mode = 'edit';
		name = vote.name;
		notice = '';
		formAnchor?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
	}

	function startNew() {
		mode = 'new';
		editingId = null;
		name = '';
		notice = '';
		nameError = '';
		formError = '';
	}

	async function refresh() {
		refreshing = true;
		try {
			await onrefresh();
		} finally {
			refreshing = false;
		}
	}
</script>

<header class="flex flex-col gap-2">
	<div class="flex flex-wrap items-center gap-2">
		<StatusChip tone={poll.closed ? 'neutral' : 'success'}>{poll.closed ? t('groups.status_closed') : t('groups.status_open')}</StatusChip>
		<span class="text-sm text-muted-foreground">{t('groups.vote_count', { count: poll.voteCount })}</span>
		{#if poll.deadline}<span class="text-sm text-muted-foreground">· {poll.closed ? t('groups.deadline_ended', { time: formatDateTime(poll.deadline) }) : t('groups.deadline_until', { time: formatDateTime(poll.deadline) })}</span>{/if}
	</div>
	<h1 class="text-[26px] leading-tight font-[650] tracking-[-0.6px] break-words sm:text-[30px]" data-testid="group-title">{poll.title}</h1>
	{#if poll.description}<p class="text-[15px] break-words whitespace-pre-line text-muted-foreground" data-testid="group-description">{poll.description}</p>{/if}
	{#if poll.kind === 'date' && poll.timeZone}<p class="text-xs text-muted-foreground">{t('groups.time_zone_note', { zone: poll.timeZone })}</p>{/if}
</header>

{#if finalOption}
	<Alert variant="success" data-testid="final-result">
		<p class="font-medium">{t('groups.final_banner')}</p>
		<p class="mt-0.5 text-base font-semibold">{optionTitle(finalOption)}{#if optionTime(finalOption)} <span class="font-normal">· {optionTime(finalOption)}</span>{/if}</p>
	</Alert>
{/if}

{#if notice}<Alert variant="success" data-testid="vote-notice">{notice}</Alert>{/if}

{#if poll.closed}
	<Alert data-testid="closed-note">{t('groups.closed_note_poll')}</Alert>
{:else}
	<section class="flex flex-col gap-3 rounded-[10px] border bg-card p-4 sm:p-5" aria-labelledby="vote-title" bind:this={formAnchor}>
		<h2 id="vote-title" class="text-base font-semibold">{mode === 'edit' ? t('groups.vote_title_edit') : t('groups.vote_title')}</h2>
		<PollVoteForm {poll} bind:name initial={initialAnswers} editing={mode === 'edit'} {busy} {nameError} {formError} onsubmit={submit} oncancel={startNew} ondelete={withdraw} />
		{#if mode === 'edit'}
			<div><Button variant="link" class="h-auto p-0" onclick={startNew}>{t('groups.vote_another')}</Button></div>
		{:else if ownIds.length > 0}
			<div><Button variant="link" class="h-auto p-0" onclick={() => { editingId = ownIds[0]; mode = 'edit'; name = memory.name ?? ''; }}>{t('groups.vote_back_to_own')}</Button></div>
		{/if}
		<p class="text-xs text-muted-foreground">{t('groups.edit_hint')}</p>
	</section>
{/if}

<section class="flex flex-col gap-2" aria-labelledby="results-title">
	<div class="flex items-center justify-between gap-2">
		<h2 id="results-title" class="text-base font-semibold">{t('groups.results_title')}</h2>
		<Button size="sm" variant="ghost" onclick={refresh} disabled={refreshing} aria-label={t('groups.refresh')}><RefreshCw class={refreshing ? 'animate-spin' : ''} />{t('groups.refresh')}</Button>
	</div>
	{#if poll.resultsVisible}
		<PollResults {poll} own={ownIds} onedit={poll.closed ? undefined : editVote} />
	{:else}
		<Alert data-testid="results-hidden">{t('groups.results_hidden', { count: poll.voteCount })}</Alert>
	{/if}
</section>
