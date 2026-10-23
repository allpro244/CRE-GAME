// THE REGION'S COMMERCE, COUNTED.
//
//   node test/region-commerce.mjs [seed ...]
//
// Every shopping centre, gas station, flex shed, industrial park and truck
// stop the region generator placed (citygen/region/commerce.mjs): how many of
// each, their floor area, their land and the FAR it makes, against the ranges
// the hierarchy is built to (retail FAR ~0.2-0.3, industrial 0.3-0.45).
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const { makeCity, REGION } = await import(join(HERE, "..", "src", "citygen", "index.mjs"));

const ORDER = ["neighbourhood", "strip", "gas", "community", "power", "mall", "rural", "flex", "industrial park", "truck stop"];
const seeds = process.argv.slice(2).map(Number);
for (const seed of seeds.length ? seeds : [1, 2, 3]) {
  const c = makeCity(REGION, seed), m = c.manifest.region.commerce;
  console.log(`\nseed ${seed} — ${c.name}: county ${m.county.toLocaleString()} people, ~${m.townHouseholds.toLocaleString()} households in and around town`);
  let retail = 0;
  for (const t of ORDER) {
    const s = m.sites.filter((x) => x.type === t);
    if (!s.length) { console.log(`  ${t.padEnd(16)} none`); continue; }
    const sf = s.reduce((a, x) => a + x.sf, 0), lot = s.reduce((a, x) => a + x.lotSf, 0);
    if (!["flex", "industrial park"].includes(t)) retail += sf;
    console.log(`  ${t.padEnd(16)} ${String(s.length).padStart(2)} sites, ${String(s.reduce((a, x) => a + x.parcels, 0)).padStart(3)} parcels, ${Math.round(sf).toLocaleString().padStart(9)} sf on ${(lot / 43560).toFixed(0).padStart(4)} ac, FAR ${(sf / lot).toFixed(2)}   ${s.map((x) => `${x.name} ${Math.round(x.sf / 1000)}k`).join("; ")}`);
  }
  const park = m.sites.find((x) => x.type === "industrial park");
  if (park) {
    const lots = Object.values(c.parcels).filter((p) => p.address.startsWith(park.name.replace(/ \(.*/, "")));
    const vacant = lots.filter((p) => p.class === "land");
    console.log(`  industrial park: ${lots.length} lots, ${vacant.length} vacant (${(vacant.reduce((a, p) => a + p.lotArea, 0) / 43560).toFixed(0)} ac for sale), ${(lots.reduce((a, p) => a + p.lotArea, 0) / 43560).toFixed(0)} ac in all`);
  }
  console.log(`  retail outside downtown: ${Math.round(retail).toLocaleString()} sf, ${(retail / m.county).toFixed(1)} sf per county resident`);
}
