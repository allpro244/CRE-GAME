// The town's builder firms and the frames they start, by decade: firms alive,
// entries, retirements, failures, construction starts a year, and stalled
// frames taken over. Usage: node bprobe.mjs ROOT SEED YEARS
import { pathToFileURL } from "url"; import { join } from "path";
const ROOT = process.argv[2], SEED = Number(process.argv[3] ?? 11), YEARS = Number(process.argv[4] ?? 40);
const E = await import(pathToFileURL(join(ROOT, "test", ".engine.mjs")).href);
const { makeCity } = await import(pathToFileURL(join(ROOT, "src", "citygen", "index.mjs")).href);
const city = makeCity("somewhere", 1); E.normalizeParcels(city.parcels); const bbls = Object.keys(city.parcels);
let g = E.firstListings(E.newGame(SEED, city.parcels), city.parcels, bbls);
const dec = () => ({ alive: 0, entries: 0, retired: 0, failed: 0, starts: 0, startSf: 0, rescues: 0, openings: 0 });
const D = [];
const seenJob = new Set();
let bad = 0;
for (let m = 1; m <= YEARS * 12; m++) {
  g = E.advanceQuarter(g, city.parcels, bbls, city.adjacency);
  if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
  const d = (D[Math.floor((m - 1) / 120)] ??= dec());
  for (const j of g.cityJobs ?? []) {
    const k = `${j.bbl}:${j.startM}`;
    if (seenJob.has(k)) continue;
    seenJob.add(k);
    if (m > 1) { d.starts++; d.startSf += j.sf ?? 0; }
  }
  for (const n of g.news ?? []) if (n.q === g.month && /bought the stalled project/.test(n.text)) d.rescues++;
  d.openings += (g.builderOpenings ?? []).length;   // schemes this month's looks found and could not fund (absent on main)
  if (!Number.isFinite(g.econ.rentIdx?.office)) bad++;
  if (m % 120 === 0) {
    const bf = (g.rivals ?? []).filter((r) => r.builderProf);
    const lo = m - 120, hi = m;
    d.alive = bf.filter((r) => r.failedM === undefined && r.retiredM === undefined).length;
    d.entries = bf.filter((r) => r.bornM > lo && r.bornM <= hi && r.bornM > 0).length;
    d.retired = bf.filter((r) => r.retiredM !== undefined && r.retiredM > lo && r.retiredM <= hi).length;
    d.failed = bf.filter((r) => r.failedM !== undefined && r.failedM > lo && r.failedM <= hi).length;
  }
}
console.log(`seed ${SEED}, ${YEARS} years${bad ? `, ${bad} NaN months` : ""}`);
console.log("decade | builder firms alive (end) | entries | retired | failed | starts/yr | start ksf/yr | frames rescued | unfunded openings");
D.forEach((d, i) => console.log(`${i + 1} | ${d.alive} | ${d.entries} | ${d.retired} | ${d.failed} | ${(d.starts / 10).toFixed(1)} | ${Math.round(d.startSf / 10 / 1000)} | ${d.rescues} | ${d.openings}`));
