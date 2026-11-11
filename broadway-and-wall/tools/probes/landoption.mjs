// THE LAND OPTION, READ OFF A RUN (value.ts LandOption). Every five years:
// the town's measured sigma by class, and over the vacant lots the option is
// struck on, the trigger V*/K, the share past the trigger, and the option
// premium — land over intrinsic, (F − max(V−K, 0)) / F — to set against
// Quigg (1993, Seattle: about 6% of land value on average).
//   SEED=11 YEARS=30 node tools/probes/landoption.mjs
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const HERE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "test");
const E = await import(pathToFileURL(join(HERE, ".engine.mjs")).href);
const { loadCity } = await import(pathToFileURL(join(HERE, "city.mjs")).href);
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);
const SEED = +(process.env.SEED ?? 11), YEARS = +(process.env.YEARS ?? 30);
let g = E.firstListings(E.newGame(SEED, parcels), parcels, bbls);
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
for (let m = 1; m <= YEARS * 12; m++) {
  g = E.advanceQuarter(g, parcels, bbls, adjacency);
  if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
  if (m % 60 !== 0) continue;
  const prem = [], premPriced = [], trig = [], betas = [];
  let n = 0, ripe = 0, optWins = 0, inTheMoney = 0;
  for (const bbl of bbls) {
    const rec = E.resolveRec(parcels, g, bbl);
    if (!rec || rec.class !== "land" || rec.ag || rec.homeLot) continue;
    const r = E.landRead(rec, g.econ);
    const o = r.option;
    if (!o || !(o.psf > 0)) continue;
    n++;
    if (o.exercise) ripe++;
    if (o.intrinsicPsf > 0) inTheMoney++;
    if (r.winner === "holder") optWins++;
    trig.push(o.vStar / o.k); betas.push(o.beta);
    // F before the build queue, from the option's own terms
    const f = o.exercise ? o.v - o.k : Math.pow(o.v / o.vStar, o.beta) * (o.vStar - o.k);
    const pp = f > 0 ? 1 - Math.max(0, o.v - o.k) / f : 0;
    prem.push(pp);
    if (r.winner === "holder" || r.winner === "builder") premPriced.push(pp);
  }
  const sg = g.econ.landSigma;
  console.log(`y${m / 12}  sigma ${sg ? Object.entries(sg).map(([k, v]) => k.slice(0, 3) + " " + v.toFixed(3)).join(" ") : "(unmeasured)"}`
    + `  | lots ${n}  beta med ${med(betas).toFixed(2)}  V*/K med ${med(trig).toFixed(2)}  past trigger ${(100 * ripe / Math.max(1, n)).toFixed(1)}%`
    + `  V>K ${(100 * inTheMoney / Math.max(1, n)).toFixed(1)}%  option sets price ${(100 * optWins / Math.max(1, n)).toFixed(1)}%`
    + `  | premium mean ${(100 * mean(prem)).toFixed(1)}%  (option/builder-priced ${(100 * mean(premPriced)).toFixed(1)}%, n ${premPriced.length})`);
}
