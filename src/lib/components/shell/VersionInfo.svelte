<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '#lib/api/client.js';
	import type { SystemInfo } from '#lib/api/types.js';
	import CopyButton from '#lib/components/app/CopyButton.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { t } from '#lib/i18n/index.js';
	import { formatBuildDate, formatUptime, ownBuild, revisionMismatch, shortRevision, supportText } from '#lib/version/info.js';
	import RefreshIcon from '@lucide/svelte/icons/refresh-cw';

	const DIGEST_COMMAND = "docker service inspect timetrack_backend --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}'";

	const own = ownBuild();
	let info = $state<SystemInfo | null>(null);
	let status = $state<'loading' | 'ready' | 'unavailable'>('loading');
	let refreshing = $state(false);

	const mismatch = $derived(revisionMismatch(own, info));
	const summary = $derived(supportText(own, info));

	onMount(async () => {
		try {
			info = await api.getSystemInfo();
			status = 'ready';
		} catch {
			status = 'unavailable';
		}
	});

	/** Drops the service worker and its caches, then reloads, so the page comes from the server again. */
	async function refresh() {
		refreshing = true;
		try {
			const registrations = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
			await Promise.all(registrations.map((registration) => registration.unregister()));
			if (typeof caches !== 'undefined') await Promise.all((await caches.keys()).map((key) => caches.delete(key)));
		} catch {
			// a failing cleanup must not block the reload
		}
		window.location.reload();
	}
</script>

{#snippet row(label: string, value: string, mono = false, testid = '')}
	<div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-1.5">
		<dt class="text-[13px] text-muted-foreground">{label}</dt>
		<dd class={['text-sm break-all', mono && 'font-mono']} data-testid={testid || undefined}>{value}</dd>
	</div>
{/snippet}

{#snippet commit(revision: string | null | undefined, testid: string)}
	<div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-1.5">
		<dt class="text-[13px] text-muted-foreground">{t('version.commit')}</dt>
		<dd class="flex items-center gap-2 text-sm">
			<span class="font-mono" data-testid={testid} title={revision ?? ''}>{shortRevision(revision)}</span>
			{#if revision && revision !== 'unknown'}<CopyButton text={revision} label={t('version.copy_commit')} />{/if}
		</dd>
	</div>
{/snippet}

<section class="flex flex-col gap-3 border-t pt-4" aria-labelledby="version-title" data-testid="version-info">
	<div>
		<h3 id="version-title" class="text-[15px] font-semibold">{t('version.title')}</h3>
		<p class="mt-1 text-[13px] text-muted-foreground">{t('version.intro')}</p>
	</div>

	{#if mismatch}
		<Alert variant="warning" class="flex flex-wrap items-center justify-between gap-2" data-testid="version-mismatch">
			<span>{t('version.mismatch')}</span>
			<Button size="sm" variant="outline" disabled={refreshing} onclick={refresh}><RefreshIcon />{t('version.reload')}</Button>
		</Alert>
	{/if}

	<div class="rounded-xl border p-3" data-testid="version-pwa">
		<h4 class="text-sm font-medium">{t('version.pwa')}</h4>
		<dl class="divide-y">
			{@render row(t('version.version'), own.version, true, 'version-pwa-number')}
			{@render commit(own.revision, 'version-pwa-commit')}
			{@render row(t('version.build_date'), formatBuildDate(own.buildDate))}
		</dl>
	</div>

	<div class="rounded-xl border p-3" data-testid="version-backend">
		<h4 class="text-sm font-medium">{t('version.backend')}</h4>
		{#if status === 'loading'}
			<p class="py-1.5 text-[13px] text-muted-foreground">{t('version.loading')}</p>
		{:else if info}
			{@const b = info.backend}
			<dl class="divide-y">
				{@render row(t('version.version'), b.version, true, 'version-backend-number')}
				{@render commit(b.revision, 'version-backend-commit')}
				{@render row(t('version.build_date'), formatBuildDate(b.buildDate))}
				{@render row(t('version.api'), b.apiVersion, true)}
				{@render row(t('version.database'), b.database)}
				{@render row(t('version.migrations'), t(b.migrationsPending ? 'version.migrations_pending' : 'version.migrations_value', { count: b.schemaMigrations }))}
				{@render row(t('version.uptime'), formatUptime(b.uptimeSeconds))}
				{@render row(t('version.replica'), b.replicaId, true)}
			</dl>
			{#if !info.pwa}<p class="pt-1 text-[13px] text-muted-foreground">{t('version.no_pwa')}</p>{/if}
		{:else}
			<p class="py-1.5 text-[13px] text-muted-foreground" data-testid="version-unavailable">{t('version.unavailable')}</p>
		{/if}
	</div>

	<div class="flex flex-wrap items-center gap-2">
		<CopyButton text={summary} label={t('version.copy_all')} />
	</div>
	<p class="text-[12px] text-muted-foreground">{t('version.digest_hint')}</p>
	<code class="block rounded-lg bg-muted px-3 py-2 font-mono text-[12px] break-all select-all">{DIGEST_COMMAND}</code>
</section>
