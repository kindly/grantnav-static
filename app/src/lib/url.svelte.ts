// Everything that defines what you are looking at lives in the URL, so a
// search is a link and Back works:  ?q=climate&funder=X&funder=Y&year=2023
// &sort=amount_desc&by=amt, plus at most one open card:
// grant=<identifier> | f=<funder name> | r=<recipient name>. The card keys are
// not `funder`/`recipient`, which are the filters.
import { page } from '$app/state';
import { goto } from '$app/navigation';
import { FACETS, SORTS, DEFAULT_SORT, type OrgKind, type SortKey, type State } from './sql';

export type Measure = 'n' | 'amt';

/** The result-defining part: search + facet selections. */
export function currentState(): State {
	const p = page.url.searchParams;
	const filters = new Map<string, string[]>();
	for (const f of FACETS) {
		const v = p.getAll(f.key);
		if (v.length) filters.set(f.key, v);
	}
	return { q: p.get('q') ?? '', filters };
}

export function currentSort(): SortKey {
	const s = page.url.searchParams.get('sort');
	return s && s in SORTS ? (s as SortKey) : DEFAULT_SORT;
}

/** What facet bars and the year chart measure: number of grants or money. */
export const currentMeasure = (): Measure => (page.url.searchParams.get('by') === 'amt' ? 'amt' : 'n');

export const currentGrant = () => page.url.searchParams.get('grant');

const CARD_KEYS = ['grant', 'f', 'r'] as const;
const ORG_KEY: Record<OrgKind, 'f' | 'r'> = { funder: 'f', recipient: 'r' };

/** The funder or recipient whose card is open, if any. */
export function currentOrg(): { kind: OrgKind; name: string } | null {
	const p = page.url.searchParams;
	const f = p.get('f');
	if (f !== null) return { kind: 'funder', name: f };
	const r = p.get('r');
	return r !== null ? { kind: 'recipient', name: r } : null;
}

function nav(edit: (p: URLSearchParams) => void, { replace = false } = {}) {
	const p = new URLSearchParams(page.url.searchParams);
	edit(p);
	const s = p.toString();
	goto(s ? `?${s}` : '?', { keepFocus: true, noScroll: true, replaceState: replace });
}

export function toggleFilter(key: string, value: string) {
	nav((p) => {
		const vals = p.getAll(key);
		p.delete(key);
		for (const v of vals.includes(value) ? vals.filter((v) => v !== value) : [...vals, value]) p.append(key, v);
	});
}

export const clearFilter = (key: string) => nav((p) => p.delete(key));

/** replaceState: typing should not fill the history with every prefix. */
export const setSearch = (q: string) =>
	nav((p) => (q.trim() ? p.set('q', q.trim()) : p.delete('q')), { replace: true });

export const setSort = (s: SortKey) =>
	nav((p) => (s === DEFAULT_SORT ? p.delete('sort') : p.set('sort', s)), { replace: true });

export const setMeasure = (m: Measure) =>
	nav((p) => (m === 'n' ? p.delete('by') : p.set('by', m)), { replace: true });

/** Drop search and every facet; presentation (sort, measure) stays. */
export const clearAll = () =>
	nav((p) => {
		p.delete('q');
		for (const f of FACETS) p.delete(f.key);
	});

function openCard(key: (typeof CARD_KEYS)[number], value: string) {
	nav((p) => {
		for (const k of CARD_KEYS) p.delete(k);
		p.set(key, value);
	});
}

export const openGrant = (id: string) => openCard('grant', id);
export const openOrg = (kind: OrgKind, name: string) => openCard(ORG_KEY[kind], name);
export const closeCard = () => nav((p) => CARD_KEYS.forEach((k) => p.delete(k)));

/**
 * The URL a card link points at: the current view plus that card. Links carry
 * a real href so middle-click and "open in new tab" work; a plain click is
 * handled in place (see GridPanel) so nothing reloads.
 */
export function cardHref(kind: 'grant' | OrgKind, value: string): string {
	const p = new URLSearchParams(page.url.searchParams);
	for (const k of CARD_KEYS) p.delete(k);
	p.set(kind === 'grant' ? 'grant' : ORG_KEY[kind], value);
	return `?${p}`;
}

/** Add an organisation to the filters (or take it out again), closing its card. */
export function toggleOrgFilter(filterKey: string, name: string, add: boolean) {
	nav((p) => {
		const vals = p.getAll(filterKey).filter((v) => v !== name);
		p.delete(filterKey);
		for (const v of add ? [...vals, name] : vals) p.append(filterKey, v);
		for (const k of CARD_KEYS) p.delete(k);
	});
}
