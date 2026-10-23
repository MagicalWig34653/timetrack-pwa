<script lang="ts">
	import { t } from '#lib/i18n/index.js';
	import { weekBalanceLabel, weekBalanceTitle } from '#lib/planning/week-balance-text.js';
	import { weekBalanceTone, type WeekBalance } from '#lib/planning/week-balance.js';

	/** Hour difference of a calendar week against its Soll: subtle colour, tooltip with Soll and Ist, accessible text. */
	let { balance, week, class: className = '' }: { balance: WeekBalance; week: number; class?: string } = $props();

	const tone = $derived(weekBalanceTone(balance));
	const TONES = { positive: 'text-emerald-700 dark:text-emerald-300', warning: 'text-amber-700 dark:text-amber-300', neutral: 'text-muted-foreground' } as const;
</script>

<span
	class="block text-[10px] leading-tight font-medium tabular-nums {TONES[tone]} {className}"
	title={weekBalanceTitle(balance)}
	role="note"
	aria-label={t('cal.week_balance_aria', { n: week, text: weekBalanceTitle(balance) })}
	data-testid="week-balance"
	data-state={balance.state}
	data-tone={tone}
>
	<span aria-hidden="true">{weekBalanceLabel(balance)}</span>
</span>
