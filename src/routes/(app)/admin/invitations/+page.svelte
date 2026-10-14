<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '#lib/api/client.js';
	import type { Invitation, InvitationCreated } from '#lib/api/types.js';
	import { formatDateTime } from '#lib/browser.js';
	import CopyButton from '#lib/components/app/CopyButton.svelte';
	import Field from '#lib/components/app/Field.svelte';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#lib/components/ui/card/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';

	let invitations = $state<Invitation[]>([]);
	let loading = $state(true);
	let busy = $state(false);
	let error = $state('');
	let hours = $state('72');
	let note = $state('');
	let created = $state<{ link: string; expiresAt: string } | null>(null);

	async function load() {
		try {
			invitations = await api.listInvitations();
		} catch (e) {
			error = errorMessage(e);
		} finally {
			loading = false;
		}
	}
	onMount(load);

	async function create(event: Event) {
		event.preventDefault();
		busy = true;
		error = '';
		try {
			const result: InvitationCreated = await api.createInvitation({
				expiresInHours: Number(hours) || undefined,
				note: note.trim() || undefined
			});
			// The plain token is only returned once; build the link right away.
			created = { link: `${location.origin}/invite/${result.token}`, expiresAt: result.expiresAt };
			note = '';
			invitations = await api.listInvitations();
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}

	async function revoke(id: string) {
		busy = true;
		error = '';
		try {
			await api.revokeInvitation(id);
			invitations = await api.listInvitations();
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}
</script>

<PageHeader title={t('invitations.title')} description={t('invitations.description')} />

{#if error}<Alert variant="destructive" class="mb-4">{error}</Alert>{/if}

{#if created}
	<Alert variant="success" class="mb-4 flex flex-col gap-3">
		<p class="font-medium">{t('invitations.created')}</p>
		<p>{t('invitations.show_once', { date: formatDateTime(created.expiresAt) })}</p>
		<code class="rounded-md bg-background/60 p-2 text-xs break-all" data-testid="invite-link">{created.link}</code>
		<div class="flex gap-2">
			<CopyButton text={created.link} label={t('invitations.copy_link')} />
			<Button variant="ghost" size="sm" onclick={() => (created = null)}>{t('common.done')}</Button>
		</div>
	</Alert>
{/if}

<Card class="mb-6">
	<CardHeader>
		<CardTitle>{t('invitations.new')}</CardTitle>
		<CardDescription>{t('invitations.new_text')}</CardDescription>
	</CardHeader>
	<CardContent>
		<form class="grid gap-3 sm:grid-cols-[8rem_1fr_auto] sm:items-end" onsubmit={create}>
			<Field id="invite-hours" type="number" min={1} max={720} label={t('invitations.valid_hours')} bind:value={hours} required />
			<Field id="invite-note" label={t('invitations.note')} bind:value={note} maxlength={200} />
			<Button type="submit" disabled={busy}>{t('invitations.create')}</Button>
		</form>
	</CardContent>
</Card>

{#if loading}
	<p class="text-sm text-muted-foreground" role="status">{t('common.loading')}</p>
{:else}
	<ul class="flex flex-col gap-3" aria-label={t('invitations.list')}>
		{#each invitations as invitation (invitation.id)}
			<li>
				<Card class="py-4">
					<CardContent class="flex flex-wrap items-center justify-between gap-3">
						<div>
							<p class="flex items-center gap-2 font-medium">
								{invitation.note || t('invitations.no_note')}
								<Badge variant={invitation.status === 'open' ? 'default' : 'secondary'}>
									{t(`invitations.status.${invitation.status}`)}
								</Badge>
							</p>
							<p class="text-xs text-muted-foreground">
								{t('invitations.created_at', { date: formatDateTime(invitation.createdAt) })} ·
								{t('invitations.expires_at', { date: formatDateTime(invitation.expiresAt) })}
							</p>
						</div>
						{#if invitation.status === 'open'}
							<Button variant="destructive" size="sm" onclick={() => revoke(invitation.id)} disabled={busy}>
								{t('invitations.revoke')}
							</Button>
						{/if}
					</CardContent>
				</Card>
			</li>
		{:else}
			<li class="text-sm text-muted-foreground">{t('invitations.empty')}</li>
		{/each}
	</ul>
{/if}
