// District rezoning over a century — zoneAdj moves, variance still per-site.
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

const startAdj = { ...(g.zoneAdj ?? {}) };
for (let m = 0; m < 600; m++) {
  if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
  g = E.advanceQuarter(g, parcels, bbls, adjacency);
}

const endAdj = g.zoneAdj ?? {};
const distCount = new Set(bbls.map((b) => parcels[b]?.district).filter(Boolean)).size;
const needTouched = Math.min(3, Math.max(2, distCount - 1));
ok("rezoning touched districts", Object.keys(endAdj).length >= needTouched,
  `${Object.keys(endAdj).length} districts (city has ${distCount}, need ${needTouched})`);
const moved = Object.keys(endAdj).some((d) => (endAdj[d] ?? 1) !== (startAdj[d] ?? 1));
ok("at least one district envelope changed", moved);

const vals = Object.values(endAdj);
ok("envelope stays within zoning floor/ceiling band", vals.every((v) => v >= 0.72 && v <= 2.6),
  `min=${Math.min(...vals).toFixed(2)} max=${Math.max(...vals).toFixed(2)}`);

// Variance path still independent (see test/variance.mjs for filing detail).
const lot = bbls.find((b) => parcels[b]?.lotArea > 2_000 && !g.landmarks?.[b]);
ok("city has a variance-eligible lot", !!lot);
if (lot) {
  const q = E.varianceQuote(g, parcels, lot, 4);
  ok("variance quote on century state", q.grant > 0 && q.odds > 0 && q.odds < 1);
}

console.log(`\n${fails === 0 ? "zoning pass" : `${fails} zoning failure(s)`}`);
process.exit(fails === 0 ? 0 : 1);
