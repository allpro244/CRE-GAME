/**
 * A delivery popup is for a massive building — top 1% of the standing city
 * by floor area, measured against the rest of the properties.
 *
 *   pnpm engine && pnpm --dir broadway-and-wall delivery-notice
 */
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));

let fails = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) { fails++; console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`); }
  else console.log(`ok   ${name}${detail ? " — " + detail : ""}`);
};

function lot(bbl, sf, cls = "office") {
  return {
    bbl, address: bbl, borough: "", block: "1", lot: bbl, zoneDist: "",
    farMaxComm: 10, farMaxRes: 10, bldgClass: "O", district: "Core",
    class: cls, lotArea: Math.max(sf, 1), bldgArea: sf, floors: 4,
    yearBuilt: 1990, unitsRes: 0, assessedLand: 0, assessedTotal: 0,
    demandScore: 50, landPsf: 100, landPsfHistory: [], imputed: [],
    centroid: [0, 0],
  };
}

function city(sizes) {
  const parcels = {};
  for (let i = 0; i < sizes.length; i++) {
    const id = String(i + 1).padStart(3, "0");
    parcels[id] = lot(id, sizes[i], sizes[i] <= 0 ? "land" : "office");
  }
  const game = { built: {}, holdings: {}, landAdj: {}, blockD: {}, zoneAdj: {}, variance: {}, landmarks: {}, merged: null };
  return { game, parcels };
}

// 200 standing buildings, 10k typical, a handful of 80–100k trophies.
const typical = Array.from({ length: 194 }, () => 10_000);
const trophies = [100_000, 90_000, 85_000, 80_000, 75_000, 70_000];
const { game, parcels } = city([...typical, ...trophies]);
// New delivery is 001 in built; we score a fresh bbl we add.
parcels.new = lot("new", 12_000);
ok("ordinary 12k office is not a popup", !E.deliveryWorthCeremony(game, parcels, "new"));

parcels.huge = lot("huge", 120_000);
ok("120k tower is top 1% of a 200-building city", E.deliveryWorthCeremony(game, parcels, "huge"));

parcels.mid = lot("mid", 72_000);
// Top 1% of ~200 is two or three trophies (100k / 90k / 85k). 72k is not that.
ok("72k is large but not top 1%", !E.deliveryWorthCeremony(game, parcels, "mid"));

parcels.tie = lot("tie", 100_000);
ok("a peer of the largest still qualifies", E.deliveryWorthCeremony(game, parcels, "tie"));

const empty = city([]);
empty.parcels.first = lot("first", 8_000);
ok("the first building in an empty town is the skyline", E.deliveryWorthCeremony(empty.game, empty.parcels, "first"));

parcels.dirt = lot("dirt", 0, "land");
ok("vacant dirt never pops", !E.deliveryWorthCeremony(game, parcels, "dirt"));

// Old bug: ranking only against s.built made a 20k shed "top 2%" of three jobs.
game.built = {
  a: { class: "office", bldgArea: 15_000, floors: 4, yearBuilt: 2026 },
  b: { class: "office", bldgArea: 18_000, floors: 5, yearBuilt: 2026 },
};
parcels.shed = lot("shed", 20_000);
ok("20k is not massive just because few jobs have delivered yet", !E.deliveryWorthCeremony(game, parcels, "shed"));

if (fails) {
  console.error(`\ndelivery-notice: ${fails} failed`);
  process.exit(1);
}
console.log("\ndelivery-notice: pass");
