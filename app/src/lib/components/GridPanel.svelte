<script lang="ts" module>
	/**
	 * Every result is held whole in memory, however big. Above this many rows the
	 * in-memory copy leaves out the description blurb: all 1.52M rows are 256 MB
	 * and ~0.45 s without it, 424 MB and ~1.5 s with it. Hover still shows the
	 * whole description.
	 */
	export const BLURB_MAX = 200_000;

	/** What the cursor is over in the grid, for the peek. */
	export type HoverTarget =
		| { kind: 'grant'; row: import('$lib/sql').GridRow }
		| { kind: 'funder' | 'recipient'; name: string };
</script>

<script lang="ts">
	/**
	 * Every grant in the result, one line each, scrollable end to end.
	 *
	 * The model is ../pudl's grid (also ../gem-explorer's): rows never move and
	 * are never created while scrolling. `.tall` owns the scroll height,
	 * `.gviewport` is sticky inside it, and scrolling only rewrites the text of a
	 * fixed pool of rows, synchronously in the scroll handler so the rows land in
	 * the same frame as the movement. A late main thread shows stale rows, never
	 * a blank band. The pool is built imperatively: per-cell reactivity is exactly
	 * the per-frame work this design exists to avoid.
	 *
	 * Data arrives the PUDL way — page 0 for an instant first paint, then the
	 * whole filtered result as typed arrays, after which scrolling never queries
	 * and a drag lands exactly where it looks like it landed. That holds for
	 * every result, up to all 1.52M rows. Until the whole result lands, scrolling
	 * pages (one query in flight at most) and says it is still loading; past
	 * ~535K rows the spacer is capped (see gridMath.ts).
	 */
	import { onMount, tick, untrack } from 'svelte';
	import { query } from '$lib/db.svelte';
	import { gridSql, toGridRow, untitledSql, where, SORTS, type OrgKind, type GridRow, type SortKey, type State } from '$lib/sql';
	import { setSort, openGrant, openOrg, cardHref } from '$lib/url.svelte';
	import { int, moneyExact, ukDate, said } from '$lib/format';
	import {
		spacerHeight, firstRowAt, scrollTopForRow, wheelRows, visibleRange, isScaled, type Geom
	} from '$lib/gridMath';

	let {
		state: s,
		sort,
		onhover,
		onleave
	}: {
		state: State;
		sort: SortKey;
		onhover: (target: HoverTarget, x: number, y: number) => void;
		onleave: () => void;
	} = $props();

	const PAGE = 200;
	// dev only: ?dict=all tries facetful's stage-2 encoding (title and recipient
	// as codes too) so tests/memload.mjs can compare it with the default
	// dev only: ?whole=off never loads the whole result, so tests/stress.mjs
	// (WHOLE=off) can exercise the paged path, which normally only covers the
	// first ~0.5 s after each change
	const WHOLE_OFF = import.meta.env.DEV && new URLSearchParams(location.search).get('whole') === 'off';
	const DICT_TEXT: true | 'all' =
		import.meta.env.DEV && new URLSearchParams(location.search).get('dict') === 'all' ? 'all' : true;
	const MAX_PAGES = 12; // paged mode: pages held either side before trimming
	const OVERSCAN = 40; // rows of headroom before fetching the neighbouring page

	// ---- sort -------------------------------------------------------------
	const COLS = [
		{ key: 'date', label: 'Awarded', asc: 'date_asc', desc: 'date_desc', cls: 'c-date' },
		{ key: 'grant', label: 'Grant', cls: 'c-grant' },
		{ key: 'recipient', label: 'Recipient', asc: 'recipient_asc', desc: 'recipient_desc', cls: 'c-rec' },
		{ key: 'funder', label: 'Funder', asc: 'funder_asc', desc: 'funder_desc', cls: 'c-fund' },
		{ key: 'amount', label: 'Amount', asc: 'amount_asc', desc: 'amount_desc', cls: 'c-amt num' }
	] as const;

	function clickSort(c: (typeof COLS)[number]) {
		if (!('asc' in c)) return;
		// text columns start A–Z, numbers and dates start biggest/newest first
		if (sort === c.asc) setSort(c.desc);
		else if (sort === c.desc) setSort(c.asc);
		else setSort(c.key === 'recipient' || c.key === 'funder' ? c.asc : c.desc);
	}
	const arrow = (c: (typeof COLS)[number]) =>
		'asc' in c ? (sort === c.desc ? '↓' : sort === c.asc ? '↑' : '') : '';

	// ---- state shown in the header -----------------------------------------
	let total = $state(0);
	let counted = $state(false);
	let readout = $state('');
	let whole = $state(false);
	/** the viewport is past the loaded rows and waiting for the whole result */
	let waiting = $state(false);
	let wholeMs = $state(0);
	let ms = $state(0);

	// ---- element refs -------------------------------------------------------
	let scroller: HTMLDivElement;
	let tall: HTMLDivElement;
	let gview: HTMLDivElement;
	let ghead: HTMLDivElement;
	let grows: HTMLDivElement;

	// ---- the pool -----------------------------------------------------------
	/**
	 * Three things in a row are links, each with its own hover and click: the
	 * grant title (its description, then the grant's card), the recipient and
	 * the funder (their figures, then their card). The rest of the row is inert.
	 */
	interface Link {
		a: HTMLAnchorElement;
		t: Text;
	}
	interface Slot {
		row: HTMLDivElement;
		date: Text;
		title: Link;
		blurb: Text;
		rec: Link;
		region: Text;
		fund: Link;
		amt: Text;
		data: GridRow | null;
	}
	let pool: Slot[] = [];
	let rowH = 30;
	let headH = 30;
	let availH = 0;
	let slackH = 0;
	let rendered = { first: 0, last: -1 };

	function cell(row: HTMLElement, cls: string): HTMLDivElement {
		const d = document.createElement('div');
		d.className = `gcell ${cls}`;
		row.append(d);
		return d;
	}
	const text = (parent: HTMLElement, tag?: string, cls?: string): Text => {
		const t = document.createTextNode('');
		if (!tag) parent.append(t);
		else {
			const e = document.createElement(tag);
			if (cls) e.className = cls;
			e.append(t);
			parent.append(e);
		}
		return t;
	};

	/** A plain click opens the card in place; modified clicks keep the browser's own. */
	const plain = (e: MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

	function link(parent: HTMLElement, cls: string, target: () => HoverTarget | null): Link {
		const a = document.createElement('a');
		a.className = `glink ${cls}`;
		const t = document.createTextNode('');
		a.append(t);
		parent.append(a);
		// handlers ask the slot what it holds now: the element is reused for
		// another grant on every scroll
		a.addEventListener('click', (e) => {
			const tg = target();
			if (!tg || !plain(e)) return;
			e.preventDefault();
			onleave();
			if (tg.kind === 'grant') openGrant(tg.row.id);
			else openOrg(tg.kind, tg.name);
		});
		a.addEventListener('mousemove', (e) => {
			const tg = target();
			if (tg) onhover(tg, e.clientX, e.clientY);
		});
		a.addEventListener('mouseleave', onleave);
		return { a, t };
	}

	/** Point a link at its card, or make it plain text when there is nothing to open. */
	function setLink(l: Link, text: string, href: string | null) {
		l.t.nodeValue = text;
		if (href) l.a.setAttribute('href', href);
		else l.a.removeAttribute('href');
	}

	function buildSlot(): Slot {
		const row = document.createElement('div');
		row.className = 'grow';
		const slot = { row, data: null } as Slot;
		const org = (kind: OrgKind) => (): HoverTarget | null => {
			const name = kind === 'funder' ? slot.data?.funder : slot.data?.recipient;
			return name && said(name) ? { kind, name } : null;
		};
		slot.date = text(cell(row, 'c-date'));
		const g = cell(row, 'c-grant');
		slot.title = link(g, 'g-title', () => (slot.data ? { kind: 'grant', row: slot.data } : null));
		slot.blurb = text(g, 'span', 'blurb');
		const r = cell(row, 'c-rec');
		slot.rec = link(r, 'g-org', org('recipient'));
		slot.region = text(r, 'span', 'region');
		slot.fund = link(cell(row, 'c-fund'), 'g-org', org('funder'));
		slot.amt = text(cell(row, 'c-amt num'));
		return slot;
	}

	function fillSlot(slot: Slot, r: GridRow) {
		if (slot.row.hidden) slot.row.hidden = false;
		slot.data = r;
		const title = r.title || '';
		// above BLURB_MAX the in-memory rows have none; pages would, so hide them
		// too rather than have the blurbs vanish when the whole result lands
		const blurb = total <= BLURB_MAX && r.blurb && r.blurb !== title ? r.blurb : '';
		// 448 grants have no title; the description stands in for it
		setLink(slot.title, title || r.blurb || grid.untitled.get(r.id) || '(untitled grant)', cardHref('grant', r.id));
		slot.blurb.nodeValue = title && blurb ? `  ${blurb}` : '';
		slot.date.nodeValue = ukDate(r.date);
		const rec = said(r.recipient);
		setLink(slot.rec, rec || '—', rec ? cardHref('recipient', r.recipient!) : null);
		const reg = said(r.region);
		slot.region.nodeValue = reg ? ` ${reg}` : '';
		const fund = said(r.funder);
		setLink(slot.fund, fund || '—', fund ? cardHref('funder', r.funder!) : null);
		slot.amt.nodeValue = moneyExact(r.amount);
	}

	function blankSlot(slot: Slot) {
		if (slot.row.hidden) return; // already blank: do not touch the DOM again
		slot.row.hidden = true;
		slot.data = null;
	}

	/** Re-read row height from CSS (the phone layout uses a taller row). */
	function measure() {
		availH = scroller?.clientHeight ?? 0;
		const v = parseFloat(getComputedStyle(scroller).getPropertyValue('--row-h'));
		if (v > 0) rowH = v;
	}

	/**
	 * Size the pool to the viewport, whole rows only. Measured on resize only and
	 * never from a value we write: sizing the scroller from its own clientHeight
	 * ratchets it a pixel smaller every pass under border-box.
	 */
	function ensurePool(): boolean {
		if (!availH) measure();
		const need = Math.max(1, Math.floor((availH - headH) / rowH));
		slackH = Math.max(0, availH - headH - need * rowH);
		if (pool.length === need && grows.firstChild) return false;
		while (pool.length < need) pool.push(buildSlot());
		pool.length = need;
		grows.replaceChildren(...pool.map((p) => p.row));
		rendered = { first: 0, last: -1 };
		return true;
	}

	const geom = (): Geom => ({
		total, rowH, poolLen: pool.length, headH, slack: slackH, viewportH: availH
	});

	// ---- sticky fallback ----------------------------------------------------
	// WebKit can leave a sticky block behind during a momentum flick, stranding
	// the rows off-screen. Sample the drift; on a real failure switch to a
	// transform, which no engine gets wrong.
	let stickyBroken = false;
	let stickyBad = 0;
	let stickyTick = 0;
	function holdViewport() {
		if (stickyBroken) {
			gview.style.transform = `translate3d(0,${scroller.scrollTop}px,0)`;
			return;
		}
		if (scroller.scrollTop < rowH || stickyTick++ % 8) return;
		const drift = ghead.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
		if (Math.abs(drift) < rowH) {
			stickyBad = 0;
			return;
		}
		if (++stickyBad < 2) return;
		stickyBroken = true;
		scroller.classList.add('nosticky');
		gview.style.transform = `translate3d(0,${scroller.scrollTop}px,0)`;
		console.warn(`grid: sticky header drifted ${drift.toFixed(0)}px twice, using a transform`);
	}

	/** dev only: when the grid last reset, first painted and held its whole result */
	const gridT = { resetAt: 0, paintAt: 0, wholeAt: 0 };
	if (import.meta.env.DEV) (globalThis as Record<string, unknown>).__gridT = gridT;

	// ---- data ---------------------------------------------------------------
	type Reader = (i: number) => GridRow | null;
	const grid = {
		token: 0, // bumped when the result changes (filter, search, sort) and only then
		read: null as Reader | null, // whole result
		pages: new Map<number, GridRow[]>(),
		// lo..hi is the contiguous run of loaded pages; hi < lo means none
		lo: 0,
		hi: -1,
		// Paged mode keeps at most ONE page query in flight. The worker is single
		// threaded and cannot cancel, so a query sent is a query run: an earlier
		// version sent a new one per scrollbar jump and voided the last, and under
		// a slow drag the stale ones queued up until nothing landed at all.
		busy: -1, // page in flight, -1 when idle
		queued: -1, // the newest page asked for while busy; replaces older asks
		timer: 0 as ReturnType<typeof setTimeout> | 0,
		// whole-result load: debounced, and never more than one in the worker
		// (each is up to 256 MB and cannot be cancelled once sent)
		wholeTimer: 0 as ReturnType<typeof setTimeout> | 0,
		wholeBusy: false,
		wholeAgain: false,
		/** id -> description, for untitled grants in a result loaded without blurbs */
		untitled: new Map<string, string>()
	};

	function rowAt(i: number): GridRow | null {
		if (grid.read) return grid.read(i);
		return grid.pages.get(Math.floor(i / PAGE))?.[i % PAGE] ?? null;
	}

	/**
	 * Read rows straight out of the worker's transferred buffers. Only the ~25
	 * rows on screen ever become objects; the rest stay as arrays.
	 *
	 * Dictionary-coded text columns (`dictText`) are decoded one entry at a
	 * time, the first time a row on screen needs it, straight from dict.offsets
	 * and dict.bytes. Calling result.dictionary() instead decodes every distinct
	 * value up front: at "all" that is ~1.1M title and recipient strings, ~0.7 s
	 * on the main thread for values the grid mostly never shows.
	 */
	function makeReader(r: Awaited<ReturnType<typeof query>>): Reader {
		const dec = new TextDecoder();
		type Raw = ReturnType<typeof r.columnRaw> & {
			codes?: Uint16Array | Uint32Array;
			dict?: { offsets: Uint32Array; bytes: Uint8Array };
		};
		const cols = r.columns.map((c) => {
			const raw = r.columnRaw(c.name) as Raw;
			// sparse cache of decoded dictionary entries, indexed by code
			const seen: (string | undefined)[] | null = raw.codes && raw.dict ? [] : null;
			return { ...raw, name: c.name, seen };
		});
		const n = r.rowCount;
		return (i) => {
			if (i < 0 || i >= n) return null;
			const o: Record<string, unknown> = {};
			for (const c of cols) {
				if (!((c.validity[i >> 3] >> (i & 7)) & 1)) o[c.name] = null;
				else if (c.seen) {
					const k = c.codes![i];
					o[c.name] = c.seen[k] ??= dec.decode(c.dict!.bytes.subarray(c.dict!.offsets[k], c.dict!.offsets[k + 1]));
				} else if (c.kind === 'text') o[c.name] = dec.decode(c.bytes!.subarray(c.offsets![i], c.offsets![i + 1]));
				else if (c.kind === 'date') o[c.name] = new Date((c.values as Float64Array)[i] * 864e5).toISOString().slice(0, 10);
				else o[c.name] = (c.values as Float64Array)[i];
			}
			return o as unknown as GridRow;
		};
	}

	/** Ask for a page. While one is in flight, only the newest ask is kept. */
	function request(p: number) {
		if (p < 0 || grid.read || grid.pages.has(p) || (total && p * PAGE >= total)) return;
		if (grid.busy >= 0) {
			if (grid.busy !== p) grid.queued = p;
			return;
		}
		fetchPage(p);
	}

	async function fetchPage(p: number) {
		const token = grid.token;
		grid.busy = p;
		try {
			const r = await query(gridSql(s, sort, { limit: PAGE, offset: p * PAGE }), { solo: true });
			if (token === grid.token && !grid.read) {
				ms = r.elapsedMs;
				land(p, [...r.rows()].map(toGridRow));
			}
		} catch (err) {
			console.error('grid page failed', err);
		} finally {
			grid.busy = -1;
			const q = grid.queued;
			grid.queued = -1;
			if (q >= 0) request(q);
			else topUp();
		}
	}

	/**
	 * Every page that arrives is used. Next to the loaded run it extends it;
	 * anywhere else it becomes the run (a jump), so a drag always lands on
	 * something even while it keeps moving.
	 */
	function land(p: number, rows: GridRow[]) {
		const joins = grid.hi < grid.lo || (p >= grid.lo - 1 && p <= grid.hi + 1);
		if (!joins) {
			grid.pages.clear();
			grid.lo = grid.hi = p;
		} else {
			grid.lo = Math.min(grid.lo, p);
			grid.hi = Math.max(grid.hi, p);
		}
		grid.pages.set(p, rows);
		// sliding window: drop whichever end is further from the page just loaded
		while (grid.hi - grid.lo + 1 > MAX_PAGES) {
			grid.pages.delete(Math.abs(grid.hi - p) > Math.abs(p - grid.lo) ? grid.hi-- : grid.lo++);
		}
		paint();
	}

	/** Load the whole current result; if one is already running, go again after it. */
	async function loadWhole() {
		if (grid.wholeBusy) {
			grid.wholeAgain = true;
			return;
		}
		grid.wholeBusy = true;
		const token = grid.token;
		const t0 = performance.now();
		try {
			const blurb = total <= BLURB_MAX;
			const r = await query(gridSql(s, sort, undefined, { blurb }), { dictText: DICT_TEXT });
			if (token !== grid.token) return;
			grid.read = makeReader(r);
			grid.pages.clear();
			whole = true;
			waiting = false;
			ms = r.elapsedMs;
			wholeMs = performance.now() - t0;
			if (import.meta.env.DEV) gridT.wholeAt = performance.now();
			rendered = { first: 0, last: -1 };
			paint();
			// Untitled grants show their description instead; without blurbs that
			// comes from a small follow-up query, not awaited by the paint above.
			if (!blurb) {
				const u = await query(untitledSql(s));
				if (token !== grid.token) return;
				grid.untitled = new Map([...u.rows()].map((x) => [String(x.id), String(x.blurb ?? '')]));
				rendered = { first: 0, last: -1 };
				paint();
			}
		} catch (err) {
			console.error('whole-result load failed; staying paged', err);
		} finally {
			grid.wholeBusy = false;
			if (grid.wholeAgain) {
				grid.wholeAgain = false;
				if (!grid.read) loadWhole();
			}
		}
	}

	/**
	 * Pull in the neighbouring page as the painted rows near an edge of the run.
	 * Only when idle: a jump the user is waiting for always goes first.
	 */
	function topUp() {
		if (grid.read || grid.hi < grid.lo || grid.busy >= 0 || grid.queued >= 0) return;
		if (rendered.last >= (grid.hi + 1) * PAGE - OVERSCAN) request(grid.hi + 1);
		else if (rendered.first <= grid.lo * PAGE + OVERSCAN && grid.lo > 0) request(grid.lo - 1);
	}

	// ---- paint ----------------------------------------------------------------
	function paint() {
		if (!scroller) return;
		if (!total) {
			for (const p of pool) blankSlot(p);
			tall.style.height = '0px';
			rendered = { first: 0, last: -1 };
			readout = '';
			return;
		}
		headH = ghead.offsetHeight || headH;
		const rebuilt = ensurePool();
		const g = geom();
		tall.style.height = `${spacerHeight(g)}px`;
		const availFirst = grid.read ? 0 : grid.lo * PAGE;
		const availLast = grid.read ? total - 1 : grid.hi < grid.lo ? -1 : Math.min(total, (grid.hi + 1) * PAGE) - 1;
		const { first, last } = visibleRange(g, scroller.scrollTop, availFirst, availLast);
		holdViewport(); // before any early-out: the block must track the scroll
		// the scrollbar points somewhere the loaded rows do not reach yet
		waiting = !grid.read && (last < first || firstRowAt(g, scroller.scrollTop) !== first);
		if (last < first) return; // nothing loaded here yet: leave the screen alone
		if (!rebuilt && first === rendered.first && last === rendered.last) return;
		for (let k = 0; k < pool.length; k++) {
			const i = first + k;
			const r = i <= last ? rowAt(i) : null;
			if (r) fillSlot(pool[k], r);
			else blankSlot(pool[k]);
		}
		rendered = { first, last };
		readout = `rows ${int(first + 1)}–${int(last + 1)}`;
		if (import.meta.env.DEV && !gridT.paintAt) gridT.paintAt = performance.now();
		onleave(); // the row under the cursor now holds a different grant
	}

	let scrollRaf = 0;
	function onScroll() {
		if (!total) return;
		paint(); // synchronous: same frame as the movement
		if (grid.read) return; // whole result in memory: no paging, no queries
		topUp();
		if (scrollRaf) return;
		scrollRaf = requestAnimationFrame(() => {
			scrollRaf = 0;
			const g = geom();
			const row = firstRowAt(g, scroller.scrollTop);
			const page = Math.min(Math.floor(row / PAGE), Math.floor((total - 1) / PAGE));
			clearTimeout(grid.timer);
			if (page >= grid.lo && page <= grid.hi) return;
			readout = `row ${int(row + 1)}…`; // the rows take ~80 ms; the position is instant
			// short debounce so a drag asks for where it stops, not every page it crosses
			grid.timer = setTimeout(() => request(page), 60);
		});
	}

	function scrollToRow(row: number) {
		scroller.scrollTop = scrollTopForRow(geom(), row);
	}

	/** Above the spacer cap, turn the wheel back into rows (see gridMath.ts). */
	function onWheel(e: WheelEvent) {
		if (!total || e.ctrlKey || !isScaled(geom())) return;
		const rows = wheelRows(e.deltaY, e.deltaMode, geom());
		if (!rows) return;
		e.preventDefault();
		scrollToRow(firstRowAt(geom(), scroller.scrollTop) + rows);
	}

	function onKey(e: KeyboardEvent) {
		if (!total) return;
		const page = Math.max(1, pool.length - 1);
		const by: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: page, PageUp: -page, ' ': page };
		const at = firstRowAt(geom(), scroller.scrollTop);
		if (e.key in by) scrollToRow(at + by[e.key] * (e.shiftKey && e.key === ' ' ? -1 : 1));
		else if (e.key === 'Home') scrollToRow(0);
		else if (e.key === 'End') scrollToRow(total);
		else return;
		e.preventDefault();
	}

	// ---- lifecycle ------------------------------------------------------------
	onMount(() => {
		measure();
		if (import.meta.env.DEV) {
			(globalThis as Record<string, unknown>).__grid = () => ({
				total, whole: !!grid.read, lo: grid.lo, hi: grid.hi, busy: grid.busy, queued: grid.queued, pages: grid.pages.size, rendered: { ...rendered },
				expect: scroller ? firstRowAt(geom(), scroller.scrollTop) : -1, pool: pool.length
			});
		}
		let t: ReturnType<typeof setTimeout>;
		const onResize = () => {
			clearTimeout(t);
			t = setTimeout(() => {
				measure();
				rendered = { first: 0, last: -1 };
				paint();
			}, 150);
		};
		addEventListener('resize', onResize);
		visualViewport?.addEventListener('resize', onResize);
		return () => {
			clearTimeout(t);
			removeEventListener('resize', onResize);
			visualViewport?.removeEventListener('resize', onResize);
		};
	});

	/** identity of the result; any change resets every cache */
	const shape = $derived(`${where(s)}|${SORTS[sort].sql}`);

	// Tracks `shape` and nothing else. The body reads `s`, `sort` and `total`
	// (request(0) runs synchronously), and an effect tracks every synchronous
	// read, so without untrack any URL change — opening a grant, the bar
	// measure — rewound the grid to the top and reloaded the whole result.
	$effect(() => {
		void shape;
		untrack(reset);
	});

	function reset() {
		if (import.meta.env.DEV) Object.assign(gridT, { resetAt: performance.now(), paintAt: 0, wholeAt: 0 });
		const token = ++grid.token;
		clearTimeout(grid.timer);
		clearTimeout(grid.wholeTimer);
		grid.read = null; // drop the old result now, before the next one is built
		grid.untitled = new Map();
		waiting = false;
		grid.pages.clear();
		grid.lo = 0;
		grid.hi = -1;
		grid.queued = -1; // a page still in flight is for the old result; it is discarded on arrival
		whole = false;
		counted = false;
		if (scroller) scroller.scrollTop = 0;
		(async () => {
			// Count and page 0 go together; the mask cache means the count reuses
			// the search the page query is about to evaluate anyway.
			request(0);
			const c = await query(`select count(*) as n from t${where(s)}`, { solo: true });
			if (token !== grid.token) return;
			total = Number([...c.rows()][0]?.n ?? 0);
			counted = true;
			await tick();
			rendered = { first: 0, last: -1 };
			paint();
			if (total <= PAGE) whole = true;
			// after a short pause, so a burst of clicks loads only where it ends
			else if (!WHOLE_OFF) grid.wholeTimer = setTimeout(() => token === grid.token && loadWhole(), 300);
		})();
	}
</script>

<section class="card grid">
	<h3>
		Grants
		<span class="sub">
			{#if counted}
				{int(total)} {total === 1 ? 'grant' : 'grants'} · {SORTS[sort].label.toLowerCase()}{readout ? ` · ${readout}` : ''}
			{:else}
				loading…
			{/if}
		</span>
		<span class="ms">{ms.toFixed(1)} ms{counted && total > PAGE ? (whole ? ` · all in memory (${(wholeMs / 1000).toFixed(1)} s)` : ' · loading all…') : ''}</span>
	</h3>
	<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
	<div
		class="scroller"
		bind:this={scroller}
		onscroll={onScroll}
		onwheel={onWheel}
		onkeydown={onKey}
		tabindex="0"
		role="region"
		aria-label="Grant results"
	>
		<div class="tall" bind:this={tall}>
			<div class="gviewport" bind:this={gview}>
				<div class="ghead" bind:this={ghead}>
					{#each COLS as c (c.key)}
						<div class="gcell {c.cls}" class:sorted={arrow(c) !== ''}>
							{#if 'asc' in c}
								<button onclick={() => clickSort(c)}>{c.label}<span class="arrow">{arrow(c)}</span></button>
							{:else}
								<span>{c.label} <span class="hint">hover a title or name for a summary, click to open it</span></span>
							{/if}
						</div>
					{/each}
				</div>
				<div class="grows" bind:this={grows}></div>
			</div>
		</div>
		{#if waiting && !whole}
			<div class="waiting">Loading all {int(total)} grants — this part of the list appears when they are in memory…</div>
		{/if}
		{#if counted && total === 0}
			<p class="empty">No grants match. Remove a filter, or search for something broader.</p>
		{/if}
	</div>
</section>

<style>
	.grid {
		display: flex;
		flex-direction: column;
		padding-bottom: 0.3rem;
	}
	.scroller {
		--row-h: 30px;
		--cols: 6.2rem minmax(0, 3fr) minmax(0, 1.5fr) minmax(0, 1.3fr) 7.5rem;
		height: min(44rem, calc(100vh - 7rem));
		overflow: auto;
		overscroll-behavior: contain;
		position: relative;
		border-top: 1px solid var(--border-soft);
	}
	.scroller:focus-visible {
		outline-offset: -2px;
	}
	.tall {
		position: relative;
		min-width: 100%;
	}
	/* No overflow here: it would make this a scroll container of its own. */
	.gviewport {
		position: sticky;
		top: 0;
		background: var(--surface);
	}
	.scroller:global(.nosticky) .gviewport {
		position: absolute;
		inset: 0 0 auto 0;
		will-change: transform;
	}
	.ghead,
	.grows :global(.grow) {
		display: grid;
		grid-template-columns: var(--cols);
		column-gap: 0.9rem;
		padding: 0 0.4rem;
	}
	.ghead {
		min-height: 30px;
		align-items: center;
		border-bottom: 1px solid var(--border);
		font-size: 0.72rem;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-faint);
	}
	.ghead button {
		border: 0;
		background: none;
		padding: 0;
		cursor: pointer;
		letter-spacing: inherit;
		text-transform: inherit;
		color: inherit;
		text-align: inherit;
	}
	.ghead button:hover,
	.ghead .sorted button {
		color: var(--text-strong);
	}
	.arrow {
		margin-left: 0.2em;
	}
	.hint {
		text-transform: none;
		letter-spacing: 0;
		color: var(--text-faint);
		opacity: 0.8;
		margin-left: 0.4rem;
	}
	.grows :global(.grow) {
		height: var(--row-h);
		line-height: calc(var(--row-h) - 1px);
		border-bottom: 1px solid var(--border-soft);
	}
	/* the three links: underlined so it is clear they open something */
	.grows :global(a.glink) {
		color: inherit;
		text-decoration: none;
	}
	.grows :global(a.glink[href]) {
		cursor: pointer;
		text-decoration: underline;
		text-decoration-color: var(--border);
		text-decoration-thickness: 1px;
		text-underline-offset: 3px;
	}
	.grows :global(a.glink[href]:hover) {
		text-decoration-color: currentColor;
		color: var(--text-strong);
	}
	/* the UA's [hidden] rule loses to `display: grid` above */
	.grows :global(.grow[hidden]) {
		display: none;
	}
	.grows :global(.grow:hover) {
		background: var(--grants-soft);
	}
	.grows :global(.gcell) {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}
	.grows :global(.c-date),
	.grows :global(.num) {
		font-family: var(--mono);
		font-size: 0.78rem;
		font-variant-numeric: tabular-nums;
		color: var(--text-muted);
	}
	.num,
	.grows :global(.num) {
		text-align: right;
	}
	.grows :global(.num) {
		color: var(--money);
		font-weight: 500;
	}
	.grows :global(.c-grant .g-title) {
		font-weight: 500;
		color: var(--text-strong);
	}
	.grows :global(.blurb),
	.grows :global(.region) {
		color: var(--text-faint);
	}
	.grows :global(.region) {
		font-size: 0.75rem;
	}
	.grows :global(.c-fund) {
		color: var(--text-muted);
	}
	.waiting {
		position: sticky;
		bottom: 0.8rem;
		margin: -3rem auto 0.8rem;
		width: fit-content;
		max-width: calc(100% - 2rem);
		padding: 0.45rem 0.9rem;
		border-radius: 999px;
		background: var(--text-strong);
		color: #fff;
		font-size: 0.8rem;
		box-shadow: var(--card-shadow);
		z-index: 3;
	}
	.empty {
		position: absolute;
		top: 3rem;
		left: 0;
		right: 0;
		text-align: center;
		color: var(--text-muted);
	}
	/* phone: date · grant · amount; recipient and funder are one tap away */
	@media (max-width: 720px) {
		.scroller {
			--row-h: 34px;
			--cols: 5rem minmax(0, 1fr) 5.8rem;
			height: calc(100svh - 6rem);
		}
		.ghead :global(.c-rec),
		.ghead :global(.c-fund),
		.grows :global(.c-rec),
		.grows :global(.c-fund),
		.hint {
			display: none;
		}
		.grows :global(.blurb) {
			display: none;
		}
	}
</style>
