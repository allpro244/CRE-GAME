// Fetch real source data for one community district from NYC Open Data / Census.
// Usage: node pipeline/fetch.mjs [--district 101]
// Writes raw GeoJSON into pipeline/raw/. Then run process.mjs and tiles.mjs.
//
// All endpoints are public and keyless. If your network blocks these hosts,
// run `node pipeline/synth.mjs` instead to generate the synthetic dev dataset —
// process/tiles consume either one identically.
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const ROOT = dirname(fileURLToPath(import.meta.url));
const RAW = join(ROOT, "raw");
mkdirSync(RAW, { recursive: true });

const argv = process.argv.slice(2);
const district = argv.includes("--district") ? argv[argv.indexOf("--district") + 1] : "101";

const SOURCES = {
  // MapPLUTO — one record per tax lot, with lot polygon. Dataset id on data.cityofnewyork.us.
  mappluto: (cd) =>
    `https://data.cityofnewyork.us/resource/64uk-42ks.geojson?$where=cd='${cd}'&$limit=20000`,
  mapplutoNumericCd: (cd) =>
    `https://data.cityofnewyork.us/resource/64uk-42ks.geojson?$where=cd=${cd}&$limit=20000`,
  // Building Footprints — polygon + roof height, joined by base BBL.
  footprints: (wkt) =>
    `https://data.cityofnewyork.us/resource/qb5r-6dgf.geojson?$where=intersects(the_geom,'${wkt}')&$limit=40000`,
  // MTA subway stations (data.ny.gov).
  stations: () =>
    `https://data.ny.gov/resource/39hk-dx4f.geojson?$limit=1000`,
  // Census LODES workplace area characteristics (jobs per block) + NYC census blocks.
  lodes: () =>
    `https://lehd.ces.census.gov/data/lodes/LODES8/ny/wac/ny_wac_S000_JT00_2022.csv.gz`,
  censusBlocks: (wkt) =>
    `https://data.cityofnewyork.us/resource/wmsu-5muw.geojson?$where=intersects(the_geom,'${wkt}')&$limit=20000`,
};

async function get(url, as = "json") {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return as === "json" ? res.json() : Buffer.from(await res.arrayBuffer());
}

function bboxWKT(fc, padDeg = 0.002) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const eat = (c) => {
    if (typeof c[0] === "number") {
      if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0];
      if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1];
    } else c.forEach(eat);
  };
  for (const f of fc.features) if (f.geometry) eat(f.geometry.coordinates);
  w -= padDeg; s -= padDeg; e += padDeg; n += padDeg;
  return `POLYGON((${w} ${s},${e} ${s},${e} ${n},${w} ${n},${w} ${s}))`;
}

console.log(`Fetching MapPLUTO for community district ${district}…`);
let parcels;
try {
  parcels = await get(SOURCES.mappluto(district));
} catch {
  parcels = await get(SOURCES.mapplutoNumericCd(district)); // cd typed numeric in some vintages
}
if (!parcels.features?.length) throw new Error("MapPLUTO query returned no lots — check the district code.");
console.log(`  ${parcels.features.length} tax lots`);
writeFileSync(join(RAW, "parcels.geojson"), JSON.stringify(parcels));

const wkt = bboxWKT(parcels);

console.log("Fetching building footprints…");
const buildings = await get(SOURCES.footprints(wkt));
console.log(`  ${buildings.features.length} footprints`);
writeFileSync(join(RAW, "buildings.geojson"), JSON.stringify(buildings));

console.log("Fetching MTA stations…");
const stations = await get(SOURCES.stations());
writeFileSync(join(RAW, "stations.geojson"), JSON.stringify(stations));

console.log("Fetching census blocks + LODES employment (optional — used for demandScore)…");
let employment = null;
try {
  const blocks = await get(SOURCES.censusBlocks(wkt));
  const lodesGz = await get(SOURCES.lodes(), "buffer");
  const csv = gunzipSync(lodesGz).toString("utf8");
  const lines = csv.split("\n");
  const header = lines[0].split(",");
  const geoIdx = header.indexOf("w_geocode");
  const jobsIdx = header.indexOf("C000");
  const jobsByBlock = new Map();
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(",");
    if (row.length > jobsIdx) jobsByBlock.set(row[geoIdx], Number(row[jobsIdx]));
  }
  employment = { type: "FeatureCollection", features: [] };
  for (const b of blocks.features) {
    const geoid = b.properties.geoid ?? b.properties.bctcb2020 ?? b.properties.geoid20;
    const jobs = jobsByBlock.get(String(geoid)) ?? 0;
    if (!jobs || !b.geometry) continue;
    // centroid of first ring is plenty for a proximity kernel
    const ring = b.geometry.type === "MultiPolygon" ? b.geometry.coordinates[0][0] : b.geometry.coordinates[0];
    let cx = 0, cy = 0;
    for (const [x, y] of ring) { cx += x; cy += y; }
    employment.features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [cx / ring.length, cy / ring.length] },
      properties: { jobs },
    });
  }
  console.log(`  ${employment.features.length} employment blocks`);
} catch (err) {
  console.warn(`  LODES/blocks unavailable (${err.message}) — process.mjs will fall back to a built-area employment proxy.`);
}
if (employment) writeFileSync(join(RAW, "employment.geojson"), JSON.stringify(employment));

writeFileSync(join(RAW, "manifest.json"), JSON.stringify({
  source: "nyc-open-data",
  district,
  fetched: new Date().toISOString(),
  lodes: !!employment,
}, null, 2));

console.log(`Done. Raw files in ${RAW}. Next: node pipeline/process.mjs && node pipeline/tiles.mjs`);
if (!existsSync(join(RAW, "parcels.geojson"))) process.exit(1);
