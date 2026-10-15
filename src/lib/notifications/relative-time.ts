import { t } from '../i18n/index';

/** German relative time for the center list ("vor 5 Min.", "gestern"); older entries are shown as a date by the caller. */
export function relativeTime(iso: string, now: number = Date.now()): string {
	const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
	if (seconds < 60) return t('notifications.relative_now');
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return t('notifications.relative_minutes', { count: minutes });
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return t('notifications.relative_hours', { count: hours });
	const days = Math.floor(hours / 24);
	if (days === 1) return t('notifications.relative_day');
	if (days < 14) return t('notifications.relative_days', { count: days });
	return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(new Date(iso));
}
