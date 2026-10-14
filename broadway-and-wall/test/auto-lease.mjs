// AUTO-LEASE — the two-instruction policy: rent posture and the fit-out cap.
//
//   pnpm engine && pnpm exec node test/auto-lease.mjs
//
// A GATE on the policy's promises, not on outcomes the tenant draws:
//   - nothing auto-lease signs carries more fit-out than the cap allows
//   - every letter on an auto building is settled the month it lands
//   - a letter inside the policy is signed as written
//   - the cap is stored in opening dollars and read back in today's
//   - the firm's concession limit: nothing signed over the street's package
//     (top on Market, middle on Lean); Generous signs the package as asked
//   - a counter asks for the whole target: nothing signs under the floor
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

let bad = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`);
  if (!ok) bad++;
};
console.log("\nAUTO-LEASE POLICY\n");

const { parcels, bbls } = loadCity(0, E.normalizeParcels);
let g0 = E.firstListings(E.newGame(9001, parcels, 80_000_000), parcels, bbls);
let bbl = null;
for (const minSf of [8_000, 1]) {
  for (const L of g0.listings ?? []) {
    const rec = E.resolveRec(parcels, g0, L.bbl);
    if (!rec || rec.class === "land" || rec.class === "multifamily" || L.ask > g0.cash || !(rec.bldgArea >= minSf)) continue;
    const r = E.executePurchase(g0, parcels, L.bbl, L.ask, "cash", false, 1);
    if (!r.err) { g0 = r.s; bbl = L.bbl; break; }
  }
  if (bbl) break;
}
if (!bbl) throw new Error("no commercial building");
const rec = E.resolveRec(parcels, g0, bbl);
const use = rec.class === "retail" ? "retail" : rec.class === "industrial" ? "industrial" : "office";
g0.holdings[bbl].tenants = [];
g0.lois = [];
g0.asks = [];
g0.cash = Math.max(g0.cash, 50_000_000);
const market = E.managedRentPsfYr(rec, g0.econ, g0.holdings[bbl], use) || 40;
const suite = Math.min(Math.round(rec.bldgArea * 0.5), Math.max(1500, Math.round(rec.bldgArea * 0.2)));
const ci = g0.econ.costIdx ?? 1;

const letter = (id, over) => ({
  id, bbl, kind: "new", use, name: `Tenant ${id}`, sector: "tech", credit: 1, sf: suite,
  rentPsf: +market.toFixed(2), termM: 120, tiPsf: 40, freeM: 0, net: true,
  expiresM: g0.month + 3, arrivedM: g0.month, ...over,
});
const fresh = (stance, capToday, l, seed, conc) => {
  let g = structuredClone(g0);
  if (conc) g.autoConcessions = conc;
  // each trial its own world draw, or every clone replays one tenant reaction
  if (seed !== undefined) { if (g.streams) g.streams.econ = (g.streams.econ ?? g.rng) ^ (seed * 2654435761); else g.rng ^= seed * 2654435761; }
  g.holdings[bbl].stance = stance;
  g.lois = [l];
  if (capToday !== undefined) g = E.setAutoTiCap(g, parcels, bbl, capToday);
  return E.setAutoLease(g, parcels, bbl, true);
};
const signedTi = (g) => {
  const n = g.news.find((x) => x.text.startsWith("Auto-lease signed"));
  if (!n) return null;
  const m = n.text.match(/\$(\d+)\/sf fit-out/);
  return m ? Number(m[1]) : 0;
};

// cap round-trip
{
  const g = E.setAutoTiCap(structuredClone(g0), parcels, bbl, 4);
  check(Math.abs(g.holdings[bbl].autoTiCapPsfYr - 4 / ci) < 1e-9, `cap stored in opening dollars (4 / costIdx ${ci.toFixed(3)})`);
  check(Math.abs(E.autoTiCapToday(g, g.holdings[bbl]) - 4) < 1e-9, "cap reads back as $4.00 today");
  const off = E.setAutoTiCap(g, parcels, bbl, undefined);
  check(off.holdings[bbl].autoTiCapPsfYr === undefined, "No cap lifts it");
  check(/\$4\.00\/sf of fit-out per lease year/.test(E.autoLeaseRule(g, g.holdings[bbl])), "the one-line rule names the cap");
}

// inside the policy: signed as written
// TI here is sized to the building's rent (an allowance of ~5-15% of a year's
// rent per lease year is the broker-survey shape), so the fixture works on a
// cheap loft and a tower alike.
{
  const ti = Math.round(market * 0.05 * 10);           // 5% of rent per year, 10 years
  const g = fresh(0, market * 0.1, letter(1, { tiPsf: ti, rentPsf: +(market * 1.05).toFixed(2) }));
  check(signedTi(g) === ti && g.lois.length === 0, `Market, $${ti} TI under the cap, 5% over market → signed as written (got ${signedTi(g)})`);
}
{
  const g = fresh(-1, undefined, letter(2, { tiPsf: Math.round(market * 2), rentPsf: +(market * 0.7).toFixed(2) }), undefined, "generous");
  check(signedTi(g) === Math.round(market * 2), `Fill, Generous, rich TI at 70% of market → signed as written (got ${signedTi(g)})`);
}
// THE FIRM'S CONCESSION LIMIT, against the street's package for the letter
{
  const pkgOf = (g, l) => E.streetPackage(g, rec, g.holdings[bbl], l);
  for (const conc of ["market", "lean"]) {
    let n = 0, signedN = 0, overTi = 0, overFree = 0;
    for (let i = 0; i < 60; i++) {
      const termM = 36 + 12 * (i % 8);
      const l = letter(2000 + i, {
        termM, credit: i % 3,
        tiPsf: Math.round(market * (0.3 + 0.15 * (i % 7)) * termM / 12),   // from modest to outsized
        freeM: Math.round((termM / 12) * (0.2 + 0.3 * (i % 5))),
        rentPsf: +(market * (0.9 + 0.04 * (i % 5))).toFixed(2),
      });
      const g = fresh(i % 3 - 1, undefined, l, 7 + i, conc);
      const pkg = pkgOf(g0, l);
      const lim = conc === "lean" ? { ti: pkg.tiMid, free: pkg.freeMid } : { ti: pkg.tiTop, free: pkg.freeTop };
      n++;
      const ti = signedTi(g);
      if (ti === null) continue;
      signedN++;
      const t = g.holdings[bbl].tenants.find((x) => x.name === l.name);
      const free = t ? Math.max(0, (t.freeUntilM ?? t.startM) - t.startM) : 0;
      if (ti > Math.ceil(lim.ti)) overTi++;
      if (free > Math.ceil(lim.free - 1e-9)) overFree++;
    }
    check(overTi === 0 && overFree === 0, `${conc}: ${signedN} of ${n} letters signed; none over the street's ${conc === "lean" ? "typical" : "top-of-range"} package (${overTi} over on fit-out, ${overFree} on free rent)`);
  }
}
// THE COUNTER ASKS FOR THE WHOLE TARGET: lowballs on Push never sign under its floor
{
  let n = 0, under = 0;
  for (let i = 0; i < 80; i++) {
    const l = letter(3000 + i, { tiPsf: 0, freeM: 0, rentPsf: +(market * (0.35 + 0.01 * (i % 30))).toFixed(2) });
    const g = fresh(1, undefined, l, 11 + i);
    const line = g.news.find((x) => x.text.startsWith("Auto-lease signed"));
    if (!line) continue;
    n++;
    const nets = Number(line.text.match(/nets (\d+)% of a market deal/)?.[1]);
    if (!(nets >= 100)) under++;
  }
  check(under === 0, `Push, lowballs at 35-64% of market: ${n} of 80 signed, none under a market deal (${under} under)`);
}

// over the cap: never signed above it, always settled
let trials = 0, signed = 0, over = 0, open = 0;
for (const stance of [-1, 0, 1]) {
  for (let i = 0; i < 60; i++) {
    const cap = +(market * (0.04 + 0.02 * (i % 5))).toFixed(2);   // 4-12% of rent per lease year
    const termM = 36 + 12 * (i % 8);
    const l = letter(1000 + i, {
      termM, tiPsf: Math.round(cap * (1.3 + 0.2 * (i % 4)) * termM / 12) + 1,   // always over the cap
      rentPsf: +(market * (0.8 + 0.05 * (i % 6))).toFixed(2),
    });
    const g = fresh(stance, cap, l, 1 + i + 100 * (stance + 1));
    trials++;
    if (g.lois.length) open++;
    const ti = signedTi(g);
    if (ti !== null) {
      signed++;
      if (ti > Math.round(cap * termM / 12)) over++;
    }
  }
}
check(over === 0, `${signed} of ${trials} over-cap letters signed; none above the cap (${over} over)`);
check(open === 0, `every letter settled the month it landed (${open} left on the desk)`);
check(signed > 0, "some over-cap tenants take the trimmed allowance");

// NEVER BELOW MARKET RENT: on every posture, Fill included, nothing signs under the space's market rent
{
  let n = 0, under = 0, signedN = 0;
  for (const stance of [-1, 0, 1]) {
    for (let i = 0; i < 40; i++) {
      const l = letter(4000 + i + 100 * (stance + 1), { tiPsf: 0, freeM: 0, rentPsf: +(market * (0.6 + 0.012 * i)).toFixed(2) });
      let g = structuredClone(g0);
      if (g.streams) g.streams.econ = (g.streams.econ ?? g.rng) ^ ((900 + i + 50 * stance) * 2654435761); else g.rng ^= (900 + i + 50 * stance) * 2654435761;
      g.holdings[bbl].stance = stance;
      g.lois = [l];
      g.autoRentFloor = true;
      const floorPsf = E.autoMarketRentPsf(g, rec, g.holdings[bbl], l);
      g = E.setAutoLease(g, parcels, bbl, true);
      n++;
      const line = g.news.find((x) => x.text.startsWith("Auto-lease signed"));
      if (!line) continue;
      signedN++;
      const rent = Number(line.text.match(/sf at \$([\d.]+)\/sf/)?.[1]);
      if (!(rent + 0.005 >= floorPsf)) under++;
    }
  }
  check(under === 0 && signedN > 0, `never below market rent: ${signedN} of ${n} lowballs (60-107% of market, all three postures) signed, none under the market rent (${under} under)`);
}

console.log(bad ? `\n${bad} FAILED\n` : "\nall OK\n");
process.exit(bad ? 1 : 0);
