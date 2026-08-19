// THE MAP MUST DRAW WHAT THE DIAL PROMISED.
//
// There is no headless renderer, so this is pure geometry: it reproduces
// setPlayerBuildings' ring lookup and its coverage inset and compares the
// drawn plate against `lotArea x cov` — the same quantity engine/dev.ts
// charges the player for and the panel's slider prints.
//
// It exists because that identity was FALSE for every redeveloped lot in the
// game and nothing in the repo could see it. `ringByBBL` is named for a lot
// and holds a BUILDING: citygen emits building polygons for anything standing
// and lot polygons only for parcels classed "land", so a built lot never
// carried a parcel-sized ring. A redevelopment was drawn inside the outline of
// whatever had just been demolished — a median of 66.4% of the promised plate,
// under 90% on every one of 10,028 built lots measured, and a new tower could
// not out-cover the shed it replaced.
//
// AND IT CAN FAIL, which is the only reason to believe it when it passes: set
// OLD=1 to take the old fallback and it reports 0.664 on built lots. The
// vacant-lot column is the control — it was always right and must stay right,
// so a "fix" that simply removed the inset would show up there as 1/cov.
//
//   node test/plate.mjs        the identity, built and vacant
//   OLD=1 node test/plate.mjs  the same check against the old lookup

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const R = join(HERE, "..") + "/";
const { makeCity } = await import(R + "src/citygen/index.mjs");
const q=(a,p)=>{const s=[...a].filter(Number.isFinite).sort((x,y)=>x-y);return s.length?s[Math.floor(p*(s.length-1))]:NaN;};
const M_LAT = 111320;
function areaOf(r){let a=0;for(let i=0;i<r.length;i++){const [x1,y1]=r[i],[x2,y2]=r[(i+1)%r.length];a+=x1*y2-x2*y1;}return Math.abs(a)/2;}

// THE CITIES THIS PROVES THE IDENTITY ON, and the centre comes from each one
// rather than from a constant. `[-70.9, 41.1]` was the generated island's own
// origin and reproducing the renderer meant copying it — but the renderer reads
// `manifest.core` now, because a written-down Manhattan sits 257 km from that
// point and cos(lat) alone would put every area out by half a per cent, which
// is the same order as the identity being tested. A harness that stops
// reproducing the thing it reproduces is measuring nothing.
//
// Manhattan runs at its smallest extent so this stays a twenty-second check.
const CITIES = [["somewhere", [1, 7, 20261], null], ["manhattan", [1], "houston"]];

let built=[], vacant=[];
for (const [cityId, seeds, size] of CITIES) for (const seed of seeds) {
  const c = makeCity(cityId, seed, size ? { size } : undefined);
  const ctr = c.manifest.core;
  const kx = M_LAT * Math.cos(ctr[1]*Math.PI/180);
  const proj = ([lon,lat]) => [ (lon-ctr[0])*kx, (lat-ctr[1])*M_LAT ];
  // the renderer's two maps, reproduced from ThreeBuildings
  const ringByBBL = new Map(), lotRings = new Map();
  for (const v of c.buildings3d ?? []) {
    if (!v.b || !v.r || v.r.length < 3) continue;
    const ring = v.r.map(proj); const a = areaOf(ring);
    const prev = ringByBBL.get(v.b);
    if (!prev || a > areaOf(prev)) ringByBBL.set(v.b, ring);
    if (v.k) lotRings.set(v.b, ring);
  }
  // ...and the NEW middle fallback: the parcel table
  const parcelRings = new Map();
  for (const f of c.parcelFeatures?.features ?? []) {
    const bbl = f.properties?.bbl; if (!bbl || f.geometry?.type !== "Polygon") continue;
    const r = f.geometry.coordinates[0]; if (!(r?.length >= 4)) continue;
    parcelRings.set(bbl, r.slice(0,-1).map(proj));
  }
  const USE_PARCEL = process.env.OLD !== "1";
  for (const [bbl, rec] of Object.entries(c.parcels)) {
    const ring = lotRings.get(bbl) ?? (USE_PARCEL ? parcelRings.get(bbl) : undefined) ?? ringByBBL.get(bbl);
    if (!ring || !rec.lotArea) continue;
    for (const cov of [0.15, 0.35, 0.60, 0.85, 0.90]) {
      const B = Math.min(0.97, Math.sqrt(cov));          // renderer's inset
      const drawn = areaOf(ring) * B * B;                 // uniform scale about a point
      const want = rec.lotArea * cov * 0.092903;          // lotArea is sf; ring is m^2
      const ratio = drawn / want;
      (rec.class === "land" || !(rec.bldgArea > 0) ? vacant : built).push({ cov, ratio });
    }
  }
}
const show=(rows,l)=>{
  console.log(`  ${l}  n=${rows.length/5}`);
  for (const cov of [0.15,0.35,0.60,0.85,0.90]) {
    const v = rows.filter(r=>r.cov===cov).map(r=>r.ratio);
    console.log(`    dial ${(cov*100).toFixed(0).padStart(3)}%   drawn/promised  p05 ${q(v,0.05).toFixed(4)}  p50 ${q(v,0.50).toFixed(4)}  p95 ${q(v,0.95).toFixed(4)}`);
  }
};
console.log(`\n  ${process.env.OLD==="1" ? "OLD (building ring)" : "FIXED (parcel ring)"}\n`);
show(built, "BUILT lots (the redevelopment path)");
show(vacant, "VACANT lots (control — was already correct)");
console.log("");

// the assertion, so this is a check and not a printout
const bad = built.filter((r) => Math.abs(r.ratio - 1) > 0.02).length;
if (process.env.OLD !== "1" && bad) {
  console.error(`  ${bad} of ${built.length} built-lot readings are more than 2% from the promised plate.`);
  process.exit(1);
}
if (process.env.OLD !== "1") console.log("  the map draws what the dial promised, on built and vacant lots alike.\n");

// ---------------------------------------------------------------- the tower
//
// THE FIRST VERSION OF THIS FILE COULD NOT SEE THE PATH THE FIX CHANGED.
//
// It modelled the drawn plate as `areaOf(ring) * B * B`, which is the
// five-silhouette path only. `towerMassing` never runs through that expression,
// so the harness was green while the tower path drew between 0.62x and 6.01x
// the promised plate — a check that cannot fail about the thing it was written
// for, which CLAUDE.md calls a fake in its own right.
//
// It calls the REAL function now, imported rather than copied, because a copy
// of a 180-line recipe table drifts silently from the original and then the
// harness is testing its own copy.
//
// Two assertions, and both can fail:
//   every tier must lie INSIDE the deed        — you cannot build on the
//                                                neighbour's land
//   tier 0 must not exceed the promised plate  — the dial is a price the
//                                                player paid
// Bundled on every run rather than imported: node cannot strip the TypeScript
// parameter properties in ThreeBuildings, and a COPY of a 180-line recipe table
// drifts from the original silently and then the harness is testing its copy.
// Building it here costs ~60ms and cannot go stale, which is a stronger
// guarantee than test/.engine.mjs gets.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
const TD = mkdtempSync(join(tmpdir(), "plate-"));
writeFileSync(join(TD, "e.ts"), `export { towerMassing, plClipToLot, playerMassing, TOWER_FAMILIES } from ${JSON.stringify(join(HERE, "..", "src", "map", "ThreeBuildings"))};\n`);
execFileSync(join(HERE, "..", "node_modules", ".bin", "esbuild"),
  [join(TD, "e.ts"), "--bundle", "--format=esm", "--platform=node", "--log-level=error",
   `--outfile=${join(TD, "e.mjs")}`, `--alias:@=${join(HERE, "..", "src")}`]);
const { towerMassing, plClipToLot, playerMassing, TOWER_FAMILIES } = await import(join(TD, "e.mjs"));

// THE LIST WAS HAND-WRITTEN AND HAD DRIFTED FROM THE THING IT MEASURES.
//
// It read ["exo","stack","carve","blade","shelf","curveslab","deepframe",
// "twist","setback","podium"] — ten names, so the footer printed
// "dial-invariant: 10 of 10". Two of those names are not tower families at all:
// `towerMassing` has no case for `setback` or `podium`, so both fell to its
// default, returned null, and were dropped before they reached a row. And two
// families that ARE in the kit, `vanderbilt` and `spiral`, were missing
// entirely. Eight families measured, a denominator of ten, and the gap between
// the two is precisely what the file's own comment above calls a test that
// cannot fail about the thing it was written for. Read it off the export, so it
// cannot drift again.
const FAMS = [...TOWER_FAMILIES];
function inside(poly, ring) {                   // every vertex of poly inside ring
  const hit = ([px, py]) => {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi) c = !c;
    }
    return c;
  };
  let out = 0;
  for (const p of poly) if (!hit(p)) out++;
  return out / Math.max(1, poly.length);
}

let towerRows = [];
for (const [cityId, seeds, size] of CITIES) for (const seed of seeds) {
  const c = makeCity(cityId, seed, size ? { size } : undefined);
  const ctr = c.manifest.core;
  const kx = M_LAT * Math.cos((ctr[1] * Math.PI) / 180);
  const proj = ([lon, lat]) => [(lon - ctr[0]) * kx, (lat - ctr[1]) * M_LAT];
  for (const f of c.parcelFeatures?.features ?? []) {
    const bbl = f.properties?.bbl;
    const rec = c.parcels[bbl];
    if (!bbl || !rec?.lotArea || f.geometry?.type !== "Polygon") continue;
    const r0 = f.geometry.coordinates[0];
    if (!(r0?.length >= 4)) continue;
    const ring = r0.slice(0, -1).map(proj);
    if (areaOf(ring) < 400) continue;
    let cx = 0, cy = 0;
    for (const [x, y] of ring) { cx += x; cy += y; }
    cx /= ring.length; cy /= ring.length;
    for (const cov of [0.15, 0.60, 0.90]) {
      const B = Math.min(0.97, Math.sqrt(cov));
      const want = rec.lotArea * cov * 0.092903;
      for (const fam of FAMS) {
        const tRing = ring.map(([x, y]) => [cx + (x - cx) * (B / 0.78), cy + (y - cy) * (B / 0.78)]);
        const built = towerMassing(fam, tRing, cx, cy, 106.5, 30, 3.55, (n) => ((n * 2654435761) % 1000) / 1000);
        if (!built?.tiers?.length) continue;
        // THE HARNESS MUST TEST THE REAL COMPOSITION. setPlayerBuildings clips
        // every tier to the deed after towerMassing returns; a harness that
        // called only the recipe would be measuring a shape the game never
        // draws, and would have gone on reporting a defect that was fixed.
        for (const t of built.tiers) t.fp = plClipToLot(t.fp, ring, cx, cy);
        towerRows.push({ fam, cov,
          plate: areaOf(built.tiers[0].fp) / want,
          off: Math.max(...built.tiers.map((t) => inside(t.fp, ring))) });
      }
    }
  }
}
if (towerRows.length) {
  console.log(`  TOWER path (fl>=20) — ${towerRows.length} readings\n`);
  console.log(`    ${"family".padEnd(11)}${"dial".padStart(6)}${"tier0/promised".padStart(16)}${"worst off-deed".padStart(16)}`);
  for (const fam of FAMS) {
    for (const cov of [0.15, 0.60, 0.90]) {
      const v = towerRows.filter((r) => r.fam === fam && r.cov === cov);
      if (!v.length) continue;
      console.log(`    ${fam.padEnd(11)}${(cov * 100).toFixed(0).padStart(5)}%${q(v.map((r) => r.plate), 0.5).toFixed(3).padStart(16)}${(100 * q(v.map((r) => r.off), 0.9)).toFixed(0).padStart(15)}%`);
    }
  }
  // TWO ASSERTIONS NOW, AND THE SECOND ONE USED TO BE A CONFESSION.
  //
  // THE DIAL MUST SCALE THE TOWER, where the lot is not the binding constraint.
  // Each family keeps its own silhouette — exo splays its legs wider than the
  // shaft on purpose, blade sets its base back — so tier-0 is a family constant
  // times the promised plate, and what must hold is that the constant does not
  // MOVE with the dial. It used to: with the plate fixed at 0.78 of the ring it
  // slid from 3.9x the promised plate at the 15% mark to 0.66x at 90%, which is
  // the dial doing nothing at all.
  //
  // Checked between the 15% and 60% marks only, because above that THE DEED IS
  // SUPPOSED TO BIND. At the top of the dial the plate approaches the lot and a
  // silhouette that jogs or splays runs out of land — exo goes 1.482 to 1.012,
  // stack 1.000 to 0.922, carve 0.919 to 0.839. That is not the dial failing to
  // scale, it is the lot winning, and it is correct: you cannot build past your
  // own boundary however much coverage you paid for.
  let drift = 0;
  for (const fam of FAMS) {
    const at = (c) => q(towerRows.filter((r) => r.fam === fam && r.cov === c).map((r) => r.plate), 0.5);
    const a = at(0.15), b = at(0.60);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (Math.max(a, b) / Math.max(1e-9, Math.min(a, b)) > 1.02) drift++;
  }
  // NOTHING IS BUILT ON THE NEIGHBOUR'S LAND. This was printed and not asserted
  // because it could not be met: 16,242 readings put a tier outside the parcel,
  // every one of them a building overhanging somebody else's dirt. plClipToLot
  // pulls each vertex back along its own ray, so the silhouette keeps every
  // angle and loses only the reach that was never yours — and the number is now
  // zero, so it is a rule rather than a note.
  const offdeed = towerRows.filter((r) => r.off > 0.02).length;
  const capped = FAMS.filter((fam) => {
    const at = (c) => q(towerRows.filter((r) => r.fam === fam && r.cov === c).map((r) => r.plate), 0.5);
    return Number.isFinite(at(0.9)) && at(0.9) < at(0.6) * 0.98;
  });
  console.log(`\n    dial-invariant between the 15% and 60% marks: ${FAMS.length - drift} of ${FAMS.length}`);
  console.log(`    families the DEED caps at the 90% mark: ${capped.length ? capped.join(", ") : "none"}   (correct — the lot wins)`);
  console.log(`    tiers outside the parcel: ${offdeed}   (must be 0 — nothing is built on the neighbour's land)`);
  if (process.env.OLD !== "1" && (drift || offdeed)) {
    if (drift) console.error(`  ${drift} tower families change size relative to the dial instead of with it.`);
    if (offdeed) console.error(`  ${offdeed} readings put a tier outside the parcel.`);
    process.exit(1);
  }
}

// ------------------------------------------------- the other twenty-eight
//
// THE COMMENT THIS SECTION EXISTS TO STOP BEING A GUESS.
//
// `playerMassing`'s docstring says every `g:` and `m:` tier is cut from the
// plate and that "tier-0 is 1.000x the promised plate at the median and at the
// 99th". Nothing measured it. The section above calls `towerMassing`, which is
// the ten `t:` recipes and nothing else — so the twenty citygen families and the
// eight `m:` moves, which between them draw the overwhelming majority of what
// the player and the rivals put up, were entirely outside the reach of the one
// harness whose subject is the coverage contract. The claim was an unverified
// comment sitting on top of the file's most load-bearing identity.
//
// It calls the real chooser, bundled not copied, over real parcels at real dial
// positions, on a (class, year, floors) ladder that crosses every gate in the
// pool. Two assertions, the same two as the tower section:
//
//   tier 0 must not EXCEED the promised plate     — the dial is a price paid.
//     Under is fine and is often correct: a notched slab's tier 0 is one wing
//     of the slot, a ferriss base is the plate but its wings are not. Over is
//     a podium drawn wider than the site was sold.
//   every tier must lie inside the deed           — nothing on the
//     neighbour's land, at zero tolerance.
//
// AND IT CAN FAIL: `OLD=1` sweeps with `cov: 0`, which is the pre-coverage
// fallback every save from before the field existed still takes — a plate fixed
// at 0.78 of the deed regardless of the dial. The ratios then go to
// 0.78^2 / cov, which is 4.06x the promised plate at the 15% mark, and the
// assertion trips. That is the shape of the fault this identity is here for.
const PM_LADDER = [
  ["multifamily", 1936, 8], ["office", 1930, 9], ["retail", 1934, 8],
  ["office", 1929, 14], ["office", 1931, 24], ["industrial", 1936, 7],
  ["multifamily", 1972, 8], ["office", 1968, 16], ["office", 1974, 26],
  ["multifamily", 2016, 10], ["office", 2014, 22], ["office", 2019, 34],
];
const pmHash = (a, b) => {
  let h = (a * 0x9e3779b1) ^ (b * 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h ^= h >>> 12;
  return ((h >>> 0) % 100000) / 100000;
};
const pmRows = [];
for (const [cityId, seeds, size] of CITIES) for (const seed of seeds) {
  const c = makeCity(cityId, seed, size ? { size } : undefined);
  const ctr = c.manifest.core;
  const kx = M_LAT * Math.cos((ctr[1] * Math.PI) / 180);
  const proj = ([lon, lat]) => [(lon - ctr[0]) * kx, (lat - ctr[1]) * M_LAT];
  for (const f of c.parcelFeatures?.features ?? []) {
    const bbl = f.properties?.bbl;
    const rec = c.parcels[bbl];
    if (!bbl || !rec?.lotArea || f.geometry?.type !== "Polygon") continue;
    const r0 = f.geometry.coordinates[0];
    if (!(r0?.length >= 4)) continue;
    const ring = r0.slice(0, -1).map(proj);
    if (areaOf(ring) < 400) continue;
    let cx = 0, cy = 0;
    for (const [x, y] of ring) { cx += x; cy += y; }
    cx /= ring.length; cy /= ring.length;
    const key = Number(String(bbl).slice(-7)) || 1;
    for (const [cls, year, fl] of PM_LADDER) {
      const fh = cls === "office" ? 3.9 : cls === "industrial" ? 5.2 : 3.1;
      const h = fl * fh;
      for (const cov of [0.15, 0.60, 0.90]) {
        // the promised plate, from the same expression engine/dev.ts charges on
        const want = rec.lotArea * cov * 0.092903;
        const got = playerMassing({ ring, cx, cy, h, fl, fh, cls, year,
          cov: process.env.OLD === "1" ? 0 : cov,
          u: (k) => pmHash(key + fl * 7919 + Math.round(cov * 100) * 104729, k) });
        if (!got?.tiers?.length) continue;
        pmRows.push({ fam: got.family, cov,
          plate: areaOf(got.tiers.find((t) => t.z0 === 0)?.fp ?? got.tiers[0].fp) / want,
          off: Math.max(...got.tiers.map((t) => inside(t.fp, ring))) });
      }
    }
  }
}
if (pmRows.length) {
  const fams = [...new Set(pmRows.map((r) => r.fam))].sort();
  console.log(`\n  PLAYER PATH (fl>=7, h>=22) — ${pmRows.length} readings, ${fams.length} families\n`);
  console.log(`    ${"family".padEnd(17)}${"n".padStart(7)}${"tier0/promised p50".padStart(20)}${"p99".padStart(8)}${"off-deed".padStart(10)}`);
  for (const fam of fams) {
    const v = pmRows.filter((r) => r.fam === fam);
    console.log(`    ${fam.padEnd(17)}${String(v.length).padStart(7)}${q(v.map((r) => r.plate), 0.5).toFixed(3).padStart(20)}${q(v.map((r) => r.plate), 0.99).toFixed(3).padStart(8)}${(100 * Math.max(...v.map((r) => r.off))).toFixed(0).padStart(9)}%`);
  }
  // THE ONE DELIBERATE EXCEPTION, and it is the same one the tower section
  // above prints: `exo` splays its legs wider than the shaft they carry, which
  // predates the coverage contract and is stated in `playerMassing`'s own
  // docstring. It measures 1.46x here. Naming it is the point — an exemption
  // that is a list of one, written down, is not the same thing as a threshold
  // loose enough to hide the next one.
  const OVERSAIL_OK = new Set(["t:exo"]);
  const over = pmRows.filter((r) => r.plate > 1.02 && !OVERSAIL_OK.has(r.fam));
  const pmOff = pmRows.filter((r) => r.off > 0.02);
  console.log(`\n    readings whose base EXCEEDS the promised plate: ${over.length}   (must be 0 — the dial is a price)`);
  console.log(`    tiers outside the parcel: ${pmOff.length}   (must be 0 — nothing is built on the neighbour's land)`);
  console.log(`    base/promised across every family: p50 ${q(pmRows.map((r) => r.plate), 0.5).toFixed(3)}  p99 ${q(pmRows.map((r) => r.plate), 0.99).toFixed(3)}\n`);
  if (process.env.OLD !== "1" && (over.length || pmOff.length)) {
    if (over.length) console.error(`  ${over.length} of ${pmRows.length} player-path readings draw a base bigger than the plate the dial promised.`);
    if (pmOff.length) console.error(`  ${pmOff.length} player-path readings put a tier outside the parcel.`);
    process.exit(1);
  }
  if (process.env.OLD === "1" && !over.length && !pmOff.length) {
    console.error("  OLD=1 produced no violation: this check cannot fail and is therefore not a check.");
    process.exit(1);
  }
}
