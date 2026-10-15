<script lang="ts">
	import type { ModuleKey } from '#lib/api/types.js';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { t, type MessageKey } from '#lib/i18n/index.js';
	import { moduleStore } from '#lib/modules/store.svelte.js';
	import PageHeader from './PageHeader.svelte';

	let { module }: { module: ModuleKey } = $props();

	const name = $derived(t(`module.${module}.name` as MessageKey));
	const serverOff = $derived(moduleStore.statusOf(module)?.serverEnabled === false);
</script>

<div data-testid="module-disabled" data-module={module}>
	<PageHeader title={t('modules.disabled_title')} />
	<Alert variant="warning">
		{serverOff ? t('modules.disabled_server', { name }) : t('modules.disabled_account', { name })}
	</Alert>
	<div class="mt-4 flex flex-wrap gap-2">
		<Button href="/settings/modules">{t('modules.disabled_settings')}</Button>
		<Button variant="outline" href="/">{t('modules.disabled_home')}</Button>
	</div>
</div>
