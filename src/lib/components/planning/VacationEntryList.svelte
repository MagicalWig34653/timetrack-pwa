<script lang="ts">
	import { api } from '#lib/api/client.js';
	import type { VacationEntries } from '#lib/api/types.js';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#lib/components/ui/card/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { formatDateNumeric } from '#lib/time/dates.js';
	import { formatHalfDays, formatHalfDaysSigned } from '#lib/vacation/halfdays.js';

	let { year, entries, ondeleted }: { year: number; entries: VacationEntries; ondeleted: () => void } = $props();

	let confirming = $state<string | null>(null);
	let pending = $state(false);
	let error = $state('');
	let notice = $state('');

	const rows = $derived(
		[
			...entries.snapshots.map((s) => ({ id: s.id, date: s.date, text: t('vacation.entry_snapshot', { date: formatDateNumeric(s.date), days: formatHalfDays(s.remainingHalfDays) }), reason: '' })),
			...entries.adjustments.map((a) => ({ id: a.id, date: a.date, text: t('vacation.entry_adjustment', { date: formatDateNumeric(a.date), days: formatHalfDaysSigned(a.halfDays) }), reason: a.reason }))
		].sort((a, b) => a.date.localeCompare(b.date))
	);

	async function remove(id: string) {
		if (confirming !== id) {
			confirming = id;
			return;
		}
		if (pending) return;
		pending = true;
		error = '';
		notice = '';
		try {
			await api.deleteVacationEntry(id);
			confirming = null;
			notice = t('vacation.entry_deleted');
			ondeleted();
		} catch (e) {
			error = errorMessage(e);
		} finally {
			pending = false;
		}
	}
</script>

<Card data-testid="vacation-entries">
	<CardHeader>
		<CardTitle>{t('vacation.entries_title', { year })}</CardTitle>
		<CardDescription>{t('vacation.entries_text')}</CardDescription>
	</CardHeader>
	<CardContent class="flex flex-col gap-3">
		{#if notice}<Alert variant="success">{notice}</Alert>{/if}
		{#if error}<Alert variant="destructive">{error}</Alert>{/if}
		{#if rows.length === 0}
			<p class="text-sm text-muted-foreground" data-testid="entries-empty">{t('vacation.entries_empty')}</p>
		{:else}
			<ul class="divide-y rounded-lg border text-sm">
				{#each rows as row (row.id)}
					<li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2" data-testid="vacation-entry">
						<span class="min-w-0 flex-1">
							<span class="tabular-nums">{row.text}</span>
							{#if row.reason}<span class="block text-xs text-muted-foreground">{row.reason}</span>{/if}
						</span>
						<span class="flex gap-2">
							{#if confirming === row.id}
								<Button variant="destructive" size="sm" disabled={pending} onclick={() => remove(row.id)}>{t('vacation.entry_delete_now')}</Button>
								<Button variant="outline" size="sm" disabled={pending} onclick={() => (confirming = null)}>{t('vacation.entry_cancel')}</Button>
							{:else}
								<Button variant="outline" size="sm" onclick={() => remove(row.id)}>{t('vacation.entry_delete')}</Button>
							{/if}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</CardContent>
</Card>
