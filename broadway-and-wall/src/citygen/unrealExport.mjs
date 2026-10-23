// A generated city as the Unreal build reads it ("bw-city/1").
//
// Shared by the command-line exporter (unreal/tools/export-city.mjs) and the
// web app when it runs inside Unreal (state/unrealHost.ts), so both hand the
// renderer the same city. Units and axes (UE58_PLAN.md Phase 1): centimetres,
// origin at the centre of the city's bounding box, +X north, +Y east — Unreal's
// left-handed frame with north forward. Coordinates go back through the
// generator's own projection (geom.mjs), so a metre here is the generator's
// metre. Rings are flat [x0,y0,x1,y1,...] integer arrays, unclosed.
import { makeProjection } from "./geom.mjs";

/** Ground layers, in draw order (later on top). The aprons (a park's frontage
 * road, a boulevard's carriageways) lie over the base paving, which shows only
 * where nothing else is drawn. A sidewalk is a ring around its
 * block (the block is its hole); rings go out unholed, so the block surface is drawn
 * after it to fill the hole back in. */
export const GROUND_LAYERS = ["land", "beach", "marsh", "rock", "esplanade", "paveland", "apron", "pavement", "median", "sidewalk", "block", "park", "pond", "stream"];

// the web renderer's own hashes (map/real/RealCity.ts hash01, keyOf), so a
// building draws the same family here as on the browser map
function hash01(n, seed) {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(seed + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
function keyOf(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** opts.familyFor / opts.tints: the web renderer's facade picker (map/real/facades.ts). With
 * them each volume carries the family ("fam") and wall tint ("tint", RGB) the browser map
 * gives it; the renderer maps a family to the facade kit nearest it. */
export function toBwCity(c, opts = {}) {
  const [w, s, e, n] = c.manifest.bbox;
  const lon0 = (w + e) / 2, lat0 = (s + n) / 2;
  const proj = makeProjection(lon0, lat0);
  // lon/lat -> [X north, Y east] in cm
  const ue = (ll) => { const [x, y] = proj.toXY(ll); return [Math.round(y * 100), Math.round(x * 100)]; };
  const ring = (coords) => {
    const pts = coords.length > 1 && coords[0][0] === coords.at(-1)[0] && coords[0][1] === coords.at(-1)[1] ? coords.slice(0, -1) : coords;
    return pts.flatMap(ue);
  };

  // parcels: the static half of the render contract
  const parcelRing = new Map();
  for (const f of c.parcelFeatures.features) if (f.geometry.type === "Polygon") parcelRing.set(String(f.properties.bbl), ring(f.geometry.coordinates[0]));
  const parcels = Object.values(c.parcels).map((p) => ({
    bbl: p.bbl, address: p.address, block: p.block, district: p.district, districtName: p.districtName,
    zone: p.zoneDist, cls: p.class, floors: p.floors, yearBuilt: p.yearBuilt, lotArea: p.lotArea, bldgArea: p.bldgArea,
    ring: parcelRing.get(p.bbl) ?? [],
  }));
  // THE REGION'S RESERVED LAND: neighbourhoods ("N…"), farm tracts ("F…"), rural homes ("H…") and the parish
  // ("C…") are parcels the renderer draws and the player can click, though no market holds them in Phase 1
  for (const p of Object.values(c.reserved ?? {})) parcels.push({
    bbl: p.bbl, address: p.address, block: 0, district: p.district, districtName: p.districtName,
    zone: p.zoneDist, cls: p.class, floors: p.floors, yearBuilt: p.yearBuilt, lotArea: p.lotArea, bldgArea: p.bldgArea,
    tenure: p.tenure, ...(p.homes ? { houses: p.homes } : {}),
    ring: parcelRing.get(p.bbl) ?? [],
  });

  // volumes: one extruded prism per building tier (the web map's own feed). A house (the region's
  // neighbourhoods, and the small houses of a town's residential additions, which stay their deed's
  // building) goes as deco "house": one instanced house sized to its ring.
  const volumes = c.buildings3d.map((b) => ({
    bbl: b.b || "", cls: b.c, year: b.y, z0: Math.round(b.z0 * 100), z1: Math.round(b.z1 * 100),
    deco: b.d ? (b.dk ?? "deco") : b.dk === "house" ? "house" : "", crown: !!b.x, vacant: !!b.k, ring: b.r.flatMap(ue),
    // a region store (RetailBuilder): its role (grocery, box, dept, mall, inline, qsr, bank, gas, restaurant,
    // truckstop, general; "pylon" for a centre's sign; industrial bulk, flex, manufacturing), its front's middle (storefront or docks), its floor area or a sign's panels
    ...(b.rr ? { role: b.rr, front: ue(b.rf), ...(b.rs ? { sf: b.rs } : {}), ...(b.rn ? { panels: b.rn } : {}) } : {}),
  }));
  if (opts.familyFor && opts.tints) {
    // as RealCity draws a volume: the family by the building's full height (its
    // tallest tier), its own roll, its district's tone and its neighbourhood
    const core = Array.isArray(c.manifest.core) ? c.manifest.core : [lon0, lat0];
    const kx = 111320 * Math.cos((core[1] * Math.PI) / 180);
    const top = new Map();
    for (const b of c.buildings3d) if (b.b) top.set(b.b, Math.max(top.get(b.b) ?? 0, b.z1));
    const seed = (c.seed ?? 1) >>> 0;
    c.buildings3d.forEach((b, i) => {
      if (b.k || b.d || b.r.length < 3) return;
      let cx = 0, cy = 0;
      for (const [lon, lat] of b.r) { cx += ((lon - core[0]) * kx) / b.r.length; cy += ((lat - core[1]) * 111320) / b.r.length; }
      const nb = hash01((Math.floor(cx / 380) * 7919) ^ (Math.floor(cy / 380) * 104729) ^ 0x6e62, seed);
      const k = keyOf(b.b || `${b.r[0][0]},${b.r[0][1]}`);
      const fam = opts.familyFor(b.c, b.y || 1950, top.get(b.b) ?? b.z1, hash01(k ^ 0x3c1f, seed), b.t ?? 4, nb);
      const tints = opts.tints[fam] ?? [[1, 1, 1]];
      const tr = hash01(k, seed);
      const t = tints[tr < 0.55 ? ((b.t ?? 0) * 3 + 1) % tints.length : Math.floor(((tr - 0.55) / 0.45) * tints.length)];
      volumes[i].fam = fam;
      volumes[i].tint = t.map((x) => +x.toFixed(3));
    });
  }

  // a region carries its own layer order: open land (farm, woods, yard) under the town, and its roads over
  // its rivers (bridges) — region/index.mjs REGION_GROUND_LAYERS
  const ground = Object.fromEntries((c.groundLayers ?? GROUND_LAYERS).map((k) => [k, []]));
  const water = [], trees = [], labels = [];
  // street markings: centrelines carry the carriageway width (w, metres) the
  // renderer divides into lanes; zebra bars and crosswalk outlines come as drawn
  const markings = { centerlines: [], zebras: [], crosswalks: [], curbs: [], parkkerbs: [], parkpaths: [] };
  // park benches, with the bearing they face (degrees, the generator's own)
  const benches = [];
  for (const f of c.context.features) {
    const k = f.properties?.kind, g = f.geometry;
    if (k === "shallows" && g.type === "Polygon") water.push(ring(g.coordinates[0]));
    else if (k in ground && g.type === "Polygon") ground[k].push(ring(g.coordinates[0]));
    else if (k in ground && g.type === "MultiPolygon") for (const p of g.coordinates) ground[k].push(ring(p[0]));
    else if (k === "tree" && g.type === "Point") trees.push(...ue(g.coordinates));
    else if (k === "centerline" && g.type === "LineString") markings.centerlines.push({ w: Math.round((f.properties.w ?? 8) * 100), mk: f.properties.mk ?? 0, cls: f.properties.cls ?? "", line: g.coordinates.flatMap(ue) });
    else if (k === "zebra" && g.type === "LineString") markings.zebras.push(g.coordinates.flatMap(ue));
    else if (k === "crosswalk" && g.type === "Polygon") markings.crosswalks.push(ring(g.coordinates[0]));
    // the kerb lines (a raised footway's road edge), a lawn's edging, the park walks
    else if (k === "curb" && g.type === "LineString") markings.curbs.push(g.coordinates.flatMap(ue));
    else if (k === "parkkerb" && g.type === "LineString") markings.parkkerbs.push(g.coordinates.flatMap(ue));
    else if (k === "parkpath" && g.type === "LineString") markings.parkpaths.push(g.coordinates.flatMap(ue));
    else if (k === "bench" && g.type === "Point") benches.push({ at: ue(g.coordinates), rot: Number(f.properties.rot ?? 0) });
    else if (k === "label" && g.type === "Point") labels.push({ name: f.properties.name, kind: f.properties.labelKind, at: ue(g.coordinates) });
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  // a region's extent is its window, sea included, not where its buildings happen to stand
  const window = c.groundLayers ? [{ ring: [[w, s], [e, n]].flatMap(ue) }] : null;
  for (const v of window ?? volumes) for (let i = 0; i < v.ring.length; i += 2) {
    minX = Math.min(minX, v.ring[i]); maxX = Math.max(maxX, v.ring[i]);
    minY = Math.min(minY, v.ring[i + 1]); maxY = Math.max(maxY, v.ring[i + 1]);
  }
  return {
    format: "bw-city/1",
    city: { id: c.id, seed: c.seed, size: c.size, name: c.name, lots: parcels.length },
    origin: { lon: lon0, lat: lat0 },
    bounds: { minX, maxX, minY, maxY },
    parcels, volumes, water, ground, trees, labels, markings, benches,
  };
}
