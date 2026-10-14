<script lang="ts">
	import { t } from '#lib/i18n/index.js';

	let { variant = 'outgoing' }: { variant?: 'outgoing' | 'incoming' } = $props();
</script>

<div class="rounded-lg border bg-muted/40 p-3 text-sm" data-testid="never-shared">
	<p class="font-medium">{t('share.never_title')}</p>
	<ul class="mt-1 list-disc pl-5 text-muted-foreground">
		<li>{t('share.never_notes')}</li>
		<li>{t('share.never_places')}</li>
		<li>{t('share.never_sick')}</li>
		<li>{t('share.never_documents')}</li>
	</ul>
	<p class="mt-2 text-xs text-muted-foreground">{variant === 'outgoing' ? t('share.never_outgoing') : t('share.never_incoming')}</p>
</div>
