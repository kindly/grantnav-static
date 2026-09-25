# Handoff: dictionary-encoded text in facetful query results

From the gratnav session (GrantNav Static, `~/projects/gratnav`), 2026-09-24.
For whoever works on facetful in `~/projects/browserdb`.

## The ask

Let a query result carry a text column as **codes + a dictionary** instead of a
UTF-8 string per row, at least when the column is projected straight from a
dictionary-encoded column of the image. Today the engine expands those columns
into one string per row on output, so a value repeated 1.5M times is built,
copied and transferred 1.5M times.

## Why it matters now

gratnav's grid now does what PUDL and gem-explorer do, at 50× their size: after
each filter change it loads the **entire filtered result** (up to all 1,520,378
grants) through `columnRaw` and reads rows lazily from the typed arrays. David
tried it without a size limit and wants to keep it. It works (the full result
lands ~0.6 s after first paint in Chromium), but the payload is large and almost
all of it is repeated text.

The grid's whole-result query, all rows, per column
(`node scripts/result_dict_measure.mjs` in gratnav reproduces this):

| column | source | now | distinct | as codes + dict |
|---|---|---|---|---|
| id (`Identifier`) | plain text | 52.2 MB | 1,516,139 | 58.2 MB (no gain) |
| title (`Title`) | plain text | 63.0 MB | 664,352 | 37.7 MB |
| recipient (`Recipient Org:Name`) | plain text | 40.2 MB | 425,654 | 19.7 MB |
| funder (`Funding Org:Name`) | **dict in image** | 52.2 MB | 372 | 3.2 MB |
| region (`Best Available Region…`) | **dict in image** | 23.3 MB | 14 | 3.2 MB |
| amount, date | f64 | 24.8 MB | | 24.8 MB |
| **total** | | **255.7 MB** | | **140.8 MB** |

- **Stage 1** (dict columns of the image pass their codes through): 255.7 → ~187 MB,
  and it should be nearly free: the codes already exist, so output skips the
  string expansion entirely.
- **Stage 2** (the result builder dictionary-encodes plain text columns when that
  pays): ~141 MB. It needs u32 codes (title and recipient are past 65,535 distinct).
  This is the same u16 limit gratnav's README lists as the first engine fix.

The size is paid more than once. `core.js` `query()` copies every column out of
wasm memory with `.slice()` while the wasm-side result is still alive, so the
worker briefly holds both (~2× the table above), and the wasm heap doesn't shrink
afterwards. The transfer to the page is zero-copy. Codes cut every one of those
steps, not just the page's steady state.

## Suggested shape (yours to change)

Opt-in, so no existing `columnRaw` consumer sees a new shape:

```ts
db.query(sql, { table, dictText: true })

interface RawColumn {
  // ...existing fields...
  /** text, when dictionary-encoded: one code per row (null rows per validity) */
  codes?: Uint16Array | Uint32Array;
  /** text, when dictionary-encoded: the distinct values, same layout as offsets/bytes */
  dict?: { offsets: Uint32Array; bytes: Uint8Array };
}
```

- `rows()` and `column()` keep returning strings, decoding through the
  dictionary, so only `columnRaw` readers change.
- `transferables()` needs the new buffers.
- The dictionary could be the column's whole image dictionary rather than only
  the values that appear. It's tiny for these columns, and it avoids a remap.

## How gratnav will consume it

`makeReader` in `gratnav/app/src/lib/components/GridPanel.svelte` decodes one
row at a time for the ~22 rows on screen. With codes it would decode each
dictionary entry once, cache the strings, and index by code, which is cheaper
per scroll frame than it is now. gratnav will pass `dictText: true` on the
whole-result query only.

## Testing: please include a browser/worker check

Every table load in 0.4.0 and 0.5.0 died in browsers (`setTable` recursion in
`worker.js`) because `scripts/build-package.sh` only exercises `core.js` under
Node. This feature changes `core.js`, `worker.js` (transferables) and
`index.d.ts`. Please run at least one query with `dictText: true` through the
real worker in headless Chromium before publishing. gratnav's check is
`node app/tests/cdp.mjs <url>` against its dev server (see gratnav README,
"Running it"). It exercises the full 1.52M-row load, and I can switch it to the
new option as soon as there's a build to try.

## Useful facts

- Data: `~/projects/gratnav/data/site/grantnav.facetful` (357 MB, 1.52M rows ×
  19 columns); the grid's query is `gridSql(state, sort, undefined, { blurb: false })`
  in `gratnav/app/src/lib/sql.ts`.
- gratnav pins facetful exactly (`"facetful": "0.5.1"` in `app/package.json`).
- Timings in Node with the in-memory image: the whole-result query is ~450 ms
  for all rows, and 1.5 s when it also computes `substr(coalesce(...), 1, 140)`,
  because select-list expressions are evaluated for every matching row. That's
  a separate, smaller finding: expressions are evaluated before sort/limit, so
  a paged query with an expression costs ~430 ms more than without (508 vs 79 ms
  at offset 800K). gratnav worked around it; it may be worth fixing on its own.
