<script lang="ts">
	// The admin pages share the settings shell (nav + content column), so switching between them does not jump (U8).
	import SettingsShell from '#lib/components/shell/SettingsShell.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<SettingsShell>{@render children()}</SettingsShell>
