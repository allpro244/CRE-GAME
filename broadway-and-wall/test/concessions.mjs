// WHAT TENANTS ASK FOR, AND WHAT GETS SIGNED — against the business.
//
//   pnpm engine && pnpm concessions
//   SEEDS=550991,12007 HZ=240 pnpm concessions
//
// A REPORT, NOT A GATE. The owner's read after a playthrough: "tenants often
// ask for more free rent and TI than real life — TI especially on second-
// generation space". That is a hypothesis; this measures it.
//
// Fixture: the same gifted commercial book desk-vs-principal uses (gifting
// spends no world-stream draws). The principal answers every letter with one
// fixed, ordinary policy, so "signed" is comparable across builds:
// take anything netting 95% of market, counter the rest to market with three
// quarters of the allowance, let anything under 60% go.
//
// ANCHORS, WRITTEN BEFORE THE FIRST RUN (CLAUDE.md: state the band, then
// measure). All TI is deflated by econ.costIdx so a 2040 dollar reads like an
// opening one. Ranges are US broker-survey shapes (CBRE / Cushman / JLL TI and
// concession benchmarks, 2005-2019 averages; post-2020 CBD class A ran higher
// and is not the anchor):
//
//   A1 free rent, months per year of term, opening ask:
//        tight market   0.0-0.4     balanced  0.4-1.0     glut  1.0-1.6
//   A2 office TI, $/sf per year of term, NEW lease:
//        second generation, fit-out under ~5 yrs old (usable as it stands,
//          paint/carpet/minor rework)                          0.5-2.0
//        second generation, fit-out ~10+ yrs old (demo and rebuild)  3.0-6.0
//        first generation (shell)                       ~1.6-2.0x the latter
//   A3 retail TI 1.0-3.0 $/sf/yr; industrial 0.3-1.0 $/sf/yr (second gen)
//   A4 how often a market is in glut: concession dial above 0.5 well under
//      half the time over a long run — a market that lives in a glut is a
//      market-balance fault, not a leasing one (GLUT_FINDINGS_2026-08.md).
//
// The second-generation split is the point. The engine records `fitM` on a
// tenant (when the suite was last fitted). When a tenant leaves, this probe
// remembers that age against the building; the next letter on that use is
// tagged with the age of what was left behind. Space that was vacant from the
// rent roll the fixture was gifted with has no known fit-out and is tagged
// "unknown".
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);
const SEEDS = (process.env.SEEDS ?? "550991,12007,73303,4242").split(",").map(Number);
const HZ = Number(process.env.HZ ?? 240);
const TARGET_SUITES = Number(process.env.SUITES ?? 100);

const q = (a, p) => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : NaN);
const f2 = (n) => (Number.isFinite(n) ? n.toFixed(2) : "  - ");
const commercialSuites = (rec) => {
  let n = 0;
  for (const u of E.leasableUses(rec)) {
    const sf = E.useSf(rec, u);
    if (sf > 0) n += Math.max(1, Math.round(sf / E.typicalSuiteSf(rec, u)));
  }
  return n;
};

function takeBook(g0) {
  const g = structuredClone(g0);
  g.cash = Math.max(g.cash, 80e6);
  let suites = 0;
  const cands = bbls.map((b) => E.resolveRec(parcels, g, b))
    .filter((rec) => rec && rec.bldgArea > 0 && E.isCommercial(rec) && !g.holdings[rec.bbl] && !E.isCivicLand(g, rec.bbl))
    .sort((a, b) => a.bbl.localeCompare(b.bbl));
  for (const rec of cands) {
    const n = commercialSuites(rec);
    if (n <= 0) continue;
    const worth = E.assetValue(rec, g.econ, E.initialCondition(rec));
    const grade = E.gradeOf(g, rec);
    const holding = {
      bbl: rec.bbl, boughtM: g.month, costBasis: worth, assessed: worth, loan: null,
      condition: grade, condIdx: E.initialCondIdx(rec, g.month, grade),
      service: 0, stance: 0, plan: 1, svcIdx: 0.55, tenants: [], cfHistory: [],
    };
    E.genRentRoll(g, rec, holding, false, true);
    g.holdings[rec.bbl] = holding;
    E.clearRivalClaims(g, rec.bbl);
    g.listings = (g.listings ?? []).filter((l) => l.bbl !== rec.bbl);
    suites += n;
    if (suites >= TARGET_SUITES) break;
  }
  return g;
}

const rows = [];     // opening asks
const signed = [];   // what the policy signed
const dial = { tight: 0, balanced: 0, glut: 0, n: 0 };
const bucket = (c) => (c < 0.6 ? "tight" : c <= 1.4 ? "balanced" : "glut");

for (const seed of SEEDS) {
  let g = takeBook(E.firstListings(E.newGame(seed, parcels, 2_500_000), parcels, bbls));
  const seen = new Set();
  const leftFit = {}; // `${bbl}:${use}` -> [{ sf, fitM, leftM }]
  for (let m = 0; m < HZ; m++) {
    const before = g;
    g = E.advanceMonth(g, parcels, bbls, adjacency);
    if (g.gameOver) g = { ...g, gameOver: null, cash: 80e6 };
    for (const u of ["office", "retail", "industrial"]) {
      const c = E.concessionPressure(g.econ, u);
      dial[bucket(c)]++; dial.n++;
    }
    // who left, and what they left behind
    for (const [bbl, ph] of Object.entries(before.holdings)) {
      const h = g.holdings[bbl];
      if (!h) continue;
      const now = new Set(h.tenants.map((t) => t.name + ":" + t.startM));
      for (const t of ph.tenants) {
        if (now.has(t.name + ":" + t.startM)) continue;
        const k = `${bbl}:${t.use ?? "office"}`;
        (leftFit[k] ??= []).push({ sf: t.sf, fitM: t.fitM ?? t.startM, leftM: g.month });
      }
    }
    // letters that arrived this month
    for (const l of g.lois) {
      if (seen.has(l.id)) continue;
      seen.add(l.id);
      const rec = E.resolveRec(parcels, g, l.bbl);
      const h = g.holdings[l.bbl];
      if (!rec || !h) continue;
      const use = l.use ?? "office";
      const market = E.managedRentPsfYr(rec, g.econ, h, use);
      const yrs = Math.max(1, l.termM / 12);
      const ci = g.econ.costIdx || 1;
      const shell = E.shellShare(rec, h, use, g.month);
      const spec = h.specSuites && h.specSuites.use === use && g.month >= h.specSuites.readyM;
      let gen = l.kind !== "new" ? l.kind : shell > 0.5 ? "first" : spec ? "spec" : "second";
      let age = null;
      if (gen === "second") {
        const left = (leftFit[`${l.bbl}:${use}`] ?? []).filter((x) => x.leftM <= g.month);
        if (left.length) {
          const last = left[left.length - 1];
          age = (g.month - last.fitM) / 12;
        }
      }
      const conc = E.concessionPressure(g.econ, use);
      rows.push({
        seed, m: g.month, use, kind: l.kind, gen, age, yrs, credit: l.credit, mk: bucket(conc),
        tiYr: (l.tiPsf ?? 0) / ci / yrs, freeYr: (l.freeM ?? 0) / yrs,
        rentRel: l.rentPsf / Math.max(1, market),
        tiMonthsOfRent: (l.tiPsf ?? 0) / Math.max(1, l.rentPsf) * 12,
        ne: E.loiMandateScore(l, market), dark: h.darkMs ?? 0,
        effRel: (g.econ.effRentIdx?.[use] ?? 1) / Math.max(0.01, g.econ.rentIdx?.[use] ?? 1),
      });
    }
    // one fixed, ordinary answer policy
    for (const loi of [...g.lois]) {
      const rec = E.resolveRec(parcels, g, loi.bbl);
      const h = g.holdings[loi.bbl];
      if (!rec || !h || !E.loiNeedsPrincipal(g, loi)) continue;
      const mk = E.managedRentPsfYr(rec, g.econ, h, loi.use);
      const ne = E.loiMandateScore(loi, mk);
      let action = "pass", counter;
      if (loi.stage === "countered") action = ne >= 0.86 ? "accept" : "pass";
      else if (ne >= 0.95) action = "accept";
      else if (ne >= 0.6) { action = "counter"; counter = { rentPsf: +mk.toFixed(2), tiPsf: Math.round((loi.tiPsf ?? 0) * 0.75) }; }
      const r = E.respondLOI(g, parcels, loi.id, action, false, counter);
      if (r.err) { const r2 = E.respondLOI(g, parcels, loi.id, "pass"); if (!r2.err) g = r2.s; continue; }
      const after = r.s.lois.find((x) => x.id === loi.id);
      if (!after && action !== "pass") {
        const t = r.s.holdings[loi.bbl]?.tenants.find((x) => x.startM === r.s.month && x.name === loi.name);
        if (t) signed.push({ use: loi.use ?? "office", kind: loi.kind, yrs: (t.endM - t.startM) / 12, tiYr: (t.tiPsf ?? loi.tiPsf ?? 0) / (r.s.econ.costIdx || 1) / Math.max(1, (t.endM - t.startM) / 12), freeYr: t.freeUntilM ? (t.freeUntilM - t.startM) / Math.max(1, (t.endM - t.startM) / 12) : 0 });
      }
      g = r.s;
    }
  }
  process.stderr.write(`seed ${seed} done · ${rows.length} letters so far\n`);
}

// ------------------------------------------------------------------ report
const line = (label, xs, key) => {
  const v = xs.map((r) => r[key]).filter(Number.isFinite);
  return `  ${label.padEnd(44)} n ${String(v.length).padStart(4)}   p25 ${f2(q(v, 0.25))}  p50 ${f2(q(v, 0.5))}  p75 ${f2(q(v, 0.75))}`;
};
console.log(`\nCONCESSIONS — ${SEEDS.length} seeds × ${HZ / 12} years, gifted ~${TARGET_SUITES}-suite commercial book\n`);
console.log(`A4 market state (concession dial, office/retail/industrial-months): tight ${(dial.tight / dial.n * 100).toFixed(0)}% · balanced ${(dial.balanced / dial.n * 100).toFixed(0)}% · glut ${(dial.glut / dial.n * 100).toFixed(0)}%`);

console.log(`\nA1 FREE RENT, months per year of term (opening ask, new leases)    anchor: tight 0-0.4 · balanced 0.4-1.0 · glut 1.0-1.6`);
const newL = rows.filter((r) => r.kind === "new");
for (const mk of ["tight", "balanced", "glut"]) console.log(line(`${mk}`, newL.filter((r) => r.mk === mk), "freeYr"));
console.log(line("all", newL, "freeYr"));

console.log(`\nA2/A3 TI, $/sf per year of term, deflated (opening ask, new leases)`);
for (const use of ["office", "retail", "industrial"]) {
  const u = newL.filter((r) => r.use === use);
  if (!u.length) continue;
  console.log(` ${use}`);
  console.log(line("first generation (shell)", u.filter((r) => r.gen === "first"), "tiYr"));
  console.log(line("spec suite", u.filter((r) => r.gen === "spec"), "tiYr"));
  console.log(line("second gen · fit-out < 5 yrs old", u.filter((r) => r.gen === "second" && r.age !== null && r.age < 5), "tiYr"));
  console.log(line("second gen · fit-out 5-10 yrs old", u.filter((r) => r.gen === "second" && r.age !== null && r.age >= 5 && r.age < 10), "tiYr"));
  console.log(line("second gen · fit-out 10+ yrs old", u.filter((r) => r.gen === "second" && r.age !== null && r.age >= 10), "tiYr"));
  console.log(line("second gen · age unknown (gifted vacancy)", u.filter((r) => r.gen === "second" && r.age === null), "tiYr"));
  for (const mk of ["tight", "balanced", "glut"]) console.log(line(`  second gen, ${mk} market`, u.filter((r) => r.gen === "second" && r.mk === mk), "tiYr"));
}
const sec = newL.filter((r) => r.use === "office" && r.gen === "second" && r.age !== null);
if (sec.length) console.log(`\n  office second-gen tours with a known fit-out: ${(sec.filter((r) => r.age < 5).length / sec.length * 100).toFixed(0)}% on space fitted < 5 yrs ago — anchor asks 0.5-2.0 $/sf/yr there`);
console.log(line("office second gen: TI in months of rent", newL.filter((r) => r.use === "office" && r.gen === "second"), "tiMonthsOfRent"));
console.log(line("office: opening rent / market", newL.filter((r) => r.use === "office"), "rentRel"));
console.log(line("office: opening NE / market", newL.filter((r) => r.use === "office"), "ne"));
console.log(line("office: opening rent / market, space dark <6 mo", newL.filter((r) => r.use === "office" && r.dark < 6), "rentRel"));
console.log(line("office: opening rent / market, space dark 12+ mo", newL.filter((r) => r.use === "office" && r.dark >= 12), "rentRel"));
console.log(line("office: months dark at arrival", newL.filter((r) => r.use === "office"), "dark"));
console.log(line("office: town effective / face rent index", newL.filter((r) => r.use === "office"), "effRel"));

console.log(`\nRENEWALS (opening ask)`);
const ren = rows.filter((r) => r.kind === "renewal");
console.log(line("free months / yr of term", ren, "freeYr"));
console.log(line("office TI $/sf/yr deflated", ren.filter((r) => r.use === "office"), "tiYr"));

console.log(`\nSIGNED under the fixed policy`);
for (const use of ["office", "retail", "industrial"]) {
  const s = signed.filter((r) => r.use === use && r.kind === "new");
  if (!s.length) continue;
  console.log(line(`${use} new · TI $/sf/yr`, s, "tiYr"));
  console.log(line(`${use} new · free months / yr`, s, "freeYr"));
}
console.log("");
