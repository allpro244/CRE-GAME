import { chromium } from "playwright";
const URL = "http://127.0.0.1:4173/";
const UD = "/tmp/claude-0/-home-user-CRE-GAME/7b00530e-1e2c-5e54-8640-e3b0230e4191/scratchpad/prof";
const ctx = await chromium.launchPersistentContext(UD, { executablePath: "/opt/pw-browsers/chromium", viewport: { width: 1600, height: 1000 } });
const page = ctx.pages()[0] ?? await ctx.newPage();
page.on("pageerror", (e) => console.log("pageerror", e.message));
page.setDefaultTimeout(30000);
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__store?.getState().game && window.__store.getState().parcels, null, { timeout: 60000 });
await page.waitForTimeout(2500);

console.log(await page.evaluate(() => {
  const S = () => window.__store.getState();
  if (S().game.month > 300) return "already rich: month=" + S().game.month + " hold=" + Object.keys(S().game.holdings).length;
  const products = ["harbor", "savings", "pelican", "conduit", "cordage", "savings25"];
  let bought = 0;
  const buyBig = () => {
    const g = S().game, P = S().parcels;
    if (g.talks) S().walkAway();
    const owned = new Set(Object.keys(g.holdings));
    const cands = g.listings.filter((l) => !owned.has(l.bbl) && l.ask > 2e6 && P[l.bbl]?.class !== "land").sort((a, c) => c.ask - a.ask);
    for (const l of cands.slice(0, 6)) {
      const px = Math.round(l.ask * 1.04);
      if (px * 0.45 > S().game.cash) continue;
      S().offer(l.bbl, px);
      const t = S().game.talks;
      if (t?.agreed) { S().closeDeal(products[bought % products.length], 0.62); if (!S().game.talks) { bought++; return; } S().walkAway(); }
      else if (t) S().walkAway();
    }
  };
  for (let m = 0; m < 366; m++) {
    const n = Object.keys(S().game.holdings).length;
    if (m % 6 === 0 && n < 20) { S().devGrant(); S().devGrant(); }
    if (m % 2 === 0 && n < 20) buyBig();
    S().advance();
  }
  return `hold=${Object.keys(S().game.holdings).length} loans=${Object.values(S().game.holdings).filter((h) => h.loan).length} month=${S().game.month}`;
}));

console.log(await page.evaluate(() => {
  const S = () => window.__store.getState();
  const out = [];
  if (Object.keys(S().game.developments).length >= 2) return "devs already " + Object.keys(S().game.developments).length;
  for (let k = 0; k < 2; k++) {
    for (let i = 0; i < 5; i++) S().devGrant();
    const g = S().game, P = S().parcels;
    let target = Object.keys(g.holdings).find((x) => P[x]?.class === "land" && !g.developments[x]);
    if (!target) {
      const l = g.listings.filter((x) => P[x.bbl]?.class === "land").sort((a, c) => c.ask - a.ask)[0];
      if (l) { S().offer(l.bbl, Math.round(l.ask * 1.2)); if (S().game.talks?.agreed) { S().closeDeal("harbor", 0.5); target = l.bbl; } else S().walkAway(); }
    }
    if (target) { S().develop(target, k === 0 ? "office" : "mixed", k === 0 ? 14 : 9, 0.6, "gmp", 0.6); out.push(`dev${k} ${target}: ${S().toast?.text?.slice(0, 60)}`); }
    for (let i = 0; i < (k === 0 ? 14 : 3); i++) S().advance();
  }
  return out.join("\n") + " devs=" + Object.keys(S().game.developments).length;
}));

console.log(await page.evaluate(() => {
  const S = () => window.__store.getState();
  const g = structuredClone(S().game);
  if (Object.keys(g.workouts || {}).length) return "workout already";
  const lev = Object.values(g.holdings).filter((h) => h.loan && !g.developments[h.bbl]);
  if (!lev.length) return "no levered holding";
  const h = lev[0];
  h.loan.defaulted = true;
  g.workouts = g.workouts || {};
  g.workouts[h.bbl] = { bbl: h.bbl, openedM: g.month - 5, cause: "dscr", cureBy: g.month + 4, cure: Math.round((h.loan.balance || 1e6) * 0.09), forbearanceUsed: false, strikes: 1 };
  // also list one building for sale so the Deals page has a live disposition
  const first = Object.values(g.holdings).find((x) => !g.workouts[x.bbl] && !x.sale);
  window.__store.setState({ game: g });
  if (first) S().listSale(first.bbl, Math.round((first.costBasis || 1e7) * 1.6), "marketed");
  return "workout on " + h.bbl + "; listed " + (first?.bbl ?? "none");
}));
// let it save
await page.waitForTimeout(1500);
await page.evaluate(async () => { await window.__store.getState().saveTo("AUDIT"); });
await page.waitForTimeout(1500);
console.log("state:", await page.evaluate(() => {
  const g = window.__store.getState().game;
  return `month=${g.month} hold=${Object.keys(g.holdings).length} devs=${Object.keys(g.developments).length} workouts=${Object.keys(g.workouts||{}).length} lois=${g.lois.length} listings=${g.listings.length} cash=${Math.round(g.cash/1e6)}M`;
}));
await ctx.close();
