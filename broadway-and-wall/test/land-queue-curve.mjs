// THE BUILD QUEUE IS A SAMPLE, READ AS A CURVE.
//
//   pnpm engine && node test/land-queue-curve.mjs
//
// refreshLandQueue measures the queue on a sample of lots, each standing for
// many lots' floor area. Read as a staircase, a lot whose residual edged past
// one sampled site jumped years up the queue and its land price doubled in a
// month (seed 20261: $199 -> $397 -> $269 /sf of lot in three months, rents,
// caps and costs unchanged). The wait is now read off the line between
// samples: same samples, same total, same best and worst place in line, and
// no step anywhere between.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));

let bad = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "OK  " : "FAIL"}  ${msg}`); if (!cond) bad++; };
console.log("\nTHE BUILD QUEUE, READ AS A CURVE\n");

// the office queue measured in a City at year 11 (seed 20261): 13 sampled sites
const q = {
  psf: [1255, 1129, 634, 497, 433, 428, 405, 362, 336, 333, 132, 131, 107],
  ahead: [0, 303e3, 482e3, 651e3, 800e3, 892e3, 1374e3, 1503e3, 1574e3, 1898e3, 2011e3, 2040e3, 2136e3],
  total: 2209e3, absYr: 97e3, r: 0.078,
};
const econ = { landQueue: { office: q, retail: undefined, multifamily: undefined, industrial: undefined }, landQueueW: 1 };
const f = (psf) => E.queueFactor(econ, "office", psf);
const wait = (psf) => -Math.log(f(psf)) / Math.log(1 + q.r);   // years in line

ok(f(2000) === 1, `the best site waits for nothing (${f(2000).toFixed(3)})`);
ok(Math.abs(wait(q.psf[6]) - q.ahead[6] / q.absYr) < 1e-6, `at a sampled site the wait is the floor area ahead of it (${wait(405).toFixed(2)} yrs)`);
ok(Math.abs(wait(0.01) - q.total / q.absYr) < 0.01, `a residual of nothing waits behind the whole queue (${wait(0.01).toFixed(2)} of ${(q.total / q.absYr).toFixed(2)} yrs)`);
// no step: one dollar of residual never moves the wait by more than the
// steepest stretch between two samples allows for that dollar
let worst = 0, mono = true;
for (let p = 1; p < 1400; p += 1) {
  const d = wait(p) - wait(p + 1);
  if (d < -1e-9) mono = false;
  worst = Math.max(worst, d);
}
let steepest = 0;
for (let i = 1; i < q.psf.length; i++) steepest = Math.max(steepest, (q.ahead[i] - q.ahead[i - 1]) / q.absYr / (q.psf[i - 1] - q.psf[i]));
ok(mono, "a dearer site never waits longer");
ok(worst <= steepest + 1e-9, `no step: $1 of residual moves the wait at most ${worst.toFixed(3)} yrs (the steepest stretch between samples: ${steepest.toFixed(3)})`);
// the step that motivated it: just under and just over the site sampled at
// $428, which carries 482k sf (five years of office take-up) — as a staircase
// two cents of residual moved the wait five years and the land price x1.45
const jump = f(428.01) / f(427.99);
ok(jump < 1.001, `two cents across a sampled site moves the price x${jump.toFixed(4)} (a staircase: x${Math.pow(1 + q.r, (1374e3 - 892e3) / q.absYr).toFixed(2)})`);

console.log(bad ? `\nland-queue-curve: ${bad} FAILED\n` : "\nland-queue-curve: ok\n");
process.exit(bad ? 1 : 0);
