<script lang="ts">
	import Briefcase from '@lucide/svelte/icons/briefcase';
	import Flag from '@lucide/svelte/icons/flag';
	import GraduationCap from '@lucide/svelte/icons/graduation-cap';
	import HeartPulse from '@lucide/svelte/icons/heart-pulse';
	import Plane from '@lucide/svelte/icons/plane';
	import Sun from '@lucide/svelte/icons/sun';
	import Umbrella from '@lucide/svelte/icons/umbrella';
	import type { WeekMark } from '#lib/api/types.js';

	/** One icon per day mark, shared by the week overview and its legend so the same thing always looks the same. */
	let { mark, class: className = 'size-3.5' }: { mark: WeekMark; class?: string } = $props();
	const icons = { work: Briefcase, school: GraduationCap, vacation: Plane, sick: HeartPulse, holiday: Flag, excused: Umbrella, off: Sun };
	const Icon = $derived(icons[mark]);
</script>

<Icon class={className} aria-hidden="true" />
