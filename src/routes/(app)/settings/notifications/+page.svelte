<script lang="ts">
	import EmptyState from '#lib/components/app/EmptyState.svelte';
	import { api, ApiError } from '#lib/api/client.js';
	import {
		NOTIFICATION_CATEGORIES,
		type NotificationCategory,
		type PushConfig,
		type PushSubscriptionInfo
	} from '#lib/api/types.js';
	import { formatDateTime } from '#lib/browser.js';
	import Field from '#lib/components/app/Field.svelte';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import Unavailable from '#lib/components/time/Unavailable.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#lib/components/ui/card/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Select } from '#lib/components/ui/select/index.js';
	import { CATEGORY_MODULES } from '#lib/modules/map.js';
	import { moduleStore } from '#lib/modules/store.svelte.js';
	import { errorMessage, t, type MessageKey } from '#lib/i18n/index.js';
	import { DEFAULT_FORM, formFromSettings, settingsFromForm, validateForm, type FormErrors, type SettingsForm } from '#lib/notifications/settings.js';
	import {
		browserSubscription,
		permissionState,
		pushSupported,
		requestPermission,
		subscribeBrowser,
		toSubscriptionInput,
		unsubscribeBrowser,
		type PermissionState
	} from '#lib/pwa/push.js';
	import { pwa } from '#lib/pwa/pwa.svelte.js';
	import { weekdayLabel } from '#lib/time/labels.js';
	import { toLoadState, type LoadState } from '#lib/time/load.js';
	import { onMount } from 'svelte';

	let load = $state<LoadState>({ status: 'loading' });
	let form = $state<SettingsForm>(structuredClone(DEFAULT_FORM));
	let errors = $state<FormErrors>({});
	let saving = $state(false);
	let saveNotice = $state('');
	let saveError = $state('');

	let config = $state<PushConfig>({ available: false });
	let supported = $state(true);
	let permission = $state<PermissionState>('default');
	let subscriptions = $state<PushSubscriptionInfo[]>([]);
	/** server id of this browser's subscription; null when this device has none */
	let thisDeviceId = $state<string | null>(null);
	let pushBusy = $state(false);
	let pushNotice = $state('');
	let pushError = $state('');

	const weekdays = [1, 2, 3, 4, 5, 6, 7];
	const labelOf = (kind: NotificationCategory) => t(`notifications.kind.${kind}` as MessageKey);
	const descOf = (kind: NotificationCategory) => t(`notif_settings.${kind}_desc` as MessageKey);

	async function syncDevice() {
		supported = pushSupported();
		if (!supported) return;
		permission = permissionState();
		thisDeviceId = null;
		if (permission !== 'granted' || !config.available) return;
		try {
			const existing = await browserSubscription();
			if (!existing) return;
			// POST is idempotent over the endpoint and answers with the id, which identifies this device in the list.
			const info = await api.createPushSubscription(toSubscriptionInput(existing, navigator.userAgent));
			thisDeviceId = info.id;
		} catch {
			// the device just shows as not enabled; the explicit enable button reports errors
		}
	}

	async function refreshSubscriptions() {
		subscriptions = await api.listPushSubscriptions();
	}

	onMount(async () => {
		try {
			const [settings, pushConfig] = await Promise.all([api.getNotificationSettings(), api.pushConfig()]);
			form = formFromSettings(settings);
			config = pushConfig;
			await syncDevice();
			try {
				await refreshSubscriptions();
			} catch {
				subscriptions = [];
			}
			load = { status: 'ready' };
		} catch (e) {
			load = toLoadState(e);
		}
	});

	async function save(event: Event) {
		event.preventDefault();
		if (saving) return;
		saveNotice = '';
		saveError = '';
		errors = validateForm(form);
		if (Object.keys(errors).length > 0) return;
		saving = true;
		try {
			const saved = await api.putNotificationSettings(settingsFromForm(form));
			form = formFromSettings(saved);
			saveNotice = t('notif_settings.saved');
		} catch (e) {
			saveError = errorMessage(e);
		} finally {
			saving = false;
		}
	}

	function pushErrorText(e: unknown): string {
		if (e instanceof ApiError && e.code === 'push_unavailable') return t('error.push_unavailable');
		return errorMessage(e);
	}

	async function enable() {
		if (pushBusy || !config.vapidPublicKey) return;
		pushBusy = true;
		pushNotice = '';
		pushError = '';
		try {
			permission = await requestPermission();
			if (permission !== 'granted') return;
			const { subscription, created } = await subscribeBrowser(config.vapidPublicKey);
			try {
				const info = await api.createPushSubscription(toSubscriptionInput(subscription, navigator.userAgent));
				thisDeviceId = info.id;
				pushNotice = t('push.enabled_done');
				await refreshSubscriptions();
			} catch (e) {
				if (created) await subscription.unsubscribe().catch(() => {});
				throw e;
			}
		} catch (e) {
			pushError = pushErrorText(e);
		} finally {
			pushBusy = false;
		}
	}

	async function disable() {
		if (pushBusy || !thisDeviceId) return;
		pushBusy = true;
		pushNotice = '';
		pushError = '';
		try {
			await api.deletePushSubscription(thisDeviceId);
			await unsubscribeBrowser();
			thisDeviceId = null;
			pushNotice = t('push.disabled_done');
			await refreshSubscriptions();
		} catch (e) {
			pushError = pushErrorText(e);
		} finally {
			pushBusy = false;
		}
	}

	async function removeDevice(info: PushSubscriptionInfo) {
		if (pushBusy) return;
		if (info.id === thisDeviceId) return disable();
		pushBusy = true;
		pushNotice = '';
		pushError = '';
		try {
			await api.deletePushSubscription(info.id);
			pushNotice = t('push.removed');
			await refreshSubscriptions();
		} catch (e) {
			pushError = pushErrorText(e);
		} finally {
			pushBusy = false;
		}
	}

	async function sendTest(info: PushSubscriptionInfo) {
		if (pushBusy) return;
		pushBusy = true;
		pushNotice = '';
		pushError = '';
		try {
			await api.sendTestPush(info.id);
			pushNotice = t('push.test_sent');
			await refreshSubscriptions();
		} catch (e) {
			if (e instanceof ApiError && e.status === 429) pushError = t('push.test_rate');
			else if (e instanceof ApiError && e.status === 502) pushError = t('push.test_failed');
			else if (e instanceof ApiError && e.status === 501) pushError = t('push.unavailable_server');
			else pushError = errorMessage(e);
		} finally {
			pushBusy = false;
		}
	}

	const showIosHint = $derived(pwa.isIos);
</script>

<PageHeader title={t('notif_settings.title')} description={t('notif_settings.description')} />

{#if load.status === 'loading'}
	<p class="text-sm text-muted-foreground" role="status">{t('common.loading')}</p>
{:else if load.status === 'unavailable'}
	<Unavailable />
{:else if load.status === 'error'}
	<Alert variant="destructive">{load.message}</Alert>
{:else}
	<div class="flex flex-col gap-6">
		<form class="flex flex-col gap-6" onsubmit={save} novalidate>
			<Card>
				<CardHeader>
					<CardTitle>{t('notif_settings.categories_title')}</CardTitle>
				</CardHeader>
				<CardContent>
					<ul class="divide-y" data-testid="category-list">
						{#each NOTIFICATION_CATEGORIES.filter((k) => !(k in CATEGORY_MODULES) || moduleStore.enabled(CATEGORY_MODULES[k as keyof typeof CATEGORY_MODULES])) as kind (kind)}
							<li class="flex flex-col gap-3 py-4 first:pt-0 last:pb-0" data-kind={kind}>
								<div>
									<p class="font-medium">{labelOf(kind)}</p>
									<p class="text-sm text-muted-foreground">{descOf(kind)}</p>
								</div>
								<div class="flex flex-wrap gap-x-6 gap-y-2">
									<div class="flex items-center gap-2">
										<Checkbox id="{kind}-in-app" bind:checked={form.categories[kind].inApp} />
										<Label for="{kind}-in-app">{t('notif_settings.col_in_app')}</Label>
									</div>
									<div class="flex items-center gap-2">
										<Checkbox id="{kind}-push" bind:checked={form.categories[kind].push} />
										<Label for="{kind}-push">{t('notif_settings.col_push')}</Label>
									</div>
								</div>
								{#if kind === 'running_timer'}
									<div class="max-w-xs">
										<Field
											id="threshold"
											label={t('notif_settings.threshold_label')}
											hint={t('notif_settings.threshold_hint')}
											inputmode="numeric"
											bind:value={form.thresholdMinutes}
											error={errors.thresholdMinutes ? t('notif_settings.threshold_error') : undefined}
										/>
									</div>
								{/if}
								{#if kind === 'report_gap'}
									<div class="flex flex-wrap gap-4">
										<div class="flex flex-col gap-1.5">
											<Label for="gap-weekday">{t('notif_settings.weekday_label')}</Label>
											<Select id="gap-weekday" class="w-32" value={String(form.weekday)} onchange={(e) => (form.weekday = Number(e.currentTarget.value))}>
												{#each weekdays as day (day)}<option value={String(day)}>{weekdayLabel(day)}</option>{/each}
											</Select>
										</div>
										<div class="w-32">
											<Field
												id="gap-time"
												type="time"
												label={t('notif_settings.time_label')}
												bind:value={form.time}
												error={errors.time ? t('notif_settings.time_error') : undefined}
											/>
										</div>
									</div>
								{/if}
							</li>
						{/each}
					</ul>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>{t('notif_settings.quiet_title')}</CardTitle>
					<CardDescription>{t('notif_settings.quiet_desc')}</CardDescription>
				</CardHeader>
				<CardContent class="flex flex-col gap-4">
					<div class="flex items-center gap-2">
						<Switch id="quiet-enabled" bind:checked={form.quietEnabled} />
						<Label for="quiet-enabled">{t('notif_settings.quiet_enabled')}</Label>
					</div>
					{#if form.quietEnabled}
						<div class="flex flex-wrap gap-4">
							<div class="w-32"><Field id="quiet-start" type="time" label={t('notif_settings.quiet_start')} bind:value={form.quietStart} /></div>
							<div class="w-32"><Field id="quiet-end" type="time" label={t('notif_settings.quiet_end')} bind:value={form.quietEnd} /></div>
						</div>
						{#if errors.quiet}<p class="text-xs text-destructive">{t('notif_settings.quiet_error')}</p>{/if}
					{/if}
				</CardContent>
			</Card>

			{#if saveNotice}<Alert variant="success">{saveNotice}</Alert>{/if}
			{#if saveError}<Alert variant="destructive">{saveError}</Alert>{/if}
			<div><Button type="submit" disabled={saving}>{t('notif_settings.save')}</Button></div>
		</form>

		<Card data-testid="push-card">
			<CardHeader>
				<CardTitle>{t('push.title')}</CardTitle>
			</CardHeader>
			<CardContent class="flex flex-col gap-4">
				{#if showIosHint}<Alert variant="warning" data-testid="ios-hint">{t('push.ios_hint')}</Alert>{/if}
				{#if pushNotice}<Alert variant="success">{pushNotice}</Alert>{/if}
				{#if pushError}<Alert variant="destructive">{pushError}</Alert>{/if}

				{#if !config.available}
					<p class="text-sm" data-testid="push-state">{t('push.available_no')}</p>
				{:else if !supported}
					<p class="text-sm" data-testid="push-state">{t('push.unsupported')}</p>
				{:else if permission === 'denied'}
					<p class="text-sm" data-testid="push-state">{t('push.denied')}</p>
				{:else if thisDeviceId}
					<p class="text-sm" data-testid="push-state">{t('push.enabled')}</p>
					<div><Button variant="outline" onclick={disable} disabled={pushBusy}>{t('push.disable')}</Button></div>
				{:else}
					<p class="text-sm" data-testid="push-state">{t('push.disabled')}</p>
					<div><Button onclick={enable} disabled={pushBusy}>{t('push.enable')}</Button></div>
				{/if}

				<div>
					<h3 class="mb-2 text-sm font-medium">{t('push.subscriptions_title')}</h3>
					{#if subscriptions.length === 0}
						<EmptyState title={t('push.subscriptions_empty')} />
					{:else}
						<ul class="divide-y" data-testid="subscription-list">
							{#each subscriptions as info (info.id)}
								<li class="flex flex-wrap items-center justify-between gap-3 py-3" data-this-device={info.id === thisDeviceId}>
									<div class="min-w-0">
										<p class="font-medium break-words">
											{info.host ?? t('push.unknown_device')}
											{#if info.id === thisDeviceId}<span class="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal">{t('push.this_device')}</span>{/if}
										</p>
										<p class="text-xs break-words text-muted-foreground">{info.userAgent ?? ''}</p>
										<p class="text-xs text-muted-foreground">
											{t('push.created', { date: formatDateTime(info.createdAt) })} · {info.lastSuccessAt
												? t('push.last_success', { date: formatDateTime(info.lastSuccessAt) })
												: t('push.never_delivered')}
										</p>
									</div>
									<div class="flex gap-2">
										<Button size="sm" variant="outline" onclick={() => sendTest(info)} disabled={pushBusy || !config.available}>{t('push.test')}</Button>
										<Button size="sm" variant="destructive" onclick={() => removeDevice(info)} disabled={pushBusy}>{t('push.remove')}</Button>
									</div>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			</CardContent>
		</Card>

		<Card data-testid="install-card">
			<CardHeader>
				<CardTitle>{t('install.title')}</CardTitle>
				<CardDescription>{t('install.description')}</CardDescription>
			</CardHeader>
			<CardContent class="flex flex-col gap-3">
				{#if pwa.installed}
					<p class="text-sm">{t('install.done')}</p>
				{:else if pwa.installEvent}
					<div><Button onclick={() => pwa.promptInstall()}>{t('install.action')}</Button></div>
				{:else if pwa.isIos}
					<p class="text-sm">{t('install.ios')}</p>
				{:else}
					<p class="text-sm text-muted-foreground">{t('install.other')}</p>
				{/if}
			</CardContent>
		</Card>
	</div>
{/if}
