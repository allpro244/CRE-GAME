// THE ONE-MONTH IDENTITY HARNESS (REALISM_FIX_PLAN roadmap A0).
//
//   node tools/econprobe/identities.mjs                 town 0, 24 months
//   OFF=1 HZ=60 FROM=12 node tools/econprobe/identities.mjs
//   TRACE=1 ...                                         one line a month: hires, leavers, employed, unemployed, openings
//
// A 30-year run says THAT the economy went wrong; this says WHERE, in about a
// minute. Two kinds of check, every month:
//
//  1. IDENTITIES — things that must hold by definition. A breach is a bug, and
//     the harness exits 1 naming the month and the quantity:
//       - the region's occupied and newly signed homes never exceed its homes
//         less those being made ready between tenants (a physical bound);
//       - each industry's earners in the register add up to the register's
//         employed (placed) workers, within an agent's weight;
//       - no count is negative or non-finite (jobs, people, homes, openings).
//  2. ACCOUNTS — flows that should balance in a working market, reported per
//     industry so a broken link shows where it is:
//       - hires (the register's `filled`) against the change in staffed heads:
//         what left the industry = hires - change;
//       - wanted heads (the firms' staffing target) against staffed heads: the
//         gap, and the openings the town publishes;
//       - population: births - deaths and households in - out against the
//         change in persons (agents' sizes differ, so the residual is shown,
//         not judged).
//
// Run it on a change BEFORE any long run: if hires cannot cover what leaves an
// industry month after month, the long run will only show the town shrinking.
import { join } from "node:path";
const APP = new URL("../..", import.meta.url).pathname;
const { assertFreshBundle } = await import(join(APP, "test", "fresh.mjs"));
assertFreshBundle();
const E = await import(join(APP, "test", ".engine.mjs"));
const { loadCity } = await import(join(APP, "test", "city.mjs"));

const OFF = Number(process.env.OFF ?? 0), HZ = Number(process.env.HZ ?? 24), FROM = Number(process.env.FROM ?? 1);
const seed = Number(process.env.SEED ?? 1000 + OFF * 7919);
const { parcels: P0, adjacency, bbls } = loadCity(OFF % 4, E.normalizeParcels);
const parcels = JSON.parse(JSON.stringify(P0));
let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);

const IDS = E.INDUSTRY_IDS, N = IDS.length;
const breaches = [];
const breach = (m, what) => { breaches.push(`month ${m}: ${what}`); };
const fin = (x) => Number.isFinite(x);

let prevEarners = null, prevPersons = null;
const acc = { hires: new Float64Array(N), d: new Float64Array(N), gap: new Float64Array(N), want: new Float64Array(N), n: 0 };
const pop = { births: 0, deaths: 0, arrived: 0, left: 0, dPersons: 0 };
let overfullM = 0, worstOver = 0;

console.log(`IDENTITY HARNESS — seed ${seed}, city ${OFF % 4}, ${HZ} months (accounts from month ${FROM})\n`);
for (let m = 0; m < HZ; m++) {
  g = E.advanceQuarter(g, parcels, bbls, adjacency);
  if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
  const e = g.econ, r = g.households, Ec = g.economy;
  if (!r || !Ec?.emp) continue;
  const L = E.registerLabour(g), P = E.registerPayroll(g);
  const earners = P.earners;
  // ---- identities
  for (const [k, v] of Object.entries({ jobs: e.jobs, population: e.population, unemployment: e.unemployment, jobVac: e.jobVac, employed: L.employed, persons: L.persons })) {
    if (!fin(v) || v < 0) breach(m + 1, `${k} = ${v}`);
  }
  let sumE = 0;
  for (let i = 0; i < N; i++) { sumE += earners[i]; if (!fin(earners[i]) || earners[i] < 0) breach(m + 1, `earners[${IDS[i]}] = ${earners[i]}`); }
  if (Math.abs(sumE - L.employed) > Math.max(r.wRegion ?? 1, 0.01 * L.employed)) breach(m + 1, `industries' earners ${sumE.toFixed(0)} vs register employed ${L.employed.toFixed(0)}`);
  const mk = r.mk;
  if (mk) {
    // a home being made ready between tenants (`idle`) holds nobody; the
    // households counted are the register's actual renters across the water
    // (the market's own tally, occ + signed, adds signings during the month
    // but not departures, so it runs a little high by construction)
    const homes = mk.homes + (mk.homesB ?? 0) - (mk.idle ?? 0);
    let used = 0;
    for (let i = 0; i < r.n; i++) if (r.a.ten[i] === E.TEN_MAINLAND) used += r.a.wt[i];
    if (!fin(homes) || homes < 0) breach(m + 1, `mainland homes = ${homes}`);
    if (used > homes + (r.wRegion ?? 1)) { overfullM++; worstOver = Math.max(worstOver, used - homes); }
  }
  // ---- accounts
  if (prevEarners && m + 1 >= FROM) {
    const f = r.flow ?? {};
    for (let i = 0; i < N; i++) {
      acc.d[i] += earners[i] - prevEarners[i];
      acc.want[i] += Ec.emp[i] ?? 0;
      acc.gap[i] += Math.max(0, (Ec.emp[i] ?? 0) - earners[i]);
    }
    acc.n++;
    // the register books hires for the town as a whole (`filled`); spread by
    // where they landed this month (an industry's rise plus its share of exits)
    pop.births += f.births ?? 0; pop.deaths += f.deaths ?? 0; pop.arrived += f.arrived ?? 0; pop.left += f.left ?? 0;
    pop.dPersons += L.persons - prevPersons;
    acc.hiresTot = (acc.hiresTot ?? 0) + (f.filled ?? 0);
    acc.quits = (acc.quits ?? 0) + (f.quits ?? 0);
    acc.layoffs = (acc.layoffs ?? 0) + (f.layoffs ?? 0);
    if (process.env.TRACE) {
      const dE = earners.reduce((t, x) => t + x, 0) - prevEarners.reduce((t, x) => t + x, 0);
      console.log(`  m${String(m + 1).padStart(3)} hires ${(f.filled ?? 0).toFixed(0).padStart(5)} left ${((f.filled ?? 0) - dE).toFixed(0).padStart(5)} employed ${L.employed.toFixed(0).padStart(6)} unemployed ${L.unemployed.toFixed(0).padStart(5)} (${(100 * e.unemployment).toFixed(1)}%) openings ${(100 * (e.jobVac ?? 0)).toFixed(1)}% wanted ${Ec.emp.reduce((t, x) => t + x, 0).toFixed(0)} arrived ${(f.arrived ?? 0).toFixed(0)} left-town ${(f.left ?? 0).toFixed(0)}`);
    }
  }
  prevEarners = Float64Array.from(earners); prevPersons = L.persons;
}

// ---- report
const months = Math.max(1, acc.n), e = g.econ, L = E.registerLabour(g);
const emp = L.employed, dEmp = acc.d.reduce((t, x) => t + x, 0);
const hires = acc.hiresTot ?? 0, exits = hires - dEmp;
console.log("LABOUR, town, a month on average:");
console.log(`  hires ${(hires / months).toFixed(0)} (${(100 * hires / months / emp).toFixed(2)}% of employed; JOLTS ~3.7%)`);
console.log(`  left jobs ${(exits / months).toFixed(0)} = hires - change in employed (quits ${(acc.quits / months).toFixed(0)}, layoffs ${(acc.layoffs / months).toFixed(0)} of them)`);
console.log(`  change in employed ${(dEmp / months).toFixed(0)} a month · openings now ${(100 * (e.jobVac ?? 0)).toFixed(1)}% of the labour force (JOLTS mean ~3.1% of jobs)`);
console.log(`  unemployment ${(100 * e.unemployment).toFixed(1)}% · wanted heads ${(acc.want.reduce((t, x) => t + x, 0) / months).toFixed(0)} · staffing gap ${(acc.gap.reduce((t, x) => t + x, 0) / months).toFixed(0)}`);
console.log("\n  industries furthest under their staffing target (mean over the window):");
const rows = IDS.map((id, i) => ({ id, where: E.INDUSTRIES[id].where, want: acc.want[i] / months, gap: acc.gap[i] / months, d: acc.d[i] / months }))
  .filter((x) => x.want > 0).sort((a, b) => b.gap - a.gap).slice(0, 8);
console.log("  industry                 where     wanted   staffed%   change/mo");
for (const x of rows) console.log(`  ${x.id.padEnd(24)} ${String(x.where).padEnd(8)} ${x.want.toFixed(0).padStart(7)} ${(100 * (1 - x.gap / x.want)).toFixed(0).padStart(9)}% ${x.d.toFixed(1).padStart(10)}`);
console.log("\nPOPULATION, a month on average:");
console.log(`  births ${(pop.births / months).toFixed(0)} · deaths ${(pop.deaths / months).toFixed(0)} · households arrived ${(pop.arrived / months).toFixed(1)} · left ${(pop.left / months).toFixed(1)} · change in persons ${(pop.dPersons / months).toFixed(0)}`);
console.log("\nHOUSING (the mainland):");
console.log(`  months occupied beyond its homes: ${overfullM} of ${HZ}${overfullM ? ` (worst by ${worstOver.toFixed(0)} households)` : ""}`);
if (overfullM) breach("-", `the mainland held more households than homes in ${overfullM} months (worst ${worstOver.toFixed(0)})`);

console.log(breaches.length ? `\nIDENTITY BREACHES (${breaches.length}):\n  ${breaches.slice(0, 20).join("\n  ")}` : "\nIdentities held every month.");
process.exit(breaches.length ? 1 : 0);
