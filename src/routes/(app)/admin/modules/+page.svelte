<script lang="ts">
	import { api } from '#lib/api/client.js';
	import { ApiError } from '#lib/api/errors.js';
	import { MODULE_KEYS, type ModuleKey, type ServerModule } from '#lib/api/types.js';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#lib/components/ui/card/index.js';
	import { errorMessage, t, type MessageKey } from '#lib/i18n/index.js';
	import { moduleStore } from '#lib/modules/store.svelte.js';
	import { onMount } from 'svelte';

	let server = $state<ServerModule[] | null>(null);
	let draft = $state<Partial<Record<ModuleKey, boolean>>>({});
	let loading = $state(true);
	let unavailable = $state(false);
	let saving = $state(false);
	let confirming = $state(false);
	let error = $state('');
	let notice = $state('');

	const nameOf = (key: ModuleKey) => t(`module.${key}.name` as MessageKey);
	const valueOf = (m: ServerModule) => draft[m.key] ?? m.enabled;
	const changes = $derived((server ?? []).filter((m) => !m.lockedByOperator && valueOf(m) !== m.enabled));
	const switchingOff = $derived(changes.filter((m) => !valueOf(m)));

	onMount(async () => {
		try {
			server = await api.getServerModules();
		} catch (e) {
			if (e instanceof ApiError && (e.status === 404 || e.status === 501)) unavailable = true;
			else error = e instanceof ApiError && e.status === 403 ? t('admin_modules.forbidden') : errorMessage(e);
		} finally {
			loading = false;
		}
	});

	function requestSave() {
		error = '';
		notice = '';
		if (changes.length === 0) {
			notice = t('admin_modules.nothing_changed');
			return;
		}
		if (switchingOff.length > 0) confirming = true;
		else void save();
	}

	async function save() {
		confirming = false;
		saving = true;
		error = '';
		notice = '';
		const payload: Partial<Record<ModuleKey, boolean>> = {};
		for (const m of changes) payload[m.key] = valueOf(m);
		try {
			server = await api.putServerModules(payload);
			draft = {};
			notice = t('admin_modules.saved');
			// the admin's own effective state may have changed as well
			await moduleStore.refresh();
		} catch (e) {
			error = errorMessage(e);
			try {
				server = await api.getServerModules();
				draft = {};
			} catch {
				// keep the draft; the error above is what matters
			}
		} finally {
			saving = false;
		}
	}
</script>

<PageHeader title={t('admin_modules.title')} description={t('admin_modules.description')} />

{#if loading}
	<p class="text-sm text-muted-foreground">{t('common.loading')}</p>
{:else if unavailable}
	<Alert variant="warning" data-testid="modules-unavailable">{t('modules.unavailable')}</Alert>
{:else if !server}
	<Alert variant="destructive">{error}</Alert>
{:else}
	<div class="flex flex-col gap-4">
		<Alert data-testid="admin-modules-note">{t('admin_modules.note')}</Alert>
		{#if error}<Alert variant="destructive">{error}</Alert>{/if}
		{#if notice}<p class="text-sm text-muted-foreground" role="status">{notice}</p>{/if}

		<ul class="flex flex-col gap-4" data-testid="admin-module-list">
			{#each MODULE_KEYS as key (key)}
				{@const m = server.find((s) => s.key === key)}
				{#if m}
					<li data-module={key}>
						<Card>
							<CardHeader>
								<div class="flex flex-wrap items-center justify-between gap-3">
									<CardTitle>{nameOf(key)}</CardTitle>
									<div class="flex items-center gap-3">
										<Badge variant={valueOf(m) ? 'default' : 'secondary'}>
											{m.lockedByOperator ? t('admin_modules.locked') : valueOf(m) ? t('admin_modules.on') : t('admin_modules.off')}
										</Badge>
										<input
											type="checkbox"
											role="switch"
											class="size-5 accent-primary"
											checked={valueOf(m)}
											disabled={m.lockedByOperator || saving}
											aria-label={t('modules.switch_label', { name: nameOf(key) })}
											data-testid="admin-switch-{key}"
											onchange={(e) => (draft = { ...draft, [key]: e.currentTarget.checked })}
										/>
									</div>
								</div>
								<CardDescription>{t(`module.${key}.desc` as MessageKey)}</CardDescription>
							</CardHeader>
							{#if m.lockedByOperator}
								<CardContent><p class="text-sm text-muted-foreground" data-testid="admin-module-locked">{t('admin_modules.locked_hint')}</p></CardContent>
							{/if}
						</Card>
					</li>
				{/if}
			{/each}
		</ul>

		{#if confirming}
			<div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" class="rounded-lg border border-destructive/50 bg-card p-4" data-testid="admin-confirm">
				<h2 id="confirm-title" class="font-semibold">{t('admin_modules.confirm_title')}</h2>
				<p class="mt-1 text-sm">{t('admin_modules.confirm_body', { names: switchingOff.map((m) => nameOf(m.key)).join(', ') })}</p>
				<div class="mt-3 flex flex-wrap gap-2">
					<Button variant="destructive" onclick={save} data-testid="admin-confirm-yes">{t('admin_modules.confirm_yes')}</Button>
					<Button variant="outline" onclick={() => (confirming = false)}>{t('common.cancel')}</Button>
				</div>
			</div>
		{:else}
			<div><Button onclick={requestSave} disabled={saving} data-testid="admin-save">{t('admin_modules.save')}</Button></div>
		{/if}
	</div>
{/if}
