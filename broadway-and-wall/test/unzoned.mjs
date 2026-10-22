// No USE zoning (Houston rules): any use on any lot, and the town never
// rezones on its own. But a DENSITY limit (owner, 2026-10-12: "You can add
// FAR limits"): a lot's allowance is its plat's FAR (`farMaxFor`, the larger
// district figure, floored at 2 in town), and more envelope is what the
// variance desk is for (mix.ts normalizeParcels). This file used to assert
// the 2026-10-10 rule it replaced (allowance = physical capacity, no variance
// desk) and had failed since.
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
  const plat = Math.max(r.farMaxComm, r.farMaxRes, 2);
  if (Math.abs(E.farMaxFor(r) - plat) > 0.01) { envOff++; worstEnv = `${b}: FAR ${E.farMaxFor(r)} vs plat ${plat}`; }
}
ok("every use is permitted on every lot", barred === 0, `${lots} lots, ${barred} barred use-lot pairs`);
ok("every lot's allowance is its plat's FAR", envOff === 0, envOff ? worstEnv : `${lots} lots`);

const sample = bbls.map((b) => E.resolveRec(parcels, g, b)).filter((r) => r && r.lotArea > 3000).slice(0, 40);

const mine = sample[0].bbl;
ok("more envelope is a variance to ask for", sample.some((r) => !!E.varianceQuote(g, parcels, r.bbl)));

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
