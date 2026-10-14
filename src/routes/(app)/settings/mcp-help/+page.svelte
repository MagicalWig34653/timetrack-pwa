<script lang="ts">
	import CopyButton from '#lib/components/app/CopyButton.svelte';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#lib/components/ui/card/index.js';
	import { t } from '#lib/i18n/index.js';
	import { mcpServerUrl } from '#lib/mcp/scopes.js';

	const origin = typeof location === 'undefined' ? 'https://example.org' : location.origin;
	const url = mcpServerUrl(origin);
	const isLocal = typeof location !== 'undefined' && /^(localhost|127\.|\[::1\])/.test(location.hostname);
	const header = 'Authorization: Bearer <Token>';
	const flow = ['mcphelp.flow_1', 'mcphelp.flow_2', 'mcphelp.flow_3', 'mcphelp.flow_4'] as const;
	const chatgpt = ['mcphelp.chatgpt_1', 'mcphelp.chatgpt_2', 'mcphelp.chatgpt_3', 'mcphelp.chatgpt_4', 'mcphelp.chatgpt_5'] as const;
	const claude = ['mcphelp.claude_1', 'mcphelp.claude_2', 'mcphelp.claude_3', 'mcphelp.claude_4'] as const;
	const security = ['mcphelp.security_1', 'mcphelp.security_2', 'mcphelp.security_3', 'mcphelp.security_4', 'mcphelp.security_5'] as const;
</script>

<PageHeader title={t('mcphelp.title')} description={t('mcphelp.description')} />

<div class="flex flex-col gap-4">
	<Alert variant="warning" data-testid="untested">{t('mcphelp.untested')}</Alert>

	<Card>
		<CardHeader>
			<CardTitle>{t('mcphelp.url_title')}</CardTitle>
			<CardDescription>{t('mcphelp.url_text')}</CardDescription>
		</CardHeader>
		<CardContent class="flex flex-col gap-3">
			<div class="flex flex-wrap items-center gap-2">
				<code class="rounded border bg-muted/40 px-2 py-1 text-sm break-all" data-testid="mcp-url">{url}</code>
				<CopyButton text={url} label={t('mcphelp.url_copy')} />
			</div>
			{#if isLocal}<Alert variant="warning">{t('mcphelp.url_local')}</Alert>{/if}
		</CardContent>
	</Card>

	<Card>
		<CardHeader><CardTitle>{t('mcphelp.flow_title')}</CardTitle></CardHeader>
		<CardContent>
			<ol class="list-decimal space-y-1 pl-5 text-sm">
				{#each flow as key (key)}<li>{t(key)}</li>{/each}
			</ol>
		</CardContent>
	</Card>

	<Card>
		<CardHeader><CardTitle>{t('mcphelp.chatgpt_title')}</CardTitle></CardHeader>
		<CardContent>
			<ol class="list-decimal space-y-1 pl-5 text-sm">
				{#each chatgpt as key (key)}<li>{t(key)}</li>{/each}
			</ol>
		</CardContent>
	</Card>

	<Card>
		<CardHeader><CardTitle>{t('mcphelp.claude_title')}</CardTitle></CardHeader>
		<CardContent>
			<ol class="list-decimal space-y-1 pl-5 text-sm">
				{#each claude as key (key)}<li>{t(key)}</li>{/each}
			</ol>
		</CardContent>
	</Card>

	<Card>
		<CardHeader><CardTitle>{t('mcphelp.token_title')}</CardTitle></CardHeader>
		<CardContent class="flex flex-col gap-3 text-sm">
			<p>{t('mcphelp.token_text')}</p>
			<div class="flex flex-wrap items-center gap-2">
				<code class="rounded border bg-muted/40 px-2 py-1 text-sm break-all" data-testid="token-header">{header}</code>
				<CopyButton text={header} />
			</div>
			<p class="text-xs text-muted-foreground">{t('mcphelp.token_header_note')}</p>
			<p><a class="underline underline-offset-4" href="/settings/api-tokens">{t('mcphelp.token_link')}</a></p>
		</CardContent>
	</Card>

	<Card>
		<CardHeader><CardTitle>{t('mcphelp.security_title')}</CardTitle></CardHeader>
		<CardContent>
			<ul class="list-disc space-y-1 pl-5 text-sm">
				{#each security as key (key)}<li>{t(key)}</li>{/each}
			</ul>
		</CardContent>
	</Card>

	<Card>
		<CardHeader><CardTitle>{t('mcphelp.manage_title')}</CardTitle></CardHeader>
		<CardContent class="flex flex-col gap-1 text-sm">
			<a class="underline underline-offset-4" href="/settings/connections">{t('nav.connections')}</a>
			<a class="underline underline-offset-4" href="/settings/api-tokens">{t('nav.api_tokens')}</a>
		</CardContent>
	</Card>
</div>
