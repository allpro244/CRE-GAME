// THE TENANT MARKET (tenantMarket.ts, ONE ECONOMY step 4).
//
//   pnpm engine && node test/tenantmarket.mjs           one seed, 10 years
//   YEARS=30 SEED=12007 node test/tenantmarket.mjs
//
// Asserts what step 4 promises and prints what it measures:
//   - the office, shop and shed rent indices ARE the comps read back (the
//     index equals the square-foot-weighted mean of the last six months'
//     signed leases);
//   - landlords hold their own asks, and the asks spread (a market, not one
//     number);
//   - firms at the end of a lease renew or go to market from a comparison,
//     and the renewal shares land near the lease-expiry studies (office ~55%,
//     shops ~65%, sheds ~75% of expiring space);
//   - every firm that moves writes why ("moved to 40 Water St · rent −18% ·
//     600 m closer to clients"), and so do the ones that left town or shrank.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(pathToFileURL(join(HERE, ".engine.mjs")).href);
const { loadCity } = await import(pathToFileURL(join(HERE, "city.mjs")).href);

const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);
const SEED = Number(process.env.SEED ?? 550991);
const YEARS = Number(process.env.YEARS ?? 10);
const COMM = ["office", "retail", "industrial"];
let fails = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) { fails++; console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`); }
  else console.log(`PASS  ${name}${detail ? " — " + detail : ""}`);
};

let g = E.firstListings(E.newGame(SEED, parcels, 3e7, { sandbox: true }), parcels, bbls);
const exp = Object.fromEntries(COMM.map((k) => [k, { sf: 0, renew: 0, market: 0, gone: 0, later: 0 }]));
const toMarket = new Map();   // fid -> { bbl, sf, use, m }
const t0 = Date.now();
const rows = [];
let idxChecked = 0, idxOff = 0;
for (let m = 0; m < YEARS * 12; m++) {
  // the leases that end this month, before the month runs
  const ending = new Map();
  const next = g.month + 1;
  for (const [bbl, r] of Object.entries(g.econ.streetRolls ?? {})) for (const t of r.t) {
    if (t.fid === undefined || t.endM !== next) continue;
    if ((g.econ.seekers ?? []).some((k) => k.fid === t.fid)) continue;     // already holding over
    ending.set(t.fid, { bbl, sf: t.sf, use: t.use ?? "office" });
  }
  g = E.advanceMonth(g, parcels, bbls, adjacency);
  if (g.gameOver) g = { ...g, gameOver: null, cash: 1e9 };
  const where = new Map();
  for (const [bbl, r] of Object.entries(g.econ.streetRolls ?? {})) for (const t of r.t) if (t.fid !== undefined) where.set(t.fid, { bbl, t });
  for (const [fid, x] of ending) {
    const k = x.use;
    if (!exp[k]) continue;
    exp[k].sf += x.sf;
    const now = where.get(fid);
    if (!now || now.bbl !== x.bbl) exp[k].gone += x.sf;
    else if (now.t.endM === g.month + 6 && (g.econ.seekers ?? []).some((s) => s.fid === fid)) { exp[k].market += x.sf; toMarket.set(fid, { ...x, m: g.month }); }
    else exp[k].renew += x.sf;
  }
  // the firms that went to market: did they end up staying after all?
  for (const [fid, x] of toMarket) {
    if (g.month < x.m + 7) continue;
    const now = where.get(fid);
    if (now && now.bbl === x.bbl) exp[x.use].later += x.sf;
    toMarket.delete(fid);
  }
  // the index is the comps read back
  for (const k of COMM) {
    const ro = E.readOut ? E.readOut(g.econ, k, g.month) : null;
    if (!ro) continue;
    idxChecked++;
    if (Math.abs(ro.face / g.econ.rentIdx[k] - 1) > 1e-3) idxOff++;
  }
  if ((m + 1) % 12 === 0) {
    const e = g.econ;
    const asks = {};
    for (const k of COMM) {
      const rel = [];
      for (const [bbl, r] of Object.entries(e.streetRolls ?? {})) {
        const L = r.ask?.[k];
        if (!L || !(L.a > 0)) continue;
        const rec = E.resolveRec(parcels, g, bbl);
        if (!rec) continue;
        const mkt = E.useRentPsfYr(rec, e, "average", k);
        if (mkt > 0) rel.push(L.a / (mkt * e.rentIdx[k] / e.effRentIdx[k]));
      }
      rel.sort((a, b) => a - b);
      asks[k] = rel.length ? [rel[Math.floor(rel.length * 0.1)], rel[Math.floor(rel.length * 0.5)], rel[Math.floor(rel.length * 0.9)]] : [NaN, NaN, NaN];
    }
    rows.push({ y: (m + 1) / 12, e: structuredClone({ rent: e.rentIdx, eff: e.effRentIdx, conc: e.concIdx, vac: e.cityVac, cpi: e.cpi }), asks });
  }
}
for (const k of COMM) {
  const L = g.econ.comps?.[k] ?? [];
  const nw = L.filter((c) => !c.r), rn = L.filter((c) => c.r);
  const d = (xs) => xs.length ? (xs.reduce((a, c) => a + (1 - c.e / c.f), 0) / xs.length * 100).toFixed(1) + '%' : '-';
  console.log(`comps ${k}: new ${nw.length} (mean discount ${d(nw)}, at ask ${nw.filter((c) => c.e / c.f > 0.995).length}) · renewals ${rn.length} (${d(rn)})`);
}
const ms = (Date.now() - t0) / (YEARS * 12);
console.log(`\n${YEARS} years, seed ${SEED}, ${ms.toFixed(0)} ms a month`);
console.log("year  " + COMM.map((k) => `${k.padEnd(9)} ask/eff  conc  vac   asks p10/50/90`).join(" | "));
for (const r of rows) {
  console.log(String(r.y).padStart(4) + "  " + COMM.map((k) => `${r.e.rent[k].toFixed(2).padStart(6)}/${r.e.eff[k].toFixed(2).padStart(6)} ${r.e.conc[k].toFixed(2)} ${(r.e.vac[k] * 100).toFixed(1).padStart(4)}% ${r.asks[k].map((x) => x.toFixed(2)).join("/")}`).join(" | "));
}
console.log("\nat lease end (share of expiring street space):");
for (const k of COMM) {
  const x = exp[k];
  console.log(`  ${k.padEnd(10)} renewed ${(100 * x.renew / Math.max(1, x.sf)).toFixed(0)}% (+${(100 * x.later / Math.max(1, x.sf)).toFixed(0)}% after a look)  went to market ${(100 * x.market / Math.max(1, x.sf)).toFixed(0)}%  left/failed ${(100 * x.gone / Math.max(1, x.sf)).toFixed(0)}%  (${(x.sf / 1e6).toFixed(2)}M sf)`);
}
const W = g.why?.ev ?? [];
const kinds = {};
for (const ev of W) kinds[ev.k] = (kinds[ev.k] ?? 0) + 1;
console.log("\ncause ledger:", Object.entries(kinds).filter(([k]) => k.startsWith("tenant.")).map(([k, n]) => `${k} ${n}`).join(" · "));
const moved = W.filter((ev) => ev.k === "tenant.moved");
for (const ev of moved.slice(-6)) console.log("   ", ev.t);
for (const ev of W.filter((ev) => ev.k === "tenant.downsized" || ev.k === "tenant.leftTown").slice(-3)) console.log("   ", ev.t);

ok("the rent indices are the comps read back", idxChecked > 0 && idxOff === 0, `${idxChecked - idxOff} of ${idxChecked} class-months`);
const last = rows[rows.length - 1];
ok("landlords' asks spread (a market, not one number)", COMM.some((k) => last.asks[k][2] - last.asks[k][0] > 0.05), COMM.map((k) => `${k} ${last.asks[k][0].toFixed(2)}-${last.asks[k][2].toFixed(2)}`).join(", "));
ok("firms that move write why", moved.length > 10 && moved.every((ev) => ev.t.includes("moved to")), `${moved.length} moves written`);
for (const k of COMM) {
  const x = exp[k];
  if (x.sf < 2e5) continue;
  const r = (x.renew + x.later) / x.sf;
  ok(`${k}: renewals at lease end in the studies' range`, r > 0.35 && r < 0.9, `${(r * 100).toFixed(0)}% of ${(x.sf / 1e6).toFixed(2)}M sf`);
}
console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
