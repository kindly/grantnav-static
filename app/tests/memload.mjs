// MEMLOAD: load the whole 1.52M-row result repeatedly and report load time,
// the page's ArrayBuffer memory and Chrome's peak RSS. Dev server only (uses
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

const PORT = 9338;
const url = process.argv[2] ?? "http://127.0.0.1:5190/";
const outDir = new URL(process.env.MOBILE ? "../../build/shots-app-mobile/" : "../../build/shots-app/", import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// disk-backed: the profile holds the 357 MB image in OPFS, and /tmp is RAM
const profileRoot = new URL("../../build/", import.meta.url).pathname;
const profile = process.env.FRESH ? mkdtempSync(join(profileRoot, "chrome-app-")) : join(profileRoot, "chrome-mem-profile");

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
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const i = ++id;
  pending.set(i, { res, rej });
  ws.send(JSON.stringify(sessionId ? { id: i, method, params, sessionId } : { id: i, method, params }));
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
let peak = 0;
const sampler = setInterval(() => { peak = Math.max(peak, rss()); }, 100);
const loads = [];
for (const qs of ["", "?region=London", "", "?year=2022&year=2023", ""]) {
  // DICT=all adds the dev-only ?dict=all switch (facetful stage-2 encoding)
  const q2 = process.env.DICT ? (qs ? `${qs}&dict=${process.env.DICT}` : `?dict=${process.env.DICT}`) : qs;
  await send("Page.navigate", { url: url + q2 });
  await sleep(300);
  const ms = await waitFor(`/all in memory/.test(document.querySelector('.grid h3 .ms')?.textContent ?? '') && document.querySelector('.grid h3 .ms').textContent`, 60, "whole");
  await sleep(500);
  const before = (await send("Runtime.getHeapUsage")).backingStorageSize ?? 0;
  await send("HeapProfiler.enable");
  await send("HeapProfiler.collectGarbage");
  const h = await send("Runtime.getHeapUsage");
  // the engine's worker: wasm linear memory, i.e. its high-water (facetful > 0.5.1)
  const wasm = await js(`window.__db().then((d) => d.memoryStats ? d.memoryStats().then((m) => m.wasmBytes) : null)`);
  const wk = wasm == null ? "worker wasm n/a (facetful without memoryStats)" : `worker wasm ${(wasm / 1e6).toFixed(0).padStart(4)} MB`;
  if (process.env.SHOWROW) console.log("   first row:", await js(`[...document.querySelectorAll('.grows .grow:not([hidden])')].slice(0, 2).map((r) => r.textContent.trim().slice(0, 150)).join(" || ")`));
  const line = `${(qs || "all").padEnd(22)} ${ms.trim().padEnd(40)} page ArrayBuffers ${(before / 1e6).toFixed(0).padStart(4)} -> ${((h.backingStorageSize ?? 0) / 1e6).toFixed(0).padStart(4)} MB after GC  ${wk}  chrome rss ${rss()} MB`;
  console.log(line);
}
clearInterval(sampler);
{
  const out = execSync(`ps -o rss=,args= -u ${process.getuid()}`).toString().split("\n").filter((l) => l.includes(profile));
  const by = {};
  for (const l of out) {
    const type = /--type=([\w-]+)/.exec(l)?.[1] ?? "browser";
    const sub = /--utility-sub-type=([\w.]+)/.exec(l)?.[1];
    const k = sub ? `${type}:${sub.split(".").pop()}` : type;
    by[k] = (by[k] ?? 0) + parseInt(l) / 1024;
  }
  console.log("rss by process type (MB):", Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(", "));
}
console.log(`peak chrome rss over the run: ${peak} MB`);
clearTimeout(watchdog);
cleanUp();
process.exit(0);
