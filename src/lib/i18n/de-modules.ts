// German UI texts for package L17 (ADR-0012): module switches in the account settings, the admin page and the disabled-module page.
export const deModules = {
	'nav.modules': 'Module',
	'nav.admin_modules': 'Module (Server)',

	'module.reports.name': 'Berichtsheft',
	'module.planning.name': 'Urlaub und Planung',
	'module.transfer.name': 'Import, Export und Anhänge',
	'module.automation.name': 'Automatik und Shortcuts',
	'module.mcp.name': 'KI-Zugang (MCP)',

	'module.reports.desc': 'Lernfelder, Berichtsheft-Einträge, Wochenansicht, Quellen und die kopierbare Textausgabe für das IHK-Portal. Ohne dieses Modul verschwinden auch die Berichtsheft-Erinnerungen.',
	'module.planning.desc': 'Urlaubskonto, Abwesenheiten, Kalender mit Feiertagen, Tagesplanung und Planfreigaben (ausgehend und eingehend). Ohne dieses Modul verschwinden auch die Erinnerungen zu Nachweisen.',
	'module.transfer.desc': 'Export als Tabelle, PDF oder CSV, Import aus CSV und Excel sowie Dateianhänge an Abwesenheiten und der Speicherort der Dateien.',
	'module.automation.desc': 'Gerätetoken für Shortcuts und andere Automatik sowie die daraus entstehenden Vorschläge für Zeiteinträge.',
	'module.mcp.desc': 'Anbindung von KI-Assistenten über MCP: Verbindungen (OAuth), persönliche Zugangstoken und die zugehörige Anleitung. Bestehende Zugänge werden abgelehnt, solange das Modul aus ist.',

	'modules.title': 'Module',
	'modules.description': 'Schalte Funktionen ab, die du nicht brauchst. Ausgeschaltete Module verschwinden aus Navigation, Startseite und Einstellungen.',
	'modules.note_data': 'Daten bleiben erhalten. Beim Wiedereinschalten ist alles wieder da.',
	'modules.note_planning':
		'Ist die Planung ausgeschaltet, wirken Abwesenheiten und Feiertage nicht auf die Tagesbewertung und das Zeitkonto, so als würdest du das Modul nicht nutzen. Manuell gesetzte Tagesmarkierungen bleiben bestehen. Freigaben deiner Planung sind dann unwirksam, ohne gelöscht zu werden.',
	'modules.state_on': 'Eingeschaltet',
	'modules.state_off': 'Ausgeschaltet',
	'modules.state_operator': 'Vom Betreiber deaktiviert',
	'modules.state_operator_hint': 'Der Betreiber hat dieses Modul für den ganzen Server abgeschaltet. Es kann hier nicht eingeschaltet werden.',
	'modules.state_server': 'Server deaktiviert',
	'modules.state_server_hint': 'Ein Administrator hat dieses Modul für den ganzen Server abgeschaltet. Es kann hier nicht eingeschaltet werden.',
	'modules.switch_label': '{name} nutzen',
	'modules.saved': 'Gespeichert.',
	'modules.unavailable': 'Dieser Server unterstützt Modulschalter noch nicht. Alle Funktionen stehen zur Verfügung.',
	'modules.load_error': 'Die Module konnten nicht geladen werden.',

	'modules.disabled_title': 'Dieses Modul ist deaktiviert',
	'modules.disabled_account': 'Das Modul „{name}“ ist für dein Konto ausgeschaltet. Du kannst es in den Einstellungen wieder einschalten, deine Daten sind noch da.',
	'modules.disabled_server': 'Das Modul „{name}“ wurde für diesen Server abgeschaltet und kann derzeit nicht genutzt werden.',
	'modules.disabled_generic': 'Dieses Modul ist ausgeschaltet.',
	'modules.disabled_settings': 'Zu den Moduleinstellungen',
	'modules.disabled_home': 'Zur Startseite',

	'admin_modules.title': 'Module des Servers',
	'admin_modules.description': 'Lege fest, welche Module auf diesem Server überhaupt verfügbar sind. Konten können verfügbare Module zusätzlich für sich abschalten.',
	'admin_modules.note': 'Abgeschaltete Module sind für alle Konten sofort unwirksam: Navigation, Seiten, Zugangstoken und Verbindungen. Daten werden nicht gelöscht.',
	'admin_modules.locked': 'Vom Betreiber gesperrt',
	'admin_modules.locked_hint': 'Per Umgebung des Servers deaktiviert; nicht in der Oberfläche änderbar.',
	'admin_modules.on': 'Verfügbar',
	'admin_modules.off': 'Abgeschaltet',
	'admin_modules.save': 'Änderungen speichern',
	'admin_modules.saved': 'Server-Module gespeichert.',
	'admin_modules.nothing_changed': 'Keine Änderungen.',
	'admin_modules.confirm_title': 'Module für alle Konten abschalten?',
	'admin_modules.confirm_body': 'Betrifft alle Konten. Folgende Module werden abgeschaltet: {names}. Die Daten bleiben erhalten.',
	'admin_modules.confirm_yes': 'Für alle abschalten',
	'admin_modules.forbidden': 'Nur Administratoren können die Module des Servers ändern.',

	'error.module_disabled': 'Dieses Modul ist deaktiviert. Du kannst es unter Einstellungen > Module einschalten, sofern der Betreiber es nicht abgeschaltet hat.',
	'error.module_locked': 'Dieses Modul ist vom Betreiber oder Server gesperrt und kann nicht geändert werden.'
} as const;
