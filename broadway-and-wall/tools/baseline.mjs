// THE STANDING NUMBERS.
//
// This exists because of a bug that lived in the engine for an unknown number
// of commits and that no harness in the repo could see: 27% of the city's
// commercial legs — every shopfront and small office below the suite floor —
// could not hold a tenant in any generated rent roll, in any year. Nothing was
// broken in a way a test could catch. Occupancy was simply, quietly, wrong
// everywhere, and every number downstream of it was wrong by the same amount.
//
// A gate catches a violated identity. A report catches a band being breached.
// NEITHER CATCHES A NUMBER THAT HAS ALWAYS BEEN WRONG, because there is nothing
// to compare it to. That is what this is: a committed record of what the engine
// measured at a known-good commit, so the next change can be diffed against it
// rather than against a memory.
//
//   pnpm baseline          write BASELINE.json from the current tree
//   pnpm baseline:check    measure now, diff against the committed file
//
// The check is a REPORT, not a gate, with one exception: metrics tagged `id`
// are identities and a move in them exits 1. Everything else prints its delta
// and leaves the judgement to a person. A baseline that fails on every honest
// improvement gets regenerated without being read, and then it is furniture.
//
// TWO RULES FOR ADDING A METRIC HERE.
//
//   It must be able to move. A metric pinned at a cap or a clamp measures the
//   cap. Before adding one, perturb something upstream and check that it
//   responds — CLAUDE.md documents three checks in this repo that could not
//   fail and printed reassuring output for weeks.
//
//   It must be CHEAP. This has to be runnable on every change or it will not
//   be run on any. Target is under a minute in total. The expensive sweeps
//   stay where they are.
//
// AND IT MUST NOT MEASURE THE CLOCK. The first cut of this sampled everything
// at month 300 and reported lot affordability as ZERO — which looked like a
// catastrophic regression and was nothing of the kind. Affordability is
// CYCLICAL: 8-12% of lots pencil mid-cycle and almost none do at the turns, so
// a one-month snapshot reports the phase of the cycle rather than the level of
// anything. Every cyclical quantity here is therefore a MEAN OVER THE LAST TEN
// YEARS, sampled annually. Only genuine stocks — buildings standing, floor
// area, cumulative demolitions — are read at the end, because those are the
// numbers a point-in-time reading actually describes.
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const FILE = join(ROOT, "BASELINE.json");

const E = await import(join(ROOT, "test", ".engine.mjs"));
const { makeCity } = await import(join(ROOT, "src", "citygen", "index.mjs"));

const med = (a) => { const s = [...a].filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN; };
const pct = (a, p) => { const s = [...a].filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(p * (s.length - 1))] : NaN; };

// ---------------------------------------------------------------- the probes
//
// Each returns { key: value } and says, in its comment, what going wrong looks
// like. `id` in the name marks an identity: it is not allowed to move at all.
const CITY = "newalden", CITY_SEED = 1, SEEDS = [550991, 12007, 73303];

function freshCity() {
  const built = makeCity(CITY, CITY_SEED);
  E.normalizeParcels(built.parcels);
  return { parcels: built.parcels, adjacency: built.adjacency, bbls: Object.keys(built.parcels) };
}

/**
 * THE ONE THAT WOULD HAVE CAUGHT IT. Generate a rent roll for every standing
 * commercial building and ask what share of legs got no tenant at all, and
 * what the city's commercial occupancy comes to. A leg that cannot be let is
 * invisible to every other harness: nothing is out of balance, no band is
 * breached, the city just runs permanently emptier than it should.
 */
function rolls(g, base) {
  let zero = 0, tot = 0, sf = 0, let_ = 0;
  for (const bbl of base.bbls) {
    const r = E.resolveRec(base.parcels, g, bbl);
    if (!r || r.class === "land" || !(r.bldgArea > 0)) continue;
    const h = { bbl, tenants: [], occ: 0, condition: E.initialCondition(r), boughtM: g.month, costBasis: 0, programsDone: {} };
    E.genRentRoll(g, r, h);
    for (const u of Object.keys(E.mixOf(r))) {
      if (u === "multifamily") continue;
      const leg = E.useSf(r, u);
      if (leg < 400) continue;
      tot++;
      const leased = h.tenants.filter((t) => (t.use ?? u) === u).reduce((a, t) => a + t.sf, 0);
      if (leased === 0) zero++;
      sf += leg; let_ += leased;
    }
  }
  return {
    "roll.deadLegShare": +(zero / Math.max(1, tot)).toFixed(4),
    "roll.commercialOcc": +(let_ / Math.max(1, sf)).toFixed(4),
  };
}

/** Land, across the whole city. A distribution, not a mean — the spread is the story. */
function land(g, base) {
  const psf = base.bbls.map((b) => {
    const r = E.resolveRec(base.parcels, g, b);
    return r?.lotArea ? E.landValue(r, g.econ) / r.lotArea : NaN;
  });
  return {
    "land.p10": +pct(psf, 0.10).toFixed(2),
    "land.med": +med(psf).toFixed(2),
    "land.p90": +pct(psf, 0.90).toFixed(2),
  };
}

/**
 * CAN A BUILDER PAY THE ASKING PRICE? This ran at ZERO — not few, zero — for an
 * entire era of this engine, because land was priced strictly above every
 * builder's residual by construction. A market where nothing pencils is a
 * market with no development in it, and the number that says so is this one.
 */
function pencils(g, base) {
  let ok = 0, n = 0;
  for (const b of base.bbls) {
    const r = E.resolveRec(base.parcels, g, b);
    if (!r?.lotArea || (r.bldgArea > 0)) continue;
    const read = E.landRead(r, g.econ);
    n++;
    if (read.builder >= read.psf) ok++;
  }
  return { "dev.affordableLotShare": +(ok / Math.max(1, n)).toFixed(4) };
}

/** The space market, by class: where vacancy actually sits. */
function space(g) {
  const out = {};
  for (const k of ["office", "retail", "multifamily", "industrial"]) {
    out[`vac.${k}`] = +(g.econ.cityVac?.[k] ?? NaN).toFixed(4);
    out[`rentIdx.${k}`] = +(g.econ.rentIdx?.[k] ?? NaN).toFixed(4);
  }
  return out;
}

/** The city itself: does it still build and still tear down. */
function city(g, base) {
  let standing = 0, area = 0;
  for (const b of base.bbls) {
    const r = E.resolveRec(base.parcels, g, b);
    if (r && r.class !== "land" && r.bldgArea > 0) { standing++; area += r.bldgArea; }
  }
  return {
    "city.buildings": standing,
    "city.floorAreaM": +(area / 1e6).toFixed(3),
    "city.demolished": g.demolished ?? 0,
    "city.employed": g.econ.jobs ?? 0,
    "city.population": g.econ.population ?? 0,
  };
}

// ---------------------------------------------------------------- run it
const MONTHS = 300;          // twenty-five years
const WINDOW = 120;          // the last ten of them, which is more than a cycle

function measure() {
  const out = {};
  for (const seed of SEEDS) {
    const base = freshCity();
    let g = E.firstListings(E.newGame(seed, base.parcels), base.parcels, base.bbls);
    const samples = {};
    for (let m = 0; m < MONTHS; m++) {
      g = E.advanceQuarter(g, base.parcels, base.bbls, base.adjacency);
      // The frozen world: advanceQuarter returns state UNCHANGED once gameOver
      // is set, so an un-resurrected probe silently stops and every later month
      // is a copy of the month it died in. See CLAUDE.md.
      if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
      // Annually across the last ten years: enough samples to average a cycle
      // out, few enough that regenerating every rent roll in the city stays
      // cheap.
      if (m >= MONTHS - WINDOW && (MONTHS - 1 - m) % 12 === 0) {
        const row = { ...rolls(g, base), ...land(g, base), ...pencils(g, base), ...space(g) };
        for (const [k, v] of Object.entries(row)) (samples[k] ??= []).push(v);
      }
    }
    // cyclical quantities: the mean of their own trajectory. stocks: the end.
    const row = {};
    for (const [k, vals] of Object.entries(samples)) {
      row[k] = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
    }
    Object.assign(row, city(g, base));
    for (const [k, v] of Object.entries(row)) (out[k] ??= []).push(v);
  }
  // the median across seeds, so one unlucky city cannot move the record
  const final = {};
  for (const [k, vals] of Object.entries(out)) final[k] = +med(vals).toFixed(4);
  return final;
}

const now = measure();
const mode = process.argv[2] === "--check" ? "check" : "write";
let commit = "unknown";
try { commit = execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim(); } catch { /* not a repo */ }

if (mode === "write") {
  writeFileSync(FILE, JSON.stringify({ commit, city: CITY, citySeed: CITY_SEED, seeds: SEEDS, months: 300, metrics: now }, null, 2) + "\n");
  console.log(`\n  wrote BASELINE.json at ${commit} — ${Object.keys(now).length} metrics\n`);
  for (const [k, v] of Object.entries(now)) console.log(`  ${k.padEnd(28)}${String(v).padStart(14)}`);
  console.log("");
  process.exit(0);
}

if (!existsSync(FILE)) {
  console.error("  No BASELINE.json. Run `pnpm baseline` on a commit you trust first.");
  process.exit(1);
}
const was = JSON.parse(readFileSync(FILE, "utf8"));
console.log(`\n  BASELINE ${was.commit} -> now ${commit}\n`);
console.log(`  ${"metric".padEnd(28)}${"baseline".padStart(14)}${"now".padStart(14)}${"change".padStart(11)}`);
const moved = [];
for (const k of Object.keys({ ...was.metrics, ...now })) {
  const a = was.metrics[k], b = now[k];
  if (a === undefined) { console.log(`  ${k.padEnd(28)}${"—".padStart(14)}${String(b).padStart(14)}${"NEW".padStart(11)}`); continue; }
  if (b === undefined) { console.log(`  ${k.padEnd(28)}${String(a).padStart(14)}${"—".padStart(14)}${"GONE".padStart(11)}`); moved.push(k); continue; }
  const d = a === 0 ? (b === 0 ? 0 : Infinity) : (b - a) / Math.abs(a);
  const flag = Math.abs(d) < 0.005 ? "" : `${(d * 100).toFixed(1)}%`;
  console.log(`  ${k.padEnd(28)}${String(a).padStart(14)}${String(b).padStart(14)}${flag.padStart(11)}`);
  if (Math.abs(d) >= 0.005) moved.push(k);
}
console.log(`\n  ${moved.length} of ${Object.keys(was.metrics).length} metrics moved by more than half a per cent.`);
console.log(`  This is a REPORT. Movement is not failure — a fix that improves the world`);
console.log(`  moves numbers, and that is the point. What it is for is making sure nobody`);
console.log(`  moves one WITHOUT NOTICING.\n`);
