// A REGION, FROM A NUMBER (the region expansion, Phase 1).
//
// `makeRegion(seed)` is a 6 x 6 km piece of country with a small river city in
// it, returned in exactly the shape `makeCity` returns for an island, plus one
// extra table:
//
//   parcels    the market: every lot of the old city and the river village
//              (cut by the island generator, citygen.mjs, inside the town's
//              outline — region/town.mjs), and the ordinary commercial and
//              industrial parcels out in the region (strip centres, big boxes,
//              distribution centres, the grain elevator, the business park,
//              gravel lots). Every engine loop sees these and only these.
//   reserved   the land the commercial market does not reach in Phase 1, each
//              record flagged with `tenure` (data/types.ts):
//                "homes" — a NEIGHBOURHOOD (one parcel per subdivision: its
//                          home count, sizes, era and the recipe that redraws
//                          its houses) or a rural home on its acre;
//                "farm"  — a farm or woodlot tract (agricultural, not
//                          buildable until Phase 2, and not priced: it is not
//                          in the land market at all);
//                "civic" — the church and school.
//              They are drawn, labelled and clickable (parcelFeatures carries
//              them), and no engine table holds them — so no listing, rival
//              bid, teardown, street roll or land valuation can reach one.
//
// Determinism: every draw comes from a named stream keyed by the seed
// (util.mjs makeRng), so the same seed is the same region byte for byte.
import { generateCity } from "../citygen.mjs";
import { buildCityData } from "../build.mjs";
import { makeProjection } from "../geom.mjs";
import {
  ACRE, FT, SQFT_PER_M2, makeRng, add, sub, mul, dist, norm, perp, resample, rdp, circle, capsules, hull,
  rectRing, ringAreaAbs, ringCentroid, pointInRing, distToLine, maskOutline, CELL, cumLen, pointAt, slicePl,
} from "./util.mjs";
import { generateLand, NAME_A, NAME_B, SZ } from "./land.mjs";
import { storyPrep, townFootprint } from "./story.mjs";
import { placeOuter } from "./outer.mjs";
import { townConfig, villageConfig } from "./town.mjs";
import { makeFrame } from "./frame.mjs";
import { packBits, PLAT_GEN, ERA_YEARS, platFor } from "./plats.mjs";
import { designPlat } from "./platdesign.mjs";

export const REGION = "region";
// A fictional place on the Public Land Survey (central Illinois). Only the
// projection reads it; nothing in the economy does.
const LONLAT = [-88.2, 40.1];
/** Road surface widths, m — the contract with the Unreal side (spike README "Road widths"). */
const ROAD_W = { highway: 24, arterial: 14, local: 9 };
/** Ground layers of a region, in draw order (later on top): open land under the town's own surfaces. */
export const REGION_GROUND_LAYERS = ["land", "beach", "marsh", "farm", "woods", "yard", "rock", "esplanade", "stream", "pond", "paveland", "apron", "pavement", "median", "sidewalk", "block", "park"];
const TREE_CAP = 30000;
const OUTSKIRTS = "outskirts";
const CENTRE_KINDS = new Set(["neighbourhood", "strip", "gas", "community", "power", "mall", "rural", "flex", "industrial park", "truck stop"]);

export function regionName(seed) {
  const r = makeRng("name:" + (seed >>> 0));
  return r.pick(NAME_A) + r.pick(NAME_B);
}

export function makeRegion(seed, opts = {}) {
  seed = seed >>> 0;
  const planV = opts.planV ?? 15;
  const M = generateLand(seed, planV);
  SEED_PLAN.set(seed, planV);
  storyPrep(M);
  townFootprint(M);
  placeOuter(M);
  const G = M.G, S = M.S, F = makeFrame(seed, S);
  const proj = makeProjection(LONLAT[0], LONLAT[1]);
  const W = (pl) => pl.map(F.toW);
  const LL = (p) => { const q = proj.toLL(F.toW(p)); return [+q[0].toFixed(7), +q[1].toFixed(7)]; };
  const LLw = (q) => { const r = proj.toLL(q); return [+r[0].toFixed(7), +r[1].toFixed(7)]; };
  const polyLL = (ring) => ({ type: "Polygon", coordinates: [[...ring.map(LL), LL(ring[0])]] });
  const name = regionName(seed);
  const rng = makeRng("assemble:" + seed);

  // ---------------- the old city, cut by the island generator
  const main = M.story.main;
  const freewaysC = M.highways.flatMap((h) => h.segs.filter((s) => s.built).map((s) => s.pts));
  const cfg = townConfig({
    seed, ring: W(M.townRing), centre: F.toW(M.centre), wet: F.dirW(M.site.wet),
    roads: { main: main ? W(main) : null, others: M.oldRoads.filter((r) => r !== main).map(W), freeways: freewaysC.map(W) },
    land: { rS: (p) => M.story.rS(F.toC(p)), ind: (p) => M.story.ind(F.toC(p)) },
    center: LONLAT, name, abbr: "RG",
  });
  const density = opts.density;
  const town = generateCity({ ...cfg, seed: (seed ^ 0x52474e31) >>> 0, density, planV });
  const towns = [{ cfg, city: town, base: 1 }];
  for (const [i, t] of M.towns.entries()) {
    const vcfg = villageConfig({ seed: seed + i, rect: { c: F.toW(t.c), u: F.dirW(t.u), pitch: t.pitch, poly: () => t.poly().map(F.toW) }, wet: F.dirW(t.wet), center: LONLAT, name: t.name, abbr: "RV" });
    const v = generateCity({ ...vcfg, seed: (seed ^ (0x56494c00 + i)) >>> 0, density: "frontier", planV });
    towns.push({ cfg: vcfg, city: v, base: 2 + i });
  }
  // the village's deeds are numbered in their own range (2xxxxxxxxx), the region's in 3xxxxxxxxx
  const rebase = (s, base) => String(base * 1e9 + (Number(s) % 1e9));
  for (const tw of towns) if (tw.base !== 1) {
    for (const f of tw.city.parcels.features) { f.properties.bbl = rebase(f.properties.bbl, tw.base); f.id = Number(f.properties.bbl); }
    for (const f of tw.city.buildings.features) if (f.properties.base_bbl) f.properties.base_bbl = rebase(f.properties.base_bbl, tw.base);
  }

  // ---------------- THE INNER RING IS HOUSES (owner, Phase 1 design)
  // The island generator fills a residential district with walk-ups covering most of their lot. The
  // additions round a small river city were houses: one- and two-family frames and the odd triple-decker
  // on 30-50 ft lots, a front yard and a back one. So an addition's ordinary apartment lot (fronting no
  // boulevard, under 9,000 sf; half the corners) becomes the house that stood there — the same deed, the same year,
  // an ordinary multifamily parcel the engine values as a small rental and the rivals and the street can
  // buy, assemble and rebuild under the district's zoning. About one in five stays a small apartment
  // building among the houses [K, the spike's 0.18].
  // Sizes [S, approximate]: a pre-war house 6-9 m wide and 10-13 m deep; 60% two storeys; one family 60%,
  // a two-flat 30%, three flats 10%.
  const housed = new Set();
  // HOW FAR OUT A LOT SITS IN ITS TOWN, 0 at the centre and 1 on the edge (owner: "downtown has
  // such a clear defined limit"): the centre-to-edge share along the lot's own ray, so a lobe of town
  // reads its own edge. The taper below and the houses pass both read it.
  const ringW = W(M.townRing).concat([F.toW(M.townRing[0])]), centreW = F.toW(M.centre);
  const outward = (q) => { const dc = dist(q, centreW), de = distToLine(q, ringW); return dc / Math.max(1, dc + de); };
  const h01 = (s, salt) => { let h = 2166136261 ^ salt; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } h ^= h >>> 13; h = Math.imul(h, 2246822507); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  for (const tw of towns) {
    const resi = new Set(Object.entries(tw.cfg.districts).filter(([, d]) => d.flavor === "resi").map(([k]) => k));
    const bldgOf = new Map();
    for (const f of tw.city.buildings.features) { const b = f.properties.base_bbl; if (b) { const l = bldgOf.get(b); if (l) l.push(f); else bldgOf.set(b, [f]); } }
    const drop = new Set();
    for (const f of tw.city.parcels.features) {
      const p = f.properties;
      // toward the town's edge the houses take over: bigger lots qualify and fewer stay apartments
      // (the fringe of a pre-war town is houses on their own lots, not walk-ups) [K, shape choice]
      const lot = f.geometry.coordinates[0].slice(0, -1).map(proj.toXY);
      const t = tw.base === 1 && planV >= 17 ? outward(ringCentroid(lot)) : 0;   // plan 17 on
      const fringe = Math.max(0, (t - 0.55) / 0.45);
      // THE EMPTY BAND (measured, seed 2: ~600 of the town's outer lots were platted and vacant — the
      // brown ring between downtown and the suburbs). A real town's outer additions are built up with
      // houses; three in four of those vacant house lots get one, the rest stay land for sale [K].
      const vacantHouseLot = p.bldgclass === "V1" && t > 0.45 && (resi.has(p.district) || String(p.district).startsWith("oldtown"))
        && p.lotarea <= 18000 && h01(p.bbl, 9) < 0.75;
      if (!vacantHouseLot && (!resi.has(p.district) || p.bldgclass !== "D0" || !(p.lotarea <= 9000 + 9000 * fringe))) continue;
      if ((p.corridorm ?? 9999) < 12) continue;
      if (p.corner === 1 && h01(p.bbl, 7) < 0.5 - 0.4 * fringe) continue;   // half the corners keep their corner building (fewer at the fringe)
      let bs = bldgOf.get(p.bbl);
      if (vacantHouseLot) {
        // a house on an empty lot: a new building, built in the addition's own years (1900-1950, later outward)
        const b = { type: "Feature", geometry: null, properties: { base_bbl: p.bbl, heightroof: 0, cnstrct_yr: 0 } };
        tw.city.buildings.features.push(b); bs = [b];
        p.yearbuilt = Math.round(1900 + 30 * t + 20 * h01(p.bbl, 10));
        b.properties.cnstrct_yr = p.yearbuilt;
        p.landuse = "01";
      } else if (!bs?.length || h01(p.bbl, 1) > 0.82 + 0.15 * fringe) continue;
      // the lot's depth runs along its longest side
      let ax = [1, 0], best = 0;
      for (let i = 0; i < lot.length; i++) { const e = sub(lot[(i + 1) % lot.length], lot[i]), L = Math.hypot(e[0], e[1]); if (L > best) { best = L; ax = [e[0] / L, e[1] / L]; } }
      const ay = perp(ax), c = ringCentroid(lot);
      const ext = (v) => { const s = lot.map((q) => (q[0] - c[0]) * v[0] + (q[1] - c[1]) * v[1]); return Math.max(...s) - Math.min(...s); };
      const D = ext(ax), Fw = ext(ay);
      const w = Math.max(5.5, Math.min(0.7 * Fw, 9 * (0.9 + 0.2 * h01(p.bbl, 2)))), d = Math.max(7, Math.min(0.45 * D, 13 * (0.9 + 0.2 * h01(p.bbl, 3))));
      const storeys = h01(p.bbl, 4) < 0.6 ? 2 : 1, uu = h01(p.bbl, 5), units = uu < 0.6 ? 1 : uu < 0.9 ? 2 : 3;
      const ring = rectRing(c, ay, w, d);
      const bldgarea = Math.round(w * d * storeys * SQFT_PER_M2);
      p.bldgclass = units === 1 ? "A1" : units === 2 ? "B1" : "C0";
      p.numfloors = storeys; p.bldgarea = bldgarea; p.unitsres = units;
      p.assesstot = p.assessland + Math.round(bldgarea * (120 + 110 * h01(p.bbl, 6)) * 0.45);   // the generator's own D-class $/sf band
      bs[0].geometry = { type: "Polygon", coordinates: [[...ring.map(LLw), LLw(ring[0])]] };
      bs[0].properties.heightroof = +((storeys * 3.2 + 2.5) / FT).toFixed(1);
      for (const extra of bs.slice(1)) drop.add(extra);
      housed.add(p.bbl);
    }
    if (drop.size) tw.city.buildings.features = tw.city.buildings.features.filter((f) => !drop.has(f));
  }

  // ---------------- THE TOWN TAPERS TO ITS EDGE (owner: "it needs to blend and mesh with the rest of
  // the surrounding land"). The island generator fills its ring at one density right to the line, so the
  // old city stood as a mid-rise block against the corn. A real town's heights fall off from the core:
  // here a lot's storeys are capped by how far out it sits — no cap in the inner half, then down to
  // two or three storeys at the edge (with a little per-lot jitter so the fall is not a contour). The
  // floor area and the building's assessed value fall with the storeys; the lot and its land do not.
  // The cap is a shape choice [K]: the shape of every small Midwest county seat's skyline.
  for (const tw of towns) {
    if (tw.base !== 1 || planV < 17) continue;   // plan 17 on: a plan-16 save rebuilds its town as it was
    const bldgOf = new Map();
    for (const f of tw.city.buildings.features) { const b = f.properties.base_bbl; if (b) { const l = bldgOf.get(b); if (l) l.push(f); else bldgOf.set(b, [f]); } }
    for (const f of tw.city.parcels.features) {
      const p = f.properties;
      if (housed.has(p.bbl) || !(p.numfloors > 0) || !(p.bldgarea > 0)) continue;
      const t = outward(ringCentroid(f.geometry.coordinates[0].slice(0, -1).map(proj.toXY)));
      if (t < 0.35) continue;
      // storeys: 8 at a third of the way out, two or three over the outer third
      const cap = Math.max(2, Math.round(8 - 15 * (t - 0.35) + 2 * (h01(p.bbl, 11) - 0.5)));
      // SETBACKS: the fringe's buildings stand back on their lots (a yard, a side drive, a car park)
      // instead of filling them to the line — the footprint shrinks about its own middle to as little as
      // 55% of its area at the edge [K]
      const fringe = Math.max(0, (t - 0.55) / 0.45), s = 1 - 0.26 * fringe * (0.8 + 0.4 * h01(p.bbl, 12));
      const kF = p.numfloors > cap ? cap / p.numfloors : 1, kA = s * s;
      if (kF === 1 && s > 0.995) continue;
      if (s < 0.995) for (const b of bldgOf.get(p.bbl) ?? []) {
        const r = b.geometry.coordinates[0].slice(0, -1).map(proj.toXY), c = ringCentroid(r);
        const r2 = r.map((q) => add(c, mul(sub(q, c), s)));
        b.geometry = { type: "Polygon", coordinates: [[...r2.map(LLw), LLw(r2[0])]] };
      }
      p.numfloors = Math.min(p.numfloors, cap);
      p.bldgarea = Math.round(p.bldgarea * kF * kA);
      p.assesstot = p.assessland + Math.round((p.assesstot - p.assessland) * kF * kA);
      if (kF < 1) for (const b of bldgOf.get(p.bbl) ?? []) b.properties.heightroof = +Math.max(20, b.properties.heightroof * kF).toFixed(1);
    }
  }

  // ---------------- the region's ordinary parcels: the market out past the town
  const rawParcels = { type: "FeatureCollection", features: towns.flatMap((t) => t.city.parcels.features) };
  const rawBuildings = { type: "FeatureCollection", features: towns.flatMap((t) => t.city.buildings.features) };
  const employment = { type: "FeatureCollection", features: towns.flatMap((t) => t.city.employment?.features ?? []) };
  const outskirtsName = "The Outskirts";
  const lotNear = (p) => {
    let best = Infinity;
    for (const r of M.oldRoads.concat(M.secRoads)) best = Math.min(best, distToLine(p, r));
    return best;
  };
  const reserved = {}, reservedFeatures = [], houses3d = [];
  // THE RENDERER'S RETAIL BRIEF (unreal RetailBuilder): each store's role and its storefront's middle, by deed
  const retailInfo = new Map();
  // which rung of the commerce hierarchy each centre and industrial lot is (commerce.mjs), for the engine
  const centreOf = new Map();
  let blockNo = 1, rid = 0;
  const reserveRec = (rec, ringC, extra = {}) => {
    const ringLL = polyLL(ringC);
    reserved[rec.bbl] = { ...rec, centroid: LL(ringCentroid(ringC)) };
    reservedFeatures.push({ type: "Feature", id: 9e9 + ++rid, geometry: ringLL, properties: { bbl: rec.bbl, address: rec.address, class: rec.class, demand: 0, landpsf: 0, zone: rec.zoneDist, tenure: rec.tenure, ...extra } });
  };
  const sf = (m2) => Math.round(m2 * SQFT_PER_M2);
  const roadName = (p) => {
    // the old road names the place by where it leads; a section line by its survey number
    const i = M.oldRoads.findIndex((r) => distToLine(p, r) < 60);
    return i >= 0 ? `${["Old Mill", "Ridge", "County", "Ferry", "State", "Plank"][i % 6]} Rd` : `Section Line Rd`;
  };
  for (const lot of M.outerLots) {
    const rings = lot.rects.map((r) => rectRing(r.c, r.u, r.w, r.d));
    const all = rings.flat(), outline = hull(all);
    const lotM2 = ringAreaAbs(outline);   // the deed is the outline; pieces overlap (a building stands on its own lawn or car park)
    const bldgs = lot.rects.filter((r) => r.kind === "bldg" || r.kind === "house" || r.kind === "barn");
    const floorsOf = (r) => r.floors ?? Math.max(1, Math.round(r.z / 355));
    const bldgM2 = bldgs.filter((r) => r.kind !== "barn").reduce((a, r) => a + r.w * r.d * (r.cls === "industrial" ? 1 : floorsOf(r)), 0);
    const no = Math.round(100 + 900 * rng());
    const address = `${no} ${roadName(lot.anchor)}`;
    if (lot.tenure) {
      // households and the parish: drawn and clickable, not in the commercial market in Phase 1
      const bbl = lot.tenure === "civic" ? `C${++blockNo}` : `H${++blockNo}`;
      const homes = bldgs.filter((r) => r.kind === "house").length;
      reserveRec({
        bbl, address: `${address} (${lot.name.toLowerCase()})`, tenure: lot.tenure, class: lot.tenure === "civic" ? "office" : "multifamily",
        zoneDist: lot.tenure === "civic" ? "CF" : "AG-R", district: OUTSKIRTS, districtName: outskirtsName,
        lotArea: sf(lotM2), bldgArea: sf(bldgM2), floors: Math.max(0, ...bldgs.map(floorsOf)), yearBuilt: lot.year,
        ...(homes ? { homes, acres: +(lotM2 / ACRE).toFixed(2) } : {}), kind: lot.kind, name: lot.name,
      }, outline);
      for (const r of bldgs) houses3d.push({ bbl, r, year: lot.year, cls: r.kind === "barn" ? "industrial" : r.kind === "house" ? "multifamily" : r.cls, house: r.kind === "house" });
      continue;
    }
    const bbl = String(3e9 + blockNo * 1e4 + 1); blockNo++;
    if (lot.kind && CENTRE_KINDS.has(lot.kind)) centreOf.set(bbl, lot.kind);
    const cls = lot.cls;
    const bldgclass = lot.bldgclass ?? (cls === "land" ? "V1" : cls === "retail" ? "K1" : cls === "office" ? "O4" : "E9");
    // zoning out past the town: a suburban business or light-industry district, FAR about 1 [S, typical suburban codes]
    const zone = lot.zone ? { z: lot.zone, far: 1.0 } : cls === "industrial" ? { z: "M1", far: 1.0 } : { z: "C-1", far: 1.0 };
    const front = Math.max(...lot.rects.map((r) => r.w)), depth = lotM2 / front;
    const landPsfBase = 60;   // the generator's own base for land with no heat (citygen.mjs: 60 + 380 x heat)
    const assessland = Math.round(sf(lotM2) * landPsfBase * (0.85 + 0.3 * rng()) * 0.45);
    const bldgPsf = cls === "office" ? 140 + 140 * rng() : 70 + 110 * rng();
    const assesstot = assessland + Math.round(sf(bldgM2) * bldgPsf * 0.45);
    const nFloors = Math.max(0, ...bldgs.map(floorsOf));
    rawParcels.features.push({
      type: "Feature", id: Number(bbl), geometry: polyLL(outline),
      properties: {
        bbl, borough: "RG", block: String(blockNo), lot: "1", address: lot.named ? `${lot.name}, ${roadName(lot.anchor)}` : `${address} (${lot.name.toLowerCase()})`,
        zonedist1: zone.z, commfar: zone.far, resfar: 0, bldgclass, landuse: cls === "land" ? "11" : cls === "office" ? "05" : "04",
        lotarea: sf(lotM2), bldgarea: cls === "land" ? 0 : sf(bldgM2), numfloors: cls === "land" ? 0 : nFloors,
        yearbuilt: cls === "land" ? 0 : lot.year, assessland, assesstot, unitsres: 0,
        cd: cfg.district, district: OUTSKIRTS, shorem: 9999, shoreamen: 0, corridorm: Math.round(lotNear(ringCentroid(outline))), corner: 0,
        lotfront: Math.round(front / FT), lotdepth: Math.round(depth / FT),
      },
    });
    for (const r of lot.rects) if (r.kind === "sign") houses3d.push({ bbl, r, year: lot.year, cls: "retail", deco: "sign", ...(r.v ? { rr: "pylon", rf: LL(sub(r.c, r.v)), rn: r.tenants ?? 1 } : {}) });   // the pylon sign, facing the road
    for (const r of bldgs) if (r.role && r.v) {
      if (!retailInfo.has(bbl)) retailInfo.set(bbl, []);
      retailInfo.get(bbl).push({ c: LL(r.c), rr: r.role, rf: LL(sub(r.c, mul(r.v, r.d / 2))), rs: r.sf ?? 0 });   // the storefront faces the car park (-v)
    }
    for (const r of bldgs) {
      rawBuildings.features.push({ type: "Feature", geometry: polyLL(rectRing(r.c, r.u, r.w, r.d)), properties: { base_bbl: bbl, heightroof: +((r.z / 100) / FT).toFixed(1), cnstrct_yr: lot.year } });
    }
    if (cls !== "land") {
      const a = sf(bldgM2), L = bldgclass[0];
      const office = L === "O" ? a / 230 : 0, industrial = L === "E" ? a / 550 : 0, retail = L === "K" ? a / 400 : 0;
      employment.features.push({ type: "Feature", geometry: { type: "Point", coordinates: LL(lot.anchor) }, properties: { jobs: Math.round(office + industrial + retail), office: Math.round(office), industrial: Math.round(industrial), retail: Math.round(retail) } });
    }
  }

  // ---------------- FARMS ARE LAND ON THE MARKET (Phase 2). A farm or woodlot tract is an ordinary parcel:
  // zoned for agriculture (no building envelope), priced at its farm-use value (engine value.ts
  // farmUsePsf), bought and sold like any lot, and — owned — entitled and platted into lots (engine
  // landdev.ts, the geometry from platTractLots below). The unbuilt remainder of a partly built
  // subdivision is a farm too, but not a whole tract, so it cannot be platted.
  const town0 = (k) => M.townMask[k] || M.townL[k];
  const outlineIn = (t, test) => {
    const [x0, y0, x1, y1] = t.r, mask = G.layer();
    let n = 0;
    const box = { i0: Math.max(0, Math.floor(x0 / CELL)), i1: Math.min(G.W - 1, Math.floor((x1 - 1) / CELL)), j0: Math.max(0, Math.floor(y0 / CELL)), j1: Math.min(G.W - 1, Math.floor((y1 - 1) / CELL)) };
    for (let y = box.j0; y <= box.j1; y++)
      for (let x = box.i0; x <= box.i1; x++) { const k = y * G.W + x; if (test(k)) { mask[k] = 1; n++; } }
    if (n < 4) return null;
    const ring = maskOutline(G, mask, box);
    if (!ring || ring.length < 3) return null;
    const simp = closedRdp(ring, CELL * 0.6);
    return simp.length >= 3 ? { ring: simp, m2: n * CELL * CELL } : null;
  };
  const edgeD = G.bfs((k) => !!M.townMask[k]);
  // The opening stamp of a farm's land price, $/sf: Illinois cropland $9,600/acre and woodland ~$1,470/acre
  // (2024; the cash rents over the 2.7% ratio, USDA NASS). Only the stamp: the price itself is the engine's
  // farmUsePsf every month, and the texture floor this stamp feeds is 30% of it, so it never sets one.
  const FARM_STAMP = { crop: 9600 / 43560, wood: (40 / (261 / 9600)) / 43560 };
  const farms = [];
  for (const t of M.tracts) {
    const rest = !!t.keep;
    const out = rest
      ? outlineIn(t, (k) => !M.phase[k] && !M.water[k] && !M.isSea(G.ctr(k)) && !town0(k) && !M.hwL[k] && !M.lotL[k])
      : outlineIn(t, (k) => !M.water[k] && !M.isSea(G.ctr(k)) && !town0(k) && !M.hwL[k] && !M.lotL[k]);
    if (!out || out.m2 < (rest ? 4 : 2) * ACRE) continue;
    const share = (test) => { let n = 0, f = 0; const [x0, y0, x1, y1] = t.r; for (let x = x0 + 10; x < x1; x += 40) for (let y = y0 + 10; y < y1; y += 40) { const k = G.idx([x, y]); if (k < 0 || M.water[k]) continue; n++; if (test(k)) f++; } return n ? f / n : 0; };
    const fp = share((k) => M.flood[k]), wood = t.wood || share((k) => M.forestL[k]) > 0.5;
    const buildM2 = buildableM2(M, t.r);
    const acres = out.m2 / ACRE, bbl = String(5e9 + t.id * 10 + (rest ? 1 : 0));
    const lotSf = sf(out.m2), stamp = wood ? FARM_STAMP.wood : FARM_STAMP.crop;
    const kc = G.idx(t.c);
    farms.push({
      bbl, t, out, rest, wood, acres, fp, buildM2,
      edgeM: Math.round(kc >= 0 && Number.isFinite(edgeD[kc]) ? edgeD[kc] : dist(t.c, M.centre)),
      address: `${wood ? "Woodlot" : "Farm"} tract ${t.id} (${Math.round(acres)} ac)`, stamp,
    });
    rawParcels.features.push({
      type: "Feature", id: Number(bbl), geometry: polyLL(out.ring),
      properties: {
        bbl, borough: "RG", block: String(t.id), lot: rest ? "1" : "0", address: `${wood ? "Woodlot" : "Farm"} tract ${t.id} (${Math.round(acres)} ac)`,
        zonedist1: "AG", commfar: 0, resfar: 0, bldgclass: "V1", landuse: "11", lotarea: lotSf, bldgarea: 0, numfloors: 0, yearbuilt: 0,
        assessland: Math.round(lotSf * stamp), assesstot: Math.round(lotSf * stamp), unitsres: 0,
        cd: cfg.district, district: OUTSKIRTS, shorem: 9999, shoreamen: 0, corridorm: Math.round(Math.max(0, lotNear(ringCentroid(out.ring)))), corner: 0,
      },
    });
  }

  // ---------------- the market's substrate: one buildCityData over every ordinary parcel
  const manifest0 = { ...town.manifest, seed, city: name, districts: { ...Object.assign({}, ...towns.map((t) => t.city.manifest.districts ?? {})), [OUTSKIRTS]: outskirtsName } };
  // PLAN 16: A COUNTY SEAT IS REACHED BY CAR (region/access.mjs). The demand
  // surface's accessibility points — an island's transit and second centre —
  // are this map's drive-time access instead: the households the map draws out
  // past the town (the same list regionRoadPlan hands the roads), the town's own
  // flats and jobs (build.mjs counts those from the lots), and the interchanges
  // open on day one. Plan-15 saves rebuild their own map without it.
  if (planV >= 16) {
    const homes = [];
    for (const t of M.tracts) if (t.keep && t.keep.size) homes.push({ p: LL(t.c), n: t.keep.size });
    for (const lot of M.outerLots) if (lot.tenure === "homes") homes.push({ p: LL(lot.anchor), n: lot.rects.filter((r) => r.kind === "house").length || 1 });
    const ixs = [];
    for (const h of M.highways) for (const x of h.ix ?? []) {
      if (x.sys) continue;
      const sg = h.segs.find((q) => x.s >= q.s0 - 1 && x.s <= q.s1 + 1);
      if (sg?.built) ixs.push(LL(x.p));
    }
    manifest0.carAccess = { homes, ixs };
  }
  // the greens, in the metres buildCityData measures in (its frame is centred on the parcels' mean vertex)
  let mx = 0, my = 0, mn = 0;
  for (const f of rawParcels.features) { const g = f.geometry; const ring = g.type === "MultiPolygon" ? g.coordinates[0][0] : g.coordinates[0]; for (const [x, y] of ring) { mx += x; my += y; mn++; } }
  const bproj = makeProjection(mx / mn, my / mn);
  const parks = towns.flatMap((t) => (t.city.parks ?? []).map((pk) => ({ ...pk, xy: bproj.toXY(proj.toLL(pk.xy)) })));
  const data = buildCityData({ rawParcels, rawBuildings, rawStations: { type: "FeatureCollection", features: [] }, manifest: manifest0, employment, parks });

  // the farms, as the market holds them: agricultural, no envelope, the tract they can be platted from
  for (const f of farms) {
    const p = data.parcels[f.bbl];
    if (!p) continue;
    Object.assign(p, {
      address: f.address, zoneDist: "AG", farMaxComm: 0, farMaxRes: 0, class: "land", bldgClass: "V1",
      landPsf: +f.stamp.toFixed(4), landPsfHistory: [+f.stamp.toFixed(4)],
      assessedLand: Math.round(p.lotArea * f.stamp), assessedTotal: Math.round(p.lotArea * f.stamp),
      ag: f.wood ? "wood" : "crop",
      ...(f.rest ? {} : { tract: { seed, r: f.t.r, id: f.t.id, bearing: f.t.recipe?.bearing ?? null, edgeM: f.edgeM } }),
      acres: +f.acres.toFixed(1), floodShare: +f.fp.toFixed(2), crop: f.wood ? null : ["row crop", "grain", "fallow"][f.t.crop % 3],
      // the land a plat can use: dry, off the floodplain, the freeway and anything already standing (rec.lotArea counts the floodplain)
      buildableSf: Math.round(f.buildM2 * SQFT_PER_M2),
    });
  }
  for (const ft of data.tileParcels.features) if (data.parcels[ft.properties.bbl]?.ag) ft.properties.ag = data.parcels[ft.properties.bbl].ag;
  for (const [b, k] of centreOf) if (data.parcels[b]) data.parcels[b].centre = k;

  // ---------------- the neighbourhoods: reserved parcels, with their numbers
  const SUFFIX = { prewar: ["Park", "Terrace", "Heights", "Place"], postwar: ["Village", "Gardens", "Manor", "Acres"], recent: ["Estates", "Meadows", "Reserve", "Crossing", "Ridge"] };
  const nbStats = [];
  for (const t of M.tracts) {
    if (!t.keep) continue;
    const built = [...t.keep].sort((a, b) => a - b).map((i) => t.plat.lots[i]);
    const bbl = `N${t.id}`;
    const nm = `${makeRng("nbname:" + seed + ":" + t.id).pick(NAME_A)}${["wood", "dale", "field", "brook", "view", "haven"][t.id % 6]} ${SUFFIX[t.era][t.id % SUFFIX[t.era].length]}`;
    const out = outlineIn(t, (k) => M.phase[k] && !M.water[k] && !town0(k) && !M.hwL[k] && !M.lotL[k]);
    if (!out) continue;
    let houseM2 = 0, lotM2 = 0;
    for (const lot of built) { houseM2 += lot.house.w * lot.house.d * lot.house.storeys; lotM2 += ringAreaAbs(lot.ring); }
    const homes = built.length;
    const [y0, y1] = ERA_YEARS[t.era];
    reserveRec({
      bbl, address: `${nm} (neighbourhood)`, tenure: "homes", class: "multifamily", zoneDist: "R1", district: OUTSKIRTS, districtName: outskirtsName,
      lotArea: sf(out.m2), bldgArea: sf(houseM2), floors: 2, yearBuilt: t.year, name: nm, kind: "neighbourhood",
      homes, era: t.era, eraYears: [y0, y1], avgHouseSf: Math.round(sf(houseM2) / homes), avgLotSf: Math.round(sf(lotM2) / homes),
      platLots: t.plat.lots.length, leapfrog: !!t.leapfrog,
      // THE RECIPE: platFor(recipe) redraws this plat lot for lot; `built` names the lots standing at the opening.
      // A later phase unpacks the neighbourhood into individual deeds from exactly these lots.
      recipe: { gen: PLAT_GEN, seed, tract: t.r, era: t.era, id: t.id, bearing: t.recipe.bearing ?? null, waterNear: t.recipe.waterNear, scale: t.recipe.scale, built: packBits(t.plat.lots.length, (i) => t.keep.has(i)) },
    }, out.ring, { homes });
    nbStats.push({ bbl, homes, era: t.era });
    for (const lot of built) houses3d.push({ bbl, house: true, year: t.year, cls: "multifamily", r: { c: lot.house.c, u: lot.house.u, w: lot.house.w, d: lot.house.d, z: lot.house.storeys === 2 ? 650 : 450 } });
  }

  // ---------------- the drawn region: ground, roads, trees, labels, houses
  const ctx = [];
  const ground = (kind, ringC) => { const r = clipBox(ringC, [0, 0, S, S]); if (r && r.length >= 3) ctx.push({ type: "Feature", geometry: polyLL(r), properties: { kind } }); };
  const line = (kind, plC, props = {}) => { if (plC.length >= 2) ctx.push({ type: "Feature", geometry: { type: "LineString", coordinates: plC.map(LL) }, properties: { kind, ...props } }); };
  // land: the whole window except the sea
  const coastY = M.coastY;
  if (coastY) ground("land", [[0, 0], [S, 0], [S, Math.min(S, coastY(S))], ...M.coast.line.filter((p) => p[0] > 0 && p[0] < S).reverse().map((p) => [p[0], Math.min(S, p[1])]), [0, Math.min(S, coastY(0))]]);
  else ground("land", [[0, 0], [S, 0], [S, S], [0, S]]);
  const dry = (ring) => coastY ? ring.map((p) => [p[0], Math.min(p[1], coastY(p[0]))]) : ring;
  // marsh: the floodplains
  const rs = M.river.pts;
  for (let i = 0; i < rs.length - 8; i += 8) ground("marsh", dry(hull(circle(rs[i], M.river.fp[i], 16).concat(circle(rs[i + 8], M.river.fp[i + 8], 16)))));
  for (const c of M.creeks) for (const cap of capsules(rdp(c.pts, 4), c.fp)) ground("marsh", dry(cap));
  if (M.coast) { const L = M.coast.line; ground("marsh", L.concat(L.slice().reverse().map((p) => [p[0], p[1] - M.coast.band]))); }
  // fields, woods and yards from the raster, so nothing lands on the water or in the town
  const openCell = (k) => !M.water[k] && !M.isSea(G.ctr(k)) && !M.flood[k] && !town0(k);
  for (const r of maskRects(G, [0, 0, S, S], (k) => M.forestL[k] === 1)) ground("woods", r);
  for (const t of M.tracts) {
    for (const r of maskRects(G, t.r, (k) => openCell(k) && !M.forestL[k] && !M.phase[k] && !M.lotL[k] && !M.hwL[k])) ground(t.era ? "farm" : t.wood ? "woods" : "farm", r);
    if (t.keep) for (const r of maskRects(G, t.r, (k) => openCell(k) && M.phase[k] && !M.hwL[k] && !M.lotL[k])) ground("yard", r);
  }
  // water: the river and the creeks (pavement drawn after, so the roads cross on bridges)
  for (let i = 0; i < rs.length - 2; i += 2) ground("stream", hull(circle(rs[i], M.river.half[i], 12).concat(circle(rs[i + 2], M.river.half[i + 2], 12))));
  for (const c of M.creeks) for (const cap of capsules(rdp(c.pts, 2), c.w / 2, 8)) ground("stream", cap);
  // roads: built roads only, as pavement capsules and carriageway centrelines
  const inTownC = (p) => { const k = G.idx(p); return k >= 0 && (M.townMask[k] || M.townL[k]); };
  const road = (pl, cls, wm) => {
    if (pl.length < 2) return;
    line("centerline", pl, { w: wm, mk: 0, cls });
    for (const cap of capsules(pl, wm / 2, 8)) ground("pavement", cap);
  };
  for (const h of M.highways) for (const s of h.segs) if (s.built) road(rdp(s.pts, 1), "highway", ROAD_W.highway);
  for (const r of M.oldRoads) for (const run of keepRuns(r, (p) => !inTownC(p), 10)) road(run, "arterial", ROAD_W.arterial);
  for (const r of M.secRoads) road(r, "arterial", ROAD_W.arterial);
  for (const rd of M.commerce?.roads ?? []) road(rd.pl, "local", rd.w);   // the industrial park's entrance and loop
  const okLocal = (p) => { const k = G.idx(p); return k >= 0 && M.free(p) && M.phase[k] === 1; };
  let streetTrees = 0;
  for (const t of M.tracts) if (t.keep) {
    for (const st of t.plat.streets) for (const run of keepRuns(st, okLocal, 8)) road(run, "local", ROAD_W.local);
    for (const b of t.plat.bulbs) if (okLocal(b)) ground("pavement", circle(b, t.plat.bulbR, 12));
    for (const p of t.plat.ponds) if (okLocal(p.c)) ground("pond", circle(p.c, p.r, 20));
  }
  for (const lot of M.outerLots) for (const r of lot.rects) {
    const ring = rectRing(r.c, r.u, r.w, r.d);
    if (r.kind === "pave") ground("pavement", ring);
    else if (r.kind === "lot") ground("apron", ring);   // a centre's car park: the surface parking layer
    else if (r.kind === "walk") ground("sidewalk", ring);
    else if (r.kind === "park") ground("park", ring);
    else if (r.kind === "lawn") ground("yard", ring);
  }
  // trees: one street tree per two houses, the woodlots and the forest belt on a jittered grid under a cap
  const trees = [];
  for (const t of M.tracts) if (t.keep) for (const i of t.keep) if (i % 2 === 0) { const lot = t.plat.lots[i]; const m = lot.front[0].map((v, j) => (v + lot.front[1][j]) / 2); trees.push(add(m, mul(norm(sub(lot.house.c, m)), 3))); streetTrees++; }
  const woodTr = M.tracts.filter((t) => !t.era && t.wood);
  const forestCells = M.forestL.reduce((a, v) => a + v, 0);
  const woodArea = woodTr.reduce((a, t) => a + (t.r[2] - t.r[0]) * (t.r[3] - t.r[1]), 0) + forestCells * CELL * CELL;
  const spacing = Math.max(14, Math.sqrt(woodArea / Math.max(1, TREE_CAP - trees.length)));
  const trng = makeRng("trees:" + seed);
  for (const t of woodTr) for (let x = t.r[0] + spacing / 2; x < t.r[2]; x += spacing) for (let y = t.r[1] + spacing / 2; y < t.r[3]; y += spacing) {
    const p = [x + (trng() - 0.5) * spacing * 0.8, y + (trng() - 0.5) * spacing * 0.8], k = G.idx(p);
    if (k < 0 || M.water[k] || M.isSea(p) || town0(k) || M.hwL[k] || M.phase[k] || M.lotL[k]) continue;
    trees.push(p);
  }
  for (let x = spacing / 2; x < S; x += spacing) for (let y = spacing / 2; y < S; y += spacing) {
    const p = [x + (trng() - 0.5) * spacing * 0.8, y + (trng() - 0.5) * spacing * 0.8], k = G.idx(p);
    if (k >= 0 && M.forestL[k]) trees.push(p);
  }
  for (const p of trees.slice(0, TREE_CAP)) ctx.push({ type: "Feature", geometry: { type: "Point", coordinates: LL(p) }, properties: { kind: "tree" } });
  // labels
  const label = (p, txt, labelKind) => ctx.push({ type: "Feature", geometry: { type: "Point", coordinates: LL(p) }, properties: { kind: "label", name: txt, labelKind } });
  label(M.centre, name.toUpperCase(), "town");
  for (const t of M.towns) label(t.c, t.name.toUpperCase(), "town");
  const rm = rs[Math.floor(rs.length * 0.3)];
  label(rm, M.river.name, "water");
  for (const t of M.tracts) if (t.keep && reserved[`N${t.id}`]) label(t.c, reserved[`N${t.id}`].name, "neighbourhood");

  // ---------------- the town's own drawing, trimmed to the mainland
  // The island generator draws a coast all round its plat — shallows, beaches, a seawall. Here only the
  // waterside of the town is a shore; the rest of its edge is the town giving way to fields. And where the
  // interstate's reservation runs through, its own carriageway markings go: the freeway is drawn above.
  const waterNearW = (q) => { const k = G.idx(F.toC(q)); return k >= 0 && M.story.waterD[k] <= 60; };
  const fwW = freewaysC.map(W);
  const onFreeway = (q) => fwW.some((pl) => distToLine(q, pl) < 20);
  const SHORE = new Set(["beach", "rock", "marsh", "seawall", "quay"]);
  // (the esplanade is the island's promenade all round its coast; on the mainland the town's edge is a verge)
  const DROP = new Set(["shallows", "coastline", "land", "rail", "station", "esplanade"]);
  const repPoint = (g) => {
    const c = g.type === "Point" ? [g.coordinates] : g.type === "LineString" ? g.coordinates : g.type === "Polygon" ? g.coordinates[0] : g.type === "MultiPolygon" ? g.coordinates[0][0] : null;
    if (!c || !c.length) return null;
    const m = c.reduce((a, p) => [a[0] + p[0] / c.length, a[1] + p[1] / c.length], [0, 0]);
    return proj.toXY(m);
  };
  for (const tw of towns) for (const f of tw.city.context.features) {
    const k = f.properties?.kind;
    if (DROP.has(k)) continue;
    if (SHORE.has(k)) { const q = repPoint(f.geometry); if (!q || !waterNearW(q)) continue; }
    if (k === "centerline" || k === "zebra" || k === "crosswalk" || k === "median" || k === "apron") { const q = repPoint(f.geometry); if (q && onFreeway(q)) continue; }
    ctx.push(f);
  }
  // THE TOWN'S LEFTOVER GROUND IS GRASS. The island generator paves everything inside its coast before it
  // lays a block (paveland), so a sliver no block took reads as street. At the mainland town's ragged edge
  // those leftovers are whole corners of ground nobody platted, and only real parking is paved (owner's rule):
  // what no street cell covers, thicker than a sliver, is drawn as grass over the paving.
  for (const tw of towns) for (const r of voidsOf(tw.city.context.features, tw.cfg.coast, proj.toXY)) ctx.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [[...r.map(LLw), LLw(r[0])]] }, properties: { kind: "park", void: 1 } });

  // ---------------- houses and the region's small buildings, as the 3D feed draws them
  const b3 = data.buildings3d;
  for (const h of houses3d) {
    const r = h.r, ring = rectRing(r.c, r.u, r.w, r.d).map(LL);
    b3.push({ b: h.bbl, c: h.cls, y: h.year, t: 0, f: Math.max(1, Math.round(r.z / 355)), z0: 0, z1: +(r.z / 100).toFixed(1), d: 1, ...(h.house ? { dk: "house" } : h.deco ? { dk: h.deco } : {}), ...(h.rr ? { rr: h.rr, rf: h.rf, rn: h.rn } : {}), x: 1, r: ring });
  }
  // each retail store's volume gets its role and storefront from the brief: the piece nearest it on its own deed
  for (const b of b3) {
    const info = !b.d && retailInfo.get(b.b);
    if (!info) continue;
    const c = b.r.reduce((a, p) => [a[0] + p[0] / b.r.length, a[1] + p[1] / b.r.length], [0, 0]);
    let best = null, bd = Infinity;
    for (const q of info) { const dd = (q.c[0] - c[0]) ** 2 + (q.c[1] - c[1]) ** 2; if (dd < bd) { bd = dd; best = q; } }
    if (best) { b.rr = best.rr; b.rf = best.rf; b.rs = best.rs; }
  }
  // the inner ring's houses draw as houses, not boxes; each stays its deed's building
  const houseLike = new Set([...housed].filter((b) => data.parcels[b]?.class === "multifamily"));
  for (const b of b3) if (!b.d && houseLike.has(b.b)) b.dk = "house";

  // ---------------- the city record
  const parcelFeatures = { type: "FeatureCollection", features: [...data.tileParcels.features, ...reservedFeatures] };
  const corners = [[0, 0], [S, 0], [S, S], [0, S]].map(LL);
  const lons = corners.map((p) => p[0]), lats = corners.map((p) => p[1]);
  const manifest = {
    ...data.manifest,
    bbox: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)],
    region: { km: S / 1000, centre: LL(M.centre), commerce: { county: M.commerce.county, townHouseholds: M.commerce.townHh, sites: M.commerce.placed.map((s) => ({ type: s.type, name: s.name, sf: s.sf, lotSf: s.lotSf, parcels: s.parcels })) }, river: M.river.name, coast: !!M.coast, rotation: F.k, towns: M.towns.map((t) => t.name), townAreaKm2: +(M.townArea / 1e6).toFixed(2) },
  };
  const reservedCount = { homes: 0, farm: 0, civic: 0 };
  for (const r of Object.values(reserved)) reservedCount[r.tenure]++;
  return {
    id: REGION, seed, size: "region", sizeK: 0, name,
    parcels: data.parcels, adjacency: data.adjacency, stations: [], manifest,
    parcelFeatures, buildingFeatures: data.tileBuildings,
    context: { type: "FeatureCollection", features: ctx },
    buildings3d: b3,
    reserved,
    groundLayers: REGION_GROUND_LAYERS,
    stats: {
      ...data.stats, blocks: towns.reduce((a, t) => a + (t.city.stats?.blocks ?? 0), 0), coverage: town.stats?.coverage?.pct ?? 0,
      reserved: reservedCount, neighbourhoods: nbStats.length, homes: nbStats.reduce((a, n) => a + n.homes, 0),
      townHouses: [...houseLike].length, streetTrees, trees: Math.min(TREE_CAP, trees.length),
    },
  };
}

// ---------------------------------------------------------------- platting a farm (Phase 2)
/** The ground inside a survey tract that a plat can use: dry, off the floodplain and the freeway, not the town, not built. */
function buildableM2(M, r) {
  const G = M.G; let n = 0;
  for (let y = Math.max(0, Math.floor(r[1] / CELL)); y <= Math.min(G.W - 1, Math.floor((r[3] - 1) / CELL)); y++)
    for (let x = Math.max(0, Math.floor(r[0] / CELL)); x <= Math.min(G.W - 1, Math.floor((r[2] - 1) / CELL)); x++) {
      const k = y * G.W + x;
      if (M.free(G.ctr(k)) && !M.lotL[k] && !M.phase[k]) n++;
    }
  return n * CELL * CELL;
}
const MODELS = new Map();
/** The region's land model for a seed (the river, the town, the outer lots), kept for platting. */
// the plan the seed's town was last cut under (makeRegion), so a farm is platted on the same land the game drew
const SEED_PLAN = new Map();
function regionModel(seed) {
  const planV = SEED_PLAN.get(seed >>> 0) ?? 17, key = `${seed}:${planV}`;
  let M = MODELS.get(key);
  if (!M) {
    M = generateLand(seed, planV); storyPrep(M); townFootprint(M); placeOuter(M);
    if (MODELS.size > 2) MODELS.clear();
    MODELS.set(key, M);
  }
  return M;
}

/**
 * THE LAND DEVELOPER'S PLAT: a farm tract (a market parcel's `tract`) cut into a grid of lots of about
 * `lotSf`, with its local streets, kept off the water, the floodplain, the freeway and anything already
 * standing. Deterministic from (tract, lotSf): the engine stores each lot's area and frontage (landdev.ts
 * startPlat) and the page redraws the same lots from this on every load.
 * Returns lots in plat order (lot n is the engine's nth lot): ring (lon/lat), a (sf), f and d (ft); and
 * the streets as lon/lat polylines.
 */
export function platTractLots(tract, lotSf) {
  const seed = tract.seed >>> 0, M = regionModel(seed), G = M.G;
  const F = makeFrame(seed, M.S), proj = makeProjection(LONLAT[0], LONLAT[1]);
  const LL = (p) => { const q = proj.toLL(F.toW(p)); return [+q[0].toFixed(7), +q[1].toFixed(7)]; };
  const ok = (p) => { const k = G.idx(p); return k >= 0 && M.free(p) && !M.lotL[k] && !M.phase[k]; };
  // a side with a road along it gives up half the road's 66 ft right-of-way and a 1 m verge; a side on a field gives up nothing
  const [x0, y0, x1, y1] = tract.r, roads = M.oldRoads.concat(M.secRoads);
  const onRoad = (a, b) => [0.2, 0.5, 0.8].some((t) => roads.some((pl) => distToLine([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], pl) < 25));
  const side = (a, b) => (onRoad(a, b) ? 66 * FT / 2 + 1 : 1);
  const insets = [side([x0, y0], [x0, y1]), side([x0, y0], [x1, y0]), side([x1, y0], [x1, y1]), side([x0, y1], [x1, y1])];
  // an acre and up is an industrial park's lot (landdev.ts INDUSTRIAL_LOT_SIZES): spine roads, deep lots
  const plat = platFor({ seed, tract: tract.r, era: lotSf >= 43_560 ? "industrial" : "grid", id: tract.id, bearing: tract.bearing ?? undefined, lotSf, insets }, ok);
  const lots = plat.lots.map((l) => {
    const a = ringAreaAbs(l.ring) * SQFT_PER_M2, f = dist(l.front[0], l.front[1]) / FT;
    return { ring: l.ring.map(LL), a: Math.round(a), f: Math.round(f), d: Math.round(a / Math.max(1, f)) };
  });
  const streets = plat.streets.map((s) => s.map(LL));
  return { lots, streets, buildableSf: Math.round(buildableM2(M, tract.r) * SQFT_PER_M2) };
}

/**
 * A NEIGHBOURHOOD, UNPACKED (Phase 4). The reserved neighbourhood `N<id>` redrawn from its own recipe
 * (the plat outer.mjs drew, which the record's `recipe` regenerates through platFor): every lot that has
 * a house on it at the opening, in plat order, with its ring (lon/lat), area (sf), frontage and depth
 * (ft), and the house (floor area sf, storeys). Deterministic from (seed, id); null if no such
 * neighbourhood.
 */
export function neighbourhoodLots(seed, id) {
  seed = seed >>> 0;
  const M = regionModel(seed);
  const t = M.tracts.find((x) => x.id === id && x.keep && x.keep.size);
  if (!t) return null;
  const F = makeFrame(seed, M.S), proj = makeProjection(LONLAT[0], LONLAT[1]);
  const LL = (p) => { const q = proj.toLL(F.toW(p)); return [+q[0].toFixed(7), +q[1].toFixed(7)]; };
  const lots = [...t.keep].sort((a, b) => a - b).map((i) => {
    const l = t.plat.lots[i];
    const a = ringAreaAbs(l.ring) * SQFT_PER_M2, f = dist(l.front[0], l.front[1]) / FT;
    return { i, ring: l.ring.map(LL), a: Math.round(a), f: Math.round(f), d: Math.round(a / Math.max(1, f)), houseSf: Math.round(l.house.w * l.house.d * l.house.storeys * SQFT_PER_M2), storeys: l.house.storeys, c: LL(l.house.c) };
  });
  return { id, era: t.era, year: t.year, lots };
}

// ---------------------------------------------------------------- the road network as a plan (Phase 4)
/**
 * The calendar the master plan's years are written in (land.mjs SZ.plannedYears, 2029-46: "10-20 years
 * from study to ribbon-cutting" read from a 2026 desk). The engine reads a segment's year as years after
 * the opening: year - PLAN_YEAR0.
 */
export const PLAN_YEAR0 = 2026;
const PLANS = new Map();
/**
 * THE REGION'S ROADS AS THE ENGINE SEES THEM (growth simulation, Phase 4): every highway segment, built
 * or proposed, with its planned year; the interchanges, each with its distance to the town's edge; and
 * the arterials cut into county road pieces (the old roads, outside the town, about a kilometre each)
 * and section-line roads (a mile each, as the survey laid them). Lon/lat polylines and lengths in metres.
 * Deterministic from the seed and cached: the engine holds only ids, and draws from this.
 */
export function regionRoadPlan(seed) {
  seed = seed >>> 0;
  let P = PLANS.get(seed);
  if (P) return P;
  const M = regionModel(seed), G = M.G;
  const F = makeFrame(seed, M.S), proj = makeProjection(LONLAT[0], LONLAT[1]);
  const LL = (p) => { const q = proj.toLL(F.toW(p)); return [+q[0].toFixed(7), +q[1].toFixed(7)]; };
  const edgeD = (M.edgeD ??= G.bfs((k) => !!M.townMask[k]));
  const edgeAt = (p) => { const k = G.idx(p); return k >= 0 && Number.isFinite(edgeD[k]) ? Math.round(edgeD[k]) : Math.round(dist(p, M.centre)); };
  const inTownC = (p) => { const k = G.idx(p); return k >= 0 && (M.townMask[k] || M.townL[k]); };
  const len = (pl) => cumLen(pl).at(-1);
  const highways = M.highways.map((h) => ({
    id: h.id, kind: h.kind,
    segs: h.segs.map((sg, i) => ({ id: `${h.id}.${i}`, built: !!sg.built, year: sg.year, lenM: Math.round(len(sg.pts)), pts: rdp(sg.pts, 2).map(LL), mid: LL(pointAt(sg.pts, len(sg.pts) / 2)), edgeM: edgeAt(pointAt(sg.pts, len(sg.pts) / 2)) })),
    ix: (h.ix ?? []).filter((x) => !x.sys).map((x, j) => {
      const seg = h.segs.findIndex((sg) => x.s >= sg.s0 - 1 && x.s <= sg.s1 + 1);
      return { id: `${h.id}.x${j}`, seg: seg >= 0 ? `${h.id}.${seg}` : null, p: LL(x.p), edgeM: edgeAt(x.p) };
    }),
  }));
  const arterials = [];
  M.oldRoads.forEach((r, i) => {
    let n = 0;
    for (const run of keepRuns(r, (p) => !inTownC(p), 10)) {
      const L = len(run), k = Math.max(1, Math.round(L / 1000));
      for (let q = 0; q < k; q++) {
        const pl = slicePl(run, (L * q) / k, (L * (q + 1)) / k);
        if (pl.length < 2) continue;
        arterials.push({ id: `A${i}.${n++}`, kind: "county", lenM: Math.round(len(pl)), pts: pl.map(LL), mid: LL(pointAt(pl, len(pl) / 2)), edgeM: edgeAt(pointAt(pl, len(pl) / 2)) });
      }
    }
  });
  M.secRoads.forEach((r, i) => {
    const L = len(r), k = Math.max(1, Math.round(L / 1609));
    for (let q = 0; q < k; q++) {
      const pl = slicePl(r, (L * q) / k, (L * (q + 1)) / k);
      arterials.push({ id: `S${i}.${q}`, kind: "section", lenM: Math.round(len(pl)), pts: pl.map(LL), mid: LL(pointAt(pl, len(pl) / 2)), edgeM: edgeAt(pointAt(pl, len(pl) / 2)) });
    }
  });
  // the households out past the town at the opening: each neighbourhood's houses, and the rural homes
  const homes = [];
  for (const t of M.tracts) if (t.keep && t.keep.size) homes.push({ p: LL(t.c), n: t.keep.size, edgeM: edgeAt(t.c), id: `N${t.id}` });
  for (const lot of M.outerLots) if (lot.tenure === "homes") homes.push({ p: LL(lot.anchor), n: lot.rects.filter((r) => r.kind === "house").length || 1, edgeM: edgeAt(lot.anchor) });
  P = { seed, year0: PLAN_YEAR0, widths: ROAD_W, highways, arterials, homes, centre: LL(M.centre) };
  if (PLANS.size > 2) PLANS.clear();
  PLANS.set(seed, P);
  return P;
}

/**
 * Ground inside a town's outline that no street cell, block, park or water covers, opened by 10 m so the
 * slivers between cells (which do read as street) stay paved; returned as rectangles in world metres.
 */
function voidsOf(features, ring, toXY) {
  const R = 5, xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), nx = Math.ceil((Math.max(...xs) - x0) / R) + 1, ny = Math.ceil((Math.max(...ys) - y0) / R) + 1;
  const cov = new Uint8Array(nx * ny), ins = new Uint8Array(nx * ny);
  const paint = (L, poly) => {
    const px = poly.map((p) => p[0]), py = poly.map((p) => p[1]);
    const i0 = Math.max(0, Math.floor((Math.min(...px) - x0) / R)), i1 = Math.min(nx - 1, Math.ceil((Math.max(...px) - x0) / R));
    const j0 = Math.max(0, Math.floor((Math.min(...py) - y0) / R)), j1 = Math.min(ny - 1, Math.ceil((Math.max(...py) - y0) / R));
    // a scanline fill: each row's edge crossings, the same even-odd rule and
    // the same arithmetic as pointInRing at the cell centres, so the same cells
    const xc = [];
    for (let j = j0; j <= j1; j++) {
      const py = y0 + (j + 0.5) * R;
      xc.length = 0;
      for (let a = 0, c = poly.length - 1; a < poly.length; c = a++) {
        const xi = poly[a][0], yi = poly[a][1], xj = poly[c][0], yj = poly[c][1];
        if ((yi > py) !== (yj > py)) xc.push(((xj - xi) * (py - yi)) / (yj - yi) + xi);
      }
      if (!xc.length) continue;
      xc.sort((u, v) => u - v);
      // a centre px is inside when an odd number of crossings lie strictly beyond it
      let c = 0;
      for (let i = i0; i <= i1; i++) {
        const px = x0 + (i + 0.5) * R;
        while (c < xc.length && xc[c] <= px) c++;
        if ((xc.length - c) & 1) L[j * nx + i] = 1;
      }
    }
  };
  paint(ins, ring);
  const COVER = new Set(["pavement", "block", "park", "pond", "stream", "apron", "median", "sidewalk"]);
  for (const f of features) {
    if (!COVER.has(f.properties?.kind)) continue;
    const g = f.geometry, polys = g.type === "Polygon" ? [g.coordinates[0]] : g.type === "MultiPolygon" ? g.coordinates.map((p) => p[0]) : [];
    for (const p of polys) paint(cov, p.map(toXY));
  }
  // inside the outline, not covered
  const N = nx * ny, at = (i, j) => (i < 0 || j < 0 || i >= nx || j >= ny ? 0 : 1);
  const erode = (L, n) => { let cur = L; for (let s = 0; s < n; s++) { const nxt = new Uint8Array(N); for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i; nxt[k] = cur[k] && at(i - 1, j) && cur[k - 1] && at(i + 1, j) && cur[k + 1] && at(i, j - 1) && cur[k - nx] && at(i, j + 1) && cur[k + nx] ? 1 : 0; } cur = nxt; } return cur; };
  const dilate = (L, n) => { let cur = L; for (let s = 0; s < n; s++) { const nxt = new Uint8Array(cur); for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i; if (!cur[k]) continue; if (i > 0) nxt[k - 1] = 1; if (i < nx - 1) nxt[k + 1] = 1; if (j > 0) nxt[k - nx] = 1; if (j < ny - 1) nxt[k + nx] = 1; } cur = nxt; } return cur; };
  const deep = erode(ins, 1);
  const raw = new Uint8Array(N); for (let k = 0; k < N; k++) raw[k] = deep[k] && !cov[k] ? 1 : 0;
  const opened = dilate(erode(raw, 2), 2);
  const rects = [];
  let open = new Map();
  for (let j = 0; j < ny; j++) {
    const runs = []; let s = -1;
    for (let i = 0; i <= nx; i++) { const good = i < nx && opened[j * nx + i] && raw[j * nx + i]; if (good && s < 0) s = i; if (!good && s >= 0) { runs.push([s, i - 1]); s = -1; } }
    const next = new Map();
    for (const [a, b] of runs) { const key = a + ":" + b; const r = open.get(key); if (r) { r.j1 = j; open.delete(key); next.set(key, r); } else next.set(key, { a, b, j0: j, j1: j }); }
    for (const r of open.values()) rects.push(r); open = next;
  }
  for (const r of open.values()) rects.push(r);
  return rects.map((r) => [[x0 + r.a * R, y0 + r.j0 * R], [x0 + (r.b + 1) * R, y0 + r.j0 * R], [x0 + (r.b + 1) * R, y0 + (r.j1 + 1) * R], [x0 + r.a * R, y0 + (r.j1 + 1) * R]]);
}

// ---------------------------------------------------------------- geometry helpers
function closedRdp(r, eps) {
  let far = 0; for (let i = 1; i < r.length; i++) if (dist(r[i], r[0]) > dist(r[far], r[0])) far = i;
  const a = rdp(r.slice(0, far + 1), eps), b = rdp(r.slice(far).concat([r[0]]), eps);
  return a.slice(0, -1).concat(b.slice(0, -1));
}
/** Split a polyline where ok() fails, sampling every `step` m. */
function keepRuns(pl, ok, step = 10) {
  const runs = []; let cur = [];
  for (const p of resample(pl, step)) { if (ok(p)) cur.push(p); else { if (cur.length > 1) runs.push(cur); cur = []; } }
  if (cur.length > 1) runs.push(cur);
  return runs.map((r) => rdp(r, 0.8));
}
/** Sutherland-Hodgman against an axis-aligned box. */
function clipBox(ring, [x0, y0, x1, y1]) {
  let out = ring;
  const edges = [[(p) => p[0] >= x0, (a, b) => [x0, a[1] + (b[1] - a[1]) * (x0 - a[0]) / (b[0] - a[0])]], [(p) => p[0] <= x1, (a, b) => [x1, a[1] + (b[1] - a[1]) * (x1 - a[0]) / (b[0] - a[0])]],
    [(p) => p[1] >= y0, (a, b) => [a[0] + (b[0] - a[0]) * (y0 - a[1]) / (b[1] - a[1]), y0]], [(p) => p[1] <= y1, (a, b) => [a[0] + (b[0] - a[0]) * (y1 - a[1]) / (b[1] - a[1]), y1]]];
  for (const [inside, cut] of edges) {
    const inp = out; out = [];
    for (let i = 0; i < inp.length; i++) {
      const a = inp[i], b = inp[(i + 1) % inp.length];
      if (inside(b)) { if (!inside(a)) out.push(cut(a, b)); out.push(b); } else if (inside(a)) out.push(cut(a, b));
    }
    if (!out.length) return null;
  }
  return out.length >= 3 ? out : null;
}
/** A raster mask inside a rectangle as row-run rectangles, merged down the rows. */
function maskRects(G, [x0, y0, x1, y1], ok) {
  const C = CELL, i0 = Math.max(0, Math.floor(x0 / C)), i1 = Math.min(G.W - 1, Math.ceil(x1 / C) - 1);
  const j0 = Math.max(0, Math.floor(y0 / C)), j1 = Math.min(G.W - 1, Math.ceil(y1 / C) - 1);
  const out = []; let open = new Map();
  for (let j = j0; j <= j1; j++) {
    const runs = []; let s = -1;
    for (let i = i0; i <= i1 + 1; i++) { const good = i <= i1 && ok(j * G.W + i); if (good && s < 0) s = i; if (!good && s >= 0) { runs.push([s, i - 1]); s = -1; } }
    const next = new Map();
    for (const [a, b] of runs) { const key = a + ":" + b; const r = open.get(key); if (r) { r.j1 = j; open.delete(key); next.set(key, r); } else next.set(key, { a, b, j0: j, j1: j }); }
    for (const r of open.values()) out.push(r); open = next;
  }
  for (const r of open.values()) out.push(r);
  return out.map((r) => { const xa = Math.max(x0, r.a * C), xb = Math.min(x1, (r.b + 1) * C), ya = Math.max(y0, r.j0 * C), yb = Math.min(y1, (r.j1 + 1) * C); return [[xa, ya], [xb, ya], [xb, yb], [xa, yb]]; });
}
export { SZ, ROAD_W, pointInRing, cumLen, pointAt, perp };

// ---------------------------------------------------------------- the designed plat (the subdivision design desk)
/**
 * WHAT THE DESIGN DESK DRAWS ON: a farm tract's ground, read once per tract and kept — its outline
 * (the parcel as the land market holds it), the floodplain inside it (hatched; no lot stands in it),
 * the buildable acres, the floodplain's dry edge (where a greenway trail runs), the distance from any
 * point to the floodplain or the creek, the default detention site (the dry ground nearest the water,
 * which the storm sewer runs downhill to), and which way north points in the canonical frame.
 */
const DESIGN_ENV = new Map();
function designEnv(tract) {
  const key = `${tract.seed >>> 0}:${tract.id}`;
  let E = DESIGN_ENV.get(key);
  if (E) return E;
  const seed = tract.seed >>> 0, M = regionModel(seed), G = M.G;
  const town0 = (k) => M.townMask[k] || M.townL[k];
  const [x0, y0, x1, y1] = tract.r;
  const box = { i0: Math.max(0, Math.floor(x0 / CELL)), i1: Math.min(G.W - 1, Math.floor((x1 - 1) / CELL)), j0: Math.max(0, Math.floor(y0 / CELL)), j1: Math.min(G.W - 1, Math.floor((y1 - 1) / CELL)) };
  const land = G.layer(), wet = G.layer();
  let nLand = 0, nFlood = 0;
  for (let y = box.j0; y <= box.j1; y++) for (let x = box.i0; x <= box.i1; x++) {
    const k = y * G.W + x;
    if (M.water[k] || M.isSea(G.ctr(k)) || town0(k) || M.hwL[k] || M.lotL[k]) continue;
    land[k] = 1; nLand++;
    if (M.flood[k]) { wet[k] = 1; nFlood++; }
  }
  const ring = maskOutline(G, land, box);
  const outline = ring && ring.length >= 3 ? closedRdp(ring, CELL * 0.6) : [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const flood = maskRects(G, tract.r, (k) => !!wet[k]);
  const dWet = G.bfs((k) => !!M.flood[k] || !!M.water[k]);
  const floodDist = (p) => { const k = G.idx(p); return k < 0 ? Infinity : Math.max(0, dWet[k] - CELL / 2); };
  // the trail: the floodplain's outline inside the tract, where it meets dry ground
  const trail = [];
  if (nFlood >= 3) {
    const fr = maskOutline(G, wet, box);
    if (fr && fr.length > 3) {
      const pts = closedRdp(fr, CELL * 0.5);
      let cur = [];
      const inside = (p) => p[0] > x0 + CELL && p[0] < x1 - CELL && p[1] > y0 + CELL && p[1] < y1 - CELL;
      for (let i = 0; i <= pts.length; i++) {
        const p = pts[i % pts.length];
        if (inside(p)) cur.push(p); else { if (cur.length > 1) trail.push(cur); cur = []; }
      }
      if (cur.length > 1) trail.push(cur);
    }
  }
  let pondAt = null, best = Infinity;
  for (let y = box.j0; y <= box.j1; y++) for (let x = box.i0; x <= box.i1; x++) {
    const k = y * G.W + x;
    if (!land[k] || wet[k] || M.phase[k]) continue;
    if (dWet[k] < best) { best = dWet[k]; pondAt = G.ctr(k); }
  }
  // north: the canonical direction that maps to world +y
  const F = makeFrame(seed, M.S), w0 = F.toW([0, 0]), wx = sub(F.toW([1, 0]), w0), wy = sub(F.toW([0, 1]), w0);
  const det = wx[0] * wy[1] - wx[1] * wy[0];
  const north = norm([-wy[0] / det, wx[0] / det]);
  const ok = (p) => { const k = G.idx(p); return k >= 0 && M.free(p) && !M.lotL[k] && !M.phase[k]; };
  const street = (p) => { const k = G.idx(p); return k >= 0 && !M.water[k] && !M.isSea(p) && !town0(k) && !M.hwL[k] && !M.lotL[k] && !M.phase[k]; };
  // a side with a road along it gives up half the road's 66 ft right-of-way and a 1 m verge (as platTractLots)
  const roads = M.oldRoads.concat(M.secRoads);
  const onRoad = (a, b) => [0.2, 0.5, 0.8].some((t) => roads.some((pl) => distToLine([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], pl) < 25));
  const side = (a, b) => (onRoad(a, b) ? 66 * FT / 2 + 1 : 1);
  const insets = [side([x0, y0], [x0, y1]), side([x0, y0], [x1, y0]), side([x1, y0], [x1, y1]), side([x0, y1], [x1, y1])];
  const cellSf = CELL * CELL * SQFT_PER_M2;
  E = {
    r: tract.r, id: tract.id, seed, bearing: null, insets, ok, street, floodDist, trail, pondAt: pondAt ?? [(x0 + x1) / 2, (y0 + y1) / 2],
    outline, flood, north,
    grossSf: Math.round(nLand * cellSf), floodSf: Math.round(nFlood * cellSf), buildableSf: Math.round((nLand - nFlood) * cellSf),
  };
  if (DESIGN_ENV.size > 40) DESIGN_ENV.clear();
  DESIGN_ENV.set(key, E);
  return E;
}

/**
 * A FARM TRACT AS THE PLAYER DESIGNED IT (platdesign.mjs designPlat), in canonical metres for the
 * desk's drawing: the plat and the ground under it. `design.pondSf` and each amenity's `sf` are the
 * engine's land takes (engine/platdesign.ts designRecipe resolves them). Deterministic from
 * (tract, design).
 */
export function platTractDesign(tract, design) {
  const E = designEnv(tract);
  const geo = designPlat(design, { ...E, pondSf: design.pondSf ?? 0 });
  return { ...geo, ground: { outline: E.outline, flood: E.flood, trail: E.trail, north: E.north, r: E.r, grossSf: E.grossSf, floodSf: E.floodSf, buildableSf: E.buildableSf, pondAt: E.pondAt } };
}

/**
 * THE SAME PLAT FOR THE MAP AND UNREAL, in lon/lat: lots in engine order (ring, a, f, d, near), the
 * streets, and what the amenities put on the ground — park and open-space land (HOA parcels), the
 * pond, the trail, trees in the parks, and the clubhouse as a small volume.
 */
export function platDesignLL(tract, design) {
  const geo = platTractDesign(tract, design);
  const seed = tract.seed >>> 0, M = regionModel(seed);
  const F = makeFrame(seed, M.S), proj = makeProjection(LONLAT[0], LONLAT[1]);
  const LL = (p) => { const q = proj.toLL(F.toW(p)); return [+q[0].toFixed(7), +q[1].toFixed(7)]; };
  const B = geo.base;
  const rng = makeRng(`plat-design-trees:${tract.id}:${seed}`);
  const trees = [], parks = [], volumes = [];
  geo.amen.forEach((a, k) => {
    for (const i of a.lots) {
      parks.push({ k: a.k, amen: k, ring: B[i].ring.map(LL) });
      if (a.k === "pocket" || a.k === "park" || a.k === "entry" || a.k === "playground") {
        const c = B[i].c, n = a.k === "park" ? 4 : 2;
        for (let t = 0; t < n; t++) trees.push(LL(add(c, [rng.range(-9, 9), rng.range(-9, 9)])));
      }
    }
    if (a.k === "pool" && a.lots.length) {
      const c = B[a.lots[0]].c;
      const sq = (cc, w, d) => [[cc[0] - w / 2, cc[1] - d / 2], [cc[0] + w / 2, cc[1] - d / 2], [cc[0] + w / 2, cc[1] + d / 2], [cc[0] - w / 2, cc[1] + d / 2]];
      volumes.push({ amen: k, ring: sq(c, 20, 16).map(LL), h: 6 });     // a one-storey clubhouse of ~3,500 sf
    }
    if (a.k === "greenway") for (const t of a.trail) for (let s = 0; s < cumLen(t).at(-1); s += 25) trees.push(LL(pointAt(t, s)));
  });
  for (const i of geo.open) parks.push({ k: "open", amen: -1, ring: B[i].ring.map(LL) });
  for (const i of geo.pond.lots) parks.push({ k: "pond", amen: -1, ring: B[i].ring.map(LL) });
  const pondRing = [];
  if (geo.pond.lots.length) for (let t = 0; t < 24; t++) pondRing.push(LL(add(geo.pond.c, [geo.pond.r * Math.cos((t / 24) * 2 * Math.PI), geo.pond.r * Math.sin((t / 24) * 2 * Math.PI)])));
  return {
    lots: geo.lots.map((l) => ({ ring: l.ring.map(LL), a: l.a, f: Math.round(l.w), d: Math.round(l.d), near: l.near })),
    streets: geo.streets.map((s) => s.pl.map(LL)),
    bulbs: geo.bulbs.map((b) => { const r = []; for (let t = 0; t < 16; t++) r.push(LL(add(b.c, [b.r * Math.cos((t / 16) * 2 * Math.PI), b.r * Math.sin((t / 16) * 2 * Math.PI)]))); return r; }),
    parks, pond: pondRing, trails: geo.amen.filter((a) => a.k === "greenway").flatMap((a) => a.trail.map((t) => t.map(LL))), trees, volumes,
  };
}
