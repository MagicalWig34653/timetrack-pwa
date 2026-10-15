<script lang="ts">
	import { goto } from '$app/navigation';
	import BellRing from '@lucide/svelte/icons/bell-ring';
	import FileClock from '@lucide/svelte/icons/file-clock';
	import Info from '@lucide/svelte/icons/info';
	import ListChecks from '@lucide/svelte/icons/list-checks';
	import NotebookPen from '@lucide/svelte/icons/notebook-pen';
	import Timer from '@lucide/svelte/icons/timer';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { api } from '#lib/api/client.js';
	import type { AppNotification, NotificationKind } from '#lib/api/types.js';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import Unavailable from '#lib/components/time/Unavailable.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { errorMessage, t, type MessageKey } from '#lib/i18n/index.js';
	import { relativeTime } from '#lib/notifications/relative-time.js';
	import { unread } from '#lib/notifications/unread.svelte.js';
	import { safeRelativeUrl } from '#lib/pwa/core.js';
	import { toLoadState, type LoadState } from '#lib/time/load.js';
	import { onMount } from 'svelte';

	const PAGE_SIZE = 20;
	const ICONS = {
		running_timer: Timer,
		pending_suggestions: ListChecks,
		report_gap: NotebookPen,
		document_submission: FileClock,
		system: Info
	} as const;

	let load = $state<LoadState>({ status: 'loading' });
	let items = $state<AppNotification[]>([]);
	let hasMore = $state(false);
	let onlyUnread = $state(false);
	let busy = $state(false);
	let error = $state('');
	let notice = $state('');

	const iconFor = (kind: NotificationKind) => ICONS[kind] ?? BellRing;
	const kindLabel = (kind: NotificationKind) => t(`notifications.kind.${kind}` as MessageKey);

	async function fetchPage(before?: string) {
		const result = await api.listNotifications({ unreadOnly: onlyUnread, limit: PAGE_SIZE, before });
		unread.set(result.unreadCount);
		return result.items;
	}

	async function reload() {
		try {
			const first = await fetchPage();
			items = first;
			hasMore = first.length === PAGE_SIZE;
			load = { status: 'ready' };
		} catch (e) {
			load = toLoadState(e);
		}
	}
	onMount(reload);

	async function loadMore() {
		if (busy || items.length === 0) return;
		busy = true;
		error = '';
		try {
			const next = await fetchPage(items[items.length - 1].createdAt);
			const known = new Set(items.map((i) => i.id));
			items = [...items, ...next.filter((i) => !known.has(i.id))];
			hasMore = next.length === PAGE_SIZE;
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}

	async function open(item: AppNotification) {
		error = '';
		if (!item.read) {
			try {
				const result = await api.markNotificationsRead({ ids: [item.id] });
				unread.set(result.unreadCount);
				item.read = true;
			} catch (e) {
				error = errorMessage(e);
			}
		}
		const target = safeRelativeUrl(item.url);
		if (target) await goto(target);
	}

	async function markAll() {
		if (busy) return;
		busy = true;
		error = '';
		notice = '';
		try {
			const result = await api.markNotificationsRead({ all: true });
			unread.set(result.unreadCount);
			items = onlyUnread ? [] : items.map((i) => ({ ...i, read: true }));
			hasMore = false;
			notice = t('notifications.mark_all_done');
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}

	async function remove(item: AppNotification) {
		if (busy) return;
		busy = true;
		error = '';
		notice = '';
		try {
			await api.deleteNotification(item.id);
			items = items.filter((i) => i.id !== item.id);
			if (!item.read) unread.set(Math.max(0, unread.count - 1));
			notice = t('notifications.deleted');
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}

	async function toggleUnread(event: Event) {
		onlyUnread = (event.currentTarget as HTMLInputElement).checked;
		await reload();
	}
</script>

<PageHeader title={t('notifications.title')} description={t('notifications.description')} />

{#if load.status === 'loading'}
	<p class="text-sm text-muted-foreground" role="status">{t('common.loading')}</p>
{:else if load.status === 'unavailable'}
	<Unavailable />
{:else if load.status === 'error'}
	<Alert variant="destructive">{load.message}</Alert>
{:else}
	<div class="flex flex-col gap-4">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div class="flex items-center gap-2">
				<Checkbox id="only-unread" checked={onlyUnread} onchange={toggleUnread} />
				<Label for="only-unread">{t('notifications.only_unread')}</Label>
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<Button variant="outline" size="sm" onclick={markAll} disabled={busy || unread.count === 0}>{t('notifications.mark_all')}</Button>
				<a class="text-sm underline underline-offset-4" href="/settings/notifications">{t('notifications.settings_link')}</a>
			</div>
		</div>

		{#if notice}<Alert variant="success">{notice}</Alert>{/if}
		{#if error}<Alert variant="destructive">{error}</Alert>{/if}

		{#if items.length === 0}
			<p class="text-sm text-muted-foreground" data-testid="notifications-empty">
				{onlyUnread ? t('notifications.empty_unread') : t('notifications.empty')}
			</p>
		{:else}
			<ul class="divide-y rounded-lg border bg-card" data-testid="notification-list">
				{#each items as item (item.id)}
					{@const Icon = iconFor(item.kind)}
					<li class="flex items-stretch gap-1" data-unread={!item.read} data-kind={item.kind}>
						<button
							type="button"
							class="flex min-w-0 flex-1 items-start gap-3 rounded-l-lg px-4 py-3 text-left hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
							aria-label={item.read ? undefined : `${item.title} (${t('notifications.unread_label')})`}
							onclick={() => open(item)}
						>
							<Icon class="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
							<span class="flex min-w-0 flex-1 flex-col gap-0.5">
								<span class="flex flex-wrap items-center gap-2">
									<span class={item.read ? 'font-normal' : 'font-semibold'}>{item.title}</span>
									{#if !item.read}<span class="size-2 shrink-0 rounded-full bg-primary" data-testid="unread-dot" aria-hidden="true"></span>{/if}
								</span>
								<span class="text-sm break-words text-muted-foreground">{item.body}</span>
								<span class="text-xs text-muted-foreground">{kindLabel(item.kind)} · {relativeTime(item.createdAt)}</span>
							</span>
						</button>
						<Button variant="ghost" size="icon" class="my-auto mr-2" aria-label={`${t('notifications.delete')}: ${item.title}`} onclick={() => remove(item)} disabled={busy}>
							<Trash2 class="size-4" aria-hidden="true" />
						</Button>
					</li>
				{/each}
			</ul>
			{#if hasMore}
				<div><Button variant="outline" onclick={loadMore} disabled={busy}>{t('notifications.load_more')}</Button></div>
			{/if}
		{/if}
	</div>
{/if}
