// Cut pipeline/out/*.geojson into PMTiles archives under public/data/.
// Pure Node (geojson-vt + vt-pbf + our PMTiles v3 writer) — no tippecanoe needed.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import geojsonvt from "geojson-vt";
import vtpbf from "vt-pbf";
import { buildPMTiles } from "./lib/pmtiles-writer.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, "out");
const PUB = join(ROOT, "..", "public", "data");

const MINZ = 10, MAXZ = 15; // MapLibre overzooms past MAXZ; keeps archives lean

function bboxOfFC(fc) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const eat = (c) => {
    if (typeof c[0] === "number") {
      if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0];
      if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1];
    } else c.forEach(eat);
  };
  for (const f of fc.features) if (f.geometry) eat(f.geometry.coordinates);
  return [w, s, e, n];
}

function lonToX(lon, z) { return Math.floor(((lon + 180) / 360) * Math.pow(2, z)); }
function latToY(lat, z) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z));
}

function makeArchive(file, layerName, fields) {
  const fc = JSON.parse(readFileSync(join(OUT, file), "utf8"));
  const bounds = bboxOfFC(fc);
  const index = geojsonvt(fc, {
    maxZoom: MAXZ,
    indexMaxZoom: 10,       // deeper tiles generate lazily — island-scale safe
    indexMaxPoints: 100000,
    tolerance: 1.5,
    buffer: 96,
    extent: 4096,
  });
  const tiles = new Map();
  for (let z = MINZ; z <= MAXZ; z++) {
    const x0 = lonToX(bounds[0], z), x1 = lonToX(bounds[2], z);
    const y0 = latToY(bounds[3], z), y1 = latToY(bounds[1], z);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const t = index.getTile(z, x, y);
        if (!t || !t.features.length) continue;
        tiles.set(`${z}/${x}/${y}`, Buffer.from(vtpbf.fromGeojsonVt({ [layerName]: t }, { version: 2 })));
      }
    }
  }
  const center = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2, 15];
  const buf = buildPMTiles(tiles, {
    name: layerName,
    minZoom: MINZ, maxZoom: MAXZ, bounds, center,
    layers: [{ id: layerName, fields, minzoom: MINZ, maxzoom: MAXZ }],
  });
  const out = join(PUB, `${layerName}.pmtiles`);
  writeFileSync(out, buf);
  console.log(`${layerName}.pmtiles: ${tiles.size} tiles, ${(buf.length / 1024).toFixed(0)} KB`);
}

if (!existsSync(join(OUT, "parcels.geojson"))) {
  console.error("No processed geojson found — run `node pipeline/process.mjs` first.");
  process.exit(1);
}
makeArchive("parcels.geojson", "parcels", {
  bbl: "String", address: "String", class: "String", demand: "Number", landpsf: "Number", zone: "String",
});
makeArchive("buildings.geojson", "buildings", {
  bbl: "String", heightM: "Number", class: "String",
});
