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

const PORT = 9336;
const url = process.argv[2] ?? "http://127.0.0.1:5190/";
const outDir = new URL(process.env.MOBILE ? "../../build/shots-app-mobile/" : "../../build/shots-app/", import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// disk-backed: the profile holds the 357 MB image in OPFS, and /tmp is RAM
const profileRoot = new URL("../../build/", import.meta.url).pathname;
const profile = process.env.FRESH ? mkdtempSync(join(profileRoot, "chrome-app-")) : join(profileRoot, "chrome-app-profile");

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
const watchdog = setTimeout(() => die("exceeded 300 s"), 300_000);
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

const gridState = `(() => {
  const rows = [...document.querySelectorAll('.grows .grow:not([hidden])')];
  const hs = rows.map((r) => r.getBoundingClientRect().height);
  return {
    n: rows.length,
    tallest: Math.max(0, ...hs),
    first: rows[0]?.querySelector('.c-grant')?.textContent ?? '',
    sub: document.querySelector('.grid h3 .sub')?.textContent.trim(),
    ms: document.querySelector('.grid h3 .ms')?.textContent.trim(),
    tall: parseFloat(document.querySelector('.tall')?.style.height),
  };
})()`;

await waitFor(`document.querySelectorAll('.grows .grow:not([hidden])').length > 5`, 60, "first rows");
await sleep(800);
let g = await js(gridState);
check("unfiltered grid paints rows", g.n > 10, `${g.n} rows, ${g.sub}`);
check("one line per grant", g.tallest <= 36, `tallest row ${g.tallest}px`);
const allIn = await waitFor(`/all in memory/.test(document.querySelector('.grid h3 .ms')?.textContent ?? '') && document.querySelector('.grid h3 .ms').textContent`, 60, "whole 1.52M result");
check("unfiltered 1.52M result lands whole in memory", true, allIn.trim());
check("spacer capped under browser limit", g.tall <= 15_000_000, `${g.tall}px`);
check("five facets + year chart", (await js(`document.querySelectorAll('.facet').length`)) === 4 && (await js(`document.querySelectorAll('.chart .yr').length`)) > 5);
await shot("1-initial.png");

// drag to the middle of 1.52M rows: must land, not stay blank
const before = g.first;
await js(`(() => { const s = document.querySelector('.scroller'); s.scrollTop = s.scrollHeight / 2; })()`);
await sleep(1200);
g = await js(gridState);
check("mid-scroll drag lands on new rows", g.n > 10 && g.first !== before, `${g.sub}`);
check("readout near the middle", /rows 7\d\d,\d\d\d/.test(g.sub), g.sub);
await shot("2-scrolled-middle.png");

// wheel in scaled mode moves by rows
await js(`document.querySelector('.grid').scrollIntoView()`);
await sleep(300);
const r0 = await js(`document.querySelector('.grid h3 .sub').textContent`);
const box = await js(`(() => { const r = document.querySelector('.grows').getBoundingClientRect(); return { x: r.x + 200, y: r.y + 100 }; })()`);
await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: box.x, y: box.y, deltaX: 0, deltaY: 300 });
await sleep(600);
const r1 = await js(`document.querySelector('.grid h3 .sub').textContent`);
check("wheel moves the grid", r0 !== r1, `${r0.match(/rows [\d,]+/)?.[0]} -> ${r1.match(/rows [\d,]+/)?.[0]}`);

// opening a grant must not move the grid or reload anything: the URL gains
// ?grant= but the result is the same (it used to rewind to the top)
{
  const before = await js(`document.querySelector('.grid h3 .sub').textContent`);
  const top0 = await js(`document.querySelector('.scroller').scrollTop`);
  const nq = await js(`window.__qlog ? window.__qlog.length : -1`);
  await js(`document.querySelectorAll('.grows .grow .g-title')[3].click()`);
  await waitFor(`document.querySelector('.sheet h2')?.textContent`, 10, "grant sheet");
  await sleep(800);
  const during = await js(`document.querySelector('.grid h3 .sub').textContent`);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(800);
  const after = await js(`document.querySelector('.grid h3 .sub').textContent`);
  const top1 = await js(`document.querySelector('.scroller').scrollTop`);
  const closed = await js(`!document.querySelector('.sheet')`);
  const nq2 = await js(`window.__qlog ? window.__qlog.length : -1`);
  const rows = (t) => t.match(/rows [\d,]+–[\d,]+/)?.[0];
  check("opening a grant keeps the grid where it was", rows(before) === rows(during) && rows(during) === rows(after) && top0 === top1 && closed,
    `${rows(before)} -> ${rows(during)} -> ${rows(after)}, scrollTop ${Math.round(top0)} -> ${Math.round(top1)}, sheet closed ${closed}`);
  if (nq >= 0) check("opening and closing a grant costs one query", nq2 - nq <= 2, `${nq2 - nq} queries (the grant lookup)`);
}

// search: small result should arrive whole
await send("Page.navigate", { url: url + "?q=dementia" });
await waitFor(`/all in memory/.test(document.querySelector('.grid h3 .ms')?.textContent ?? '')`, 60, "whole result");
g = await js(gridState);
const blurbs = await js(`[...document.querySelectorAll('.grows .blurb')].filter((b) => b.textContent.trim()).length`);
check("rows carry a description blurb", blurbs > 5, `${blurbs} rows with a blurb`);
check("small result held whole", true, `${g.sub} · ${g.ms}`);
await js(`(() => { const s = document.querySelector('.scroller'); s.scrollTop = s.scrollHeight; })()`);
await sleep(400);
g = await js(gridState);
check("scroll to end shows last rows", /–[\d,]+$/.test(g.sub) && g.n > 5, g.sub);
await shot("3-search-end.png");
await js(`document.querySelector('.scroller').scrollTop = 0`);
await sleep(300);

// hover peek shows a full description (desktop only: touch has no hover, a tap opens the grant)
if (!MOBILE) {
await js(`document.querySelector('.grid').scrollIntoView()`);
await sleep(300);
const row = await js(`(() => { const r = document.querySelectorAll('.grows .grow .g-title')[2].getBoundingClientRect(); return { x: r.x + Math.min(40, r.width / 2), y: r.y + r.height / 2 }; })()`);
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: row.x, y: row.y });
await sleep(150);
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: row.x + 4, y: row.y });
const peek = await waitFor(`document.querySelector('.peek')?.textContent`, 5, "peek");
check("hover peek appears", peek.length > 40, peek.slice(0, 90) + "…");
await shot("4-peek.png");
}

// the find-a-funder box filters the full list in the page, with no query
{
  const nq = await js(`window.__qlog ? window.__qlog.length : -1`);
  await js(`(() => { const i = document.querySelector('.facet .find'); i.value = 'sport'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(400);
  const labels = await js(`[...document.querySelectorAll('.panels .facet')[0].querySelectorAll('.row .label')].map((l) => l.textContent)`);
  const nq2 = await js(`window.__qlog ? window.__qlog.length : -1`);
  check("find-a-funder filters the list without a query", labels.length > 0 && labels.every((l) => /sport/i.test(l)) && (nq < 0 || nq2 === nq), `${labels.length} funders: ${labels.slice(0, 3).join(", ")}…`);
  await js(`(() => { const i = document.querySelector('.facet .find'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(200);
}

// facet click narrows, chip appears
await js(`document.querySelectorAll('.facet')[1].querySelector('.row').click()`);
await sleep(1500);
const chips = await js(`[...document.querySelectorAll('.chip')].map((c) => c.textContent.trim())`);
check("facet click adds a filter chip", chips.length === 2 && /Amount/.test(chips[1]), chips.join(" | "));

// open a grant: only the title is the link now; the rest of the row is inert
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 });
await sleep(300);
await js(`document.querySelectorAll('.grows .grow')[0].querySelector('.c-date').click()`);
await sleep(400);
check("clicking the plain part of a row opens nothing", await js(`!document.querySelector('.sheet')`));
await js(`document.querySelectorAll('.grows .grow .g-title')[0].click()`);
const sheet = await waitFor(`document.querySelector('.sheet h2')?.textContent`, 10, "grant sheet");
check("grant title opens its card", sheet.length > 3, sheet.slice(0, 80));
check("grant title is underlined", await js(`getComputedStyle(document.querySelector('.grows .g-title[href]')).textDecorationLine.includes('underline')`));
await shot("5-grant.png");
await js(`document.querySelector('.sheet .close').click()`);
await sleep(500);

if (!MOBILE) {
  // hovering a recipient shows its figures
  const rec = await js(`(() => { const a = [...document.querySelectorAll('.grows .c-rec a[href]')][1]; const r = a.getBoundingClientRect(); return { x: r.x + Math.min(30, r.width / 2), y: r.y + r.height / 2, name: a.textContent }; })()`);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rec.x, y: rec.y });
  await sleep(120);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rec.x + 3, y: rec.y });
  const orgPeek = await waitFor(`(() => { const p = document.querySelector('.peek'); return p && /Grants/.test(p.textContent) && p.textContent; })()`, 5, "recipient peek");
  check("hovering a recipient shows its figures", orgPeek.includes(rec.name), orgPeek.replace(/\s+/g, " ").slice(0, 110));
  await shot("6-recipient-peek.png");
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 });
  await sleep(200);
}

// funder card: figures, year chart, top recipients, then onward to a recipient.
// From an unfiltered page, so "add to filters" should leave exactly the
// recipient's own grants (cards count across all grants, whatever the filters).
await send("Page.navigate", { url });
await waitFor(`document.querySelectorAll('.grows .c-fund a[href]').length > 5`, 60, "unfiltered grid");
await sleep(800);
const funder = await js(`document.querySelector('.grows .c-fund a[href]').textContent`);
await js(`document.querySelector('.grows .c-fund a[href]').click()`);
await waitFor(`/Funder/.test(document.querySelector('.sheet .kind')?.textContent ?? '') && document.querySelectorAll('.sheet .figures > div').length === 5`, 15, "funder card");
const fc = await js(`({
  name: document.querySelector('.sheet h2').textContent,
  n: document.querySelector('.sheet .figures b.grants').textContent,
  bars: document.querySelectorAll('.sheet svg.years .bar').length,
  top: document.querySelectorAll('.sheet ol.bars')[0]?.children.length ?? 0,
})`);
check("funder card: name, figures, year chart, top recipients", fc.name === funder && fc.bars > 0 && fc.top > 0, `${fc.name}: ${fc.n} grants, ${fc.bars} year bars, ${fc.top} top recipients`);
check("funder card is in the URL", await js(`new URLSearchParams(location.search).get('f') === ${JSON.stringify(funder)}`));
await shot("7-funder.png");

const toRec = await js(`document.querySelector('.sheet ol.bars a.org')?.textContent ?? ''`);
if (toRec) {
  await js(`document.querySelector('.sheet ol.bars a.org').click()`);
  await waitFor(`/Recipient/.test(document.querySelector('.sheet .kind')?.textContent ?? '') && document.querySelector('.sheet h2')?.textContent === ${JSON.stringify(toRec)} && document.querySelectorAll('.sheet .figures > div').length === 5`, 15, "recipient card");
  check("a top recipient opens the recipient's card", true, toRec);
  await shot("8-recipient.png");

  // the button narrows the grid to exactly that recipient's grants
  const rn = await js(`document.querySelector('.sheet .figures b.grants').textContent`);
  await js(`document.querySelector('.sheet button.filter').click()`);
  await waitFor(`!document.querySelector('.sheet') && document.querySelector('.grid h3 .sub')?.textContent.startsWith(${JSON.stringify(rn)} + ' grant')`, 15, "recipient filter");
  const chipTexts = await js(`[...document.querySelectorAll('.chip')].map((c) => c.textContent.trim())`);
  check("add-to-filters closes the card and filters the grid", chipTexts.some((c) => c.includes("Recipient") && c.includes(toRec)), `${rn} grants · ${chipTexts.join(" | ")}`);
}

console.log(`\n--- console ---\n${logs.filter((l) => !/vite|hmr/i.test(l)).slice(0, 20).join("\n")}`);
clearTimeout(watchdog);
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
cleanUp();
process.exit(failures ? 1 : 0);
