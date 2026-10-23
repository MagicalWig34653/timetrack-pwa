<script lang="ts">
	import SettingsShell from '#lib/components/shell/SettingsShell.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<SettingsShell>{@render children()}</SettingsShell>
