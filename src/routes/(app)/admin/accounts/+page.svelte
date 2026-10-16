<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '#lib/api/client.js';
	import { ApiError } from '#lib/api/errors.js';
	import type { AdminAccount, Role } from '#lib/api/types.js';
	import { formatDateTime } from '#lib/browser.js';
	import ConfirmDialog from '#lib/components/app/ConfirmDialog.svelte';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import StatusChip from '#lib/components/app/StatusChip.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { sessionStore } from '#lib/session.svelte.js';

	const PAGE_SIZE = 25;
	type Action = { kind: 'disable' | 'role' | 'sessions' | 'delete'; account: AdminAccount; role?: Role };

	let items = $state<AdminAccount[]>([]);
	let total = $state(0);
	let offset = $state(0);
	let loading = $state(true);
	let loadError = $state('');
	let notice = $state('');
	let rowError = $state('');
	let busy = $state(false);
	let action = $state<Action | null>(null);
	let dialogOpen = $state(false);
	let dialogError = $state('');
	let dialogWarning = $state('');
	let reauth = $state(false);

	const ownId = $derived(sessionStore.current?.account.id);
	const pages = $derived(Math.max(1, Math.ceil(total / PAGE_SIZE)));
	const pageNumber = $derived(Math.floor(offset / PAGE_SIZE) + 1);

	async function load(newOffset = offset) {
		loading = true;
		loadError = '';
		try {
			const result = await api.listAccounts(PAGE_SIZE, newOffset);
			// deleting the last row of the last page leaves an empty page: step back
			if (result.items.length === 0 && newOffset > 0) return load(Math.max(0, newOffset - PAGE_SIZE));
			items = result.items;
			total = result.total;
			offset = result.offset;
		} catch (e) {
			loadError = e instanceof ApiError && e.status === 403 ? t('accounts.forbidden') : errorMessage(e);
		} finally {
			loading = false;
		}
	}
	onMount(() => void load(0));

	function open(next: Action) {
		action = next;
		dialogError = '';
		dialogWarning = '';
		reauth = false;
		notice = '';
		rowError = '';
		dialogOpen = true;
	}

	function close() {
		dialogOpen = false;
	}

	async function reactivate(account: AdminAccount) {
		busy = true;
		notice = '';
		rowError = '';
		try {
			await api.updateAccount(account.id, { state: 'active' });
			notice = t('accounts.reactivated_done', { handle: account.handle });
			await load();
		} catch (e) {
			rowError = errorMessage(e);
		} finally {
			busy = false;
		}
	}

	async function confirm() {
		if (!action) return;
		const { kind, account } = action;
		busy = true;
		dialogError = '';
		dialogWarning = '';
		reauth = false;
		try {
			if (kind === 'disable') {
				await api.updateAccount(account.id, { state: 'disabled' });
				notice = t('accounts.disabled_done', { handle: account.handle });
			} else if (kind === 'role') {
				await api.updateAccount(account.id, { role: action.role! });
				notice = t('accounts.role_done', { handle: account.handle, role: t(`accounts.role.${action.role!}`) });
			} else if (kind === 'sessions') {
				await api.revokeAccountSessions(account.id);
				notice = t('accounts.sessions_done', { handle: account.handle });
			} else {
				await api.deleteAccount(account.id, account.handle);
				notice = t('accounts.deleted_done', { handle: account.handle });
			}
			close();
			await load();
		} catch (e) {
			if (e instanceof ApiError && e.code === 'reauth_required') reauth = true;
			else if (e instanceof ApiError && e.code === 'account_deletion_incomplete') {
				// the account stays disabled; the same call may be repeated
				dialogWarning = t('accounts.delete.incomplete');
				dialogError = errorMessage(e);
				await load();
			} else dialogError = errorMessage(e);
		} finally {
			busy = false;
		}
	}

	const titleOf = (a: Action) =>
		a.kind === 'disable'
			? t('accounts.disable.title', { handle: a.account.handle })
			: a.kind === 'sessions'
				? t('accounts.sessions.title', { handle: a.account.handle })
				: a.kind === 'delete'
					? t('accounts.delete.title', { handle: a.account.handle })
					: t(a.role === 'admin' ? 'accounts.role.title_admin' : 'accounts.role.title_member', { handle: a.account.handle });
	const confirmOf = (a: Action) =>
		a.kind === 'disable'
			? t('accounts.disable.confirm')
			: a.kind === 'sessions'
				? t('accounts.sessions.confirm')
				: a.kind === 'delete'
					? dialogWarning
						? t('accounts.delete.retry')
						: t('accounts.delete.confirm')
					: t('accounts.role.confirm');
</script>

<PageHeader title={t('accounts.title')} description={t('accounts.description')} />

<div class="flex flex-col gap-4">
	{#if notice}<Alert variant="success" data-testid="accounts-notice">{notice}</Alert>{/if}
	{#if rowError}<Alert variant="destructive">{rowError}</Alert>{/if}
	{#if loadError}
		<Alert variant="destructive">{loadError}</Alert>
	{:else if loading && items.length === 0}
		<p class="text-sm text-muted-foreground" role="status">{t('common.loading')}</p>
	{:else}
		<p class="text-sm text-muted-foreground" data-testid="accounts-count">{total === 1 ? t('accounts.count_one') : t('accounts.count', { total })}</p>
		<ul class="flex flex-col gap-3" aria-label={t('accounts.list')} data-testid="account-list">
			{#each items as account (account.id)}
				{@const own = account.id === ownId}
				{@const name = account.displayName || account.handle}
				<li
					class="rounded-[10px] border bg-card p-[17px] text-card-foreground shadow-[var(--shadow-card)] sm:p-[22px]"
					data-testid="account-row"
					data-handle={account.handle}
					data-state={account.state}
					data-role={account.role}
				>
					<div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
						<div class="min-w-0">
							<p class="flex flex-wrap items-center gap-2 text-[17px] leading-tight font-semibold">
								<span class="break-words">{name}</span>
								{#if own}<StatusChip tone="accent">{t('accounts.you')}</StatusChip>{/if}
							</p>
							<p class="mt-0.5 text-[13px] text-muted-foreground">
								<span data-testid="account-handle">{account.handle}</span> · {account.email || t('accounts.no_email')}
							</p>
						</div>
						<div class="flex flex-wrap items-center gap-2">
							<StatusChip tone={account.role === 'admin' ? 'accent' : 'neutral'} dot={false}>{t(`accounts.role.${account.role}`)}</StatusChip>
							<StatusChip tone={account.state === 'active' ? 'success' : 'warning'}>{t(`accounts.state.${account.state}`)}</StatusChip>
						</div>
					</div>
					<p class="mt-2 text-[13px] text-muted-foreground">
						{account.lastActivityAt ? t('accounts.last_activity', { date: formatDateTime(account.lastActivityAt) }) : t('accounts.never_active')}
						·
						{account.passkeyCount === 1 ? t('accounts.passkeys_one') : t('accounts.passkeys', { count: account.passkeyCount })}
					</p>
					{#if own}
						<p class="mt-3 text-[13px] text-muted-foreground">{t('accounts.self_note')}</p>
					{:else}
						<div class="mt-3 flex flex-wrap gap-2 border-t pt-3" role="group" aria-label={t('accounts.actions_for', { name })}>
							{#if account.state === 'active'}
								<Button size="sm" variant="outline" disabled={busy} onclick={() => open({ kind: 'disable', account })} data-testid="act-disable">
									{t('accounts.action.disable')}
								</Button>
							{:else}
								<Button size="sm" variant="outline" disabled={busy} onclick={() => reactivate(account)} data-testid="act-reactivate">
									{t('accounts.action.reactivate')}
								</Button>
							{/if}
							<Button
								size="sm"
								variant="outline"
								disabled={busy}
								onclick={() => open({ kind: 'role', account, role: account.role === 'admin' ? 'member' : 'admin' })}
								data-testid="act-role"
							>
								{account.role === 'admin' ? t('accounts.action.make_member') : t('accounts.action.make_admin')}
							</Button>
							<Button size="sm" variant="outline" disabled={busy} onclick={() => open({ kind: 'sessions', account })} data-testid="act-sessions">
								{t('accounts.action.revoke_sessions')}
							</Button>
							<Button size="sm" variant="destructive" disabled={busy} onclick={() => open({ kind: 'delete', account })} data-testid="act-delete">
								{t('accounts.action.delete')}
							</Button>
						</div>
					{/if}
				</li>
			{:else}
				<li class="text-sm text-muted-foreground">{t('accounts.empty')}</li>
			{/each}
		</ul>
		{#if pages > 1}
			<nav class="flex items-center justify-between gap-3" aria-label={t('accounts.list')}>
				<Button variant="outline" size="sm" disabled={offset === 0 || loading} onclick={() => load(offset - PAGE_SIZE)}>{t('accounts.prev')}</Button>
				<span class="text-sm text-muted-foreground" data-testid="accounts-page">{t('accounts.page', { page: pageNumber, pages })}</span>
				<Button variant="outline" size="sm" disabled={pageNumber >= pages || loading} onclick={() => load(offset + PAGE_SIZE)}>{t('accounts.next')}</Button>
			</nav>
		{/if}
	{/if}
</div>

{#if action}
	<ConfirmDialog
		bind:open={dialogOpen}
		title={titleOf(action)}
		confirmLabel={confirmOf(action)}
		tone={action.kind === 'delete' || action.kind === 'disable' ? 'danger' : 'default'}
		typedHandle={action.kind === 'delete' ? action.account.handle : undefined}
		{busy}
		error={dialogError}
		warning={dialogWarning}
		reauthNext={reauth ? '/admin/accounts' : undefined}
		onconfirm={confirm}
		oncancel={close}
	>
		{#if action.kind === 'disable'}
			<p>{t('accounts.disable.body')}</p>
			<p class="text-muted-foreground">{t('accounts.disable.note')}</p>
		{:else if action.kind === 'role'}
			<p>{t(action.role === 'admin' ? 'accounts.role.body_admin' : 'accounts.role.body_member')}</p>
		{:else if action.kind === 'sessions'}
			<p>{t('accounts.sessions.body')}</p>
		{:else}
			<p class="font-medium text-destructive">{t('accounts.delete.body')}</p>
			<ul class="list-disc space-y-1 pl-5">
				<li>{t('accounts.delete.item_data')}</li>
				<li>{t('accounts.delete.item_files')}</li>
				<li>{t('accounts.delete.item_access')}</li>
				<li>{t('accounts.delete.item_shares')}</li>
			</ul>
			<p class="text-muted-foreground">{t('accounts.delete.backups')}</p>
		{/if}
	</ConfirmDialog>
{/if}
