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

/** Ground layers, in draw order (later on top). */
export const GROUND_LAYERS = ["land", "beach", "marsh", "rock", "esplanade", "apron", "paveland", "pavement", "median", "sidewalk", "park", "pond", "stream"];

export function toBwCity(c) {
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

  // volumes: one extruded prism per building tier (the web map's own feed)
  const volumes = c.buildings3d.map((b) => ({
    bbl: b.b || "", cls: b.c, year: b.y, z0: Math.round(b.z0 * 100), z1: Math.round(b.z1 * 100),
    deco: b.d ? (b.dk ?? "deco") : "", crown: !!b.x, vacant: !!b.k, ring: b.r.flatMap(ue),
  }));

  const ground = Object.fromEntries(GROUND_LAYERS.map((k) => [k, []]));
  const water = [], trees = [], labels = [];
  // street markings: centrelines carry the carriageway width (w, metres) the
  // renderer divides into lanes; zebra bars and crosswalk outlines come as drawn
  const markings = { centerlines: [], zebras: [], crosswalks: [] };
  for (const f of c.context.features) {
    const k = f.properties?.kind, g = f.geometry;
    if (k === "shallows" && g.type === "Polygon") water.push(ring(g.coordinates[0]));
    else if (k in ground && g.type === "Polygon") ground[k].push(ring(g.coordinates[0]));
    else if (k in ground && g.type === "MultiPolygon") for (const p of g.coordinates) ground[k].push(ring(p[0]));
    else if (k === "tree" && g.type === "Point") trees.push(...ue(g.coordinates));
    else if (k === "centerline" && g.type === "LineString") markings.centerlines.push({ w: Math.round((f.properties.w ?? 8) * 100), mk: f.properties.mk ?? 0, cls: f.properties.cls ?? "", line: g.coordinates.flatMap(ue) });
    else if (k === "zebra" && g.type === "LineString") markings.zebras.push(g.coordinates.flatMap(ue));
    else if (k === "crosswalk" && g.type === "Polygon") markings.crosswalks.push(ring(g.coordinates[0]));
    else if (k === "label" && g.type === "Point") labels.push({ name: f.properties.name, kind: f.properties.labelKind, at: ue(g.coordinates) });
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const v of volumes) for (let i = 0; i < v.ring.length; i += 2) {
    minX = Math.min(minX, v.ring[i]); maxX = Math.max(maxX, v.ring[i]);
    minY = Math.min(minY, v.ring[i + 1]); maxY = Math.max(maxY, v.ring[i + 1]);
  }
  return {
    format: "bw-city/1",
    city: { id: c.id, seed: c.seed, size: c.size, name: c.name, lots: parcels.length },
    origin: { lon: lon0, lat: lat0 },
    bounds: { minX, maxX, minY, maxY },
    parcels, volumes, water, ground, trees, labels, markings,
  };
}
