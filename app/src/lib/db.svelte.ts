// The facetful singleton: one worker, one table, fetched once and kept in OPFS.
import { Facetful, type Result } from 'facetful';

// Two ways in, picked per host at boot:
//   1. The host negotiates Content-Encoding (br or gzip) and the browser
//      decompresses natively. Brotli is only reachable this way —
//      DecompressionStream does gzip/deflate only.
//   2. It does not, so fetch the .gz sibling and undo it here.
// Relative in dev (the Vite plugin serves data/site). A deployed build sets
// VITE_DATA_URL to the image's absolute URL: the app is on GitHub Pages and
// the data on S3, a different origin, so the bucket needs CORS (see
// scripts/deploy_s3.sh).
const DATA_URL: string = import.meta.env.VITE_DATA_URL || 'data/grantnav.facetful';
const GZ_URL = `${DATA_URL}.gz`;
const OPFS_PREFIX = 'grantnav-';
const TABLE = 'grants';
const CACHE_BYTES = 512 << 20;

export const boot = $state({
	ready: false,
	failed: '',
	step: 'Starting the query engine…',
	/** 0..1 when the download size is known, else -1 */
	progress: -1,
	note: '',
	rows: 0,
	source: ''
});

let db: Facetful | null = null;
let opening: Promise<Facetful> | null = null;

/** Engine ms per query, summed by whoever is timing a batch (the footer). */
export const perf = $state({ engineMs: 0, queries: 0, settledMs: 0, pending: 0 });
let batchStart = 0;

/** dev only: every query with its wall and engine time, for tests/stress.mjs */
const qlog: { sql: string; at: number; wall: number; engine: number; rows: number }[] = [];
if (import.meta.env.DEV) (globalThis as Record<string, unknown>).__qlog = qlog;
// dev only: the engine itself, for tests/memload.mjs (memoryStats() in facetful > 0.5.1)
if (import.meta.env.DEV) (globalThis as Record<string, unknown>).__db = () => getDb();

// dev only: a log of each burst of queries (first sent -> last answered), for
// tests/interact.mjs; and ?batch=off to measure without batching
const bursts: { start: number; end: number; engine: number; queries: number }[] = [];
if (import.meta.env.DEV) (globalThis as Record<string, unknown>).__bursts = bursts;
const BATCH_OFF = import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).get('batch') === 'off';

/**
 * `dictText` (facetful > 0.5.1) returns dictionary-backed text columns as codes
 * plus a dictionary rather than a string per row; older versions ignore it.
 */
export async function query(
	sql: string,
	opts: { dictText?: boolean | 'all'; solo?: boolean } = {}
): Promise<Result> {
	const d = await getDb();
	if (perf.pending === 0) {
		batchStart = performance.now();
		perf.engineMs = 0;
		perf.queries = 0;
		if (import.meta.env.DEV) bursts.push({ start: batchStart, end: 0, engine: 0, queries: 0 });
	}
	perf.pending++;
	const t0 = performance.now();
	try {
		const r =
			opts.dictText || opts.solo
				? await d.query(sql, { table: TABLE, dictText: opts.dictText } as { table: string })
				: await batched(d, sql);
		// every result of a batch carries the whole batch's time: count it once
		const engine = share.get(r) ?? r.elapsedMs;
		perf.engineMs += engine;
		perf.queries++;
		if (import.meta.env.DEV) qlog.push({ sql: sql.slice(0, 120), at: t0, wall: performance.now() - t0, engine, rows: r.rowCount });
		return r;
	} finally {
		if (--perf.pending === 0) {
			perf.settledMs = performance.now() - batchStart;
			const b = bursts.at(-1);
			if (import.meta.env.DEV && b) Object.assign(b, { end: performance.now(), engine: perf.engineMs, queries: perf.queries });
		}
	}
}

// ---- batching ---------------------------------------------------------------
//
// A click changes the URL once and every panel re-queries in the same tick:
// four facets, the year chart, the totals, the grid's count and first page.
// Queries issued in one tick are sent together as db.query([...]) (facetful
// 0.6.1+), which runs the facet-shaped ones fused over shared filter masks.
// Older engines take a string only; the first batch finds that out and every
// later query goes singly. A failing statement fails the whole batch, so a
// batch that fails is re-run singly and each error lands on its own query.

// The grid's count and first page are sent `solo`, not batched: a batch
// answers all at once, so rows would wait for every facet. Sent as their own
// messages ahead of the batch (the flush waits a macrotask), the worker runs
// them first and the rows paint before the facets land.

type Waiting = { sql: string; resolve: (r: Result) => void; reject: (e: unknown) => void };
/** engine ms to count for a batch member: the whole batch on the first, 0 on the rest */
const share = new WeakMap<Result, number>();
let waiting: Waiting[] = [];
let batchable: boolean | null = BATCH_OFF ? false : null; // null: not yet known

function batched(d: Facetful, sql: string): Promise<Result> {
	if (batchable === false) return d.query(sql, { table: TABLE });
	return new Promise((resolve, reject) => {
		if (!waiting.length) setTimeout(() => flush(d), 0);
		waiting.push({ sql, resolve, reject });
	});
}

async function flush(d: Facetful) {
	const q = waiting;
	waiting = [];
	const single = (w: Waiting) => d.query(w.sql, { table: TABLE }).then(w.resolve, w.reject);
	if (q.length === 1) return single(q[0]);
	try {
		const rs = (await (d.query as unknown as (s: string[], o: object) => Promise<unknown>)(
			q.map((w) => w.sql),
			{ table: TABLE }
		)) as Result[];
		if (!Array.isArray(rs) || rs.length !== q.length) throw new Error('no batch support');
		batchable = true;
		rs.forEach((r, i) => share.set(r, i === 0 ? r.elapsedMs : 0));
		q.forEach((w, i) => w.resolve(rs[i]));
	} catch {
		if (batchable === null) batchable = false;
		await Promise.all(q.map(single));
	}
}

export function getDb(): Promise<Facetful> {
	opening ??= open().catch((err) => {
		boot.failed = `${boot.step.replace(/…$/, '')} failed: ${err?.message ?? err}`;
		console.error(err);
		throw err;
	});
	return opening;
}

async function open(): Promise<Facetful> {
	boot.step = 'Starting the query engine…';
	const d = await Facetful.open();
	db = d;

	// The OPFS name carries the served file's version tag, so a rebuilt data
	// file is a new name and is picked up without anyone clearing storage.
	const [head, gzHead] = await Promise.all([
		fetch(DATA_URL, { method: 'HEAD' }).catch(() => null),
		fetch(GZ_URL, { method: 'HEAD' }).catch(() => null)
	]);
	const source = pickSource(head, gzHead);
	const path = `${OPFS_PREFIX}${versionTag((head?.ok ? head : gzHead)?.headers)}.facetful`;
	const opfs = await hasOpfs();

	if (opfs) {
		try {
			boot.step = 'Opening the register stored on this device…';
			const t0 = performance.now();
			const { rows, fileLen } = await d.loadOpfs(TABLE, path, { cacheBytes: CACHE_BYTES });
			finish(rows, `${(fileLen / 1e6).toFixed(0)} MB from this device, opened in ${(performance.now() - t0).toFixed(0)} ms`);
			prune(path);
			return d;
		} catch {
			// not stored under this tag yet, or another tab holds the lock
		}
	}

	const t0 = performance.now();
	const body = await download(source);
	const fetched = `downloaded ${(body.byteLength / 1e6).toFixed(0)} MB in ${((performance.now() - t0) / 1000).toFixed(1)} s`;

	if (opfs) {
		try {
			boot.step = 'Storing it for next time…';
			const rows = await store(d, body, path, source.gunzip);
			finish(rows, `${fetched}, stored on this device`);
			prune(path);
			return d;
		} catch (err) {
			// A sync access handle is an exclusive lock; another tab's worker makes
			// this fail. The data is still perfectly usable from memory.
			console.warn('OPFS unavailable, continuing in memory:', err);
		}
	}

	boot.step = 'Loading into memory for this visit…';
	const { rows } = await d.load(TABLE, (await inflate(body, source.gunzip)).buffer as ArrayBuffer);
	finish(rows, `${fetched}, in memory only — this repeats next visit`);
	return d;
}

function finish(rows: number, source: string) {
	boot.rows = rows;
	boot.source = source;
	boot.progress = 1;
	boot.ready = true;
}

async function download(source: { url: string; gunzip: boolean }): Promise<Uint8Array> {
	boot.step = 'Downloading the register. This happens once.';
	const res = await fetch(source.url);
	if (!res.ok || !res.body) throw new Error(`${source.url} — HTTP ${res.status}`);
	// With a negotiated encoding the body arrives decompressed while
	// content-length describes the compressed bytes: count MB, no percentage.
	const encoded = Boolean(res.headers.get('content-encoding'));
	const total = encoded ? 0 : Number(res.headers.get('content-length')) || 0;
	let got = 0;
	const counted = res.body.pipeThrough(
		new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, c) {
				got += chunk.length;
				boot.progress = total ? got / total : -1;
				boot.note = total ? `${(got / 1e6).toFixed(0)} of ${(total / 1e6).toFixed(0)} MB` : `${(got / 1e6).toFixed(0)} MB`;
				c.enqueue(chunk);
			}
		})
	);
	return new Uint8Array(await new Response(counted).arrayBuffer());
}

/**
 * Gunzip if the bytes are still gzip. Checked by magic number rather than by
 * which URL was fetched: some hosts (Vite's dev server among them) send the
 * .gz with Content-Encoding: gzip, and the browser has already unpacked it.
 */
async function inflate(bytes: Uint8Array, gunzip: boolean): Promise<Uint8Array> {
	if (!gunzip || bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
	const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Unpack into OPFS and open it there, retrying once past a stale lock.
 * storeOpfs transfers (detaches) its buffer, so the compressed bytes are kept
 * and re-inflated for the retry and the in-memory fallback.
 */
async function store(d: Facetful, body: Uint8Array, path: string, gunzip: boolean): Promise<number> {
	for (let attempt = 0; ; attempt++) {
		let buf = await inflate(body, gunzip);
		if (buf === body) buf = body.slice(); // storeOpfs detaches it; keep ours
		try {
			await d.storeOpfs(path, buf.buffer as ArrayBuffer);
			const { rows } = await d.loadOpfs(TABLE, path, { cacheBytes: CACHE_BYTES });
			return rows;
		} catch (err) {
			if (attempt > 0) throw err;
			await d.removeOpfs(path).catch(() => {});
		}
	}
}

/**
 * Will the host decompress for us? Content-Encoding is not CORS-safelisted and
 * may be hidden, but Content-Length gives it away: if the plain key is not much
 * bigger than the gzip sibling, its bytes are already compressed.
 */
function pickSource(head: Response | null, gzHead: Response | null) {
	const gz = { url: GZ_URL, gunzip: true };
	if (!head?.ok) return gz;
	if (head.headers.get('content-encoding')) return { url: DATA_URL, gunzip: false };
	const plainLen = Number(head.headers.get('content-length')) || 0;
	const gzLen = Number(gzHead?.headers.get('content-length')) || 0;
	if (!gzHead?.ok) return plainLen ? { url: DATA_URL, gunzip: false } : gz;
	if (plainLen && gzLen && plainLen < gzLen * 1.5) return { url: DATA_URL, gunzip: false };
	return gz;
}

function versionTag(headers?: Headers): string {
	const etag = (headers?.get('etag') ?? '').replace(/[^A-Za-z0-9]/g, '');
	if (etag) return etag.slice(0, 24);
	const stamp = `${headers?.get('content-length') ?? '0'}-${headers?.get('last-modified') ?? ''}`;
	return stamp.replace(/[^A-Za-z0-9]/g, '').slice(0, 24) || 'nover';
}

async function hasOpfs(): Promise<boolean> {
	try {
		return Boolean(await navigator.storage?.getDirectory?.());
	} catch {
		return false;
	}
}

/** Drop images from earlier builds; they are hundreds of MB each. */
async function prune(keep: string) {
	try {
		const dir = await navigator.storage.getDirectory();
		for await (const name of dir.keys() as AsyncIterable<string>) {
			if (name.startsWith(OPFS_PREFIX) && name !== keep) await db?.removeOpfs(name);
		}
	} catch {
		// nothing to prune
	}
}

/** Delete every stored copy and reload fresh. */
export async function resetStoredData() {
	try {
		const dir = await navigator.storage.getDirectory();
		for await (const name of dir.keys() as AsyncIterable<string>) {
			if (name.startsWith(OPFS_PREFIX)) {
				if (db) await db.removeOpfs(name).catch(() => {});
				else await dir.removeEntry(name).catch(() => {});
			}
		}
	} catch {
		// nothing stored
	}
	location.reload();
}
