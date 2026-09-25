// What the grid's whole-result query costs per column in memory, and what
// each text column would cost dictionary-encoded (distinct values + a u16/u32
// code per row). Evidence for docs/handoff-facetful-dict-results.md.
//   node scripts/result_dict_measure.mjs [image]
import { readFileSync } from "node:fs";
import { gridSql } from "../app/src/lib/sql.ts";
const base = new URL("../app/node_modules/facetful/", import.meta.url).pathname;
const { instantiate } = await import(base + "core.js");
const engine = await instantiate(readFileSync(base + "facetful_wasm.wasm"));
const { handle } = engine.openTable(readFileSync(process.argv[2] ?? new URL("../data/site/grantnav.facetful", import.meta.url).pathname));
const r = engine.query(handle, gridSql({ q: "", filters: new Map() }, "date_desc", undefined, { blurb: false }));
const dec = new TextDecoder(); let tot = 0, dictTot = 0;
console.log("column".padEnd(10), "now MB".padStart(7), "distinct".padStart(9), "as dict MB".padStart(11));
for (const c of r.columns) {
  const now = (c.bytes?.byteLength ?? 0) + (c.offsets?.byteLength ?? 0) + (c.values?.byteLength ?? 0) + c.validity.byteLength;
  let distinct = "", dict = now;
  if (c.bytes) {
    const set = new Map(); let dbytes = 0;
    for (let i = 0; i < r.rowCount; i++) { const v = dec.decode(c.bytes.subarray(c.offsets[i], c.offsets[i + 1])); if (!set.has(v)) { set.set(v, 1); dbytes += c.offsets[i + 1] - c.offsets[i] + 4; } }
    const code = set.size <= 65535 ? 2 : 4;
    dict = r.rowCount * code + dbytes + c.validity.byteLength;
    distinct = set.size;
  }
  tot += now; dictTot += Math.min(now, dict);
  console.log(c.name.padEnd(10), (now / 1e6).toFixed(1).padStart(7), String(distinct).padStart(9), (dict / 1e6).toFixed(1).padStart(11));
}
console.log("total".padEnd(10), (tot / 1e6).toFixed(1).padStart(7), "".padStart(9), (dictTot / 1e6).toFixed(1).padStart(11));
