<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import { ApiError } from '#lib/api/errors.js';
	import { api } from '#lib/api/client.js';
	import type { Poll, PollPatch, PollVote } from '#lib/api/types.js';
	import ConfirmDialog from '#lib/components/app/ConfirmDialog.svelte';
	import Field from '#lib/components/app/Field.svelte';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import StatusChip from '#lib/components/app/StatusChip.svelte';
	import PollResults from '#lib/components/groups/PollResults.svelte';
	import ShareLinkCard from '#lib/components/groups/ShareLinkCard.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { formatDateTime } from '#lib/browser.js';
	import { deadlineFromInput, deadlineInputValue, groupUrl, optionTime, optionTitle } from '#lib/groups/format.js';
	import { freshLinks } from '#lib/groups/fresh-links.svelte.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { zoneStore } from '#lib/time/zone.svelte.js';

	const id = page.params.id ?? '';
	let poll = $state<Poll | null>(null);
	let loadError = $state('');
	let notFound = $state(false);
	let busy = $state(false);
	let notice = $state('');
	let actionError = $state('');
	let editing = $state(false);
	let zone = $state('Europe/Berlin');
	let form = $state({ title: '', description: '', deadline: '', hideResults: false });
	let formErrors = $state<{ title?: string; deadline?: string }>({});
	let confirm = $state<{ kind: 'delete' } | { kind: 'vote'; vote: PollVote } | null>(null);
	let confirmError = $state('');

	const freshPath = $derived(freshLinks.get(id));
	const linkPath = $derived(freshPath ?? poll?.path);
	const finalOption = $derived(poll?.options.find((o) => o.id === poll?.finalOptionId));

	onMount(async () => {
		zone = await zoneStore.ensure();
		await reload();
	});

	async function reload() {
		try {
			poll = await api.getPoll(id);
		} catch (error) {
			if (error instanceof ApiError && error.status === 404) notFound = true;
			else loadError = errorMessage(error);
		}
	}

	async function run(action: () => Promise<Poll | void>, success?: string) {
		if (busy) return;
		busy = true;
		actionError = '';
		notice = '';
		try {
			const result = await action();
			if (result) poll = result;
			if (success) notice = success;
		} catch (error) {
			actionError = errorMessage(error);
		} finally {
			busy = false;
		}
	}

	const close = () => run(() => api.closePoll(id), t('groups.notice_closed'));
	const reopen = () => run(() => api.reopenPoll(id), t('groups.notice_reopened'));
	const choose = (optionId: string | null) => run(() => api.setPollFinalOption(id, optionId), optionId ? t('groups.notice_final') : t('groups.notice_final_undone'));

	async function rotate() {
		if (busy) return;
		busy = true;
		actionError = '';
		try {
			const result = await api.rotatePollToken(id);
			if (result.path) freshLinks.set(id, result.path);
			poll = result;
			notice = t('groups.notice_rotated');
		} catch (error) {
			actionError = errorMessage(error);
		} finally {
			busy = false;
		}
	}

	function startEdit() {
		if (!poll) return;
		form = { title: poll.title, description: poll.description ?? '', deadline: deadlineInputValue(poll.deadline, zone), hideResults: poll.hideResults };
		formErrors = {};
		editing = true;
	}

	async function saveEdit(event: Event) {
		event.preventDefault();
		if (!poll || busy) return;
		formErrors = {};
		if (!form.title.trim()) formErrors.title = t('groups.error_title_required');
		const deadlineIso = form.deadline ? deadlineFromInput(form.deadline, zone) : null;
		const unchanged = deadlineIso !== null && poll.deadline && Math.abs(Date.parse(deadlineIso) - Date.parse(poll.deadline)) < 60_000;
		if (form.deadline && !deadlineIso) formErrors.deadline = t('groups.error_deadline');
		else if (deadlineIso && !unchanged && Date.parse(deadlineIso) <= Date.now()) formErrors.deadline = t('groups.error_deadline_past');
		if (formErrors.title || formErrors.deadline) return;
		const patch: PollPatch = {
			title: form.title.trim(),
			description: form.description.trim() || null,
			hideResults: form.hideResults,
			...(unchanged ? {} : { deadline: deadlineIso })
		};
		await run(() => api.patchPoll(id, patch), t('groups.notice_saved'));
		if (!actionError) editing = false;
	}

	async function confirmed() {
		if (!confirm) return;
		busy = true;
		confirmError = '';
		try {
			if (confirm.kind === 'delete') {
				await api.deletePoll(id);
				freshLinks.clear(id);
				await goto('/groups');
				return;
			}
			await api.removePollVote(id, confirm.vote.id);
			confirm = null;
			notice = t('groups.notice_vote_removed');
			await reload();
		} catch (error) {
			confirmError = errorMessage(error);
		} finally {
			busy = false;
		}
	}
</script>

<PageHeader title={poll?.title ?? t('groups.poll_detail')} description={poll?.description ?? undefined}>
	{#snippet secondary()}
		{#if poll}
			{#if poll.closed}
				<Button variant="outline" disabled={busy} onclick={reopen} data-testid="reopen">{t('groups.reopen')}</Button>
			{:else}
				<Button variant="outline" disabled={busy} onclick={close} data-testid="close">{t('groups.close')}</Button>
			{/if}
		{/if}
	{/snippet}
</PageHeader>

{#if notFound}
	<Alert variant="warning" data-testid="not-found">{t('groups.owner_not_found')} <a href="/groups" class="underline">{t('groups.back_to_list')}</a></Alert>
{:else if loadError}
	<Alert variant="destructive">{loadError}</Alert>
{:else if !poll}
	<p class="text-sm text-muted-foreground">{t('common.loading')}</p>
{:else}
	<div class="flex flex-col gap-5">
		{#if notice}<Alert variant="success" data-testid="notice">{notice}</Alert>{/if}
		{#if actionError}<Alert variant="destructive" data-testid="action-error">{actionError}</Alert>{/if}

		<div class="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
			<StatusChip tone={poll.closed ? 'neutral' : 'success'}>{poll.closed ? t('groups.status_closed') : t('groups.status_open')}</StatusChip>
			<span>{poll.kind === 'date' ? t('groups.kind_date') : t('groups.kind_text')} · {poll.choiceMode === 'single' ? t('groups.mode_single') : t('groups.mode_multi_label')}</span>
			<span>· {t('groups.vote_count', { count: poll.voteCount })}</span>
			{#if poll.deadline}<span>· {poll.closed ? t('groups.deadline_ended', { time: formatDateTime(poll.deadline) }) : t('groups.deadline_until', { time: formatDateTime(poll.deadline) })}</span>{/if}
			{#if poll.hideResults}<span>· {t('groups.results_hidden_flag')}</span>{/if}
		</div>

		{#if finalOption}
			<Alert variant="success" data-testid="final-result">
				<span class="font-medium">{t('groups.final_banner')}</span>: <strong>{optionTitle(finalOption)}</strong>{#if optionTime(finalOption)} · {optionTime(finalOption)}{/if}
			</Alert>
		{/if}

		<ShareLinkCard url={linkPath ? groupUrl(linkPath) : undefined} fresh={!!freshPath} title={poll.title} {busy} onrotate={rotate} ondismiss={() => freshLinks.clear(id)} />
		{#if linkPath}
			<div class="-mt-3"><a href={linkPath} target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 text-sm text-ui-accent-ink hover:underline" data-testid="open-public"><ExternalLink class="size-4" />{t('groups.open_public')}</a></div>
		{/if}

		<section class="flex flex-col gap-3" aria-labelledby="results-title">
			<h2 id="results-title" class="text-[17px] font-semibold">{t('groups.results_title')}</h2>
			{#if poll.hideResults && !poll.closed}<p class="text-sm text-muted-foreground">{t('groups.owner_hidden_note')}</p>{/if}
			<PollResults {poll} owner {busy} onfinal={choose} onremove={(vote) => { confirmError = ''; confirm = { kind: 'vote', vote }; }} />
		</section>

		<section class="flex flex-col gap-3 rounded-[10px] border bg-card p-4" aria-labelledby="edit-title">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<h2 id="edit-title" class="text-[17px] font-semibold">{t('groups.settings_title')}</h2>
				{#if !editing}<Button size="sm" variant="outline" onclick={startEdit} data-testid="edit-settings">{t('groups.edit')}</Button>{/if}
			</div>
			{#if editing}
				<form class="flex flex-col gap-4" onsubmit={saveEdit} novalidate data-testid="edit-form">
					<Field id="edit-title-input" label={t('groups.field_title')} bind:value={form.title} maxlength={120} required error={formErrors.title} />
					<div class="flex flex-col gap-1.5">
						<Label for="edit-description">{t('groups.field_description')}</Label>
						<Textarea id="edit-description" bind:value={form.description} maxlength={2000} rows={3} />
					</div>
					<div class="flex flex-col gap-1.5">
						<Label for="edit-deadline">{t('groups.field_deadline')}</Label>
						<Input id="edit-deadline" type="datetime-local" bind:value={form.deadline} aria-invalid={formErrors.deadline ? true : undefined} />
						{#if formErrors.deadline}<p class="text-xs text-destructive">{formErrors.deadline}</p>{/if}
					</div>
					<div class="flex items-start gap-3">
						<Switch id="edit-hide" bind:checked={form.hideResults} class="mt-0.5" />
						<div><Label for="edit-hide">{t('groups.field_hide')}</Label><p class="text-xs text-muted-foreground">{t('groups.hide_hint')}</p></div>
					</div>
					<div class="flex gap-2">
						<Button type="submit" disabled={busy}>{t('common.save')}</Button>
						<Button type="button" variant="outline" onclick={() => (editing = false)}>{t('common.cancel')}</Button>
					</div>
				</form>
			{:else}
				<p class="text-sm text-muted-foreground">{t('groups.options_immutable')}</p>
			{/if}
		</section>

		<div><Button variant="destructive" disabled={busy} onclick={() => { confirmError = ''; confirm = { kind: 'delete' }; }} data-testid="delete">{t('groups.delete_poll')}</Button></div>
	</div>
{/if}

<ConfirmDialog
	open={confirm !== null}
	title={confirm?.kind === 'vote' ? t('groups.vote_remove_title') : t('groups.delete_poll_title')}
	confirmLabel={confirm?.kind === 'vote' ? t('groups.vote_remove') : t('groups.delete_confirm')}
	tone="danger"
	{busy}
	error={confirmError}
	onconfirm={confirmed}
	oncancel={() => (confirm = null)}
>
	{#if confirm?.kind === 'vote'}
		<p>{t('groups.vote_remove_text', { name: confirm.vote.name })}</p>
	{:else}
		<p>{t('groups.delete_poll_text')}</p>
	{/if}
</ConfirmDialog>
