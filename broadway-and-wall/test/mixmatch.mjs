// DOES THE CITY BUILD WHAT THE MARKET ORDERED?
//
//   pnpm mixmatch                              four towns, fifty years
//   N=8 HZ=720 pnpm mixmatch                   more of both
//
// `pnpm leadlag` asks whether the cycle runs in the right ORDER. This asks a
// different question about the same leg, and the two are not substitutes.
//
// The space market keeps an order book: `econ.startOwed`, square feet asked for
// and not yet delivered, PER CLASS. The crane count reads the total of it — the
// backlog in tickCityDev sizes the pipeline off the sum. But the sum is all it
// reads. Which class each crane then builds is picked by `useForZone` from the
// zone, a demand score and a die.
//
// So the order book can say "office is four hundred thousand feet short" and
// the city can answer with flats, and nothing anywhere notices. That is the
// difference between a queue and a quota: a queue is filled in order.
//
// WHAT THIS MEASURES is composition, not timing. For each month and each class:
//
//     owedShare[k]  = owed[k]  / sum(owed)         what was asked for
//     brokeShare[k] = broke[k] / sum(broke)        what went in the ground
//
// and the Pearson correlation between the two series, per class and pooled.
// Groundbreaks are lumpy — a single tower is a whole month's output in one
// parcel — so the break shares are taken over a trailing window wide enough
// that a month with two jobs in it is not being compared against a quota.
//
// A correlation near zero means the order book is decoration: the city builds
// its usual mix regardless of what is short. Near one means composition is
// respected and the queue is real. This is the direct test of the mechanism;
// the lead-lag r on `orders -> breaks` is a noisy shadow of it, because that
// leg mixes composition and timing into one number and cannot say which failed.
//
// WHAT IT SAYS TODAY, and why this file exists rather than a fix:
//
//   office       r  0.09     ordered 28.4%   built 30.4%
//   retail       r -0.03     ordered  6.0%   built 18.3%
//   industrial   r -0.09     ordered 29.6%   built  2.0%
//   multifamily  r -0.09     ordered 35.9%   built 49.2%
//
// Three of the four are NEGATIVE. A class being short this month does not make
// the city more likely to build it, and industrial — a third of everything the
// space market asks for — is two per cent of what goes in the ground. The order
// book is decoration, and the lead-lag leg reads r 0.31 on a 27-month plateau
// because the only thing linking orders to groundbreaks is the rent term that
// drives both. That is the finding. It is real and it is not fixed here.
//
// THE OBVIOUS FIX WAS TRIED AND REVERTED, and the reason is worth more than the
// attempt. `useForZone` picks a use from the zone, a demand score and a die; the
// patch weighted that draw by each class's share of the order book, bounded to
// [0.33, 2.5] so zoning still won outright. Measured against this file it did
// what it claimed — office r 0.09 -> 0.16, retail -0.03 -> 0.16, multifamily
// -0.09 -> 0.10. It was still wrong, on three counts:
//
//   1. The pre-registered test failed. `orders -> breaks` went 0.31 -> 0.29.
//   2. The blast radius was absurd for a mix nudge: median land value +72%,
//      office rent index +61.5%, affordable lot share +327% — on 3.6% more
//      floor area. A composition tweak that reprices the city is not a
//      composition tweak.
//   3. THE BOUNDS WERE LOAD-BEARING. Instrumented over 9,084 (month, class)
//      draws, the clamp bound 52.7% of the time — retail sat on the low rail
//      63.6% of the time and never once reached the high one. CLAUDE.md fake
//      number five: a rail that rests against itself in normal play is holding
//      up the model. The tilt was not reading the order book in half its draws,
//      it was reading 0.33 and 2.5, two numbers with no source but me.
//
// The rails bound because the order book is spiky: office swings from 1k sf to
// 298k sf across a cycle while industrial sits on a permanent ~40k floor it can
// never work off (M-zoned land is scarce, so those orders are structurally
// unfillable). Shares computed off that are mostly zero and occasionally
// everything, so any bounded ratio spends its life against a stop.
//
// WHAT THE REAL FIX PROBABLY IS, for whoever picks this up: not a weight on the
// die at all. A developer chooses a use because that use yields most on that
// site net of what it costs to build — and the pro forma already computes
// exactly that, per class, in `devPencils`. Picking the use by yield needs no
// new constant, has no rails to bind, and gets the order book in through the
// front door, because the orders are what moved the rents the yield is made of.
import { assertFreshBundle } from "./fresh.mjs";
if (!process.env.ENGINE) assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(process.env.ENGINE ? join(HERE, "..", process.env.ENGINE) : join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

const N = +(process.env.N || 4);
const HZ = +(process.env.HZ || 600);
const WIN = +(process.env.WIN || 12);   // trailing months the break mix is read over
const CLASSES = ["office", "retail", "industrial", "multifamily"];

const pad = (s, n) => String(s).padEnd(n);
const rp = (s, n) => String(s).padStart(n);

function pearson(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 8) return NaN;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n, my = sy / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx, b = ys[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : NaN;
}

// Per class: every (town, month) pair that had both an order book and a crane.
const owedS = Object.fromEntries(CLASSES.map((k) => [k, []]));
const brokeS = Object.fromEntries(CLASSES.map((k) => [k, []]));
let months = 0, live = 0;

for (let i = 0; i < N; i++) {
  const { parcels, adjacency, bbls } = loadCity(i, E.normalizeParcels);
  let g = E.firstListings(E.newGame(9001 + i, parcels), parcels, bbls);
  const seen = new Set();
  const hist = [];                       // trailing per-class groundbreak sf
  const owedAt = [];
  for (let m = 0; m < HZ; m++) {
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
    g = E.advanceQuarter(g, parcels, bbls, adjacency);
    const owed = g.econ.startOwed ?? {};
    owedAt.push(Object.fromEntries(CLASSES.map((k) => [k, Math.max(0, owed[k] ?? 0)])));
    const broke = Object.fromEntries(CLASSES.map((k) => [k, 0]));
    for (const j of g.cityJobs ?? []) {
      const key = j.bbl + "#" + j.startM;
      if (seen.has(key)) continue;
      seen.add(key);
      for (const k of CLASSES) {
        const share = j.mix?.[k] ?? (j.use === k ? 1 : 0);
        if (share > 0) broke[k] += j.sf * share;
      }
    }
    hist.push(broke);
    if (hist.length < WIN) continue;
    months++;
    // Break mix over the trailing window; order book as of the window's START,
    // because a crane going in this month was picked against the book that
    // existed when the site was chosen, not the one it just decremented.
    const win = hist.slice(-WIN);
    const bTot = CLASSES.reduce((a, k) => a + win.reduce((t, h) => t + h[k], 0), 0);
    const o0 = owedAt[owedAt.length - WIN];
    const oTot = CLASSES.reduce((a, k) => a + o0[k], 0);
    if (!(bTot > 0) || !(oTot > 0)) continue;
    live++;
    for (const k of CLASSES) {
      owedS[k].push(o0[k] / oTot);
      brokeS[k].push(win.reduce((t, h) => t + h[k], 0) / bTot);
    }
  }
}

console.log(`\nDOES THE CITY BUILD WHAT THE MARKET ORDERED — ${N} towns x ${HZ / 12} years, ${WIN}mo window\n`);
console.log(`  ${pad("class", 14)}${rp("r", 8)}${rp("ordered", 10)}${rp("built", 10)}   share of the mix`);
let pooledX = [], pooledY = [];
for (const k of CLASSES) {
  const r = pearson(owedS[k], brokeS[k]);
  const mo = owedS[k].reduce((a, v) => a + v, 0) / Math.max(1, owedS[k].length);
  const mb = brokeS[k].reduce((a, v) => a + v, 0) / Math.max(1, brokeS[k].length);
  pooledX = pooledX.concat(owedS[k]); pooledY = pooledY.concat(brokeS[k]);
  console.log(`  ${pad(k, 14)}${rp(Number.isFinite(r) ? r.toFixed(2) : "n/a", 8)}${rp((mo * 100).toFixed(1) + "%", 10)}${rp((mb * 100).toFixed(1) + "%", 10)}`);
}
const pool = pearson(pooledX, pooledY);
// The pooled number is across classes as well as time, so it also rewards a
// city that merely gets the RANKING right — office is usually the biggest share
// of both. The per-class numbers above are the ones that need a mechanism,
// because they ask whether a class being short THIS month changes anything.
console.log(`\n  pooled r  ${pool.toFixed(2)}   over ${live} live months of ${months} sampled`);
console.log(`\n  Near zero: the order book is decoration and the city builds its usual mix.`);
console.log(`  Near one: composition is respected and the queue is a queue.\n`);
