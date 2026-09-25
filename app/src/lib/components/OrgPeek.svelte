<script lang="ts">
	/**
	 * Headline figures for the funder or recipient name under the cursor,
	 * across all of its grants. One summary query (2–80 ms) after a dwell,
	 * cached by name.
	 */
	import { query } from '$lib/db.svelte';
	import { orgSummarySql, ORG, type OrgKind } from '$lib/sql';
	import { int, money } from '$lib/format';
	import Tip from './Tip.svelte';

	let { kind, name, x, y }: { kind: OrgKind | null; name: string | null; x: number; y: number } = $props();

	interface Summary {
		n: number;
		amt: number | null;
		med: number | null;
		y0: number | null;
		y1: number | null;
		others: number;
	}
	const cache = new Map<string, Summary>();
	let shown = $state<{ kind: OrgKind; name: string; s: Summary } | null>(null);

	let timer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const k = kind;
		const n = name;
		clearTimeout(timer);
		if (!k || !n) {
			shown = null;
			return;
		}
		if (shown?.kind === k && shown.name === n) return;
		const key = `${k}\u0000${n}`;
		timer = setTimeout(async () => {
			let s = cache.get(key);
			if (!s) {
				try {
					s = [...(await query(orgSummarySql(k, n))).rows()][0] as unknown as Summary;
				} catch (err) {
					console.warn('summary lookup failed', err);
					return;
				}
				if (cache.size > 300) cache.delete(cache.keys().next().value!);
				cache.set(key, s);
			}
			if (kind === k && name === n) shown = { kind: k, name: n, s };
		}, shown ? 40 : 140);
	});

	const years = (s: Summary) => (s.y0 == null ? '—' : s.y0 === s.y1 ? String(s.y0) : `${s.y0}–${s.y1}`);
</script>

{#if shown}
	<Tip {x} {y}>
		<p class="kind">{ORG[shown.kind].label}</p>
		<h4>{shown.name}</h4>
		<dl>
			<dt>Grants</dt>
			<dd class="grants">{int(shown.s.n)}</dd>
			<dt>Total</dt>
			<dd class="money">{money(shown.s.amt)}</dd>
			<dt>Median</dt>
			<dd>{money(shown.s.med)}</dd>
			<dt>Years</dt>
			<dd>{years(shown.s)}</dd>
			<dt>{ORG[shown.kind].otherLabel}s</dt>
			<dd>{int(shown.s.others)}</dd>
		</dl>
		<p class="foot">Across all grants. Click for the {ORG[shown.kind].label.toLowerCase()}'s page.</p>
	</Tip>
{/if}

<style>
	.kind {
		margin: 0 0 0.15rem;
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-faint);
	}
	.grants {
		color: var(--grants);
		font-weight: 600;
		font-family: var(--mono);
	}
</style>
