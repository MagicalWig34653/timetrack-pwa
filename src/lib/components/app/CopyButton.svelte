<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.js';
	import { copyText } from '#lib/browser.js';
	import { t } from '#lib/i18n/index.js';
	import CheckIcon from '@lucide/svelte/icons/check';
	import CopyIcon from '@lucide/svelte/icons/copy';

	let { text, label = t('common.copy') }: { text: string; label?: string } = $props();
	let state = $state<'idle' | 'copied' | 'failed'>('idle');

	async function copy() {
		state = (await copyText(text)) ? 'copied' : 'failed';
		setTimeout(() => (state = 'idle'), 2500);
	}
</script>

<Button variant="outline" size="sm" onclick={copy}>
	{#if state === 'copied'}<CheckIcon />{t('common.copied')}{:else if state === 'failed'}{t('common.copy_failed')}{:else}<CopyIcon />{label}{/if}
</Button>
