<script lang="ts">
	import { onMount } from 'svelte';
	import { api, ApiError } from '#lib/api/client.js';
	import type { RecoveryStatus } from '#lib/api/types.js';
	import { downloadText } from '#lib/browser.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#lib/components/ui/card/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import CopyButton from './CopyButton.svelte';
	import Field from './Field.svelte';

	let { status = $bindable(null) }: { status?: RecoveryStatus | null } = $props();

	let loading = $state(true);
	let busy = $state(false);
	let error = $state('');
	let notice = $state('');

	// recovery codes: shown exactly once after generation
	let freshCodes = $state<string[] | null>(null);
	let codesConfirmed = $state(false);
	let confirmRegenerate = $state(false);

	let password = $state('');
	let passwordRepeat = $state('');
	let passwordError = $state('');

	let emailCodeSent = $state(false);
	let emailCode = $state('');

	async function load() {
		try {
			status = await api.recoveryStatus();
		} catch (e) {
			error = errorMessage(e);
		} finally {
			loading = false;
		}
	}
	onMount(load);

	async function run(action: () => Promise<void>, success = '') {
		busy = true;
		error = '';
		notice = '';
		try {
			await action();
			if (success) notice = success;
			status = await api.recoveryStatus();
		} catch (e) {
			error = errorMessage(e);
			if (e instanceof ApiError && e.status === 501 && status) {
				status = { ...status, email: { ...status.email, available: false } };
			}
		} finally {
			busy = false;
		}
	}

	const generateCodes = () =>
		run(async () => {
			const result = await api.generateRecoveryCodes();
			freshCodes = result.codes;
			codesConfirmed = false;
			confirmRegenerate = false;
		});

	const disableCodes = () =>
		run(async () => {
			await api.disableRecoveryCodes();
			freshCodes = null;
		}, t('recovery.codes.disabled'));

	function savePassword(event: Event) {
		event.preventDefault();
		passwordError = '';
		if (password.length < 12) passwordError = t('recovery.password.too_short');
		else if (password !== passwordRepeat) passwordError = t('recovery.password.mismatch');
		if (passwordError) return;
		return run(async () => {
			await api.setFallbackPassword(password);
			password = passwordRepeat = '';
		}, t('recovery.password.saved'));
	}

	const removePassword = () =>
		run(() => api.removeFallbackPassword(), t('recovery.password.removed'));

	// The account e-mail is the recovery address (contract 0.36.0): no address input here. 204 = active at once, 202 = code entry.
	function startEmail(event: Event) {
		event.preventDefault();
		let activated = false;
		return run(async () => {
			activated = (await api.enableEmailRecovery()) === 'active';
			emailCodeSent = !activated;
		}, t('recovery.email.code_sent')).then(() => {
			if (activated && !error) notice = t('recovery.email.verified');
		});
	}

	function verifyEmail(event: Event) {
		event.preventDefault();
		return run(async () => {
			await api.verifyRecoveryEmail(emailCode);
			emailCodeSent = false;
			emailCode = '';
		}, t('recovery.email.verified'));
	}

	const disableEmail = () => run(() => api.disableEmailRecovery(), t('recovery.email.disabled'));

	const accountEmail = $derived(status?.email.accountEmail ?? null);
	const codesText = $derived(freshCodes?.join('\n') ?? '');
</script>

{#if loading}
	<p class="text-sm text-muted-foreground" role="status">{t('common.loading')}</p>
{:else if status}
	{#if error}<Alert variant="destructive" class="mb-4">{error}</Alert>{/if}
	{#if notice}<Alert variant="success" class="mb-4">{notice}</Alert>{/if}

	<div class="flex flex-col gap-4">
		<!-- recovery codes -->
		<Card>
			<CardHeader>
				<CardTitle class="flex items-center gap-2">
					{t('recovery.codes.title')}
					<Badge variant={status.recoveryCodes.active ? 'default' : 'secondary'}>
						{status.recoveryCodes.active ? t('common.active') : t('common.inactive')}
					</Badge>
				</CardTitle>
				<CardDescription>{t('recovery.codes.description')}</CardDescription>
			</CardHeader>
			<CardContent class="flex flex-col gap-3">
				{#if freshCodes}
					<Alert variant="warning">{t('recovery.codes.show_once')}</Alert>
					<ul
						class="grid grid-cols-1 gap-2 rounded-lg border bg-muted p-3 font-mono text-sm sm:grid-cols-2"
						aria-label={t('recovery.codes.title')}
					>
						{#each freshCodes as code (code)}<li>{code}</li>{/each}
					</ul>
					<div class="flex flex-wrap gap-2">
						<CopyButton text={codesText} label={t('recovery.codes.copy_all')} />
						<Button
							variant="outline"
							size="sm"
							onclick={() => downloadText('timetrack-recovery-codes.txt', codesText + '\n')}
						>
							{t('recovery.codes.download')}
						</Button>
					</div>
					<label class="flex items-center gap-2 text-sm">
						<input type="checkbox" bind:checked={codesConfirmed} class="size-4" />
						{t('recovery.codes.confirm_saved')}
					</label>
					<div>
						<Button disabled={!codesConfirmed} onclick={() => (freshCodes = null)}>
							{t('common.done')}
						</Button>
					</div>
				{:else}
					{#if status.recoveryCodes.active}
						<p class="text-sm text-muted-foreground">
							{t('recovery.codes.remaining', { count: status.recoveryCodes.remaining ?? 0 })}
						</p>
					{/if}
					<div class="flex flex-wrap gap-2">
						{#if status.recoveryCodes.active && !confirmRegenerate}
							<Button variant="outline" onclick={() => (confirmRegenerate = true)} disabled={busy}>
								{t('recovery.codes.regenerate')}
							</Button>
							<Button variant="destructive" onclick={disableCodes} disabled={busy}>
								{t('common.disable')}
							</Button>
						{:else if status.recoveryCodes.active}
							<Alert variant="warning" class="w-full">{t('recovery.codes.regenerate_warning')}</Alert>
							<Button onclick={generateCodes} disabled={busy}>{t('recovery.codes.regenerate_confirm')}</Button>
							<Button variant="ghost" onclick={() => (confirmRegenerate = false)}>{t('common.cancel')}</Button>
						{:else}
							<Button onclick={generateCodes} disabled={busy}>{t('recovery.codes.generate')}</Button>
						{/if}
					</div>
				{/if}
			</CardContent>
		</Card>

		<!-- fallback password -->
		<Card>
			<CardHeader>
				<CardTitle class="flex items-center gap-2">
					{t('recovery.password.title')}
					<Badge variant={status.fallbackPassword.active ? 'default' : 'secondary'}>
						{status.fallbackPassword.active ? t('common.active') : t('common.inactive')}
					</Badge>
				</CardTitle>
				<CardDescription>{t('recovery.password.description')}</CardDescription>
			</CardHeader>
			<CardContent>
				<form class="flex flex-col gap-3" onsubmit={savePassword}>
					<Field
						id="fallback-password"
						type="password"
						autocomplete="new-password"
						label={status.fallbackPassword.active ? t('recovery.password.new') : t('recovery.password.label')}
						hint={t('recovery.password.hint')}
						bind:value={password}
						maxlength={256}
						required
					/>
					<Field
						id="fallback-password-repeat"
						type="password"
						autocomplete="new-password"
						label={t('recovery.password.repeat')}
						bind:value={passwordRepeat}
						error={passwordError}
						required
					/>
					<div class="flex flex-wrap gap-2">
						<Button type="submit" disabled={busy}>{t('common.save')}</Button>
						{#if status.fallbackPassword.active}
							<Button variant="destructive" onclick={removePassword} disabled={busy}>{t('common.remove')}</Button>
						{/if}
					</div>
				</form>
			</CardContent>
		</Card>

		<!-- e-mail -->
		<Card>
			<CardHeader>
				<CardTitle class="flex items-center gap-2">
					{t('recovery.email.title')}
					<Badge variant={status.email.active ? 'default' : 'secondary'}>
						{status.email.active ? t('common.active') : t('common.inactive')}
					</Badge>
				</CardTitle>
				<CardDescription>{t('recovery.email.description')}</CardDescription>
			</CardHeader>
			<CardContent>
				{#if !status.email.available}
					<Alert>{t('recovery.email.unavailable')}</Alert>
				{:else if !accountEmail}
					<div class="flex flex-col gap-3" data-testid="recovery-no-account-email">
						<p class="text-sm">{t('recovery.email.no_account_mail')}</p>
						<div><Button variant="outline" href="/settings/profile" data-testid="recovery-profile-link">{t('recovery.email.add_in_profile')}</Button></div>
					</div>
				{:else if status.email.active}
					<div class="flex flex-col gap-3">
						<p class="text-sm" data-testid="recovery-account-email">{t('recovery.email.uses_account_mail', { email: accountEmail })} <a class="underline underline-offset-4" href="/settings/profile">{t('recovery.email.profile_link')}</a></p>
						<div><Button variant="destructive" onclick={disableEmail} disabled={busy}>{t('common.disable')}</Button></div>
					</div>
				{:else if emailCodeSent}
					<form class="flex flex-col gap-3" onsubmit={verifyEmail}>
						<Field
							id="email-code"
							label={t('recovery.email.code_label')}
							bind:value={emailCode}
							autocomplete="one-time-code"
							inputmode="numeric"
							required
						/>
						<div class="flex gap-2">
							<Button type="submit" disabled={busy}>{t('recovery.email.verify')}</Button>
							<Button variant="ghost" onclick={() => (emailCodeSent = false)}>{t('common.cancel')}</Button>
						</div>
					</form>
				{:else}
					<form class="flex flex-col gap-3" onsubmit={startEmail}>
						<p class="text-sm" data-testid="recovery-account-email">{t('recovery.email.uses_account_mail', { email: accountEmail })} <a class="underline underline-offset-4" href="/settings/profile">{t('recovery.email.profile_link')}</a></p>
						{#if status.email.verified === false}
							<Alert variant="warning" data-testid="recovery-email-unconfirmed">
								{t('recovery.email.unconfirmed')}
								<a class="mt-1 block font-medium underline underline-offset-2" href="/settings/profile" data-testid="recovery-confirm-link">{t('recovery.email.confirm_in_profile')}</a>
							</Alert>
						{/if}
						<div><Button type="submit" disabled={busy || status.email.verified === false} data-testid="recovery-email-enable">{t('recovery.email.enable')}</Button></div>
					</form>
				{/if}
			</CardContent>
		</Card>
	</div>
{:else if error}
	<Alert variant="destructive">{error}</Alert>
{/if}
