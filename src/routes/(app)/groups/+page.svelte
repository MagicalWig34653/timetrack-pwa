<script lang="ts">
	import { onMount } from 'svelte';
	import CalendarCheck from '@lucide/svelte/icons/calendar-check';
	import Plus from '@lucide/svelte/icons/plus';
	import Utensils from '@lucide/svelte/icons/utensils';
	import type { OrderSummary, PollSummary } from '#lib/api/types.js';
	import { api } from '#lib/api/client.js';
	import EmptyState from '#lib/components/app/EmptyState.svelte';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import StatusChip from '#lib/components/app/StatusChip.svelte';
	import Unavailable from '#lib/components/time/Unavailable.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { buttonVariants } from '#lib/components/ui/button/index.js';
	import { formatDateTime } from '#lib/browser.js';
	import { t } from '#lib/i18n/index.js';
	import { toLoadState, type LoadState } from '#lib/time/load.js';

	let load = $state<LoadState>({ status: 'loading' });
	let polls = $state<PollSummary[]>([]);
	let orders = $state<OrderSummary[]>([]);

	onMount(async () => {
		try {
			[polls, orders] = await Promise.all([api.listPolls(), api.listOrders()]);
			load = { status: 'ready' };
		} catch (error) {
			load = toLoadState(error);
		}
	});
</script>

<PageHeader title={t('groups.title')} description={t('groups.description')}>
	{#snippet secondary()}
		<a href="/groups/orders/new" class={buttonVariants({ variant: 'outline' })} data-testid="new-order"><Utensils />{t('groups.new_order')}</a>
	{/snippet}
	{#snippet primary()}
		<a href="/groups/polls/new" class={buttonVariants()} data-testid="new-poll"><Plus />{t('groups.new_poll')}</a>
	{/snippet}
</PageHeader>

{#if load.status === 'loading'}
	<p class="text-sm text-muted-foreground">{t('common.loading')}</p>
{:else if load.status === 'unavailable'}
	<Unavailable />
{:else if load.status === 'error'}
	<Alert variant="destructive">{load.message}</Alert>
{:else}
	<div class="grid gap-6 lg:grid-cols-2">
		<section class="flex min-w-0 flex-col gap-3" aria-labelledby="polls-title">
			<h2 id="polls-title" class="text-[17px] font-semibold">{t('groups.polls_title')}</h2>
			{#if polls.length === 0}
				<EmptyState title={t('groups.polls_empty')} description={t('groups.polls_empty_text')} icon={CalendarCheck} testid="polls-empty" />
			{:else}
				<ul class="divide-y rounded-[10px] border bg-card" data-testid="poll-list">
					{#each polls as poll (poll.id)}
						<li>
							<a href="/groups/polls/{poll.id}" class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-muted/60">
								<div class="min-w-0">
									<p class="font-medium break-words">{poll.title}</p>
									<p class="text-xs text-muted-foreground">
										{poll.kind === 'date' ? t('groups.kind_date') : t('groups.kind_text')} · {t('groups.vote_count', { count: poll.voteCount })}{#if poll.deadline} · {t('groups.deadline_until', { time: formatDateTime(poll.deadline) })}{/if}
									</p>
								</div>
								<StatusChip tone={poll.closed ? 'neutral' : 'success'}>{poll.closed ? t('groups.status_closed') : t('groups.status_open')}</StatusChip>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
		<section class="flex min-w-0 flex-col gap-3" aria-labelledby="orders-title">
			<div class="flex items-center justify-between gap-2">
				<h2 id="orders-title" class="text-[17px] font-semibold">{t('groups.orders_title')}</h2>
				<a href="/groups/catalogs" class="text-sm text-ui-accent-ink hover:underline" data-testid="catalogs-link">{t('groups.catalogs_link')}</a>
			</div>
			{#if orders.length === 0}
				<EmptyState title={t('groups.orders_empty')} description={t('groups.orders_empty_text')} icon={Utensils} testid="orders-empty" />
			{:else}
				<ul class="divide-y rounded-[10px] border bg-card" data-testid="order-list">
					{#each orders as order (order.id)}
						<li>
							<a href="/groups/orders/{order.id}" class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-muted/60">
								<div class="min-w-0">
									<p class="font-medium break-words">{order.title}</p>
									<p class="text-xs text-muted-foreground">
										{t('groups.entry_count', { count: order.entryCount })}{#if order.deadline} · {t('groups.deadline_until', { time: formatDateTime(order.deadline) })}{/if}
									</p>
								</div>
								<StatusChip tone={order.closed ? 'neutral' : 'success'}>{order.closed ? t('groups.status_closed') : t('groups.status_open')}</StatusChip>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</div>
{/if}
