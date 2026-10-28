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
//   - its sums sit on the engine's aggregates: the region's households, the
//     island's renter households, the jobless rate, the opening rent burden —
//     until the firm books open (stage 1b): from then its households are who
//     came for the work, and its jobless rate is its own flows', held to 3-10%.
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
let stats0 = null, sumsOk = true, worst = "", booksFrom = 1, hGap = NaN, uGap = NaN;
for (let m = 1; m <= MONTHS; m++) {
  const streamsBefore = { ...a.streams };
  a = tick(a); b = tick(b);
  hashesA.push(regHash(a)); hashesB.push(regHash(b));
  const st = E.householdStats(a);
  if (m === 1) stats0 = st;
  // the register's sums against the engine's aggregates, every month
  const rent = E.islandRenterHouseholds(a, city.parcels);
  const dH = Math.abs(st.households / st.engineHouseholds - 1);
  const dR = Math.abs(st.islandRenters / Math.max(1, rent) - 1);
  const dU = Math.abs(st.unemployment - (a.econ.unemployment ?? 0));
  // Before the firm books open the region's households are weighted to the
  // engine's; from then (stage 1b) they are who came for the work and stayed
  // — the gap is a measurement (tools/economy.mjs), and the register's
  // earners in work are held to the books' heads instead (test/economy.mjs).
  const books = a.economy?.cur?.m === a.month;
  if (!books) booksFrom = m + 1;
  // unemployment: the engine's, before the books; after, what the register's own flows leave (separations, the CPS finding rate,
  // the vacancies) — held to the band ONE_ECONOMY_PLAN.md sets for step 3, 3-10%
  const uBad = books ? !(st.unemployment >= 0.03 && st.unemployment <= 0.10) : dU > 0.025;
  if (books) uGap = st.unemployment - (a.econ.unemployment ?? 0);
  if ((!books && dH > 0.005) || dR > 0.03 || uBad) { sumsOk = false; worst ||= `month ${m}: households ${(100 * dH).toFixed(2)}%, renters ${(100 * dR).toFixed(2)}%, unemployment ${(100 * st.unemployment).toFixed(2)}% (engine ${(100 * (a.econ.unemployment ?? 0)).toFixed(2)}%)`; }
  if (books) hGap = st.households / st.engineHouseholds - 1;
  void streamsBefore;
}
check(hashesA.every((h, i) => h === hashesB[i]), `deterministic: ${MONTHS} months, the same register from the same seed (${hashesA.at(-1)})`);
check(new Set(hashesA).size === hashesA.length, "and it moves: no two months' registers alike");
check(sumsOk, `every month the sums sit on the engine's: households within 0.5% until the firm books open (month ${booksFrom}; then they are who came for the work: ${(100 * hGap).toFixed(1)}% on the engine's now), island renter households within 3%, unemployment within 2.5pp of the engine's until then and 3-10% after (now ${(100 * uGap).toFixed(1)}pp off the engine's)${worst ? " — " + worst : ""}`);
check(stats0.agents > 3000 && stats0.wIsland === 1, `island renters one for one at the opening: ${stats0.agents} agents (${Math.round(stats0.islandRenters)} island renters + the region's ${stats0.agents - Math.round(stats0.islandRenters)})`);
check(stats0.medianBurden > 0.25 && stats0.medianBurden < 0.36, `the opening's median rent burden ${(100 * stats0.medianBurden).toFixed(1)}% (the engine's flats are built on 30%)`);
check(Math.abs(stats0.persons / a.econ.population - 1) < 0.08, `persons ${Math.round(stats0.persons)} against a population of ${Math.round(a.econ.population)} (within 8%)`);

// it reads the world and never writes it: a month of the register on a copy of
// the state changes nothing but the register and its own stream
{
  const strip = (g) => { const { households, streams, ...rest } = g; void households; const { households: _h, ...st } = streams ?? {}; void _h; return JSON.stringify({ ...rest, streams: st }); };
  const copy = structuredClone(a);
  const before = strip(copy);
  const s0 = copy.streams.households;
  E.tickHouseholdRegister(copy, city.parcels);
  check(strip(copy) === before, "a month of the register writes nothing in the world it reads");
  check(typeof copy.streams.households === "number" && copy.streams.households !== s0, "it draws on its own channel, s.streams.households");
}

// save and load: base64 columns, through JSON, back to the same register — and both play on identically
{
  const packed = E.packHouseholdsForSave(a);
  const text = JSON.stringify(packed);
  check(typeof packed.households.packed?.sav === "string" && !packed.households.a && a.households.a, "a save carries base64 columns and leaves the running game's arrays alone");
  const kb = JSON.stringify(packed.households).length / 1024;
  check(kb < 800, `the register saves in ${kb.toFixed(0)} KB (${a.households.n} households)`);
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
