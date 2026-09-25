// Header figures read from facet rows (see facets.svelte.ts). Plain module so
// tests/sql.test.mjs can check them against count(distinct) / min / max.

export type FacetRow = { k: string | number | null; n: number; amt: number | null };

/**
 * Distinct values of a facet under the full filter state. A facet's rows
 * ignore its own filter, so with a selection the answer is how many selected
 * values still have grants; without one, it is every value listed.
 */
export function distinctUnder(rows: FacetRow[] | undefined, selected: string[] | undefined): number | null {
	if (!rows) return null;
	const present = rows.filter((r) => r.k != null && r.k !== '' && r.n > 0);
	if (!selected?.length) return present.length;
	const sel = new Set(selected);
	return present.filter((r) => sel.has(String(r.k))).length;
}

/** First and last year with grants, under the full filter state (see distinctUnder). */
export function yearSpan(rows: FacetRow[] | undefined, selected: string[] | undefined): [number, number] | null {
	if (!rows) return null;
	const sel = selected?.length ? new Set(selected.map(Number)) : null;
	const ys = rows
		.filter((r) => r.k != null && r.n > 0 && (!sel || sel.has(Number(r.k))))
		.map((r) => Number(r.k));
	return ys.length ? [Math.min(...ys), Math.max(...ys)] : null;
}
