// MDGA instrument — WHY DOESN'T THE CITY BUILD ON LOTS THAT PAY? (MDGA_PLAN.md, phase 1)
// Every ten years: vacant lots whose land read says a builder can pay (winner
// "builder"), split by who holds them (named firm / nobody), next to the city's
// construction order book (startOwed, sf), live city jobs, and starts that decade.
//   pnpm engine && node tools/mdga/citybuild.mjs
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, "..", "..", "test", ".engine.mjs"));
const { loadCity } = await import(join(HERE, "..", "..", "test", "city.mjs"));
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);
let g = E.firstListings(E.newGame(Number(process.env.SEED ?? 7919), parcels), parcels, bbls);
const seen = new Set(); let starts = 0;
const row = () => {
  let ripe = 0, ripeRival = 0, ripeFree = 0, vac = 0;
  for (const b of bbls) {
    const rec = E.resolveRec(parcels, g, b);
    if (rec?.class !== "land" || !rec.lotArea || g.holdings[b]) continue;
    vac++;
    const lr = E.landRead(rec, g.econ);
    if (lr.winner !== "builder") continue;
    ripe++;
    if (E.ownerOf(g, b)) ripeRival++; else ripeFree++;
  }
  const owed = Object.entries(g.econ.startOwed ?? {}).map(([k, v]) => `${k.slice(0, 3)} ${(v / 1000).toFixed(0)}k`).join(" ");
  const st = Object.entries(g.econ.structTight ?? {}).map(([k, v]) => `${k.slice(0, 3)} ${v.toFixed(2)}`).join(" ");
  const sp = Object.entries(g.econ.sitePencil ?? {}).map(([k, v]) => `${k.slice(0, 3)} ${v}`).join(" ");
  return `yr ${String(g.month / 12).padStart(2)} | vacant ${vac} ripe ${ripe} (named firm ${ripeRival}, unheld ${ripeFree}) | city jobs live ${(g.cityJobs ?? []).filter((j) => !j.orphaned).length} starts/decade ${starts} | startOwed ${owed} | structTight ${st} | sitePencil ${sp}`;
};
console.log(row());
for (let m = 1; m <= 600; m++) {
  g = E.advanceMonth(g, parcels, bbls, adjacency);
  if (g.gameOver) g = { ...g, gameOver: null, cash: 5e6 };
  for (const j of g.cityJobs ?? []) { const k = j.bbl + ":" + j.startM; if (!seen.has(k)) { seen.add(k); starts++; } }
  if (m % 120 === 0) { console.log(row()); starts = 0; }
}
