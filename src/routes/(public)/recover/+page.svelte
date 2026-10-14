<script lang="ts">
	import { goto } from '$app/navigation';
	import { api } from '#lib/api/client.js';
	import type { RecoveryMethod } from '#lib/api/types.js';
	import AuthShell from '#lib/components/app/AuthShell.svelte';
	import Field from '#lib/components/app/Field.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { errorMessage, t } from '#lib/i18n/index.js';
	import { sessionStore } from '#lib/session.svelte.js';

	const methods: RecoveryMethod[] = ['recovery-code', 'fallback-password', 'email'];

	let step = $state<'start' | 'proof'>('start');
	let method = $state<RecoveryMethod>('recovery-code');
	let handle = $state('');
	let proof = $state('');
	let recoveryId = '';
	let busy = $state(false);
	let error = $state('');

	async function start(event: Event) {
		event.preventDefault();
		busy = true;
		error = '';
		try {
			recoveryId = (await api.recoveryStart(method, handle.trim())).recoveryId;
			step = 'proof';
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}

	async function complete(event: Event) {
		event.preventDefault();
		busy = true;
		error = '';
		try {
			sessionStore.set(await api.recoveryComplete(recoveryId, method === 'fallback-password' ? proof : proof.trim()));
			proof = '';
			await goto('/recover/passkey', { replaceState: true });
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}
</script>

<AuthShell
	title={t('recover.title')}
	description={step === 'start' ? t('recover.description') : t(`recover.proof_intro.${method}`)}
>
	{#if error}<Alert variant="destructive">{error}</Alert>{/if}
	{#if step === 'start'}
		<form class="flex flex-col gap-4" onsubmit={start}>
			<Field
				id="recover-handle"
				label={t('recover.handle')}
				bind:value={handle}
				autocomplete="username"
				autocapitalize="none"
				spellcheck={false}
				required
			/>
			<fieldset class="flex flex-col gap-2">
				<legend class="mb-1 text-sm font-medium">{t('recover.method')}</legend>
				{#each methods as option (option)}
					<label class="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm has-[:checked]:border-ring has-[:checked]:bg-muted">
						<input type="radio" name="method" value={option} bind:group={method} class="mt-0.5" />
						<span>
							<span class="block font-medium">{t(`recover.method.${option}`)}</span>
							<span class="block text-muted-foreground">{t(`recover.method_hint.${option}`)}</span>
						</span>
					</label>
				{/each}
			</fieldset>
			<Button type="submit" size="lg" disabled={busy}>{t('common.next')}</Button>
		</form>
	{:else}
		<form class="flex flex-col gap-4" onsubmit={complete}>
			<Field
				id="recover-proof"
				label={t(`recover.proof_label.${method}`)}
				type={method === 'fallback-password' ? 'password' : 'text'}
				autocomplete={method === 'email' ? 'one-time-code' : method === 'fallback-password' ? 'current-password' : 'off'}
				bind:value={proof}
				required
			/>
			<div class="flex gap-2">
				<Button type="submit" size="lg" disabled={busy}>{t('recover.verify')}</Button>
				<Button variant="ghost" size="lg" onclick={() => ((step = 'start'), (error = ''))}>{t('common.back')}</Button>
			</div>
		</form>
	{/if}
	<a class="text-center text-sm text-muted-foreground underline underline-offset-4" href="/login">{t('recover.back_to_login')}</a>
</AuthShell>
