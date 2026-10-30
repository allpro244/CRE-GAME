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
for (let i = 0; i < 100 && !wsUrl; i++) {
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
  if (msg.method === "Runtime.exceptionThrown") {
    const d = msg.params.exceptionDetails;
    errors.push((d.exception?.description ?? d.text ?? "exception").split("\n").slice(0, 2).join(" | "));
  }
};
const send = (method, params = {}) => new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
const text = async () => (await send("Runtime.evaluate", { expression: "document.body ? document.body.innerText : ''", returnByValue: true }))?.result?.value ?? "";

await send("Runtime.enable");
await send("Page.enable");
await send("Page.navigate", { url: pathToFileURL(PLAYABLE).href + "?ui=next" });

// the setup screen, then a new game started on it
const t0 = Date.now();
let setup = false;
while (Date.now() - t0 < WAIT_MS && !errors.length) {
  if (/Break ground/.test(await text())) { setup = true; break; }
  await sleep(250);
}
if (errors.length) done(1, `playable-loads: FAIL — the page threw on load:\n  ${errors.join("\n  ")}`);
if (!setup) done(1, `playable-loads: FAIL — no setup screen after ${WAIT_MS / 1000} s`);
const setupS = ((Date.now() - t0) / 1000).toFixed(1);
await send("Runtime.evaluate", { expression: `[...document.querySelectorAll("button")].find((b) => /Break ground/.test(b.textContent))?.click()` });
const t1 = Date.now();
while (Date.now() - t1 < WAIT_MS && !errors.length) await sleep(250);
if (errors.length) done(1, `playable-loads: FAIL — the page threw after Break ground:\n  ${errors.join("\n  ")}`);
done(0, `playable-loads: ok — setup screen in ${setupS} s, no exception through ${WAIT_MS / 1000} s of a new game`);
