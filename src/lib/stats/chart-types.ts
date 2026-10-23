export interface ChartSeries {
	key: string;
	label: string;
	values: (number | null)[];
	/** Tailwind text colour class; fill and stroke use currentColor */
	cls: string;
	/** colour of negative bars when the series is diverging (defaults to cls) */
	negCls?: string;
}
