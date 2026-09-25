<script lang="ts">
	/**
	 * One funder or recipient across every grant it appears in: headline
	 * figures, grants by award year, its top counterparts and regions, and a
	 * button that puts it in the main filter.
	 */
	import { page } from '$app/state';
	import { query } from '$lib/db.svelte';
	import {
		ORG, orgSummarySql, orgYearsSql, orgTopSql, orgRegionsSql, orgMetaSql, type OrgKind
	} from '$lib/sql';
	import { toggleOrgFilter, type Measure } from '$lib/url.svelte';
	import { int, money, moneyExact, compact, said } from '$lib/format';
	import Sheet from './Sheet.svelte';
	import OrgLink from './OrgLink.svelte';

	let { kind, name, measure }: { kind: OrgKind; name: string; measure: Measure } = $props();

	type Bar = { k: string | number | null; n: number; amt: number | null };
	interface Data {
		s: { n: number; amt: number | null; med: number | null; y0: number | null; y1: number | null; others: number };
		years: Bar[];
		top: Bar[];
		regions: Bar[];
		meta: Record<string, string | null>;
	}
	let data = $state<Data | null>(null);
	let loading = $state(true);
	let ms = $state(0);

	$effect(() => {
		const k = kind;
		const n = name;
		loading = true;
		const t0 = performance.now();
		const all = (sql: string) => query(sql).then((r) => [...r.rows()]);
		Promise.all([
			all(orgSummarySql(k, n)),
			all(orgYearsSql(k, n)),
			all(orgTopSql(k, n)),
			all(orgRegionsSql(k, n)),
			all(orgMetaSql(k, n))
		]).then(([s, years, top, regions, meta]) => {
			if (k !== kind || n !== name) return;
			data = {
				s: s[0] as unknown as Data['s'],
				years: years as unknown as Bar[],
				top: top as unknown as Bar[],
				regions: (regions as unknown as Bar[]).filter((r) => said(r.k)),
				meta: (meta[0] ?? {}) as Record<string, string | null>
			};
			ms = performance.now() - t0;
			loading = false;
		});
	});

	const o = $derived(ORG[kind]);
	const filtered = $derived(page.url.searchParams.getAll(o.filterKey).includes(name));

	// years: a continuous run from first to last, so gaps read as gaps
	const years = $derived.by(() => {
		const ys = data?.years.filter((y) => y.k != null) ?? [];
		if (!ys.length) return [];
		const by = new Map(ys.map((y) => [Number(y.k), y]));
		const out: { y: number; n: number; amt: number }[] = [];
		for (let y = Number(ys[0].k); y <= Number(ys.at(-1)!.k); y++) {
			const b = by.get(y);
			out.push({ y, n: b?.n ?? 0, amt: b?.amt ?? 0 });
		}
		return out;
	});
	const v = (b: { n: number; amt: number | null }) => (measure === 'amt' ? (b.amt ?? 0) : b.n);
	const yMax = $derived(Math.max(1, ...years.map(v)));
	let hover = $state<number | null>(null);
	const hovered = $derived(years.find((y) => y.y === hover) ?? null);
	const topMax = $derived(Math.max(1, ...(data?.top ?? []).map((b) => b.amt ?? 0)));
	const regMax = $derived(Math.max(1, ...(data?.regions ?? []).map(v)));

	const W = 560;
	const H = 120;
</script>

<Sheet label="{o.label} details: {name}">
	<p class="kind">{o.label}</p>
	<h2>{name}</h2>
	{#if data && !loading}
		<p class="meta">
			{#if kind === 'funder'}
				{said(data.meta.type) || 'Funder type not recorded'}{said(data.meta.ident) ? ` · ${data.meta.ident}` : ''}
			{:else}
				{[said(data.meta.type), said(data.meta.is_a), said(data.meta.district)].filter(Boolean).join(' · ') || 'No type or location recorded'}
			{/if}
		</p>
	{/if}

	<button
		class="filter"
		class:on={filtered}
		onclick={() => toggleOrgFilter(o.filterKey, name, !filtered)}
	>
		{filtered ? `Remove this ${o.label.toLowerCase()} from the filters` : `Add this ${o.label.toLowerCase()} to the filters`}
	</button>

	{#if loading || !data}
		<p class="muted">Adding up its grants…</p>
	{:else}
		<div class="figures">
			<div><b class="grants">{int(data.s.n)}</b><span>grants</span></div>
			<div><b class="money">{money(data.s.amt)}</b><span>total awarded</span></div>
			<div><b>{money(data.s.med)}</b><span>median grant</span></div>
			<div><b>{data.s.y0 == null ? '—' : data.s.y0 === data.s.y1 ? data.s.y0 : `${data.s.y0}–${data.s.y1}`}</b><span>award years</span></div>
			<div><b>{int(data.s.others)}</b><span>{o.otherLabel}s</span></div>
		</div>
		<p class="muted note">Across all {int(data.s.n)} of its grants, whatever the current filters · {ms.toFixed(0)} ms</p>

		<h3>
			{measure === 'amt' ? 'Money awarded' : 'Grants'} by award year
			{#if hovered}<span class="hov">· {hovered.y}: {int(hovered.n)} grants, {moneyExact(hovered.amt)}</span>{/if}
		</h3>
		{#if years.length}
			<svg class="years" viewBox="0 0 {W} {H}" preserveAspectRatio="none" role="img" aria-label="{o.label} grants by year">
				{#each years as y, i (y.y)}
					{@const bw = W / years.length}
					{@const h = ((H - 4) * v(y)) / yMax}
					<g onmouseenter={() => (hover = y.y)} onmouseleave={() => (hover = null)} role="presentation">
						<rect class="hit" x={i * bw} y="0" width={bw} height={H} />
						<rect class="bar" class:money={measure === 'amt'} x={i * bw + 1} y={H - h} width={Math.max(1, bw - 2)} height={h} />
					</g>
				{/each}
			</svg>
			<div class="axis"><span>{years[0].y}</span><span>peak {measure === 'amt' ? money(yMax) : int(yMax)} a year</span><span>{years.at(-1)!.y}</span></div>
		{:else}
			<p class="muted">No award years recorded.</p>
		{/if}

		<h3>Top {o.otherLabel}s, by money</h3>
		<ol class="bars">
			{#each data.top as b, i (i)}
				<li>
					<span class="bar money" style:width="{(100 * (b.amt ?? 0)) / topMax}%"></span>
					<span class="name"><OrgLink kind={kind === 'funder' ? 'recipient' : 'funder'} name={b.k == null ? null : String(b.k)} /></span>
					<span class="num">{compact(b.n)}</span>
					<span class="num amt">{money(b.amt)}</span>
				</li>
			{/each}
		</ol>

		{#if data.regions.length > 1}
			<h3>Where</h3>
			<ol class="bars">
				{#each data.regions as b (b.k)}
					<li>
						<span class="bar" class:money={measure === 'amt'} style:width="{(100 * v(b)) / regMax}%"></span>
						<span class="name">{b.k}</span>
						<span class="num">{compact(b.n)}</span>
						<span class="num amt">{money(b.amt)}</span>
					</li>
				{/each}
			</ol>
		{/if}
	{/if}
</Sheet>

<style>
	.meta {
		margin: -0.3rem 0 0.8rem;
		color: var(--text-muted);
	}
	.filter {
		margin: 0 0 1rem;
		padding: 0.4rem 0.9rem;
		border-radius: 999px;
		border: 1px solid var(--grants);
		background: var(--grants);
		color: #fff;
		font-weight: 500;
		cursor: pointer;
	}
	.filter:hover {
		filter: brightness(0.93);
	}
	.filter.on {
		background: var(--surface);
		color: var(--grants);
	}
	.note {
		margin: 0;
		font-size: 0.75rem;
	}
	.hov {
		text-transform: none;
		letter-spacing: 0;
		color: var(--text-muted);
		font-weight: 400;
	}
	.years {
		width: 100%;
		height: 7.5rem;
		display: block;
	}
	.hit {
		fill: transparent;
	}
	g:hover .hit {
		fill: var(--border-soft);
	}
	.years .bar {
		fill: var(--grants);
		opacity: 0.85;
	}
	.years .bar.money {
		fill: var(--money);
	}
	.axis {
		display: flex;
		justify-content: space-between;
		margin-top: 0.2rem;
		font-family: var(--mono);
		font-size: 0.68rem;
		color: var(--text-faint);
	}
	.bars {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.bars li {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr) 3.4rem 4.6rem;
		gap: 0.5rem;
		align-items: center;
		padding: 0.18rem 0.35rem;
		font-size: 0.85rem;
	}
	.bars .bar {
		position: absolute;
		inset: 1px auto 1px 0;
		background: var(--grants-tint);
		border-radius: 4px;
	}
	.bars .bar.money {
		background: var(--money-tint);
	}
	.name,
	.num {
		position: relative;
		min-width: 0;
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.num {
		text-align: right;
		font-family: var(--mono);
		font-size: 0.76rem;
		color: var(--text-muted);
	}
	.num.amt {
		color: var(--money);
	}
</style>
