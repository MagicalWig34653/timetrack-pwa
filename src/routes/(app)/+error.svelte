<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import ErrorPage from '#lib/components/app/ErrorPage.svelte';
</script>

<!-- Inside the app shell: navigation stays usable; a retry re-runs the failed loads without a full reload. -->
<ErrorPage status={page.status} errorId={page.error?.errorId} path={page.url.pathname} onretry={() => void invalidateAll()} />
