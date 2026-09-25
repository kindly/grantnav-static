// STRESS: drag-scroll the grid hard at several result sizes and report any
// point where the rows stop following the scrollbar. Dev server only (uses
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

const PORT = 9337;
const url = process.argv[2] ?? "http://127.0.0.1:5190/";
const outDir = new URL(process.env.MOBILE ? "../../build/shots-app-mobile/" : "../../build/shots-app/", import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// disk-backed: the profile holds the 357 MB image in OPFS, and /tmp is RAM
const profileRoot = new URL("../../build/", import.meta.url).pathname;
const profile = process.env.FRESH ? mkdtempSync(join(profileRoot, "chrome-app-")) : join(profileRoot, "chrome-stress-profile");

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


const { execSync } = await import("node:child_process");
const rss = () => {
  try {
    const out = execSync(`ps -o rss=,args= -u ${process.getuid()}`).toString();
    return Math.round(out.split("\n").filter((l) => l.includes(profile)).reduce((a, l) => a + parseInt(l), 0) / 1024);
  } catch { return -1; }
};
const CASES = (process.env.CASES ?? "year=2018,year=2022,region=London,year=2022&year=2023,").split(",");
const SORTS = (process.env.SORTS ?? "date_desc,recipient_asc").split(",");
let stuck = 0;
for (const c of CASES) for (const sort of SORTS) {
  const qs = [c, sort === "date_desc" ? "" : `sort=${sort}`, process.env.WHOLE ? `whole=${process.env.WHOLE}` : ""].filter(Boolean).join("&");
  await send("Page.navigate", { url: url + (qs ? `?${qs}` : "") });
  await sleep(500);
  await waitFor(`window.__grid && window.__grid().total > 0 && window.__grid().rendered.last > 0`, 60, "grid");
  await sleep(2500); // let the whole-result load land where it applies
  await js(`window.__qlog.length = 0; document.querySelector('.grid').scrollIntoView()`);
  const g0 = await js(`window.__grid()`);
  const label = `${(c || "all").padEnd(20)} ${sort.padEnd(14)} ${String(g0.total).padStart(8)} ${g0.whole ? "whole" : "paged"}`;
  const settles = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let d = 0; d < 6; d++) {
    let f = rnd();
    // even drags are fast flicks; odd ones are slow, steady drags with steps
    // longer than a page query, the pattern that used to starve every fetch
    const slow = d % 2 === 1;
    for (let k = 0; k < (slow ? 15 : 25); k++) {
      f = Math.min(1, Math.max(0, f + (slow ? 0.004 : (rnd() - 0.5) * 0.08)));
      await js(`(() => { const s = document.querySelector('.scroller'); s.scrollTop = ${f} * (s.scrollHeight - s.clientHeight); })()`);
      await sleep(slow ? 200 : 30);
    }
    const t = performance.now();
    let ok = false, st;
    while (performance.now() - t < 8000) {
      st = await js(`window.__grid()`);
      const maxFirst = Math.max(0, st.total - st.pool);
      if (Math.abs(st.rendered.first - Math.min(st.expect, maxFirst)) <= 1) { ok = true; break; }
      await sleep(50);
    }
    if (ok) settles.push(performance.now() - t);
    else { stuck++; console.log(`STUCK ${label} drag ${d}: ${JSON.stringify(st)}`); break; }
  }
  const q = await js(`window.__qlog.map((x) => [x.wall, x.engine, x.sql.slice(0, 40)])`);
  const maxWall = Math.max(0, ...q.map((x) => x[0])), maxEng = Math.max(0, ...q.map((x) => x[1]));
  const heap = (await send("Runtime.getHeapUsage")).usedSize / 1e6;
  console.log(`${label}  settle max ${Math.max(0, ...settles).toFixed(0).padStart(5)} ms  queries ${String(q.length).padStart(3)}  worst wall ${maxWall.toFixed(0).padStart(5)} / engine ${maxEng.toFixed(0).padStart(5)} ms  js heap ${heap.toFixed(0)} MB  chrome rss ${rss()} MB`);
}
console.log(stuck ? `\n${stuck} STUCK` : "\nnever stuck");
clearTimeout(watchdog);
cleanUp();
process.exit(stuck ? 1 : 0);
