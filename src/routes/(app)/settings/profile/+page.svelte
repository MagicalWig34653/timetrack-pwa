<script lang="ts">
	import { api } from '#lib/api/client.js';
	import { ApiError } from '#lib/api/errors.js';
	import type { Profile } from '#lib/api/types.js';
	import Field from '#lib/components/app/Field.svelte';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import Panel from '#lib/components/app/Panel.svelte';
	import ReauthNotice from '#lib/components/app/ReauthNotice.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { errorMessage, t, type MessageKey } from '#lib/i18n/index.js';
	import { sessionStore } from '#lib/session.svelte.js';
	import { onMount } from 'svelte';

	let profile = $state<Profile | null>(null);
	let loadError = $state('');

	let name = $state('');
	let nameError = $state('');
	let nameNotice = $state('');
	let nameBusy = $state(false);

	let emailInput = $state('');
	let emailEditing = $state(false);
	let emailError = $state('');
	let emailNotice = $state('');
	let emailBusy = $state(false);
	let reauth = $state(false);
	let code = $state('');
	let confirmRemove = $state(false);

	const dirty = $derived(!!profile && name.trim() !== profile.displayName);

	function apply(next: Profile) {
		profile = next;
		name = next.displayName;
		// keep the shell (greeting, account menu) in sync
		if (sessionStore.current) sessionStore.current = { ...sessionStore.current, account: { ...sessionStore.current.account, displayName: next.displayName } };
	}

	onMount(async () => {
		try {
			apply(await api.getProfile());
		} catch (e) {
			loadError = errorMessage(e);
		}
	});

	async function saveName(event: Event) {
		event.preventDefault();
		if (nameBusy || !profile) return;
		nameError = nameNotice = '';
		const value = name.trim();
		if (value.length < 1 || value.length > 80) {
			nameError = t('profile.name_error');
			return;
		}
		nameBusy = true;
		try {
			apply(await api.updateProfile(value));
			nameNotice = t('profile.name_saved');
		} catch (e) {
			nameError = errorMessage(e);
		} finally {
			nameBusy = false;
		}
	}

	/** Maps API failures of the e-mail calls: 403 reauth_required opens the fresh-login hint instead of a plain error. */
	function failEmail(e: unknown) {
		if (e instanceof ApiError && e.code === 'reauth_required') reauth = true;
		else emailError = errorMessage(e);
	}

	async function sendCode(event: Event) {
		event.preventDefault();
		if (emailBusy) return;
		emailError = emailNotice = '';
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput.trim())) {
			emailError = t('profile.email_invalid');
			return;
		}
		emailBusy = true;
		try {
			await api.requestEmailChange(emailInput.trim());
			apply(await api.getProfile());
			emailEditing = false;
			code = '';
		} catch (e) {
			failEmail(e);
		} finally {
			emailBusy = false;
		}
	}

	async function confirmCode(event: Event) {
		event.preventDefault();
		if (emailBusy || !code.trim()) return;
		emailError = emailNotice = '';
		emailBusy = true;
		try {
			apply(await api.verifyEmailChange(code.trim()));
			emailNotice = t('profile.email_confirmed');
			code = '';
		} catch (e) {
			failEmail(e);
			// a consumed request (409) no longer waits for a code
			if (e instanceof ApiError && e.status === 409) apply(await api.getProfile());
		} finally {
			emailBusy = false;
		}
	}

	async function removeEmail() {
		if (emailBusy) return;
		emailError = emailNotice = '';
		emailBusy = true;
		try {
			await api.removeProfileEmail();
			apply(await api.getProfile());
			confirmRemove = false;
			emailNotice = t('profile.email_removed');
		} catch (e) {
			failEmail(e);
		} finally {
			emailBusy = false;
		}
	}

	function startEdit() {
		emailEditing = true;
		emailInput = '';
		emailError = emailNotice = '';
	}
</script>

<PageHeader title={t('profile.title')} description={t('profile.description')} />

{#if loadError}
	<Alert variant="destructive">{loadError}</Alert>
{:else if !profile}
	<p class="text-sm text-muted-foreground">{t('common.loading')}</p>
{:else}
	<div class="flex flex-col gap-5">
		<Panel title={t('profile.name_title')}>
			<form class="flex flex-col gap-4" onsubmit={saveName} novalidate aria-label={t('profile.title')}>
				{#if nameError}<Alert variant="destructive">{nameError}</Alert>{/if}
				{#if nameNotice}<Alert variant="success" data-testid="name-notice">{nameNotice}</Alert>{/if}
				<Field id="profile-name" label={t('profile.name_label')} hint={t('profile.name_hint')} bind:value={name} maxlength={80} disabled={nameBusy} autocomplete="name" />
				<Field id="profile-handle" label={t('profile.handle_label')} hint={t('profile.handle_hint')} value={profile.handle} readonly />
				<div><Button type="submit" disabled={nameBusy || !dirty}>{t('common.save')}</Button></div>
			</form>
		</Panel>

		<Panel title={t('profile.email_title')} data-testid="email-panel">
			<div class="flex flex-col gap-4">
				{#if reauth}<ReauthNotice next="/settings/profile" />{/if}
				{#if emailError}<Alert variant="destructive" data-testid="email-error">{emailError}</Alert>{/if}
				{#if emailNotice}<Alert variant="success" data-testid="email-notice">{emailNotice}</Alert>{/if}
				{#if !profile.mailAvailable}
					<Alert data-testid="no-mail">
						{t('profile.email_no_mail')}
						{#if sessionStore.current?.account.role === 'admin'}
							<a class="mt-1 block font-medium underline underline-offset-2" href="/admin/mail" data-testid="no-mail-admin-link">{t('mail.profile_hint_link')}</a>
						{/if}
					</Alert>
				{/if}

				{#if profile.email}
					<div class="flex flex-wrap items-center gap-2" data-testid="email-current">
						<span class="text-sm text-muted-foreground">{t('profile.email_current')}</span>
						<span class="font-medium break-all">{profile.email}</span>
						<Badge variant={profile.emailVerified ? 'default' : 'secondary'}>{profile.emailVerified ? t('profile.email_verified') : t('profile.email_unverified')}</Badge>
					</div>
				{:else}
					<p class="text-sm text-muted-foreground" data-testid="email-none">{t('profile.email_none')}</p>
				{/if}

				{#if profile.pendingEmail}
					<form class="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3" onsubmit={confirmCode} novalidate aria-label={t('profile.email_confirm')} data-testid="email-pending">
						<p class="text-sm">{t('profile.email_pending', { email: profile.pendingEmail })}</p>
						<Field id="profile-code" label={t('profile.email_code_label')} bind:value={code} autocomplete="one-time-code" disabled={emailBusy} />
						<div class="flex flex-wrap gap-2">
							<Button type="submit" size="sm" disabled={emailBusy || !code.trim()}>{t('profile.email_confirm')}</Button>
							<Button type="button" size="sm" variant="outline" onclick={startEdit} disabled={emailBusy}>{t('profile.email_change')}</Button>
						</div>
					</form>
				{:else if emailEditing}
					<form class="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3" onsubmit={sendCode} novalidate aria-label={t('profile.email_change')}>
						<Field id="profile-email" type="email" label={t('profile.email_new_label')} hint={t('profile.email_new_hint')} bind:value={emailInput} autocomplete="email" disabled={emailBusy} />
						<div class="flex flex-wrap gap-2">
							<Button type="submit" size="sm" disabled={emailBusy}>{t('profile.email_send')}</Button>
							<Button type="button" size="sm" variant="outline" onclick={() => (emailEditing = false)} disabled={emailBusy}>{t('profile.email_cancel')}</Button>
						</div>
					</form>
				{:else if profile.mailAvailable}
					<div class="flex flex-wrap gap-2">
						<Button variant="outline" size="sm" onclick={startEdit} data-testid="email-edit">{profile.email ? t('profile.email_change') : t('profile.email_add')}</Button>
						{#if profile.email}
							{#if confirmRemove}
								<Button variant="destructive" size="sm" onclick={removeEmail} disabled={emailBusy} data-testid="email-remove-confirm">{t('profile.email_remove_confirm')}</Button>
								<Button variant="ghost" size="sm" onclick={() => (confirmRemove = false)}>{t('common.cancel')}</Button>
							{:else}
								<Button variant="ghost" size="sm" onclick={() => (confirmRemove = true)} data-testid="email-remove">{t('profile.email_remove')}</Button>
							{/if}
						{/if}
					</div>
				{:else if profile.email}
					<div>
						<Button variant="ghost" size="sm" onclick={removeEmail} disabled={emailBusy} data-testid="email-remove">{t('profile.email_remove')}</Button>
					</div>
				{/if}
				<p class="text-xs text-muted-foreground">{t('profile.email_recovery_note')}</p>
			</div>
		</Panel>

		<Panel title={t('profile.setup_title')} data-testid="setup-panel">
			<div class="flex flex-col gap-3">
				<p class="text-sm" data-testid="setup-state">{t(`profile.setup_state_${profile.onboarding.state}` as MessageKey)}</p>
				<p class="text-xs text-muted-foreground">{t('profile.setup_hint')}</p>
				<div><Button variant="outline" size="sm" href="/onboarding" data-testid="setup-repeat">{profile.onboarding.state === 'pending' ? t('profile.setup_start') : t('profile.setup_repeat')}</Button></div>
			</div>
		</Panel>
	</div>
{/if}
