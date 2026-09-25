// INTERACT: time real interactions (facet clicks, search, sort, cards) from
// the click to the moment every query it caused has answered, and to the
// grid's first paint and whole result. Warm-up pass, then RUNS passes; medians.
// Dev server only (uses the __bursts / __gridT / __grid hooks). EXTRA="batch=off"
// appends to the start URL. Dev server only (uses
// the window.__grid / __qlog hooks).
//
// Headless Chromium over the DevTools protocol, against a running app
// (npm run dev, or any static host): boots, then checks what static analysis
// cannot — rows render as one line each, scrolling moves them, the whole
// result lands in memory for small sets, a 1.5M-row drag lands, the hover
// peek shows the full description, the grant sheet opens. Screenshots to
// ../build/shots-app/.
//
//   node tests/cdp.mjs [url]      FRESH=1 empty profile, MOBILE=1 phone
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const PORT = 9339;
const url = process.argv[2] ?? "http://127.0.0.1:5190/";
const outDir = new URL(process.env.MOBILE ? "../../build/shots-app-mobile/" : "../../build/shots-app/", import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// disk-backed: the profile holds the 357 MB image in OPFS, and /tmp is RAM
const profileRoot = new URL("../../build/", import.meta.url).pathname;
const profile = process.env.FRESH ? mkdtempSync(join(profileRoot, "chrome-app-")) : join(profileRoot, "chrome-interact-profile");

const chrome = spawn("chromium", [
  "--headless=new", "--no-proxy-server",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check", "--disable-gpu",
  `--window-size=${process.env.WIDTH ?? 1500},${process.env.HEIGHT ?? 950}`,
  `--crash-dumps-dir=${profile}`, "--disable-crash-reporter",
  "--js-flags=--max-old-space-size=6144", "--enable-features=FileSystemAccessAPI",
  "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "about:blank",
], { stdio: ["ignore", "pipe", "pipe"] });

// Cleanup on every exit path, not just success — that is how the profiles
// pile up.
const cleanUp = () => {
  try { chrome.kill(); } catch {}
  if (process.env.FRESH) { try { rmSync(profile, { recursive: true, force: true }); } catch {} }
};
process.on("exit", cleanUp);
process.on("SIGINT", () => process.exit(130));
process.on("uncaughtException", (e) => { console.error(e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error(e); process.exit(1); });

let targets;
for (let i = 0; i < 60; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); break; }
  catch { await sleep(250); }
}
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let id = 0;
const pending = new Map();
const logs = [];
const die = (why) => {
  console.log(`\nWATCHDOG: ${why}\n--- browser console ---\n${logs.slice(0, 40).join("\n")}`);
  cleanUp();
  process.exit(2);
};
const watchdog = setTimeout(() => die("exceeded 900 s"), 900_000);
ws.onclose = () => die("devtools socket closed");
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  } else if (m.method === "Runtime.consoleAPICalled") {
    logs.push(`[console.${m.params.type}] ${m.params.args.map((a) => a.value ?? a.description ?? "").join(" ")}`);
  } else if (m.method === "Runtime.exceptionThrown") {
    logs.push(`[exception] ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
  }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id;
  pending.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params }));
});
const js = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "eval failed");
  return r.result.value;
};
const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: Boolean(process.env.FULLPAGE) });
  writeFileSync(join(outDir, name), Buffer.from(r.data, "base64"));
  console.log(`   shot ${join(outDir, name)}`);
};

let failures = 0;
const check = (name, cond, detail = "") => {
  if (cond) console.log(`ok   ${name}${detail ? `  (${detail})` : ""}`);
  else { failures++; console.error(`FAIL ${name}${detail ? `  — ${detail}` : ""}`); }
};

await send("Runtime.enable");
await send("Page.enable");
// MOBILE=1 emulates a phone: narrow viewport, device pixel ratio, touch.
const MOBILE = Boolean(process.env.MOBILE);
await send("Emulation.setDeviceMetricsOverride", {
  width: Number(process.env.WIDTH ?? (MOBILE ? 390 : 1500)),
  height: Number(process.env.HEIGHT ?? (MOBILE ? 844 : 950)),
  deviceScaleFactor: MOBILE ? 3 : 1,
  mobile: MOBILE,
});
if (MOBILE) {
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await send("Emulation.setEmitTouchEventsForMouse", { enabled: true, configuration: "mobile" });
}

const t0 = performance.now();
await send("Page.navigate", { url });

const waitFor = async (expr, secs = 60, label = expr) => {
  for (let i = 0; i < secs * 4; i++) {
    const v = await js(expr).catch(() => null);
    if (v) return v;
    await sleep(250);
  }
  die(`timed out waiting for ${label}`);
};

// boot
for (let i = 0; ; i++) {
  const s = await js(`(() => { const b = document.querySelector('.boot'); if (!document.querySelector('header')) return 'navigating'; return b ? b.querySelector('.step')?.textContent + ' ' + (b.querySelector('.note')?.textContent ?? '') : 'ready'; })()`).catch(() => "navigating");
  if (s === "ready") break;
  if (i % 8 === 0) console.log(`   ${((performance.now() - t0) / 1000).toFixed(0)}s  ${s}`);
  if (/failed/.test(s)) die(s);
  if (i > 960) die("boot took over 240 s");
  await sleep(250);
}
console.log(`booted in ${((performance.now() - t0) / 1000).toFixed(1)} s`);



const RUNS = Number(process.env.RUNS ?? 3);
const start = url + (process.env.EXTRA ? `?${process.env.EXTRA}` : "");

// each action runs inside the page and returns performance.now() taken just
// before it acts, so every time below is on the page's own clock
const click = (sel, pick = "") => `(() => { const els = [...document.querySelectorAll(${JSON.stringify(sel)})]; const el = ${pick || "els[0]"}; const t0 = performance.now(); el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })); return t0; })()`;
const type = (text) => `(() => { const i = document.querySelector('.search input'); const t0 = performance.now(); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input', { bubbles: true })); return t0; })()`;
const select = (v) => `(() => { const s = document.querySelector('.sort select'); const t0 = performance.now(); s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('change', { bubbles: true })); return t0; })()`;
const ACTIONS = [
  ["facet: top funder", click(".facet:nth-of-type(1) .row", "document.querySelectorAll('.panels .facet')[0].querySelector('.row')")],
  ["facet: + London", click(".facet .row", "[...document.querySelectorAll('.panels .facet')[2].querySelectorAll('.row')].find((r) => /London/.test(r.textContent))")],
  ["year bar: + 2022", click(".chart .yr", "els.find((g) => /^2022:/.test(g.getAttribute('aria-label')))")],
  ["clear all", click(".clear-all")],
  ["search: climate", type("climate"), true],
  ["search: mental health", type("mental health"), true],
  ["clear all (from search)", click(".clear-all")],
  ["sort: amount", select("amount_desc")],
  ["bars: money", click(".measure button.m")],
  ["open funder card", click(".grows .c-fund a[href]")],
  ["close card", click(".sheet .close")],
  // separate actions: two URL changes in one tick race, and the second
  // (built from the not-yet-updated URL) undoes the first
  ["bars: grants", click(".measure button:not(.m)")],
  ["sort: date", select("date_desc")],
];

async function measure(expr, debounced) {
  // start from idle: nothing in flight for 150 ms (a previous action's
  // follow-up queries would otherwise swallow this one's)
  for (let quiet = 0; quiet < 150; ) {
    const busy = await js(`window.__bursts.some((x) => !x.end)`);
    quiet = busy ? 0 : quiet + 25;
    await sleep(25);
  }
  const t0 = await js(expr);
  const t = performance.now();
  for (;;) {
    const st = await js(`(() => {
      const b = window.__bursts.filter((x) => x.start >= ${t0});
      const g = window.__gridT, grid = window.__grid();
      const reset = g.resetAt >= ${t0};
      const open = window.__bursts.some((x) => x.start >= ${t0} && !x.end);
      return { first: b[0] ?? null, open, reset, paint: g.paintAt, whole: g.wholeAt, isWhole: grid.whole, total: grid.total };
    })()`);
    const settled = st.first && st.first.end && !st.open && (!st.reset || (st.isWhole && (st.whole >= st.first.start || st.total <= 200)));
    if (settled) {
      return {
        ui: st.first.end - t0,
        fromQuery: st.first.end - st.first.start,
        engine: st.first.engine,
        queries: st.first.queries,
        paint: st.reset && st.paint ? st.paint - t0 : null,
        whole: st.reset && st.whole ? st.whole - t0 : null,
        debounced,
      };
    }
    // some actions rightly run no query at all (closing a card)
    if (!st.first && !st.open && !st.reset && performance.now() - t > 400) {
      return { ui: null, fromQuery: null, engine: null, queries: 0, paint: null, whole: null, debounced };
    }
    if (performance.now() - t > 20000) die(`action never settled: ${expr.slice(0, 80)} ${JSON.stringify(st)}`);
    await sleep(10);
  }
}

await send("Page.navigate", { url: start });
await waitFor(`window.__grid && window.__grid().whole && window.__grid().total > 1e6`, 60, "whole unfiltered result");
await sleep(1500);
await js(`document.querySelector('.panels').scrollIntoView()`);

const results = new Map(ACTIONS.map(([name]) => [name, []]));
for (let run = 0; run <= RUNS; run++) {
  for (const [name, expr, debounced] of ACTIONS) {
    const m = await measure(expr, debounced);
    if (run > 0) results.get(name).push(m);   // run 0 is the warm-up
    await sleep(250);
  }
}

const med = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const f = (x) => (x == null ? "—" : x.toFixed(0));
console.log(`${"action".padEnd(26)} ${"to settled".padStart(10)} ${"queries".padStart(8)} ${"engine".padStart(7)} ${"n".padStart(3)} ${"rows".padStart(6)} ${"whole".padStart(6)}   (ms, medians of ${RUNS})`);
let sumUi = 0, sumEngine = 0;
for (const [name, ms] of results) {
  const d = ms[0].debounced;
  const ui = med(ms.map((m) => m.ui)), q = med(ms.map((m) => m.fromQuery)), e = med(ms.map((m) => m.engine));
  sumUi += (d ? q : ui) ?? 0; sumEngine += e ?? 0;
  console.log(`${name.padEnd(26)} ${(f(ui) + (d ? "*" : "")).padStart(10)} ${f(q).padStart(8)} ${f(e).padStart(7)} ${String(ms[0].queries).padStart(3)} ${f(med(ms.map((m) => m.paint))).padStart(6)} ${f(med(ms.map((m) => m.whole))).padStart(6)}`);
}
console.log(`sum over the ${ACTIONS.length} actions: queries ${sumUi.toFixed(0)} ms, engine ${sumEngine.toFixed(0)} ms`);
console.log(`* includes the search box's 250 ms typing debounce; "queries" is first query sent -> last answered`);
clearTimeout(watchdog);
cleanUp();
process.exit(0);
