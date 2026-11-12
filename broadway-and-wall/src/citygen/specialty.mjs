// WHAT THIS TOWN MAKES FOR THE REST OF THE COUNTRY (city plan 19).
//
// A real town is not the nation in miniature. It lives off a few traded
// industries — an insurer's head office, a port, a plant, a software house —
// at two to four times the nation's share, and has little of most others; its
// fortunes follow theirs. A town with the national mix grows as the nation
// does, which in the engine's CBO labour-force path is ~0.35% a year: nothing
// to build for, every seed alike.
//
// THE SPREAD IS MEASURED: Census County Business Patterns 2021 (cbp21msa),
// every metro and micro area, the 34 traded 3-digit NAICS industries holding
// at least 0.2% of US employment (manufacturing; wholesale; transport and
// warehousing; information; finance and insurance; professional services;
// management of companies). The standard deviation of the log location
// quotient (the industry's share of the area's employment over its share of
// the nation's), by the area's employment [S, computed from the CBP file]:
//      10k-50k   1.25   (486 areas)
//      50k-200k  1.10   (175)
//     200k-1M    0.89   (75)
//       1M+      0.72   (26)
// Each traded industry's location quotient is drawn lognormal at the spread
// for the region's size, from a hash of the city's seed (no random stream is
// read), centred so the draws average one, and the set is scaled so the
// town's traded employment is the nation's share of it: what changes is WHICH
// industries carry the town, not how much of it is traded. Local-serving
// industries (shops, restaurants, schools, doctors, the trades) keep the
// national mix — they follow the town's people.
import { FLOOR_PER_RESIDENT } from "./floorDemand.mjs";

const SPREAD = [[30_000, 1.25], [110_000, 1.10], [450_000, 0.89], [2_000_000, 0.72]];
/** The CBP spread for a region of `jobs` employment, interpolated on log size. */
export function specSpread(jobs) {
  const x = Math.log(Math.max(1, jobs));
  if (x <= Math.log(SPREAD[0][0])) return SPREAD[0][1];
  for (let i = 1; i < SPREAD.length; i++) {
    const [j0, s0] = SPREAD[i - 1], [j1, s1] = SPREAD[i];
    if (x <= Math.log(j1)) return s0 + (s1 - s0) * (x - Math.log(j0)) / (Math.log(j1) - Math.log(j0));
  }
  return SPREAD[SPREAD.length - 1][1];
}

const hash = (str) => {
  let x = 2166136261;
  for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619); }
  x ^= x >>> 13; x = Math.imul(x, 0x5bd1e995); x ^= x >>> 15;
  return ((x >>> 0) + 0.5) / 4294967297;
};
/** A standard normal from two hashes (Box-Muller). */
const normal = (key) => Math.sqrt(-2 * Math.log(hash(key + "|a"))) * Math.cos(2 * Math.PI * hash(key + "|b"));

/**
 * The town's location quotient for each industry id (1 for every industry
 * not traded), for city seed `seed` and spread `sd` (specSpread). Traded
 * employment keeps the nation's share.
 */
export function townLQ(seed, sd) {
  const out = {};
  if (!(sd > 0)) return out;
  let nat = 0, town = 0;
  for (const r of FLOOR_PER_RESIDENT) {
    if (!r.traded) continue;
    const lq = Math.exp(sd * normal(`lq:${seed >>> 0}:${r.id}`) - (sd * sd) / 2);
    out[r.id] = lq;
    nat += r.jobs; town += r.jobs * lq;
  }
  const k = town > 0 ? nat / town : 1;
  for (const id of Object.keys(out)) out[id] = +(out[id] * k).toFixed(4);
  return out;
}
