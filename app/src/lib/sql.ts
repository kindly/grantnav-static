// Every query the app sends, built from the filter state and nothing else.
// Kept free of Svelte and the DOM so tests/ can run the exact SQL against the
// shipped image with the shipped wasm.

/**
 * Description is two columns, not one. 1.52M grants hold only 770K distinct
 * descriptions, but facetful only dictionary-encodes text below 65,535 distinct
 * values: the 65,000 most common go in a dict column covering 54% of rows, the
 * rest stay plain (cut at 500 chars). A row's description is in exactly one of
 * them, so search is an OR across both and display is a coalesce.
 */
export const DESC_COLS = ['Description Common', 'Description Rare'] as const;
// Common holds '' (not NULL) on rows whose text is in Rare, so plain coalesce
// would pick the empty string.
const DESC = `coalesce(nullif("Description Common", ''), "Description Rare")`;

/** What a search is matched against. `like` is already case-insensitive. */
export const SEARCH_COLS = ['Title', 'Recipient Org:Name', 'Grant Programme:Title', ...DESC_COLS];

export interface Facet {
	/** URL parameter */
	key: string;
	col: string;
	label: string;
	/** values are numbers; filtered without quotes */
	numeric?: boolean;
	/** list in label order rather than by size */
	byLabel?: 'asc' | 'desc';
	/** labels carry a sort prefix ("03 £10k–£50k") that is not shown */
	strip?: boolean;
	/** long list: gets a find box and a larger limit */
	find?: boolean;
	/** a filter with no facet panel (set from a recipient's card) */
	hidden?: boolean;
}

/**
 * Five facets, chosen for coverage (>90% of grants can answer them) and for
 * having more than one real option. Grant Type is 99.9% "Direct grant";
 * recipient org type is recorded for 42% of grants — both dropped. District
 * and County say a finer version of Region; Programme (12K values) is a search.
 */
export const FACETS: Facet[] = [
	{ key: 'funder', col: 'Funding Org:Name', label: 'Funder', find: true },
	{ key: 'year', col: 'Award Year', label: 'Award year', numeric: true, byLabel: 'asc' },
	{ key: 'band', col: 'Amount Band', label: 'Amount awarded', byLabel: 'asc', strip: true },
	{ key: 'region', col: 'Best Available Region (additional data)', label: 'Region' },
	{ key: 'ftype', col: 'Funding Org: Org Type (additional data)', label: 'Funder type' },
	// 425K distinct: a filter, set from a recipient's card, but not a panel
	{ key: 'recipient', col: 'Recipient Org:Name', label: 'Recipient', hidden: true }
];
export const FACET_BY_KEY = new Map(FACETS.map((f) => [f.key, f]));

export interface State {
	q: string;
	/** facet key -> selected raw values */
	filters: Map<string, string[]>;
}

export const ident = (name: string) => `"${name.replaceAll('"', '""')}"`;
export const lit = (v: string) => `'${String(v).replaceAll("'", "''")}'`;

/** WHERE conjuncts for a state, leaving out one facet's own filter. */
export function conjuncts(s: State, except?: string): string[] {
	const out: string[] = [];
	const q = s.q.trim();
	if (q) {
		const needle = lit(`%${q}%`);
		out.push(`(${SEARCH_COLS.map((c) => `${ident(c)} like ${needle}`).join(' or ')})`);
	}
	for (const [key, vals] of s.filters) {
		const f = FACET_BY_KEY.get(key);
		if (!f || key === except || !vals.length) continue;
		const list = vals.map((v) => (f.numeric ? String(Number(v)) : lit(v)));
		out.push(list.length === 1 ? `${ident(f.col)} = ${list[0]}` : `${ident(f.col)} in (${list.join(', ')})`);
	}
	return out;
}

export function where(s: State, except?: string, extra: string[] = []): string {
	const c = [...conjuncts(s, except), ...extra];
	return c.length ? ` where ${c.join(' and ')}` : '';
}

/**
 * Header totals: count + sum only, the shape facetful fuses into the facet
 * batch. The number of funders and the span of years come from the funder
 * facet and the year chart (facets.svelte.ts) rather than count(distinct) and
 * min/max here, which would take this statement out of the fused pass.
 */
export const summarySql = (s: State) => `select count(*) as n, sum("Amount Awarded") as amt from t${where(s)}`;

/** A `find` facet fetches every value (then filters by the find box in JS), up to this many. */
export const FIND_LIMIT = 2000;

/**
 * A facet counts under every *other* facet's filter but not its own, so picking
 * one value does not collapse its list to that value.
 */
export function facetSql(
	s: State,
	f: Facet,
	{ needle = '', by = 'n' as 'n' | 'amt', limit = 200 } = {}
): string {
	const extra = needle.trim() && !f.numeric ? [`${ident(f.col)} like ${lit(`%${needle.trim()}%`)}`] : [];
	const order = f.byLabel ? `1 ${f.byLabel}` : `${by} desc`;
	return (
		`select ${ident(f.col)} as k, count(*) as n, sum("Amount Awarded") as amt from t${where(s, f.key, extra)}` +
		` group by 1 order by ${order} limit ${limit}`
	);
}

// ---- the grid -----------------------------------------------------------

export const SORTS = {
	date_desc: { label: 'Awarded, newest', sql: `"Award Date" desc` },
	date_asc: { label: 'Awarded, oldest', sql: `"Award Date" asc` },
	amount_desc: { label: 'Amount, largest', sql: `"Amount Awarded" desc` },
	amount_asc: { label: 'Amount, smallest', sql: `"Amount Awarded" asc` },
	recipient_asc: { label: 'Recipient, A–Z', sql: `"Recipient Org:Name" asc` },
	recipient_desc: { label: 'Recipient, Z–A', sql: `"Recipient Org:Name" desc` },
	funder_asc: { label: 'Funder, A–Z', sql: `"Funding Org:Name" asc` },
	funder_desc: { label: 'Funder, Z–A', sql: `"Funding Org:Name" desc` }
} as const;
export type SortKey = keyof typeof SORTS;
export const DEFAULT_SORT: SortKey = 'date_desc';

const GRID_BASE =
	`"Identifier" as id, "Title" as title,` +
	` "Recipient Org:Name" as recipient, "Funding Org:Name" as funder,` +
	` "Best Available Region (additional data)" as region,` +
	` "Amount Awarded" as amount, "Award Date" as date`;

export const BLURB_LEN = 140;

/**
 * One line per grant, so the grid carries only what that line shows, plus the
 * start of the description to fill the rest of the title cell (the whole of
 * it is fetched on hover, `descSql`).
 *
 * Two shapes, because an expression in the select list is evaluated for every
 * matching row before the sort and limit are applied:
 *
 *   * `whole`: one query per filter for the entire result, held in memory.
 *     The blurb is cut in SQL so the transferred result stays narrow. Above
 *     BLURB_MAX rows it is left out altogether: for all 1.52M rows it is the
 *     difference between 256 MB / 0.45 s and 424 MB / 1.5 s.
 *   * pages: a paged query runs on every scrollbar jump over up to 1.52M rows.
 *     Cutting the blurb in SQL there cost ~430 ms a page (508 vs 79 ms at
 *     offset 800K); selecting the two description columns plain and cutting
 *     the 200 returned rows in JS costs nothing (`toGridRow`).
 */
export function gridSql(
	s: State,
	sort: SortKey,
	page?: { limit: number; offset: number },
	{ blurb = true } = {}
): string {
	const cols = page
		? `${GRID_BASE}, "Description Common" as dc, "Description Rare" as dr`
		: blurb
			? `${GRID_BASE}, substr(${DESC}, 1, ${BLURB_LEN}) as blurb`
			: GRID_BASE;
	return (
		`select ${cols} from t${where(s)} order by ${SORTS[sort].sql}` +
		(page ? ` limit ${page.limit}${page.offset ? ` offset ${page.offset}` : ''}` : '')
	);
}

export interface GridRow {
	id: string;
	title: string | null;
	blurb: string | null;
	recipient: string | null;
	funder: string | null;
	region: string | null;
	amount: number | null;
	date: string | null;
}

/**
 * Descriptions for the grants in a result that have no title (448 of 1.52M),
 * so they can still show their description in place of one when the whole
 * result is loaded without blurbs. A CASE in the whole-result query itself
 * would be evaluated for every row (+650 ms at 1.52M); this is ~21 ms.
 */
export const untitledSql = (s: State) =>
	`select "Identifier" as id, substr(${DESC}, 1, ${BLURB_LEN}) as blurb from t` +
	where(s, undefined, [`coalesce("Title", '') = ''`]);

/** A paged row (plain description columns) in the shape the grid paints. */
export function toGridRow(r: Record<string, unknown>): GridRow {
	const d = (r.dc as string) || (r.dr as string) || '';
	return { ...(r as unknown as GridRow), blurb: d.slice(0, BLURB_LEN) };
}

/**
 * The whole description for one row. The funder conjunct is not redundant: the
 * image is ordered by funder, so it prunes to a few row groups and the lookup
 * takes ~6 ms instead of ~140 ms scanning every Identifier.
 */
export const descSql = (id: string, funder: string | null) =>
	`select ${DESC} as d, "Grant Programme:Title" as programme,` +
	` "Best Available District (additional data)" as district from t` +
	` where ${funder ? `"Funding Org:Name" = ${lit(funder)} and ` : ''}"Identifier" = ${lit(id)} limit 1`;

/** Every column in the image, for one grant's own panel. */
export const GRANT_COLS = [
	'Identifier', 'Title', ...DESC_COLS,
	'Amount Awarded', 'Award Date', 'Award Year', 'Amount Band',
	'Funding Org:Name', 'Funding Org:Identifier', 'Funding Org: Org Type (additional data)',
	'Recipient Org:Name', 'Recipient Org: Org Type (additional data)',
	'Grant Programme:Title',
	'Best Available Region (additional data)', 'Best Available District (additional data)',
	'Best Available County', 'Type of Recipient', 'Grant Type'
];

export const grantSql = (id: string) =>
	`select ${GRANT_COLS.map(ident).join(', ')} from t where "Identifier" = ${lit(id)} limit 1`;

// ---- funder and recipient cards -------------------------------------------
//
// A card describes the organisation across every grant, not just those under
// the current filters: it answers "who is this", and the filter button is how
// you narrow the grid to it. Measured on the biggest funder (299K grants):
// summary 79 ms, the rest under 35 ms; a recipient's are all ~2 ms.

export type OrgKind = 'funder' | 'recipient';

export const ORG = {
	funder: {
		col: 'Funding Org:Name',
		other: 'Recipient Org:Name',
		label: 'Funder',
		otherLabel: 'recipient',
		filterKey: 'funder'
	},
	recipient: {
		col: 'Recipient Org:Name',
		other: 'Funding Org:Name',
		label: 'Recipient',
		otherLabel: 'funder',
		filterKey: 'recipient'
	}
} as const;

const orgWhere = (kind: OrgKind, name: string) => ` where ${ident(ORG[kind].col)} = ${lit(name)}`;

/** Headline figures; `others` is distinct recipients of a funder, or funders of a recipient. */
export const orgSummarySql = (kind: OrgKind, name: string) =>
	`select count(*) as n, sum("Amount Awarded") as amt, median("Amount Awarded") as med,` +
	` min("Award Year") as y0, max("Award Year") as y1, count(distinct ${ident(ORG[kind].other)}) as others` +
	` from t${orgWhere(kind, name)}`;

export const orgYearsSql = (kind: OrgKind, name: string) =>
	`select "Award Year" as k, count(*) as n, sum("Amount Awarded") as amt from t${orgWhere(kind, name)}` +
	` group by 1 order by 1`;

/** Top recipients of a funder, or top funders of a recipient, by money. */
export const orgTopSql = (kind: OrgKind, name: string, limit = 10) =>
	`select ${ident(ORG[kind].other)} as k, count(*) as n, sum("Amount Awarded") as amt from t${orgWhere(kind, name)}` +
	` group by 1 order by amt desc limit ${limit}`;

export const orgRegionsSql = (kind: OrgKind, name: string) =>
	`select "Best Available Region (additional data)" as k, count(*) as n, sum("Amount Awarded") as amt` +
	` from t${orgWhere(kind, name)} group by 1 order by n desc limit 8`;

/** Descriptive fields, from the organisation's most recent grant. */
export const orgMetaSql = (kind: OrgKind, name: string) =>
	(kind === 'funder'
		? `select "Funding Org: Org Type (additional data)" as type, "Funding Org:Identifier" as ident`
		: `select "Recipient Org: Org Type (additional data)" as type, "Type of Recipient" as is_a,` +
			` "Best Available District (additional data)" as district`) +
	` from t${orgWhere(kind, name)} order by "Award Date" desc limit 1`;
