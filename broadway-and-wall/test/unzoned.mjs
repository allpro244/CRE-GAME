// The town has no zoning (Houston rules): any use on any lot, an allowance
// equal to what the lot's footprint can physically carry, no rezoning
// process and no variance desk. Replaces test/zoning.mjs, test/variance.mjs
// and test/permitted-use.mjs, whose subject no longer exists.
//   pnpm engine && pnpm zoning
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);
let g = E.firstListings(E.newGame(4242, parcels), parcels, bbls);

let fails = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) { fails++; console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`); }
  else console.log(`PASS  ${name}${detail ? " — " + detail : ""}`);
};

const USES = ["office", "retail", "multifamily", "industrial"];
let barred = 0, lots = 0, envOff = 0, worstEnv = "";
for (const b of bbls) {
  const r = parcels[b];
  if (!r || !(r.lotArea > 0)) continue;
  lots++;
  for (const u of USES) if (!E.zonePermits(r.zoneDist, u, r.demandScore, g.econ)) barred++;
  const phys = +(E.physicalMaxFloors(r.lotArea * 0.85) * 0.85).toFixed(2);
  if (Math.abs(E.farMaxFor(r) - Math.max(phys, 2)) > 0.01) { envOff++; worstEnv = `${b}: FAR ${E.farMaxFor(r)} vs physical ${phys}`; }
}
ok("every use is permitted on every lot", barred === 0, `${lots} lots, ${barred} barred use-lot pairs`);
ok("every lot's allowance is its physical capacity", envOff === 0, envOff ? worstEnv : `${lots} lots`);

const sample = bbls.map((b) => E.resolveRec(parcels, g, b)).filter((r) => r && r.lotArea > 3000).slice(0, 40);
const capOff = sample.filter((r) => E.cityInfillCap(g, parcels, r, "office") !== E.physicalMaxFloors(r.lotArea * 0.62)).length;
ok("no context-height rule: the height cap is the engineering limit", capOff === 0, `${sample.length} lots checked`);

const mine = sample[0].bbl;
ok("there is no variance to ask for", E.varianceQuote(g, parcels, mine) === null);

const adj0 = JSON.stringify(g.zoneAdj ?? {}), use0 = JSON.stringify(g.zoneUse ?? {});
for (let m = 0; m < 120; m++) {
  g = E.advanceMonth(g, parcels, bbls, adjacency);
  if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
}
ok("ten years pass with no rezoning", JSON.stringify(g.zoneAdj ?? {}) === adj0 && JSON.stringify(g.zoneUse ?? {}) === use0);
const rezNews = (g.news ?? []).filter((n) => /upzoned|downzoned|rezoned|mapped for manufacturing/i.test(n.text)).length;
ok("and no rezoning news", rezNews === 0, `${rezNews} items`);

console.log(fails ? `\n${fails} FAILED` : "\nall clear");
process.exit(fails ? 1 : 0);
