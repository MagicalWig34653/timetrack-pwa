/** Regions the holiday calculation of the backend knows (ISO 3166-2). The list is a UI convenience, the server validates. */
export const REGIONS: { code: string; name: string }[] = [
	{ code: 'DE-ST', name: 'Sachsen-Anhalt' },
	{ code: 'DE-BW', name: 'Baden-Württemberg' },
	{ code: 'DE-BY', name: 'Bayern' },
	{ code: 'DE-BE', name: 'Berlin' },
	{ code: 'DE-BB', name: 'Brandenburg' },
	{ code: 'DE-HB', name: 'Bremen' },
	{ code: 'DE-HH', name: 'Hamburg' },
	{ code: 'DE-HE', name: 'Hessen' },
	{ code: 'DE-MV', name: 'Mecklenburg-Vorpommern' },
	{ code: 'DE-NI', name: 'Niedersachsen' },
	{ code: 'DE-NW', name: 'Nordrhein-Westfalen' },
	{ code: 'DE-RP', name: 'Rheinland-Pfalz' },
	{ code: 'DE-SL', name: 'Saarland' },
	{ code: 'DE-SN', name: 'Sachsen' },
	{ code: 'DE-SH', name: 'Schleswig-Holstein' },
	{ code: 'DE-TH', name: 'Thüringen' },
	{ code: 'DE', name: 'Bundesweit' }
];

export const regionName = (code: string) => REGIONS.find((r) => r.code === code)?.name ?? code;

/** Defaults named in ADR-0005 for onboarding; only ever offered as suggestions. */
export const SUGGESTED_SETTINGS = { region: 'DE-ST', annualEntitlementHalfDays: 60 } as const;
