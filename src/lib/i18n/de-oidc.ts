// German UI texts for the optional OpenID Connect sign-in (package L11, ADR-0007). Keys are English.
export const deOidc = {
	'nav.identities': 'Verknüpfte Anmeldungen',

	'oidc.login_button': 'Mit {name} anmelden',
	'oidc.redirecting': 'Weiterleitung zu {name} …',
	'oidc.register_button': 'Stattdessen mit {name} registrieren',
	'oidc.register_hint': 'Du kannst die Einladung auch mit einem externen Konto einlösen. Passkeys bleiben die empfohlene Anmeldung und lassen sich danach einrichten.',

	'oidc.error.oidc_not_linked':
		'Dieses externe Konto ist mit keinem Timetrack-Konto verknüpft. Lege dein Konto zuerst per Einladung an oder verknüpfe das externe Konto in den Einstellungen, nachdem du dich mit einem Passkey angemeldet hast.',
	'oidc.error.oidc_state_invalid': 'Die Anmeldung ist abgelaufen oder wurde schon verwendet. Bitte starte sie erneut.',
	'oidc.error.oidc_token_invalid': 'Der Anbieter hat keine gültige Bestätigung geliefert. Bitte versuche es erneut.',
	'oidc.error.oidc_identity_taken': 'Dieses externe Konto ist bereits mit einem anderen Timetrack-Konto verknüpft.',
	'oidc.error.oidc_invite_invalid': 'Die Einladung ist ungültig, abgelaufen oder bereits verwendet.',
	'oidc.error.oidc_reauth_required': 'Zur Sicherheit ist eine frische Anmeldung nötig. Melde dich erneut an und versuche es dann noch einmal.',
	'oidc.error.oidc_failed': 'Die Anmeldung über den externen Anbieter ist fehlgeschlagen. Bitte versuche es erneut.',

	'oidc.register.title': 'Konto mit {name} anlegen',
	'oidc.register.description': 'Dein externes Konto ist bestätigt. Wähle jetzt Kontoname und Anzeigename.',
	'oidc.register.submit': 'Konto anlegen',
	'oidc.register.waiting': 'Konto wird angelegt …',
	'oidc.register.expired': 'Diese Registrierung ist abgelaufen oder wurde bereits abgeschlossen. Starte sie bitte erneut.',

	'oidc.passkey_prompt.title': 'Passkey einrichten',
	'oidc.passkey_prompt.body':
		'Dein Konto ist angelegt. Passkeys sind die primäre Anmeldung bei Timetrack. Richte jetzt einen ein, damit du dich auch ohne externen Anbieter anmelden kannst.',
	'oidc.passkey_prompt.setup': 'Passkey einrichten',
	'oidc.passkey_prompt.later': 'Später',

	'identities.title': 'Verknüpfte Anmeldungen',
	'identities.description':
		'Externe Konten (OpenID Connect), mit denen du dich zusätzlich anmelden kannst. Passkeys bleiben die empfohlene Anmeldung.',
	'identities.linked_ok': 'Das externe Konto wurde verknüpft.',
	'identities.unlinked': 'Die Verknüpfung wurde entfernt.',
	'identities.email_hint': 'E-Mail laut Anbieter: {email} (nur Hinweis, wird nie zum Verknüpfen genutzt)',
	'identities.linked_at': 'Verknüpft am {date}',
	'identities.last_used': 'zuletzt genutzt am {date}',
	'identities.never_used': 'noch nicht genutzt',
	'identities.empty': 'Noch kein externes Konto verknüpft.',
	'identities.link': 'Konto verknüpfen',
	'identities.link_with': 'Du wirst zu {name} weitergeleitet und kommst danach hierher zurück.',
	'identities.disabled': 'Auf diesem Server ist keine externe Anmeldung eingerichtet. Bestehende Verknüpfungen kannst du trotzdem entfernen.',
	'identities.reauth_title': 'Frische Anmeldung nötig',
	'identities.reauth_body': 'Für diese Änderung musst du dich zur Sicherheit erneut anmelden. Melde dich ab, melde dich neu an und versuche es dann noch einmal.',
	'identities.reauth_action': 'Abmelden und neu anmelden',
	'identities.unlink': 'Verknüpfung entfernen',
	'identities.unlink_confirm': 'Verknüpfung endgültig entfernen',
	'identities.unlink_warning': 'Danach kannst du dich nicht mehr über {name} anmelden.',
	'mockidp.title': 'Mock-Anbieter „{name}“',
	'mockidp.description': 'Nur im Mock-Modus: Simuliert den externen Anbieter (Zweck: {purpose}). Wähle den Ausgang der Anmeldung.',
	'mockidp.user1': 'Als Demo-Nutzer 1 bestätigen',
	'mockidp.user2': 'Als Demo-Nutzer 2 bestätigen (bereits mit dem Konto „lena“ verknüpft)',
	'mockidp.errors': 'Oder einen Fehler simulieren',
	'error.last_login_method':
		'Das ist deine letzte Anmeldemethode. Richte zuerst einen Passkey oder eine andere Verknüpfung ein.'
} as const;
