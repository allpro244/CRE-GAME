// HOW LONG A NEW GAME TAKES TO START, in a real browser: headless Edge or
// Chromium opens the playable, picks a city, breaks ground, and times the
// page until it is playing. Catches a start that hangs in the browser but
// not in Node (the town is cut in a Web Worker there).
//
//   node tools/start-probe.mjs http://localhost:8780/broadway-and-wall.html [--city "Region (6 km)"] [--limit 60]
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
const url = argv[0];
const flag = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 ? argv[i + 1] : d; };
const city = flag("city", ""), limit = Number(flag("limit", 60));
const CHROME = process.env.BW_CHROME ?? ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"].find((p) => existsSync(p));
const port = 9300 + Math.floor((Date.now() / 7 + process.pid * 37) % 600);
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", `--user-data-dir=${mkdtempSync(join(tmpdir(), "startprobe-"))}`, `--remote-debugging-port=${port}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const done = (code, msg) => { console.log(msg); chrome.kill(); process.exit(code); };
let wsUrl;
for (let i = 0; i < 100 && !wsUrl; i++) { try { wsUrl = (await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())).find((t) => t.type === "page")?.webSocketDebuggerUrl; } catch { /* not up */ } if (!wsUrl) await sleep(150); }
const ws = new WebSocket(wsUrl);
await new Promise((res) => { ws.onopen = res; });
let id = 0; const pending = new Map(), errors = [];
ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails.text); };
const send = (method, params = {}) => new Promise((res) => { const n = ++id; pending.set(n, (m) => res(m.result ?? m)); ws.send(JSON.stringify({ id: n, method, params })); });
const js = async (expr) => (await send("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true })).result?.value;
await send("Runtime.enable"); await send("Page.navigate", { url });
for (let i = 0; i < 60; i++) { if (await js(`return !!window.__store && [...document.querySelectorAll('button')].some(b => b.textContent.includes('Break ground'))`)) break; await sleep(250); }
if (city) await js(`const el = [...document.querySelectorAll('*')].filter(e => e.childElementCount === 0 && e.textContent.trim() === ${JSON.stringify(city)}).pop(); el?.click();`);
await sleep(300);
await js(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Break ground'))?.click();`);
const t0 = Date.now();
while ((Date.now() - t0) / 1000 < limit) {
  const st = await js(`const s = window.__store.getState(); return { phase: s.phase, err: s.loadError, lots: s.parcels ? Object.keys(s.parcels).length : 0 };`);
  if (st?.phase === "playing") done(0, `started in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${st.lots} lots${errors.length ? `; page errors: ${errors.join(" | ")}` : ""}`);
  if (st?.err) done(1, `failed: ${st.err}`);
  await sleep(250);
}
done(1, `HUNG: still ${await js("return window.__store.getState().phase")} after ${limit} s${errors.length ? `; page errors: ${errors.join(" | ")}` : ""}`);
