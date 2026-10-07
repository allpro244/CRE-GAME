// MDGA instrument — THE LAND TAPE, measured (MDGA_PLAN.md, finding F3/F4).
// Every five years of a 50-year run with no player: vacant lots, vacant lots
// listed, how many of those have a positive builder residual, their ask over
// that residual, how many pencil at the ask, the smallest equity cheque that
// builds one, city starts per year, and who sets the price of vacant dirt
// (builder residual / holder option / comp texture floor).
//   pnpm engine && node tools/mdga/landtape.mjs        SEED=… to vary
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, "..", "..", "test", ".engine.mjs"));
const { loadCity } = await import(join(HERE, "..", "..", "test", "city.mjs"));
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);
const SEED = Number(process.env.SEED ?? 7919);
let g = E.firstListings(E.newGame(SEED, parcels), parcels, bbls);
g = { ...g, cash: 5e6 };
const USES = ["multifamily", "office", "retail", "industrial"];
const best = (g, bbl, basis) => {
  const rec = E.resolveRec(parcels, g, bbl);
  let h = 0, eq = Infinity;
  for (const use of USES) {
    if (E.zoneUseBar(rec, use, g.econ)) continue;
    const top = E.MAX_COVERAGE[use] ?? 0.7;
    for (const cov of [0.55, top]) {
      const maxFl = E.maxFloorsFor(rec, cov, use);
      for (const fl of [...new Set([1, 2, 3, 4, 6, 8, 12, 16, 24, 32, maxFl])].filter((f) => f >= 1 && f <= maxFl)) {
        const p = E.planDevelopment(g, parcels, bbl, use, fl, cov, "gmp", undefined, undefined, undefined, 0.5, basis);
        if (!p || !Number.isFinite(p.hurdleRatio)) continue;
        if (p.hurdleRatio > h) { h = p.hurdleRatio; }
        if (p.hurdleRatio >= 1) eq = Math.min(eq, p.equity + p.pointsCost + p.costTotal * 0.06);
      }
    }
  }
  return { h, eq };
};
const vacantAll = () => bbls.filter((b) => !g.holdings[b] && E.resolveRec(parcels, g, b)?.class === "land").length;
console.log("yr | vacant lots | land listed (snap) | of which builder residual>0 | ask/residual (median, pencil lots) | pencil at ask | min equity to build one that pencils | city starts/yr | winner mix (builder/holder/texture) of ALL vacant");
let starts = 0;
const seenJobs = new Set();
for (let m = 1; m <= 600; m++) {
  g = E.advanceMonth(g, parcels, bbls, adjacency);
  if (g.gameOver) g = { ...g, gameOver: null, cash: 5e6 };
  for (const j of g.cityJobs ?? []) { const k = j.bbl + ":" + j.startM; if (!seenJobs.has(k)) { seenJobs.add(k); starts++; } }
  if (m % 60 === 0) {
    const listed = g.listings.filter((l) => E.resolveRec(parcels, g, l.bbl)?.class === "land");
    let pos = 0, pen = 0, minEq = Infinity; const ratios = [];
    for (const l of listed) {
      const rec = E.resolveRec(parcels, g, l.bbl);
      const lr = E.landRead(rec, g.econ);
      if (lr.builder > 0) { pos++; ratios.push((l.ask / rec.lotArea) / lr.builder); }
      const b = best(g, l.bbl, l.ask * 1.02);
      if (b.h >= 1) { pen++; minEq = Math.min(minEq, b.eq); }
    }
    ratios.sort((a, b) => a - b);
    const win = { builder: 0, holder: 0, texture: 0 };
    let n = 0;
    for (const b of bbls) { if (n > 2000) break; const rec = E.resolveRec(parcels, g, b); if (rec?.class !== "land" || g.holdings[b]) continue; n++; win[E.landRead(rec, g.econ).winner]++; }
    console.log(`${String(m / 12).padStart(2)} | ${String(vacantAll()).padStart(4)} | ${String(listed.length).padStart(3)} | ${String(pos).padStart(3)} | ${ratios.length ? ratios[Math.floor(ratios.length / 2)].toFixed(2) : "—"} | ${pen} | ${Number.isFinite(minEq) ? "$" + (minEq / 1e6).toFixed(1) + "M" : "—"} | ${(starts / 5).toFixed(0)} | ${win.builder}/${win.holder}/${win.texture}`);
    starts = 0;
  }
}
