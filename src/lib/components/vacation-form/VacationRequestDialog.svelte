<script module lang="ts">
	import type { AbsenceStatus } from '#lib/api/types.js';

	export interface RequestTarget {
		id?: string;
		startDate: string;
		endDate: string;
		halfDayStart?: boolean;
		halfDayEnd?: boolean;
		status: AbsenceStatus;
	}
</script>

<script lang="ts">
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { formatDateNumeric } from '#lib/time/dates.js';
	import { todayLocal } from '#lib/time/dates.js';
	import { zoneStore } from '#lib/time/zone.svelte.js';
	import { saveBlob } from '#lib/transfer/export.js';
	import { formatDaysDe, formatFormDate } from '#lib/vacation-form/format.js';
	import { fitRanges } from '#lib/vacation-form/days.js';
	import { buildRequestData, loadRequestSources } from '#lib/vacation-form/request.js';
	import { requestFileName } from '#lib/vacation-form/pdf-limits.js';
	import { currentFormStore } from '#lib/vacation-form/store-instance.js';
	import type { StoredTemplate } from '#lib/vacation-form/form-template-store.js';
	import type { RequestData } from '#lib/vacation-form/types.js';

	/**
	 * Small dialog that fills the user's own template for one vacation absence: asks for the substitute, lets the user
	 * confirm the free days, generates the PDF in the browser and offers download, open and print.
	 */
	let { target, onclose }: { target: RequestTarget | null; onclose: () => void } = $props();

	let dialog: HTMLDialogElement | undefined = $state();
	let phase = $state<'loading' | 'no_template' | 'form' | 'error'>('loading');
	let error = $state('');
	let template: StoredTemplate | null = null;
	let data = $state<RequestData | null>(null);
	let substitute = $state('');
	let freeConfirmed = $state(true);
	let flatten = $state(false);
	let generating = $state(false);
	let skipped = $state<string[]>([]);
	let result = $state<{ blob: Blob; url: string; name: string } | null>(null);
	let closeButton: HTMLButtonElement | null = $state(null);
	const uid = $props.id();

	/** Highest free-range position the template addresses; 0 when it has no such field. */
	const slots = $derived.by(() => {
		if (!template) return 0;
		const bindings = [...Object.values(template.mapping.fields), ...template.mapping.overlays.map((overlay) => overlay.binding)];
		return bindings.reduce((max, binding) => (/^freeRange/.test(binding.source) ? Math.max(max, binding.index ?? 1) : max), 0);
	});
	const fit = $derived(data ? fitRanges(data.freeRanges, Math.max(slots, 0)) : { shown: [], overflow: [] });
	const rangeText = (range: { from: string; to: string }) =>
		range.from === range.to ? formatFormDate(range.from, 'dd.MM.yyyy') : `${formatFormDate(range.from, 'dd.MM.yyyy')} - ${formatFormDate(range.to, 'dd.MM.yyyy')}`;

	function release() {
		if (result) URL.revokeObjectURL(result.url);
		result = null;
	}

	$effect(() => {
		const current = target;
		if (!dialog) return;
		if (!current) {
			if (dialog.open) (typeof dialog.close === 'function' ? dialog.close() : dialog.removeAttribute('open'));
			return;
		}
		if (!dialog.open) (typeof dialog.showModal === 'function' ? dialog.showModal() : dialog.setAttribute('open', ''));
		let cancelled = false;
		phase = 'loading';
		error = '';
		skipped = [];
		substitute = '';
		freeConfirmed = true;
		void (async () => {
			try {
				const store = currentFormStore();
				const stored = await store.load();
				if (cancelled) return;
				if (!stored) {
					phase = 'no_template';
					return;
				}
				const sources = await loadRequestSources(current.startDate, current.endDate);
				if (cancelled) return;
				const zone = await zoneStore.ensure().catch(() => undefined);
				template = stored;
				flatten = stored.mapping.flatten;
				data = buildRequestData({
					from: current.startDate,
					to: current.endDate,
					halfDayStart: current.halfDayStart,
					halfDayEnd: current.halfDayEnd,
					today: todayLocal(zone),
					...sources,
					inBalance: current.status !== 'cancelled' && current.status !== 'rejected',
					targetId: current.id
				});
				phase = 'form';
				closeButton?.focus();
			} catch (e) {
				if (cancelled) return;
				error = errorMessage(e);
				phase = 'error';
			}
		})();
		return () => {
			cancelled = true;
			release();
		};
	});

	async function generate(event: Event) {
		event.preventDefault();
		if (!template || !data || generating) return;
		generating = true;
		error = '';
		release();
		try {
			const { fillPdf } = await import('#lib/vacation-form/pdf.js');
			const filled = await fillPdf(
				template.bytes,
				template.mapping,
				{ ...data, substitute, freeRanges: freeConfirmed ? data.freeRanges : [] },
				{ flatten }
			);
			skipped = filled.skipped;
			const blob = new Blob([filled.bytes as BlobPart], { type: 'application/pdf' });
			result = { blob, url: URL.createObjectURL(blob), name: requestFileName(data.from, data.to) };
		} catch {
			error = t('vform.dialog_error');
		} finally {
			generating = false;
		}
	}

	function download() {
		if (result) saveBlob(result.blob, result.name);
	}
	function openInTab() {
		if (result) window.open(result.url, '_blank', 'noopener');
	}
	function print() {
		if (!result) return;
		// The PDF goes into a hidden frame of the same page, so nothing is uploaded anywhere.
		const frame = document.createElement('iframe');
		frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden';
		frame.src = result.url;
		frame.onload = () => {
			try {
				frame.contentWindow?.print();
			} catch {
				window.open(result!.url, '_blank', 'noopener');
			}
			setTimeout(() => frame.remove(), 60_000);
		};
		document.body.appendChild(frame);
	}
	function closeDialog() {
		if (dialog && typeof dialog.close === 'function') dialog.close();
		else onclose();
	}
</script>

<dialog
	bind:this={dialog}
	aria-labelledby="{uid}-title"
	class="m-auto max-h-[calc(100dvh-2rem)] w-[min(34rem,calc(100vw-2rem))] glass-pop overflow-auto rounded-2xl border p-0 text-popover-foreground shadow-[var(--shadow-pop)]"
	data-testid="request-dialog"
	onclose={onclose}
>
	<div class="flex flex-col gap-4 p-4 sm:p-6">
		<div>
			<h2 id="{uid}-title" class="text-lg font-semibold">{t('vform.dialog_title')}</h2>
			{#if target}<p class="text-sm text-muted-foreground">{t('vform.dialog_period', { start: formatDateNumeric(target.startDate), end: formatDateNumeric(target.endDate) })}</p>{/if}
		</div>

		{#if phase === 'loading'}
			<p class="text-sm text-muted-foreground" data-testid="request-loading">{t('vform.dialog_loading')}</p>
		{:else if phase === 'no_template'}
			<Alert data-testid="request-no-template">{t('vform.dialog_no_template')}</Alert>
			<div><Button href="/settings/vacation-form">{t('vform.dialog_open_settings')}</Button></div>
		{:else if phase === 'error'}
			<Alert variant="destructive" data-testid="request-error">{error}</Alert>
		{:else if data}
			<form class="flex flex-col gap-4" onsubmit={generate}>
				<dl class="grid grid-cols-2 gap-3 text-sm">
					<div><dt class="text-muted-foreground">{t('vform.source.working_days')}</dt><dd class="text-xl font-semibold tabular-nums" data-testid="request-working-days">{formatDaysDe(data.workingDays)}</dd></div>
					<div>
						<dt class="text-muted-foreground">{t('vform.source.rest_before')} / {t('vform.source.rest_after')}</dt>
						<dd class="text-xl font-semibold tabular-nums" data-testid="request-rest">{formatDaysDe(data.restBeforeHalfDays / 2)} / {formatDaysDe(data.restAfterHalfDays / 2)}</dd>
					</div>
				</dl>
				{#if data.breakdown}
					{@const b = data.breakdown}
					<dl class="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-lg border bg-muted/30 p-3 text-sm tabular-nums" data-testid="request-breakdown">
						<dt>{t('vform.bd.entitlement')}</dt><dd class="text-right">{formatDaysDe(b.entitlementTotalHalfDays / 2)}</dd>
						<dt>{t('vform.bd.booked')}</dt><dd class="text-right">{formatDaysDe(b.bookedHalfDays / 2)}</dd>
						<dt>{t('vform.bd.requested')}</dt><dd class="text-right">{formatDaysDe(b.requestedOthersHalfDays / 2)}</dd>
						<dt>{t('vform.bd.planned')}</dt><dd class="text-right" data-testid="request-planned-others">{formatDaysDe(b.plannedOthersHalfDays / 2)}</dd>
						<dt class="font-medium">{t('vform.bd.this_request')}</dt><dd class="text-right font-medium">{formatDaysDe(b.requestHalfDays / 2)}</dd>
						{#if b.plannedOthersHalfDays > 0}
							<dt class="text-muted-foreground">{t('vform.bd.rest_incl_planned')}</dt><dd class="text-right text-muted-foreground" data-testid="request-rest-incl">{formatDaysDe(b.restBeforeInclPlannedHalfDays / 2)} / {formatDaysDe(b.restAfterInclPlannedHalfDays / 2)}</dd>
						{/if}
					</dl>
					<p class="text-xs text-muted-foreground">{t('vform.bd.note')}</p>
				{/if}
				<p class="text-xs text-muted-foreground">{t('vform.dialog_stale_balance', { year: data.from.slice(0, 4) })}</p>

				<div class="flex flex-col gap-1.5">
					<Label for="{uid}-substitute">{t('vform.dialog_substitute')}</Label>
					<Input id="{uid}-substitute" bind:value={substitute} maxlength={200} autocomplete="off" data-testid="request-substitute" />
					<p class="text-xs text-muted-foreground">{t('vform.dialog_substitute_hint')}</p>
				</div>

				<fieldset class="flex flex-col gap-2" data-testid="request-free">
					<legend class="text-sm font-medium">{t('vform.dialog_free_title')}</legend>
					{#if data.freeRanges.length === 0}
						<p class="text-sm text-muted-foreground">{t('vform.dialog_free_none')}</p>
					{:else}
						<ul class="list-disc pl-5 text-sm" data-testid="request-free-list">
							{#each data.freeRanges as range (range.from)}<li>{rangeText(range)}</li>{/each}
						</ul>
						<div class="flex items-start gap-2">
							<Checkbox id="{uid}-free" bind:checked={freeConfirmed} class="mt-0.5" data-testid="request-free-confirm" />
							<Label for="{uid}-free">{t('vform.dialog_free_confirm')}</Label>
						</div>
						{#if slots > 0 && fit.overflow.length > 0 && freeConfirmed}
							<Alert variant="warning" data-testid="request-free-overflow">{t('vform.dialog_free_overflow', { slots, rest: fit.overflow.map(rangeText).join(', ') })}</Alert>
						{/if}
					{/if}
				</fieldset>

				<div class="flex items-center gap-2">
					<Checkbox id="{uid}-flatten" bind:checked={flatten} />
					<Label for="{uid}-flatten">{t('vform.dialog_flatten')}</Label>
				</div>

				{#if error}<Alert variant="destructive" data-testid="request-error">{error}</Alert>{/if}
				{#if result}
					<Alert variant="success" data-testid="request-ready">{t('vform.dialog_ready')} <span class="font-mono text-xs break-all">{result.name}</span></Alert>
					{#if skipped.length > 0}<Alert variant="warning" data-testid="request-skipped">{t('vform.dialog_skipped', { names: skipped.join(', ') })}</Alert>{/if}
				{/if}

				<div class="flex flex-wrap justify-end gap-2">
					<Button type="submit" variant={result ? 'outline' : 'default'} disabled={generating} data-testid="request-generate">{generating ? t('vform.dialog_generating') : t('vform.dialog_generate')}</Button>
					{#if result}
						<Button type="button" onclick={download} data-testid="request-download">{t('vform.dialog_download')}</Button>
						<Button type="button" variant="outline" onclick={openInTab} data-testid="request-open">{t('vform.dialog_open')}</Button>
						<Button type="button" variant="outline" onclick={print} data-testid="request-print">{t('vform.dialog_print')}</Button>
					{/if}
				</div>
			</form>
		{/if}

		<div class="flex justify-end">
			<Button type="button" variant="ghost" bind:ref={closeButton} onclick={closeDialog} data-testid="request-close">{t('vform.dialog_close')}</Button>
		</div>
	</div>
</dialog>
