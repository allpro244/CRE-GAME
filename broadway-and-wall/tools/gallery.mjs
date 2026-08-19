// THE SEED GALLERY — the review instrument citygen never had. Renders a
// pinned set of seeds as plat drawings on one contact sheet, so any change
// to the generator ships with a before/after a human can veto with their
// eyes. Ten "fix the weird generations" attempts died for want of this page.
//
//   pnpm gallery                        12 pinned seeds, city size → HTML
//   pnpm gallery -- --png               ...plus a PNG via headless chromium
//   SEEDS=1,2 SIZE=hamlet pnpm gallery  custom sweep
//
// The seeds are PINNED and shared with test/plat.mjs: a gallery that rolls
// fresh seeds each run is comparing two different towns and proves nothing.
import { mkdirSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeCity } from "../src/citygen/index.mjs";
import { renderPlatSVG } from "./plat-svg.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "dist-gallery");
const SEEDS = (process.env.SEEDS
  ? process.env.SEEDS.split(",").map(Number)
  : [4242, 550991, 12007, 1337, 31415, 271828, 87, 5150, 909090, 123457, 424243, 777001]);
const SIZE = process.env.SIZE || "city";
const DEV = process.env.DEV || "village";
const wantPng = process.argv.includes("--png");

mkdirSync(OUT_DIR, { recursive: true });
const cards = [];
for (const seed of SEEDS) {
  const t0 = Date.now();
  const city = makeCity("somewhere", seed, { size: SIZE, density: DEV });
  const { svg, metrics } = renderPlatSVG(city, { w: 560 });
  cards.push({ seed, svg, metrics });
  console.log(`  ${String(seed).padStart(8)}  ${city.manifest.city.padEnd(18)} ${Date.now() - t0}ms  sliver ${metrics.sliverPct}%  void ${metrics.largestVoidM2}m²`);
}

const html = `<!doctype html><meta charset="utf-8"><title>plat gallery — ${SIZE}</title>
<style>body{background:#2b2b28;margin:0;padding:14px;font-family:Georgia,serif}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;align-items:start}
.card{background:#fff;border-radius:4px;overflow:hidden}
.card svg{display:block;width:100%;height:auto}</style>
<div class="grid">${cards.map((c) => `<div class="card">${c.svg}</div>`).join("\n")}</div>`;
const htmlPath = join(OUT_DIR, `gallery-${SIZE}.html`);
writeFileSync(htmlPath, html);
console.log("\n", htmlPath);

// PNG via headless chromium over CDP — same machinery as tools/shoot.mjs,
// pointed at the contact sheet instead of the game.
if (wantPng) {
  const CHROME = process.env.CHROME
    || "/opt/pw-browsers/chromium";
  const port = 9300 + Math.floor((Date.now() / 11) % 400);
  const W = 1760, H = Math.ceil(cards.length / 3) * 700 + 60;
  const chrome = spawn(CHROME, [
    "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars",
    `--window-size=${W},${H}`, `--remote-debugging-port=${port}`, "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let wsUrl = null;
  for (let i = 0; i < 100 && !wsUrl; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
      wsUrl = list.find((t) => t.type === "page")?.webSocketDebuggerUrl ?? null;
    } catch { /* not up yet */ }
    if (!wsUrl) await sleep(150);
  }
  if (!wsUrl) { console.error("chromium never came up; HTML is still written"); chrome.kill(); process.exit(0); }
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } };
  const send = (method, params = {}) => new Promise((res) => { const n = ++id; pending.set(n, (m) => res(m.result ?? m)); ws.send(JSON.stringify({ id: n, method, params })); });
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: "file://" + htmlPath });
  await sleep(2500);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  const pngPath = join(OUT_DIR, `gallery-${SIZE}.png`);
  if (shot?.data) { writeFileSync(pngPath, Buffer.from(shot.data, "base64")); console.log(" ", pngPath); }
  ws.close(); chrome.kill();
}
