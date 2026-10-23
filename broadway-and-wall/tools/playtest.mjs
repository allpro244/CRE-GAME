// THE UI PLAYTEST BOT. Engine tests pass while real screens break: a lot
// valuation once printed $5.3M of phantom net worth on the land desk and was
// only found by hand-clicking it. This drives the single-file playable in
// headless Edge (or Chromium) over the DevTools protocol, the way a player
// does, clicking the real buttons where that is practical and calling a store
// action only where the UI path is not (a map click, a canvas). Every step is
// screenshotted to unreal/shots/playtest/ and every screen is checked.
//
//   pnpm playtest                       # build a fresh one-file playable from src, then play it
//   node tools/playtest.mjs --playable  # the committed playable/ instead of a fresh build
//   node tools/playtest.mjs --only land,island   # some flows
//   node tools/playtest.mjs --url http://127.0.0.1:8780/broadway-and-wall.html   # a server you run
//
// Flows: start (region start < 10 s), land (buy a farm, plat it through the
// desk, sell the lots; net worth honest every month), picker (the Build desk's
// product picker on a commercial lot), pages (every place and building-file
// tab), island (Pay ask on a building, take a counter if one comes, run a year).
//
// Every month it plays, the money is checked: the ledger balances (conserve's
// identity: Δcash == books + Δline + Δdeposits), nothing is NaN, and net worth
// does not jump by more than a tenth of the lots' builder bids with no cash in.
// A click that takes over 5 s to paint fails; a hung page reports its stack.
//
// The browser uses the machine's GPU: under software GL (--swiftshader, for a
// box without one) the 3D map makes every frame take seconds and the timings
// mean nothing. Developer tools: --profile-steps profiles the slow steps,
// --eval FILE runs a script in the page after the region starts (--profile FILE
// then profiles a second one). --budget S (300) skips flows once over time.
//
// Exit 0 when every flow passes, 1 when any assertion fails, 2 when the bot
// itself could not run. Not a CI gate: it is run by hand after a merge.
// (The app's own `pnpm --dir broadway-and-wall playtest` is the old engine
// playtest, test/playtest.mjs; the root `pnpm playtest` is this.)
import { spawn, execFileSync, execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, "..");
const ROOT = resolve(APP, "..");
const OUT = join(ROOT, "unreal", "shots", "playtest");
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 ? argv[i + 1] : d; };
const has = (n) => argv.includes("--" + n);
const ALL = ["start", "land", "picker", "pages", "island"];
const ONLY = (flag("only", "") || ALL.join(",")).split(",").filter(Boolean);
const SEED = Number(flag("seed", 7));
// the land loop needs the streets' equity: a plat runs $1-5M of horizontal, and the economy is dealt
// fresh every game, so the region opens with $10M (the setup page's Custom cash) rather than $2.5M
const REGION_CASH_M = Number(flag("cash", 10));
const W = 1600, H = 1000;
const BUDGET_S = Number(flag("budget", 300));
const T0 = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const secs = () => ((Date.now() - T0) / 1000).toFixed(0);
const log = (...a) => console.log(`[${secs().padStart(3)}s]`, ...a);

// ---------------------------------------------------------------- processes
const kids = [];
const profile = mkdtempSync(join(tmpdir(), "playtest-"));
function killAll() {
  for (const k of kids) {
    if (k.exitCode !== null || k.killed) continue;
    try {
      if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(k.pid), "/T", "/F"], { stdio: "ignore", timeout: 10000 });
      else k.kill("SIGKILL");
    } catch { /* gone */ }
  }
  // Edge lets go of its profile a moment after taskkill: retry for ~5 s so no temp profile is left behind
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); } catch { /* temp */ }
}
let finished = false;
const bail = (code, msg) => { if (msg) console.error(msg); killAll(); process.exit(code); };
process.on("SIGINT", () => bail(2, "interrupted"));
process.on("uncaughtException", (e) => bail(2, "bot crashed: " + (e?.stack ?? e)));
process.on("unhandledRejection", (e) => bail(2, "bot crashed: " + (e?.stack ?? e)));
// THE WHOLE RUN HAS A DEADLINE: a hung page must not hang the bot.
setTimeout(() => { if (!finished) { report(); bail(2, `OVER BUDGET: still running after ${BUDGET_S + 60} s`); } }, (BUDGET_S + 60) * 1000).unref();

// a fresh one-file playable from src (seconds), or the committed one
let url = flag("url", "");
if (!url) {
  let dir = join(APP, "playable");
  if (!has("playable")) {
    log("building a fresh one-file playable from src …");
    execSync("pnpm -s exec vite build --logLevel error" + (has("no-minify") ? " --minify false" : ""), { cwd: APP, stdio: "inherit", timeout: 240000 });
    execFileSync("node", ["package/build-onefile.mjs"], { cwd: APP, stdio: "ignore", timeout: 60000 });
    dir = join(APP, "dist");
  }
  const port = 8700 + Math.floor(Math.random() * 90);
  const srv = spawn(process.execPath, [join(ROOT, "unreal", "tools", "serve.mjs"), dir, String(port)], { stdio: "ignore" });
  kids.push(srv);
  url = `http://127.0.0.1:${port}/broadway-and-wall.html`;
  for (let i = 0; i < 40; i++) { try { if ((await fetch(url, { method: "HEAD" })).ok) break; } catch { /* not up */ } await sleep(150); }
}
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f.endsWith(".png")) try { unlinkSync(join(OUT, f)); } catch { /* locked */ }

const CHROME = process.env.BW_CHROME ?? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
].find((p) => existsSync(p));
if (!CHROME) bail(2, "no Edge or Chrome found; set BW_CHROME");
const dport = 9300 + Math.floor(Math.random() * 600);
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", "--hide-scrollbars", "--mute-audio", ...(has("swiftshader") ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : []),
  "--no-first-run", "--no-default-browser-check", `--window-size=${W},${H}`, `--user-data-dir=${profile}`, `--remote-debugging-port=${dport}`, "about:blank"], { stdio: "ignore" });
kids.push(chrome);

// ---------------------------------------------------------------- DevTools
let wsUrl;
for (let i = 0; i < 100 && !wsUrl; i++) {
  try { wsUrl = (await fetch(`http://127.0.0.1:${dport}/json/list`).then((r) => r.json())).find((t) => t.type === "page")?.webSocketDebuggerUrl; } catch { /* not up */ }
  if (!wsUrl) await sleep(150);
}
if (!wsUrl) bail(2, "the browser never opened its DevTools port");
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
let pageErrors = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === "Debugger.paused") pausedFrames = msg.params.callFrames;
  if (msg.method === "Runtime.exceptionThrown") {
    const d = msg.params.exceptionDetails;
    pageErrors.push((d.exception?.description ?? d.text ?? "exception").split("\n").slice(0, 3).join(" | "));
  }
};
const send = (method, params = {}, timeoutMs = 30000) => new Promise((res, rej) => {
  const n = ++id;
  const t = setTimeout(() => { pending.delete(n); rej(new Error(`${method} timed out after ${timeoutMs} ms`)); }, timeoutMs);
  pending.set(n, (m) => { clearTimeout(t); res(m.result ?? m); });
  ws.send(JSON.stringify({ id: n, method, params }));
});
// A HUNG PAGE SAYS WHERE IT HUNG: pause the debugger and read the stack.
let pausedFrames = null;
async function hangStack() {
  pausedFrames = null;
  try {
    await send("Debugger.enable", {}, 5000);
    await send("Debugger.pause", {}, 5000);
    for (let i = 0; i < 40 && !pausedFrames; i++) await sleep(100);
    const f = pausedFrames ?? [];
    // minified names say little: show the code around each frame (strings and property names survive)
    const src = new Map();
    const out = [];
    for (const c of f.slice(0, 10)) {
      let code = src.get(c.location.scriptId);
      if (code === undefined) { code = (await send("Debugger.getScriptSource", { scriptId: c.location.scriptId }, 10000).catch(() => ({})))?.scriptSource ?? ""; src.set(c.location.scriptId, code); }
      const line = code.split("\n")[c.location.lineNumber] ?? "";
      out.push(`${c.functionName || "(anon)"}@${c.location.lineNumber + 1}:${c.location.columnNumber} «${line.slice(Math.max(0, c.location.columnNumber - 60), c.location.columnNumber + 80)}»`);
    }
    await send("Debugger.resume", {}, 5000).catch(() => {});
    return "\n      " + out.join("\n      ");
  } catch (e) { return "no stack: " + e.message; }
}
/** Evaluate an async function body in the page; returns its value. */
const js = async (body, timeoutMs = 30000) => {
  let r;
  try {
    r = await send("Runtime.evaluate", { expression: `(async () => { ${body} })()`, awaitPromise: true, returnByValue: true }, timeoutMs);
  } catch (e) {
    throw new Error(`${e.message}; the page's thread is busy in: ${await hangStack()}`);
  }
  if (r.exceptionDetails) throw new Error("page eval: " + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).split("\n")[0]);
  return r.result?.value;
};
const S = (v) => JSON.stringify(v);
await send("Runtime.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });

// ---------------------------------------------------------------- page helpers
// Helpers installed in the page once per load: find a button by its words, a
// text scan for numbers that are not numbers.
const HELPERS = `
  window.__pt = {
    norm: (s) => (s || "").replace(/\\s+/g, " ").trim(),
    visible: (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; },
    buttons: (root) => [...(root || document).querySelectorAll("button, [role=tab], a.btn")].filter((b) => __pt.visible(b)),
    find: (re, root) => __pt.buttons(root).find((b) => re.test(__pt.norm(b.textContent)) && !b.disabled),
    findAny: (re, root) => __pt.buttons(root).find((b) => re.test(__pt.norm(b.textContent))),
    click: (re, root) => { const b = __pt.find(re, root); if (!b) return null; b.scrollIntoView({ block: "center" }); b.click(); return __pt.norm(b.textContent).slice(0, 80); },
    // NaN, undefined, Infinity as words in what is on screen
    bad: (root) => {
      const t = (root || document.body).innerText || "";
      const out = [];
      for (const m of t.matchAll(/(^|[^A-Za-z])(NaN|undefined|Infinity|\\[object Object\\])(?![A-Za-z])/g)) {
        out.push(t.slice(Math.max(0, m.index - 40), m.index + 50).replace(/\\s+/g, " "));
        if (out.length > 4) break;
      }
      return out;
    },
  };
  return true;`;

let flowName = "", stepN = 0;
const shots = [];
async function shot(name) {
  stepN++;
  const f = join(OUT, `${flowName}-${String(stepN).padStart(2, "0")}-${name}.png`);
  try {
    const s = await send("Page.captureScreenshot", { format: "png" }, 20000);
    writeFileSync(f, Buffer.from(s.data, "base64"));
  } catch (e) { log("screenshot failed:", e.message); }
  shots.push(f);
  return f;
}

// ---------------------------------------------------------------- results
const results = [];
let cur = null;
function check(ok, what, detail = "") {
  if (!cur) return ok;
  cur.checks++;
  if (!ok) {
    const f = shots.at(-1) ?? "";
    cur.fails.push({ what, detail: String(detail).slice(0, 600), shot: f });
    log(`  FAIL ${what}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
  }
  return ok;
}
/** Screenshot, then assert this screen threw nothing and shows no NaN. */
async function screen(name, rootSel) {
  await sleep(250);
  const f = await shot(name);
  const bad = await js(`return __pt.bad(${rootSel ? `document.querySelector(${S(rootSel)})` : "null"});`).catch(() => []);
  check(!bad?.length, `${name}: no NaN/undefined/Infinity on screen`, (bad ?? []).join(" ‖ "));
  if (pageErrors.length) { check(false, `${name}: no page exceptions`, pageErrors.join(" ‖ ")); pageErrors = []; }
  return f;
}
async function flow(name, fn) {
  if (!ONLY.includes(name)) return;
  if ((Date.now() - T0) / 1000 > BUDGET_S) { results.push({ name, checks: 0, fails: [{ what: "skipped: over the time budget", detail: "", shot: "" }], ms: 0, notes: [] }); return; }
  flowName = name; stepN = 0;
  cur = { name, checks: 0, fails: [], ms: 0, notes: [] };
  results.push(cur);
  const t = Date.now();
  log(`== ${name}`);
  try { await fn(); }
  catch (e) { await shot("crash"); check(false, "flow ran to the end", e.message); }
  if (pageErrors.length) { check(false, "no page exceptions", pageErrors.join(" ‖ ")); pageErrors = []; }
  cur.ms = Date.now() - t;
  log(`   ${cur.fails.length ? "FAIL" : "pass"} · ${cur.checks} checks · ${(cur.ms / 1000).toFixed(1)} s`);
  cur = null;
}
const note = (s) => { cur?.notes.push(s); log("  ·", s); };

function report() {
  console.log("\n================ PLAYTEST " + new Date().toISOString().slice(0, 16) + " · " + url);
  for (const r of results) {
    console.log(`${r.fails.length ? "FAIL" : "PASS"}  ${r.name.padEnd(8)} ${String(r.checks).padStart(3)} checks  ${(r.ms / 1000).toFixed(1).padStart(5)} s`);
    for (const n of r.notes) console.log(`        · ${n}`);
    for (const f of r.fails) console.log(`        ✗ ${f.what}${f.detail ? "\n            " + f.detail : ""}${f.shot ? "\n            " + f.shot : ""}`);
  }
  console.log(`screenshots: ${OUT}`);
  console.log(`total ${secs()} s`);
  writeFileSync(join(OUT, "summary.txt"), JSON.stringify(results, null, 1));
}

// ---------------------------------------------------------------- the game
const st = (expr) => js(`const s = window.__store.getState(), g = s.game; return (${expr});`);
async function load(q = "?ui=next") {
  pageErrors = [];
  await send("Page.navigate", { url: url + q });
  for (let i = 0; i < 120; i++) {
    const ok = await js(`return !!window.__store && [...document.querySelectorAll("button")].some((b) => /Break ground|New campaign|New game|Resume/.test(b.textContent));`).catch(() => false);
    if (ok) break;
    await sleep(250);
  }
  await js(HELPERS);
}
/** The start menu to a playing game, through the setup page, as a player would. */
async function newGame(cityName, seed, cashM) {
  await load();
  // the menu opens the setup page (a first-time player lands on it directly)
  // (the button is disabled while the page boots: keep trying until the setup page is up)
  for (let i = 0; i < 80; i++) {
    if (await js(`return !!__pt.find(/^Break ground/);`)) break;
    await js(`return __pt.click(/^(New campaign|New game)/);`);
    await sleep(250);
  }
  await sleep(300);
  await js(`const el = [...document.querySelectorAll("*")].filter((e) => e.childElementCount === 0 && e.textContent.trim() === ${S(cityName)}).pop(); el?.click(); return !!el;`);
  // typed into the setup page's own inputs (React reads the native setter)
  const type = (sel, v) => js(`const i = document.querySelector(${S(sel)}); if (!i) return false;
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(i, ${S(String(v))});
      i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); i.blur(); return true;`);
  if (seed) { await type("#setup-seed-in", seed); await sleep(150); }
  if (cashM) { await type("#setup-cash", cashM); await sleep(150); }
  await shot("setup");
  await js(`return __pt.click(/^Break ground/);`);
  const t = Date.now();
  let phase = "";
  while (Date.now() - t < 60000) {
    phase = await st(`s.phase`).catch(() => "");
    if (phase === "playing") break;
    const err = await st(`s.loadError`).catch(() => null);
    if (err) throw new Error("start failed: " + err);
    await sleep(200);
  }
  const ms = Date.now() - t;
  if (phase !== "playing") throw new Error(`start hung: ${phase} after 60 s`);
  await js(HELPERS);
  // quiet the cards so a modal does not sit over every screen; decisions stay on the pages
  await js(`const s = window.__store.getState(); s.setPopupsOff?.(true); s.setAlertsOff?.(true); return true;`);
  await sleep(500);
  return ms;
}
/** The player's money, read the way the HUD reads it. */
const money = () => st(`{ month: g.month, cash: g.cash + (g.fund?.cash ?? 0), nw: g.nwHistory?.at(-1) ?? null, nwLen: g.nwHistory?.length ?? 0,
  debt: Object.values(g.holdings).reduce((t, h) => t + (h.loan?.balance ?? 0), 0) }`);
/** Month on by the HUD's own Advance button (store action if the button is not on screen). */
async function advance(n = 1) {
  for (let i = 0; i < n; i++) {
    const m0 = await st(`g.month`);
    const clicked = await js(`return __pt.click(/^\\+1 mo$/, document.querySelector(".nx-hud") ?? undefined);`);
    if (!clicked) await js(`await window.__store.getState().advance({ quiet: true }); return true;`, 60000);
    for (let k = 0; k < 100; k++) { if ((await st(`g.month`)) > m0) break; await sleep(100); }
    // a month can open a card even with cards off (a ceremony, the year in review): close it
    await js(`const s = window.__store.getState(); s.dismissYearReview?.(); s.dismissDeliveryCeremony?.(); s.dismissExitCard?.(); s.dismissAlert?.(); return true;`);
  }
}

/** A developer's tool: profile one step and print where the page's time went (--profile-steps on the slow ones). */
async function profiled(label, fn) {
  await send("Profiler.enable"); await send("Profiler.setSamplingInterval", { interval: 500 }); await send("Profiler.start");
  const t = Date.now();
  try { return await fn(); } finally {
    const { profile } = await send("Profiler.stop", {}, 120000);
    console.log(`profiled ${label}: ${((Date.now() - t) / 1000).toFixed(1)} s`);
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    const parent = new Map();
    for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
    const self = new Map(), incl = new Map();
    const key = (n) => `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").slice(-2).join("/")}:${n.callFrame.lineNumber + 1}`;
    const dt = new Map();
    profile.samples.forEach((id, i) => dt.set(id, (dt.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)));
    for (const [id, us] of dt) {
      const n = byId.get(id); self.set(key(n), (self.get(key(n)) ?? 0) + us);
      const seen = new Set();
      for (let q = id; q !== undefined; q = parent.get(q)) { const k = key(byId.get(q)); if (seen.has(k)) continue; seen.add(k); incl.set(k, (incl.get(k) ?? 0) + us); }
    }
    const top = (m, n) => [...m].sort((x, y) => y[1] - x[1]).slice(0, n).map(([k, us]) => `${(us / 1000).toFixed(0).padStart(7)} ms  ${k}`).join("\n");
    console.log("SELF\n" + top(self, 20) + "\nINCLUSIVE\n" + top(incl, 45));
  }
}
const stepProfile = (label, fn) => (has("profile-steps") ? profiled(label, fn) : fn());

// ---------------------------------------------------------------- flows
let regionUp = false;
await flow("start", async () => {
  const ms = await newGame("Region (6 km)", SEED, REGION_CASH_M);
  regionUp = true;
  note(`region started in ${(ms / 1000).toFixed(1)} s · ${await st(`Object.keys(s.parcels).length`)} lots`);
  check(ms < 10000, "region start under 10 s", `${(ms / 1000).toFixed(1)} s`);
  await screen("playing");
  const hud = await js(`return __pt.norm(document.querySelector(".nx-hud, .topbar, header")?.innerText ?? "").slice(0, 400);`);
  check(/\bNW\b|Net worth/i.test(hud ?? ""), "HUD shows net worth", hud);
});

// ------------------------------------------------ land: a farm to lots, through the desk
/** A real mouse click at a page point. */
// A SCREEN THAT TAKES SECONDS TO ANSWER A CLICK IS BROKEN for a player, if not for a test.
const SLOW_MS = 5000;
function timed(what, ms) {
  if (ms > SLOW_MS) check(false, `"${what}" answers within ${SLOW_MS / 1000} s`, `${(ms / 1000).toFixed(1)} s`);
  else if (ms > 1500) note(`slow: "${what}" took ${(ms / 1000).toFixed(1)} s`);
}
const FRAME = "await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));";
async function mouseClick(x, y, what = "a click on the plat") {
  const t = Date.now();
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
    await send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", buttons: type === "mouseMoved" ? 0 : 1, clickCount: 1 }, 90000);
  }
  await js(FRAME, 90000);
  timed(what, Date.now() - t);
}
// the building file is the drawer that is not a place's
const fileDrawer = `[...document.querySelectorAll(".nx-drawer")].find((d) => !["Inbox", "Holdings", "Pipeline", "Market", "Capital", "City", "Saves", "Settings"].includes(d.getAttribute("aria-label")))`;
const drawer = (title) => title ? `[...document.querySelectorAll(".nx-drawer")].find((d) => (d.getAttribute("aria-label") || "").startsWith(${S(title)}))` : `document.querySelector(".nx-drawer")`;
/** Click a button by its words inside the open drawer(s) (or the page). Returns its text or null. */
const tap = async (re, scope = "") => {
  const r = await js(`const t = performance.now(); const hit = __pt.click(${re}, ${scope || "null"}); if (hit) { ${FRAME} } return { hit, ms: performance.now() - t };`, 90000);
  if (r.hit) timed(r.hit, r.ms);
  return r.hit;
};
/** The file footer's financing preset (Negotiation.tsx PresetPicker), set through its own select. */
const pickPreset = (v) => js(`const sel = (${fileDrawer})?.querySelector('select[aria-label="Lender"]');
  if (!sel) { window.__nextStore?.getState().setBuyPreset({ product: ${S(v)}, lev: 1 }); return false; }
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, ${S(v)});
  sel.dispatchEvent(new Event("change", { bubbles: true })); return true;`);
const errToast = async (since) => st(`s.toast && s.toast.kind !== "ok" && s.toast.at >= ${since} ? s.toast.text : null`).catch(() => null);
/** The ledger and the money, one month: what conserve.mjs checks, plus the net worth tape. */
const LEDGER = `
  const IN = ["noi", "sold", "interest", "borrowed", "lpCalled", "fees"], OUT = ["debtSvc", "leasing", "capex", "dev", "taxes", "bought", "ga", "lpDistributed"];
  let flows = 0; for (const y of g.books ?? []) { for (const k of IN) flows += y[k] ?? 0; for (const k of OUT) flows -= y[k] ?? 0; }
  let dep = 0; for (const h of Object.values(g.holdings ?? {})) for (const t of h.tenants ?? []) dep += t.deposit ?? 0;
  // money turned into property this month (a purchase, works in the ground) and what the firm owes
  let sunk = 0; for (const y of g.books ?? []) sunk += (y.dev ?? 0) + (y.bought ?? 0);
  let debt = (g.facility?.balance ?? 0) + (g.loc?.balance ?? 0); for (const h of Object.values(g.holdings ?? {})) debt += (h.loan?.balance ?? 0) + (h.mezz?.balance ?? 0);
  const nums = [g.cash, g.nwHistory?.at(-1), flows, g.loc?.balance ?? 0, dep, sunk, debt];`;
// The tape's net worth is struck at month end; after a deal mid-month it is stale against live cash.
// `live` reads the HUD's own NW readout instead (the same netWorth, to its three figures).
const snap = (live = false, parent = null) => js(`const s = window.__store.getState(), g = s.game; ${LEDGER}
  const hud = __pt.norm([...document.querySelectorAll(".nx-ro")].find((e) => /^NW/i.test(__pt.norm(e.querySelector(".nx-ro-label")?.textContent)))?.querySelector(".nx-fig")?.textContent);
  const m = /^([−-])?\\$?([\\d.,]+)([KMB])?/.exec(hud.replace(/\\u2060/g, ""));
  const hudNw = m ? (m[1] ? -1 : 1) * Number(m[2].replace(/,/g, "")) * ({ K: 1e3, M: 1e6, B: 1e9 }[m[3]] ?? 1) : null;
  return { m: g.month, cash: g.cash + (g.fund?.cash ?? 0), nw: ${live} && hudNw !== null ? hudNw : g.nwHistory?.at(-1) ?? null, flows, sunk, debt, platDone: !!g.plats?.[${S(parent)}]?.done, loc: g.loc?.balance ?? 0, dep, finite: nums.every(Number.isFinite), hud };`);
/** The lots' builder bids on this plat, in dollars: offers, contracts, else the desk's lot-sales line. */
const lotBids = (parent) => js(`const s = window.__store.getState(), g = s.game, P = s.parcels;
  const mine = Object.values(P).filter((r) => r.homeLot && r.block === ${S(parent)} && g.holdings[r.bbl]);
  const sf = mine.reduce((t, r) => t + r.lotArea, 0);
  const o = g.homes?.offers?.[${S(parent)}], c = g.homes?.contracts?.[${S(parent)}];
  return { lots: mine.length, bid: Math.max(o ? o.psf * sf : 0, c ? c.psf * sf : 0) };`);

/** One month on, and the money checked: the ledger balances, net worth moves with cash and an honest value change. */
async function monthChecked(ctx) {
  const a = ctx.last ?? await snap();
  const t0 = Date.now();
  await advance(1);
  ctx.advMs = (ctx.advMs ?? 0) + (Date.now() - t0); ctx.months = (ctx.months ?? 0) + 1;
  const b = await snap(false, ctx.parent);
  ctx.last = b;
  if (ctx.months % 6 === 0) log(`   month ${b.m} · ${((ctx.advMs) / ctx.months / 1000).toFixed(2)} s a month · NW ${(b.nw / 1e6).toFixed(2)}M · cash ${(b.cash / 1e6).toFixed(2)}M`);
  const dCash = b.cash - a.cash, dNw = b.nw - a.nw;
  const resid = dCash - (b.flows - a.flows) - (b.loc - a.loc) - (b.dep - a.dep);
  check(b.finite, `month ${b.m}: cash, net worth and books are finite`, JSON.stringify(b));
  check(Math.abs(resid) < 5, `month ${b.m}: the ledger balances (Δcash == books + Δline + Δdeposits)`, `residual ${resid.toFixed(0)} · Δcash ${dCash.toFixed(0)}`);
  const bids = ctx.parent ? (await lotBids(ctx.parent)).bid : 0;
  const ref = Math.max(bids || 0, Number.isFinite(ctx.lotSales) ? ctx.lotSales : 0);
  // THE HONEST CHANGE: cash, less what is owed, plus what was paid for property and works (carried at
  // cost). What is left is a re-mark: a building's month, a plat finishing — or a pump.
  const nonCash = dNw - (dCash - (b.debt - a.debt)) - (b.sunk - a.sunk);
  // the works the plat sank into the ground (carried at cost until the lots stand)
  if (!b.platDone) ctx.works = (ctx.works ?? 0) + Math.max(0, b.sunk - a.sunk);
  // THE MONTH A PLAT FINISHES the lots take their appraised marks in place of the works at cost: a real
  // gain or loss, which may differ from the desk's estimate at filing (the market moves in the years the
  // board and the streets take). It is allowed now and tested against the builders' own bids the first
  // month they bid: the lots may not be marked above what the builders will pay for them, less the
  // land and the works they cost (with the same 10% slack).
  const finishing = b.platDone && !a.platDone;
  const allow = finishing ? Math.max(0, ctx.deskProfit ?? 0, nonCash) : 0;
  if (finishing) ctx.finishGain = nonCash;
  if (ctx.finishGain !== undefined && !finishing && bids > 0) {
    const room = bids - (ctx.land ?? 0) - (ctx.works ?? 0) + 0.10 * bids;
    check(ctx.finishGain <= Math.max(room, Math.max(0, ctx.deskProfit ?? 0)), `month ${b.m}: the plat's completion mark is within the builders' bids`,
      `marked up ${(ctx.finishGain / 1e6).toFixed(2)}M at completion; builders bid ${(bids / 1e6).toFixed(2)}M against land ${((ctx.land ?? 0) / 1e6).toFixed(2)}M and works ${((ctx.works ?? 0) / 1e6).toFixed(2)}M`);
    ctx.finishGain = undefined;
  }
  ctx.tape.push({ m: b.m, dNw: Math.round(dNw), dCash: Math.round(dCash), dDebt: Math.round(b.debt - a.debt), sunk: Math.round(b.sunk - a.sunk), nonCash: Math.round(nonCash), ref: Math.round(ref) });
  // THE MONEY PUMP: net worth up by more than a tenth of what the builders bid for the lots, with no cash in
  const cap = allow + Math.max(0.10 * ref, 50000, (ctx.nwShare ?? 0) * Math.abs(b.nw));
  check(!(nonCash > cap), `month ${b.m}: net worth does not jump without cash (≤ 10% of the lots' builder bids)`,
    `ΔNW ${(dNw / 1e6).toFixed(2)}M · Δcash ${(dCash / 1e6).toFixed(2)}M · Δdebt ${((b.debt - a.debt) / 1e6).toFixed(2)}M · into property ${((b.sunk - a.sunk) / 1e6).toFixed(2)}M · re-mark ${(nonCash / 1e6).toFixed(2)}M against bids ${(ref / 1e6).toFixed(2)}M${allow ? ` and the desk's profit ${(allow / 1e6).toFixed(2)}M` : ""}`);
  const bad = await js(`return __pt.bad(document.querySelector(".nx-hud"));`);
  check(!bad.length, `month ${b.m}: no NaN in the HUD`, bad.join(" ‖ "));
  if (pageErrors.length) { check(false, `month ${b.m}: no page exceptions`, pageErrors.join(" ‖ ")); pageErrors = []; }
  return b;
}

await flow("land", async () => {
  if (!regionUp) { await newGame("Region (6 km)", SEED, REGION_CASH_M); regionUp = true; }
  // NEAR-TOWN TRACTS THAT ARE MOSTLY DRY LAND, nearest first; the file's Overview says whether a plat pencils
  const cands = await st(`Object.entries(s.parcels).filter(([b, r]) => r.ag && r.tract && !g.holdings[b] && (r.buildableSf ?? r.lotArea) / r.lotArea > 0.6)
    .sort((a, b) => a[1].tract.edgeM - b[1].tract.edgeM).slice(0, 10).map(([b]) => b)`);
  check(cands.length > 0, "the region has dry farm tracts by town");
  let bbl = null;
  let tries = 0;
  for (const b of cands) {
    tries++;
    // The first owner is rung from the file's Approach button. After a no, the rest are screened by
    // the same store action (seconds instead of a file opened per farm) and only a yes is opened.
    if (tries > 1) {
      await js(`window.__store.getState().approach(${S(b)}); return true;`);
      const ap = await st(`g.approaches[${S(b)}] ?? null`);
      if (!ap || ap.refused || ap.ask === undefined) { note(`${b}: ${!ap || ap.refused ? "the owner would not talk" : "the owner wants a blind bid"}`); continue; }
    }
    // the map click (a WebGL canvas) is the store's select; everything after is the file's own buttons
    await js(`window.__store.getState().select(${S(b)}); return true;`);
    await sleep(700);
    const ov = await js(`const d = ${fileDrawer}; return d ? __pt.norm(d.innerText) : "";`);
    const lots = Number(/Lots\s+(\d+)\s*×/.exec(ov)?.[1] ?? 0), resid = /Lot residual\s+\$?([\d.]+)K/.exec(ov);
    // a 3-acre neighbourhood park (platdesign.ts) takes about seventeen 7,500-sf lots' land: the
    // flow puts one down, so it wants a tract with room for the park and a plat around it
    if (lots < 40 || !resid) { note(`${b}: passed over (${lots} lots, residual ${resid?.[1] ?? "none"})`); continue; }
    await screen("tract-file");
    const since = Date.now();
    if (tries === 1) {
      await tap(`/^Approach$/`, fileDrawer);
      await sleep(400);
    }
    const ap = await st(`g.approaches[${S(b)}] ?? null`);
    if (!ap || ap.refused) { note(`${b}: the owner would not talk${ap ? "" : " (" + (await errToast(since)) + ")"}`); continue; }
    if (ap.ask === undefined) { note(`${b}: the owner wants a blind bid`); continue; }
    // THE NEGOTIATION PANEL (ui/next/Negotiation.tsx): the file is on Deal with their ask on the
    // ladder; "Buy at" puts the dial on it and the footer turns to the financing
    await screen("owner-ask");
    await tap(`/^Buy at /`, fileDrawer);
    await sleep(300);
    // all cash: the A&D lender will want the first lien when the streets go in (platdesign.ts)
    await pickPreset("cash");
    await screen("commit");
    const bought = await tap(`/^Buy at /`, fileDrawer);
    await pickPreset("cheapest");
    await sleep(600);
    if (!bought || !(await st(`!!g.holdings[${S(b)}]`))) { note(`${b}: could not close (${bought ? await errToast(since) : "Buy button disabled or missing"})`); continue; }
    note(`bought ${b} at the owner's ask ${(ap.ask / 1e3).toFixed(0)}K (${lots} lots on its default plat)`);
    // the file's Build tab opens the land desk, and the desk must agree with the Overview that a plat fits
    await tap(`/^Build$/`, fileDrawer);
    await sleep(1200);
    const nd = await js(`const d = document.querySelector(".land-desk"); return d ? (/no plat fits/.test(d.textContent) ? __pt.norm(d.textContent).slice(0, 160) : "") : null;`);
    if (nd === null) { await screen("no-desk"); check(false, "the Build tab opens the land development desk"); return; }
    if (nd) { await screen("not-developable"); check(false, "the land desk agrees with the file's Overview that a plat fits", `Overview: ${lots} lots × 7,500 sf; desk: ${nd}`); continue; }
    bbl = b; break;
  }
  if (!check(!!bbl, "bought a plattable farm tract through the file")) return;
  const ctx = { tape: [], parent: null, lotSales: 0, land: await st(`g.holdings[${S(bbl)}]?.costBasis ?? 0`) };
  await sleep(400);
  ctx.last = await snap(true);

  // THE LAND DEVELOPMENT DESK, open on the file's Build tab
  const desk = `document.querySelector(".land-desk")`;
  await screen("desk", ".land-desk");
  // a park: a toggle on the desk; the geometry sets it down where it serves most lots
  await tap(`/^Park/`, desk); await sleep(500);
  const park = await js(`const b = [...${desk}.querySelectorAll("button")].find((x) => /^Park/.test(__pt.norm(x.textContent))); return { on: b?.getAttribute("aria-pressed") === "true", land: ${desk}.querySelectorAll(".plat-park").length };`);
  await screen("park", ".land-desk");
  check(park.on && park.land > 0, "the park went down on the plat", JSON.stringify(park));
  // the A&D loan, all the desk offers
  await tap(`/^A&D loan$/`, desk); await sleep(200);
  await js(`${desk}.querySelector("details")?.setAttribute("open", ""); return true;`); await sleep(150);
  const strip = await js(`const o = {}; for (const r of ${desk}.querySelectorAll(".bd-kv tr")) o[__pt.norm(r.cells[0].textContent)] = __pt.norm(r.cells[1].textContent); return o;`);
  const M = (t) => { const m = /(−|-)?\$?([\d.,]+)\s*([KMBkmb])?/.exec(t ?? ""); return m ? (m[1] ? -1 : 1) * Number(m[2].replace(/,/g, "")) * ({ K: 1e3, M: 1e6, B: 1e9 }[m[3]?.toUpperCase()] ?? 1) : NaN; };
  ctx.lotSales = M(strip["Lot sales"]);
  ctx.deskProfit = M(await js(`return ${desk}.querySelector(".bd-big")?.textContent ?? "";`));
  note(`desk P&L: ${Object.entries(strip).map(([k, v]) => k + " " + v).join(" · ")}`);
  check(Object.keys(strip).length >= 6 && Object.values(strip).every((v) => v && !/NaN|undefined|Infinity/.test(v)), "the desk's P&L is all numbers", JSON.stringify(strip));
  await screen("financing", ".land-desk");
  let since = Date.now();
  const filed = await tap(`/^Rezone/`, `${fileDrawer}?.querySelector(".nx-actions")`);
  await sleep(500);
  if (!check(!!filed && await st(`!!g.entitlementApps?.[${S(bbl)}]`), "filed the rezoning from the desk", (await errToast(since)) ?? "no application on the books")) { await screen("not-filed"); return; }
  await screen("filed");

  // BEFORE THE BOARD: month by month, the money checked every month
  let rz = null, refusals = 0;
  for (let i = 0; i < 60 && !rz; i++) {
    if (i === 2) await stepProfile("a month before the board", () => monthChecked(ctx)); else
    await monthChecked(ctx);
    rz = await st(`g.rezoned?.[${S(bbl)}] ?? null`);
    const app = await st(`g.entitlementApps?.[${S(bbl)}] ?? null`);
    if (!rz && !app) {
      const refusedM = await st(`g.rezoneRefusedM?.[${S(bbl)}]`);
      if (refusedM === undefined) { check(false, "the board decided (granted or refused)"); break; }
      if (i === 0 || ctx.lastRefusal !== refusedM) { refusals++; ctx.lastRefusal = refusedM; note(`refused at month ${refusedM}; waiting out the bar`); await screen("refused"); }
      // the desk refuses a refile inside the bar; try it once the bar is out
      const m = await st(`g.month`);
      if (m - refusedM >= 12) {
        since = Date.now();
        await tap(`/^Rezone/`, `${fileDrawer}?.querySelector(".nx-actions")`); await sleep(400);
        check(await st(`!!g.entitlementApps?.[${S(bbl)}]`), "refiled once the refile bar was out", await errToast(since));
        await screen("refiled");
      }
    }
  }
  if (!check(!!rz, "the rezoning was granted within five years", `${refusals} refusal(s)`)) return;
  note(`rezoned ${rz.zone}${rz.lots ? ` · ${rz.lots} lots` : ""} after ${ctx.months} months, ${refusals} refusal(s)`);
  await screen("rezoned", ".land-desk");

  // THE STREETS
  since = Date.now();
  const built = await tap(`/^Build streets/`, `${fileDrawer}?.querySelector(".nx-actions")`);
  await sleep(500);
  const plat = await st(`g.plats?.[${S(bbl)}] ?? null`);
  if (!check(!!built && !!plat, "started the streets from the desk", (await errToast(since)) ?? (built ? "no plat on the books" : "Build streets missing or disabled: " + await js(`return __pt.norm(${fileDrawer}?.querySelector(".nx-actions")?.innerText ?? "");`)))) { await screen("streets-refused", ".land-desk"); return; }
  await screen("streets", ".land-desk");
  ctx.parent = bbl;
  for (let i = 0; i < 36; i++) {
    await monthChecked(ctx);
    if (await st(`!!g.plats?.[${S(bbl)}]?.done`)) break;
  }
  check(await st(`!!g.plats?.[${S(bbl)}]?.done`), "the streets finished within three years");
  const lb = await lotBids(bbl);
  note(`platted after ${ctx.months} months: ${lb.lots} lots are deeds`);
  check(lb.lots > 0, "the plat's lots are deeds on the books");

  // A LOT'S FILE: the lots desk (the builders' bids, their offers, listing the plat) on its Sell tab
  const lot = await st(`Object.values(s.parcels).find((r) => r.homeLot && r.block === ${S(bbl)} && g.holdings[r.bbl])?.bbl`);
  await js(`window.__store.getState().select(${S(lot)}); return true;`); await sleep(700);
  await tap(`/^Sell$/`, fileDrawer); await sleep(500);
  await screen("lot-file-sell");
  const lotsDesk = await js(`return /Bid · whole plat/.test(__pt.norm(${fileDrawer}?.innerText));`);
  check(lotsDesk, "a lot's file shows the lots desk (the builders' bids, offers, List) on its Sell tab");
  await js(`window.__store.getState().select(null); return true;`);

  // SELL: a builder's offer from Holdings › Land, else list the plat whole from a lot's card
  let sold = false, listTried = !lotsDesk;
  for (let i = 0; i < 8 && !sold; i++) {
    await js(`return __pt.click(/Holdings$/, document.querySelector(".nx-rail"));`); await sleep(400);
    await tap(`/^Land$/`, drawer("Holdings")); await sleep(500);
    if (i === 0) await screen("holdings-land");
    since = Date.now();
    if (await tap(`/^Take$/`, drawer("Holdings"))) {
      await sleep(300);
      await tap(`/^(Sure|Confirm|Take)/`, drawer("Holdings"));
      await sleep(400);
      sold = await st(`!!g.homes?.contracts?.[${S(bbl)}] || (g.homes?.pl?.[${S(bbl)}]?.lotsSold ?? 0) > 0`);
      note(sold ? "took a builder's offer from Holdings › Land" : `Take did nothing (${await errToast(since)})`);
      await screen("took-offer");
    } else if (i >= 2 && !listTried) {
      listTried = true;
      // no offer yet: list the plat whole, from a lot's own file
      await js(`window.__store.getState().select(${S(lot)}); return true;`); await sleep(700);
      await tap(`/^Sell$/`, fileDrawer); await sleep(500);
      const listed = await tap(`/^List whole/`, fileDrawer);
      await sleep(300);
      await screen("listed");
      if (listed) note(`no offer after ${i} months: listed the plat whole (${listed})`);
      check(!!listed && await st(`!!g.homes?.listings?.[${S(bbl)}]`), "listed the plat to the builders from a lot's file", listed ? await errToast(since) : "no List whole button (no bid today?)");
      await js(`window.__store.getState().select(null); return true;`);
      sold = !!listed;
    }
    if (!sold) await monthChecked(ctx);
  }
  check(sold, "sold or listed the lots within eight months of the plat");
  // and the months after: cash should come in as the lots close
  const cash0 = ctx.last.cash, sold0 = await st(`g.homes?.pl?.[${S(bbl)}]?.lotsSold ?? 0`);
  for (let i = 0; i < 6; i++) await monthChecked(ctx);
  const sold1 = await st(`g.homes?.pl?.[${S(bbl)}]?.lotsSold ?? 0`);
  note(`lots sold: ${sold0} → ${sold1}; cash ${(cash0 / 1e6).toFixed(2)}M → ${(ctx.last.cash / 1e6).toFixed(2)}M`);
  await screen("after-sales");
  const worst = [...ctx.tape].sort((a, b) => b.nonCash - a.nonCash)[0];
  note(`${ctx.months} months checked, ${(ctx.advMs / ctx.months / 1000).toFixed(2)} s a month; largest non-cash NW move ${(worst.nonCash / 1e6).toFixed(2)}M at month ${worst.m}`);
  writeFileSync(join(OUT, "land-tape.txt"), JSON.stringify(ctx.tape));
});

// ------------------------------------------------ the building file and the places
/** Every tab of the open building file, each checked. */
async function fileTabs(tag) {
  const tabs = await js(`const d = ${fileDrawer}; return d ? [...d.querySelectorAll(".nx-tabs [role=tab]")].map((t) => __pt.norm(t.textContent).replace(/\\d+$/, "")) : [];`);
  check(tabs.length > 0, `${tag}: the building file has tabs`);
  for (const t of tabs) {
    await tap(`/^${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\d*$/`, `${fileDrawer}?.querySelector(".nx-tabs")`);
    await sleep(300);
    await screen(`${tag}-file-${t.toLowerCase().replace(/\W+/g, "")}`);
  }
  return tabs;
}
/** Every place on the rail and every tab in it. */
async function places() {
  const rail = await js(`return [...document.querySelectorAll(".nx-rail .nx-rail-btn")].map((b) => __pt.norm(b.querySelector(".nx-rail-label")?.textContent)).filter((x) => x && x !== "Classic");`);
  const seen = [];
  for (const p of rail) {
    await js(`const b = [...document.querySelectorAll(".nx-rail .nx-rail-btn")].find((x) => __pt.norm(x.querySelector(".nx-rail-label")?.textContent) === ${S(p)}); b?.click(); return !!b;`);
    await sleep(500);
    const tabs = await js(`const d = ${drawer(p)}; return d ? [...d.querySelectorAll(".nx-tabs [role=tab]")].map((t) => __pt.norm(t.textContent).replace(/\\d+$/, "")) : [];`);
    if (!tabs.length) { await screen(`place-${p.toLowerCase()}`); seen.push(p); continue; }
    for (const t of tabs) {
      await tap(`/^${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\d*$/`, `${drawer(p)}?.querySelector(".nx-tabs")`);
      await sleep(400);
      await screen(`place-${p.toLowerCase()}-${t.toLowerCase().replace(/\W+/g, "")}`);
      seen.push(`${p} › ${t}`);
    }
  }
  await js(`window.__store.getState().setPage("none"); return true;`);
  return seen;
}

await flow("picker", async () => {
  if (!regionUp) { await newGame("Region (6 km)", SEED, REGION_CASH_M); regionUp = true; }
  // THE HIGHEST-DEMAND LARGE VACANT COMMERCIAL LOT the player can buy: large enough for the smallest
  // product (a pad, 0.4 ac; products.ts); the region's commercial dirt runs to about half an acre
  const lots = await st(`Object.values(s.parcels).filter((r) => r.class === "land" && !r.ag && /^C-/.test(r.zoneDist) && r.lotArea >= 17424 && !g.holdings[r.bbl])
    .map((r) => ({ b: r.bbl, d: r.demandScore + (g.blockD?.[r.block] ?? 0), ac: r.lotArea / 43560 })).sort((a, b) => b.d - a.d).slice(0, 8)`);
  check(lots.length > 0, "the region has vacant commercial lots big enough for a product (0.4 ac, a pad)");
  let bbl = null;
  for (const l of lots) {
    await js(`window.__store.getState().approach(${S(l.b)}); return true;`);
    const ap = await st(`g.approaches[${S(l.b)}] ?? null`);
    if (!ap || ap.refused || ap.ask === undefined) continue;
    await js(`window.__store.getState().select(${S(l.b)}); return true;`); await sleep(600);
    // the negotiation panel: "Buy at" sets the dial to their ask, then the same button closes on the preset
    await tap(`/^Buy at /`, fileDrawer); await sleep(300);
    if (!(await tap(`/^Buy at /`, fileDrawer))) continue;
    await sleep(500);
    if (await st(`!!g.holdings[${S(l.b)}]`)) { bbl = l.b; note(`bought ${l.b} (${l.ac.toFixed(1)} ac, demand ${l.d.toFixed(0)}) at ${(ap.ask / 1e6).toFixed(2)}M`); break; }
  }
  if (!check(!!bbl, "bought a large commercial lot through the file")) return;
  await tap(`/^Build$/`, fileDrawer); await sleep(800);
  await screen("build-desk");
  const use = await tap(`/^(Retail|Industrial)$/`, fileDrawer); await sleep(400);
  const prods = await js(`const sec = [...${fileDrawer}.querySelectorAll(".bd-row")].find((x) => __pt.norm(x.querySelector(".bd-k")?.textContent) === "Type");
    return sec ? [...sec.querySelectorAll("button")].map((b) => __pt.norm(b.textContent)).filter((t) => t !== "Street") : [];`);
  note(`${use ?? "no retail or industrial button"}: products ${prods.join(", ") || "none"}`);
  check(prods.length > 0, "the Build desk offers product types on a large commercial lot", use ? `use ${use}` : "no Retail/Industrial use button");
  if (!prods.length) return;
  await tap(`/^${prods[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$/`, fileDrawer); await sleep(600);
  const site = await js(`const det = ${fileDrawer}?.querySelector(".build-desk details"); if (!det) return null; det.setAttribute("open", "");
    const rows = [...det.querySelectorAll(".bd-kv tr")].map((r) => [__pt.norm(r.cells[0].textContent), __pt.norm(r.cells[1].textContent)]);
    return rows.some(([k]) => k === "Site") ? { head: "Site plan", rows } : null;`);
  await screen("site-plan");
  if (!check(!!site, "the site plan renders for the product", prods[0])) return;
  note(`${site.head}: ${site.rows.map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  const blank = site.rows.filter(([, v]) => !v || !/\d/.test(v) || /NaN|undefined|Infinity/.test(v));
  check(site.rows.length >= 3 && !blank.length, "every site-plan row is a number", JSON.stringify(blank));
  // the footer builds the scheme the desk is set to, not the sweep's top row
  const foot = await js(`return __pt.norm(${fileDrawer}?.querySelector(".nx-actions")?.textContent ?? "");`);
  note(`footer: ${foot}`);
  check(foot.includes(prods[0]), "the footer offers the product the desk is set to", foot);
  // the leverage, the tier and the look: each one choice, each repriced
  for (const t of ["Half", "Premium", "Brick"]) { await tap(`/^${t}$/`, fileDrawer); await sleep(400); }
  await screen("build-choices");
});

await flow("pages", async () => {
  if (!regionUp) { await newGame("Region (6 km)", SEED, REGION_CASH_M); regionUp = true; }
  const seen = await places();
  note(`${seen.length} screens: ${seen.join(", ")}`);
  // Holdings › Land appears with the land game (places.ts hasLand): a tract, an application, a plat, lots
  const landGame = await st(`!!(g.entitlementApps || g.plats || g.rezoned || g.homes?.offers || g.homes?.contracts) || Object.keys(g.holdings).some((b) => !!s.parcels[b]?.tract)`);
  check(!landGame || seen.some((x) => /^Holdings › Land/.test(x)), "Holdings has a Land tab once the firm is in the land game");
  // the building file on a deed you own (a lot, a tract, the picker's lot) and on one you do not
  const mine = await st(`Object.keys(g.holdings)[0] ?? null`);
  if (mine) { await js(`window.__store.getState().select(${S(mine)}); return true;`); await sleep(600); note(`own deed ${mine}: ${(await fileTabs("own")).join(", ")}`); }
  const other = await st(`Object.values(s.parcels).find((r) => r.bldgArea > 20000 && !g.holdings[r.bbl])?.bbl ?? null`);
  if (other) { await js(`window.__store.getState().select(${S(other)}); return true;`); await sleep(600); note(`other's building ${other}: ${(await fileTabs("other")).join(", ")}`); }
  await js(`window.__store.getState().select(null); return true;`);
});

await flow("island", async () => {
  regionUp = false;
  const ms = await newGame("Somewhere else", SEED);
  note(`island started in ${(ms / 1000).toFixed(1)} s · ${await st(`Object.keys(s.parcels).length`)} lots`);
  await screen("playing");
  // BUY A BUILDING AT ASK: Market, Pay ask on the row, Confirm
  await js(`return __pt.click(/Market$/, document.querySelector(".nx-rail"));`); await sleep(600);
  await tap(`/^For sale$/`, drawer("Market")); await sleep(500);
  await screen("market");
  const cash = await st(`g.cash`);
  // the first row the firm can carry: the table is sorted by yield; take one priced under the cash
  const row = await js(`const d = ${drawer("Market")}; if (!d) return null;
    const btns = [...d.querySelectorAll("button")].filter((b) => __pt.norm(b.textContent) === "Pay ask");
    const ok = btns.find((b) => { const m = /\\$([\\d.]+)([KM])/.exec(b.title || ""); if (!m) return false; const v = Number(m[1]) * (m[2] === "M" ? 1e6 : 1e3); return v < ${cash} * 2.5; });
    if (!ok) return null; ok.scrollIntoView({ block: "center" }); ok.click(); return ok.title;`);
  if (!check(!!row, "Market › For sale has a building the firm can afford with a loan", `cash ${(cash / 1e6).toFixed(2)}M`)) return;
  await sleep(600);
  await screen("agreed");
  const bbl = await st(`s.selectedBBL`);
  const since = Date.now();
  // A SELLER WHO WANTS MORE THAN THE ASK COUNTERS (acquire.ts reservation, a firm market): the
  // negotiation panel says so and its primary move is to take their number
  const countered = await st(`!!g.talks?.[${S(bbl)}] && !g.talks[${S(bbl)}].agreed ? g.talks[${S(bbl)}].theirPrice : 0`);
  if (countered) {
    note(`Pay ask was countered at ${(countered / 1e6).toFixed(2)}M: took it`);
    await screen("countered");
    await tap(`/^Take /`, fileDrawer); await sleep(600);
  }
  await tap(`/^Confirm$/`, fileDrawer); await sleep(800);
  const owned = await st(`!!g.holdings[${S(bbl)}]`);
  await screen("bought");
  if (!check(owned, "bought a building from Market › Pay ask (Take a counter, Confirm)", `${row} · ${await errToast(since) ?? "not on the books"}`)) return;
  note(`bought ${bbl} at ${row}`);
  note(`file tabs: ${(await fileTabs("island")).join(", ")}`);
  await js(`window.__store.getState().select(null); return true;`);
  // A YEAR, month by month
  // a building re-marks every month; more than 3% of net worth in a month with no cash is a jump
  const ctx = { tape: [], nwShare: 0.03 };
  await sleep(400);
  ctx.last = await snap(true);
  for (let i = 0; i < 12; i++) await monthChecked(ctx);
  await screen("year-later");
  check(await st(`!!g.holdings[${S(bbl)}]`), "still owns the building a year on");
  note(`12 months at ${(ctx.advMs / ctx.months / 1000).toFixed(2)} s · NW ${(ctx.last.nw / 1e6).toFixed(2)}M`);
});

if (has("eval")) {
  if (!regionUp) { await newGame("Region (6 km)", SEED, REGION_CASH_M); regionUp = true; }
  const { readFileSync } = await import("node:fs");
  console.log(JSON.stringify(await js(readFileSync(flag("eval"), "utf8"), 120000), null, 1));
  await shot("eval");
  // a developer's tool: profile one more script and print where the time went
  if (has("profile")) await profiled("--profile", async () => console.log(JSON.stringify(await js(readFileSync(flag("profile"), "utf8"), 180000), null, 1)));
}

finished = true;
report();
const failed = results.some((r) => r.fails.length);
killAll();
process.exit(failed ? 1 : 0);
