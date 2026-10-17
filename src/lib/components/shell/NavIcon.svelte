<script lang="ts">
	import Book from '@lucide/svelte/icons/book-open';
	import Bulb from '@lucide/svelte/icons/lightbulb';
	import Calendar from '@lucide/svelte/icons/calendar-days';
	import Clock from '@lucide/svelte/icons/clock';
	import Download from '@lucide/svelte/icons/download';
	import House from '@lucide/svelte/icons/house';
	import Invite from '@lucide/svelte/icons/user-plus';
	import Mail from '@lucide/svelte/icons/mail';
	import Modules from '@lucide/svelte/icons/layout-dashboard';
	import Absence from '@lucide/svelte/icons/calendar-off';
	import Plane from '@lucide/svelte/icons/plane';
	import Share from '@lucide/svelte/icons/share-2';
	import Storage from '@lucide/svelte/icons/hard-drive';
	import Week from '@lucide/svelte/icons/calendar-range';
	import Users from '@lucide/svelte/icons/users';
	import Upload from '@lucide/svelte/icons/upload';
	import type { NavItem } from '#lib/nav.js';

	let { name }: { name: NavItem['icon'] } = $props();
	const icons = { house: House, clock: Clock, week: Week, calendar: Calendar, book: Book, plane: Plane, absence: Absence, share: Share, bulb: Bulb, download: Download, upload: Upload, invite: Invite, users: Users, modules: Modules, storage: Storage, mail: Mail };
	const Icon = $derived(icons[name]);
</script>

<Icon class="size-[18px] shrink-0" aria-hidden="true" />
