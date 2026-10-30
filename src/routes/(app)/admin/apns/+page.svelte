<script lang="ts">
	import { api, ApiError } from '#lib/api/client.js';
	import type { ApnsCheckResult, ApnsStatus } from '#lib/api/types.js';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import Panel from '#lib/components/app/Panel.svelte';
	import StatusChip from '#lib/components/app/StatusChip.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { formatDuration } from '#lib/mail/format.js';
	import { sessionStore } from '#lib/session.svelte.js';
	import InfoIcon from '@lucide/svelte/icons/info';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { onMount } from 'svelte';

	let status = $state<ApnsStatus | null>(null);
	let loading = $state(true);
	let unsupported = $state(false);
	let forbidden = $state(false);
	let loadError = $state('');

	let checking = $state(false);
	let result = $state<ApnsCheckResult | null>(null);
	let checkError = $state('');

	const isAdmin = $derived(sessionStore.current?.account.role === 'admin');

	onMount(async () => {
		if (!isAdmin) {
			forbidden = true;
			loading = false;
			return;
		}
		try {
			status = await api.getApnsStatus();
		} catch (e) {
			if (e instanceof ApiError && (e.status === 404 || e.status === 501)) unsupported = true;
			else if (e instanceof ApiError && e.status === 403) forbidden = true;
			else loadError = errorMessage(e);
		} finally {
			loading = false;
		}
	});

	async function runCheck() {
		if (checking) return;
		checking = true;
		checkError = '';
		result = null;
		try {
			result = await api.checkApns();
		} catch (e) {
			checkError =
				e instanceof ApiError && e.status === 429 ? t('apns.check.rate_limited') : e instanceof ApiError && e.status === 501 ? t('apns.check.not_configured') : errorMessage(e);
		} finally {
			checking = false;
		}
	}

	const SETUP = ['APNS_PRIVATE_KEY=<Inhalt der .p8-Datei>   # im Swarm: Secret tt_apns_private_key', 'APNS_KEY_ID=ABCDE12345', 'APNS_TEAM_ID=ABCDE12345', 'APNS_BUNDLE_IDS=com.example.timetrack,com.example.timetrack.watchkitapp'];
</script>

<PageHeader title={t('apns.title')} description={t('apns.description')} />

{#if loading}
	<p class="text-sm text-muted-foreground" role="status">{t('common.loading')}</p>
{:else if forbidden}
	<Alert variant="warning" data-testid="apns-forbidden">{t('apns.forbidden')}</Alert>
{:else if unsupported}
	<Alert data-testid="apns-unsupported" class="flex flex-col gap-1">
		<p class="font-medium">{t('apns.unsupported_title')}</p>
		<p>{t('apns.unsupported_text')}</p>
	</Alert>
{:else if loadError}
	<Alert variant="destructive" data-testid="apns-load-error">{loadError}</Alert>
{:else if status}
	<div class="flex flex-col gap-6">
		<Panel title={t('apns.status.title')} data-testid="apns-status">
			{#snippet action()}
				<StatusChip tone={status!.configured ? 'success' : 'warning'}><span data-testid="apns-configured">{status!.configured ? t('apns.status.configured') : t('apns.status.not_configured')}</span></StatusChip>
			{/snippet}
			{#if status.configured}
				<dl class="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2" data-testid="apns-values">
					<div><dt class="text-xs text-muted-foreground">{t('apns.field.key_id')}</dt><dd class="font-medium break-all" data-testid="apns-key-id">{status.keyId}</dd></div>
					<div><dt class="text-xs text-muted-foreground">{t('apns.field.team_id')}</dt><dd class="font-medium break-all" data-testid="apns-team-id">{status.teamId}</dd></div>
					<div class="sm:col-span-2"><dt class="text-xs text-muted-foreground">{t('apns.field.bundle_ids')}</dt><dd class="font-medium break-all" data-testid="apns-bundles">{status.bundleIds.join(', ')}</dd></div>
					<div><dt class="text-xs text-muted-foreground">{t('apns.field.devices')}</dt><dd class="font-medium tabular-nums" data-testid="apns-devices">{status.deviceCount}</dd></div>
				</dl>
			{/if}
			{#if status.problems.length > 0}
				<p class="mt-3 text-sm" data-testid="apns-problems">{t('apns.problems')}: <code class="font-mono">{status.problems.join(', ')}</code></p>
			{/if}
			<p class="mt-4 text-[13px] text-muted-foreground">{t('apns.status.source')}</p>

			{#if status.hints.length > 0}
				<div class="mt-4 border-t pt-4">
					<h3 class="mb-2 text-sm font-semibold">{t('apns.hints.title')}</h3>
					<ul class="flex flex-col gap-2" data-testid="apns-hints">
						{#each status.hints as hint (hint.code)}
							<li class="flex gap-2.5 text-sm" data-testid="apns-hint-{hint.code}" data-severity={hint.severity}>
								{#if hint.severity === 'warning'}
									<TriangleAlertIcon class="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" /><span class="sr-only">{t('apns.hints.warning')}: </span>
								{:else}
									<InfoIcon class="mt-0.5 size-4 shrink-0 text-ui-accent" aria-hidden="true" /><span class="sr-only">{t('apns.hints.info')}: </span>
								{/if}
								<span>{hint.message}</span>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</Panel>

		{#if !status.configured}
			<Panel title={t('apns.setup.title')} description={t('apns.setup.text')} data-testid="apns-setup">
				<pre class="overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-[13px] leading-relaxed" data-testid="apns-example">{SETUP.join('\n')}</pre>
				<p class="mt-3 text-[13px] text-muted-foreground">{t('apns.setup.docs')}: <a class="underline underline-offset-2" href="https://magicalwig34653.github.io/timetrack-backend/docs/DEPLOYMENT" target="_blank" rel="noopener">docs/DEPLOYMENT</a></p>
			</Panel>
		{:else}
			<Panel title={t('apns.check.title')} description={t('apns.check.text')} data-testid="apns-check">
				{#snippet action()}
					<Button onclick={runCheck} disabled={checking} data-testid="apns-check-run">{checking ? t('apns.check.running') : result || checkError ? t('apns.check.again') : t('apns.check.run')}</Button>
				{/snippet}
				{#if checkError}<Alert variant="destructive" data-testid="apns-check-error">{checkError}</Alert>{/if}
				{#if result && !checking}
					<ul class="flex flex-col gap-2" data-testid="apns-probes">
						{#each result.probes as probe (probe.bundleId + probe.environment)}
							<li class="flex flex-col gap-1 rounded-lg border px-3 py-2 text-sm" data-testid="apns-probe" data-status={probe.status}>
								<span class="flex flex-wrap items-center gap-2">
									<span class="font-medium break-all">{probe.bundleId}</span>
									<span class="text-xs text-muted-foreground">{t(`apns.probe.${probe.environment}`)}</span>
									<StatusChip tone={probe.status === 'ok' ? 'success' : 'warning'}>{probe.status === 'ok' ? t('apns.probe.ok') : t('apns.probe.failed')}</StatusChip>
								</span>
								{#if probe.status === 'failed'}
									<span class="text-[13px]">{probe.advice}{#if probe.reason}<span class="text-muted-foreground"> ({probe.reason})</span>{/if}</span>
								{/if}
							</li>
						{/each}
					</ul>
					<div
						class="mt-4 rounded-lg border px-3.5 py-3 text-sm {result.ok ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200' : 'border-destructive/40 bg-destructive/10 text-destructive'}"
						role="status"
						data-testid="apns-result"
						data-ok={result.ok}
					>
						<p class="font-medium">{result.ok ? t('apns.check.ok') : t('apns.check.failed')}</p>
						<p class="mt-0.5 text-[13px]">{result.summary}</p>
						<p class="mt-1 text-xs opacity-80">{t('apns.check.total', { ms: formatDuration(result.totalMs) })}</p>
					</div>
				{/if}
				<p class="mt-3 text-[13px] text-muted-foreground">{t('apns.test_hint')}</p>
			</Panel>
		{/if}
	</div>
{/if}
