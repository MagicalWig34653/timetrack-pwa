<script lang="ts">
	import { api, ApiError } from '#lib/api/client.js';
	import type { MailCheckResult, MailStatus } from '#lib/api/types.js';
	import CopyButton from '#lib/components/app/CopyButton.svelte';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import Panel from '#lib/components/app/Panel.svelte';
	import ReauthNotice from '#lib/components/app/ReauthNotice.svelte';
	import StatusChip from '#lib/components/app/StatusChip.svelte';
	import CheckStepper from '#lib/components/mail/CheckStepper.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { formatDuration, SETUP_LINES, setupExample, tlsKeys } from '#lib/mail/format.js';
	import { sessionStore } from '#lib/session.svelte.js';
	import InfoIcon from '@lucide/svelte/icons/info';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { onMount } from 'svelte';

	let status = $state<MailStatus | null>(null);
	let loading = $state(true);
	let unsupported = $state(false);
	let forbidden = $state(false);
	let loadError = $state('');

	let checking = $state(false);
	let result = $state<MailCheckResult | null>(null);
	let checkError = $state('');

	let recipient = $state('');
	let ownAddress = $state('');
	let sending = $state(false);
	let sentNotice = $state('');
	let testError = $state('');
	let reauth = $state(false);
	let showInvalid = $state(false);

	const isAdmin = $derived(sessionStore.current?.account.role === 'admin');
	const tls = $derived(status?.tls ? tlsKeys(status.tls) : null);

	onMount(async () => {
		if (!isAdmin) {
			forbidden = true;
			loading = false;
			return;
		}
		try {
			status = await api.getMailStatus();
		} catch (e) {
			if (e instanceof ApiError && (e.status === 404 || e.status === 501)) unsupported = true;
			else if (e instanceof ApiError && e.status === 403) forbidden = true;
			else loadError = errorMessage(e);
		} finally {
			loading = false;
		}
		try {
			const profile = await api.getProfile();
			if (profile.email && profile.emailVerified) recipient = ownAddress = profile.email;
		} catch {
			// the recipient field simply stays empty
		}
	});

	async function runCheck() {
		if (checking) return;
		checking = true;
		checkError = '';
		result = null;
		try {
			result = await api.checkMail();
		} catch (e) {
			checkError =
				e instanceof ApiError && e.status === 429 ? t('mail.check.rate_limited') : e instanceof ApiError && e.status === 501 ? t('mail.check.not_configured') : errorMessage(e);
		} finally {
			checking = false;
		}
	}

	const validAddress = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

	async function sendTest(event: Event) {
		event.preventDefault();
		if (sending) return;
		sentNotice = testError = '';
		reauth = false;
		const to = recipient.trim();
		showInvalid = false;
		if (!to && !ownAddress) {
			testError = errorMessage(new ApiError(400, 'no_recipient'));
			return;
		}
		if (to && !validAddress(to)) {
			showInvalid = true;
			return;
		}
		sending = true;
		try {
			const sent = await api.sendMailTest(to || undefined);
			sentNotice = t('mail.test.sent', { to: sent.to, ms: formatDuration(sent.durationMs) });
		} catch (e) {
			if (e instanceof ApiError && e.code === 'reauth_required') reauth = true;
			else if (e instanceof ApiError && e.status === 429) testError = t('mail.test.rate_limited');
			else if (e instanceof ApiError && e.status === 501) testError = t('mail.test.not_configured');
			else testError = errorMessage(e);
		} finally {
			sending = false;
		}
	}
</script>

<PageHeader title={t('mail.title')} description={t('mail.description')} />

{#if loading}
	<p class="text-sm text-muted-foreground" role="status">{t('common.loading')}</p>
{:else if forbidden}
	<Alert variant="warning" data-testid="mail-forbidden">{t('mail.forbidden')}</Alert>
{:else if unsupported}
	<Alert data-testid="mail-unsupported" class="flex flex-col gap-1">
		<p class="font-medium">{t('mail.unsupported_title')}</p>
		<p>{t('mail.unsupported_text')}</p>
	</Alert>
{:else if loadError}
	<Alert variant="destructive" data-testid="mail-load-error">{loadError}</Alert>
{:else if status}
	<div class="flex flex-col gap-6">
		<Panel title={t('mail.status.title')} data-testid="mail-status">
			{#snippet action()}
				<StatusChip tone={status!.configured ? 'success' : 'warning'}><span data-testid="mail-configured">{status!.configured ? t('mail.status.configured') : t('mail.status.not_configured')}</span></StatusChip>
			{/snippet}
			{#if status.configured}
				<dl class="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2" data-testid="mail-values">
					<div><dt class="text-xs text-muted-foreground">{t('mail.field.server')}</dt><dd class="font-medium break-all" data-testid="mail-host">{status.host}</dd></div>
					<div><dt class="text-xs text-muted-foreground">{t('mail.field.port')}</dt><dd class="font-medium tabular-nums" data-testid="mail-port">{status.port}</dd></div>
					<div>
						<dt class="text-xs text-muted-foreground">{t('mail.field.tls')}</dt>
						<dd class="flex flex-col items-start gap-1">
							{#if tls}
								<StatusChip tone={tls.tone}><span data-testid="mail-tls">{t(tls.label)}</span></StatusChip>
								<span class="text-[13px] text-muted-foreground">{t(tls.text)}</span>
							{/if}
						</dd>
					</div>
					<div>
						<dt class="text-xs text-muted-foreground">{t('mail.field.from')}</dt>
						<dd class="font-medium break-all" data-testid="mail-from">{status.fromName ? `${status.fromName} <${status.fromAddress}>` : status.fromAddress}</dd>
					</div>
					<div>
						<dt class="text-xs text-muted-foreground">{t('mail.field.auth')}</dt>
						<dd class="font-medium" data-testid="mail-auth">{status.authConfigured ? t('mail.auth.yes') : t('mail.auth.no')}</dd>
					</div>
				</dl>
			{/if}
			<p class="mt-4 text-[13px] text-muted-foreground" data-testid="mail-source">{t('mail.status.source')}</p>

			{#if status.configured && status.hints.length > 0}
				<div class="mt-4 border-t pt-4">
					<h3 class="mb-2 text-sm font-semibold">{t('mail.hints.title')}</h3>
					<ul class="flex flex-col gap-2" data-testid="mail-hints">
						{#each status.hints as hint (hint.code)}
							<li class="flex gap-2.5 text-sm" data-testid="mail-hint-{hint.code}" data-severity={hint.severity}>
								{#if hint.severity === 'warning'}
									<TriangleAlertIcon class="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" /><span class="sr-only">{t('mail.hints.warning')}: </span>
								{:else}
									<InfoIcon class="mt-0.5 size-4 shrink-0 text-ui-accent" aria-hidden="true" /><span class="sr-only">{t('mail.hints.info')}: </span>
								{/if}
								<span>{hint.message}</span>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</Panel>

		{#if !status.configured}
			<Panel title={t('mail.setup.title')} description={t('mail.setup.text')} data-testid="mail-setup">
				<ul class="flex flex-col gap-3 text-sm">
					<li class="flex flex-col gap-0.5">
						<span><code class="font-mono font-medium">SMTP_HOST</code> <StatusChip tone="accent" dot={false}>{t('mail.setup.required')}</StatusChip></span>
						<span class="text-muted-foreground">{t('mail.setup.var_host')}</span>
					</li>
					<li class="flex flex-col gap-0.5">
						<span><code class="font-mono font-medium">SMTP_FROM</code> <StatusChip tone="accent" dot={false}>{t('mail.setup.required')}</StatusChip></span>
						<span class="text-muted-foreground">{t('mail.setup.var_from')}</span>
					</li>
					<li class="flex flex-col gap-0.5"><span><code class="font-mono font-medium">SMTP_PORT</code> <StatusChip dot={false}>{t('mail.setup.optional')}</StatusChip></span><span class="text-muted-foreground">{t('mail.setup.var_port')}</span></li>
					<li class="flex flex-col gap-0.5"><span><code class="font-mono font-medium">SMTP_TLS</code> <StatusChip dot={false}>{t('mail.setup.optional')}</StatusChip></span><span class="text-muted-foreground">{t('mail.setup.var_tls')}</span></li>
					<li class="flex flex-col gap-0.5"><span><code class="font-mono font-medium">SMTP_USER</code> <StatusChip dot={false}>{t('mail.setup.optional')}</StatusChip></span><span class="text-muted-foreground">{t('mail.setup.var_user')}</span></li>
					<li class="flex flex-col gap-0.5">
						<span><code class="font-mono font-medium">SMTP_PASSWORD</code> / <code class="font-mono font-medium">SMTP_PASSWORD_FILE</code> <StatusChip dot={false}>{t('mail.setup.optional')}</StatusChip></span>
						<span class="text-muted-foreground">{t('mail.setup.var_password')}</span>
					</li>
				</ul>
				<div class="mt-4 rounded-lg border bg-muted/40 p-3">
					<div class="mb-2 flex items-center justify-between gap-2">
						<span class="text-xs font-medium text-muted-foreground">{t('mail.setup.example')}</span>
						<CopyButton text={setupExample()} />
					</div>
					<pre class="overflow-x-auto font-mono text-[13px] leading-relaxed" data-testid="mail-example">{[...SETUP_LINES.required, ...SETUP_LINES.optional].join('\n')}</pre>
				</div>
				<p class="mt-3 text-[13px] text-muted-foreground">{t('mail.setup.after')}</p>
				<p class="mt-1 text-[13px] text-muted-foreground" data-testid="mail-docs">{t('mail.setup.docs')}: <code class="font-mono">docs/installation/konfiguration.md</code></p>
			</Panel>
		{:else}
			<Panel title={t('mail.check.title')} description={t('mail.check.text')} data-testid="mail-check">
				{#snippet action()}
					<Button onclick={runCheck} disabled={checking} data-testid="mail-check-run">{checking ? t('mail.check.running') : result || checkError ? t('mail.check.again') : t('mail.check.run')}</Button>
				{/snippet}
				{#if checkError}<Alert variant="destructive" data-testid="mail-check-error">{checkError}</Alert>{/if}
				<CheckStepper {result} running={checking} />
				{#if result && !checking}
					<div
						class="mt-4 rounded-lg border px-3.5 py-3 text-sm {result.ok ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200' : 'border-destructive/40 bg-destructive/10 text-destructive'}"
						role="status"
						data-testid="mail-result"
						data-ok={result.ok}
					>
						<p class="font-medium">{result.ok ? t('mail.check.ok') : t('mail.check.failed')}</p>
						<p class="mt-0.5 text-[13px]">{result.ok ? result.summary : t('mail.check.failed_hint')}</p>
						<p class="mt-1 text-xs opacity-80">{t('mail.check.total', { ms: formatDuration(result.totalMs) })}</p>
					</div>
				{/if}
			</Panel>

			<Panel title={t('mail.test.title')} description={t('mail.test.text')} data-testid="mail-test">
				<form class="flex flex-col gap-3" onsubmit={sendTest} novalidate>
					<div class="flex flex-col gap-1.5">
						<Label for="mail-to">{t('mail.test.to')}</Label>
						<Input id="mail-to" type="email" placeholder="name@example.org" autocomplete="off" bind:value={recipient} aria-invalid={showInvalid ? true : undefined} aria-describedby="mail-to-hint" class="max-w-md" />
						<p id="mail-to-hint" class="text-xs {ownAddress ? 'text-muted-foreground' : 'text-amber-800 dark:text-amber-200'}" data-testid="mail-to-hint">
							{ownAddress ? t('mail.test.to_hint') : t('mail.test.to_empty')}
						</p>
						{#if showInvalid}<p class="text-xs text-destructive" data-testid="mail-to-invalid">{t('mail.test.invalid')}</p>{/if}
					</div>
					{#if reauth}<ReauthNotice next="/admin/mail" />{/if}
					{#if testError}<Alert variant="destructive" data-testid="mail-test-error">{testError}</Alert>{/if}
					{#if sentNotice}<Alert variant="success" data-testid="mail-test-sent">{sentNotice}</Alert>{/if}
					<div><Button type="submit" disabled={sending} data-testid="mail-test-send">{sending ? t('mail.test.sending') : t('mail.test.send')}</Button></div>
				</form>
			</Panel>
		{/if}

		<Panel title={t('mail.use.title')} data-testid="mail-use">
			<ul class="flex list-disc flex-col gap-2 pl-5 text-sm">
				<li>{t('mail.use.recovery')}</li>
				<li>{t('mail.use.confirm')}</li>
			</ul>
			<p class="mt-3 text-[13px] text-muted-foreground">{t('mail.use.optional')}</p>
		</Panel>
	</div>
{/if}
