<script lang="ts">
	import './layout.css';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import favicon from '#lib/assets/favicon.svg';
	import PwaBanners from '#lib/components/app/PwaBanners.svelte';
	import { shouldRegisterServiceWorker, pwa } from '#lib/pwa/pwa.svelte.js';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	onMount(() => {
		const stop = pwa.init();
		if (shouldRegisterServiceWorker({ prod: import.meta.env.PROD, flag: import.meta.env.VITE_SW }, window.location)) {
			void pwa.register((url) => void goto(url));
		}
		return stop;
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<PwaBanners />
{@render children()}
