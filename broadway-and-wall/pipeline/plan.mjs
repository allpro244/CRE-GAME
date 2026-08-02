// A flat plan of a generated city, as SVG. Fast enough to iterate against —
// no tiling, no build, no browser, about a second per city.
//
//   node pipeline/plan.mjs kestrel            -> pipeline/plan/kestrel.svg
//   node pipeline/plan.mjs --all
//
// This is a DIAGNOSTIC view, not the game's palette. Three failure modes are
// deliberately loud, because each one is invisible in a pretty render:
//   RED DOTS  bare ground — land under no cell, no park and no boulevard
//   ORANGE    a cell that produced no block (too thin to carry a setback)
//   PINK      the paved backstop showing through, i.e. nothing else claimed it
// A healthy city shows red only as a thin fringe at the waterline, and no
// orange bigger than a few slivers.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CITIES } from "./cities.mjs";
import { generateCity } from "./lib/citygen.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, "plan");
mkdirSync(OUT, { recursive: true });

const args = process.argv.slice(2);
const names = args.includes("--all") ? Object.keys(CITIES) : args.filter((a) => !a.startsWith("--"));

for (const name of names) {
  const cfg = CITIES[name];
  const city = generateCity(cfg);
  const W = 1500;

  // work back from lon/lat to the local metre frame the config was written in
  const coords = [];
  const eat = (c) => { if (typeof c[0] === "number") coords.push(c); else c.forEach(eat); };
  for (const f of city.context.features) if (f.geometry) eat(f.geometry.coordinates);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of coords) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const pad = (x1 - x0) * 0.02;
  x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
  // degrees of longitude are shorter than degrees of latitude at 41 N; without
  // this the whole city renders stretched east-west and a peninsula reads as a
  // blob
  const AR = Math.cos((cfg.center[1] * Math.PI) / 180);
  const k = W / ((x1 - x0) * AR);
  const H = Math.round((y1 - y0) * k);
  const P = ([x, y]) => `${((x - x0) * AR * k).toFixed(1)},${((y1 - y) * k).toFixed(1)}`;
  const path = (ring) => `M${ring.map(P).join("L")}Z`;

  const byKind = (kind) => city.context.features.filter((f) => f.properties.kind === kind);
  const poly = (f) => f.geometry.coordinates[0];

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  out.push(`<rect width="${W}" height="${H}" fill="#b8d3e6"/>`);
  for (const f of byKind("land")) out.push(`<path d="${path(poly(f))}" fill="#e6e3d9"/>`);
  for (const f of byKind("esplanade")) out.push(`<path d="${path(f.geometry.coordinates[0])} ${path(f.geometry.coordinates[1])}" fill="#e9ebe0" fill-rule="evenodd"/>`);
  // diagnostic: the backstop is tinted differently from real street cells, so
  // "no block here" and "no cell here" are two visibly different failures
  for (const f of byKind("paveland")) out.push(`<path d="${path(poly(f))}" fill="#d8b8b0"/>`);
  for (const f of byKind("apron")) out.push(`<path d="${path(poly(f))}" fill="#b9b6ae"/>`);
  for (const f of byKind("pier")) out.push(`<path d="${path(poly(f))}" fill="#e9e7e1"/>`);
  for (const f of byKind("pavement")) out.push(`<path d="${path(poly(f))}" fill="${f.properties.solo ? "#e8a33d" : "#b9b6ae"}"/>`);
  for (const f of byKind("block")) out.push(`<path d="${path(poly(f))}" fill="#e9e6dc"/>`);
  for (const f of byKind("park")) out.push(`<path d="${path(poly(f))}" fill="#cde3c6" stroke="#b3cba6"/>`);

  // lot lines — without them a block reads as one pale slab and the plat that
  // the whole game is played on is invisible
  for (const f of city.parcels.features) {
    out.push(`<path d="${path(f.geometry.coordinates[0])}" fill="none" stroke="#c9c4b5" stroke-width="0.5"/>`);
  }

  // building footprints, shaded by height — the skyline, read from above
  for (const f of city.buildings.features) {
    const h = f.properties.heightroof / 3.28084;
    const t = Math.min(1, h / 90);
    const g = Math.round(200 - 90 * t);
    out.push(`<path d="${path(f.geometry.coordinates[0])}" fill="rgb(${g + 18},${g + 12},${g})" fill-opacity="0.92"/>`);
  }

  // BARE GROUND — the thing this render exists to expose
  const cov = city.stats.coverage;
  // voids come back in the config's metre frame; re-project through the city's
  const { makeProjection } = await import("./lib/geom.mjs");
  const pr = makeProjection(cfg.center[0], cfg.center[1]);
  for (const v of cov.voids) {
    const [lx, ly] = pr.toLL(v);
    out.push(`<circle cx="${((lx - x0) * AR * k).toFixed(1)}" cy="${((y1 - ly) * k).toFixed(1)}" r="3" fill="#e4002b" fill-opacity="0.85"/>`);
  }

  out.push(`<text x="18" y="34" font-family="Georgia,serif" font-size="26" fill="#2b2b2b">${cfg.name}</text>`);
  out.push(`<text x="18" y="58" font-family="Georgia,serif" font-size="15" fill="#555">${city.stats.lots} lots · ${city.stats.blocks} blocks · coverage ${cov.pct.toFixed(2)}%</text>`);
  out.push(`</svg>`);

  const file = join(OUT, `${name}.svg`);
  writeFileSync(file, out.join("\n"));
  console.log(`${cfg.name}: ${file}  (coverage ${cov.pct.toFixed(2)}%, ${cov.voids.length} bare samples)`);
}
