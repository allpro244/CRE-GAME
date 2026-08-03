// Drive the UNZIPPED copy on the packaged python server, the way the user will
// run it. Not "does a page load" — does the loop work: city generated, map
// drawn, a lot clicked, a quarter advanced, the new panels present.
import { chromium } from "playwright";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage({ viewport: { width: 1600, height: 1050 } });
const errs = [];
p.on("pageerror", e => errs.push("PAGEERROR " + e.message));
p.on("console", m => { if (m.type() === "error") errs.push("console " + m.text()); });
const req404 = [];
p.on("response", r => { if (r.status() >= 400) req404.push(r.status() + " " + r.url()); });

const URL = process.env.URL ?? "http://127.0.0.1:8080/";
await p.goto(URL, { waitUntil: "domcontentloaded" });
await p.waitForTimeout(13000);
const out = {};

out.city = await p.evaluate(() => {
  const g = window.__store.getState();
  return { lots: Object.keys(g.parcels ?? {}).length, seed: g.game?.citySeed, month: g.game?.month, cash: g.game?.cash };
});
out.canvases = await p.locator("canvas").count();

// advance three years with the keyboard
for (let i = 0; i < 36; i++) { await p.keyboard.press("Space"); await p.waitForTimeout(70); }
await p.waitForTimeout(800);
out.after = await p.evaluate(() => {
  const g = window.__store.getState().game;
  return { month: g.month, listings: g.listings.length, rivals: g.rivals.length, lenders: (g.lenders ?? []).length,
           news: g.news.length, indexRate: g.econ.indexRate };
});

const tab = async (name) => p.evaluate((n) => {
  const b = [...document.querySelectorAll("button.nav-btn")].find(x => x.textContent.trim() === n);
  if (b) { b.click(); return true; } return false;
}, name);

for (const [name, needles] of Object.entries({
  Research: ["The banks", "Cap ratio", "Appetite", "Who owns what"],
  Marketplace: ["ask"],
  Books: ["Income statement", "Property cash flow", "Change in cash"],
  Economy: ["vacancy"],
})) {
  if (!(await tab(name))) { out[name] = "TAB MISSING"; continue; }
  await p.waitForTimeout(900);
  const t = (await p.innerText("body")).toLowerCase();
  out[name] = needles.map(n => `${t.includes(n.toLowerCase()) ? "ok" : "MISSING"} ${n}`).join(" · ");
}

// close the panel and click a lot on the map
await p.keyboard.press("Escape");
await p.waitForTimeout(700);
await p.mouse.click(800, 620);
await p.waitForTimeout(1200);
const sel = await p.evaluate(() => window.__store.getState().selectedBBL);
out.clickedLot = sel ? `ok · selected ${sel}` : "no lot selected at that pixel";
if (sel) {
  const t = await p.innerText("body");
  out.record = ["Appraisal", "Demand"].map(n => `${t.includes(n) ? "ok" : "MISSING"} ${n}`).join(" · ");
}
await p.screenshot({ path: process.env.SHOT ?? "packaged.png", animations: "disabled", timeout: 25000 }).catch(()=>{});
console.log(JSON.stringify(out, null, 2));
console.log(req404.length ? "FAILED REQUESTS:\n" + req404.join("\n") : "no failed requests");
console.log(errs.length ? "ERRORS:\n" + errs.slice(0,8).join("\n") : "no console errors");
await b.close();
