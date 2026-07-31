// Deterministic SYNTHETIC dev dataset — the full island of Manhattan.
// Emits the same raw-file schema as fetch.mjs (MapPLUTO / Footprints field
// names) so process.mjs and tiles.mjs consume either source unchanged.
//
// This exists because build environments don't always reach NYC Open Data.
// It is NOT real PLUTO data: the coastline, parks, and grid bearing are
// real-ish (from memory), everything inside is procedurally generated with a
// fixed seed. North of Houston St the real 29°-rotated street grid applies;
// downtown is irregular subdivision. The manifest marks `source: "synthetic"`.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  mulberry32, makeProjection, polygonArea, centroid, bboxOfRing,
  splitRing, insetRing, clipRingHalfPlane,
} from "./lib/geom.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const RAW = join(ROOT, "raw");
mkdirSync(RAW, { recursive: true });

const SEED = 10007;
const rand = mulberry32(SEED);
const rr = (a, b) => a + (b - a) * rand();
const pick = (arr) => arr[Math.floor(rand() * arr.length) % arr.length];

// Approximate Manhattan shoreline (lon, lat), counterclockwise from the
// Battery up the Hudson, around Inwood, down the Harlem and East Rivers.
const COAST = [
  [-74.0158, 40.7003], // Battery
  [-74.0176, 40.7035],
  [-74.0186, 40.7065], // BPC
  [-74.0158, 40.7118],
  [-74.0135, 40.7250], // Canal
  [-74.0110, 40.7350],
  [-74.0095, 40.7420], // 14th
  [-74.0070, 40.7490],
  [-74.0040, 40.7560], // 30th
  [-74.0005, 40.7640], // 42nd
  [-73.9962, 40.7725], // 57th
  [-73.9930, 40.7780], // 66th
  [-73.9880, 40.7880], // 79th
  [-73.9800, 40.7990], // 96th
  [-73.9720, 40.8100], // 116th
  [-73.9620, 40.8270], // 135th
  [-73.9525, 40.8395], // 158th
  [-73.9470, 40.8500],
  [-73.9385, 40.8610], // 181st
  [-73.9330, 40.8720],
  [-73.9210, 40.8780], // Inwood tip
  [-73.9105, 40.8720], // Spuyten Duyvil
  [-73.9190, 40.8580], // Harlem River south
  [-73.9260, 40.8450],
  [-73.9330, 40.8330], // 145th
  [-73.9340, 40.8180],
  [-73.9320, 40.8060], // 125th
  [-73.9290, 40.7960], // 106th
  [-73.9380, 40.7800], // 90th
  [-73.9440, 40.7690], // 71st
  [-73.9610, 40.7550], // 53rd
  [-73.9670, 40.7430], // UN
  [-73.9720, 40.7330],
  [-73.9740, 40.7250], // 14th
  [-73.9715, 40.7160], // Alphabet City
  [-73.9760, 40.7090], // Corlears Hook
  [-73.9905, 40.7075], // bridges
  [-73.9985, 40.7060],
  [-74.0028, 40.7022], // Old Slip
  [-74.0100, 40.7002], // South Ferry
  [-74.0130, 40.7000],
];

const CENTER = [-73.9712, 40.7831];
const proj = makeProjection(CENTER[0], CENTER[1]);
const landRing = COAST.map(proj.toXY);

// Manhattan grid: avenues bear ~29° east of true north.
const TH = (29 * Math.PI) / 180;
const AVE = [Math.sin(TH), Math.cos(TH)];   // along avenues (south → north)
const ST = [Math.cos(TH), -Math.sin(TH)];   // along streets (west → east)
const dotA = (p) => p[0] * AVE[0] + p[1] * AVE[1];
const dotS = (p) => p[0] * ST[0] + p[1] * ST[1];
const W_HOUSTON = dotA(proj.toXY([-73.9920, 40.7255]));
const W_CHAMBERS = dotA(proj.toXY([-74.0050, 40.7145]));
const U_FIFTH = dotS(proj.toXY([-73.9819, 40.7542])); // 5th Ave @ 42nd

// Activity cores that shape height, class, and value distributions.
const CORES = [
  { ll: [-74.0106, 40.7064], w: 1.0, r: 500 },  // Wall & Broad
  { ll: [-74.0122, 40.7118], w: 0.8, r: 400 },  // WTC
  { ll: [-73.9772, 40.7527], w: 1.0, r: 900 },  // Grand Central
  { ll: [-73.9855, 40.7580], w: 0.95, r: 800 }, // Times Sq
  { ll: [-73.9879, 40.7497], w: 0.7, r: 500 },  // Herald Sq
  { ll: [-74.0005, 40.7545], w: 0.65, r: 450 }, // Hudson Yards
  { ll: [-73.9819, 40.7681], w: 0.6, r: 400 },  // Columbus Circle
  { ll: [-73.9904, 40.7359], w: 0.45, r: 400 }, // Union Sq
  { ll: [-73.9470, 40.8090], w: 0.35, r: 400 }, // 125th St
].map((c) => ({ ...c, xy: proj.toXY(c.ll) }));

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function coreHeat(p) {
  let h = 0;
  for (const c of CORES) h += c.w * Math.exp(-(dist(p, c.xy) ** 2) / (2 * c.r * c.r));
  return Math.min(1, h);
}

// Parks — lots inside are dropped; polygons render in the fallback basemap.
const PARKS = [
  // Central Park (real corners)
  [[-73.9819, 40.7681], [-73.9732, 40.7644], [-73.9498, 40.7968], [-73.9585, 40.8003]],
  // The Battery
  [[-74.0179, 40.7040], [-74.0170, 40.7011], [-74.0150, 40.7000], [-74.0128, 40.7003], [-74.0140, 40.7038], [-74.0160, 40.7046]],
  // City Hall Park
  [[-74.0083, 40.7133], [-74.0064, 40.7118], [-74.0052, 40.7128], [-74.0075, 40.7146]],
  // Bowling Green
  [[-74.0147, 40.7052], [-74.0139, 40.7043], [-74.0132, 40.7049], [-74.0141, 40.7056]],
  // Washington Square
  [[-74.0003, 40.7315], [-73.9993, 40.7295], [-73.9955, 40.7307], [-73.9965, 40.7327]],
  // Union Square
  [[-73.9917, 40.7368], [-73.9910, 40.7347], [-73.9885, 40.7353], [-73.9895, 40.7374]],
  // Madison Square
  [[-73.9890, 40.7430], [-73.9885, 40.7404], [-73.9856, 40.7412], [-73.9866, 40.7438]],
  // Bryant Park
  [[-73.9850, 40.7546], [-73.9842, 40.7527], [-73.9812, 40.7536], [-73.9821, 40.7555]],
  // Tompkins Square
  [[-73.9832, 40.7275], [-73.9825, 40.7250], [-73.9790, 40.7258], [-73.9798, 40.7284]],
  // Marcus Garvey Park
  [[-73.9450, 40.8055], [-73.9440, 40.8025], [-73.9410, 40.8032], [-73.9422, 40.8062]],
  // Morningside Park (strip)
  [[-73.9630, 40.8055], [-73.9590, 40.7995], [-73.9570, 40.8003], [-73.9610, 40.8065]],
  // St. Nicholas Park (strip)
  [[-73.9530, 40.8215], [-73.9500, 40.8160], [-73.9480, 40.8168], [-73.9510, 40.8225]],
  // Riverside Park (strip along the Hudson, 72nd–125th)
  [[-73.9905, 40.7790], [-73.9630, 40.8225], [-73.9600, 40.8210], [-73.9875, 40.7778]],
  // East River Park (strip)
  [[-73.9745, 40.7220], [-73.9718, 40.7135], [-73.9700, 40.7142], [-73.9728, 40.7228]],
  // Inwood Hill + Fort Tryon
  [[-73.9320, 40.8710], [-73.9210, 40.8770], [-73.9150, 40.8715], [-73.9260, 40.8580], [-73.9330, 40.8620]],
  // Highbridge Park (strip along Harlem River)
  [[-73.9330, 40.8560], [-73.9255, 40.8440], [-73.9230, 40.8455], [-73.9310, 40.8575]],
];
const PIERS = [
  [[-74.0032, 40.7027], [-74.0014, 40.7018], [-74.0010, 40.7024], [-74.0028, 40.7033]],
  [[-73.9999, 40.7050], [-73.9981, 40.7043], [-73.9977, 40.7049], [-73.9995, 40.7056]],
  [[-73.9983, 40.7075], [-73.9962, 40.7070], [-73.9959, 40.7076], [-73.9980, 40.7081]],
  [[-74.0168, 40.7100], [-74.0186, 40.7096], [-74.0188, 40.7102], [-74.0170, 40.7106]],
  [[-74.0100, 40.7415], [-74.0130, 40.7408], [-74.0132, 40.7414], [-74.0102, 40.7421]], // Chelsea Piers
  [[-74.0086, 40.7455], [-74.0116, 40.7448], [-74.0118, 40.7454], [-74.0088, 40.7461]],
  [[-74.0013, 40.7615], [-74.0043, 40.7608], [-74.0045, 40.7614], [-74.0015, 40.7621]], // midtown Hudson
  [[-73.9455, 40.7692], [-73.9425, 40.7688], [-73.9424, 40.7694], [-73.9454, 40.7698]], // East River
];
function inRing(ll, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > ll[1] !== yj > ll[1] && ll[0] < ((xj - xi) * (ll[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const parksXY = PARKS.map((p) => p.map(proj.toXY));

// --- recursive subdivision (irregular downtown + within-block lots) --------
function subdivide(ring, targetArea, jitterDeg, out) {
  const area = polygonArea([ring]);
  if (area <= targetArea() || area < 900) { out.push(ring); return; }
  const [minX, minY, maxX, maxY] = bboxOfRing(ring);
  const wide = maxX - minX >= maxY - minY;
  const baseAngle = wide ? Math.PI / 2 : 0;
  const angle = baseAngle + ((rr(-jitterDeg, jitterDeg) * Math.PI) / 180);
  const t = rr(0.42, 0.58);
  const p = wide
    ? [minX + (maxX - minX) * t, (minY + maxY) / 2]
    : [(minX + maxX) / 2, minY + (maxY - minY) * t];
  const [a, b] = splitRing(ring, p, Math.cos(angle), Math.sin(angle));
  if (!a || !b) { out.push(ring); return; }
  subdivide(a, targetArea, jitterDeg, out);
  subdivide(b, targetArea, jitterDeg, out);
}

// --- blocks ----------------------------------------------------------------
// Real Manhattan is grids stitched at different bearings, not noise:
//   north of Houston — the main 29° grid (80 m street / 280 m avenue pitch);
//   Houston→Chambers — neighborhood mini-grids at their own bearings
//     (Tribeca/West Village, Soho, Lower East Side);
//   below Chambers — genuinely irregular colonial fabric (FiDi).
const blocks = []; // { ring, streetNo: number|null, u? }

let wMin = Infinity, wMax = -Infinity, uMin = Infinity, uMax = -Infinity;
for (const p of landRing) {
  const w = dotA(p), u = dotS(p);
  if (w < wMin) wMin = w; if (w > wMax) wMax = w;
  if (u < uMin) uMin = u; if (u > uMax) uMax = u;
}

// FiDi below Chambers: irregular subdivision, modest jitter
const fidiRing = clipRingHalfPlane(
  landRing, AVE[0], AVE[1], W_CHAMBERS, // keep dot(p, AVE) <= W_CHAMBERS
);
if (fidiRing) {
  const irregular = [];
  subdivide(fidiRing, () => rr(4200, 10000), 12, irregular);
  for (const r of irregular) blocks.push({ ring: r, streetNo: null });
}

// generic grid layer: lay blocks at bearing θ, keep those whose center
// passes `accept`; the ragged shore fringe left behind reads as esplanade
function gridLayer({ bearingDeg, stPitch, avePitch, blockW, blockU, accept, numbered }) {
  const th = (bearingDeg * Math.PI) / 180;
  const A = [Math.sin(th), Math.cos(th)], S = [Math.cos(th), -Math.sin(th)];
  const at = (u, w) => [u * S[0] + w * A[0], u * S[1] + w * A[1]];
  const corners4 = [[0, 0], [1, 0], [1, 1], [0, 1]];
  // zone-frame extents from the island bbox corners (cheap and safe)
  let zwMin = Infinity, zwMax = -Infinity, zuMin = Infinity, zuMax = -Infinity;
  for (const p of landRing) {
    const zw = p[0] * A[0] + p[1] * A[1], zu = p[0] * S[0] + p[1] * S[1];
    if (zw < zwMin) zwMin = zw; if (zw > zwMax) zwMax = zw;
    if (zu < zuMin) zuMin = zu; if (zu > zuMax) zuMax = zu;
  }
  for (let w = zwMin; w < zwMax; w += stPitch) {
    for (let u = zuMin; u < zuMax; u += avePitch) {
      const ring = corners4.map(([cu, cw]) => at(u + cu * blockU, w + cw * blockW));
      const center = at(u + blockU / 2, w + blockW / 2);
      if (!accept(center)) continue;
      if (!ring.every((c) => inRing(c, landRing))) continue;
      if (parksXY.some((p) => inRing(center, p))) continue;
      blocks.push({
        ring,
        streetNo: numbered ? Math.max(1, Math.round((dotA(center) - W_HOUSTON) / 80.5) + 1) : null,
        u: dotS(center),
      });
    }
  }
}

// main grid, north of Houston
gridLayer({
  bearingDeg: 29, stPitch: 80.5, avePitch: 280, blockW: 61, blockU: 248,
  numbered: true,
  accept: (c) => dotA(c) >= W_HOUSTON && inRing(c, landRing),
});

// the Houston→Chambers band, three neighborhood grids split by longitude
const X_WEST = proj.toXY([-74.0050, 40.72])[0];
const X_EAST = proj.toXY([-73.9955, 40.72])[0];
const inBand = (c) => dotA(c) > W_CHAMBERS && dotA(c) < W_HOUSTON && inRing(c, landRing);
gridLayer({ // Tribeca / West Village: near true north
  bearingDeg: 4, stPitch: 68, avePitch: 235, blockW: 52, blockU: 205,
  numbered: false,
  accept: (c) => inBand(c) && c[0] <= X_WEST,
});
gridLayer({ // Soho / Little Italy: follows the main bearing
  bearingDeg: 26, stPitch: 74, avePitch: 195, blockW: 57, blockU: 168,
  numbered: false,
  accept: (c) => inBand(c) && c[0] > X_WEST && c[0] <= X_EAST,
});
gridLayer({ // Lower East Side: its own skew, tighter tenement blocks
  bearingDeg: 14, stPitch: 64, avePitch: 172, blockW: 49, blockU: 148,
  numbered: false,
  accept: (c) => inBand(c) && c[0] > X_EAST,
});

const STREETS_DOWNTOWN = [
  "Wall St", "Broad St", "Broadway", "Water St", "Pearl St", "Beaver St",
  "Stone St", "Maiden Ln", "John St", "Fulton St", "Nassau St", "William St",
  "Pine St", "Cedar St", "Liberty St", "Greenwich St", "Trinity Pl",
  "Exchange Pl", "Rector St", "Whitehall St", "State St", "Front St",
  "South St", "Gold St", "Cliff St", "Beekman St", "Ann St", "Park Row",
  "Church St", "Vesey St", "Barclay St", "Murray St", "Warren St", "Chambers St",
  "Canal St", "Grand St", "Broome St", "Spring St", "Prince St", "Bleecker St",
  "Mott St", "Mulberry St", "Bowery", "Delancey St", "Rivington St", "Orchard St",
];
const AVENUES = new Map([
  [-7, "12th Ave"], [-6, "11th Ave"], [-5, "10th Ave"], [-4, "9th Ave"],
  [-3, "8th Ave"], [-2, "7th Ave"], [-1, "6th Ave"], [0, "5th Ave"],
  [1, "Madison Ave"], [2, "Park Ave"], [3, "Lexington Ave"], [4, "3rd Ave"],
  [5, "2nd Ave"], [6, "1st Ave"], [7, "Ave A"], [8, "Ave B"], [9, "Ave C"], [10, "Ave D"],
]);
function gridAddress(streetNo, u, houseNo) {
  if (rand() < 0.22) {
    const ai = Math.round((u - U_FIFTH) / 280);
    const ave = AVENUES.get(ai);
    if (ave) return `${houseNo * 10 + Math.round(rr(0, 9))} ${ave}`;
  }
  const ew = u < U_FIFTH ? "W" : "E";
  const suf = streetNo % 10 === 1 && streetNo !== 11 ? "st" : streetNo % 10 === 2 && streetNo !== 12 ? "nd" : streetNo % 10 === 3 && streetNo !== 13 ? "rd" : "th";
  return `${houseNo} ${ew} ${streetNo}${suf} St`;
}

function zoningFor(heat, p) {
  const [x, y] = p;
  const bpc = x < proj.toXY([-74.0145, 40.708])[0] && y < proj.toXY([-73.99, 40.718])[1];
  if (bpc) return { z: "BPC", commfar: 10, resfar: 10 };
  if (heat > 0.72) return { z: "C5-5", commfar: 15, resfar: 10 };
  if (heat > 0.5) return { z: "C6-4", commfar: 10, resfar: 10 };
  if (heat > 0.32) return { z: "C1-9", commfar: 6, resfar: 8 };
  return { z: "R8B", commfar: 2, resfar: 6.02 };
}

function classFor(heat) {
  const r = rand();
  if (r < 0.035) return "V1";            // vacant lot
  if (r < 0.05) return "G1";             // parking garage
  if (heat > 0.55) {
    if (r < 0.62) return "O4";           // office
    if (r < 0.72) return "RM";           // mixed
    if (r < 0.82) return "D0";           // multifamily
    if (r < 0.90) return "K2";           // retail
    return "O3";
  }
  if (r < 0.14) return "O4";
  if (r < 0.62) return "D0";
  if (r < 0.78) return "RM";
  if (r < 0.92) return "K2";
  return "S1";                            // store + residence
}

function yearFor() {
  const r = rand();
  if (r < 0.58) return Math.round(rr(1885, 1935));
  if (r < 0.85) return Math.round(rr(1955, 1992));
  return Math.round(rr(2000, 2024));
}

const parcels = { type: "FeatureCollection", features: [] };
const buildings = { type: "FeatureCollection", features: [] };
let blockNo = 1, binNo = 1000001;

for (const block of blocks) {
  const gridded = block.u !== undefined; // any grid layer, numbered or not
  const street = insetRing(block.ring, gridded ? 6 : 7);
  if (!street || polygonArea([street]) < 700) continue;
  const bc = centroid(street);
  if (parksXY.some((p) => inRing(bc, p))) continue;
  const heat = coreHeat(bc);
  const downtownStreet = block.streetNo ? null : pick(STREETS_DOWNTOWN);
  let houseNo = Math.round(rr(1, 60));

  const lots = [];
  if (rand() < (heat > 0.5 ? 0.07 : 0.015)) lots.push(street); // full-block plate
  else if (gridded) subdivide(street, () => rr(220, 750), 6, lots);
  else subdivide(street, () => rr(320, 1350), 10, lots);

  let lotNo = 1;
  for (const lotRing of lots) {
    const areaM2 = polygonArea([lotRing]);
    if (areaM2 < 90) continue;
    const lotArea = Math.round(areaM2 * 10.7639);
    const c = centroid(lotRing);
    if (parksXY.some((p) => inRing(c, p))) continue;
    const h = coreHeat(c);
    const zone = zoningFor(h, c);
    const cls = classFor(h);
    const vacant = cls === "V1";
    const bbl = 1000000000 + blockNo * 10000 + lotNo;

    // massing: towers rise with heat; pre-1961 stock ignores the FAR clamp
    // (grandfathered overbuilt buildings — the teardown-vs-keep tension)
    const yearbuilt = vacant ? 0 : yearFor();
    let floors = 0, bldgArea = 0, footprint = null, heightM = 0;
    if (!vacant) {
      const towerP = Math.min(0.8, h * h * 1.1 + (areaM2 > 1600 ? 0.18 : 0));
      let coverage;
      if (areaM2 > 220 && rand() < towerP) {
        floors = Math.round(rr(24, 66));
        coverage = rr(0.5, 0.72);
      } else if (rand() < 0.4 + h * 0.45) {
        floors = Math.round(rr(8, 24));
        coverage = rr(0.72, 0.9);
      } else {
        floors = Math.round(rr(3, 8));
        coverage = rr(0.8, 0.95);
      }
      if (cls === "G1") floors = Math.min(floors, 6);
      if (cls === "K2") floors = Math.min(floors, 4);
      if (yearbuilt >= 1961) {
        floors = Math.min(floors, Math.max(2, Math.round(Math.max(zone.commfar, zone.resfar) / coverage)));
      }
      const side = Math.sqrt(areaM2);
      footprint = insetRing(lotRing, (side * (1 - Math.sqrt(coverage))) / 2);
      const realCov = footprint ? polygonArea([footprint]) / areaM2 : coverage;
      bldgArea = Math.round(lotArea * realCov * floors);
      heightM = floors * 3.55 + rr(1, 5);
    }

    const landPsfBase = 120 + 680 * h;
    const assessland = Math.round(lotArea * landPsfBase * rr(0.85, 1.15) * 0.45);
    const bldgPsf = cls[0] === "O" ? rr(220, 420) : cls[0] === "D" ? rr(180, 330) : rr(120, 260);
    const assesstot = assessland + Math.round(bldgArea * bldgPsf * 0.45);
    const unitsres = cls[0] === "D" || cls === "S1" || cls === "RM"
      ? Math.max(1, Math.round((bldgArea * (cls === "D0" ? 0.9 : 0.45)) / 900)) : 0;
    const address = block.streetNo
      ? gridAddress(block.streetNo, block.u, houseNo)
      : `${houseNo} ${downtownStreet}`;

    parcels.features.push({
      type: "Feature",
      id: bbl,
      geometry: { type: "Polygon", coordinates: [[...lotRing.map(proj.toLL), proj.toLL(lotRing[0])]] },
      properties: {
        bbl: String(bbl),
        borough: "MN", block: String(blockNo), lot: String(lotNo),
        address,
        zonedist1: zone.z, commfar: zone.commfar, resfar: zone.resfar,
        bldgclass: cls, landuse: vacant ? "11" : cls === "G1" ? "10" : cls[0] === "O" ? "05" : "04",
        lotarea: lotArea, bldgarea: bldgArea, numfloors: floors,
        yearbuilt, assessland, assesstot, unitsres,
        cd: "MN",
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
          heightroof: +(heightM * 3.28084).toFixed(1), // real dataset is feet
          cnstrct_yr: yearbuilt,
          groundelev: Math.round(rr(5, 40)),
        },
      });
    }
    houseNo += Math.round(rr(2, 8));
    lotNo++;
  }
  blockNo++;
}

// Subway stations — approximate real locations; weight ~ relative ridership.
const STATIONS = [
  { name: "Fulton St", lines: "2 3 4 5 A C J Z", ll: [-74.0080, 40.7098], weight: 100 },
  { name: "Wall St", lines: "4 5", ll: [-74.0119, 40.7073], weight: 55 },
  { name: "Wall St", lines: "2 3", ll: [-74.0067, 40.7069], weight: 45 },
  { name: "Broad St", lines: "J Z", ll: [-74.0111, 40.7063], weight: 25 },
  { name: "Bowling Green", lines: "4 5", ll: [-74.0141, 40.7049], weight: 60 },
  { name: "South Ferry", lines: "1", ll: [-74.0134, 40.7017], weight: 40 },
  { name: "Whitehall St", lines: "R W", ll: [-74.0127, 40.7032], weight: 35 },
  { name: "Rector St", lines: "1", ll: [-74.0138, 40.7075], weight: 20 },
  { name: "WTC Cortlandt", lines: "1", ll: [-74.0121, 40.7115], weight: 30 },
  { name: "World Trade Center", lines: "E", ll: [-74.0097, 40.7126], weight: 45 },
  { name: "Park Place", lines: "2 3", ll: [-74.0088, 40.7132], weight: 30 },
  { name: "City Hall", lines: "R W", ll: [-74.0072, 40.7134], weight: 22 },
  { name: "Brooklyn Bridge–City Hall", lines: "4 5 6", ll: [-74.0041, 40.7128], weight: 65 },
  { name: "Chambers St", lines: "1 2 3", ll: [-74.0093, 40.7150], weight: 50 },
  { name: "Canal St", lines: "N Q R W 6 J Z", ll: [-74.0002, 40.7190], weight: 60 },
  { name: "Houston St", lines: "1", ll: [-74.0053, 40.7283], weight: 20 },
  { name: "W 4th St", lines: "A C E B D F M", ll: [-74.0003, 40.7323], weight: 55 },
  { name: "Astor Pl", lines: "6", ll: [-73.9915, 40.7300], weight: 30 },
  { name: "14th St–Union Sq", lines: "4 5 6 L N Q R W", ll: [-73.9899, 40.7349], weight: 95 },
  { name: "14th St", lines: "A C E L", ll: [-74.0018, 40.7404], weight: 55 },
  { name: "23rd St", lines: "6", ll: [-73.9866, 40.7398], weight: 35 },
  { name: "28th St", lines: "1", ll: [-73.9910, 40.7473], weight: 25 },
  { name: "34th St–Penn Station", lines: "1 2 3 A C E", ll: [-73.9910, 40.7506], weight: 100 },
  { name: "34th St–Herald Sq", lines: "B D F M N Q R W", ll: [-73.9879, 40.7497], weight: 90 },
  { name: "Grand Central–42nd St", lines: "4 5 6 7 S", ll: [-73.9772, 40.7527], weight: 100 },
  { name: "Times Sq–42nd St", lines: "1 2 3 7 N Q R W S", ll: [-73.9870, 40.7558], weight: 100 },
  { name: "42nd St–Port Authority", lines: "A C E", ll: [-73.9899, 40.7570], weight: 80 },
  { name: "47–50th Sts Rockefeller Ctr", lines: "B D F M", ll: [-73.9812, 40.7587], weight: 60 },
  { name: "51st St", lines: "6 E M", ll: [-73.9720, 40.7571], weight: 55 },
  { name: "59th St–Columbus Circle", lines: "1 A B C D", ll: [-73.9819, 40.7681], weight: 75 },
  { name: "Lexington Av/59th St", lines: "4 5 6 N R W", ll: [-73.9673, 40.7626], weight: 70 },
  { name: "68th St–Hunter College", lines: "6", ll: [-73.9641, 40.7681], weight: 40 },
  { name: "72nd St", lines: "1 2 3", ll: [-73.9819, 40.7785], weight: 50 },
  { name: "77th St", lines: "6", ll: [-73.9597, 40.7739], weight: 40 },
  { name: "86th St", lines: "4 5 6", ll: [-73.9552, 40.7794], weight: 65 },
  { name: "86th St", lines: "1", ll: [-73.9762, 40.7884], weight: 40 },
  { name: "96th St", lines: "1 2 3", ll: [-73.9721, 40.7938], weight: 45 },
  { name: "96th St", lines: "6 Q", ll: [-73.9512, 40.7856], weight: 45 },
  { name: "110th St–Cathedral Pkwy", lines: "1", ll: [-73.9666, 40.8039], weight: 25 },
  { name: "116th St–Columbia", lines: "1", ll: [-73.9642, 40.8078], weight: 45 },
  { name: "125th St", lines: "4 5 6", ll: [-73.9376, 40.8045], weight: 55 },
  { name: "125th St", lines: "A B C D", ll: [-73.9524, 40.8111], weight: 55 },
  { name: "125th St", lines: "1", ll: [-73.9585, 40.8151], weight: 35 },
  { name: "135th St", lines: "2 3", ll: [-73.9401, 40.8143], weight: 25 },
  { name: "145th St", lines: "A B C D", ll: [-73.9445, 40.8244], weight: 35 },
  { name: "168th St", lines: "1 A C", ll: [-73.9397, 40.8404], weight: 45 },
  { name: "181st St", lines: "A", ll: [-73.9379, 40.8511], weight: 30 },
  { name: "Dyckman St", lines: "A 1", ll: [-73.9254, 40.8656], weight: 25 },
];
const stations = {
  type: "FeatureCollection",
  features: STATIONS.map((s, i) => ({
    type: "Feature", id: i + 1,
    geometry: { type: "Point", coordinates: s.ll },
    properties: { stop_name: s.name, daytime_routes: s.lines, weight: s.weight },
  })),
};

// Per-block workplace employment (jobs cluster where office space is).
const jobsByBlock = new Map();
for (const f of parcels.features) {
  const p = f.properties;
  const jobs = p.bldgclass[0] === "O" ? p.bldgarea / 230
    : p.bldgclass === "K2" ? p.bldgarea / 400
    : p.bldgclass === "RM" || p.bldgclass === "S1" ? p.bldgarea / 700 : 0;
  if (!jobs) continue;
  const key = p.block;
  const cur = jobsByBlock.get(key) ?? { jobs: 0, x: 0, y: 0, n: 0 };
  const ring = f.geometry.coordinates[0];
  const cx = ring.reduce((s, q) => s + q[0], 0) / ring.length;
  const cy = ring.reduce((s, q) => s + q[1], 0) / ring.length;
  cur.jobs += jobs; cur.x += cx; cur.y += cy; cur.n++;
  jobsByBlock.set(key, cur);
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
    {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[...COAST, COAST[0]]] },
      properties: { kind: "land" },
    },
    ...PIERS.map((ring) => ({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] },
      properties: { kind: "pier" },
    })),
    ...PARKS.map((ring) => ({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] },
      properties: { kind: "park" },
    })),
  ],
};

writeFileSync(join(RAW, "parcels.geojson"), JSON.stringify(parcels));
writeFileSync(join(RAW, "buildings.geojson"), JSON.stringify(buildings));
writeFileSync(join(RAW, "stations.geojson"), JSON.stringify(stations));
writeFileSync(join(RAW, "employment.geojson"), JSON.stringify(employment));
writeFileSync(join(RAW, "context.geojson"), JSON.stringify(context));
writeFileSync(join(RAW, "manifest.json"), JSON.stringify({
  source: "synthetic", district: "MN", seed: SEED, lodes: true,
}, null, 2));

console.log(`Synthetic dev dataset: ${parcels.features.length} lots on ${blockNo - 1} blocks, ${buildings.features.length} buildings, ${stations.features.length} stations, ${employment.features.length} employment blocks.`);
