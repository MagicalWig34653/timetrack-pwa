<script lang="ts">
	import { page } from '$app/state';
	import ErrorPage from '#lib/components/app/ErrorPage.svelte';
</script>

<ErrorPage standalone status={page.status} errorId={page.error?.errorId} path={page.url.pathname} />
