// German UI texts for plan blocks (package P13, contract 0.35.0). Keys are English.
export const deP13 = {
	'plan.kind.work': 'Arbeit',
	'plan.kind.school': 'Schule',
	'plan.kind.travel': 'Fahrt',
	'plan.kind.office': 'Büro',
	'plan.kind.home': 'Homeoffice',
	'plan.kind.customer': 'Kunde',

	'plan.hint.planned_break_short': '{day}: Die geplanten Pausen sind kürzer als bei dieser Arbeitsdauer üblich (30 Min. ab 6 Std., 45 Min. ab 9 Std.).',
	'plan.hint.planned_work_stretch_long': '{day}: Am Stück sind mehr als 6 Stunden Arbeit geplant, ohne Lücke von mindestens 15 Minuten.',
	'plan.hint.planned_break_part_short': '{day}: Eine geplante Lücke unter 15 Minuten zählt nicht als Pause.',

	'wg.plan_hints': 'Planungshinweise',
	'wg.plan_hints_note': 'Unverbindliche Hinweise zur Planung (Erwachsenenprofil). Sie hindern das Speichern nicht; die Bewertung der tatsächlichen Zeiten bleibt davon getrennt.',

	'wg.block_position': 'Block {n} von {total}',
	'wg.day_mode_edit': 'Tagesart {mode}, bearbeiten',
	'wg.did_split': 'Block geteilt.',
	'wg.did_merge': 'Blöcke verbunden.',
	'wg.say_split_short': 'Der Block ist zu kurz zum Teilen.',
	'wg.menu_split': 'Block hier teilen',
	'wg.menu_merge': 'Mit nächstem Block verbinden',
	'wg.menu_break_legacy': 'Pause setzen: {minutes} Min.',

	'wg.dialog_day_label': 'Tag',
	'wg.dialog_day_mode': 'Tagesart',
	'wg.dialog_kind': 'Art des Blocks',
	'wg.dialog_day_note': 'Notiz zum Tag',
	'wg.dialog_day_hint': 'Die Tagesart gilt für den ganzen Tag. „Frei“ entfernt die Blöcke.',
	'wg.dialog_hint_multi': 'Ein Tag kann mehrere Blöcke mit Lücken haben, zum Beispiel Schule und Arbeit. Blöcke dürfen sich nicht überschneiden.',
	'wg.dialog_delete_day': 'Plan des Tages löschen',

	'wg.list_add_block': 'Block hinzufügen',
	'wg.list_remove_block': 'Block {n} entfernen',
	'wg.list_gaps_hint': 'Lücken zwischen den Blöcken sind Pausen.',

	'weekplan.problem.blocks_overlap': 'Die Blöcke dieses Tages überschneiden sich.',
	'weekplan.problem.too_many_blocks': 'Ein Tag kann höchstens 32 Blöcke haben.',
	'weekplan.problem.note_too_long': 'Eine Notiz darf höchstens 200 Zeichen haben.',

	'weekview.plan_diff': 'Plan {delta}',
	'weekview.plan_diff_title': 'Bewertete Arbeitszeit plus Gutschrift gegenüber der geplanten Dauer',
	'weekview.aria_plan_diff': 'gegenüber Plan {delta}',
	'weekview.plan_actual': 'Plan und Ist',
	'weekview.plan_actual_equal': 'Genau wie geplant.',
	'weekview.plan_actual_over': '{time} mehr als geplant.',
	'weekview.plan_actual_under': '{time} weniger als geplant.',
	'calendar.plan_blocks': '{count} Blöcke',
	'pd.blocks_hint': 'Dieser Tag hat {count} Blöcke ({blocks}). Sie bleiben erhalten, solange Beginn, Ende und Pause unverändert sind; sonst wird der Tag durch ein einzelnes Zeitfenster ersetzt. Blöcke bearbeitest du im Wochenplaner.',

	'error.plan_blocks_overlap': 'Die Blöcke eines Tages dürfen sich nicht überschneiden und müssen zeitlich geordnet sein.',
	'error.plan_blocks_invalid': 'Ein Tag kann höchstens 32 Blöcke haben, und ein freier Tag hat keine Blöcke.',
	'error.plan_kind_invalid': 'Die Art eines Blocks ist ungültig.',
	'error.plan_note_invalid': 'Die Notiz eines Blocks ist zu lang (höchstens 200 Zeichen).'
} as const;
