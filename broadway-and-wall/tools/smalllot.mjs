// CAN A SMALL FIRM FIND A LOT IT CAN AFFORD THAT PENCILS?
//
// A measurement instrument, not a bot. Every year of a 20-year run, on each
// seed, it walks the VACANT LOTS ON THE TAPE, reads the land market's own
// opinion of each (`landRead`: builder residual, holder option, texture floor,
// who won), and plans the best building the Develop desk will draw at the
// ASK — the price the player would actually pay — sweeping use x coverage x
// floors. It records the best hurdle overall and the best among plans a firm
// with START cash can fund (land + closing + equity + points + the 6%
// change-order margin startDevelopment demands).
//
//   node tools/smalllot.mjs                 7 seeds x 20 years, $2.5M
//   SEEDS=3 YEARS=10 START=5e6 node tools/smalllot.mjs
//   DUMP=1 ...                               per-lot lines
//
// Nothing here is tuned. It reports.
import * as E from "../test/.engine.mjs";
import { makeCity } from "../src/citygen/index.mjs";

const ALL_SEEDS = [550991, 12007, 73303, 4242, 91117, 20603, 31337];
const SEEDS = ALL_SEEDS.slice(0, Number(process.env.SEEDS ?? 7));
const YEARS = Number(process.env.YEARS ?? 20);
const START = Number(process.env.START ?? 2_500_000);
const CLOSING = 0.02;
const USES = ["office", "multifamily", "retail", "industrial", "mixed"];
const COVS = [0.35, 0.5, 0.65, 0.8, 0.9];

const med = (a) => { const s = [...a].filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[(s.length - 1) >> 1] : NaN; };
const q = (a, p) => { const s = [...a].filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(p * (s.length - 1))] : NaN; };

function cashNeed(ask, plan) {
  return ask * (1 + CLOSING) + plan.equity + plan.pointsCost + plan.costTotal * 0.06;
}

export function plansFor(g, parcels, bbl, ask) {
  const rec = E.resolveRec(parcels, g, bbl);
  const out = [];
  for (const use of USES) {
    for (const cov of COVS) {
      const top = E.maxFloorsFor(rec, cov, use === "retail" || use === "industrial" ? use : undefined);
      const fls = [...new Set([1, 2, 3, 4, Math.min(top, 6), top].filter((f) => f >= 1 && f <= top))];
      for (const fl of fls) {
        const plan = E.planDevelopment(g, parcels, bbl, use, fl, cov, "gmp", undefined, undefined, undefined, 0.5, ask * (1 + CLOSING));
        if (!plan || !(plan.costTotal > 0)) continue;
        // WHAT THE ZONING WILL HOST. The desk does not ask; the land market
        // does (`zonePermits` in the residual). `lead` reads the dominant use
        // only; `strict` also refuses shops at grade on an R lot.
        const permits = (u) => E.zonePermits(rec.zoneDist, u, rec.demandScore, g.econ);
        const lead = permits(E.dominantOf(plan.mix));
        const strict = Object.entries(plan.mix).every(([u, v]) => !(v > 0) || permits(u));
        out.push({ use, cov, fl, plan, need: cashNeed(ask, plan), lead, strict });
      }
    }
  }
  return out;
}

const bands = [[0, 3000], [3000, 5000], [5000, 8000], [8000, 15000], [15000, Infinity]];
const bandOf = (a) => bands.findIndex(([lo, hi]) => a >= lo && a < hi);
const acc = bands.map(() => ({ n: 0, afford: 0, affordClear: 0, affClearLead: 0, affClearStrict: 0, bestAffLead: [], bestH: [], bestAffH: [], winner: {}, askOverBuilder: [], residNeg: 0, hAtResid: [] }));
const perSeed = [];
const builderPriced = [];

for (const seed of SEEDS) {
  const built = makeCity("somewhere", 1);
  E.normalizeParcels(built.parcels);
  const parcels = built.parcels, bbls = Object.keys(parcels);
  let g = E.firstListings(E.newGame(seed, parcels, START), parcels, bbls);
  let seedBestAff = 0, seedBestAffLot = null;
  for (let m = 0; m < YEARS * 12; m++) {
    g = E.advanceQuarter(g, parcels, bbls, built.adjacency);
    if (g.gameOver) g = { ...g, gameOver: null, cash: START };
    g.cash = START;
    if (m % 12 !== 11) continue;
    for (const l of g.listings) {
      const rec = E.resolveRec(parcels, g, l.bbl);
      if (!rec || rec.class !== "land" || !rec.lotArea) continue;
      const b = acc[bandOf(rec.lotArea)];
      const read = E.landRead(rec, g.econ);
      const ps = plansFor(g, parcels, l.bbl, l.ask);
      if (!ps.length) continue;
      b.n++;
      b.winner[read.winner] = (b.winner[read.winner] ?? 0) + 1;
      if (!(read.builder > 0)) b.residNeg++;
      else b.askOverBuilder.push(l.ask / (read.builder * rec.lotArea));
      const best = ps.reduce((a, x) => (x.plan.hurdleRatio > a.plan.hurdleRatio ? x : a));
      b.bestH.push(best.plan.hurdleRatio);
      const aff = ps.filter((x) => x.need <= START);
      // PRICED FOR A BUILDING YOU CANNOT FINANCE? On a builder-priced lot the
      // ask is the residual of the trade's best scheme; what matters to a small
      // firm is what the best scheme IT can fund plans at on that price.
      if (read.winner === "builder") {
        const bestLegal = ps.filter((x) => x.lead);
        const bl = bestLegal.length ? bestLegal.reduce((a, x) => (x.plan.hurdleRatio > a.plan.hurdleRatio ? x : a)) : null;
        const al = bestLegal.filter((x) => x.need <= START);
        const ba = al.length ? al.reduce((a, x) => (x.plan.hurdleRatio > a.plan.hurdleRatio ? x : a)) : null;
        builderPriced.push({ lot: rec.lotArea, h: bl?.plan.hurdleRatio, need: bl?.need, sf: bl?.plan.sf, hAff: ba?.plan.hurdleRatio });
      }
      if (aff.length) {
        b.afford++;
        const ba = aff.reduce((a, x) => (x.plan.hurdleRatio > a.plan.hurdleRatio ? x : a));
        b.bestAffH.push(ba.plan.hurdleRatio);
        if (ba.plan.hurdleRatio >= 1) b.affordClear++;
        const legal = aff.filter((x) => x.lead);
        if (legal.length) {
          const bl = legal.reduce((a, x) => (x.plan.hurdleRatio > a.plan.hurdleRatio ? x : a));
          b.bestAffLead.push(bl.plan.hurdleRatio);
          if (bl.plan.hurdleRatio >= 1) b.affClearLead++;
          if (process.env.DUMP_CLEAR && bl.plan.hurdleRatio >= 1) console.log(`  clears legally: s${seed} m${m} ${l.bbl} lot ${rec.lotArea} ${rec.zoneDist} ${bl.use} ${bl.plan.floors}fl cov ${bl.plan.coverage} H ${bl.plan.hurdleRatio.toFixed(3)} need $${(bl.need / 1e6).toFixed(2)}M mix ${JSON.stringify(bl.plan.mix)}`);
        }
        if (aff.some((x) => x.strict && x.plan.hurdleRatio >= 1)) b.affClearStrict++;
        if (ba.plan.hurdleRatio > seedBestAff) {
          seedBestAff = ba.plan.hurdleRatio;
          seedBestAffLot = { m, bbl: l.bbl, lot: rec.lotArea, far: E.farMaxFor(rec), ask: l.ask, winner: read.winner, builder: read.builder, use: ba.use, fl: ba.plan.floors, cov: ba.plan.coverage, sf: ba.plan.sf, need: ba.need, h: ba.plan.hurdleRatio };
        }
      }
      // the hurdle the desk shows if the lot were bought AT the builder residual
      if (read.builder > 0 && read.scheme) {
        const atR = plansFor(g, parcels, l.bbl, read.builder * rec.lotArea / (1 + CLOSING));
        if (atR.length) b.hAtResid.push(Math.max(...atR.map((x) => x.plan.hurdleRatio)));
      }
      if (process.env.DUMP) {
        console.log(`s${seed} y${(m + 1) / 12} ${l.bbl} lot ${rec.lotArea} far ${E.farMaxFor(rec).toFixed(1)} ask $${(l.ask / 1e6).toFixed(2)}M ${read.winner} b${read.builder.toFixed(0)} h${read.holder.toFixed(0)} t${read.texture.toFixed(0)} best ${best.use}/${best.plan.floors}fl ${best.plan.hurdleRatio.toFixed(3)} need $${(best.need / 1e6).toFixed(2)}M`);
      }
    }
  }
  perSeed.push({ seed, seedBestAff, seedBestAffLot });
}

console.log(`\nSTART $${(START / 1e6).toFixed(1)}M, ${SEEDS.length} seeds x ${YEARS} yrs, vacant lots on the tape, sampled annually\n`);
console.log("lot sf        n   winner(b/h/t)     resid<=0  ask/resid(med)  bestH med/p90   afford  affH med/max  aff>=1  legal: affH med/max  >=1 lead/strict  H@resid(med)");
for (let i = 0; i < bands.length; i++) {
  const b = acc[i];
  const [lo, hi] = bands[i];
  const w = b.winner;
  console.log(`${String(lo).padStart(5)}-${String(hi === Infinity ? "" : hi).padEnd(6)} ${String(b.n).padStart(4)}   ${String(w.builder ?? 0).padStart(4)}/${String(w.holder ?? 0).padStart(4)}/${String(w.texture ?? 0).padStart(4)}   ${(b.residNeg / Math.max(1, b.n) * 100).toFixed(0).padStart(5)}%   ${med(b.askOverBuilder).toFixed(2).padStart(8)}      ${med(b.bestH).toFixed(3)}/${q(b.bestH, 0.9).toFixed(3)}   ${String(b.afford).padStart(5)}   ${med(b.bestAffH).toFixed(3)}/${(b.bestAffH.length ? Math.max(...b.bestAffH) : NaN).toFixed(3)}  ${String(b.affordClear).padStart(5)}   ${med(b.bestAffLead).toFixed(3)}/${(b.bestAffLead.length ? Math.max(...b.bestAffLead) : NaN).toFixed(3)}   ${String(b.affClearLead).padStart(4)}/${String(b.affClearStrict).padEnd(4)}   ${med(b.hAtResid).toFixed(3)}`);
}
{
  const bp = builderPriced;
  console.log(`\nBUILDER-PRICED listings (ask = the trade's residual), zoning-legal plans: ${bp.length}`);
  console.log(`  best plan: median hurdle ${med(bp.map((x) => x.h)).toFixed(3)}, median cash need $${(med(bp.map((x) => x.need)) / 1e6).toFixed(2)}M, median ${Math.round(med(bp.map((x) => x.sf))).toLocaleString()} gsf`);
  const fundable = bp.filter((x) => x.hAff !== undefined);
  console.log(`  a fundable plan exists on ${fundable.length} of ${bp.length}; best of those: median hurdle ${med(fundable.map((x) => x.hAff)).toFixed(3)}, >=1.0 on ${fundable.filter((x) => x.hAff >= 1).length}; the trade's best plan itself fundable on ${bp.filter((x) => x.need <= START).length}`);
}
console.log("\nbest affordable plan per seed:");
for (const r of perSeed) console.log(`  ${r.seed}: ${r.seedBestAff.toFixed(3)} ${JSON.stringify(r.seedBestAffLot)}`);
