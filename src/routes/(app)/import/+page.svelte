<script lang="ts">
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import ImportWizard from '#lib/components/transfer/ImportWizard.svelte';
	import { t } from '#lib/i18n/index.js';
</script>

<PageHeader title={t('import.title')} description={t('import.description')} />
<ImportWizard />
