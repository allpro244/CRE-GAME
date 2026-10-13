// AUTO-LEASE — the two-instruction policy: rent posture and the fit-out cap.
//
//   pnpm engine && pnpm exec node test/auto-lease.mjs
//
// A GATE on the policy's promises, not on outcomes the tenant draws:
//   - nothing auto-lease signs carries more fit-out than the cap allows
//   - every letter on an auto building is settled the month it lands
//   - a letter inside the policy is signed as written
//   - the cap is stored in opening dollars and read back in today's
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
const fresh = (stance, capToday, l, seed) => {
  let g = structuredClone(g0);
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
  check(/fit-out up to \$4\.00/.test(E.autoLeaseRule(g, g.holdings[bbl])), "the one-line rule names the cap");
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
  const g = fresh(-1, undefined, letter(2, { tiPsf: Math.round(market * 2), rentPsf: +(market * 0.7).toFixed(2) }));
  check(signedTi(g) === Math.round(market * 2), `Fill, no cap, rich TI at 70% of market → signed as written (got ${signedTi(g)})`);
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

console.log(bad ? `\n${bad} FAILED\n` : "\nall OK\n");
process.exit(bad ? 1 : 0);
