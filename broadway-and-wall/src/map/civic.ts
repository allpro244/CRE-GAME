// Civic works on the map — stations, parks, bridges the city actually built.
//
// The engine stores a work as a point in local metres and (for a park or a
// station) the lot it took. This file turns that into GeoJSON the style can
// paint, and into the rings/points the 3D layer lays turf and a head-house on.
// Nothing here moves money.
import type { ParcelTable } from "@/data/types";
import type { GameState } from "@/engine/types";

const M_PER_DEG_LAT = 111_320;

export type CivicStage = "rumor" | "building" | "open";

export function civicStage(
  line: { rumorM?: number; annM: number; openM: number },
  month: number,
): CivicStage {
  if (month >= line.openM) return "open";
  if (month >= line.annM) return "building";
  return "rumor";
}

/** Same local-metre origin demand.ts uses for block centroids. */
export function cityOrigin(parcels: ParcelTable): { lon0: number; lat0: number; mPerDegLon: number } {
  const bbls = Object.keys(parcels);
  let lat0 = 0, lon0 = 0;
  for (const b of bbls) { lon0 += parcels[b].centroid[0]; lat0 += parcels[b].centroid[1]; }
  const n = Math.max(1, bbls.length);
  lon0 /= n; lat0 /= n;
  return { lon0, lat0, mPerDegLon: M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180) };
}

export function metresToLngLat(
  o: { lon0: number; lat0: number; mPerDegLon: number },
  cx: number, cy: number,
): [number, number] {
  return [o.lon0 + cx / o.mPerDegLon, o.lat0 + cy / M_PER_DEG_LAT];
}

function ringAround(ll: [number, number], hx: number, hy: number, deg: number): [number, number][] {
  const t = (deg * Math.PI) / 180, ct = Math.cos(t), st = Math.sin(t);
  const kx = 111320 * Math.cos((ll[1] * Math.PI) / 180), ky = 111320;
  const corners: [number, number][] = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]];
  return corners.map(([x, y]) => {
    const rx = x * ct - y * st, ry = x * st + y * ct;
    return [ll[0] + rx / kx, ll[1] + ry / ky];
  });
}

function parcelRing(
  features: GeoJSON.FeatureCollection | undefined,
  bbl: string | undefined,
): [number, number][] | null {
  if (!bbl || !features) return null;
  for (const f of features.features) {
    if (f.properties?.bbl !== bbl || f.geometry?.type !== "Polygon") continue;
    const ring = (f.geometry as GeoJSON.Polygon).coordinates[0] as [number, number][];
    if (ring?.length >= 4) return ring.slice(0, -1);
  }
  return null;
}

function ringCentroid(ring: [number, number][]): [number, number] {
  let cx = 0, cy = 0;
  for (const p of ring) { cx += p[0]; cy += p[1]; }
  return [cx / ring.length, cy / ring.length];
}

function nearestStreamRing(
  context: GeoJSON.FeatureCollection | null | undefined,
  ll: [number, number],
): [number, number][] | null {
  let best: [number, number][] | null = null, bd = Infinity;
  for (const f of context?.features ?? []) {
    if (f.properties?.kind !== "stream" || f.geometry?.type !== "Polygon") continue;
    const ring = ((f.geometry as GeoJSON.Polygon).coordinates[0] as [number, number][]).slice(0, -1);
    if (ring.length < 3) continue;
    const [cx, cy] = ringCentroid(ring);
    const d = Math.hypot(cx - ll[0], cy - ll[1]);
    if (d < bd) { bd = d; best = ring; }
  }
  // ~220 m: a bridge that is not on water is a viaduct, and we still draw it,
  // but we will not yank the deck across half the island to sit on a creek.
  return bd < 0.002 ? best : null;
}

function headingOf(ring: [number, number][]): number {
  let best = 0, bl = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L > bl) {
      bl = L;
      best = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
    }
  }
  return best;
}

function hashDeg(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}

export function civicCollection(
  game: GameState,
  parcels: ParcelTable,
  parcelFeatures?: GeoJSON.FeatureCollection,
  context?: GeoJSON.FeatureCollection | null,
): GeoJSON.FeatureCollection {
  const o = cityOrigin(parcels);
  const features: GeoJSON.Feature[] = [];
  for (const l of game.lines ?? []) {
    const stage = civicStage(l, game.month);
    const kind = l.kind ?? "station";
    const site = l.siteBbl ?? (kind === "park" || kind === "station" ? l.bbl : undefined);
    const ll = metresToLngLat(o, l.cx, l.cy);
    if (kind === "park") {
      const ring = parcelRing(parcelFeatures, site);
      if (ring) {
        features.push({
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] },
          properties: { kind: "park", stage, name: l.name, bbl: site ?? l.bbl },
        });
      } else {
        // Rumour: a small planning square on the block, not a fake green on
        // somebody's lot. The real parcel fill arrives once the city buys it.
        const hint = ringAround(ll, 0.00012, 0.00012, 0);
        features.push({
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [[...hint, hint[0]]] },
          properties: { kind: "park", stage, name: l.name, bbl: l.bbl },
        });
      }
    } else if (kind === "bridge") {
      const stream = nearestStreamRing(context, ll);
      const at = stream ? ringCentroid(stream) : ll;
      // Long axis ACROSS the water — a crossing, not a causeway along the bank.
      const deg = stream ? headingOf(stream) + 90 : (hashDeg(l.id) * 180);
      const ring = ringAround(at, 0.00038, 0.00009, deg);
      features.push({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] },
        properties: { kind: "bridge", stage, name: l.name, bbl: l.bbl },
      });
    } else {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: parcels[site ?? l.bbl ?? ""]?.centroid ?? ll },
        properties: { kind: "station", stage, name: l.name, bbl: site ?? l.bbl },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

export function civicWorks3d(
  game: GameState,
  parcels: ParcelTable,
  parcelFeatures?: GeoJSON.FeatureCollection,
  context?: GeoJSON.FeatureCollection | null,
): {
  parks: [number, number][][];
  sites: [number, number][][];
  stations: { ll: [number, number]; open: boolean }[];
  bridges: { ring: [number, number][]; open: boolean }[];
  flatten: string[];
} {
  const o = cityOrigin(parcels);
  const parks: [number, number][][] = [];
  const sites: [number, number][][] = [];
  const stations: { ll: [number, number]; open: boolean }[] = [];
  const bridges: { ring: [number, number][]; open: boolean }[] = [];
  const flatten: string[] = [];
  for (const l of game.lines ?? []) {
    const stage = civicStage(l, game.month);
    const kind = l.kind ?? "station";
    const ll = metresToLngLat(o, l.cx, l.cy);
    if (kind === "park") {
      const site = l.siteBbl ?? l.bbl;
      const ring = parcelRing(parcelFeatures, site);
      if (ring && stage === "open") parks.push(ring);
      else if (ring && stage === "building") sites.push(ring);
      if (site && stage !== "rumor") flatten.push(site);
    } else if (kind === "bridge") {
      if (stage === "rumor") continue;
      const stream = nearestStreamRing(context, ll);
      const at = stream ? ringCentroid(stream) : ll;
      const deg = stream ? headingOf(stream) + 90 : (hashDeg(l.id) * 180);
      bridges.push({ ring: ringAround(at, 0.00038, 0.00009, deg), open: stage === "open" });
    } else if (stage !== "rumor") {
      const site = l.siteBbl ?? l.bbl;
      if (site) flatten.push(site);
      stations.push({ ll: parcels[site ?? ""]?.centroid ?? ll, open: stage === "open" });
    }
  }
  return { parks, sites, stations, bridges, flatten };
}
