<script lang="ts">
	import { boot, getDb, query, perf, resetStoredData } from '$lib/db.svelte';
	import { FACETS, FACET_BY_KEY, FIND_LIMIT, SORTS, summarySql, type SortKey } from '$lib/sql';
	import { facetRows, distinctUnder, yearSpan } from '$lib/facets.svelte';
	import {
		currentState, currentSort, currentMeasure, currentGrant, currentOrg,
		toggleFilter, setSearch, setSort, setMeasure, clearAll
	} from '$lib/url.svelte';
	import { int, money, stripOrder } from '$lib/format';
	import SearchBox from '$lib/components/SearchBox.svelte';
	import FacetPanel from '$lib/components/FacetPanel.svelte';
	import YearChart from '$lib/components/YearChart.svelte';
	import GridPanel from '$lib/components/GridPanel.svelte';
	import Peek from '$lib/components/Peek.svelte';
	import GrantPanel from '$lib/components/GrantPanel.svelte';
	import OrgPanel from '$lib/components/OrgPanel.svelte';
	import OrgPeek from '$lib/components/OrgPeek.svelte';
	import type { HoverTarget } from '$lib/components/GridPanel.svelte';

	const s = $derived(currentState());
	const sort = $derived(currentSort());
	const measure = $derived(currentMeasure());
	const grant = $derived(currentGrant());
	const org = $derived(currentOrg());
	const nFilters = $derived((s.q ? 1 : 0) + [...s.filters.values()].reduce((a, v) => a + v.length, 0));

	let totals = $state({ n: 0, amt: 0 });
	// read from the funder facet and year chart rather than queried (see summarySql)
	const funders = $derived(distinctUnder(facetRows.funder, s.filters.get('funder')));
	const funderCapped = $derived((facetRows.funder?.length ?? 0) >= FIND_LIMIT && !s.filters.get('funder')?.length);
	const years = $derived(yearSpan(facetRows.year, s.filters.get('year')));
	let seq = 0;
	// `s` is rebuilt on every URL change (opening a grant too); only re-query
	// when the SQL itself changes, as the facet panels do
	let lastSummary = '';
	$effect(() => {
		const sql = summarySql(s);
		if (!boot.ready || sql === lastSummary) return;
		lastSummary = sql;
		const mine = ++seq;
		query(sql).then((r) => {
			if (mine !== seq) return;
			const row = [...r.rows()][0] as typeof totals | undefined;
			totals = { n: row?.n ?? 0, amt: row?.amt ?? 0 };
		});
	});

	// hover peek: which row, and where the cursor is
	let peek = $state<{ target: HoverTarget | null; x: number; y: number }>({ target: null, x: 0, y: 0 });
	const onhover = (target: HoverTarget, x: number, y: number) => (peek = { target, x, y });
	const onleave = () => {
		if (peek.target) peek = { ...peek, target: null };
	};
	const peekRow = $derived(peek.target?.kind === 'grant' ? peek.target.row : null);
	const peekOrg = $derived(peek.target && peek.target.kind !== 'grant' ? peek.target : null);

	const chips = $derived([
		...(s.q ? [{ label: 'search', value: `“${s.q}”`, remove: () => setSearch('') }] : []),
		...[...s.filters].flatMap(([key, vals]) => {
			const f = FACET_BY_KEY.get(key)!;
			return vals.map((v) => ({
				label: f.label,
				value: f.strip ? stripOrder(v) : v,
				remove: () => toggleFilter(key, v)
			}));
		})
	]);

	const others = FACETS.filter((f) => f.key !== 'year' && f.key !== 'funder' && !f.hidden);
	getDb();
</script>

{#if !boot.ready}
	<div class="boot">
		<div class="boot-card">
			<h1>GrantNav <span>Static</span></h1>
			<p class="step">{boot.failed || boot.step}</p>
			<div class="track"><div class="fill" class:indeterminate={boot.progress < 0 && !boot.failed} style:width="{boot.progress < 0 ? 30 : boot.progress * 100}%"></div></div>
			<p class="note">{boot.note || 'Every 360Giving grant — 1.5 million of them — searched in your browser. The first visit downloads ~60 MB; later visits open from this device.'}</p>
			{#if boot.failed}
				<p class="note">Close any other tab running this page, then reload.</p>
				<button class="reset" onclick={resetStoredData}>Clear stored data and reload</button>
			{/if}
		</div>
	</div>
{/if}

<header>
	<button class="wordmark" onclick={clearAll} disabled={!nFilters} title={nFilters ? 'Clear search and filters' : ''}>
		GrantNav <span>Static</span>
	</button>
	<SearchBox />
	<div class="totals">
		<div class="stat grants"><b>{int(totals.n)}</b><span>{totals.n === 1 ? 'grant' : 'grants'}</span></div>
		<div class="stat money"><b>{money(totals.amt)}</b><span>awarded</span></div>
		<div class="stat"><b>{funders == null ? '—' : `${int(funders)}${funderCapped ? '+' : ''}`}</b><span>{funders === 1 ? 'funder' : 'funders'}</span></div>
		{#if years}
			<div class="stat"><b>{years[0] === years[1] ? years[0] : `${years[0]}–${years[1]}`}</b><span>award years</span></div>
		{/if}
	</div>
</header>

{#if boot.ready}
	<main>
		<div class="toolbar">
			<div class="measure" role="group" aria-label="What bars measure">
				<span>Bars show</span>
				<button aria-pressed={measure === 'n'} onclick={() => setMeasure('n')}>number of grants</button>
				<button class="m" aria-pressed={measure === 'amt'} onclick={() => setMeasure('amt')}>money awarded</button>
			</div>
			<div class="chips">
				{#each chips as c (c.label + c.value)}
					<button class="chip" onclick={c.remove} title="Remove {c.label}: {c.value}">
						<em>{c.label}</em> {c.value}
						<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>
					</button>
				{/each}
				{#if nFilters}
					<button class="clear-all" onclick={clearAll}>clear all</button>
				{/if}
			</div>
			<label class="sort">
				Order
				<select value={sort} onchange={(e) => setSort(e.currentTarget.value as SortKey)}>
					{#each Object.entries(SORTS) as [k, v] (k)}
						<option value={k}>{v.label}</option>
					{/each}
				</select>
			</label>
		</div>

		<section class="panels">
			<div class="p-year"><YearChart state={s} {measure} /></div>
			<div><FacetPanel facet={FACET_BY_KEY.get('funder')!} state={s} {measure} /></div>
			{#each others as f (f.key)}
				<div><FacetPanel facet={f} state={s} {measure} /></div>
			{/each}
		</section>

		<GridPanel state={s} {sort} {onhover} {onleave} />

		<footer>
			<span>
				{#if perf.pending}updating…{:else}{perf.queries} queries, {perf.engineMs.toFixed(0)} ms in the engine, settled in {perf.settledMs.toFixed(0)} ms{/if}
			</span>
			<span>{int(boot.rows)} grants · {boot.source}</span>
			<button onclick={resetStoredData}>reset stored data</button>
			<span class="src">Data: <a href="https://www.360giving.org/" target="_blank" rel="noopener">360Giving</a> publishers via GrantNav, CC-BY 4.0 · engine: facetful</span>
		</footer>
	</main>

	<Peek row={peekRow} x={peek.x} y={peek.y} />
	<OrgPeek kind={peekOrg?.kind ?? null} name={peekOrg?.name ?? null} x={peek.x} y={peek.y} />
	{#if grant}
		<GrantPanel id={grant} />
	{:else if org}
		<OrgPanel kind={org.kind} name={org.name} {measure} />
	{/if}
{/if}

<style>
	header {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.8rem 1.6rem;
		padding: 0.75rem 1.5rem;
		background: var(--surface);
		border-bottom: 1px solid var(--border);
	}
	.wordmark {
		border: 0;
		background: none;
		padding: 0;
		font-size: 1.15rem;
		font-weight: 700;
		letter-spacing: -0.02em;
		color: var(--text-strong);
		white-space: nowrap;
		cursor: pointer;
	}
	.wordmark:disabled {
		cursor: default;
	}
	.wordmark span,
	.boot h1 span {
		font-weight: 500;
		font-size: 0.8rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--grants);
	}
	.totals {
		display: flex;
		gap: 1.4rem;
		margin-left: auto;
	}
	.stat {
		display: flex;
		flex-direction: column;
		line-height: 1.1;
	}
	.stat b {
		font-size: 1.35rem;
		font-weight: 600;
		color: var(--text-strong);
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.01em;
	}
	.stat.grants b {
		color: var(--grants);
	}
	.stat.money b {
		color: var(--money);
	}
	.stat span {
		font-size: 0.66rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-faint);
	}
	main {
		padding: 0.9rem 1.5rem 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
	}
	.toolbar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.6rem 1.2rem;
		font-size: 0.8rem;
		color: var(--text-muted);
	}
	.measure {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}
	.measure button {
		border: 1px solid var(--border);
		background: var(--surface);
		border-radius: 999px;
		padding: 0.15rem 0.65rem;
		cursor: pointer;
		font-size: 0.78rem;
	}
	.measure button[aria-pressed='true'] {
		background: var(--grants);
		border-color: var(--grants);
		color: #fff;
	}
	.measure button.m[aria-pressed='true'] {
		background: var(--money);
		border-color: var(--money);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		flex: 1;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		max-width: 22rem;
		border: 1px solid var(--grants);
		background: var(--grants-soft);
		color: var(--text-strong);
		border-radius: 999px;
		padding: 0.12rem 0.45rem 0.12rem 0.6rem;
		cursor: pointer;
		font-size: 0.78rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.chip em {
		font-style: normal;
		color: var(--text-faint);
	}
	.chip svg {
		width: 0.7rem;
		height: 0.7rem;
		flex: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
	}
	.chip:hover {
		background: var(--grants-tint);
	}
	.clear-all {
		border: 0;
		background: none;
		color: var(--accent);
		text-decoration: underline;
		cursor: pointer;
		font-size: 0.78rem;
	}
	.sort {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin-left: auto;
	}
	.sort select {
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.2rem 0.4rem;
		background: var(--surface);
	}
	/* Year strip across the top, then the four facets four-across (../pudl's layout). */
	.panels {
		display: grid;
		gap: 0.8rem;
		grid-template-columns: repeat(4, minmax(0, 1fr));
	}
	.p-year {
		grid-column: 1 / -1;
	}
	.panels > div {
		display: flex;
		min-width: 0;
	}
	.panels > div > :global(*) {
		flex: 1;
	}
	@media (max-width: 1100px) {
		.panels {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	@media (max-width: 820px) {
		.panels {
			grid-template-columns: minmax(0, 1fr);
		}
		header,
		main {
			padding-left: 16px;
			padding-right: 16px;
		}
		.totals {
			margin-left: 0;
			gap: 1rem;
		}
		.stat b {
			font-size: 1.1rem;
		}
	}
	footer {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 1.2rem;
		align-items: baseline;
		font-size: 0.75rem;
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}
	footer button {
		border: 1px solid var(--border);
		background: var(--surface);
		border-radius: 4px;
		padding: 0.1rem 0.5rem;
		cursor: pointer;
		font-size: 0.72rem;
	}
	footer a {
		color: var(--accent);
	}
	/* first-visit download */
	.boot {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: grid;
		place-items: center;
		background: var(--ground);
		padding: 16px;
	}
	.boot-card {
		width: min(30rem, 100%);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--card-shadow);
		padding: 1.5rem 1.6rem;
	}
	.boot h1 {
		margin: 0 0 0.8rem;
		font-size: 1.3rem;
	}
	.step {
		margin: 0 0 0.6rem;
		font-weight: 500;
		color: var(--text-strong);
	}
	.track {
		height: 6px;
		border-radius: 3px;
		background: var(--border-soft);
		overflow: hidden;
	}
	.fill {
		height: 100%;
		background: var(--grants);
		transition: width 0.2s;
	}
	.fill.indeterminate {
		animation: slide 1.2s ease-in-out infinite;
	}
	@keyframes slide {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(340%);
		}
	}
	.note {
		margin: 0.7rem 0 0;
		font-size: 0.8rem;
		color: var(--text-muted);
	}
	.reset {
		margin-top: 0.8rem;
		border: 1px solid var(--border);
		background: var(--surface);
		border-radius: 6px;
		padding: 0.3rem 0.8rem;
		cursor: pointer;
	}
</style>
