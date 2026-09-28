// THE COST LINES, SMALL LOT AGAINST LARGE — companion to tools/smalllot.mjs.
//
// At year Y of each seed, for every vacant lot in the city (listed or not), it
// solves the DESK's residual — the most the Develop desk's best scheme could
// pay for the dirt and still clear hurdle 1.0, over the same use x coverage x
// floors sweep a player has — and sets it beside the ENGINE's residual
// (`landRead(...).builder`, which prices the tape). Then it breaks the desk's
// best scheme into cost lines per RENTABLE foot, by lot-size band.
//
//   node tools/smalllot-lines.mjs           4 seeds, year 10
//   SEEDS=2 YEAR=15 node tools/smalllot-lines.mjs
const E = await import(process.env.ENGINE ?? "../test/.engine.mjs");
import { makeCity } from "../src/citygen/index.mjs";

const ALL_SEEDS = [550991, 12007, 73303, 4242, 91117, 20603, 31337];
const SEEDS = ALL_SEEDS.slice(0, Number(process.env.SEEDS ?? 4));
const YEAR = Number(process.env.YEAR ?? 10);
const USES = (process.env.USES ?? "office,multifamily,retail,industrial,mixed").split(",");
const COVS = (process.env.COVS ?? "0.35,0.5,0.65,0.8,0.9").split(",").map(Number);
const med = (a) => { const s = [...a].filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[(s.length - 1) >> 1] : NaN; };

const bands = [[0, 3000], [3000, 5000], [5000, 8000], [8000, 15000], [15000, Infinity]];
const bandOf = (a) => bands.findIndex(([lo, hi]) => a >= lo && a < hi);
const rows = bands.map(() => []);

for (const seed of SEEDS) {
  const built = makeCity("somewhere", 1);
  E.normalizeParcels(built.parcels);
  const parcels = built.parcels, bbls = Object.keys(parcels);
  let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  for (let m = 0; m < YEAR * 12; m++) {
    g = E.advanceQuarter(g, parcels, bbls, built.adjacency);
    if (g.gameOver) g = { ...g, gameOver: null, cash: 2.5e6 };
  }
  for (const bbl of bbls) {
    const rec = E.resolveRec(parcels, g, bbl);
    if (!rec || rec.class !== "land" || !rec.lotArea || g.holdings[bbl] || g.developments[bbl]) continue;
    const read = E.landRead(rec, g.econ);
    let best = null;
    const permits = (u) => E.zonePermits(rec.zoneDist, u, rec.demandScore, g.econ);
    for (const use of USES) {
      // LEGAL=1 asks only what the zoning hosts — the question the land market asks.
      if (process.env.LEGAL && (use === "mixed" ? !["office", "retail", "multifamily"].every(permits) : !permits(use))) continue;
      for (const cov of COVS) {
        const top = E.maxFloorsFor(rec, cov, use === "retail" || use === "industrial" ? use : undefined);
        for (const fl of [...new Set([1, 2, 3, 4, Math.min(top, 6), Math.min(top, 8), top].filter((f) => f >= 1 && f <= top))]) {
          const p = E.planDevelopment(g, parcels, bbl, use, fl, cov, "gmp", undefined, undefined, undefined, 0.5, 0);
          if (!p || !(p.requiredYield > 0)) continue;
          const nonLand = p.basisTotal - p.landBasis - p.landCarry;
          const carry = E.landCarryFactor(p.months);
          const resid = ((p.stabNoi / (p.requiredYield / 100)) - nonLand) / (1 + carry);
          if (!best || resid > best.resid) best = { use, cov, fl, p, resid, carry };
        }
      }
    }
    if (!best) continue;
    const p = best.p;
    const rentable = E.rentableFromSpec(p.sf, p.floors);
    rows[bandOf(rec.lotArea)].push({
      lot: rec.lotArea, ask: E.landValue(rec, g.econ) / rec.lotArea, engine: read.builder, winner: read.winner,
      desk: best.resid / rec.lotArea, use: best.use, fl: p.floors, cov: p.coverage, gsf: p.sf, eff: rentable / p.sf,
      hard: p.hardCost / rentable, soft: p.softCost / rentable, cont: p.contingency / rentable, lease: p.leaseUp / rentable,
      ir: p.interestReserve / rentable, pts: p.pointsCost / rentable, months: p.months, carry: best.carry,
      noi: p.stabNoi / rentable, ey: p.exitYield, yocEx: p.yieldOnCostExLand,
      hAtAsk: (() => {
        const L = E.landValue(rec, g.econ);
        const basis = p.basisTotal - p.landBasis - p.landCarry + L * (1 + best.carry);
        return (p.stabNoi / basis) / (p.requiredYield / 100);
      })(),
    });
  }
}

const f = (x, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : "—");
console.log(`\nVacant lots, unowned, year ${YEAR}, ${SEEDS.length} seeds. $ per RENTABLE sf unless noted; medians.\n`);
console.log("lot sf         n  askPsf  engResid  deskResid  desk>eng  deskRes<=0  use(mode)     fl   eff   hard  soft cont lease  IR  pts  mo  NOI   exitY  YoCexL  H@ask");
for (let i = 0; i < bands.length; i++) {
  const r = rows[i];
  if (!r.length) continue;
  const m = (k) => med(r.map((x) => x[k]));
  const modes = {};
  for (const x of r) modes[x.use] = (modes[x.use] ?? 0) + 1;
  const mode = Object.entries(modes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k.slice(0, 3)}${v}`).join(",");
  const [lo, hi] = bands[i];
  console.log(`${String(lo).padStart(5)}-${String(hi === Infinity ? "" : hi).padEnd(6)} ${String(r.length).padStart(4)}  ${f(m("ask")).padStart(6)}  ${f(m("engine")).padStart(8)}  ${f(m("desk")).padStart(9)}  ${f(r.filter((x) => x.desk > Math.max(0, x.engine) + 1).length / r.length * 100).padStart(6)}%  ${f(r.filter((x) => x.desk <= 0).length / r.length * 100).padStart(8)}%   ${mode.padEnd(22)} ${f(m("fl"))}  ${f(m("eff"), 2)}  ${f(m("hard"))}  ${f(m("soft"))}  ${f(m("cont"))}  ${f(m("lease"))}  ${f(m("ir"))}  ${f(m("pts"))}  ${f(m("months"))}  ${f(m("noi"), 1)}  ${f(m("ey"), 2)}  ${f(m("yocEx"), 2)}  ${f(m("hAtAsk"), 2)}`);
}
if (process.env.DUMP) for (const r of rows.flat()) console.log(JSON.stringify(r));
