<script lang="ts">
	import { goto } from '$app/navigation';
	import type { RecoveryStatus } from '#lib/api/types.js';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import RecoveryManager from '#lib/components/app/RecoveryManager.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { t } from '#lib/i18n/index.js';

	let status = $state<RecoveryStatus | null>(null);
	const anyActive = $derived(
		!!status && (status.recoveryCodes.active || status.fallbackPassword.active || status.email.active)
	);
</script>

<PageHeader title={t('setup.title')} description={t('setup.description')} />
<RecoveryManager bind:status />
{#if status}
	<div class="mt-6 flex flex-col gap-3">
		{#if !anyActive}<Alert variant="warning">{t('setup.none_warning')}</Alert>{/if}
		<div>
			<Button size="lg" variant={anyActive ? 'default' : 'outline'} onclick={() => goto('/')}>
				{anyActive ? t('setup.finish') : t('setup.skip')}
			</Button>
		</div>
	</div>
{/if}
