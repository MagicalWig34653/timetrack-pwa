<script lang="ts">
	import { page } from '$app/state';
	import { t } from '#lib/i18n/index.js';
	import { OIDC_ERROR_CODES } from '#lib/api/types.js';

	// Stand-in for the external provider in mock mode (npm run dev:mock). Not part of the real product:
	// without VITE_MOCK the page only says that it does not exist.
	const mock = import.meta.env.VITE_MOCK === '1';
	const flow = page.url.searchParams.get('flow') ?? '';
	const purpose = page.url.searchParams.get('purpose') ?? 'login';
	const name = page.url.searchParams.get('name') ?? 'Mock-IdP';
	const callback = (outcome: string) => `/api/v1/auth/oidc/callback?flow=${encodeURIComponent(flow)}&outcome=${encodeURIComponent(outcome)}`;
	// only errors that a provider round trip can plausibly produce are offered
	const errors = OIDC_ERROR_CODES.filter((code) => code !== 'oidc_not_linked');
	const linkClass = 'block rounded-md border px-4 py-3 text-sm hover:bg-muted';
</script>

<svelte:head><title>{name} – Timetrack</title></svelte:head>
<main class="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 px-4 py-10">
	{#if !mock}
		<p class="text-sm text-muted-foreground">{t('error.status_404')}</p>
	{:else}
		<h1 class="text-xl font-semibold">{t('mockidp.title', { name })}</h1>
		<p class="text-sm text-muted-foreground">{t('mockidp.description', { purpose })}</p>
		<ul class="flex flex-col gap-2">
			<li><a class={linkClass} href={callback('user1')}>{t('mockidp.user1')}</a></li>
			<li><a class={linkClass} href={callback('user2')}>{t('mockidp.user2')}</a></li>
		</ul>
		<h2 class="mt-2 text-sm font-medium">{t('mockidp.errors')}</h2>
		<ul class="flex flex-col gap-2">
			{#each errors as code (code)}
				<li><a class={linkClass} href={callback(`error:${code}`)}>{code}</a></li>
			{/each}
		</ul>
	{/if}
</main>
