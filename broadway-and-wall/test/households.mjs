// THE HOUSEHOLD REGISTER: DETERMINISTIC, SAVABLE, AND IT ADDS UP.
//
//   node test/households.mjs          (pnpm households:test)
//
// Stage 1 of the household micro-simulation (src/engine/households.ts) is a
// shadow nothing reads, so what can go wrong with it is narrow and all of it
// is checked here:
//   - the same seed gives the same register, month for month;
//   - its stream is mulberry32, step for step market.ts's, and draws on its
//     own channel only (every other stream is where it would have been);
//   - a save (base64 columns, through JSON) loads back to the same register,
//     and the loaded game and the running one stay identical for a year;
//   - since ONE ECONOMY step 2 it IS the town's people: the engine's
//     population, unemployment and participation are the register's of the
//     month before, exactly; it opens with the labour force the opening's
//     jobs need; its island renters are the flats the street has let; its
//     jobless rate is its own flows' (guarded to 2.5-15%: a town opens in its
//     nation's cycle, and 2009-10 put many metros over 10%, BLS LAUS).
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import v8 from "node:v8";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(pathToFileURL(join(HERE, ".engine.mjs")).href);
const { makeCity } = await import(pathToFileURL(join(HERE, "..", "src", "citygen", "index.mjs")).href);

let bad = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`); if (!ok) bad++; };
const sha = (x) => createHash("sha256").update(x).digest("hex").slice(0, 16);
const regHash = (g) => sha(JSON.stringify(E.packHouseholds(g.households)));
const stateHash = (g) => sha(JSON.stringify(E.packHouseholdsForSave(g)));

const city = makeCity("somewhere", 1);
E.normalizeParcels(city.parcels);
const bbls = Object.keys(city.parcels);
const SEED = 550991, MONTHS = Number(process.env.MONTHS ?? 18);
const start = () => E.firstListings(E.newGame(SEED, city.parcels), city.parcels, bbls);
const tick = (g) => { g = E.advanceQuarter(g, city.parcels, bbls, city.adjacency); return g.gameOver ? { ...g, gameOver: null, cash: 6e6 } : g; };

console.log("\nHOUSEHOLD REGISTER\n");

// the stream is the engine's PRNG
{
  let st = 12345, ok = true;
  for (let k = 0; k < 1000; k++) {
    const r = E.mulberry32Step(st);
    if (E.householdStreamStep(st) !== r.value) { ok = false; break; }
    st = r.state;
  }
  check(ok, "the households stream is mulberry32, step for step market.ts mulberry32Step");
}

// two runs, same seed
let a = start(), b = start();
const hashesA = [], hashesB = [];
let lifeB = 0, lifeD = 0, lifeP = 0;
let stats0 = null, sumsOk = true, worst = "", booksFrom = 1, prevLab = null, lf0 = NaN, jobs0 = NaN, uNow = NaN;
for (let m = 1; m <= MONTHS; m++) {
  const streamsBefore = { ...a.streams };
  a = tick(a); b = tick(b);
  hashesA.push(regHash(a)); hashesB.push(regHash(b));
  const st = E.householdStats(a);
  if (m === 1) stats0 = st;
  // the register's sums against the engine's aggregates, every month
  const rent = E.islandRenterHouseholds(a, city.parcels);
  const dR = Math.abs(st.islandRenters / Math.max(1, rent) - 1);
  const lab = E.registerLabour(a);
  if (m === 1) { lf0 = lab.lf; jobs0 = a.econ.jobs; }
  const books = a.economy?.cur?.m === a.month;
  if (!books) booksFrom = m + 1;
  // the engine read LAST month's register: its people, its jobless rate, its participation
  const readOk = !prevLab || (a.econ.population === Math.round(prevLab.persons)
    && Math.abs(a.econ.unemployment - (prevLab.lf > 0 ? prevLab.unemployed / prevLab.lf : 0)) < 1e-9
    && Math.abs(a.econ.participation - prevLab.lf / prevLab.persons) < 1e-9);
  uNow = st.unemployment;
  lifeB += a.households.flow.births ?? 0; lifeD += a.households.flow.deaths ?? 0; lifeP += lab.persons;
  const uBad = !(st.unemployment >= 0.025 && st.unemployment <= 0.15);
  if (!readOk || dR > 0.03 || uBad) { sumsOk = false; worst ||= `month ${m}: population ${a.econ.population} (register a month ago ${prevLab ? Math.round(prevLab.persons) : "-"}), renters ${(100 * dR).toFixed(2)}% off the flats, unemployment ${(100 * st.unemployment).toFixed(2)}%`; }
  prevLab = lab;
  void streamsBefore;
}
check(hashesA.every((h, i) => h === hashesB[i]), `deterministic: ${MONTHS} months, the same register from the same seed (${hashesA.at(-1)})`);
check(new Set(hashesA).size === hashesA.length, "and it moves: no two months' registers alike");
check(sumsOk, `every month the engine's population, unemployment and participation are the register's of the month before, its island renter households are the street's let flats (within 3%), and its jobless rate is in 2.5-15% (now ${(100 * uNow).toFixed(1)}%; the books open month ${booksFrom})${worst ? " — " + worst : ""}`);
check(Math.abs(lf0 * (1 - stats0.unemployment) / jobs0 - 1) < 0.03, `it opens with the labour force the opening's jobs need: ${Math.round(lf0)} in it at ${(100 * stats0.unemployment).toFixed(1)}% jobless for ${jobs0} jobs`);
check(stats0.agents > 3000 && stats0.wIsland === 1, `island renters one for one at the opening: ${stats0.agents} agents (${Math.round(stats0.islandRenters)} island renters + the region's ${stats0.agents - Math.round(stats0.islandRenters)})`);
check(stats0.medianBurden > 0.25 && stats0.medianBurden < 0.36, `the opening's median rent burden ${(100 * stats0.medianBurden).toFixed(1)}% (the engine's flats are built on 30%)`);
check(Math.round(E.registerLabour(a).persons) > 0 && a.econ.population > 0, `the town's population is the register's people: ${Math.round(a.econ.population)}`);

// HOUSEHOLDS STAGE 2: the households decide, and the engine reads what they decided
{
  const r = a.households, st = E.householdStats(a), lab = E.registerLabour(a);
  const lfHh = lab.lf / lab.households, empP = lab.employed / lab.persons;
  // BLS/Census: ~1.28 in the labour force per household, ~0.48 employed per person (2023)
  check(lfHh > 1.05 && lfHh < 1.45 && empP > 0.40 && empP < 0.55, `participation: ${lfHh.toFixed(2)} in the labour force a household, ${empP.toFixed(3)} employed a person (US ~1.28, ~0.48)`);
  check(r.locMu !== undefined && r.ownMu !== undefined && a.econ.eco?.islandWant === r.islandWant && a.econ.eco0?.islandWant > 0,
    `the flats' demand is the households that want an island flat: ${Math.round(r.islandWant)} now against ${Math.round(a.econ.eco0?.islandWant ?? 0)} at the opening (${Math.round(st.islandRenters)} island renter households)`);
  const out = st.flow.out ?? {};
  const reasons = Object.keys(out).filter((k) => out[k] > 0);
  check(r.leaseMoveRate > 0.15 && r.leaseMoveRate < 0.75 && r.moveOutYr > 0.15 && r.moveOutYr < 0.9,
    `island leases ending in a move ${(100 * r.leaseMoveRate).toFixed(0)}%, move-outs ${(100 * r.moveOutYr).toFixed(0)}% of renters a year (NMHC/AHS ~45%); this month's reasons: ${reasons.map((k) => `${k} ${out[k].toFixed(0)}`).join(", ")}`);
  check(a.econ.eco?.flatMoveOut === r.moveOutYr && a.econ.eco?.flatLeaseMove === r.leaseMoveRate, "the street's renewals and the player's flats read the households' own move-out rates");
  const bw = (r.buyers ?? []).reduce((t, x) => t + x.w, 0);
  check(bw > 0 && (r.buyers ?? []).every((x) => x.m > a.month - 12 && x.inc > 0), `the builders sell to the register's buyers: ${Math.round(bw)} households bought in the last year`);
}

// HOUSEHOLDS STAGES 4-5: life by the record's rates, and spending by category
{
  const r = a.households, f = r.flow, lab = E.registerLabour(a);
  const py = E.registerPyramid(a), pyT = py.reduce((t, x) => t + x, 0);
  check(Math.abs(pyT / lab.persons - 1) < 1e-6, `the age pyramid is the register's people: ${Math.round(pyT)} by age against ${Math.round(lab.persons)}`);
  // over the run (a month of weighted agents is noisy): CDC NCHS 2023, 10.7 births and 9.2 deaths a year per 1,000 people
  const yr = (x) => (12000 * x) / lifeP;
  check(yr(lifeB) > 5 && yr(lifeB) < 18 && yr(lifeD) > 4 && yr(lifeD) < 18,
    `over ${MONTHS} months, births ${yr(lifeB).toFixed(1)} and deaths ${yr(lifeD).toFixed(1)} a year per 1,000 people (US 10.7, 9.2)`);
  const cat = f.spendCat ?? {}, ct = Object.values(cat).reduce((t, x) => t + x, 0);
  check(f.spend > 0 && Math.abs(ct / f.spend - 1) < 1e-6, `the households' spending by category adds up to their spending: $${Math.round(ct).toLocaleString("en-US")} a month`);
  const hm = E.householdMoney(a);
  check(hm.spendCat === f.spendCat, "the economy's household demand reads the categories the households spent on (householdMoney.spendCat)");
}

// it reads the world and never writes it: a month of the register on a copy of
// the state changes nothing but the register and its own stream
{
  // (since households stage 2 it also lets the street's flats: the rolls, the space it reports, the deals and the turnover are its to write)
  const strip = (g) => { const { households, streams, why, econ, ...rest } = g; void households; void why; const { households: _h, ...st } = streams ?? {}; void _h;
    const { flatRolls, flatSpace, deals, turnMeas, ...ec } = econ; void flatRolls; void flatSpace; void deals; void turnMeas;
    return JSON.stringify({ ...rest, econ: ec, streams: st }); };
  const copy = structuredClone(a);
  const before = strip(copy);
  const s0 = copy.streams.households;
  E.tickHouseholdRegister(copy, city.parcels);
  check(strip(copy) === before, "a month of the register writes nothing in the world it reads but the street's flats it lets");
  check(typeof copy.streams.households === "number" && copy.streams.households !== s0, "it draws on its own channel, s.streams.households");
}

// save and load: base64 columns, through JSON, back to the same register — and both play on identically
{
  const packed = E.packHouseholdsForSave(a);
  const text = JSON.stringify(packed);
  check(typeof packed.households.packed?.sav === "string" && !packed.households.a && a.households.a, "a save carries base64 columns and leaves the running game's arrays alone");
  const kb = JSON.stringify(packed.households).length / 1024;
  // (850 KB since households stage 4: four one-byte columns more — the children's ages, the partner, the other adults' age;
  // 950 KB since stage 6: a household that moves joins only an agent alike in age and make-up (`alike`), so fewer merge)
  check(kb < 950, `the register saves in ${kb.toFixed(0)} KB (${a.households.n} households)`);
  // A save is written to IndexedDB, which stores it by structured clone (v8
  // serialize here, as test/region-reload.mjs does), and the store resumes it
  // through migrateSaveState — which unpacks the columns. (The whole state
  // does not survive JSON: the street's rolls carry undefined-valued keys.)
  let c = E.migrateSaveState(v8.deserialize(v8.serialize(packed)));
  const viaJson = JSON.parse(JSON.stringify(packed.households));
  E.unpackHouseholds(viaJson);
  check(regHash({ households: viaJson }) === regHash(a), "the register alone also round-trips through JSON");
  void text;
  check(regHash(c) === regHash(a), "loaded, the register is the one saved");
  let ok = true;
  for (let m = 0; m < 12; m++) { a = tick(a); c = tick(c); if (stateHash(a) !== stateHash(c)) {
    ok = false;
    const pa = E.packHouseholdsForSave(a), pc = E.packHouseholdsForSave(c);
    const keys = Object.keys(pa).filter((k) => JSON.stringify(pa[k]) !== JSON.stringify(pc[k]));
    const ek = keys.includes("econ") ? Object.keys(pa.econ).filter((k) => JSON.stringify(pa.econ[k]) !== JSON.stringify(pc.econ[k])) : [];
    console.log(`    diverged at month +${m + 1}: ${keys.join(", ")} ${ek.length ? "econ." + ek.join(", econ.") : ""}`);
    break;
  } }
  check(ok, "the loaded game and the running one stay identical for a year");
}

console.log("");
process.exit(bad ? 1 : 0);
