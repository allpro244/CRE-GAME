// WHAT SHAPES THE CITY IS ACTUALLY MADE OF — the distribution, not a screenshot.
//
// `playerMassing` picks one family per building off the deed hash, gated on what
// the site can take. Whether a family is REACHABLE is therefore a question about
// a distribution over sites, and the failure it exists to catch is the one the
// owner reported: "this style of tower happens way too often, I have 4 of them."
// A family nobody can reach and a family that takes a third of the city look
// identical from a diff.
//
// It calls the real function, bundled out of ThreeBuildings.ts on every run
// rather than copied, for the reason test/plate.mjs states: a private copy of a
// recipe table drifts silently and then the harness is testing its copy.
//
// THE SWEEP, stated so a before-and-after is comparable. Three generated
// islands; every parcel whose ring clears 400 m^2; three dial positions; and a
// (class, year, floors) ladder chosen to cross every gate in the list — the
// prewar setback window, the postwar plaza-and-slab window, and the last-twenty-
// years window — because a sweep held at one year measures one branch of the
// pool and reports the rest as unreachable.
//
// AND IT SWEEPS ONLY WHAT THE GAME ROUTES HERE. `setPlayerBuildings` draws one
// coverage-inset prism and never calls this function for `construction ||
// fl < 7 || h < 22`, so a ladder row under seven floors would have been counted
// as a silhouette choice the game never asks for — and since a short building
// can only reach the handful of `m:` moves, including those rows inflated
// `m:prism` and `m:stonebase` and diluted everything else. The ladder is
// therefore all at or above seven floors and twenty-two metres, and the gate is
// asserted below rather than assumed.
//
// The previous massing pass quoted "17 families before, 31 after, top share
// 28.2% over 13,405 site-and-dial readings". That harness was never committed
// and its parameters could not be recovered, so THESE NUMBERS ARE NOT
// COMPARABLE TO THAT ONE in absolute terms. What they are for is a
// before-and-after under one method.
//
//   node tools/probe/silhouette.mjs

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
const HERE = dirname(fileURLToPath(import.meta.url));
const R = join(HERE, "..", "..");
const { makeCity } = await import(join(R, "src/citygen/index.mjs"));

const TD = mkdtempSync(join(tmpdir(), "silhouette-"));
writeFileSync(join(TD, "e.ts"),
  `export { playerMassing } from ${JSON.stringify(join(R, "src", "map", "ThreeBuildings"))};\n`);
execFileSync(join(R, "node_modules", ".bin", "esbuild"),
  [join(TD, "e.ts"), "--bundle", "--format=esm", "--platform=node", "--log-level=error",
   `--outfile=${join(TD, "e.mjs")}`, `--alias:@=${join(R, "src")}`]);
const { playerMassing } = await import(join(TD, "e.mjs"));

const M_LAT = 111320;
const areaOf = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % r.length]; a += x1 * y2 - x2 * y1; } return Math.abs(a) / 2; };
// the deed hash the renderer uses, reproduced from its shape not its bytes: any
// stable per-(building, question) [0,1) exercises the same branches.
const hash01 = (a, b) => { let h = (a * 0x9e3779b1) ^ (b * 0x85ebca6b); h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h ^= h >>> 12; return ((h >>> 0) % 100000) / 100000; };

// (class, year, floors) — one row per gate window in the pool.
const LADDER = [
  ["multifamily", 1936, 8], ["office", 1930, 9], ["retail", 1934, 8],
  ["office", 1929, 14], ["office", 1931, 24], ["industrial", 1936, 7],
  ["multifamily", 1972, 8], ["office", 1968, 16], ["office", 1974, 26],
  ["multifamily", 2016, 10], ["office", 2014, 22], ["office", 2019, 34],
];
const DIALS = [0.15, 0.60, 0.90];
const count = new Map();
let n = 0;
for (const seed of [4242, 1337, 20261]) {
  const c = makeCity("somewhere", seed);
  const ctr = [-70.9, 41.1], kx = M_LAT * Math.cos((ctr[1] * Math.PI) / 180);
  const proj = ([lon, lat]) => [(lon - ctr[0]) * kx, (lat - ctr[1]) * M_LAT];
  for (const f of c.parcelFeatures?.features ?? []) {
    const bbl = f.properties?.bbl;
    if (!bbl || f.geometry?.type !== "Polygon") continue;
    const r0 = f.geometry.coordinates[0];
    if (!(r0?.length >= 4)) continue;
    const ring = r0.slice(0, -1).map(proj);
    if (areaOf(ring) < 400) continue;
    let cx = 0, cy = 0;
    for (const [x, y] of ring) { cx += x; cy += y; }
    cx /= ring.length; cy /= ring.length;
    const key = Number(bbl.slice(-7)) || 1;
    for (const [cls, year, fl] of LADDER) {
      const fh = cls === "office" ? 3.9 : cls === "industrial" ? 5.2 : 3.1;
      const h = fl * fh;
      // the gate in setPlayerBuildings, restated so this cannot drift into
      // measuring a population the renderer never hands over
      if (fl < 7 || h < 22) throw new Error(`ladder row ${cls} ${fl}fl h=${h} is never routed to playerMassing`);
      for (const cov of DIALS) {
        const got = playerMassing({ ring, cx, cy, h, fl, fh, cls, year, cov,
          u: (k) => hash01(key + fl * 7919 + Math.round(cov * 100) * 104729, k) });
        count.set(got.family, (count.get(got.family) ?? 0) + 1);
        n++;
      }
    }
  }
}
const rows = [...count.entries()].sort((a, b) => b[1] - a[1]);
console.log(`\n  SILHOUETTE DISTRIBUTION — ${n} site-and-dial readings, 3 islands\n`);
for (const [fam, k] of rows) console.log(`    ${fam.padEnd(18)}${String(k).padStart(7)}  ${(100 * k / n).toFixed(2)}%`);
console.log(`\n    families reached : ${rows.length}`);
console.log(`    top share        : ${(100 * rows[0][1] / n).toFixed(1)}%  (${rows[0][0]})`);
console.log(`    top-5 share      : ${(100 * rows.slice(0, 5).reduce((a, r) => a + r[1], 0) / n).toFixed(1)}%\n`);
