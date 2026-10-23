<script lang="ts">
	import './planner-colors.css';
	import type { Place, PlanMode } from '#lib/api/types.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Select } from '#lib/components/ui/select/index.js';
	import { t } from '#lib/i18n/index.js';
	import { PLAN_MODES, planModeLabel } from '#lib/planning/labels.js';
	import type { GridTool } from './WeekGrid.svelte';
	import Eraser from '@lucide/svelte/icons/eraser';
	import Ghost from '@lucide/svelte/icons/ghost';
	import MousePointer2 from '@lucide/svelte/icons/mouse-pointer-2';
	import Paintbrush from '@lucide/svelte/icons/paintbrush';
	import Plus from '@lucide/svelte/icons/plus';
	import Redo2 from '@lucide/svelte/icons/redo-2';
	import Undo2 from '@lucide/svelte/icons/undo-2';

	/** Drawing tools of the week grid: tool, brush (kind and optional place), undo/redo, ghost toggle, keyboard-friendly "add block". */
	let {
		tool = $bindable(),
		mode = $bindable(),
		placeId = $bindable(),
		showActuals = $bindable(),
		places,
		canUndo,
		canRedo,
		undoLabel,
		redoLabel,
		onundo,
		onredo,
		onadd
	}: {
		tool: GridTool;
		mode: PlanMode;
		placeId: string;
		showActuals: boolean;
		places: Place[];
		canUndo: boolean;
		canRedo: boolean;
		undoLabel: string | null;
		redoLabel: string | null;
		onundo: () => void;
		onredo: () => void;
		onadd: () => void;
	} = $props();

	const tools: { id: GridTool; label: string; key: string; icon: typeof Paintbrush }[] = [
		{ id: 'select', label: t('wg.tool_select'), key: 'V', icon: MousePointer2 },
		{ id: 'draw', label: t('wg.tool_draw'), key: 'B', icon: Paintbrush },
		{ id: 'erase', label: t('wg.tool_erase'), key: 'E', icon: Eraser }
	];
	const seg = 'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground aria-checked:bg-background aria-checked:text-foreground aria-checked:shadow-sm aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';
</script>

<div class="flex flex-wrap items-center gap-x-3 gap-y-2" role="toolbar" aria-label={t('wg.toolbar')} data-testid="planner-toolbar">
	<div class="inline-flex rounded-lg bg-muted p-0.5" role="group" aria-label={t('wg.tools')}>
		{#each tools as item (item.id)}
			<button type="button" class={seg} aria-pressed={tool === item.id} onclick={() => (tool = item.id)} title="{item.label} ({item.key})" data-testid="tool-{item.id}">
				<item.icon class="size-4" /><span class="max-xl:sr-only">{item.label}</span>
			</button>
		{/each}
	</div>

	<div class="inline-flex max-w-full overflow-x-auto rounded-lg bg-muted p-0.5" role="radiogroup" aria-label={t('wg.brush_kind')} data-testid="brush-kinds">
		{#each PLAN_MODES as option (option)}
			<button type="button" role="radio" class={seg} aria-checked={mode === option} data-plan-mode={option} onclick={() => { mode = option; if (tool === 'erase') tool = 'draw'; }} data-testid="brush-{option}">
				<span class="size-2.5 rounded-full" style="background: var(--pm)"></span>{planModeLabel(option)}
			</button>
		{/each}
	</div>

	<div class="flex items-center gap-2">
		<label class="sr-only" for="brush-place">{t('wg.brush_place')}</label>
		<Select id="brush-place" bind:value={placeId} class="h-8 w-36 text-[13px]" data-testid="brush-place" disabled={mode === 'off'}>
			<option value="">{t('wg.brush_no_place')}</option>
			{#each places.filter((p) => !p.archived) as place (place.id)}<option value={place.id}>{place.name}</option>{/each}
		</Select>
	</div>

	<div class="flex flex-wrap items-center gap-2 lg:ml-auto">
		<Button variant="outline" size="icon" class="size-8" onclick={onundo} disabled={!canUndo} aria-label={undoLabel ? t('wg.undo_named', { label: undoLabel }) : t('wg.undo')} title="{t('wg.undo')} (Strg+Z)" data-testid="plan-undo"><Undo2 /></Button>
		<Button variant="outline" size="icon" class="size-8" onclick={onredo} disabled={!canRedo} aria-label={redoLabel ? t('wg.redo_named', { label: redoLabel }) : t('wg.redo')} title="{t('wg.redo')} (Strg+Umschalt+Z)" data-testid="plan-redo"><Redo2 /></Button>
		<button type="button" class="{seg} border border-border bg-background" aria-pressed={showActuals} onclick={() => (showActuals = !showActuals)} data-testid="toggle-actuals" title={t('wg.actuals_hint')}>
			<Ghost class="size-4" />{t('wg.actuals')}
		</button>
		<Button size="sm" onclick={onadd} data-testid="plan-add-block"><Plus />{t('wg.add_block')}</Button>
	</div>
</div>
