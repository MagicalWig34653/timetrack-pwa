<script lang="ts">
	import type { PlanBlockKind } from '#lib/api/types.js';
	import Briefcase from '@lucide/svelte/icons/briefcase';
	import Building2 from '@lucide/svelte/icons/building-2';
	import Car from '@lucide/svelte/icons/car';
	import GraduationCap from '@lucide/svelte/icons/graduation-cap';
	import House from '@lucide/svelte/icons/house';
	import Users from '@lucide/svelte/icons/users';

	/** Icon of a plan block kind. Together with the colour and the pattern it keeps the kinds apart without relying on colour. */
	let { kind, class: className = 'size-3.5' }: { kind: PlanBlockKind; class?: string } = $props();
</script>

{#if kind === 'work'}
	<Briefcase class={className} aria-hidden="true" />
{:else if kind === 'school'}
	<GraduationCap class={className} aria-hidden="true" />
{:else if kind === 'travel'}
	<Car class={className} aria-hidden="true" />
{:else if kind === 'office'}
	<Building2 class={className} aria-hidden="true" />
{:else if kind === 'home'}
	<House class={className} aria-hidden="true" />
{:else}
	<Users class={className} aria-hidden="true" />
{/if}
