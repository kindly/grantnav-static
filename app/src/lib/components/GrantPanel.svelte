<script lang="ts">
	/** Every field the image holds for one grant. */
	import { query } from '$lib/db.svelte';
	import { grantSql } from '$lib/sql';
	import { moneyExact, ukDate, stripOrder, said } from '$lib/format';
	import Sheet from './Sheet.svelte';
	import OrgLink from './OrgLink.svelte';

	let { id }: { id: string } = $props();

	type Row = Record<string, string | number | null>;
	let r = $state<Row | null>(null);
	let status = $state<'loading' | 'ok' | 'missing'>('loading');

	$effect(() => {
		const want = id;
		status = 'loading';
		query(grantSql(want)).then(
			(res) => {
				if (want !== id) return;
				r = ([...res.rows()][0] as Row) ?? null;
				status = r ? 'ok' : 'missing';
			},
			() => (status = 'missing')
		);
	});

	type Field = [col: string, label: string, fmt?: (v: never) => string, link?: 'funder' | 'recipient'];
	const GROUPS: [string, Field[]][] = [
		['The money', [
			['Amount Awarded', 'Amount awarded', moneyExact],
			['Amount Band', 'Band', stripOrder],
			['Award Date', 'Award date', ukDate]
		]],
		['Who gave it', [
			['Funding Org:Name', 'Funder', undefined, 'funder'],
			['Funding Org: Org Type (additional data)', 'Funder type'],
			['Funding Org:Identifier', 'Funder identifier'],
			['Grant Programme:Title', 'Programme']
		]],
		['Who received it', [
			['Recipient Org:Name', 'Recipient', undefined, 'recipient'],
			['Recipient Org: Org Type (additional data)', 'Recipient type'],
			['Type of Recipient', 'Recipient is'],
			['Grant Type', 'Grant type']
		]],
		['Where', [
			['Best Available Region (additional data)', 'Region'],
			['Best Available County', 'County'],
			['Best Available District (additional data)', 'District']
		]],
		['Record', [['Identifier', 'Grant identifier']]]
	];

	const desc = $derived(r ? String(r['Description Common'] || r['Description Rare'] || '') : '');
	const title = $derived(r ? String(r['Title'] ?? '') || desc.slice(0, 160) || '(untitled grant)' : '');
	const lede = $derived(r && r['Title'] && desc !== r['Title'] ? desc : '');
	const str = (v: unknown) => (v == null ? null : String(v));
</script>

<Sheet label="Grant details">
	{#if status === 'loading'}
		<p class="muted">Looking up that grant…</p>
	{:else if status === 'missing' || !r}
		<h2>No grant with that identifier</h2>
		<p class="muted">{id}</p>
	{:else}
		<p class="kind">Grant</p>
		<h2>{title}</h2>
		{#if lede}<p class="lede">{lede}</p>{/if}
		<div class="figures">
			<div><b class="money">{moneyExact(r['Amount Awarded'] as number)}</b><span>awarded {ukDate(r['Award Date'] as string)}</span></div>
			<div><b><OrgLink kind="recipient" name={str(r['Recipient Org:Name'])} /></b><span>recipient</span></div>
			<div><b><OrgLink kind="funder" name={str(r['Funding Org:Name'])} /></b><span>funder</span></div>
		</div>
		{#each GROUPS as [heading, fields] (heading)}
			<h3>{heading}</h3>
			<dl>
				{#each fields as [col, label, fmt, link] (col)}
					{@const raw = r[col]}
					<dt>{label}</dt>
					{#if link}
						<dd><OrgLink kind={link} name={str(raw)} /></dd>
					{:else if said(raw)}
						<dd>{fmt ? fmt(raw as never) : String(raw)}</dd>
					{:else}
						<dd class="muted">not recorded</dd>
					{/if}
				{/each}
			</dl>
		{/each}
		<p class="src">
			Every field this dataset holds for the grant. Published under
			<a href="https://grantnav.threesixtygiving.org/datasets/" target="_blank" rel="noopener">360Giving's open licensing</a>.
		</p>
	{/if}
</Sheet>

<style>
	.lede {
		margin: 0 0 1rem;
		line-height: 1.55;
		white-space: pre-line;
	}
	dl {
		display: grid;
		grid-template-columns: 9.5rem 1fr;
		gap: 0.25rem 0.8rem;
		margin: 0;
	}
	dt {
		color: var(--text-muted);
	}
	dd {
		margin: 0;
		overflow-wrap: anywhere;
		color: var(--text-strong);
	}
</style>
