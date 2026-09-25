<script lang="ts">
	/** A funder or recipient name that opens its card; blank names are plain text. */
	import { cardHref, openOrg } from '$lib/url.svelte';
	import { said } from '$lib/format';
	import type { OrgKind } from '$lib/sql';

	let { kind, name }: { kind: OrgKind; name: string | null | undefined } = $props();

	function click(e: MouseEvent) {
		// modified clicks keep the browser's own behaviour (new tab, window…)
		if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		e.preventDefault();
		openOrg(kind, name!);
	}
</script>

{#if name && said(name)}
	<a class="org" href={cardHref(kind, name)} onclick={click}>{name}</a>
{:else}
	<span class="muted">not recorded</span>
{/if}
