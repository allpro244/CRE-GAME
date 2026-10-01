// WHY NAMED FIRMS DO NOT TAKE THE CITY'S JOBS — for every anonymous start in
// an unplayed run, which of claimJob's gates each building firm fails.
//
//   pnpm engine && SEEDS=7777 MONTHS=600 node tools/claim-gates.mjs
//
// Gates, in claimJob's order: appetite (style builds at all), jobs (live-frame
// cap), size (project > 0.9 AUM + 5x cash), cash (day-one equity + reserve).
// A firm that passes all four is "eligible" and then faces the monthly roll.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(process.env.ENGINE ? (process.env.ENGINE.startsWith("/") ? process.env.ENGINE : join(HERE, "..", process.env.ENGINE)) : join(HERE, "..", "test", ".engine.mjs"));
const { loadCity } = await import(join(HERE, "..", "test", "city.mjs"));
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);
const seeds = (process.env.SEEDS ?? "7777").split(",").map(Number);
const MONTHS = +(process.env.MONTHS ?? 600);
const q = (xs, p) => { const a = xs.slice().sort((x, y) => x - y); return a.length ? a[Math.floor((a.length - 1) * p)] : NaN; };
for (const seed of seeds) {
  let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  const seen = new Set((g.cityJobs ?? []).map((j) => j.bbl + ":" + j.startM));
  const fail = { jobs: 0, size: 0, cash: 0, eligible: 0 };
  let jobsN = 0, withEligible = 0, claimed = 0;
  const projectCosts = [], dayOnes = [], firmCash = [], firmAum = [];
  for (let m = 0; m < MONTHS; m++) {
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
    const snap = new Map((g.rivals ?? []).map((r) => [r.id, { cash: r.cash, aum: r.aum ?? 0, style: r.style, live: (g.cityJobs ?? []).filter((j) => j.firmId === r.id && !j.orphaned).length }]));
    g = E.advanceQuarter(g, parcels, bbls, adjacency);
    for (const j of g.cityJobs ?? []) {
      const k = j.bbl + ":" + j.startM;
      if (seen.has(k)) continue;
      seen.add(k);
      if (j.startM !== g.month - 1 && j.startM !== g.month) continue;
      const firm = j.firmId ? (g.rivals ?? []).find((r) => r.id === j.firmId) : null;
      const own = firm && (g.news ?? []).some((n) => n.q === g.month && n.text.startsWith(firm.name) && /own land|tearing down/.test(n.text));
      if (own) continue;
      jobsN++;
      if (j.firmId) claimed++;
      const u = E.underwriteDevelopment(g, parcels, j.bbl, j.use, j.floors, E.cityCoverage(j.use));
      if (!u) continue;
      const projectCost = u.plan.costTotal + u.plan.landBasis;
      const dayOne = Math.round(projectCost * (1 - u.plan.ltc) * 0.4);
      projectCosts.push(projectCost / 1e6); dayOnes.push(dayOne / 1e6);
      let any = false;
      for (const [id, r] of snap) {
        if (!(E.buildAppetite(r.style) > 0)) continue;
        const rv = (g.rivals ?? []).find((x) => x.id === id);
        if (!rv || rv.failedM !== undefined) continue;
        firmCash.push(r.cash / 1e6); firmAum.push(r.aum / 1e6);
        if (r.live >= E.liveJobCap(r.style)) { fail.jobs++; continue; }
        if (projectCost > r.aum * 0.9 + r.cash * 5) { fail.size++; continue; }
        if (r.cash < dayOne + Math.max(400_000, r.cash * 0.04)) {
          fail.cash++;
          // would the firm's corporate line (the one rivalBuys draws) cover it?
          const room = Math.max(0, E.lineRoom(g, rv, rv.aum ?? 0, rv.markNoi ?? 0, rv.markLand ?? 0));
          if (r.cash + room >= dayOne + 400_000) fail.lineWould = (fail.lineWould ?? 0) + 1;
          continue;
        }
        fail.eligible++; any = true; (fail.by ??= {})[r.style] = (fail.by[r.style] ?? 0) + 1;
      }
      if (any) withEligible++;
    }
  }
  console.log(`seed ${seed} ${MONTHS}m: city-pipeline starts ${jobsN}, claimed ${claimed}, with >=1 eligible firm ${withEligible}`);
  console.log(`  firm-job pairs failing: jobs ${fail.jobs} size ${fail.size} cash ${fail.cash} (line would cover ${fail.lineWould ?? 0}) eligible ${fail.eligible} ${JSON.stringify(fail.by)}`);
  console.log(`  project cost $M p10/50/90 ${q(projectCosts, .1).toFixed(1)}/${q(projectCosts, .5).toFixed(1)}/${q(projectCosts, .9).toFixed(1)}`
    + `  day-one $M ${q(dayOnes, .1).toFixed(2)}/${q(dayOnes, .5).toFixed(2)}/${q(dayOnes, .9).toFixed(2)}`
    + `  builder cash $M ${q(firmCash, .1).toFixed(2)}/${q(firmCash, .5).toFixed(2)}/${q(firmCash, .9).toFixed(2)}`
    + `  builder AUM $M ${q(firmAum, .1).toFixed(1)}/${q(firmAum, .5).toFixed(1)}/${q(firmAum, .9).toFixed(1)}`);
}
