<script lang="ts">
	/**
	 * Grants (or money) by award year. It is the Award year facet drawn as bars:
	 * counted under every filter but its own, click a bar to toggle that year.
	 */
	import { query } from '$lib/db.svelte';
	import { facetSql, FACET_BY_KEY, type State } from '$lib/sql';
	import { toggleFilter, clearFilter, type Measure } from '$lib/url.svelte';
	import { int, money, moneyExact } from '$lib/format';
	import { facetRows } from '$lib/facets.svelte';

	let { state: s, measure }: { state: State; measure: Measure } = $props();
	const facet = FACET_BY_KEY.get('year')!;

	let rows = $state<{ k: number; n: number; amt: number | null }[]>([]);
	let ms = $state(0);
	let hover = $state<number | null>(null);

	const sql = $derived(facetSql(s, facet, { limit: 100 }));
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
			rows = ([...r.rows()] as typeof rows).filter((x) => x.k != null);
			facetRows.year = rows;
		});
	});

	// A continuous run of years, so a gap reads as a gap rather than vanishing.
	const years = $derived.by(() => {
		if (!rows.length) return [];
		const by = new Map(rows.map((r) => [r.k, r]));
		const y0 = Math.max(rows[0].k, rows.at(-1)!.k - 39);
		const out = [];
		for (let y = y0; y <= rows.at(-1)!.k; y++) out.push(by.get(y) ?? { k: y, n: 0, amt: 0 });
		return out;
	});
	const early = $derived(rows.filter((r) => years.length && r.k < years[0].k));
	const v = (r: { n: number; amt: number | null }) => (measure === 'amt' ? (r.amt ?? 0) : r.n);
	const max = $derived(Math.max(1, ...years.map(v)));
	const selected = $derived(new Set((s.filters.get('year') ?? []).map(Number)));
	const hovered = $derived(years.find((y) => y.k === hover) ?? null);

	const W = 600;
	const H = 110;
	const PAD_B = 14;
	const bw = $derived(years.length ? W / years.length : W);
</script>

<section class="card chart">
	<h3>
		Award year
		<span class="sub">
			{#if hovered}
				<b>{hovered.k}</b>: {int(hovered.n)} grants, {moneyExact(hovered.amt)}
			{:else}
				{measure === 'amt' ? 'money awarded' : 'number of grants'} by year · click a bar to filter
			{/if}
		</span>
		{#if selected.size}
			<button class="clear" onclick={() => clearFilter('year')}>clear</button>
		{/if}
		<span class="ms">{ms.toFixed(1)} ms</span>
	</h3>
	<svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" role="group" aria-label="Grants by award year">
		{#each years as y, i (y.k)}
			{@const h = ((H - PAD_B - 4) * v(y)) / max}
			<g
				class="yr"
				class:sel={selected.has(y.k)}
				class:dim={selected.size > 0 && !selected.has(y.k)}
				onmouseenter={() => (hover = y.k)}
				onmouseleave={() => (hover = null)}
				onclick={() => toggleFilter('year', String(y.k))}
				onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && toggleFilter('year', String(y.k))}
				role="button"
				tabindex="0"
				aria-pressed={selected.has(y.k)}
				aria-label="{y.k}: {int(y.n)} grants"
			>
				<rect class="hit" x={i * bw} y="0" width={bw} height={H} />
				<rect class="bar" class:money={measure === 'amt'} x={i * bw + 1} y={H - PAD_B - h} width={Math.max(1, bw - 2)} height={h} />
			</g>
		{/each}
	</svg>
	<div class="axis">
		{#each years as y, i (y.k)}
			{#if i % 5 === 0 || i === years.length - 1}
				<span style:left="{((i + 0.5) / years.length) * 100}%">{y.k}</span>
			{/if}
		{/each}
	</div>
	<p class="foot">
		Peak {measure === 'amt' ? money(max) : int(max)} a year.
		{#if early.length}
			{int(early.reduce((a, r) => a + r.n, 0))} grants dated before {years[0]?.k} are not drawn.
		{/if}
	</p>
</section>

<style>
	.chart {
		display: flex;
		flex-direction: column;
	}
	.sub b {
		color: var(--text-strong);
	}
	.clear {
		border: 0;
		background: none;
		padding: 0;
		font-size: 0.72rem;
		color: var(--accent);
		text-decoration: underline;
		cursor: pointer;
	}
	svg {
		width: 100%;
		height: 5.5rem;
		display: block;
		/* not flex: 1 — in a column of indefinite height that falls back to the
		   viewBox aspect ratio, which at full width is ~250px tall */
		flex: none;
	}
	.hit {
		fill: transparent;
	}
	.yr {
		cursor: pointer;
		outline: none;
	}
	.yr:hover .hit,
	.yr:focus-visible .hit {
		fill: var(--border-soft);
	}
	.bar {
		fill: var(--grants);
		opacity: 0.8;
	}
	.bar.money {
		fill: var(--money);
	}
	.dim .bar {
		opacity: 0.25;
	}
	.sel .bar {
		opacity: 1;
	}
	.axis {
		position: relative;
		height: 1rem;
		margin-top: 0.15rem;
		font-family: var(--mono);
		font-size: 0.66rem;
		color: var(--text-faint);
	}
	.axis span {
		position: absolute;
		transform: translateX(-50%);
	}
	.foot {
		margin: 0.4rem 0 0;
		font-size: 0.72rem;
		color: var(--text-faint);
	}
</style>
