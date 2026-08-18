// THE TWENTY-YEAR VACANCY TAPE — is it a market, or a ruler?
//
// The Economy page's default window is 240 months. A run where each class
// sits on its frictional floor for that entire window is the complaint this
// harness exists to catch: office 3.68% for 20 years, industrial 1.54% for
// 20 years, four flat gauges.
//
// Direct `cityVac` is clamped to frictionFloor. That is a statement about
// empty landlord floors and it can sit there. What must not happen is the
// CATCH-22 that made it load-bearing: sitePencil 0 → startOwed 0 → densify
// refused → the short class converted to housing → stock fell while jobs
// rose → vacancy never left the rail.
//
//   node test/vac-tape.mjs
//   SEEDS=550991,15838 HZ=360 node test/vac-tape.mjs
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

const SEEDS = (process.env.SEEDS ?? "550991,15838,7919").split(",").map(Number);
const HZ = Number(process.env.HZ ?? 360);
const WIN = Math.min(240, HZ);
const CLASSES = ["office", "retail", "multifamily", "industrial"];

let bad = 0;
const say = (ok, msg) => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${msg}`);
  if (!ok) bad++;
};

console.log(`\nVACANCY TAPE — ${SEEDS.length} seeds × ${HZ}m (last ${WIN}m is the Economy window)\n`);

for (const [i, seed] of SEEDS.entries()) {
  const { parcels: P0, adjacency, bbls } = loadCity(i, E.normalizeParcels);
  const parcels = structuredClone(P0);
  let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  const jobs0 = g.econ.jobs;
  const stock0 = { ...g.econ.stock };
  const pin = Object.fromEntries(CLASSES.map((k) => [k, 0]));
  const series = Object.fromEntries(CLASSES.map((k) => [k, { vac: [], avail: [] }]));
  let histAvail = 0;
  for (let m = 0; m < HZ; m++) {
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
    g = E.advanceMonth(g, parcels, bbls, adjacency);
    const e = g.econ;
    const h = e.history?.[e.history.length - 1];
    if (h?.avail) histAvail++;
    for (const k of CLASSES) {
      const vac = e.cityVac?.[k] ?? 0;
      const avail = E.availability(e, k);
      series[k].vac.push(vac);
      series[k].avail.push(avail);
      if (vac <= E.frictionFloor(k) + 1e-6) pin[k]++;
    }
  }
  const jobsC = g.econ.jobs / jobs0 - 1;
  console.log(`seed ${seed}  jobs ${(jobsC * 100).toFixed(1)}%  month ${g.month}`);
  say(histAvail === HZ, `history stamps avail every month (${histAvail}/${HZ})`);

  for (const k of CLASSES) {
    const vac = series[k].vac.slice(-WIN);
    const avail = series[k].avail.slice(-WIN);
    const vMin = Math.min(...vac), vMax = Math.max(...vac);
    const aMin = Math.min(...avail), aMax = Math.max(...avail);
    const vRange = vMax - vMin;
    const aRange = aMax - aMin;
    const unique = new Set(vac.map((v) => v.toFixed(4))).size;
    const pinWin = vac.filter((v) => v <= E.frictionFloor(k) + 1e-6).length;
    const stockNow = g.econ.stock[k];
    const stockC = stockNow / stock0[k] - 1;
    console.log(
      `  ${k.padEnd(12)} vac ${(vMin * 100).toFixed(2)}–${(vMax * 100).toFixed(2)}%  `
      + `avail ${(aMin * 100).toFixed(2)}–${(aMax * 100).toFixed(2)}%  `
      + `pin ${pinWin}/${WIN}  stock ${(stockC * 100).toFixed(1)}%`,
    );
    // A class that sits on its floor the entire Economy window while jobs
    // grew is allowed — housing does this — but its STOCK must not shrink.
    // That is the city dismantling the thing it is short of.
    if (k !== "multifamily" && jobsC >= 0.10 && pinWin >= WIN * 0.85) {
      say(stockC >= -0.01,
        `${k}: pinned ${pinWin}/${WIN} with jobs +${(jobsC * 100).toFixed(0)}% must not lose stock (Δ ${(stockC * 100).toFixed(1)}%)`);
    }
    // The tape the player reads is availability. A 20-year window of a single
    // unique direct-vacancy print is the ruler complaint when EVERY commercial
    // class does it. Per class: availability must move OR stock must have
    // grown (deliveries that the floor then ate).
    if (k === "office" && jobsC >= 0.10) {
      say(aRange >= 0.008 || stockC >= 0.02 || unique > 8,
        `office 20y tape moves (avail range ${(aRange * 100).toFixed(2)}pp, stock ${(stockC * 100).toFixed(1)}%, unique vac ${unique})`);
    }
    void vRange;
  }
}

if (bad) {
  console.error(`\n${bad} vacancy-tape check(s) failed\n`);
  process.exit(1);
}
console.log("\nthe twenty-year tape stayed a market\n");
