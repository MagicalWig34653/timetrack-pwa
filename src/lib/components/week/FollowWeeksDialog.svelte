<script lang="ts">
	import FloatingPanel from '#lib/components/app/FloatingPanel.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { t } from '#lib/i18n/index.js';
	import { MAX_FOLLOW_WEEKS } from '#lib/week/follow.js';

	/** "Auf Folgewochen kopieren": the shown plan is written onto the next N weeks. Saved at once on the server, so no undo. */
	let {
		busy = false,
		error = '',
		anchor = null,
		returnFocus = null,
		onsubmit,
		onclose
	}: { busy?: boolean; error?: string; anchor?: DOMRect | null; returnFocus?: HTMLElement | null; onsubmit: (input: { weeks: number; overwrite: boolean }) => void; onclose: () => void } = $props();

	let weeks = $state('4');
	let overwrite = $state(false);
	const count = $derived(Math.round(Number(weeks)));
	const valid = $derived(Number.isInteger(count) && count >= 1 && count <= MAX_FOLLOW_WEEKS);
</script>

<FloatingPanel titleId="fw-title" {anchor} {returnFocus} {onclose} width={400} data-testid="follow-dialog">
	<form
		class="flex flex-col gap-4 p-5"
		aria-labelledby="fw-title"
		onsubmit={(e) => {
			e.preventDefault();
			if (valid && !busy) onsubmit({ weeks: count, overwrite });
		}}
	>
		<div>
			<h2 id="fw-title" class="text-lg leading-tight font-semibold">{t('wg.follow_title')}</h2>
			<p class="mt-0.5 text-xs text-muted-foreground">{t('wg.follow_hint')}</p>
		</div>
		{#if error}<Alert variant="destructive">{error}</Alert>{/if}
		<div class="flex flex-col gap-1.5">
			<Label for="fw-weeks">{t('wg.follow_weeks', { max: MAX_FOLLOW_WEEKS })}</Label>
			<Input id="fw-weeks" type="number" min="1" max={MAX_FOLLOW_WEEKS} inputmode="numeric" bind:value={weeks} aria-invalid={valid ? undefined : 'true'} data-testid="follow-weeks" />
		</div>
		<label class="flex items-start gap-2 text-sm"><Checkbox bind:checked={overwrite} class="mt-0.5" data-testid="follow-overwrite" />{t('wg.follow_overwrite')}</label>
		<p class="text-xs text-muted-foreground">{t('wg.follow_note')}</p>
		<div class="flex justify-end gap-2">
			<Button type="button" variant="ghost" onclick={onclose}>{t('wg.cancel')}</Button>
			<Button type="submit" disabled={!valid || busy} aria-busy={busy} data-testid="follow-submit">{busy ? t('wg.follow_busy') : t('wg.follow_submit')}</Button>
		</div>
	</form>
</FloatingPanel>
