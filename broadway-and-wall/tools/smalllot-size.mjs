// THE SAME LOT AT DIFFERENT SIZES — companion to tools/smalllot.mjs.
//
// Big vacant lots in the generated city sit in better places with bigger
// envelopes (vacant 8k+ sf lots: demand ~43, FAR ~13; under 8k: demand ~32,
// FAR ~6), so a table by lot size mixes size with location. This holds the
// location, the zoning and the market fixed and changes ONLY lotArea: every
// vacant lot at year Y is re-read at each size, and the engine residual
// (`landRead`, which prices the tape) and the desk's best scheme are reported
// with their cost lines per rentable foot.
//
//   node tools/smalllot-size.mjs              2 seeds, year 10, multifamily lines
//   LINE_USE=office SEEDS=3 node tools/smalllot-size.mjs
import * as E from "../test/.engine.mjs";
import { makeCity } from "../src/citygen/index.mjs";

const ALL_SEEDS = [550991, 12007, 73303, 4242, 91117, 20603, 31337];
const SEEDS = ALL_SEEDS.slice(0, Number(process.env.SEEDS ?? 2));
const YEAR = Number(process.env.YEAR ?? 10);
const SIZES = [2000, 3000, 4500, 7000, 10000, 15000, 25000];
const LINE_USE = process.env.LINE_USE ?? "multifamily";
const LINE_FL = Number(process.env.LINE_FL ?? 5);
const LINE_COV = Number(process.env.LINE_COV ?? 0.7);
const med = (a) => { const s = [...a].filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[(s.length - 1) >> 1] : NaN; };
const f = (x, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : "—");

const acc = Object.fromEntries(SIZES.map((z) => [z, []]));
for (const seed of SEEDS) {
  const built = makeCity("somewhere", 1);
  E.normalizeParcels(built.parcels);
  const parcels = built.parcels, bbls = Object.keys(parcels);
  let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  for (let m = 0; m < YEAR * 12; m++) {
    g = E.advanceQuarter(g, parcels, bbls, built.adjacency);
    if (g.gameOver) g = { ...g, gameOver: null, cash: 2.5e6 };
  }
  const uw = E.underwritingEcon(g.econ, 1);
  const quote = (mix, pre) => E.marketConstructionQuote(g.econ, mix, pre);
  for (const bbl of bbls) {
    const base = E.resolveRec(parcels, g, bbl);
    if (!base || base.class !== "land" || !base.lotArea) continue;
    for (const z of SIZES) {
      const rec = { ...base, lotArea: z, bbl: `${bbl}~${z}` };
      const read = E.landRead(rec, g.econ);
      const pf = E.developmentProForma(rec, g.econ, { use: LINE_USE, floors: LINE_FL, coverage: LINE_COV, contract: "gmp", spec: 0.5, asIfVacant: true, uw, quote });
      if (!pf) { acc[z].push({ engine: read.builder, texture: read.texture, winner: read.winner }); continue; }
      const value = pf.stabNoi / (pf.exitYieldPct / 100);
      const resid = (value / (1 + E.DEV_MARGIN) - pf.nonLandBasis) / (1 + pf.landCarryRate) / z;
      const rent = pf.rentable;
      acc[z].push({
        engine: read.builder, texture: read.texture, winner: read.winner, schemeUse: read.scheme?.use,
        resid, fl: pf.floors, plate: pf.gsf / pf.floors, eff: rent / pf.gsf, months: pf.months,
        hard: pf.hardCost / rent, soft: pf.softCost / rent, cont: pf.contingency / rent, lease: pf.leaseUp / rent,
        ir: pf.interestReserve / rent, pts: pf.pointsCost / rent, noi: pf.stabNoi / rent, ey: pf.exitYieldPct,
        valueR: value / rent, nonLandR: pf.nonLandBasis / rent,
        yocEx: pf.stabNoi / pf.nonLandBasis * 100,
      });
    }
  }
}

console.log(`\nEvery vacant lot re-read at each size, location/zoning/market held. ${SEEDS.length} seeds, year ${YEAR}. Medians.`);
console.log(`Engine residual = landRead builder bid ($/sf land). Lines: ${LINE_USE}, ${LINE_FL} fl requested @ ${LINE_COV} coverage, $/rentable sf.\n`);
console.log("lotSf    n  engResid  resid>0  texture  win(b/h/t)      | fl  plate  eff   hard soft cont lease  IR pts  mo   NOI   value  nonLand  exitY  YoCexL  thisResid");
for (const z of SIZES) {
  const r = acc[z];
  const m = (k) => med(r.map((x) => x[k]));
  const w = { builder: 0, holder: 0, texture: 0 };
  for (const x of r) w[x.winner]++;
  console.log(`${String(z).padStart(6)} ${String(r.length).padStart(4)}  ${f(m("engine")).padStart(7)}  ${f(r.filter((x) => x.engine > 0).length / r.length * 100).padStart(5)}%  ${f(m("texture")).padStart(6)}   ${w.builder}/${w.holder}/${w.texture}`.padEnd(66)
    + `| ${f(m("fl"))}  ${f(m("plate")).padStart(5)}  ${f(m("eff"), 2)}  ${f(m("hard"))}  ${f(m("soft"))}  ${f(m("cont"))}  ${f(m("lease"))}  ${f(m("ir"))}  ${f(m("pts"))}  ${f(m("months"))}  ${f(m("noi"), 1)}  ${f(m("valueR"))}  ${f(m("nonLandR"))}  ${f(m("ey"), 2)}  ${f(m("yocEx"), 2)}  ${f(m("resid"))}`);
}
