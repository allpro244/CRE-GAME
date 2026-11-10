// THE COMMITTED PLAYABLE MUST OPEN.
//
// From 3a1da0c (2026-10-28) to #557 the one-file playable threw on load —
// "Cannot set properties of undefined (setting 'read')", a module cycle the
// browser bundle initialised out of order — and every check stayed green,
// because none of them opened the page: the engine harnesses load
// test/.engine.mjs, which bundles the same modules in a different order.
// This opens playable/broadway-and-wall.html in headless Chrome, waits for the
// setup screen, presses "Break ground", and fails on any uncaught exception.
//
//   node test/playable-loads.mjs          # BW_CHROME=<path> to pick a browser
//
// Exit 0 clean, 1 on a page exception or no setup screen, 2 when no browser.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLAYABLE = join(HERE, "..", "playable", "broadway-and-wall.html");
const WAIT_MS = Number(process.env.WAIT_MS ?? 20_000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pwChromes = () => {
  const root = "/opt/pw-browsers";
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((d) => /^chromium-\d+$/.test(d))
    .flatMap((d) => [join(root, d, "chrome-linux64", "chrome"), join(root, d, "chrome-linux", "chrome")]);
};
const CHROME = process.env.BW_CHROME ?? [
  "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  ...pwChromes(),
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].find((p) => existsSync(p));
if (!CHROME) { console.log("playable-loads: no Chrome found; set BW_CHROME"); process.exit(2); }

const profile = mkdtempSync(join(tmpdir(), "bw-load-"));
const port = 9900 + Math.floor(Math.random() * 90);
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", "--mute-audio", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--no-first-run", "--no-default-browser-check", "--window-size=1280,800", `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "about:blank"], { stdio: "ignore" });
const done = (code, msg) => {
  console.log(msg);
  chrome.kill();
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* still locked */ }
  process.exit(code);
};

let wsUrl;
// a cold browser on a shared CI runner can take well over 15 s to open its port (seen on GitHub Actions): wait up to a minute
for (let i = 0; i < 400 && !wsUrl; i++) {
  try { wsUrl = (await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())).find((t) => t.type === "page")?.webSocketDebuggerUrl; } catch { /* not up */ }
  if (!wsUrl) await sleep(150);
}
if (!wsUrl) done(2, "playable-loads: the browser never opened its DevTools port");
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result ?? msg); pending.delete(msg.id); }
  if (msg.method === "Runtime.consoleAPICalled" && /worker failed/i.test(JSON.stringify(msg.params.args ?? []))) {
    errors.push("worker: " + (msg.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 200));
  }
  if (msg.method === "Runtime.exceptionThrown") {
    const d = msg.params.exceptionDetails;
    errors.push((d.exception?.description ?? d.text ?? "exception").split("\n").slice(0, 2).join(" | "));
  }
};
const send = (method, params = {}) => new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
const text = async () => (await send("Runtime.evaluate", { expression: "document.body ? document.body.innerText : ''", returnByValue: true }))?.result?.value ?? "";

await send("Runtime.enable");
await send("Page.enable");

// BOTH INTERFACES (UI clean-up, 2026-11). This only ever opened ?ui=next, the
// shelved shell, while every player and Unreal get Classic — so the interface
// people actually play was never opened by CI. Classic first, then next.
const results = [];
for (const [ui, idleMs, shell] of [["classic", WAIT_MS, ".siderail"], ["next", Math.min(WAIT_MS, 8000), ".nx-rail"]]) {
  errors.length = 0;
  // a fresh start each time: the first run's autosave turns the setup screen into Continue
  await send("Page.navigate", { url: "about:blank" });
  await send("Storage.clearDataForOrigin", { origin: "file://", storageTypes: "all" });
  await sleep(300);
  await send("Page.navigate", { url: pathToFileURL(PLAYABLE).href + "?ui=" + ui });

  // the setup screen, then a new game started on it
  const t0 = Date.now();
  let setup = false;
  while (Date.now() - t0 < WAIT_MS && !errors.length) {
    if (/Break ground/.test(await text())) { setup = true; break; }
    await sleep(250);
  }
  if (errors.length) done(1, `playable-loads: FAIL (${ui}) — the page threw on load:\n  ${errors.join("\n  ")}`);
  if (!setup) done(1, `playable-loads: FAIL (${ui}) — no setup screen after ${WAIT_MS / 1000} s`);
  const setupS = ((Date.now() - t0) / 1000).toFixed(1);
  await send("Runtime.evaluate", { expression: `[...document.querySelectorAll("button")].find((b) => /Break ground/.test(b.textContent))?.click()` });
  const t1 = Date.now();
  while (Date.now() - t1 < idleMs && !errors.length) await sleep(250);
  if (errors.length) done(1, `playable-loads: FAIL (${ui}) — the page threw after Break ground:\n  ${errors.join("\n  ")}`);
  let drawn = false;
  for (const t3 = Date.now(); !drawn && Date.now() - t3 < WAIT_MS; await sleep(250)) {
    drawn = !!(await send("Runtime.evaluate", { expression: `!!document.querySelector(${JSON.stringify(shell)})`, returnByValue: true }))?.result?.value;
  }
  if (!drawn) done(1, `playable-loads: FAIL (${ui}) — no ${shell} after a new game: the interface did not draw`);
  // THE MONTH RUNS OFF THE PAGE'S THREAD (2026-11-08). After #678 both web
  // workers threw on load (a module cycle read in its temporal dead zone) and
  // the page quietly ran every month itself: the game froze while the clock ran
  // and every check stayed green. Advance one month and ask where it ran.
  await send("Runtime.evaluate", { expression: `[...document.querySelectorAll("button")].find((b) => /^\\s*(\\+1 mo|Advance)/.test(b.textContent))?.click()` });
  let where = "none";
  const t2 = Date.now();
  while (Date.now() - t2 < WAIT_MS && !errors.length) {
    where = (await send("Runtime.evaluate", { expression: "window.__sim?.where?.() ?? 'none'", returnByValue: true }))?.result?.value ?? "none";
    if (where !== "none") break;
    await sleep(250);
  }
  if (errors.length) done(1, `playable-loads: FAIL (${ui}) — after a month:\n  ${errors.join("\n  ")}`);
  if (where !== "worker") done(1, `playable-loads: FAIL (${ui}) — the month ran on the ${where === "page" ? "page's thread (the sim worker failed)" : "page: no month closed"}`);
  results.push(`${ui}: setup in ${setupS} s`);
}
done(0, `playable-loads: ok — ${results.join(", ")}; no exception through a new game in either interface, the month ran in the sim worker`);
