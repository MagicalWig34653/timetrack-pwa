<script lang="ts">
	import type { Snippet } from 'svelte';
	import ReauthNotice from '#lib/components/app/ReauthNotice.svelte';
	import Field from '#lib/components/app/Field.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { t } from '#lib/i18n/index.js';

	/**
	 * Modal confirmation for consequential account actions. With `typedHandle` the confirm button stays disabled until
	 * that exact handle is typed (ADR-0016). Errors, a pending state and the fresh-login hint are shown inside the dialog.
	 */
	let {
		open = $bindable(false),
		title,
		children,
		confirmLabel,
		tone = 'default',
		typedHandle,
		typedLabel,
		busy = false,
		error = '',
		warning = '',
		reauthNext,
		onconfirm,
		oncancel
	}: {
		open?: boolean;
		title: string;
		children?: Snippet;
		confirmLabel: string;
		tone?: 'default' | 'danger';
		typedHandle?: string;
		/** replaces the default "enter the username" label (e.g. when a word is typed) */
		typedLabel?: string;
		busy?: boolean;
		error?: string;
		/** non-error hint such as "retry" after a partial deletion */
		warning?: string;
		/** set when the server asked for a fresh login; value is the page to return to */
		reauthNext?: string;
		onconfirm: () => void;
		oncancel: () => void;
	} = $props();

	let dialog: HTMLDialogElement | undefined = $state();
	let typed = $state('');
	const matches = $derived(typedHandle === undefined || typed === typedHandle);

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) {
			typed = '';
			if (typeof dialog.showModal === 'function') dialog.showModal();
			else dialog.setAttribute('open', '');
		} else if (!open && dialog.open) {
			if (typeof dialog.close === 'function') dialog.close();
			else dialog.removeAttribute('open');
		}
	});

	function submit(event: Event) {
		event.preventDefault();
		if (!busy && matches) onconfirm();
	}
</script>

<dialog
	bind:this={dialog}
	aria-labelledby="confirm-dialog-title"
	class="glass-pop m-auto w-[min(34rem,calc(100vw-2rem))] rounded-2xl border p-0 text-popover-foreground shadow-[var(--shadow-pop)]"
	data-testid="confirm-dialog"
	onclose={() => {
		if (open) oncancel();
	}}
>
	{#if open}
		<form class="flex flex-col gap-4 p-6" onsubmit={submit}>
			<h2 id="confirm-dialog-title" class="text-[21px] leading-tight font-semibold">{title}</h2>
			<div class="flex flex-col gap-3 text-sm">{@render children?.()}</div>
			{#if typedHandle !== undefined}
				<Field
					id="confirm-handle"
					label={typedLabel ?? t('confirm.type_label', { handle: typedHandle })}
					hint={t('confirm.type_hint')}
					bind:value={typed}
					autocomplete="off"
					autocapitalize="off"
					spellcheck={false}
					data-testid="confirm-handle"
				/>
			{/if}
			{#if reauthNext}<ReauthNotice next={reauthNext} />{/if}
			{#if warning}<Alert variant="warning" data-testid="confirm-warning">{warning}</Alert>{/if}
			{#if error}<Alert variant="destructive" data-testid="confirm-error">{error}</Alert>{/if}
			<div class="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
				<Button type="button" variant="outline" onclick={oncancel} disabled={busy}>{t('common.cancel')}</Button>
				<Button type="submit" variant={tone === 'danger' ? 'destructive' : 'default'} disabled={busy || !matches} data-testid="confirm-submit">
					{confirmLabel}
				</Button>
			</div>
		</form>
	{/if}
</dialog>
