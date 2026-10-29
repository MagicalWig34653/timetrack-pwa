import { t } from '#lib/i18n/index.js';
import { timeDisplay } from '#lib/time/display.svelte.js';

/**
 * The time account counts completed days only (contract 0.36.0, ADR-0032). The running day stands apart:
 * "Heute: +0:42, fließt morgen ein". Null on older servers (no `includesToday: false`) and when there is no value.
 */
export function todayDeltaNote(source: { includesToday?: boolean; todayDeltaSeconds?: number | null } | null | undefined): string | null {
	if (!source || source.includesToday !== false) return null;
	const seconds = source.todayDeltaSeconds;
	if (typeof seconds !== 'number') return null;
	return t('account.today_note', { delta: timeDisplay.delta(seconds) });
}
