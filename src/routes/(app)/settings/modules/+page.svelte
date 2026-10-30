<script lang="ts">
	import { api } from '#lib/api/client.js';
	import { MODULE_KEYS, type ModuleKey, type ModuleStatus } from '#lib/api/types.js';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#lib/components/ui/card/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import { errorMessage, t, type MessageKey } from '#lib/i18n/index.js';
	import { moduleStore } from '#lib/modules/store.svelte.js';
	import { onMount } from 'svelte';

	let loading = $state(!moduleStore.loaded);
	let busy = $state<ModuleKey | null>(null);
	let error = $state('');
	let notice = $state('');

	const rows = $derived(moduleStore.statuses);
	const planningOff = $derived(rows ? !(rows.find((r) => r.key === 'planning')?.effective ?? true) : false);

	onMount(async () => {
		await moduleStore.refresh();
		loading = false;
	});

	/** Optimistic: the store (and with it navigation and dashboard) follows immediately and is rolled back on failure. */
	async function toggle(key: ModuleKey, value: boolean) {
		if (busy || !moduleStore.statuses) return;
		const before = moduleStore.statuses;
		error = '';
		notice = '';
		busy = key;
		moduleStore.set(
			before.map((s) => (s.key === key ? { ...s, accountEnabled: value, effective: s.serverEnabled && value } : s))
		);
		try {
			moduleStore.set(await api.putMyModules({ [key]: value }));
			notice = t('modules.saved');
		} catch (e) {
			moduleStore.set(before);
			error = errorMessage(e);
			await moduleStore.refresh();
		} finally {
			busy = null;
		}
	}

	function stateOf(status: ModuleStatus): { label: string; hint: string | null } {
		if (status.lockedByOperator) return { label: t('modules.state_operator'), hint: t('modules.state_operator_hint') };
		if (!status.serverEnabled) return { label: t('modules.state_server'), hint: t('modules.state_server_hint') };
		return { label: status.effective ? t('modules.state_on') : t('modules.state_off'), hint: null };
	}
</script>

<PageHeader title={t('modules.title')} description={t('modules.description')} />

{#if loading}
	<p class="text-sm text-muted-foreground">{t('common.loading')}</p>
{:else if !rows}
	<Alert variant="warning" data-testid="modules-unavailable">{t('modules.unavailable')}</Alert>
{:else}
	<div class="flex flex-col gap-4">
		<p class="text-sm" data-testid="modules-note-data">{t('modules.note_data')}</p>
		{#if error}<Alert variant="destructive">{error}</Alert>{/if}
		{#if notice}<p class="text-sm text-muted-foreground" role="status" data-testid="modules-notice">{notice}</p>{/if}

		<ul class="flex flex-col gap-4" data-testid="module-list">
			{#each MODULE_KEYS as key (key)}
				{@const status = rows.find((r) => r.key === key)}
				{#if status}
					{@const state = stateOf(status)}
					{@const locked = !status.serverEnabled}
					<li data-module={key}>
						<Card>
							<CardHeader>
								<div class="flex flex-wrap items-center justify-between gap-3">
									<CardTitle>{t(`module.${key}.name` as MessageKey)}</CardTitle>
									<div class="flex items-center gap-3">
										<Badge variant={status.effective ? 'default' : 'secondary'} data-testid="module-state">{state.label}</Badge>
										<Switch
											checked={status.effective}
											disabled={locked || busy !== null}
											aria-label={t('modules.switch_label', { name: t(`module.${key}.name` as MessageKey) })}
											aria-busy={busy === key}
											data-testid="module-switch-{key}"
											onchange={(e) => toggle(key, e.currentTarget.checked)}
										/>
									</div>
								</div>
								<CardDescription>{t(`module.${key}.desc` as MessageKey)}</CardDescription>
							</CardHeader>
							{#if state.hint}
								<CardContent><p class="text-sm text-muted-foreground" data-testid="module-hint">{state.hint}</p></CardContent>
							{/if}
						</Card>
					</li>
				{/if}
			{/each}
		</ul>

		<Alert variant={planningOff ? 'warning' : 'default'} data-testid="modules-note-planning">{t('modules.note_planning')}</Alert>
	</div>
{/if}
