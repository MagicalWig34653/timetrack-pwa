import { t } from '#lib/i18n/index.js';
import { formatDuration } from '#lib/time/format.js';
import type { WeekBalance } from './week-balance.js';

/** "+2:10 h" / "−3:05 h" (typographic minus); an open week below its Soll reads neutrally "noch 3:05 h offen". */
export function weekBalanceLabel(balance: WeekBalance): string {
	const { deltaSeconds, state } = balance;
	const abs = formatDuration(Math.abs(deltaSeconds));
	if (Math.floor(Math.abs(deltaSeconds) / 60) === 0) return t('cal.week_balance_even');
	if (deltaSeconds > 0) return `+${abs} h`;
	return state === 'open' ? t('cal.week_balance_open', { time: abs }) : `−${abs} h`;
}

/** Tooltip and screen reader text: the difference in words plus Soll and Ist. */
export function weekBalanceTitle(balance: WeekBalance): string {
	const abs = formatDuration(Math.abs(balance.deltaSeconds));
	const even = Math.floor(Math.abs(balance.deltaSeconds) / 60) === 0;
	const head = even
		? t('cal.week_balance_even_long')
		: balance.deltaSeconds > 0
			? t('cal.week_balance_over', { time: abs })
			: t(balance.state === 'open' ? 'cal.week_balance_open_long' : 'cal.week_balance_under', { time: abs });
	return t('cal.week_balance_title', { head, target: formatDuration(balance.targetSeconds), actual: formatDuration(balance.actualSeconds) });
}
