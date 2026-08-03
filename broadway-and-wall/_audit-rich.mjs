import { chromium } from "playwright";
import fs from "node:fs";

const URL = "http://127.0.0.1:4173/";
const OUT = "/tmp/claude-0/-home-user-CRE-GAME/7b00530e-1e2c-5e54-8640-e3b0230e4191/scratchpad/shots";
fs.mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 200)); });
page.setDefaultTimeout(30000);
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__store && window.__store.getState().game && window.__store.getState().parcels, null, { timeout: 60000 });
await page.waitForTimeout(2500);

const log = await page.evaluate(async () => {
  const store = window.__store;
  const S = () => store.getState();
  const out = [];
  const products = ["harbor", "savings", "pelican", "conduit", "cordage", "savings25"];
  let bought = 0;

  const buyBig = () => {
    const st = S(); const g = st.game;
    if (g.talks) { st.walkAway(); }
    const owned = new Set(Object.keys(g.holdings));
    const cands = g.listings.filter((l) => !owned.has(l.bbl) && l.ask > 2e6)
      .sort((a, b) => b.ask - a.ask);
    for (const l of cands.slice(0, 6)) {
      const px = Math.round(l.ask * 1.03);
      if (px * 0.45 > S().game.cash) continue;
      S().offer(l.bbl, px);
      const t = S().game.talks;
      if (t && t.agreed) {
        S().closeDeal(products[bought % products.length], 0.62);
        if (!S().game.talks) { bought++; return true; }
        S().walkAway();
      } else if (t) S().walkAway();
    }
    return false;
  };

  for (let m = 0; m < 372; m++) {
    const n = Object.keys(S().game.holdings).length;
    if (m % 6 === 0 && n < 20) { S().devGrant(); S().devGrant(); }
    if (m % 2 === 0 && n < 20) buyBig();
    S().advance();
    if (m % 60 === 0) out.push(`m${m} hold=${Object.keys(S().game.holdings).length} cash=${Math.round(S().game.cash / 1e6)}M`);
  }
  const g = S().game;
  const withLoan = Object.values(g.holdings).filter((h) => h.loan).length;
  const withTen = Object.values(g.holdings).filter((h) => (h.tenants || []).length).length;
  out.push(`AFTER BUY: month=${g.month} hold=${Object.keys(g.holdings).length} loans=${withLoan} tenanted=${withTen} cash=${Math.round(g.cash / 1e6)}M devs=${Object.keys(g.developments).length} workouts=${Object.keys(g.workouts || {}).length}`);
  return out;
});
console.log(log.join("\n"));

const dev = await page.evaluate(() => {
  const S = () => window.__store.getState();
  const g = S().game, P = S().parcels;
  const out = [];
  const owned = Object.keys(g.holdings);
  const vacant = owned.filter((b) => { const p = P[b]; return p && (!p.builtSf || p.builtSf < 1000) && !g.built[b]; });
  out.push("owned=" + owned.length + " vacantOwned=" + vacant.length);
  for (const b of vacant.slice(0, 3)) { S().develop(b, "office", 12, 0.6, "gmp", 0.6); }
  if (!Object.keys(S().game.developments).length) {
    const l = g.listings.filter((x) => { const p = P[x.bbl]; return p && (!p.builtSf || p.builtSf < 1000); }).sort((a, c) => c.ask - a.ask)[0];
    if (l) { S().offer(l.bbl, Math.round(l.ask * 1.1)); if (S().game.talks?.agreed) S().closeDeal("harbor", 0.5); S().develop(l.bbl, "office", 14, 0.6, "gmp", 0.6); out.push("bought lot " + l.bbl); }
  }
  out.push("devs=" + Object.keys(S().game.developments).length);
  return out;
});
console.log(dev.join("\n"));

await page.evaluate(() => { for (let i = 0; i < 8; i++) window.__store.getState().advance(); });

const wk = await page.evaluate(() => {
  const S = () => window.__store.getState();
  const g = structuredClone(S().game);
  const lev = Object.values(g.holdings).filter((h) => h.loan);
  const out = ["levered=" + lev.length];
  if (lev.length) {
    const h = lev[0];
    h.loan.defaulted = true;
    g.workouts = g.workouts || {};
    g.workouts[h.bbl] = { bbl: h.bbl, openedM: g.month - 4, cause: "dscr", cureBy: g.month + 5, cure: Math.round((h.loan.balance || 1e6) * 0.08), forbearanceUsed: false, strikes: 1 };
    window.__store.setState({ game: g });
    out.push("workout on " + h.bbl);
  }
  out.push(JSON.stringify(S().game.workouts || {}).slice(0, 300));
  return out;
});
console.log(wk.join("\n"));
console.log(errs.length ? "ERRS:\n" + errs.slice(0, 8).join("\n") : "no errors");

const pages = ["portfolio", "deals", "research", "market", "economy", "leasing", "books", "saves"];
for (const p of pages) {
  await page.evaluate((pp) => window.__store.getState().setPage(pp), p);
  await page.waitForTimeout(1200);
  const info = await page.evaluate(() => {
    const scroller = [...document.querySelectorAll("*")].filter((n) => n.scrollHeight > n.clientHeight + 40 && n.clientHeight > 200);
    return { text: document.body.innerText, scrollers: scroller.map((n) => ({ cls: String(n.className).slice(0, 60), h: n.clientHeight, sh: n.scrollHeight })) };
  });
  fs.writeFileSync(`${OUT}/${p}.txt`, info.text);
  await page.screenshot({ path: `${OUT}/${p}.png`, animations: "disabled", timeout: 60000 }).catch((e) => console.log(p + " shot fail " + e.message.slice(0, 60)));
  await page.evaluate(() => { const s = [...document.querySelectorAll("*")].find((n) => n.scrollHeight > n.clientHeight + 40 && n.clientHeight > 200); if (s) s.scrollTop = s.scrollHeight; });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${p}-bottom.png`, animations: "disabled", timeout: 60000 }).catch(() => {});
  console.log(p, "chars=" + info.text.length, "scrollers=" + JSON.stringify(info.scrollers).slice(0, 220));
}

await page.evaluate(() => {
  const S = () => window.__store.getState();
  const g = S().game, P = S().parcels;
  const best = Object.keys(g.holdings).sort((a, c) => (P[c]?.builtSf || 0) - (P[a]?.builtSf || 0))[0];
  S().select(best); S().setPage("property");
});
await page.waitForTimeout(1500);
{
  const t = await page.evaluate(() => document.body.innerText);
  fs.writeFileSync(`${OUT}/property.txt`, t);
  await page.screenshot({ path: `${OUT}/property.png`, animations: "disabled", timeout: 60000 }).catch(() => {});
  await page.evaluate(() => { const s = [...document.querySelectorAll("*")].find((n) => n.scrollHeight > n.clientHeight + 40 && n.clientHeight > 200); if (s) s.scrollTop = s.scrollHeight; });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/property-bottom.png`, animations: "disabled", timeout: 60000 }).catch(() => {});
  console.log("property chars=" + t.length);
}

await page.evaluate(() => {
  const S = () => window.__store.getState();
  const g = S().game, P = S().parcels;
  const v = Object.keys(g.holdings).find((b) => { const p = P[b]; return p && (!p.builtSf || p.builtSf < 1000) && !g.developments[b]; })
    || S().bbls.find((b) => { const p = P[b]; return p && (!p.builtSf || p.builtSf < 1000); });
  S().setPage("none"); S().select(v);
});
await page.waitForTimeout(1500);
{
  const t = await page.evaluate(() => document.body.innerText);
  fs.writeFileSync(`${OUT}/develop.txt`, t);
  await page.screenshot({ path: `${OUT}/develop.png`, animations: "disabled", timeout: 60000 }).catch(() => {});
  console.log("develop chars=" + t.length);
}

await page.evaluate(() => { window.__store.getState().select(null); window.__store.getState().setPage("none"); });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/map.png`, animations: "disabled", timeout: 60000 }).catch(() => {});

const snap = await page.evaluate(() => JSON.stringify(window.__store.getState().game));
fs.writeFileSync("/tmp/claude-0/-home-user-CRE-GAME/7b00530e-1e2c-5e54-8640-e3b0230e4191/scratchpad/game.json", snap);
console.log(errs.length ? "ERRS2:\n" + errs.slice(0, 8).join("\n") : "no errors2");
await b.close();
