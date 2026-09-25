<script lang="ts">
	import { query } from '$lib/db.svelte';
	import { facetSql, FIND_LIMIT, type Facet, type State } from '$lib/sql';
	import { facetRows } from '$lib/facets.svelte';
	import { toggleFilter, clearFilter, type Measure } from '$lib/url.svelte';
	import { compact, money, int, moneyExact, stripOrder } from '$lib/format';

	let { facet, state: s, measure }: { facet: Facet; state: State; measure: Measure } = $props();

	let rows = $state<{ k: string | number | null; n: number; amt: number | null }[]>([]);
	let ms = $state(0);
	let needle = $state('');

	// A `find` facet (funders) fetches every value and the find box filters
	// them here: no query per keystroke, and the full list is also where the
	// header's funder count comes from (facets.svelte.ts).
	const sql = $derived(facetSql(s, facet, { by: measure, limit: facet.find ? FIND_LIMIT : 100 }));

	// A click in this facet leaves its own SQL unchanged (it ignores its own
	// filter), so skip the re-query the reactive graph would otherwise schedule.
	let lastSql = '';
	let seq = 0;
	$effect(() => {
		const q = sql;
		if (q === lastSql) return;
		lastSql = q;
		const mine = ++seq;
		query(q).then((r) => {
			if (mine !== seq) return;
			ms = r.elapsedMs;
			rows = ([...r.rows()] as typeof rows).filter((x) => x.k != null && x.k !== '');
			facetRows[facet.key] = rows;
		});
	});

	const selected = $derived(new Set(s.filters.get(facet.key) ?? []));
	const value = (r: (typeof rows)[number]) => (measure === 'amt' ? (r.amt ?? 0) : r.n);
	const shown = $derived.by(() => {
		const q = needle.trim().toLowerCase();
		return q ? rows.filter((r) => String(r.k).toLowerCase().includes(q)) : rows;
	});
	const max = $derived(Math.max(1, ...shown.map(value)));
	const label = (k: string | number) => (facet.strip ? stripOrder(String(k)) : String(k));
</script>

<section class="card facet">
	<h3>
		{facet.label}
		{#if selected.size}
			<button class="clear" onclick={() => clearFilter(facet.key)}>clear{selected.size > 1 ? ` ${selected.size}` : ''}</button>
		{/if}
		<span class="ms">{ms.toFixed(1)} ms</span>
	</h3>
	{#if facet.find}
		<input
			class="find"
			type="search"
			placeholder="find a {facet.label.toLowerCase()}…"
			aria-label="Find a {facet.label.toLowerCase()}"
			bind:value={needle}
		/>
	{/if}
	<div class="head">
		<span class="label">value</span>
		<span class="num" class:on={measure === 'n'}>grants</span>
		<span class="num amt" class:on={measure === 'amt'}>awarded</span>
	</div>
	<div class="list">
		{#each shown as r (r.k)}
			{@const k = String(r.k)}
			<button
				class="row"
				class:selected={selected.has(k)}
				aria-pressed={selected.has(k)}
				onclick={() => toggleFilter(facet.key, k)}
				title="{label(k)} — {int(r.n)} grants, {moneyExact(r.amt)}"
			>
				<span class="bar" class:money={measure === 'amt'} style:width="{(100 * value(r)) / max}%"></span>
				<span class="label">{label(k)}</span>
				<span class="num">{compact(r.n)}</span>
				<span class="num amt">{money(r.amt)}</span>
			</button>
		{:else}
			<p class="none">{needle.trim() ? `No ${facet.label.toLowerCase()} matches “${needle.trim()}”.` : 'Nothing under the current filters.'}</p>
		{/each}
	</div>
</section>

<style>
	.facet {
		display: flex;
		flex-direction: column;
	}
	.clear {
		border: 0;
		background: none;
		padding: 0;
		font-size: 0.72rem;
		font-weight: 400;
		color: var(--accent);
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
	}
	.find {
		width: 100%;
		margin: 0 0 0.35rem;
		padding: 0.25rem 0.5rem;
		font-size: 0.8rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--sunk);
	}
	.head,
	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 3.4rem 4.2rem;
		gap: 0.4rem;
		align-items: center;
	}
	.head {
		padding: 0 0.35rem 0.2rem;
		border-bottom: 1px solid var(--border-soft);
		font-size: 0.66rem;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--text-faint);
	}
	.head .on {
		color: var(--grants);
		font-weight: 600;
	}
	.head .amt.on {
		color: var(--money);
	}
	.list {
		height: 11.5rem;
		overflow-y: auto;
		scrollbar-width: thin;
		padding-top: 0.15rem;
	}
	.row {
		position: relative;
		width: 100%;
		border: 0;
		background: none;
		padding: 0.12rem 0.35rem;
		font-size: 0.82rem;
		text-align: left;
		cursor: pointer;
		border-radius: 4px;
	}
	.row:hover {
		box-shadow: inset 0 0 0 1px var(--border);
	}
	.row.selected {
		font-weight: 600;
		box-shadow: inset 0 0 0 1.5px var(--grants);
	}
	.bar {
		position: absolute;
		inset: 1px auto 1px 0;
		background: var(--grants-tint);
		border-radius: 4px;
	}
	.bar.money {
		background: var(--money-tint);
	}
	.label,
	.num {
		position: relative;
	}
	.label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.num {
		text-align: right;
		font-family: var(--mono);
		font-size: 0.74rem;
		font-variant-numeric: tabular-nums;
		color: var(--text-muted);
	}
	.row .amt {
		color: var(--money);
	}
	.none {
		margin: 0.6rem 0.35rem;
		color: var(--text-faint);
		font-size: 0.8rem;
	}
</style>
