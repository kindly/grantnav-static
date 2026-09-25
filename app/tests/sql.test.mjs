// Every query shape the app builds, run against the shipped image with the
// shipped wasm. Slow (opens a 357 MB image); skipped when the image is absent.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { distinctUnder, yearSpan } from "../src/lib/facetMath.ts";
import {
  FACETS, SORTS, summarySql, facetSql, gridSql, toGridRow, FIND_LIMIT, FACET_BY_KEY, where, descSql, grantSql, untitledSql,
  orgSummarySql, orgYearsSql, orgTopSql, orgRegionsSql, orgMetaSql,
} from "../src/lib/sql.ts";

const IMAGE = process.env.GRANTNAV_DATA ? `${process.env.GRANTNAV_DATA}/grantnav.facetful` : new URL("../../data/site/grantnav.facetful", import.meta.url).pathname;
const FF = new URL("../node_modules/facetful/", import.meta.url);

test("every app query runs", { skip: !existsSync(IMAGE) && "no image" }, async () => {
  const { instantiate } = await import(new URL("core.js", FF).href);
  const engine = await instantiate(readFileSync(new URL("facetful_wasm.wasm", FF)));
  const { handle } = engine.openTable(readFileSync(IMAGE));
  const run = (sql) => engine.query(handle, sql);

  const states = [
    { q: "", filters: new Map() },
    { q: "dementia", filters: new Map() },
    { q: "o'brien", filters: new Map([["region", ["Scotland"]]]) },
    { q: "", filters: new Map([["year", ["2021", "2022"]], ["funder", ["The National Lottery Community Fund"]]]) },
  ];
  for (const s of states) {
    assert.equal(run(summarySql(s)).rowCount, 1);
    for (const f of FACETS) {
      run(facetSql(s, f));
      run(facetSql(s, f, { by: "amt", needle: "found" }));
    }
    for (const k of Object.keys(SORTS)) {
      run(gridSql(s, k, { limit: 200, offset: 400 }));
      run(gridSql(s, k));
    }
  }

  const r = run(gridSql({ q: "dementia", filters: new Map() }, "date_desc", { limit: 1, offset: 0 }));
  const col = (n) => r.columns.find((c) => c.name === n);
  const text = (c) => new TextDecoder().decode(c.bytes.subarray(c.offsets[0], c.offsets[1]));
  const id = text(col("id")), funder = text(col("funder"));
  assert.equal(run(descSql(id, funder)).rowCount, 1);
  assert.equal(run(grantSql(id)).rowCount, 1);

  const all = { q: "", filters: new Map() };
  // funder and recipient cards, including a name with a quote in it, and the
  // recipient filter those cards set
  for (const [kind, name] of [["funder", funder], ["funder", "The National Lottery Community Fund"], ["recipient", "Alzheimer's Society"]]) {
    const sum = run(orgSummarySql(kind, name));
    assert.ok(sum.columns[0].values[0] > 0, `${kind} ${name} has grants`);
    for (const sql of [orgYearsSql(kind, name), orgTopSql(kind, name), orgRegionsSql(kind, name), orgMetaSql(kind, name)]) {
      assert.ok(run(sql).rowCount > 0, sql);
    }
  }
  const rec = { q: "", filters: new Map([["recipient", ["Alzheimer's Society"]]]) };
  assert.equal(run(summarySql(rec)).columns[0].values[0], run(orgSummarySql("recipient", "Alzheimer's Society")).columns[0].values[0]);
  run(untitledSql(all));

  // The header's funder count and year span come from the funder facet and
  // year chart rows, not the totals query: they must agree with count(distinct)
  // and min/max under every kind of filter state, own filters included.
  const rowsOf = (r) => { const out = []; const dec = new TextDecoder(); const [k, n, a] = r.columns;
    for (let i = 0; i < r.rowCount; i++) { const ok = (k.validity[i >> 3] >> (i & 7)) & 1;
      out.push({ k: !ok ? null : k.bytes ? dec.decode(k.bytes.subarray(k.offsets[i], k.offsets[i + 1])) : k.values[i], n: n.values[i], amt: a.values[i] }); }
    return out; };
  const check = [
    all,
    { q: "", filters: new Map([["funder", ["Sport England", "Buttle UK"]]]) },
    { q: "", filters: new Map([["year", ["2019", "2021"]], ["region", ["London"]]]) },
    { q: "dementia", filters: new Map([["funder", ["The National Lottery Community Fund"]], ["year", ["2022"]]]) },
    { q: "zzzz-no-match", filters: new Map() },
  ];
  for (const st of check) {
    const truth = run(`select count(distinct nullif("Funding Org:Name", '')) as f, min("Award Year") as y0, max("Award Year") as y1 from t${where(st)}`).columns;
    const fr = rowsOf(run(facetSql(st, FACET_BY_KEY.get("funder"), { limit: FIND_LIMIT })));
    const yr = rowsOf(run(facetSql(st, FACET_BY_KEY.get("year"), { limit: 100 })));
    assert.ok(fr.length < FIND_LIMIT, "funder facet holds every funder");
    assert.equal(distinctUnder(fr, st.filters.get("funder")), truth[0].values[0], `funders for ${JSON.stringify([...st.filters])} ${st.q}`);
    const span = yearSpan(yr, st.filters.get("year"));
    const has = (truth[1].validity[0] & 1) === 1;
    assert.deepEqual(span, has ? [truth[1].values[0], truth[2].values[0]] : null, `years for ${JSON.stringify([...st.filters])} ${st.q}`);
  }

  // A page is fetched on every scrollbar jump, so it must not evaluate anything
  // per matching row: with the blurb cut in SQL this was ~508 ms, plain ~80 ms.
  const deep = gridSql(all, "date_desc", { limit: 200, offset: 800_000 });
  run(deep);
  const t0 = performance.now();
  for (let i = 0; i < 3; i++) run(deep);
  const ms = (performance.now() - t0) / 3;
  assert.ok(ms < 250, `deep page query took ${ms.toFixed(0)} ms`);

  assert.equal(toGridRow({ id: "x", title: "t", dc: "", dr: "d".repeat(300) }).blurb.length, 140);
  assert.equal(toGridRow({ id: "x", title: "t", dc: "common", dr: null }).blurb, "common");

  // the description is never '' when either half has text
  const blank = run(`select count(*) as n from t where coalesce(nullif("Description Common", ''), "Description Rare") = '' and "Description Rare" <> ''`);
  assert.equal(blank.columns[0].values[0], 0);
});
