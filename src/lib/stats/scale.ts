/** Axis helpers of the SVG charts (P12): "nice" ticks and label thinning. */

export function niceTicks(min: number, max: number, count = 4): number[] {
	if (!(max > min)) {
		max = min + 1;
	}
	const rawStep = (max - min) / count;
	const magnitude = 10 ** Math.floor(Math.log10(rawStep));
	const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rawStep) ?? rawStep;
	const start = Math.floor(min / step) * step;
	const ticks: number[] = [];
	for (let v = start; v <= max + step * 0.999; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
	return ticks;
}

/** Indexes of the categories whose label is drawn, at most one per `minGap` pixels. */
export function labelIndexes(count: number, width: number, minGap: number): Set<number> {
	if (count <= 0) return new Set();
	const every = Math.max(1, Math.ceil((count * minGap) / Math.max(width, 1)));
	const out = new Set<number>();
	for (let i = 0; i < count; i += every) out.add(i);
	return out;
}

/** Hour-based ticks for seconds values: a step of 1, 2, 5, 10, 20, 50 ... hours that fits about `count` ticks. */
export function hourTicks(minSeconds: number, maxSeconds: number, count = 4): number[] {
	const ticks = niceTicks(minSeconds / 3600, maxSeconds / 3600, count);
	return ticks.map((h) => h * 3600);
}
