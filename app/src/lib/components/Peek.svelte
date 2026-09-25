<script lang="ts">
	/**
	 * The whole description for the grant title under the cursor. Grid rows
	 * carry only the start of it, so the rest is fetched here by funder +
	 * identifier (~6 ms, see descSql) after a short dwell, and cached.
	 */
	import { query } from '$lib/db.svelte';
	import { descSql, type GridRow } from '$lib/sql';
	import { moneyExact, ukDate, said } from '$lib/format';
	import Tip from './Tip.svelte';

	let { row, x, y }: { row: GridRow | null; x: number; y: number } = $props();

	interface Extra {
		d: string | null;
		programme: string | null;
		district: string | null;
	}
	const cache = new Map<string, Extra>();
	let extra = $state<Extra | null>(null);
	let shown = $state<GridRow | null>(null);

	const DWELL = 140;
	let timer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		const r = row;
		clearTimeout(timer);
		if (!r) {
			shown = null;
			return;
		}
		if (shown?.id === r.id) return;
		// moving between titles keeps the peek open and just retargets it
		timer = setTimeout(async () => {
			const hit = cache.get(r.id);
			if (hit) {
				extra = hit;
				shown = r;
				return;
			}
			try {
				const res = await query(descSql(r.id, r.funder));
				const got = ([...res.rows()][0] ?? { d: null, programme: null, district: null }) as unknown as Extra;
				if (cache.size > 500) cache.delete(cache.keys().next().value!);
				cache.set(r.id, got);
				if (row?.id !== r.id) return;
				extra = got;
				shown = r;
			} catch (err) {
				console.warn('description lookup failed', err);
			}
		}, shown ? 40 : DWELL);
	});

	const desc = $derived(extra?.d && extra.d !== shown?.title ? extra.d : '');
</script>

{#if shown}
	<Tip {x} {y}>
		<h4>{shown.title || desc.slice(0, 120) || '(untitled grant)'}</h4>
		{#if desc && shown.title}
			<p class="desc">{desc}</p>
		{:else if !desc && !shown.title}
			<p class="none">No description was published for this grant.</p>
		{:else if !desc}
			<p class="none">No description beyond the title.</p>
		{/if}
		<dl>
			<dt>Amount</dt>
			<dd class="money">{moneyExact(shown.amount)} <span class="on">on {ukDate(shown.date)}</span></dd>
			<dt>Recipient</dt>
			<dd>
				{said(shown.recipient) || '—'}{said(extra?.district) ? `, ${said(extra?.district)}` : ''}
			</dd>
			<dt>Funder</dt>
			<dd>{said(shown.funder) || '—'}</dd>
			{#if said(extra?.programme)}
				<dt>Programme</dt>
				<dd>{extra?.programme}</dd>
			{/if}
		</dl>
		<p class="foot">Click the title for every field.</p>
	</Tip>
{/if}

<style>
	.desc,
	.none {
		margin: 0 0 0.55rem;
		line-height: 1.5;
		color: var(--text);
		display: -webkit-box;
		-webkit-line-clamp: 11;
		line-clamp: 11;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.none {
		color: var(--text-faint);
		font-style: italic;
	}
	.on {
		color: var(--text-muted);
		font-weight: 400;
	}
</style>
