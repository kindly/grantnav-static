# GrantNav Static

A rebuild of [GrantNav](https://grantnav.threesixtygiving.org/) with no server:
all 1,520,378 grants in the 360Giving dataset — titles, descriptions, funders,
recipients, locations — faceted and searched in the browser by
[facetful](https://www.npmjs.com/package/facetful) over static files.

The original is Django + Elasticsearch. This is a static SvelteKit app on
GitHub Pages and one **58 MB** data download from S3, kept on the device
(OPFS) after the first visit.

**Live:** https://kindly.github.io/grantnav-static/

Same shape as [gem-explorer](https://github.com/kindly/gem-explorer) and
[pudl-explorer](https://kindly.github.io/pudl-explorer/): one URL filter state
drives every panel, and the grid holds the whole filtered result in memory.

## Running it

The app is `app/`: SvelteKit (Svelte 5, runes, adapter-static, no SSR), laid
out like `../gem-explorer`.

```sh
cd app && npm install
npm run dev          # http://localhost:5173 — data served from ../data/site
npm run check        # svelte-check
npm test             # grid arithmetic + every SQL shape against the real image
node tests/cdp.mjs http://127.0.0.1:5173/   # headless Chromium end-to-end (MOBILE=1, FRESH=1)
```

The data images are not in the repo (they are hundreds of MB) and not in
`app/static/`. `scripts/build_data.sh` writes them to `data/site/`, and a small
Vite plugin serves `/data/*` from there in dev (override with `GRANTNAV_DATA`)
as plain bytes, so dev exercises the `.gz` path. A deployed build takes the
image's absolute URL from `VITE_DATA_URL`.

**facetful is 0.5.1 or later, never 0.4.0 or 0.5.0.** Those two have a
worker bug (`setTable` calls itself instead of `tables.set`), so every table
load dies with "Maximum call stack size exceeded" in any browser. Fixed in
0.5.1. facetful's own release gate only runs `core.js` under Node and never
loads the worker, so run `tests/cdp.mjs` after any facetful upgrade.

**Pre-release test in progress (2026-09-25):** `app/package.json` points at
`app/prerelease/facetful-77b43b5.tgz` (facetful 0.6.0 + the fused batch with integer keys, min/max, count distinct),
packed by browserdb's release script. All app checks pass on it. After
publishing, switch back with `npm i facetful@<version> --save-exact` and delete
`app/prerelease/`.

Queries issued in the same tick go to the engine as one `db.query([...])`
batch (`db.svelte.ts`), except the grid's count and page, which go first on
their own so rows don't wait for facets. Engines without batch support are
detected on the first batch and queried one by one. `node app/tests/interact.mjs`
times 13 real interactions (`EXTRA=batch=off` to compare unbatched).

**Waiting on the next facetful release** (browserdb commits 1587736, 06e2e10,
89411ea; tested here from a local pack on 2026-09-24): `dictText` (all-rows page
memory 259 → 190 MB, already passed by the grid and ignored by 0.5.1), select
expressions evaluated only for the rows in a LIMIT window, text columns no
longer held twice in the worker (full load 575–615 → 390–465 ms), and
`memoryStats()` (read by `tests/memload.mjs`). When it is out: pin it, re-run
`cdp.mjs`, `stress.mjs` and `memload.mjs`, and the paged-query workaround in
`gridSql` (plain description columns, blurb cut in JS) can go.

### The grid

One line per grant; hovering a row shows the whole description, fetched by
funder + identifier (~6 ms: the image is ordered by funder, so that conjunct
prunes to a few row groups; Identifier alone is ~140 ms). The model is
`../pudl`'s: a fixed pool of rows pinned by `position: sticky`, only their
text rewritten on scroll. Data arrives PUDL's way too — page 0, then the
whole filtered result as typed arrays, after which scrolling never queries —
up to 200K rows (~30 MB). Above that (the unfiltered 1.52M is 230 MB) it stays
paged, and past ~535K rows the scroll spacer is capped at 15M px with scroll
position mapped onto rows proportionally (`app/src/lib/gridMath.ts`).

## Deploying

The app and the data deploy separately:

- **App → GitHub Pages.** `.github/workflows/pages.yml` builds `app/` on every
  push to `main` with `VITE_DATA_URL` set to the S3 image and publishes
  `app/build` (with a `.nojekyll`, or Pages drops `_app/`).
- **Data → S3.**

```sh
scripts/build_data.sh data/grantnav.csv         # -> data/site/grantnav.facetful[.gz,.br]
AWS="uvx --from awscli aws" ACL=public-read CORS_ORIGIN=https://kindly.github.io \
  scripts/deploy_s3.sh s3://flatterer-test/grantnav
```

S3 does no content negotiation, so the deploy puts the **brotli bytes under
the plain key** with `Content-Encoding: br`, which browsers unpack natively.
The `.gz` sibling goes up as the fallback. The page picks one at boot from the
two `Content-Length`s. The bucket is a different origin from the page, so it
needs CORS allowing GET/HEAD from `https://kindly.github.io` and exposing
`ETag` (the on-device copy is keyed off it).

## Layout

| path | what |
|---|---|
| `app/src/routes/+page.svelte` | the page: header totals, measure toggle, chips, panels |
| `app/src/lib/sql.ts` | every query the app builds |
| `app/src/lib/url.svelte.ts` | filter / sort / measure / open grant, all in the URL |
| `app/src/lib/db.svelte.ts` | boot: HEAD, pick br or gz, download once, OPFS |
| `app/src/lib/components/GridPanel.svelte` | the grid |
| `app/src/lib/components/Peek.svelte`, `OrgPeek.svelte` | hover a grant title (whole description) or a funder/recipient name (its figures) |
| `app/src/lib/components/GrantPanel.svelte` | every field for one grant (`?grant=<id>`) |
| `app/src/lib/components/OrgPanel.svelte` | one funder (`?f=<name>`) or recipient (`?r=<name>`) across all its grants: figures, by-year chart, top counterparts, regions, add-to-filters |
| `data/site/grantnav.facetful[.br,.gz]` | 1.52M grants × 19 columns (not in git; on S3) |
| `scripts/` | the data pipeline, the S3 deploy, and the size experiments below |

## Findings

Full 1,520,378-row dataset. Timings are the native CLI, so engine time without
the wasm and worker hop.

### Size: what actually moves the needle

The GrantNav CSV export is **1,135.7 MB**, 43 columns. What ships is 356.8 MB,
**58.0 MB brotli**. Three levers got it there, and they are not equally useful.

**1. Which columns you keep (worth ~10×).** Bytes in the compiled image are
almost entirely free text; faceting is nearly free:

| column | MB | share |
|---|---|---|
| Description Rare | 141.3 | 40% |
| Title | 62.8 | 18% |
| Identifier | 52.0 | 15% |
| Recipient Org:Name | 40.0 | 11% |
| Amount, Award Date | 18.2 | 5% |
| **all 14 dictionary columns together** (incl. Description Common) | **27.3** | **8%** |

Three columns the interface never read — `Recipient Org:Identifier`,
`Charity Number`, `Postal Code` — cost 61 MB and were dropped for free.

**2. Codec (worth ~30%).** Brotli beats gzip by a wide margin, but
`DecompressionStream` is specified for gzip/deflate/deflate-raw only, with no
brotli in any browser, so brotli is reachable **only** via `Content-Encoding`.
A host that will not set that header is stuck on the gzip path.

**3. Row order (worth ~17%).** Sorting by funder → recipient → date brings
repeats inside gzip's 32 KB window. Worth doing and free at build time, but
**much weaker here than in `../pudl`**, which saw a 2.8× swing. A PUDL
generator has ~180 monthly rows with near-identical dimensions; a GrantNav
recipient averages 3.1 grants, and Title (664K distinct) and Identifier
(unique) cannot form runs at all. Measure it per dataset rather than assuming
PUDL's result carries over.

Reordering was slightly *good* for speed, not the usual trade-off: the funder
drill-down went 345 → 225 ms and the recipient directory 987 → 865 ms, at the
cost of year-range queries no longer pruning (14 → 21 ms).

### Carrying descriptions for 2× rather than 2.7×

Descriptions are what makes this a search tool rather than a browse tool —
title-only search finds a quarter of the relevant grants:

| search | title only | with descriptions |
|---|---|---|
| mental health | 8,941 | 41,623 |
| climate | 6,937 | 31,093 |
| refugee | 5,297 | 15,177 |
| dementia | 1,983 | 5,533 |

Stored naively that costs 339.4 MB, 63% of the image. Three things cut it to
184 MB with essentially no loss:

**Descriptions repeat.** 1.52M grants hold only 770,339 distinct descriptions
— funders repeat a programme's boilerplate across every grant in it. facetful
dictionary-encodes text only below 65,535 distinct values, so the whole column
went to plain text with every repeat paid in full. Splitting at that threshold
gets the dictionary back: the 65,000 most common descriptions cover **53.6% of
all rows in 13 MB**, the rest stay plain. A row's description is in exactly one
of the two columns, so searching is an OR across both.

**5.3% of descriptions are just the title again** (79,837 rows). Dropped —
Title is already searched and displayed.

**The rare half is cut at 500 characters.** Where you cut matters more than
how much: truncating *every* description at 500 costs "climate" 20% of its
matches, while truncating only the rare ones costs 1–3%, because the repeated
boilerplate that carries late-in-text matches is on the common side and stays
whole.

| variant | raw | gzip | brotli | recall |
|---|---|---|---|---|
| no descriptions | 199.6 MB | 41.2 MB | 30.4 MB | title only |
| **split + trim (shipped)** | **356.8 MB** | **83.0 MB** | **58.0 MB** | **99.9–110%** |
| split, fully lossless | 384.0 MB | 92.3 MB | 63.7 MB | 100% |
| Description whole | 538.9 MB | 101.2 MB | 66.1 MB | 100% |

Recall is measured against a whole-description build. The shipped one finds
*more* for most terms, because it also searches recipient names and programme
titles; against the same two fields the truncation costs 1–3%.

Two things did not work as expected. The dedup saves far more memory than
download — 539 → 384 MB raw is 29%, but gzip only improves 101 → 92 MB,
because the compressor was already catching those repeats inside its window
once rows were sorted by funder. And the dictionary did **not** speed up
search: a 65,000-entry dictionary of ~200-byte strings is no cheaper to scan
than the rows were.

### Speed

| | |
|---|---|
| open the image | 71 ms |
| facet on a dictionary column | 6–11 ms |
| summary (count + sum) | 5 ms |
| first search of a session | ~540 ms |
| each new search term after | ~150 ms |
| repeating a term | 2 ms |
| **facet click after a search** | **1.5–2.3 ms** |
| `year("Award Date")` vs the precomputed `Award Year` | 95.6 vs 8.8 ms |

The filter-mask cache is what makes the interface work: a search costs ~150 ms
once, then every facet click reuses that cached row bitmap. The precomputed
`Award Year` and `Amount Band` columns exist because computing them per row is
11× slower — the same conclusion `../pudl` reached about its `CASE` buckets.

The cache's "a LIKE extending a cached needle only rechecks the matched rows"
optimisation does **not** apply here: it works per conjunct, and a five-column
OR is one conjunct. Typing a word out costs ~150 ms per step, not less.

### Three things worth fixing in the engine

**1. The dictionary code width is u16.** `compile.rs` falls back to plain text
above 65,535 distinct values, and the columns that cross that line are the
expensive ones:

| column | distinct | as plain text | as a u32 dict |
|---|---|---|---|
| Description | 770,339 | 339.4 MB | 184.3 MB |
| Title | 664,351 | 62.8 MB | 37.5 MB |
| Recipient Org:Identifier | 464,616 | 40.6 MB | 24.7 MB |
| Recipient Org:Name | 425,653 | 40.0 MB | 19.5 MB |

The whole description-splitting scheme above is a workaround for this one
limit, done by hand in SQL. A u32 dict would make it unnecessary. The speed
side matters too: `group by "Recipient Org:Name"` takes **987 ms** because it
hashes 1.5M strings, where integer codes would put it in the ~10 ms band.

**2. The compiler needs ~7× the input size in RAM.**

| input | rows × cols | peak RSS | wall |
|---|---|---|---|
| 133 MB | 200K × 43 | 0.95 GB | 2.6 s |
| 442 MB | 600K × 43 | 3.40 GB | 9.6 s |
| 789 MB | 1.52M × 19 | 4.76 GB | 10.4 s |

`InCol::Text` holds every cell as its own `String`, so the cost is per *cell*,
not per byte: ~110 bytes for an average 15-byte cell. The full 43-column CSV
needs ~9 GB and was OOM-killed on a 20 GB machine.

**3. Per-segment compression is worth building.** Already on the
designed-but-not-built list. 6:1 brotli says the segments are highly
compressible, and compressing them individually would cut the 357 MB OPFS
footprint as well as the download.

### Things that worked without comment

Dates, `like` on dictionary and plain columns, `in` lists, `offset`,
`group by` by position, quoted names with spaces, colons and parentheses.
Every query shape the app generates runs clean (`cd app && npm test`).

## Scripts

| script | what |
|---|---|
| `scripts/build_data.sh` | the pipeline: CSV → split, ordered, compiled, compressed |
| `scripts/split_description.sql` | the column projection, description split and row order |
| `scripts/deploy_s3.sh` | upload the data image to S3 (brotli under the plain key, gzip fallback) and set CORS |
| `scripts/profile_csv.py` | streaming per-column distinct / null / bytes profile |
| `scripts/order_experiment.sh` | the row-order comparison |
| `scripts/column_ladder.sh` | the column-cost ladder |
| `scripts/peakrss.py` | wall time and peak RSS of a command |
| `scripts/gn_fetch.py` | fetch from GrantNav, solving its proof-of-work challenge |
| `bench/grantnav-desc.sql` | the search benchmark, for `facetful query --bench` |

`build/` is scratch from the experiments (several GB of intermediate images);
delete it freely.

## Data

Grants are from [360Giving](https://www.360giving.org/) publishers via
GrantNav, CC-BY 4.0. Per-file licensing is at
<https://grantnav.threesixtygiving.org/datasets/>.
