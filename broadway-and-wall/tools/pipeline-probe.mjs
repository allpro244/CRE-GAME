// THE PIPELINE AT EACH START DECISION. A REPORT, NOT A GATE.
//
//   pnpm engine
//   SEED=22 YEARS=80 CLASS=multifamily OUT=/some/file.json node tools/pipeline-probe.mjs
//
// Asks whether the builders' lease-up forecast misses space the market could
// see coming. Each year it prints the class's stock, vacancy, the town's
// natural vacancy, the space under construction (`econ.pipeline`), the
// schemes decided and not yet started (`cityPlans`), the queue the space
// market counts (`structTight`) and the demand trend, and the year's starts
// by who decided them. At every start decision (a developer's commitment, a
// street firm's start, a teardown) it records the delivery vacancy
// (market.ts forwardVacancy) as the builder read it — with its own beliefs
// (beliefs.ts beliefOf), and with the town's figures — and the same read with
// the decided-not-started schemes added, then the city's vacancy the year the
// building delivered. The summary is square-foot weighted, by source.
//
// No player; the world is resurrected on gameOver (CLAUDE.md).
import { assertFreshBundle } from "../test/fresh.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeFileSync } from "node:fs";
const HERE = dirname(fileURLToPath(import.meta.url));
assertFreshBundle();
const E = await import(pathToFileURL(join(HERE, "..", "test", ".engine.mjs")).href);
const { makeCity } = await import(pathToFileURL(join(HERE, "..", "src", "citygen", "index.mjs")).href);
const SEED = Number(process.env.SEED ?? 22), YEARS = Number(process.env.YEARS ?? 80);
const K = process.env.CLASS ?? "multifamily";
const pc = (x) => (100 * x).toFixed(1) + "%";

const city = makeCity("somewhere", 1);
E.normalizeParcels(city.parcels);
const bbls = Object.keys(city.parcels);
let g = E.firstListings(E.newGame(SEED, city.parcels), city.parcels, bbls);
const seenQ = new Set(), seenP = new Set();
const decisions = [], rows = [];
let yrSrc = {};
for (let m = 1; m <= YEARS * 12; m++) {
  g = E.advanceQuarter(g, city.parcels, bbls, city.adjacency);
  if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
  const e = g.econ;
  const stock = e.stock?.[K] ?? 0, vac = e.cityVac?.[K] ?? NaN, pipe = e.pipeline?.[K] ?? 0;
  const plans = (g.cityPlans ?? []).filter((p) => p.lead === K).reduce((a, p) => a + (p.sf ?? 0), 0);
  const note = (src, sf, deliverM, ownPlan, who) => {
    const others = Math.max(0, plans - (ownPlan ?? 0)), h = Math.max(1, deliverM - m);
    const bel = E.beliefOf(g, who ? { id: who } : null, K);
    decisions.push({
      m, src, sf, stock, vac, pipe, plans: others, deliverM,
      queue: e.structTight?.[K] ?? 0, townTrend: (e.classDrvTrend?.[K] ?? 0) * h, belVac: bel.vac, belTrend: bel.dg * h,
      fvTown: E.forwardVacancy(e, K, sf, h), fvTownPlans: E.forwardVacancy(e, K, sf + others, h),
      fvBel: E.forwardVacancy(e, K, sf, h, bel), fvBelPlans: E.forwardVacancy(e, K, sf + others, h, bel),
    });
  };
  // a developer's commitment (dev.ts developerLook): it breaks ground at breakM
  // and delivers about two years later; the delivery date is approximate
  for (const p of g.cityPlans ?? []) {
    const id = `${p.bbl}:${p.decidedM}`;
    if (seenP.has(id) || p.lead !== K) continue;
    seenP.add(id); yrSrc.decided = (yrSrc.decided ?? 0) + p.sf;
    note("decided", p.sf, p.breakM + 24, p.sf, p.firmId ?? p.builderId);
  }
  // every start on the supply queue; "city" is a committed scheme breaking ground (counted above)
  for (const q of e.deliveryQueue ?? []) {
    if (seenQ.has(q.id)) continue;
    seenQ.add(q.id);
    const sf = q.sfByUse?.[K] ?? 0;
    if (!(sf > 0) || q.startM < m - 1) continue;
    yrSrc[q.source] = (yrSrc[q.source] ?? 0) + sf;
    if (q.source !== "city") note(q.source, sf, q.deliverM);
  }
  if (m % 12) continue;
  const y = m / 12;
  rows.push({ y, stock, vac, nv: E.normalVac(e, K), pipe, plans, queue: e.structTight?.[K] ?? 0, trendYr: 12 * (e.classDrvTrend?.[K] ?? 0), starts: yrSrc });
  console.log(`y${y} stock ${(stock / 1e6).toFixed(2)}M vac ${pc(vac)} natural ${pc(E.normalVac(e, K))} · building ${(pipe / 1e3).toFixed(0)}k decided ${(plans / 1e3).toFixed(0)}k (${pc((pipe + plans) / Math.max(1, stock))} of stock) · queue ${pc(e.structTight?.[K] ?? 0)} of stock · demand trend ${pc(12 * (e.classDrvTrend?.[K] ?? 0))}/yr · starts ${Object.entries(yrSrc).map(([k, v]) => `${k} ${(v / 1e3).toFixed(0)}k`).join(", ") || "none"}`);
  yrSrc = {};
}

const vacAt = Object.fromEntries(rows.map((r) => [r.y, r.vac]));
for (const d of decisions) d.vacReal = vacAt[Math.ceil(d.deliverM / 12)];
const F = ["fvBel", "fvBelPlans", "fvTown", "fvTownPlans", "vac", "belVac", "queue", "belTrend", "townTrend"];
const by = {};
for (const d of decisions) {
  const b = (by[d.src] ??= { n: 0, sf: 0, real: 0, realSf: 0, plansShare: 0, ...Object.fromEntries(F.map((f) => [f, 0])) });
  b.n++; b.sf += d.sf; b.plansShare += (d.plans / Math.max(1, d.stock)) * d.sf;
  for (const f of F) b[f] += d[f] * d.sf;
  if (Number.isFinite(d.vacReal)) { b.real += d.vacReal * d.sf; b.realSf += d.sf; }
}
console.log(`\nseed ${SEED}, ${K}: at each start decision, square-foot weighted`);
console.log("  read = delivery vacancy (forwardVacancy); +decided = with the decided-not-started schemes added; delivered = city vacancy the year it delivered");
for (const [k, b] of Object.entries(by)) {
  const w = (f) => pc(b[f] / b.sf);
  console.log(`  ${k.padEnd(9)} ${String(b.n).padStart(4)} starts ${(b.sf / 1e6).toFixed(2)}M sf · own beliefs: read ${w("fvBel")}, +decided ${w("fvBelPlans")} · town figures: read ${w("fvTown")}, +decided ${w("fvTownPlans")} · delivered ${pc(b.real / Math.max(1, b.realSf))}`);
  console.log(`  ${"".padEnd(9)} vacancy now ${w("vac")} (believed ${w("belVac")}) · queue ${w("queue")} · demand growth to delivery: believed ${w("belTrend")}, town ${w("townTrend")} · decided-not-started ${pc(b.plansShare / b.sf)} of stock`);
}
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify({ seed: SEED, cls: K, rows, decisions }));
