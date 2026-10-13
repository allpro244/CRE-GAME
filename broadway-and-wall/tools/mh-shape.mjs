// IS THIS ISLAND THE SHAPE OF MANHATTAN? — pnpm mh:shape
//
// The first written-down Manhattan reused a 41-vertex ring that had been sitting
// in the pipeline since the synthetic-data days, whose own header called it
// "real-ish (from memory)". Its area was within 4% and its length within 2%, so
// it passed every look anybody gave it — and it was the wrong SHAPE: measured
// across the grid it ran +44% at Canal, +31% at Houston, +29% at 59th and +54%
// at 110th while coming out NARROW at 14th Street, which is the island's real
// widest point. A fat sausage instead of something that swells at 14th and
// tapers north. The owner saw it in one screenshot and no check in the repo
// could have.
//
// So this is that check. Width is measured PERPENDICULAR TO THE GRID, because a
// line of latitude cuts a 29-degree island diagonally and reads too wide
// everywhere — that was the first mistake made while chasing this.
//
// ONE CAVEAT THAT IS NOT A BUG: above about 155th Street the island stops
// following the Commissioners' bearing and runs closer to due north, so a
// 29-degree cross-axis measurement UNDER-reads Washington Heights and Inwood.
// The rows above 125th are reported for completeness and are not the yardstick.
// No shipped extent reaches them.
//
// THE COAST IS NOW SURVEYED (src/citygen/data/manhattan-plat.json, baked from
// the borough boundary by pipeline/manhattan/bake.py), and it stops at 59th
// Street, the largest extent offered. This still measures it, against the same
// anchors, so a bad re-bake shows up here; rows above 59th read n/a, and the
// area and length lines describe the extent, not the island. Piers count as
// land, so a row through Chelsea Piers reads a little wide. Measured against the
// city's own shoreline, the Canal and Houston anchors below read about 25%
// narrow: a 29-degree cross-axis line there runs out to Corlears Hook, which
// the from-memory anchors did not allow for. The surveyed coast is the
// authority; the anchors are the check for a broken bake, not the reverse.
import { readFileSync } from "node:fs";
import { proj } from "../src/citygen/manhattan.mjs";
import { ringArea } from "../src/citygen/geom.mjs";
const PLAT = JSON.parse(readFileSync(new URL("../src/citygen/data/manhattan-plat.json", import.meta.url), "utf8"));
const flat = PLAT.coast["59th"];
const R = [];
for (let i = 0; i < flat.length; i += 2) R.push([flat[i] / 10, flat[i + 1] / 10]);
const TH = 29 * Math.PI / 180;
const UP = [Math.sin(TH), Math.cos(TH)];         // along the avenues (uptown)
const AC = [Math.cos(TH), -Math.sin(TH)];        // across, along the cross streets
const up = (p) => p[0] * UP[0] + p[1] * UP[1];
const ac = (p) => p[0] * AC[0] + p[1] * AC[1];
function widthAtUp(u) {
  const xs = [];
  for (let i = 0; i < R.length; i++) {
    const a = R[i], b = R[(i + 1) % R.length];
    const ua = up(a) - u, ub = up(b) - u;
    if (ua * ub < 0) { const t = ua / (ua - ub); xs.push(ac(a) + t * (ac(b) - ac(a))); }
  }
  return xs.length < 2 ? null : (Math.max(...xs) - Math.min(...xs)) / 1000;
}
const anchors = [
  // River-to-river distances along the cross streets. The three I am most
  // confident of are the island's published dimensions — 21.6 km long, 3.7 km at
  // its widest around 14th Street, 59 km2 — and those govern. The rest are read
  // off the street grid, and two of them were wrong in the first pass: 42nd and
  // 125th are among the LONGEST crosstown streets, not short ones.
  [[-74.0050, 40.7145], "Chambers St", 1.9],
  [[-74.0020, 40.7190], "Canal St", 2.4],
  [[-73.9920, 40.7255], "Houston St", 2.9],
  [[-73.9975, 40.7370], "14th St (widest)", 3.7],
  [[-73.9857, 40.7484], "34th St", 3.4],
  [[-73.9855, 40.7550], "42nd St", 3.3],
  [[-73.9800, 40.7660], "59th St", 3.2],
  [[-73.9660, 40.7830], "86th St", 3.0],
  [[-73.9560, 40.7990], "110th St", 3.2],
  [[-73.9457, 40.8077], "125th St", 3.5],
  [[-73.9390, 40.8300], "145th St", 2.7],
  [[-73.9330, 40.8500], "181st St", 1.9],
  [[-73.9250, 40.8700], "Dyckman St", 1.3],
];
console.log("where                   mine km   real km   error");
for (const [ll, name, real] of anchors) {
  const w = widthAtUp(up(proj.toXY(ll)));
  console.log(`${name.padEnd(22)} ${w == null ? "   n/a" : w.toFixed(2).padStart(6)}   ${real.toFixed(2).padStart(6)}   ${w == null ? "" : (((w - real) / real) * 100).toFixed(0) + "%"}`);
}
const ups = R.map(up);
console.log(`\narea    ${(Math.abs(ringArea(R)) / 1e6).toFixed(1)} km2   (real 59)`);
console.log(`length  ${((Math.max(...ups) - Math.min(...ups)) / 1000).toFixed(1)} km   (real 21.6)`);
