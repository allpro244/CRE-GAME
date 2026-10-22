// Screenshot the land development desk (ui/panels/LandDesk.tsx) in a running
// dev server, driving it the way a player does: a region town, a farm bought,
// the desk opened, amenities set down with the mouse, a lot hovered.
//
//   node tools/shoot-plat.mjs http://localhost:5173 ../unreal/shots/plat-desk [--seed 1] [--tract 5000001260]
//
// Headless Chromium or Edge over the DevTools protocol, as tools/shoot.mjs.
// BW_CHROME names the browser; on Windows it defaults to Edge.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
const url = argv[0], outDir = argv[1];
const flag = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 ? argv[i + 1] : d; };
const seed = Number(flag("seed", 1)), tract = flag("tract", "5000001260");
const W = Number(flag("w", 1600)), H = Number(flag("h", 1100));
if (!url || !outDir) { console.error("usage: shoot-plat.mjs <url> <outDir>"); process.exit(1); }
mkdirSync(outDir, { recursive: true });
const CHROME = process.env.BW_CHROME ?? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
].find((p) => existsSync(p));
const port = 9300 + Math.floor((Date.now() / 7 + process.pid * 37) % 600);
const profile = mkdtempSync(join(tmpdir(), "shootplat-"));
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", "--hide-scrollbars", "--disable-lcd-text", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  `--window-size=${W},${H}`, `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl;
for (let i = 0; i < 100 && !wsUrl; i++) {
  try { wsUrl = (await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())).find((t) => t.type === "page")?.webSocketDebuggerUrl; } catch { /* not up */ }
  if (!wsUrl) await sleep(150);
}
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map(), errors = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
};
const send = (method, params = {}) => new Promise((res) => { const n = ++id; pending.set(n, (m) => res(m.result ?? m)); ws.send(JSON.stringify({ id: n, method, params })); });
const js = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result?.value;
};
const mouse = async (type, x, y) => send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", buttons: type === "mouseMoved" ? 0 : 1, clickCount: 1 });
const click = async (x, y) => { await mouse("mouseMoved", x, y); await mouse("mousePressed", x, y); await mouse("mouseReleased", x, y); await sleep(250); };
const shot = async (name, sel = ".land-desk") => {
  await sleep(400);
  const box = await js(`const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: "start" }); const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height };`);
  await sleep(300);
  const b2 = await js(`const e = document.querySelector(${JSON.stringify(sel)}); const r = e.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: Math.min(r.height, 4000) };`);
  const s = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: b2.x - 6, y: b2.y - 6, width: b2.w + 12, height: b2.h + 12, scale: 1 } });
  const f = join(outDir, name + ".png");
  writeFileSync(f, Buffer.from(s.data, "base64"));
  console.log(f, box ? `${Math.round(b2.w)}x${Math.round(b2.h)}` : "(no element)");
};
// a canonical point on the plat -> the page's pixel
const toScreen = (p) => js(`const svg = document.querySelector(".plat-map"); const pt = svg.createSVGPoint(); pt.x = ${p[0]}; pt.y = ${p[1]}; const q = pt.matrixTransform(svg.getScreenCTM()); return [q.x, q.y];`);
const button = (text) => js(`const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim().replace(/^[✓0-9]+/, "") === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true;`);

await send("Runtime.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url });
await sleep(6000);
// a region town, a farm bought at its price, the desk opened on its Design step
console.log(await js(`
  // the economy is dealt fresh every game; deal until a new house here pays for its lot (--any takes the first)
  const Hm = await import("/src/engine/homes.ts");
  const b = ${JSON.stringify(tract)};
  let tries = 0;
  for (; tries < ${argv.includes("--any") ? 1 : 12}; tries++) {
    await window.__store.getState().startRun("region", "standard", "standard", 25000000, { sandbox: true }, ${seed});
    for (let i = 0; i < 60 && window.__store.getState().phase !== "playing"; i++) await new Promise((r) => setTimeout(r, 500));
    const s0 = window.__store.getState();
    if (Hm.tractLotQuote(s0.game, s0.parcels, b, 7500, 150).quote.residual > 20000) break;
  }
  const A = await import("/src/engine/actions.ts"), V = await import("/src/engine/value.ts");
  const st = window.__store.getState();
  const price = Math.round(V.landValue(V.resolveRec(st.parcels, st.game, b), st.game.econ));
  const r = A.executePurchase(st.game, st.parcels, b, price, "cash", false);
  if (r.err) return r.err;
  window.__store.setState({ game: r.s });
  window.__store.getState().openProperty(b, "build");
  await new Promise((r) => setTimeout(r, 2500));
  return "bought " + st.parcels[b].address + " for " + price + " after " + (tries + 1) + " deal(s)";
`));
await shot("01-design-grid");
// amenities from the palette, set down with the mouse
// spread over the lots' own extent: the park in the middle, the pocket park and the pool towards the ends
for (const [label, fx, fy] of [["Neighbourhood park", 0.5, 0.5], ["Pocket park", 0.88, 0.3], ["Pool & clubhouse", 0.15, 0.75], ["Entry monument", 0.02, 0.98], ["Greenway trail", 0.5, 0.5]]) {
  await button(label);
  const at = await js(`
    document.querySelector(".plat-map").scrollIntoView({ block: "center" });
    const rs = [...document.querySelectorAll(".plat-lot")].map((e) => e.getBoundingClientRect()).map((r) => [r.left + r.width / 2, r.top + r.height / 2]);
    const xs = rs.map((p) => p[0]), ys = rs.map((p) => p[1]);
    const t = [Math.min(...xs) + ${fx} * (Math.max(...xs) - Math.min(...xs)), Math.min(...ys) + ${fy} * (Math.max(...ys) - Math.min(...ys))];
    return rs.reduce((b, p) => (Math.hypot(p[0] - t[0], p[1] - t[1]) < Math.hypot(b[0] - t[0], b[1] - t[1]) ? p : b));`);
  await click(at[0], at[1]);
}
await button("Look");
// hover a lot beside the park
const hov = await js(`
  const lots = [...document.querySelectorAll(".plat-lot")].filter((e) => e.dataset.prem === "1");
  const e = lots[Math.floor(lots.length / 2)] ?? document.querySelector(".plat-lot"); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2];`);
await mouse("mouseMoved", hov[0], hov[1]);
await shot("02-design-amenities-hover");
await button("Programme"); await shot("03-programme");
await button("Financing"); await shot("04-financing");
await button("Programme"); await button("Loops"); await button("Design"); await shot("05-design-loops");
await button("Programme"); await button("Cul-de-sacs"); await button("Design"); await shot("06-design-culdesac");
if (errors.length) console.log("page errors:", errors.slice(0, 3).join(" | ").slice(0, 600));
ws.close();
chrome.kill();
try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 }); } catch { /* temp */ }
process.exit(0);
