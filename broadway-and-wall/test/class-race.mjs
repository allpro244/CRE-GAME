// CAN EACH ASSET CLASS BE THE BEST?
//
//   pnpm engine && node test/class-race.mjs
//
// A shallow playtest: three seeds, twenty years, vacant-lot yield on cost by
// use at years 0 / 10 / 20. The question is not "does office ever pencil" —
// it is whether a player who has done this for a few hours learns that the
// only building worth putting up is an office building.
//
// Also records the policy-rate path. A monthly EMA made the next print
// readable from the last; eight FOMC meetings should not produce a one-way
// monthly march.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

const USES = ["office", "multifamily", "retail", "industrial"];
const SEEDS = (process.env.SEEDS ?? "550991,12007,73303").split(",").map(Number);
const YEARS = [0, 10, 20];
const MONTHS = 20 * 12;

const med = (a) => {
  const b = [...a].filter(Number.isFinite).sort((x, y) => x - y);
  if (!b.length) return NaN;
  return b[Math.floor((b.length - 1) / 2)];
};

function raceAt(g, parcels, bbls) {
  const wins = { office: 0, multifamily: 0, retail: 0, industrial: 0 };
  const yocs = { office: [], multifamily: [], retail: [], industrial: [] };
  let lots = 0;
  for (const bbl of bbls) {
    const rec = E.resolveRec(parcels, g, bbl);
    if (!rec || !rec.lotArea || rec.lotArea < 4000) continue;
    if (rec.bldgArea > 0 && rec.class !== "land") continue;
    const row = {};
    for (const use of USES) {
      const fl = Math.min(E.maxFloorsFor(rec, 0.6, use), use === "industrial" ? 2 : use === "retail" ? 3 : 14);
      const plan = E.planDevelopment(g, parcels, bbl, use, fl, 0.6, "gmp");
      if (!plan) continue;
      row[use] = plan.yieldOnCost;
      yocs[use].push(plan.yieldOnCost);
    }
    const keys = Object.keys(row);
    if (!keys.length) continue;
    lots++;
    keys.sort((a, b) => row[b] - row[a]);
    wins[keys[0]]++;
  }
  return {
    lots,
    wins,
    medYoc: Object.fromEntries(USES.map((u) => [u, med(yocs[u])])),
    rentIdx: Object.fromEntries(USES.map((u) => [u, g.econ.rentIdx[u]])),
  };
}

function run(seed) {
  const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);
  let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  const snap = {};
  const policy = [g.econ.nat?.policy ?? g.econ.indexRate];
  snap[0] = raceAt(g, parcels, bbls);
  for (let m = 1; m <= MONTHS; m++) {
    g = E.advanceQuarter(g, parcels, bbls, adjacency);
    policy.push(g.econ.nat?.policy ?? g.econ.indexRate);
    const yr = m / 12;
    if (YEARS.includes(yr)) snap[yr] = raceAt(g, parcels, bbls);
  }
  let maxStreak = 0, streak = 0, lastSign = 0, holds = 0, moves = 0;
  for (let i = 1; i < policy.length; i++) {
    const d = policy[i] - policy[i - 1];
    if (Math.abs(d) < 0.05) {
      holds++;
      streak = 0;
      lastSign = 0;
      continue;
    }
    moves++;
    const sign = Math.sign(d);
    if (sign === lastSign) streak++;
    else streak = 1;
    lastSign = sign;
    maxStreak = Math.max(maxStreak, streak);
  }
  return { seed, snap, maxStreak, holds, moves, policyStart: policy[0], policyEnd: policy[policy.length - 1] };
}

console.log("\nCLASS RACE  ·  vacant-lot YoC, three seeds, twenty years\n");

let bad = 0;
const rows = SEEDS.map((s) => {
  console.log(`  seed ${s} …`);
  return run(s);
});

const winners = { office: 0, multifamily: 0, retail: 0, industrial: 0 };
const lotWinsEver = { office: 0, multifamily: 0, retail: 0, industrial: 0 };
const officeSweep = [];

for (const r of rows) {
  console.log(`\n  seed ${r.seed}  policy ${r.policyStart.toFixed(2)} → ${r.policyEnd.toFixed(2)}  `
    + `holds ${r.holds}/${r.holds + r.moves}  max same-dir streak ${r.maxStreak}`);
  for (const yr of YEARS) {
    const s = r.snap[yr];
    if (!s) continue;
    const order = [...USES].sort((a, b) => (s.medYoc[b] ?? -99) - (s.medYoc[a] ?? -99));
    winners[order[0]]++;
    const share = s.lots > 0 ? s.wins.office / s.lots : 0;
    officeSweep.push(share);
    for (const u of USES) if (s.wins[u] > 0) lotWinsEver[u]++;
    console.log(`    y${String(yr).padStart(2)}  lots ${s.lots}  `
      + `med YoC ${USES.map((u) => `${u.slice(0, 3)} ${Number.isFinite(s.medYoc[u]) ? s.medYoc[u].toFixed(2) : "—"}`).join("  ")}  `
      + `lot-wins ${USES.map((u) => `${u.slice(0, 3)} ${s.wins[u]}`).join("  ")}  `
      + `leader ${order[0]}`);
  }
}

const check = (ok, msg) => {
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`);
  if (!ok) bad++;
};

console.log("");
check(lotWinsEver.office > 0 && lotWinsEver.multifamily > 0 && lotWinsEver.industrial > 0,
  `office, apartments and industrial each win at least one lot in some window  (windows-with-a-win  ofc ${lotWinsEver.office}  mf ${lotWinsEver.multifamily}  ind ${lotWinsEver.industrial}  rtl ${lotWinsEver.retail})`);
check(winners.office < YEARS.length * SEEDS.length,
  `office is not the median-YoC leader in every window  (office ${winners.office} / ${YEARS.length * SEEDS.length})`);
const alwaysOfficeLots = officeSweep.every((x) => x > 0.85);
check(!alwaysOfficeLots,
  `office does not take >85% of lots in every window  (max ${(Math.max(...officeSweep) * 100).toFixed(0)}%  min ${(Math.min(...officeSweep) * 100).toFixed(0)}%)`);
const maxStreak = Math.max(...rows.map((r) => r.maxStreak));
check(maxStreak <= 2,
  `policy rate does not march the same way more than two months running  (max streak ${maxStreak})`);

console.log("");
process.exit(bad ? 1 : 0);
