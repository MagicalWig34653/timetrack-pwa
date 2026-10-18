<script lang="ts">
	import { t } from '#lib/i18n/index.js';
</script>

<ul class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" data-testid="timeline-legend">
	<li class="flex items-center gap-1.5"><span class="size-3 rounded-sm border border-primary bg-primary"></span>{t('planner.legend_vacation')}</li>
	<li class="flex items-center gap-1.5"><span class="size-3 rounded-sm border border-amber-500/70 bg-amber-500/20"></span>{t('planner.legend_holiday')}</li>
	<li class="flex items-center gap-1.5"><span class="size-3 rounded-sm bg-muted"></span>{t('planner.legend_weekend')}</li>
	<li class="flex items-center gap-1.5"><span class="size-3 rounded-sm border border-dashed border-emerald-600/70 bg-emerald-500/10"></span>{t('planner.legend_booked')}</li>
	<li class="flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-destructive"></span>{t('planner.legend_conflict')}</li>
</ul>
