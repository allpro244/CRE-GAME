// A BUILDING OPENING DOES NOT MULTIPLY THE GROUND UNDER ITS NEIGHBOURS.
//
//   pnpm engine && node test/no-delivery-land-bump.mjs
//
// Each delivery multiplied its own lot's land by 1.05 (1.06 for the player's)
// and every neighbour's by 1.03, compounding into the parcel's landAdj up to
// x4: unsourced constants on top of the block's live demand, which already
// reprices dirt for the jobs, residents and shoppers a building brings
// (value.ts resolveBase). The only writer of landAdj left is the comps desk
// (comps.ts), which moves a whole district together: so within a district
// every parcel's landAdj stays the same number, however many buildings open.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { makeCity } = await import(join(HERE, "..", "src", "citygen", "index.mjs"));

let bad = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "OK  " : "FAIL"}  ${msg}`); if (!cond) bad++; };
console.log("\nNO FLAT LAND BUMP ON DELIVERY\n");

const SEED = 99;
const parcels = E.normalizeParcels(makeCity("somewhere", SEED, { size: "city" }).parcels);
const bbls = Object.keys(parcels);
let g = E.firstListings(E.newGame(SEED, parcels, 2_500_000, undefined, { citySize: "city", cityLots: bbls.length }), parcels, bbls);
// month by month: a lot that just got its building moves with its district.
// The comps desk moves every parcel of a district by one factor; the owners'
// capitulation (comps.ts holderCapitulation) moves a vacant lot alone, and a
// lot whose building just opened is not vacant. So a new building's lot
// changes by its district's common factor (the most frequent one that month),
// where the bump multiplied it by 1.05 on its own.
let opened = 0, off = 0, example = "";
for (let m = 0; m < 48; m++) {
  const before = { ...(g.landAdj ?? {}) };
  const jobs = new Set((g.cityJobs ?? []).map((j) => j.bbl));
  g = E.advanceQuarter(g, parcels, bbls);
  const still = new Set((g.cityJobs ?? []).map((j) => j.bbl));
  const fresh = [...jobs].filter((b) => !still.has(b) && parcels[b] && (g.built?.[b]?.bldgArea ?? 0) > 0);
  if (!fresh.length) continue;
  const common = new Map();
  for (const b of bbls) {
    const d = parcels[b]?.district ?? "—";
    const r = +((g.landAdj?.[b] ?? 1) / (before[b] ?? 1)).toFixed(4);
    const c = (common.get(d) ?? new Map()); c.set(r, (c.get(r) ?? 0) + 1); common.set(d, c);
  }
  for (const b of fresh) {
    opened++;
    const d = parcels[b]?.district ?? "—";
    if (!common.has(d)) continue;
    const mode = [...common.get(d).entries()].sort((x, y) => y[1] - x[1])[0][0];
    const r = +((g.landAdj?.[b] ?? 1) / (before[b] ?? 1)).toFixed(4);
    if (Math.abs(r - mode) > 1e-3) { off++; if (!example) example = `${b} in month ${g.month}: x${r} against its district's x${mode}`; }
  }
}
ok(opened > 0, `${opened} buildings opened in four years`);
ok(off === 0, `every new building's ground moved with its district (${off} did not${example ? "; " + example : ""})`);
console.log(bad ? `\nno-delivery-land-bump: ${bad} FAILED\n` : "\nno-delivery-land-bump: ok\n");
process.exit(bad ? 1 : 0);
