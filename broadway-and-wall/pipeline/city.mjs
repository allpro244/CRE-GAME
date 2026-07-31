// ASHPORT — the game's city. A compact fictional harbor town (~4,000 lots),
// young and growing: a colonial Old Harbor core, an office grid (the
// Exchange), brownstone Northside, the industrial Millside waiting for
// redevelopment, and waterfront tower pads on the Point.
//
// Deterministic (seeded). Emits the same raw-file schema as fetch.mjs /
// synth.mjs, so process.mjs and tiles.mjs consume it unchanged. This is the
// canonical dataset — not a stand-in for real data.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  mulberry32, makeProjection, polygonArea, centroid,
  splitRing, insetRing, clipRingHalfPlane, bboxOfRing,
} from "./lib/geom.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const RAW = join(ROOT, "raw");
mkdirSync(RAW, { recursive: true });

const SEED = 20250;
const rand = mulberry32(SEED);
const rr = (a, b) => a + (b - a) * rand();
const pick = (arr) => arr[Math.floor(rand() * arr.length) % arr.length];

// Anchor Ashport in open Atlantic water so any online basemap shows clean sea.
const CENTER = [-70.9, 41.1];
const proj = makeProjection(CENTER[0], CENTER[1]);

// Coastline in local meters (x east, y north): a harbor peninsula with a
// south-facing bay. CCW.
const COAST_M = [
  [-1250, 200], [-1290, 500], [-1120, 780],           // west shore
  [-650, 950], [0, 1010], [650, 930],                 // north shore
  [1050, 750], [1260, 400], [1310, 50],               // east shore
  [1210, -300], [900, -480],                          // southeast
  [600, -380], [455, -155], [250, -320],              // the harbor bay
  [-100, -480], [-620, -450], [-1010, -350],          // south shore
];
const landRing = COAST_M;
const COAST = COAST_M.map(proj.toLL);

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Activity cores: the Exchange, Old Harbor, and the Point.
const CORES = [
  { xy: [80, 330], w: 1.0, r: 420 },    // the Exchange
  { xy: [420, -150], w: 0.85, r: 280 }, // Old Harbor
  { xy: [980, -30], w: 0.5, r: 280 },   // the Point
  { xy: [-80, 700], w: 0.3, r: 300 },   // North Plaza
];
function coreHeat(p) {
  let h = 0;
  for (const c of CORES) h += c.w * Math.exp(-(dist(p, c.xy) ** 2) / (2 * c.r * c.r));
  return Math.min(1, h);
}

// --- districts --------------------------------------------------------------
// Old Harbor region: land clipped to a rough pentagon around the bay head.
function clipMany(ring, cuts) {
  let r = ring;
  for (const [nx, ny, d] of cuts) {
    r = r && clipRingHalfPlane(r, nx, ny, d);
  }
  return r;
}
const oldHarborRing = clipMany(landRing, [
  [0, 1, 240],    // y <= 240
  [-1, 0, -60],   // x >= 60
  [1, 0, 800],    // x <= 800
]);
function inRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function districtOf(p) {
  if (oldHarborRing && inRing(p, oldHarborRing)) return "oldharbor";
  if (p[0] < -450) return "millside";
  if (p[0] > 820 || (p[0] > 520 && p[1] < -250)) return "point";
  if (p[1] > 560) return "northside";
  return "exchange";
}

// Parks: Founders Park (grid-aligned), Harbor Square, Mill Common.
const TH12 = (12 * Math.PI) / 180;
const rot = ([x, y]) => [x * Math.cos(TH12) - y * Math.sin(TH12), x * Math.sin(TH12) + y * Math.cos(TH12)];
const rectAround = (cx, cy, w, h) =>
  [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(rot).map(([x, y]) => [x + cx, y + cy]);
const PARKS_M = [
  rectAround(30, 520, 480, 260),   // Founders Park
  rectAround(420, -40, 95, 95),    // Harbor Square
  rectAround(-700, 150, 130, 95),  // Mill Common
  rectAround(-250, 820, 150, 90),  // Rowan Green
];
const PIERS_M = [
  [[240, -330], [200, -470], [235, -478], [275, -338]],
  [[380, -300], [355, -450], [390, -458], [415, -308]],
  [[540, -280], [560, -430], [595, -422], [575, -272]],
  [[-300, -470], [-310, -580], [-270, -585], [-260, -474]],
  [[1030, -330], [1120, -430], [1148, -405], [1058, -305]],
  [[-1150, 340], [-1260, 320], [-1263, 355], [-1153, 375]],
];

// Transit: stations drive the demand map (weights ~ ridership).
const STATIONS_M = [
  { name: "Exchange Ct", lines: "1 2 3", xy: [80, 330], weight: 100 },
  { name: "Harbor Square", lines: "1 H", xy: [420, -60], weight: 80 },
  { name: "Custom House", lines: "H", xy: [610, -140], weight: 45 },
  { name: "Ferry Basin", lines: "H", xy: [180, -300], weight: 50 },
  { name: "Founders Park", lines: "2", xy: [-140, 470], weight: 55 },
  { name: "North Plaza", lines: "2 3", xy: [-40, 720], weight: 55 },
  { name: "Rowan Green", lines: "2", xy: [-320, 830], weight: 35 },
  { name: "Beacon & 9th", lines: "3", xy: [420, 560], weight: 40 },
  { name: "The Point", lines: "3", xy: [960, 120], weight: 45 },
  { name: "Spithead", lines: "3", xy: [1100, -220], weight: 25 },
  { name: "Mill Common", lines: "M", xy: [-690, 90], weight: 35 },
  { name: "Foundry Yards", lines: "M", xy: [-950, -120], weight: 25 },
  { name: "West Gate", lines: "M 2", xy: [-520, 420], weight: 30 },
];

// --- street names -----------------------------------------------------------
const AVENUES = ["Broadway", "Meridian Ave", "Commerce Ave", "Beacon Ave", "Cordage Ave", "Harbor Ave", "Garland Ave"];
const OLD_STREETS = [
  "Wall St", "Wharf St", "Chandler Row", "Tidewater St", "Cooper Ln", "Anchorage Rd",
  "Salt St", "Rigging Ln", "Customs Pl", "Bell Slip", "Mariners Walk", "Gullwing Ct",
];
const MILL_STREETS = ["Foundry Rd", "Kiln St", "Freight Ave", "Cinder Row", "Boiler St", "Gantry Way", "Slipway Rd"];
const NORTH_STREETS = ["Elm St", "Ash St", "Rowan St", "Linden St", "Juniper St", "Tamarack St", "Holly St"];
const POINT_STREETS = ["Point Rd", "Breakwater Blvd", "Spindrift Way", "Lighthouse Ave", "Sound View Dr"];

// --- blocks -----------------------------------------------------------------
const blocks = []; // { ring, district, name, numbered? }

function subdivide(ring, targetArea, jitterDeg, out) {
  const area = polygonArea([ring]);
  if (area <= targetArea() || area < 900) { out.push(ring); return; }
  const [minX, minY, maxX, maxY] = bboxOfRing(ring);
  const wide = maxX - minX >= maxY - minY;
  const angle = (wide ? Math.PI / 2 : 0) + ((rr(-jitterDeg, jitterDeg) * Math.PI) / 180);
  const t = rr(0.42, 0.58);
  const p = wide
    ? [minX + (maxX - minX) * t, (minY + maxY) / 2]
    : [(minX + maxX) / 2, minY + (maxY - minY) * t];
  const [a, b] = splitRing(ring, p, Math.cos(angle), Math.sin(angle));
  if (!a || !b) { out.push(ring); return; }
  subdivide(a, targetArea, jitterDeg, out);
  subdivide(b, targetArea, jitterDeg, out);
}

// Old Harbor: irregular colonial fabric
if (oldHarborRing) {
  const irregular = [];
  subdivide(oldHarborRing, () => rr(3200, 7500), 14, irregular);
  for (const r of irregular) blocks.push({ ring: r, district: "oldharbor" });
}

// grid layers per district, each at its own bearing
function gridLayer({ bearingDeg, stPitch, avePitch, blockW, blockU, district, numbered }) {
  const th = (bearingDeg * Math.PI) / 180;
  const A = [Math.sin(th), Math.cos(th)], S = [Math.cos(th), -Math.sin(th)];
  const at = (u, w) => [u * S[0] + w * A[0], u * S[1] + w * A[1]];
  let zwMin = Infinity, zwMax = -Infinity, zuMin = Infinity, zuMax = -Infinity;
  for (const p of landRing) {
    const zw = p[0] * A[0] + p[1] * A[1], zu = p[0] * S[0] + p[1] * S[1];
    if (zw < zwMin) zwMin = zw; if (zw > zwMax) zwMax = zw;
    if (zu < zuMin) zuMin = zu; if (zu > zuMax) zuMax = zu;
  }
  for (let w = zwMin; w < zwMax; w += stPitch) {
    for (let u = zuMin; u < zuMax; u += avePitch) {
      const ring = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([cu, cw]) => at(u + cu * blockU, w + cw * blockW));
      const center = at(u + blockU / 2, w + blockW / 2);
      if (districtOf(center) !== district) continue;
      if (!ring.every((c) => inRing(c, landRing))) continue;
      if (PARKS_M.some((p) => inRing(center, p))) continue;
      blocks.push({
        ring, district,
        numbered: numbered ? Math.max(1, Math.round((w - zwMin) / stPitch)) : undefined,
        u: u + blockU / 2,
        uFifth: (zuMin + zuMax) / 2,
      });
    }
  }
}

gridLayer({ bearingDeg: 12, stPitch: 74, avePitch: 215, blockW: 57, blockU: 182, district: "exchange", numbered: true });
gridLayer({ bearingDeg: 12, stPitch: 62, avePitch: 155, blockW: 48, blockU: 132, district: "northside", numbered: true });
gridLayer({ bearingDeg: 20, stPitch: 78, avePitch: 210, blockW: 60, blockU: 178, district: "point", numbered: false });
gridLayer({ bearingDeg: -8, stPitch: 98, avePitch: 265, blockW: 80, blockU: 232, district: "millside", numbered: false });

// --- attributes -------------------------------------------------------------
// Fictional-but-plausible zoning, keyed by district and heat.
function zoningFor(district, heat) {
  if (district === "oldharbor") return heat > 0.6
    ? { z: "C-5", commfar: 8, resfar: 6 }
    : { z: "C-4", commfar: 5, resfar: 5 };
  if (district === "exchange") return heat > 0.55
    ? { z: "C-6", commfar: 12, resfar: 8 }
    : { z: "C-4", commfar: 7, resfar: 6 };
  if (district === "point") return { z: "C-5W", commfar: 10, resfar: 10 };
  if (district === "northside") return { z: "R-4", commfar: 2, resfar: 4.5 };
  return { z: "M-1", commfar: 3, resfar: 0 }; // millside — upzoning is a later-phase story
}

// Class mix per district. A young city: Millside and the Point carry real
// vacancy — that land is the development game.
function classFor(district, heat) {
  const r = rand();
  switch (district) {
    case "millside":
      if (r < 0.20) return "V1";
      if (r < 0.32) return "G1";
      if (r < 0.68) return "E9";   // lofts and sheds
      if (r < 0.76) return "K2";
      if (r < 0.90) return "D0";
      return "S1";
    case "point":
      if (r < 0.28) return "V1";   // waterfront pads
      if (r < 0.33) return "G1";
      if (r < 0.58) return "O4";
      if (r < 0.78) return "D0";
      return "RM";
    case "oldharbor":
      if (r < 0.05) return "V1";
      if (r < 0.38) return "O3";
      if (r < 0.56) return "K2";
      if (r < 0.80) return "S1";
      return "D0";
    case "northside":
      if (r < 0.06) return "V1";
      if (r < 0.66) return "D0";
      if (r < 0.80) return "S1";
      if (r < 0.90) return "K2";
      return "RM";
    default: // exchange
      if (r < 0.09) return "V1";   // tower pads downtown
      if (r < 0.12) return "G1";
      if (r < 0.60) return heat > 0.5 ? "O4" : "O3";
      if (r < 0.74) return "RM";
      if (r < 0.84) return "K2";
      return "D0";
  }
}

function yearFor(district) {
  const r = rand();
  switch (district) {
    case "oldharbor": return Math.round(r < 0.7 ? rr(1885, 1945) : rr(1950, 1990));
    case "northside": return Math.round(r < 0.6 ? rr(1900, 1950) : rr(1955, 1995));
    case "millside": return Math.round(rr(1915, 1978));
    case "point": return Math.round(rr(1972, 2024));
    default: return Math.round(r < 0.3 ? rr(1925, 1960) : rr(1960, 2018));
  }
}

const parcels = { type: "FeatureCollection", features: [] };
const buildings = { type: "FeatureCollection", features: [] };
let blockNo = 1, binNo = 1000001;

for (const block of blocks) {
  const gridded = block.u !== undefined;
  const street = insetRing(block.ring, gridded ? 6 : 7);
  if (!street || polygonArea([street]) < 600) continue;
  const bc = centroid(street);
  if (PARKS_M.some((p) => inRing(bc, p))) continue;
  const d = block.district;
  const heat = coreHeat(bc);
  let houseNo = Math.round(rr(1, 60));
  const namedStreet =
    d === "oldharbor" ? pick(OLD_STREETS)
    : d === "millside" ? pick(MILL_STREETS)
    : d === "point" ? pick(POINT_STREETS)
    : pick(NORTH_STREETS);

  const lots = [];
  const fullBlockP = d === "exchange" ? 0.10 : d === "point" ? 0.14 : d === "millside" ? 0.20 : 0.03;
  if (rand() < fullBlockP) lots.push(street);
  else if (d === "millside") subdivide(street, () => rr(900, 3400), 6, lots);
  else if (gridded) subdivide(street, () => rr(230, 780), 6, lots);
  else subdivide(street, () => rr(280, 1100), 10, lots);

  let lotNo = 1;
  for (const lotRing of lots) {
    const areaM2 = polygonArea([lotRing]);
    if (areaM2 < 80) continue;
    const lotArea = Math.round(areaM2 * 10.7639);
    const c = centroid(lotRing);
    if (PARKS_M.some((p) => inRing(c, p))) continue;
    const h = coreHeat(c);
    const zone = zoningFor(d, h);
    const cls = classFor(d, h);
    const vacant = cls === "V1";
    const bbl = 1000000000 + blockNo * 10000 + lotNo;

    const yearbuilt = vacant ? 0 : yearFor(d);
    let floors = 0, bldgArea = 0, footprint = null, heightM = 0;
    if (!vacant) {
      // a young skyline: towers are rarer and shorter than Manhattan's
      const towerP = d === "millside" ? 0 : Math.min(0.6, h * h * 0.85 + (areaM2 > 1500 ? 0.12 : 0));
      let coverage;
      if (areaM2 > 240 && rand() < towerP) {
        floors = Math.round(rr(13, 40));
        coverage = rr(0.5, 0.72);
      } else if (d !== "millside" && rand() < 0.35 + h * 0.4) {
        floors = Math.round(rr(5, 13));
        coverage = rr(0.72, 0.9);
      } else {
        floors = Math.round(d === "millside" ? rr(1, 4) : rr(2, 6));
        coverage = rr(0.75, 0.95);
      }
      if (cls === "G1") floors = Math.min(floors, 4);
      if (cls === "K2") floors = Math.min(floors, 3);
      if (cls === "E9") floors = Math.min(floors, 4);
      if (yearbuilt >= 1961) {
        floors = Math.min(floors, Math.max(1, Math.round(Math.max(zone.commfar, zone.resfar) / coverage)));
      }
      const side = Math.sqrt(areaM2);
      footprint = insetRing(lotRing, (side * (1 - Math.sqrt(coverage))) / 2);
      const realCov = footprint ? polygonArea([footprint]) / areaM2 : coverage;
      bldgArea = Math.round(lotArea * realCov * floors);
      heightM = floors * 3.55 + rr(1, 4);
    }

    // secondary-market pricing: land runs $60–440/sf by heat
    const landPsfBase = 60 + 380 * h;
    const assessland = Math.round(lotArea * landPsfBase * rr(0.85, 1.15) * 0.45);
    const bldgPsf = cls[0] === "O" ? rr(140, 280) : cls[0] === "D" ? rr(120, 230) : rr(70, 180);
    const assesstot = assessland + Math.round(bldgArea * bldgPsf * 0.45);
    const unitsres = cls[0] === "D" || cls === "S1" || cls === "RM"
      ? Math.max(1, Math.round((bldgArea * (cls === "D0" ? 0.9 : 0.45)) / 900)) : 0;

    let address;
    if (block.numbered !== undefined && rand() < 0.25) {
      address = `${houseNo * 10 + Math.round(rr(0, 9))} ${AVENUES[Math.abs(Math.round((block.u - block.uFifth) / 215)) % AVENUES.length]}`;
    } else if (block.numbered !== undefined) {
      const n = block.numbered;
      const suf = n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th";
      address = `${houseNo} ${block.district === "northside" ? "N" : "S"} ${n}${suf} St`;
    } else {
      address = `${houseNo} ${namedStreet}`;
    }

    parcels.features.push({
      type: "Feature",
      id: bbl,
      geometry: { type: "Polygon", coordinates: [[...lotRing.map(proj.toLL), proj.toLL(lotRing[0])]] },
      properties: {
        bbl: String(bbl),
        borough: "AP", block: String(blockNo), lot: String(lotNo),
        address,
        zonedist1: zone.z, commfar: zone.commfar, resfar: zone.resfar,
        bldgclass: cls, landuse: vacant ? "11" : cls === "G1" ? "10" : cls[0] === "O" ? "05" : "04",
        lotarea: lotArea, bldgarea: bldgArea, numfloors: floors,
        yearbuilt, assessland, assesstot, unitsres,
        cd: "ashport", district: d,
      },
    });

    if (!vacant && footprint) {
      buildings.features.push({
        type: "Feature",
        id: binNo,
        geometry: { type: "Polygon", coordinates: [[...footprint.map(proj.toLL), proj.toLL(footprint[0])]] },
        properties: {
          bin: String(binNo++),
          base_bbl: String(bbl),
          heightroof: +(heightM * 3.28084).toFixed(1),
          cnstrct_yr: yearbuilt,
          groundelev: Math.round(rr(3, 20)),
        },
      });
    }
    houseNo += Math.round(rr(2, 8));
    lotNo++;
  }
  blockNo++;
}

// --- stations / employment / context ---------------------------------------
const stations = {
  type: "FeatureCollection",
  features: STATIONS_M.map((s, i) => ({
    type: "Feature", id: i + 1,
    geometry: { type: "Point", coordinates: proj.toLL(s.xy) },
    properties: { stop_name: s.name, daytime_routes: s.lines, weight: s.weight },
  })),
};

const jobsByBlock = new Map();
for (const f of parcels.features) {
  const p = f.properties;
  const jobs = p.bldgclass[0] === "O" ? p.bldgarea / 230
    : p.bldgclass === "E9" ? p.bldgarea / 550
    : p.bldgclass === "K2" ? p.bldgarea / 400
    : p.bldgclass === "RM" || p.bldgclass === "S1" ? p.bldgarea / 700 : 0;
  if (!jobs) continue;
  const cur = jobsByBlock.get(p.block) ?? { jobs: 0, x: 0, y: 0, n: 0 };
  const ring = f.geometry.coordinates[0];
  cur.jobs += jobs;
  cur.x += ring.reduce((s, q) => s + q[0], 0) / ring.length;
  cur.y += ring.reduce((s, q) => s + q[1], 0) / ring.length;
  cur.n++;
  jobsByBlock.set(p.block, cur);
}
const employment = {
  type: "FeatureCollection",
  features: [...jobsByBlock.values()].map((b, i) => ({
    type: "Feature", id: i + 1,
    geometry: { type: "Point", coordinates: [b.x / b.n, b.y / b.n] },
    properties: { jobs: Math.round(b.jobs) },
  })),
};

const context = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", geometry: { type: "Polygon", coordinates: [[...COAST, COAST[0]]] }, properties: { kind: "land" } },
    ...PIERS_M.map((ring) => ({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[...ring.map(proj.toLL), proj.toLL(ring[0])]] },
      properties: { kind: "pier" },
    })),
    ...PARKS_M.map((ring) => ({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[...ring.map(proj.toLL), proj.toLL(ring[0])]] },
      properties: { kind: "park" },
    })),
    ...STATIONS_M.map((s) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: proj.toLL(s.xy) },
      properties: { kind: "station", name: s.name },
    })),
  ],
};

writeFileSync(join(RAW, "parcels.geojson"), JSON.stringify(parcels));
writeFileSync(join(RAW, "buildings.geojson"), JSON.stringify(buildings));
writeFileSync(join(RAW, "stations.geojson"), JSON.stringify(stations));
writeFileSync(join(RAW, "employment.geojson"), JSON.stringify(employment));
writeFileSync(join(RAW, "context.geojson"), JSON.stringify(context));
writeFileSync(join(RAW, "manifest.json"), JSON.stringify({
  source: "fictional", city: "Ashport", district: "ashport", seed: SEED, lodes: true,
}, null, 2));

const byD = {};
for (const f of parcels.features) byD[f.properties.district] = (byD[f.properties.district] ?? 0) + 1;
const vac = parcels.features.filter((f) => !f.properties.bldgarea).length;
console.log(`Ashport: ${parcels.features.length} lots on ${blockNo - 1} blocks (${Math.round(100 * vac / parcels.features.length)}% unbuilt), ${buildings.features.length} buildings.`);
console.log("  districts:", Object.entries(byD).map(([k, v]) => `${k} ${v}`).join(", "));
