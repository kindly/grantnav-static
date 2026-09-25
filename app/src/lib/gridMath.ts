// Scroll arithmetic for the grid, with no DOM in it (tests/grid.test.mjs).
//
// The spacer (`.tall`) owns the scrollbar: one pixel per pixel while the whole
// result fits. It stops fitting at scale — 1.52M rows at 28px is 42.6M px, and
// Firefox stops laying out at 17.9M (Chrome at 33.5M), past which the
// scrollbar is not long but broken. So the spacer is capped at SPACER_MAX and,
// above the cap, scroll position maps onto rows proportionally. Below ~535K
// rows none of this applies and it reduces to scrollTop / rowH.

/** Comfortably inside Firefox's limit, the lowest of the three engines. */
export const SPACER_MAX = 15_000_000;

export interface Geom {
	total: number;
	rowH: number;
	/** rows the pool shows */
	poolLen: number;
	headH: number;
	/** sub-row strip under the pool; keeps the last row reachable */
	slack: number;
	/** scroller clientHeight */
	viewportH: number;
}

export const naturalHeight = (g: Geom) => g.headH + g.total * g.rowH + g.slack;
export const isScaled = (g: Geom) => naturalHeight(g) > SPACER_MAX;
export const spacerHeight = (g: Geom) => Math.min(naturalHeight(g), SPACER_MAX);

const maxFirst = (g: Geom) => Math.max(0, g.total - g.poolLen);

/** The first row the pool should show at a scroll position. */
export function firstRowAt(g: Geom, scrollTop: number): number {
	const top = maxFirst(g);
	if (!isScaled(g)) return Math.min(top, Math.max(0, Math.round(scrollTop / g.rowH)));
	const range = Math.max(1, SPACER_MAX - g.viewportH);
	return Math.min(top, Math.max(0, Math.round((scrollTop / range) * top)));
}

/** The inverse: where to put the scrollbar so `row` is at the top. */
export function scrollTopForRow(g: Geom, row: number): number {
	const top = maxFirst(g);
	const r = Math.min(top, Math.max(0, row));
	if (!isScaled(g)) return r * g.rowH;
	if (top === 0) return 0;
	return (r / top) * Math.max(1, SPACER_MAX - g.viewportH);
}

/**
 * Rows a wheel event should move. Above the cap one wheel notch would jump
 * ~3× as many rows as it looks like it should; the grid intercepts the wheel
 * and scrolls by rows instead, keeping the real scrollbar for dragging.
 */
export function wheelRows(deltaY: number, deltaMode: number, g: Geom): number {
	if (deltaMode === 1) return Math.round(deltaY); // lines
	if (deltaMode === 2) return Math.round(deltaY * g.poolLen); // pages
	const rows = deltaY / g.rowH;
	// trackpads send many tiny deltas; never round a real movement to nothing
	return rows > 0 ? Math.max(1, Math.round(rows)) : rows < 0 ? Math.min(-1, Math.round(rows)) : 0;
}

/**
 * Which rows to paint, clamped to what is loaded (`availFirst..availLast`).
 * Returns last < first when nothing loaded covers the position — the caller
 * must then leave the screen alone rather than paint blanks.
 */
export function visibleRange(g: Geom, scrollTop: number, availFirst: number, availLast: number) {
	if (!g.total || g.poolLen <= 0 || availLast < availFirst) return { first: 0, last: -1 };
	let first = Math.max(availFirst, firstRowAt(g, scrollTop));
	first = Math.min(first, Math.max(availFirst, availLast - g.poolLen + 1));
	return { first, last: Math.min(availLast, first + g.poolLen - 1) };
}
