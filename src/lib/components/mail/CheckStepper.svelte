<script lang="ts">
	import type { MailCheckResult, MailCheckStep } from '#lib/api/types.js';
	import { t } from '#lib/i18n/index.js';
	import { formatDuration, pendingSteps, stepTitleKey } from '#lib/mail/format.js';
	import CheckIcon from '@lucide/svelte/icons/check';
	import LoaderIcon from '@lucide/svelte/icons/loader-circle';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import XIcon from '@lucide/svelte/icons/x';

	/**
	 * Vertical stepper for the connection check. While the request runs every step waits; when the single response arrives the
	 * real steps appear one after the other (CSS stagger only, the durations shown are the measured ones).
	 */
	let { result = null, running = false }: { result?: MailCheckResult | null; running?: boolean } = $props();

	const tone = {
		ok: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
		failed: 'border-destructive/50 bg-destructive/10 text-destructive',
		skipped: 'border-border bg-muted text-muted-foreground'
	} as const;

	const statusKey = (step: MailCheckStep) => `mail.step.status_${step.status}` as const;
</script>

{#if running || result}
	<ol class="relative flex flex-col" data-testid="mail-steps" aria-live="polite" aria-busy={running}>
		{#if running}
			{#each pendingSteps() as step, index (step.id)}
				<li class="relative flex gap-3 pb-4 last:pb-0" data-testid="mail-step-{step.id}" data-status="pending">
					<span class="relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground">
						{#if index === 0}<LoaderIcon class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{:else}<span class="size-1.5 rounded-full bg-muted-foreground/60" aria-hidden="true"></span>{/if}
					</span>
					<div class="min-w-0 pt-0.5"><p class="text-sm font-medium text-muted-foreground">{t(stepTitleKey(step.id))}</p></div>
				</li>
			{/each}
		{:else if result}
			{#each result.steps as step, index (step.id)}
				<li class="mail-step relative flex gap-3 pb-4 last:pb-0" style="animation-delay: {index * 90}ms" data-testid="mail-step-{step.id}" data-status={step.status}>
					{#if index < result.steps.length - 1}<span class="absolute top-7 bottom-0 left-3.5 w-px -translate-x-1/2 bg-border" aria-hidden="true"></span>{/if}
					<span class="relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border {tone[step.status]}">
						{#if step.status === 'ok'}<CheckIcon class="size-4" aria-hidden="true" />{:else if step.status === 'failed'}<XIcon class="size-4" aria-hidden="true" />{:else}<MinusIcon class="size-4" aria-hidden="true" />{/if}
					</span>
					<div class="min-w-0 flex-1 pt-0.5">
						<div class="flex flex-wrap items-baseline justify-between gap-x-3">
							<p class="text-sm font-medium {step.status === 'skipped' ? 'text-muted-foreground' : ''}">
								{t(stepTitleKey(step.id))}<span class="sr-only"> – {t(statusKey(step))}</span>
							</p>
							{#if step.status !== 'skipped'}<span class="text-xs text-muted-foreground tabular-nums" data-testid="mail-step-{step.id}-time">{formatDuration(step.durationMs)}</span>{/if}
						</div>
						{#if step.status !== 'skipped'}
							{#each step.details as line (line)}<p class="mt-0.5 text-[13px] break-words text-muted-foreground">{line}</p>{/each}
						{:else if step.details[0]}
							<p class="mt-0.5 text-[13px] text-muted-foreground">{step.details[0]}</p>
						{/if}
						{#each step.warnings as warning (warning)}
							<p class="mt-1 text-[13px] text-amber-800 dark:text-amber-200" data-testid="mail-step-{step.id}-warning">{warning}</p>
						{/each}
						{#if step.certificate && (!step.certificate.hostnameMatches || step.certificate.daysLeft < 0)}
							<p class="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground" data-testid="mail-cert">
								<span class="font-medium">{t('mail.check.cert')}</span>
								<span>{step.certificate.hostnameMatches ? t('mail.check.cert_name_ok') : t('mail.check.cert_name_bad')}</span>
								<span>{step.certificate.daysLeft < 0 ? t('mail.check.cert_expired') : t('mail.check.cert_days', { days: step.certificate.daysLeft })}</span>
							</p>
						{/if}
						{#if step.problem}
							<div class="mt-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm" data-testid="mail-problem-{step.id}">
								<p class="font-medium text-destructive">{step.problem.message}</p>
								<p class="mt-2 text-[13px] font-medium">{t('mail.check.help')}</p>
								<p class="text-[13px]">{step.problem.advice}</p>
							</div>
						{/if}
					</div>
				</li>
			{/each}
		{/if}
	</ol>
{/if}

<style>
	.mail-step {
		animation: mail-step-in 260ms ease-out both;
	}
	@keyframes mail-step-in {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.mail-step {
			animation: none;
		}
	}
</style>
