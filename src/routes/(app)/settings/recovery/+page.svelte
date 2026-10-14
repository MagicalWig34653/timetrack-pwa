<script lang="ts">
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import RecoveryManager from '#lib/components/app/RecoveryManager.svelte';
	import { t } from '#lib/i18n/index.js';
</script>

<PageHeader title={t('recovery.title')} description={t('recovery.description')} />
<RecoveryManager />
