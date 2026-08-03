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
await page.waitForFunction(() => window.__store?.getState().game && window.__store.getState().parcels, null, { timeout: 60000 });
await page.waitForTimeout(2500);

console.log(await page.evaluate(() => {
  const S = () => window.__store.getState();
  const out = [];
  const products = ["harbor", "savings", "pelican", "conduit", "cordage", "savings25"];
  let bought = 0;
  const buyBig = (landToo) => {
    const g = S().game, P = S().parcels;
    if (g.talks) S().walkAway();
    const owned = new Set(Object.keys(g.holdings));
    const cands = g.listings
      .filter((l) => !owned.has(l.bbl) && l.ask > 2e6 && (landToo || P[l.bbl]?.class !== "land"))
      .sort((a, c) => c.ask - a.ask);
    for (const l of cands.slice(0, 6)) {
      const px = Math.round(l.ask * 1.04);
      if (px * 0.45 > S().game.cash) continue;
      S().offer(l.bbl, px);
      const t = S().game.talks;
      if (t?.agreed) { S().closeDeal(products[bought % products.length], 0.62); if (!S().game.talks) { bought++; return true; } S().walkAway(); }
      else if (t) S().walkAway();
    }
    return false;
  };
  for (let m = 0; m < 366; m++) {
    const n = Object.keys(S().game.holdings).length;
    if (m % 6 === 0 && n < 20) { S().devGrant(); S().devGrant(); }
    if (m % 2 === 0 && n < 20) buyBig(false);
    S().advance();
  }
  const g = S().game;
  out.push(`hold=${Object.keys(g.holdings).length} loans=${Object.values(g.holdings).filter((h) => h.loan).length} month=${g.month} cash=${Math.round(g.cash / 1e6)}M`);
  return out.join("\n");
}));

// ---- break ground on two sites, at different stages ------------------------
console.log(await page.evaluate(() => {
  const S = () => window.__store.getState();
  const out = [];
  for (let k = 0; k < 2; k++) {
    S().devGrant(); S().devGrant(); S().devGrant(); S().devGrant(); S().devGrant();
    const g = S().game, P = S().parcels;
    let target = Object.keys(g.holdings).find((x) => P[x]?.class === "land" && !g.developments[x]);
    if (!target) {
      const l = g.listings.filter((x) => P[x.bbl]?.class === "land").sort((a, c) => c.ask - a.ask)[0];
      if (l) { S().offer(l.bbl, Math.round(l.ask * 1.2)); if (S().game.talks?.agreed) { S().closeDeal("harbor", 0.5); target = l.bbl; } else S().walkAway(); }
    }
    if (target) {
      S().develop(target, k === 0 ? "office" : "mixed", k === 0 ? 14 : 9, 0.6, "gmp", 0.6);
      out.push(`dev ${k}: ${target} :: ${S().toast?.text?.slice(0, 90)}`);
    }
    for (let i = 0; i < (k === 0 ? 14 : 3); i++) S().advance();
  }
  out.push("devs=" + Object.keys(S().game.developments).length + " " + JSON.stringify(S().game.developments).slice(0, 400));
  return out.join("\n");
}));

// ---- a workout on a levered holding ----------------------------------------
console.log(await page.evaluate(() => {
  const S = () => window.__store.getState();
  const g = structuredClone(S().game);
  const lev = Object.values(g.holdings).filter((h) => h.loan && !g.developments[h.bbl]);
  if (!lev.length) return "no levered holding";
  const h = lev[0];
  h.loan.defaulted = true;
  g.workouts = g.workouts || {};
  g.workouts[h.bbl] = { bbl: h.bbl, openedM: g.month - 5, cause: "dscr", cureBy: g.month + 4, cure: Math.round((h.loan.balance || 1e6) * 0.09), forbearanceUsed: false, strikes: 1 };
  window.__store.setState({ game: g });
  return "workout on " + h.bbl + " :: " + JSON.stringify(S().game.workouts).slice(0, 200);
}));
console.log(errs.length ? "ERRS:\n" + errs.slice(0, 6).join("\n") : "no errors");

async function shoot(name) {
  await page.waitForTimeout(1100);
  const info = await page.evaluate(() => {
    const sc = [...document.querySelectorAll("*")].filter((n) => n.scrollHeight > n.clientHeight + 30 && n.clientHeight > 150);
    return { text: document.body.innerText, scrollers: sc.map((n) => ({ cls: String(n.className).slice(0, 50), h: n.clientHeight, sh: n.scrollHeight })) };
  });
  fs.writeFileSync(`${OUT}/${name}.txt`, info.text);
  await page.screenshot({ path: `${OUT}/${name}.png`, animations: "disabled", timeout: 60000 }).catch((e) => console.log(name + " shot fail"));
  await page.evaluate(() => { const s = [...document.querySelectorAll("*")].find((n) => n.scrollHeight > n.clientHeight + 30 && n.clientHeight > 150); if (s) s.scrollTop = Math.round(s.scrollHeight * 0.42); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}-mid.png`, animations: "disabled", timeout: 60000 }).catch(() => {});
  await page.evaluate(() => { const s = [...document.querySelectorAll("*")].find((n) => n.scrollHeight > n.clientHeight + 30 && n.clientHeight > 150); if (s) s.scrollTop = s.scrollHeight; });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}-bottom.png`, animations: "disabled", timeout: 60000 }).catch(() => {});
  console.log(name, "chars=" + info.text.length, JSON.stringify(info.scrollers).slice(0, 200));
}

for (const p of ["portfolio", "deals", "research", "market", "economy", "leasing", "books", "saves"]) {
  await page.evaluate((pp) => window.__store.getState().setPage(pp), p);
  await shoot(p);
}

// property page: biggest holding
await page.evaluate(() => {
  const S = () => window.__store.getState();
  const g = S().game, P = S().parcels;
  const best = Object.keys(g.holdings).filter((x) => P[x]?.class !== "land").sort((a, c) => (P[c]?.bldgArea || 0) - (P[a]?.bldgArea || 0))[0];
  S().select(best); S().setPage("property");
});
await shoot("property");

// property page: the one in workout
await page.evaluate(() => {
  const S = () => window.__store.getState();
  const w = Object.keys(S().game.workouts || {})[0];
  if (w) { S().select(w); S().setPage("property"); }
});
await shoot("property-workout");

// right panel on a development under way
await page.evaluate(() => {
  const S = () => window.__store.getState();
  const d = Object.keys(S().game.developments)[0];
  S().setPage("none"); S().select(d);
});
await shoot("panel-development");

// right panel on a vacant lot we own -> DevelopSection
await page.evaluate(() => {
  const S = () => window.__store.getState();
  const g = S().game, P = S().parcels;
  S().devGrant(); S().devGrant(); S().devGrant();
  let v = Object.keys(g.holdings).find((x) => P[x]?.class === "land" && !g.developments[x]);
  if (!v) {
    const l = g.listings.filter((x) => P[x.bbl]?.class === "land").sort((a, c) => c.ask - a.ask)[0];
    if (l) { S().offer(l.bbl, Math.round(l.ask * 1.2)); if (S().game.talks?.agreed) { S().closeDeal("harbor", 0.5); v = l.bbl; } }
  }
  S().setPage("none"); S().select(v);
});
await shoot("panel-develop");

// right panel on somebody else's building
await page.evaluate(() => {
  const S = () => window.__store.getState();
  const g = S().game, P = S().parcels;
  const other = g.listings.filter((l) => P[l.bbl]?.class !== "land").sort((a, c) => c.ask - a.ask)[0];
  S().setPage("none"); S().select(other ? other.bbl : S().bbls[10]);
});
await shoot("panel-listing");

await page.evaluate(() => { window.__store.getState().select(null); window.__store.getState().setPage("none"); });
await shoot("map");

fs.writeFileSync("/tmp/claude-0/-home-user-CRE-GAME/7b00530e-1e2c-5e54-8640-e3b0230e4191/scratchpad/game.json", await page.evaluate(() => JSON.stringify(window.__store.getState().game)));
console.log(errs.length ? "ERRS2:\n" + errs.slice(0, 8).join("\n") : "no errors2");
await b.close();
