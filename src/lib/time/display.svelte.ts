import { formatDelta, formatDuration } from './format';

/** How durations are shown: "7:42" (hm) or decimal hours "7,70 h". Input fields and exports always stay h:mm. */
export type TimeDisplayMode = 'hm' | 'decimal';

const KEY = 'tt.timeDisplay';

function read(): TimeDisplayMode {
	try {
		return localStorage.getItem(KEY) === 'decimal' ? 'decimal' : 'hm';
	} catch {
		return 'hm';
	}
}

/** 27720 -> "7,70 h"; negative values keep the sign; sub-minute remainders are truncated like formatDuration. */
export function formatDecimalHours(seconds: number): string {
	const minutes = Math.floor(Math.abs(seconds) / 60);
	const sign = seconds < 0 && minutes > 0 ? '-' : '';
	const hours = (Math.round((minutes / 60) * 100) / 100).toFixed(2).replace('.', ',');
	return `${sign}${hours} h`;
}

export function formatDecimalDelta(seconds: number): string {
	const text = formatDecimalHours(seconds);
	return seconds > 0 && !text.startsWith('-') ? `+${text}` : text;
}

let mode = $state<TimeDisplayMode>(read());

export const timeDisplay = {
	get mode(): TimeDisplayMode {
		return mode;
	},
	set(next: TimeDisplayMode): void {
		mode = next;
		try {
			localStorage.setItem(KEY, next);
		} catch {
			// storage can be blocked; the choice then only lasts for this tab
		}
	},
	toggle(): void {
		this.set(mode === 'hm' ? 'decimal' : 'hm');
	},
	/** Reactive: follows the global mode. */
	duration(seconds: number): string {
		return mode === 'decimal' ? formatDecimalHours(seconds) : formatDuration(seconds);
	},
	/** Reactive, with an explicit "+" for positive values. */
	delta(seconds: number): string {
		return mode === 'decimal' ? formatDecimalDelta(seconds) : formatDelta(seconds);
	}
};

/** Test helper: re-read the stored choice. */
export function reloadTimeDisplay(): void {
	mode = read();
}
