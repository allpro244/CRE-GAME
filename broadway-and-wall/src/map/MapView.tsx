import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useStore } from "@/state/store";
import { blocksPaint, parksPaint, groundGrain, composeStyle, gameLayers, landLensColor, lightSpec, LIVE_DEMAND, resolveBaseStyle, skySpec } from "./style";
import type { BuildingVolume } from "./volume";
import { RealCityLayer } from "./real/RealCity";
import { condIdxOf, occupancy, physicalOcc, resolveRec, useOccupancy } from "@/engine/value";
import { useSf } from "@/engine/mix";
import { START_YEAR } from "@/engine/types";
import type { BuildingDesign, GameState } from "@/engine/types";
import { cityVisualState } from "./cityVisuals";
import { ownerIndex } from "@/engine/ownership";
import { holderOf } from "@/engine/owners";
import { civicCollection, civicWorks3d } from "./civic";
import { siteDeeds } from "@/engine/actions";
import Badges from "./Badges";
import { esc, tipHtml } from "./hoverCard";
import EventPops from "./EventPops";

/**
 * What the map actually paints. LOI counters, cash draws and news writes clone
 * a new `game` every click; subscribing to that identity re-rendered the whole
 * MapView (and re-ran skyline/occupancy work) on every desk action. This
 * signature stays stable unless the picture changed.
 */
function mapPaintSig(g: GameState | null | undefined): string {
  if (!g) return "";
  let leased = 0;
  // what the parapets say (setOwned's status): listed, swept, in a workout.
  // A sale instruction or a lender's letter lands between month ticks, so it
  // has to be in the signature or the building catches up a month late.
  let deedState = "";
  for (const h of Object.values(g.holdings)) {
    for (const t of h.tenants) leased += t.sf;
    if (h.sale || h.loan?.sweep || h.mezz?.sweep) deedState += h.bbl + (h.sale ? (h.sale.mode === "marketed" ? "m" : "s") : "") + (h.loan?.sweep || h.mezz?.sweep ? "w" : "") + ",";
  }
  for (const [bbl, w] of Object.entries(g.workouts ?? {})) deedState += bbl + ":" + w.stage + ",";
  return [
    g.month,
    Object.keys(g.holdings).join(","),
    g.listings.map((l) => l.bbl).join(","),
    Object.keys(g.developments ?? {}).join(","),
    Object.keys(g.built ?? {}).length,
    (g.cityJobs ?? []).length,
    Object.keys(g.merged ?? {}).length,
    leased,
    g.econ.phase,
    g.auction?.m ?? "",
    (g.bankFcls ?? []).length,
    Object.keys(g.blockD ?? {}).length,
    (g.lines ?? []).map((l) => `${l.id}:${l.annM}:${l.openM}:${l.siteBbl ?? l.bbl ?? ""}`).join(","),
    Object.keys(g.civicLand ?? {}).join(","),
    deedState,
  ].join("|");
}

/**
 * WHERE THE METRE FRAME IS PINNED — and it is read from the city now, because a
 * constant here is only ever right for one island.
 *
 * The camera two blocks up already learned this: "the pipeline puts the city's
 * bounding box and its demand-weighted core into the manifest, so the opening
 * shot frames whatever city was built... Hand-tuned constants meant every new
 * map opened looking at the wrong piece of water." The PROJECTION ORIGIN never
 * got the same treatment, and it is the more dangerous of the two — the camera
 * looking at the wrong water is visible, whereas a projection pinned to the
 * wrong meridian silently places every building somewhere else on earth.
 *
 * Measured for the written-down Manhattan: it sits about 257 km from this
 * constant, which is nothing subtle. Generated islands are all cut around
 * [-70.9, 41.1] so nothing moves for them, and the fallback keeps that.
 */
/** Canvas pixel density per graphics setting: High is native, Medium caps a
 *  retina screen at 1.25x, Low draws at 1x. */
const ratioFor = (q: "low" | "medium" | "high", dpr: number) =>
  q === "low" ? 1 : q === "medium" ? Math.min(dpr, 1.25) : dpr;

const CITY_CENTER: [number, number] = [-70.9, 41.1];

// One colour per firm, in the order the street was founded, so a rival's book
// reads as a shape on the map under the Owners lens. Muted on purpose — these
// sit under the gold of your own holdings, which always wins.
export const FIRM_TINT: [number, number, number][] = [
  [0.72, 0.92, 1.24],   // slate blue
  [1.18, 0.78, 0.86],   // rose
  [0.80, 1.16, 0.86],   // sage
  [1.16, 1.02, 0.72],   // ochre
  [0.94, 0.82, 1.20],   // violet
  [0.74, 1.12, 1.16],   // teal
  [1.20, 0.92, 0.70],   // clay
  [0.86, 0.86, 0.86],   // grey
];

/**
 * ...AND ONE COLOUR PER KIND OF PRIVATE HOLDER, for the other nine buildings
 * in ten.
 *
 * The Owners lens was called the Owners lens and painted the firms: a dozen
 * books, a tenth of the floor area, and the rest of the city left blank. That
 * blankness was the map telling you the same thing the parcel card used to —
 * that most of this town belongs to nobody in particular — and it was never
 * true. The register names every deed (engine/ownership.ts), so the lens can
 * fill the map in.
 *
 * BY KIND RATHER THAN BY NAME, because there are two hundred private holders
 * and eight colours, and a map with two hundred colours on it is a map with
 * none. What a player actually reads off a city-wide ownership picture is
 * where the ESTATES are, which blocks a fund has been quietly accumulating,
 * and which corners have been in one family since the war — and that is a
 * question about kind, not about which particular family. Deliberately paler
 * than FIRM_TINT: a competitor's book has to stay the loudest thing on the
 * map after your own gold.
 */
export const HOLDER_TINT: Record<string, [number, number, number]> = {
  estate: [1.10, 0.96, 0.94],        // faded rose — the ones that are coming to market
  institution: [0.94, 0.98, 1.10],   // cold blue — committees and mandates
  partnership: [1.06, 1.00, 0.92],   // sand
  local: [0.96, 1.06, 0.96],         // pale green — the families
  developer: [1.08, 1.04, 0.90],     // pale ochre — they built it
  lender: [1.00, 0.94, 0.94],        // ash — a servicer holding a file
};

// The two cameras are READ FROM THE DATA, not written down here. The pipeline
// puts the city's bounding box and its demand-weighted core into the manifest,
// so the opening shot frames whatever city was built and the dive lands on its
// business district. Hand-tuned constants meant every new map opened looking at
// the wrong piece of water.
type CityFrame = { bbox: [number, number, number, number]; core: [number, number] };
const FALLBACK: CityFrame = { bbox: [-70.912, 41.092, -70.888, 41.109], core: [-70.8966, 41.0997] };

/**
 * THE ZOOM AT WHICH THE WHOLE ISLAND FITS THE WINDOW.
 *
 * Web Mercator puts 512 pixels across 360° of longitude at zoom 0 and doubles
 * every level, so the zoom that lays `span` degrees across `px` pixels is
 * log2(px·360 / (512·span)). The city has to fit in BOTH directions, so the
 * binding constraint is whichever of the two is tighter — and it is not always
 * the same one, which is why this used to get it wrong.
 *
 * It measured both spans and then compared them against the WIDTH: latitude
 * span was converted to its longitude equivalent (the /cos term, which is the
 * Mercator stretch) and then `max`'d with the longitude span, so a tall narrow
 * island in a wide window was sized as though the window were square. On a
 * 1500x1000 viewport that is a third of the height thrown away, and on a
 * portrait window it overflows instead. Measured against the two spans, not
 * against one of them twice.
 */
function fitZoom(frame: CityFrame, wpx: number, hpx: number) {
  const [w, s, e, n] = frame.bbox;
  const lonSpan = Math.max(1e-4, e - w);
  // latitude degrees are worth more pixels than longitude degrees away from
  // the equator; at 41°N the factor is about 1.33
  const latSpan = Math.max(1e-4, n - s) / Math.cos((((s + n) / 2) * Math.PI) / 180);
  const zFor = (span: number, px: number) => Math.log2((px * 360) / (512 * span));
  return Math.min(zFor(lonSpan, wpx), zFor(latSpan, hpx));
}

/**
 * THE OPENING SHOT IS THE ISLAND'S OWN, WHATEVER SIZE IT IS.
 *
 * Both cameras used to carry a constant. The establishing shot was clamped at
 * zoom 14.6 and the dive was hard-wired to 15.3, and the reason nobody noticed
 * is that 15.3 happens to be almost exactly right for ONE island: measured on
 * the standard City map (1,379 lots, bbox 0.0203° x 0.0085°) at 1500x1000, the
 * whole island fits at zoom 15.66, so the shipped dive sat 0.36 of a level
 * inside it — the town filling the frame with a little water around it, which
 * is the shot the game has always opened on.
 *
 * That constant is a fact about one map, not about framing. A Great City is
 * twice the island end to end (bbox 0.0411° x 0.0175°, 5,766 lots) and fits at
 * 14.65, so the same 15.3 lands the camera A FULL ZOOM LEVEL inside it: the
 * player opens looking at roughly a quarter of the town with the other
 * three-quarters running off every edge — measured, and screenshotted, before
 * this change. In the other direction a Hamlet fits at about 16.5 and the 14.6
 * clamp opened it on four times more ocean than town.
 *
 * So both shots are expressed as a distance from the island's OWN fit zoom.
 * The establishing frame preserves the old calibration; the gameplay frame
 * deliberately comes closer so the renderer's architectural detail survives
 * at the camera where the game is actually played.
 */
// How far OUTSIDE the island's fit zoom the dive lands — negative because a
// smaller zoom is further away.
// The gameplay camera should be a city view, not an island diagram. Six per
// cent of breathing room keeps the shoreline in frame while making roofs,
// streets and construction readable without the player's first action being
// a zoom gesture.
const DIVE_INSET = -0.08;
// The establishing shot pulls back further, because it is the "here is a
// place" frame and a coastline needs water around it to read as an island.
// 0.9 of a level is 1.87x the island's span, which is where the standard map's
// clamped 14.6 sat (fit 15.66, so 2.09x) less a little of the dead ocean.
const WIDE_INSET = -0.9;
const framesOf = (f: CityFrame, wpx: number, hpx: number) => {
  const [w, s, e, n] = f.bbox;
  const mid: [number, number] = [(w + e) / 2, (s + n) / 2];
  const fit = fitZoom(f, wpx, hpx);
  // WHERE THE DIVE LANDS. Not on the business district itself: `core` is the
  // demand-weighted centre of gravity and on a big island it sits well off the
  // geometric middle — on the Great City measured above it is 15% of the map's
  // width east of centre, so pointing the camera straight at it would push the
  // whole west side out of frame at the very moment the shot is supposed to be
  // showing the player their town. Most of the way there: the CBD is clearly
  // the subject, and the island still has both its ends.
  const toward = 0.55;
  const at: [number, number] = [
    mid[0] + (f.core[0] - mid[0]) * toward,
    mid[1] + (f.core[1] - mid[1]) * toward,
  ];
  return {
    // the establishing shot: the whole city in frame, low pitch
    wide: { center: mid, zoom: fit + WIDE_INSET, pitch: 30, bearing: -8 },
    // the dive: down onto the central business district, still framing the town
    core: { center: at, zoom: fit + DIVE_INSET, pitch: 55, bearing: -12 },
  };
};

// NEIGHBOURHOOD SEAMS, DERIVED. Under the demand and land lenses the whole
// ground plane becomes one colour ramp, and the districts stop being places —
// you can see where the city is hot without being able to say it is Harborside.
// The generator never emits district boundary geometry, but it does not need
// to: every pavement cell carries its district, and two cells that face each
// other across a district seam were both cut by the same BSP half-plane, so
// their seam edges are collinear to within numerical noise. Overlapping
// collinear edge pairs owned by DIFFERENT districts are exactly the seams.
// Brute force over the ~1-2k street-length edges runs in under 20ms, once,
// the first time a lens opens.
function hoodBoundaries(
  ctx: GeoJSON.FeatureCollection | null | undefined,
  center: [number, number] = CITY_CENTER,
): GeoJSON.FeatureCollection {
  const M = 111320; // metres per degree of latitude
  const cosLat = Math.cos((center[1] * Math.PI) / 180);
  type Seg = { ux: number; uy: number; c: number; t0: number; t1: number; d: string };
  const segs: Seg[] = [];
  for (const f of ctx?.features ?? []) {
    if (f.properties?.kind !== "pavement" || f.geometry.type !== "Polygon") continue;
    const d = String(f.properties?.d ?? "");
    if (!d) continue;
    const ring = (f.geometry as GeoJSON.Polygon).coordinates[0] as [number, number][];
    for (let i = 0; i < ring.length - 1; i++) {
      const px = ring[i][0] * M * cosLat, py = ring[i][1] * M;
      const qx = ring[i + 1][0] * M * cosLat, qy = ring[i + 1][1] * M;
      let ux = qx - px, uy = qy - py;
      const len = Math.hypot(ux, uy);
      if (len < 6) continue; // a sliver cannot carry a seam
      ux /= len; uy /= len;
      // canonical direction, so the two facing edges land on the same line key
      if (uy < 0 || (Math.abs(uy) < 1e-9 && ux < 0)) { ux = -ux; uy = -uy; }
      const ta = ux * px + uy * py, tb = ux * qx + uy * qy;
      segs.push({ ux, uy, c: -uy * px + ux * py, t0: Math.min(ta, tb), t1: Math.max(ta, tb), d });
    }
  }
  const features: GeoJSON.Feature[] = [];
  for (let i = 0; i < segs.length; i++) {
    const a = segs[i];
    for (let j = i + 1; j < segs.length; j++) {
      const b = segs[j];
      if (a.d === b.d) continue;                                  // same neighbourhood
      if (Math.abs(a.ux * b.uy - a.uy * b.ux) > 0.002) continue;  // not parallel (~0.1 deg)
      if (Math.abs(a.c - b.c) > 0.9) continue;                    // parallel but a different street
      const lo = Math.max(a.t0, b.t0), hi = Math.min(a.t1, b.t1);
      if (hi - lo < 8) continue;                                  // corners touching, not a shared front
      const pt = (t: number): [number, number] =>
        [(-a.uy * a.c + a.ux * t) / (M * cosLat), (a.ux * a.c + a.uy * t) / M];
      features.push({ type: "Feature", geometry: { type: "LineString", coordinates: [pt(lo), pt(hi)] }, properties: {} });
    }
  }
  return { type: "FeatureCollection", features };
}

export default function MapView() {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const hoveredRef = useRef<string | null>(null);
  /** Every deed painted selected — a whole assemblage, not just the click. */
  const selectedRef = useRef<string[]>([]);
  const neighborsRef = useRef<string[]>([]);
  const ownedRef = useRef<Set<string>>(new Set());
  const listedRef = useRef<Set<string>>(new Set());
  const assembledRef = useRef<Set<string>>(new Set());
  const threeRef = useRef<RealCityLayer | null>(null);
  // flipping the preview renderer rebuilds the map with the other 3D layer
  const [mapReady, setMapReady] = useState(false);
  const hover = useStore((s) => s.hover);
  const setFps = useStore((s) => s.setFps);

  // THE MAP WAITS FOR THE CITY. Nothing is fetched any more — the parcel
  // polygons, the footprints, the water and the parks are all generated in
  // `loadData` and handed over here, so the map cannot mount until they exist.
  const city = useStore((s) => s.city);
  useEffect(() => {
    if (!el.current || mapRef.current || !city) return;
    let disposed = false;

    (async () => {
      const m = city.manifest as unknown as CityFrame;
      const frame = Array.isArray(m?.bbox) && Array.isArray(m?.core) ? m : FALLBACK;
      const base = await resolveBaseStyle(city.context);
      if (disposed || !el.current) return;
      // BOTH DIMENSIONS OF THE WINDOW, because the island has to fit in both.
      // Only the width was ever read, and the height was assumed to be the
      // width — see fitZoom.
      const shot = framesOf(frame, el.current.clientWidth || 1280, el.current.clientHeight || 800);
      // Native pixel density on High (the default) — a capable machine keeps
      // its sharpness. Medium and Low cap it, and only when the player asks.
      const dpr = typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1;
      const graphics = useStore.getState().graphics;
      const map = new maplibregl.Map({
        container: el.current,
        style: composeStyle(base, city),
        ...shot.wide,
        minZoom: shot.wide.zoom - 0.9, // whole city stays in frame; tiles never vanish
        maxPitch: 70,
        attributionControl: { compact: true },
        canvasContextAttributes: { antialias: true },
        pixelRatio: ratioFor(graphics, dpr),
      });
      mapRef.current = map;
      // the ground grain textures are made here, not fetched (see groundGrain)
      map.on("styleimagemissing", (e: { id: string }) => {
        if (e.id === "bw-grain-asphalt" && !map.hasImage(e.id)) map.addImage(e.id, groundGrain("asphalt"));
        if (e.id === "bw-grain-yard" && !map.hasImage(e.id)) map.addImage(e.id, groundGrain("yard"));
      });
      // handle for automated playtests and screenshots
      (window as unknown as { __map?: maplibregl.Map }).__map = map;
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");

      const featureIdsFor = (bbl: string) => Number(bbl);
      // GeoJSON sources have no source-layer. Everything else about feature
      // state is unchanged — the features carry the same numeric ids they
      // carried as tiles, because the ids come from the BBL either way.
      const setState = (bbl: string, state: Record<string, boolean>) => {
        const id = featureIdsFor(bbl);
        map.setFeatureState({ source: "bw-parcels", id }, state);
        map.setFeatureState({ source: "bw-buildings", id }, state);
      };

      map.on("load", () => {
        setMapReady(true);
        // the beautiful-buildings renderer: meshes with procedural facades
        Promise.resolve([city.buildings3d as BuildingVolume[], city.context as GeoJSON.FeatureCollection | null] as const)
          .then(([volumes, ctx]: readonly [BuildingVolume[], GeoJSON.FeatureCollection | null]) => {
            if (disposed || !volumes?.length) return;
            const curbFeats = (ctx?.features ?? [])
              .filter((f) => f.properties?.kind === "street"
                && (f.properties?.cls === "grid" || f.properties?.cls === "lane")
                && f.geometry.type === "LineString");
            const curbs: [number, number][][] = curbFeats
              .map((f) => (f.geometry as GeoJSON.LineString).coordinates as [number, number][]);
            // per segment: the half-street and the footway width citygen measured
            const curbMeta = curbFeats.map((f) => ({
              hw: (f.properties?.hw ?? []) as number[],
              sw: (f.properties?.sw ?? []) as number[],
            }));
            // park & esplanade trees and pier piles come along as 3D dressing
            const pointsOf = (kind: string): [number, number][] => (ctx?.features ?? [])
              .filter((f) => f.properties?.kind === kind && f.geometry.type === "Point")
              .map((f) => (f.geometry as GeoJSON.Point).coordinates as [number, number]);
            // furniture carries a bearing, so it comes across as point + rot
            const orientedOf = (kind: string) => (ctx?.features ?? [])
              .filter((f) => f.properties?.kind === kind && f.geometry.type === "Point")
              .map((f) => ({
                p: (f.geometry as GeoJSON.Point).coordinates as [number, number],
                r: Number(f.properties?.rot ?? 0),
              }));
            const ringsOf = (kind: string): [number, number][][] => (ctx?.features ?? [])
              .filter((f) => f.properties?.kind === kind && f.geometry.type === "Polygon")
              .map((f) => ((f.geometry as GeoJSON.Polygon).coordinates[0] as [number, number][]).slice(0, -1));
            // the land ring becomes the hole in the water plane
            const landRing = (ctx?.features ?? [])
              .find((f) => f.properties?.kind === "land" && f.geometry.type === "Polygon");
            const linesOf = (kind: string): [number, number][][] => (ctx?.features ?? [])
              .filter((f) => f.properties?.kind === kind && f.geometry.type === "LineString")
              .map((f) => (f.geometry as GeoJSON.LineString).coordinates as [number, number][]);
            const layer = new RealCityLayer(volumes, frame.core, curbs, {
              curbMeta,
              // the raised footways, kerbs and crossings, built in 3D
              sidewalks: (ctx?.features ?? [])
                .filter((f) => f.properties?.kind === "sidewalk" && f.geometry.type === "Polygon")
                .map((f) => {
                  const c = (f.geometry as GeoJSON.Polygon).coordinates;
                  return {
                    ring: (c[0] as [number, number][]).slice(0, -1),
                    holes: c.slice(1).map((h) => (h as [number, number][]).slice(0, -1)),
                  };
                }),
              kerbs: linesOf("curb"),
              zebras: linesOf("zebra"),
              quays: linesOf("quay"),
              // open ground that is neither footway, park nor carriageway: the
              // boulevard malls and the esplanade
              opens: (ctx?.features ?? [])
                .filter((f) => (f.properties?.kind === "median" || f.properties?.kind === "esplanade") && f.geometry.type === "Polygon")
                .map((f) => (f.geometry as GeoJSON.Polygon).coordinates.map((r) => (r as [number, number][]).slice(0, -1))),
              trees: pointsOf("tree"),
              piles: pointsOf("pile"),
              benches: orientedOf("bench"),
              rails: orientedOf("rail"),
              // the lawns get a real turf surface laid over the flat park fill,
              // and the pond and walks come up with it — otherwise the turf
              // buries the MapLibre layers that were drawing them
              parks: (ctx?.features ?? [])
                .filter((f) => f.properties?.kind === "park" && f.geometry.type === "Polygon")
                .map((f) => {
                  const coords = (f.geometry as GeoJSON.Polygon).coordinates;
                  return {
                    ring: (coords[0] as [number, number][]).slice(0, -1),
                    holes: coords.slice(1).map((h) => (h as [number, number][]).slice(0, -1)),
                    flavour: String(f.properties?.flavour ?? "park"),
                  };
                }),
              // park ponds stay level with the lawn; creeks and canals go
              // into a channel of their own (RealCityLayer.buildChannels)
              ponds: ringsOf("pond"),
              streams: (ctx?.features ?? [])
                .filter((f) => f.properties?.kind === "stream" && f.geometry.type === "Polygon")
                .map((f) => ({
                  ring: ((f.geometry as GeoJSON.Polygon).coordinates[0] as [number, number][]).slice(0, -1),
                  water: String(f.properties?.water ?? "creek"),
                })),
              bridges: (ctx?.features ?? [])
                .filter((f) => f.properties?.kind === "bridge" && f.geometry.type === "Polygon")
                .map((f) => ({
                  ring: ((f.geometry as GeoJSON.Polygon).coordinates[0] as [number, number][]).slice(0, -1),
                  deg: Number(f.properties?.deg ?? 0),
                  w: Number(f.properties?.w ?? 16),
                  rw: Number(f.properties?.rw ?? 0),
                  cw: Number(f.properties?.cw ?? 0),
                })),
              paths: (ctx?.features ?? [])
                .filter((f) => f.properties?.kind === "parkpath" && f.geometry.type === "LineString")
                .map((f) => (f.geometry as GeoJSON.LineString).coordinates as [number, number][]),
              land: landRing
                ? ((landRing.geometry as GeoJSON.Polygon).coordinates[0] as [number, number][]).slice(0, -1)
                : undefined,
              // THE DEEDS. The renderer had every building's outline and not a
              // single lot's, so a redevelopment was drawn inside the footprint
              // of whatever it replaced. The
              // geometry was already in the room: this is the same collection
              // MapLibre paints the parcel fill from.
              lots: (() => {
                const out: Record<string, [number, number][]> = {};
                const fc = city.parcelFeatures as GeoJSON.FeatureCollection | undefined;
                for (const f of fc?.features ?? []) {
                  const bbl = f.properties?.bbl as string | undefined;
                  if (!bbl || f.geometry?.type !== "Polygon") continue;
                  const ring = (f.geometry as GeoJSON.Polygon).coordinates[0] as [number, number][];
                  if (ring?.length >= 4) out[bbl] = ring.slice(0, -1);
                }
                return out;
              })(),
            }, (useStore.getState().game?.citySeed ?? 1) >>> 0);
            layer.setMonth(useStore.getState().game?.month ?? 0);
            // the foot-traffic gradient reads demand at plant time, so it has
            // to arrive before addLayer triggers the build
            {
              const ps = useStore.getState().parcels;
              if (ps) {
                const dm: Record<string, number> = {};
                for (const bbl in ps) dm[bbl] = ps[bbl].demandScore;
                layer.setDemandMap(dm);
              }
            }
            layer.setQuality(useStore.getState().graphics);
            threeRef.current = layer;
            // A handle for automated playtests, same as window.__map. The 3D
            // layer is the one part of this game whose correctness cannot be
            // asserted from state alone — you have to be able to ask the
            // geometry how tall it still is.
            (window as unknown as { __three?: unknown }).__three = layer;
            map.addLayer(layer);
          })
          .catch(() => {
            // no mesh feed — fall back to the flat extrusions
            map.setLayoutProperty("bw-bldg-3d", "visibility", "visible");
          });
        // the cinematic fly-in
        map.flyTo({ ...shot.core, duration: 5500, essential: true });

        // WHAT IS UNDER THE POINTER. The 3D city answers first — from a
        // pitched camera the flat parcel under the cursor is the street behind
        // the tower you are pointing at — and the flat layer is the fallback
        // while the 3D layer is still loading.
        const pickAt = (pt: { x: number; y: number }): string | null => {
          const three = threeRef.current;
          if (three) return three.pickAt(pt.x, pt.y);
          const fs = map.queryRenderedFeatures(
            [[pt.x - 8, pt.y - 8], [pt.x + 8, pt.y + 8]], { layers: ["bw-parcel-fill"] });
          return (fs[0]?.properties?.bbl as string | undefined) ?? null;
        };
        let pending: { x: number; y: number } | null = null;
        const setHovered = (bbl: string | null) => {
          if (bbl === hoveredRef.current) return;
          if (hoveredRef.current) setState(hoveredRef.current, { hover: false });
          hoveredRef.current = bbl;
          if (bbl) setState(bbl, { hover: true });
          hover(bbl);
          map.getCanvas().style.cursor = bbl ? "pointer" : "";
        };
        map.on("mousemove", (e) => {
          // one pick per frame, however fast the mouse moves
          if (!pending) requestAnimationFrame(() => { const pt = pending; pending = null; if (pt) setHovered(pickAt(pt)); });
          pending = { x: e.point.x, y: e.point.y };
        });
        map.on("mouseout", () => { pending = null; setHovered(null); });
        map.on("dragstart", () => { pending = null; setHovered(null); });
        map.on("click", (e) => {
          const bbl = pickAt(e.point);
          // Map is the index: select the lot AND put the camera on it. Empty
          // clicks clear the glance card. Closing firm pages (`page: none`)
          // keeps the docked parcel card visible for the selection.
          // Read from the store — this listener outlives the render that mounted it.
          const st = useStore.getState();
          if (bbl) st.focus(bbl, true);
          else st.select(null);
        });
      });

      // fps meter — only write the store when the readout is on. An unconditional
      // setFps every second used to re-render TopBar (and re-walk net worth) forever.
      let frames = 0;
      let last = performance.now();
      const tick = () => {
        if (disposed) return;
        frames++;
        const now = performance.now();
        if (now - last >= 1000) {
          if (useStore.getState().fpsOn) {
            setFps(Math.round((frames * 1000) / (now - last)));
          }
          frames = 0;
          last = now;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    })();

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
      // A rebuilt map (new city, or the renderer switched) starts with no
      // markers and no readiness: the label cache pointed at the old map's
      // nodes, and every effect keyed on mapReady has to run again.
      for (const m of labelsRef.current.values()) m.remove();
      labelsRef.current.clear();
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city]);

  // reflect selection + neighbor highlight into feature-state
  const selectedBBL = useStore((s) => s.selectedBBL);
  const adjacency = useStore((s) => s.adjacency);
  const parcels = useStore((s) => s.parcels);
  // Re-paint the site when an assemble/unmerge changes the plate under the same click.
  const mergedN = useStore((s) => Object.keys(s.game?.merged ?? {}).length);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) {
      // style may still be loading during the first selection — retry shortly
      const t = setTimeout(() => useStore.setState({ selectedBBL }), 150);
      if (!map) return () => clearTimeout(t);
      clearTimeout(t);
    }
    if (!map) return;
    const setState = (bbl: string, state: Record<string, boolean>) => {
      const id = Number(bbl);
      map.setFeatureState({ source: "bw-parcels", id }, state);
      map.setFeatureState({ source: "bw-buildings", id }, state);
    };
    for (const d of selectedRef.current) setState(d, { selected: false });
    for (const n of neighborsRef.current) setState(n, { neighbor: false });
    neighborsRef.current = [];
    selectedRef.current = [];
    if (selectedBBL) {
      // An assemblage is one site: paint every folded deed gold together so
      // the teal join reads as a plate, not three unrelated lots.
      const game = useStore.getState().game;
      const site = game ? siteDeeds(game, selectedBBL) : [selectedBBL];
      selectedRef.current = site;
      for (const d of site) setState(d, { selected: true });
      const siteSet = new Set(site);
      const nbrs: string[] = [];
      for (const d of site) {
        for (const n of adjacency?.[d] ?? []) {
          if (siteSet.has(n) || nbrs.includes(n)) continue;
          nbrs.push(n);
          setState(n, { neighbor: true });
        }
      }
      neighborsRef.current = nbrs;
      // ease toward the parcel if it's far from view
      const rec = parcels?.[selectedBBL];
      if (rec) {
        const c = map.getCenter();
        const d = Math.hypot(c.lng - rec.centroid[0], c.lat - rec.centroid[1]);
        if (d > 0.004) map.easeTo({ center: rec.centroid, duration: 800 });
      }
    }
  }, [selectedBBL, adjacency, parcels, mergedN]);

  // A DESK OVER THE MAP STOPS THE CLOCK ON THE WATER. The city keeps drawing
  // on demand; only the animation's own repaint requests pause, so a page's
  // tables and an Advance under it are not sharing the GPU with walkers
  // nobody can see through the backdrop.
  const pageOpen = useStore((s) => s.page !== "none");
  useEffect(() => {
    threeRef.current?.setPaused(pageOpen);
  }, [pageOpen, mapReady]);

  // GO TO PROPERTY. An explicit request from a list somewhere in the panel —
  // unlike the gentle ease above, this one always moves, and it FRAMES the
  // building rather than arriving at a zoom.
  //
  // It used to be zoom 16.1 and pitch 52 for everything. That is a good shot
  // of a six-storey walk-up and a bad one of both neighbours on the scale:
  // a forty-floor tower lost its crown off the top of the frame, a corner
  // shop was a speck, and whichever of them it was sat dead centre in a
  // window whose right third is covered by the parcel card — so the building
  // you asked to see was framed for a screen you cannot see all of. Four
  // things fix it, all of them what a photographer does walking up to a
  // building they have been sent to shoot:
  //
  //   SIZE      the subject is the larger of the lot's span and (most of) the
  //             building's height, and it is made to fill about a third of
  //             the visible frame — tall buildings get pulled back from,
  //             small ones walked up to
  //   PITCH     a tower is looked at more from the side, so its facade and
  //             not just its roof is the picture
  //   BEARING   stand with the sun over a shoulder, so the faces toward the
  //             lens are the lit ones; of the two three-quarter views either
  //             side of the sun line, the one nearer the current bearing, so
  //             the camera never spins round the block to get there
  //   PADDING   whatever UI actually covers the map right now is measured and
  //             kept out of the frame, so the building lands in the middle of
  //             the part of the map you can see
  const flyTo = useStore((s) => s.flyTo);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyTo || !parcels) return;
    const rec = parcels[flyTo.bbl];
    if (!rec) return;
    const layer = threeRef.current;
    const fr = layer?.buildingFrame(flyTo.bbl) ?? null;
    const container = map.getContainer();
    const box = container.getBoundingClientRect();
    // HOW MUCH OF THE MAP IS UNDER A PANEL, measured rather than assumed —
    // the layout belongs to the panels and changes without telling the map.
    // Walk in from each edge along three rows until a pixel belongs to the
    // map again.
    const covered = (fromRight: boolean) => {
      let most = 0;
      for (const fy of [0.3, 0.5, 0.7]) {
        const y = box.top + box.height * fy;
        let d = 0;
        for (; d < box.width * 0.55; d += 12) {
          const x = fromRight ? box.right - 2 - d : box.left + 2 + d;
          const hit = document.elementFromPoint(x, y);
          if (!hit || container.contains(hit)) break;
        }
        most = Math.max(most, d);
      }
      return most;
    };
    const padR = covered(true), padL = covered(false);
    const availW = Math.max(240, box.width - padR - padL);
    const availH = Math.max(240, box.height);
    const height = fr?.height ?? Math.max(4, (rec.floors || 1) * 3.55);
    const radius = fr?.radius ?? Math.sqrt(Math.max(100, rec.lotArea || 400) / 10.764) * 0.6;
    const pitch = Math.max(50, Math.min(63, 50 + height / 9));
    // the subject: lot or building, whichever is bigger on screen at this
    // pitch, and never less than a small block's worth of context
    const subject = Math.max(34, radius * 2.4, height * 1.05);
    const mpp = subject / (0.36 * Math.min(availW, availH));
    const lat = rec.centroid[1];
    const zoom = Math.max(15.0, Math.min(18.4, Math.log2((78271.517 * Math.cos((lat * Math.PI) / 180)) / mpp)));
    let bearing = map.getBearing();
    if (layer) {
      const back = layer.sunBackBearing();
      const wrap = (a: number) => ((a + 540) % 360) - 180;
      const a1 = wrap(back - 28), a2 = wrap(back + 28);
      bearing = Math.abs(wrap(a1 - bearing)) <= Math.abs(wrap(a2 - bearing)) ? a1 : a2;
    }
    // AIM AT THE MIDDLE OF THE BUILDING, NOT ITS FOOTING. In a pitched view a
    // point half-way up a tower lands on screen where the ground point
    // (h/2)·tan(pitch) further along the view direction would, so the camera
    // centres on that ground point and the whole height sits in frame.
    const lift = (height * 0.45) * Math.tan((pitch * Math.PI) / 180);
    const br = (bearing * Math.PI) / 180;
    const mPerDegLat = 111320, mPerDegLng = 111320 * Math.cos((lat * Math.PI) / 180);
    const center: [number, number] = [
      rec.centroid[0] + (Math.sin(br) * lift) / mPerDegLng,
      rec.centroid[1] + (Math.cos(br) * lift) / mPerDegLat,
    ];
    map.flyTo({
      center,
      zoom,
      pitch,
      bearing,
      padding: { top: 24, bottom: 24, left: padL, right: padR },
      duration: 1700,
      curve: 1.25,
      // ease-in-out cubic: leaves gently, arrives gently
      easing: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
      essential: true,
    });
  }, [flyTo, parcels]);

  // Fit the whole book — portfolio "Show book on map" and Map HUD filter.
  const fitBook = useStore((s) => s.fitBook);
  useEffect(() => {
    if (!fitBook) return;
    const map = mapRef.current;
    const game = useStore.getState().game;
    if (!map || !parcels || !game) return;
    const pts: [number, number][] = [];
    for (const bbl of Object.keys(game.holdings)) {
      if (game.merged?.[bbl]) continue;
      const c = parcels[bbl]?.centroid;
      if (c) pts.push(c);
    }
    if (pts.length === 0) return;
    if (pts.length === 1) {
      map.flyTo({
        center: pts[0],
        zoom: Math.max(map.getZoom(), 15.6),
        pitch: Math.max(map.getPitch(), 48),
        duration: 1200,
        essential: true,
      });
      return;
    }
    let w = pts[0][0], s = pts[0][1], e = pts[0][0], n = pts[0][1];
    for (const [lng, lat] of pts) {
      if (lng < w) w = lng;
      if (lng > e) e = lng;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
    }
    const pad = 0.0008;
    map.fitBounds(
      [[w - pad, s - pad], [e + pad, n + pad]],
      { padding: 72, duration: 1400, pitch: Math.max(map.getPitch(), 48), essential: true },
    );
  }, [fitBook, parcels]);

  // ownership + listings → feature-state and rooftop markers
  // Subscribe to a paint signature, not `game` identity — see mapPaintSig.
  const paintSig = useStore((s) => mapPaintSig(s.game));
  useEffect(() => {
    const game = useStore.getState().game;
    const map = mapRef.current;
    if (!map || !mapReady || !game || !parcels) return;
    const setState = (bbl: string, state: Record<string, boolean>) => {
      const id = Number(bbl);
      map.setFeatureState({ source: "bw-parcels", id }, state);
      map.setFeatureState({ source: "bw-buildings", id }, state);
    };
    const nowOwned = new Set(Object.keys(game.holdings));
    for (const bbl of ownedRef.current) if (!nowOwned.has(bbl)) setState(bbl, { owned: false });
    for (const bbl of nowOwned) if (!ownedRef.current.has(bbl)) setState(bbl, { owned: true });
    ownedRef.current = nowOwned;
    // ...and on the buildings themselves: the gold roof (RealCityLayer
    // setOwned). Every deed of an assemblage you hold is yours, so the
    // folded children are gilded with their parent.
    //
    // THE PARAPET ALSO SAYS WHAT THE DEED IS DOING, off the same records the
    // desks read: a sale instruction on the holding (listed — the band
    // breathes), a covenant sweep on its senior or mezz paper (rust: the cash
    // is trapped), a workout file open with the lender (red: notice,
    // forbearance or foreclosure). Nothing here is inferred; each is a field
    // the engine already keeps and the Portfolio page already prints.
    {
      const gilt = new Set(nowOwned);
      const status = new Map<string, { listed?: boolean; distress?: 0 | 1 | 2 }>();
      for (const h of Object.values(game.holdings)) {
        const distress: 0 | 1 | 2 = game.workouts?.[h.bbl] ? 2 : (h.loan?.sweep || h.mezz?.sweep) ? 1 : 0;
        // an unsolicited approach is somebody else's idea — not a listing
        const listed = !!h.sale && !h.sale.unsolicited;
        if (listed || distress) status.set(h.bbl, { listed, distress });
      }
      for (const [child, parent] of Object.entries(game.merged ?? {})) {
        if (!nowOwned.has(parent)) continue;
        gilt.add(child);
        const st = status.get(parent);
        if (st) status.set(child, st);
      }
      threeRef.current?.setOwned(gilt, status);
    }

    const nowListed = new Set(game.listings.map((l) => l.bbl));
    for (const h of Object.values(game.holdings)) if (h.sale) nowListed.add(h.bbl);
    for (const bbl of listedRef.current) if (!nowListed.has(bbl)) setState(bbl, { listed: false });
    for (const bbl of nowListed) if (!listedRef.current.has(bbl)) setState(bbl, { listed: true });
    listedRef.current = nowListed;

    // Teal join on every multi-deed site — children plus their parents.
    const nowAssembled = new Set<string>();
    for (const [child, parent] of Object.entries(game.merged ?? {})) {
      nowAssembled.add(child);
      nowAssembled.add(parent);
    }
    for (const bbl of assembledRef.current) if (!nowAssembled.has(bbl)) setState(bbl, { assembled: false });
    for (const bbl of nowAssembled) if (!assembledRef.current.has(bbl)) setState(bbl, { assembled: true });
    assembledRef.current = nowAssembled;

    const src = map.getSource("bw-owned") as maplibregl.GeoJSONSource | undefined;
    src?.setData({
      type: "FeatureCollection",
      features: [...nowOwned].map((bbl) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: parcels[bbl]?.centroid ?? [0, 0] },
        properties: { bbl },
      })),
    });

    // Everything that can be bought right now, pinned over its roof: red for a
    // building on the tape, green for vacant land, violet for a motivated
    // seller priced under appraisal. Reading availability off the map is most of the
    // early game, and a 16%-opacity ground tint under a tower was invisible.
    const forSale = map.getSource("bw-forsale") as maplibregl.GeoJSONSource | undefined;
    forSale?.setData({
      type: "FeatureCollection",
      features: game.listings.map((l) => {
        const rec = parcels[l.bbl];
        return {
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: rec?.centroid ?? [0, 0] },
          properties: {
            bbl: l.bbl,
            kind: l.distress ? "offmkt" : rec?.class === "land" ? "land" : "built",
          },
        };
      }),
    });

    const civic = map.getSource("bw-civic") as maplibregl.GeoJSONSource | undefined;
    civic?.setData(civicCollection(
      game,
      parcels,
      city?.parcelFeatures as GeoJSON.FeatureCollection | undefined,
      city?.context as GeoJSON.FeatureCollection | null,
    ) as never);
  }, [paintSig, parcels, mapReady, city]);

  const lens = useStore((s) => s.lens);

  // Live demand into feature-state, so the demand and land lenses paint what
  // the engine is actually pricing off. Only blocks that have MOVED are pushed
  // — on day one that is none of them, and after a century it is a few hundred
  // parcels, written once per month and only while a lens is open.
  const dmdRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    const game = useStore.getState().game;
    const map = mapRef.current;
    if (!map || !mapReady || !game || !parcels) return;
    if (lens !== "demand" && lens !== "land") return;
    const drift = game.blockD ?? {};
    const next = new Map<string, number>();
    for (const bbl of Object.keys(parcels)) {
      const r = parcels[bbl];
      const d = drift[r.block];
      if (!d) continue;
      next.set(bbl, Math.max(2, Math.min(100, r.demandScore + d)));
    }
    for (const [bbl, v] of next) {
      if (dmdRef.current.get(bbl) === v) continue;
      map.setFeatureState({ source: "bw-parcels", id: Number(bbl) }, { dmd: v });
    }
    for (const bbl of dmdRef.current.keys()) {
      if (!next.has(bbl)) map.removeFeatureState({ source: "bw-parcels", id: Number(bbl) }, "dmd");
    }
    dmdRef.current = next;
  }, [paintSig, parcels, mapReady, lens]);

  // THE ZONING LENS PAINTS ROOM, NOT RULES.
  //
  // A map of zone districts tells you what the code says. It does not tell you
  // anything you can act on, because the code is the same on the corner that
  // was built out in 1912 and the one beside it carrying a parking lot. The
  // question a developer actually asks is the DIFFERENCE between them: how
  // much more could stand here than does?
  //
  // So this pushes the UNUSED SHARE OF THE ENVELOPE — one minus built FAR over
  // allowed FAR — which is the redevelopment surface, and it moves. It moves
  // when the board upzones a district, when a variance is won on one lot, when
  // something is landmarked and its remaining envelope goes to zero, and when
  // anybody finishes a building. Every one of those is a thing the player did
  // or a thing that happened to them, and none of them is visible on a map of
  // zone letters.
  const zoneRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    const game = useStore.getState().game;
    const map = mapRef.current;
    if (!map || !mapReady || !game || !parcels) return;
    if (lens !== "zoning") return;
    const next = new Map<string, number>();
    for (const bbl of Object.keys(parcels)) {
      const rec = resolveRec(parcels, game, bbl);
      if (!rec || !rec.lotArea) continue;
      // The RESOLVED envelope: the district's multiplier, anything won at a
      // hearing on this lot, and nothing at all if it has been landmarked.
      const far = Math.max(rec.farMaxComm, rec.farMaxRes);
      if (!(far > 0)) { next.set(bbl, 0); continue; }        // landmarked: no room, and that is the point
      const used = rec.bldgArea / (rec.lotArea * far);
      next.set(bbl, Math.round(100 * Math.max(0, Math.min(1, 1 - used))));
    }
    for (const [bbl, v] of next) {
      if (zoneRef.current.get(bbl) === v) continue;
      map.setFeatureState({ source: "bw-parcels", id: Number(bbl) }, { room: v });
    }
    for (const bbl of zoneRef.current.keys()) {
      if (!next.has(bbl)) map.removeFeatureState({ source: "bw-parcels", id: Number(bbl) }, "room");
    }
    zoneRef.current = next;
  }, [paintSig, parcels, mapReady, lens]);

  // LEASE LENS — months to the next expiry on buildings you own.
  // Bright = soon (rollover risk); dark = long WALT. Unowned lots stay mute.
  const leaseRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    const game = useStore.getState().game;
    const map = mapRef.current;
    if (!map || !mapReady || !game || !parcels) return;
    if (lens !== "leases") return;
    const next = new Map<string, number>();
    for (const h of Object.values(game.holdings)) {
      if (h.groundLeased || !h.tenants?.length) continue;
      let soonest = Infinity;
      for (const t of h.tenants) {
        const left = t.endM - game.month;
        if (left >= 0 && left < soonest) soonest = left;
      }
      if (!Number.isFinite(soonest)) continue;
      // 0–24 months mapped to 100–0 (bright when near). Beyond 24 → 0 (dark).
      next.set(h.bbl, Math.round(100 * Math.max(0, 1 - Math.min(24, soonest) / 24)));
    }
    for (const [bbl, v] of next) {
      if (leaseRef.current.get(bbl) === v) continue;
      map.setFeatureState({ source: "bw-parcels", id: Number(bbl) }, { leaseSoon: v });
    }
    for (const bbl of leaseRef.current.keys()) {
      if (!next.has(bbl)) map.removeFeatureState({ source: "bw-parcels", id: Number(bbl) }, "leaseSoon");
    }
    leaseRef.current = next;
  }, [paintSig, parcels, mapReady, lens]);

  // VACANCY LENS — how full every building is, as per cent occupied.
  // Your own buildings read off the rent roll; everyone else's off the same
  // market occupancy the lit windows show. Land and empty lots carry nothing.
  const vacRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    const game = useStore.getState().game;
    const map = mapRef.current;
    if (!map || !mapReady || !game || !parcels) return;
    if (lens !== "vacancy") return;
    const next = new Map<string, number>();
    for (const bbl of Object.keys(parcels)) {
      const rec = resolveRec(parcels, game, bbl);
      if (!rec || rec.class === "land" || !rec.bldgArea) continue;
      const h = game.holdings[bbl];
      const occ = h && !h.groundLeased ? physicalOcc(rec, h) : occupancy(rec, game.econ);
      next.set(bbl, Math.round(100 * Math.max(0, Math.min(1, occ))));
    }
    for (const [bbl, v] of next) {
      if (vacRef.current.get(bbl) === v) continue;
      map.setFeatureState({ source: "bw-parcels", id: Number(bbl) }, { occPct: v });
    }
    for (const bbl of vacRef.current.keys()) {
      if (!next.has(bbl)) map.removeFeatureState({ source: "bw-parcels", id: Number(bbl) }, "occPct");
    }
    vacRef.current = next;
  }, [paintSig, parcels, mapReady, lens]);

  // name labels: districts, parks, water — DOM markers, no glyph server needed.
  // Photo frame silences them with the rest of the chrome: a model photograph
  // has no captions. They come back with the effect re-run on exit.
  //
  // KEPT, NOT REBUILT. This effect keys on the paint signature (a new civic
  // work can add a name), and it used to tear down and re-create every label
  // in the city each time the month turned — a hundred DOM nodes destroyed and
  // re-inserted, and every one of them flashing through its opacity
  // transition, for a change that is almost always no change at all. Labels
  // now live in a keyed map across runs: a name that is still wanted keeps its
  // node, a new one is added, a gone one removed.
  //
  // AND THEY SCALE WITH THE ZOOM, a little. A fixed-size label is a big label
  // over a small city on the wide shot and a small label over a big street at
  // the dive; a gentle scale (0.85x to 1.2x over the playable range) keeps the
  // names in proportion to the places they name without ever becoming
  // unreadable or shouting. Applied to an inner span, because MapLibre owns
  // the marker element's transform.
  const photoFrame = useStore((s) => s.photoFrame);
  const labelsRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const live = labelsRef.current;
    const want = new Map<string, { name: string; cls: string; ll: [number, number] }>();
    if (!photoFrame) {
      const fc = city?.context as { features: { geometry: { type: string; coordinates: [number, number] }; properties: Record<string, string> }[] } | null;
      for (const f of fc?.features ?? []) {
        if (f.properties.kind !== "label") continue;
        const cls = "map-label map-label-" + f.properties.labelKind;
        want.set(cls + "|" + f.properties.name + "|" + f.geometry.coordinates.join(","),
          { name: f.properties.name, cls, ll: f.geometry.coordinates });
      }
      const game = useStore.getState().game;
      const parcelsNow = useStore.getState().parcels;
      if (game && parcelsNow) {
        const civic = civicCollection(
          game, parcelsNow,
          city?.parcelFeatures as GeoJSON.FeatureCollection | undefined,
          city?.context as GeoJSON.FeatureCollection | null,
        );
        for (const f of civic.features) {
          const name = f.properties?.name as string | undefined;
          if (!name) continue;
          let ll: [number, number] | null = null;
          if (f.geometry.type === "Point") ll = f.geometry.coordinates as [number, number];
          else if (f.geometry.type === "Polygon") {
            const ring = f.geometry.coordinates[0] as [number, number][];
            let cx = 0, cy = 0;
            for (const p of ring) { cx += p[0]; cy += p[1]; }
            ll = [cx / ring.length, cy / ring.length];
          }
          if (!ll) continue;
          const cls = "map-label map-label-civic";
          want.set(cls + "|" + name + "|" + ll[0].toFixed(6) + "," + ll[1].toFixed(6), { name, cls, ll });
        }
      }
    }
    for (const [key, mk] of live) {
      if (!want.has(key)) { mk.remove(); live.delete(key); }
    }
    for (const [key, w] of want) {
      if (live.has(key)) continue;
      const el = document.createElement("div");
      el.className = w.cls;
      const span = document.createElement("span");
      span.style.display = "inline-block";
      span.style.transformOrigin = "50% 50%";
      span.style.transform = "scale(var(--bw-label-scale, 1))";
      span.textContent = w.name;
      el.appendChild(span);
      live.set(key, new maplibregl.Marker({ element: el }).setLngLat(w.ll).addTo(map));
    }
    // NAMES DO NOT STACK. A station named for its road and the road's second
    // station both said "Harthy Walk" a hundred pixels apart, and a park
    // label sat across a district name. Labels are DOM, so nothing in MapLibre
    // collides them: after each move they are placed in priority order
    // (district, station, civic, park, water) and one is held back when its
    // box overlaps a label already placed, or when the same name is already
    // showing close by. It re-runs on moveend, not every frame, so a pan
    // never pays for it.
    const RANK: Record<string, number> = { district: 0, station: 1, civic: 2, park: 3, water: 4 };
    const kindOf = (el: HTMLElement) => el.className.includes("district") ? "district"
      : el.className.includes("park") ? "park"
      : el.className.includes("civic") ? "civic"
      : el.className.includes("station") ? "station"
      : "water";
    // ON THE INNER SPAN, NOT THE MARKER. MapLibre's Marker owns its element's
    // opacity — it rewrites it on every move for its own occlusion test — so
    // the zoom fade written there was undone the next frame, and it had never
    // worked: district names stood over the street at the dive. The span is
    // ours, and fading it leaves MapLibre's write alone.
    const setOp = (el: HTMLElement, o: string) => {
      const sp = el.firstElementChild as HTMLElement | null;
      if (sp && sp.style.opacity !== o) sp.style.opacity = o;
    };
    const fade = () => {
      const z = map.getZoom();
      map.getContainer().style.setProperty("--bw-label-scale",
        String(Math.max(0.85, Math.min(1.2, 0.85 + (z - 13.4) * 0.12))));
      const placed: { x0: number; y0: number; x1: number; y1: number; name: string; cx: number; cy: number }[] = [];
      const cand: { el: HTMLElement; rank: number; m: maplibregl.Marker }[] = [];
      for (const m of live.values()) {
        const el = m.getElement();
        const kind = kindOf(el);
        const on =
          kind === "district" ? z >= 12.2 && z <= 15.6 :
          kind === "park" ? z >= 13.2 :
          kind === "station" || kind === "civic" ? z >= 13.6 :
          z <= 14.5;
        if (on) cand.push({ el, rank: RANK[kind], m });
        else setOp(el, "0");
      }
      cand.sort((a, b) => a.rank - b.rank);
      const scale = Math.max(0.85, Math.min(1.2, 0.85 + (z - 13.4) * 0.12));
      for (const c of cand) {
        const p = map.project(c.m.getLngLat());
        // measured once: the text never changes, and reading layout for a
        // hundred nodes on every zoom tick is how a label pass gets slow
        if (!c.el.dataset.w && c.el.offsetWidth) { c.el.dataset.w = String(c.el.offsetWidth); c.el.dataset.h = String(c.el.offsetHeight); }
        const w = (+(c.el.dataset.w ?? 0) || 60) * scale * 0.5 + 4, h = (+(c.el.dataset.h ?? 0) || 14) * scale * 0.5 + 2;
        const box = { x0: p.x - w, y0: p.y - h, x1: p.x + w, y1: p.y + h, name: (c.el.textContent ?? "").toLowerCase(), cx: p.x, cy: p.y };
        const clash = placed.some((q) =>
          (box.x0 < q.x1 && box.x1 > q.x0 && box.y0 < q.y1 && box.y1 > q.y0) ||
          (q.name === box.name && Math.hypot(q.cx - box.cx, q.cy - box.cy) < 320));
        const o = clash ? "0" : "1";
        if (!clash) placed.push(box);
        setOp(c.el, o);
      }
    };
    map.on("zoom", fade);
    map.on("moveend", fade);
    fade();
    return () => {
      // the zoom listener used to outlive its markers — every paintSig tick
      // left one more orphaned fade() walking a dead marker list
      map.off("zoom", fade);
      map.off("moveend", fade);
    };
  }, [mapReady, city, paintSig, photoFrame]);
  // the markers themselves go only with the map
  useEffect(() => () => {
    for (const m of labelsRef.current.values()) m.remove();
    labelsRef.current.clear();
  }, [city]);

  // SELECTION AND HOVER ARE LIGHT, NOT PAINT. They used to be tints in the
  // effect below: the picked site multiplied by [1.5, 1.14, 0.5], which turned
  // any building — brick, limestone, blue glass — into the same mustard slab
  // at exactly the moment the player had asked to look at it. The shader now
  // draws a gold rim, a gilt parapet and a slow scan up the facade instead
  // (RealCityLayer setHighlight), and the building keeps its own face.
  //
  // Its own effect, too: the tint pass below walks the whole owner index, and
  // it used to re-run on every mouse move because hover was one of its keys.
  const hoveredBBL = useStore((s) => s.hoveredBBL);
  const mapFilter = useStore((s) => s.mapFilter);
  useEffect(() => {
    const layer = threeRef.current;
    if (!layer || !mapReady) return;
    const game = useStore.getState().game;
    const site = selectedBBL ? (game ? siteDeeds(game, selectedBBL) : [selectedBBL]) : [];
    layer.setHighlight(site, hoveredBBL && !site.includes(hoveredBBL) ? hoveredBBL : null);
  }, [selectedBBL, hoveredBBL, mapReady, mergedN]);

  // mesh tints: teal neighbors, the owners lens, the market. Ownership is the
  // gilt band on the building itself, not a yellow wash — a building you own
  // still shows the masonry or glass it was built with.
  useEffect(() => {
    const game = useStore.getState().game;
    const layer = threeRef.current;
    if (!layer || !mapReady) return;
    const tints = new Map<string, [number, number, number]>();
    if (game) for (const l of game.listings) tints.set(l.bbl, [1.24, 0.9, 0.84]);   // on the market
    // THE OWNERS LENS. Who holds what, across the whole town, in one look —
    // a book is a shape on a map, and reading that shape is how you work out
    // what somebody is assembling and where they will not sell.
    //
    // EVERY DEED, NOT JUST THE FIRMS'. This painted `game.rivals` and stopped,
    // which left nine buildings in ten uncoloured under a lens named for
    // ownership — the map making the same claim the parcel card used to make,
    // that most of the city belongs to nobody worth naming. The register
    // answers for all of it now, so the lens does too: firms keep their
    // per-firm tints because they are who you compete with, and the private
    // stock is painted by KIND, which is what a city-wide ownership picture is
    // actually read for.
    if (game && parcels && lens === "owners") {
      const idx = ownerIndex(game, parcels);
      for (const [id, book] of idx.books) {
        const r = idx.rivals.get(id);
        if (r) {
          const c = FIRM_TINT[(game.rivals ?? []).indexOf(r) % FIRM_TINT.length];
          for (const b of book) tints.set(b, c);
          continue;
        }
        const h = holderOf(game, parcels, book[0]);
        const c = h ? HOLDER_TINT[h.kind] : undefined;
        if (c) for (const b of book) tints.set(b, c);
      }
    }
    // Assembled plates get a soft teal lift on the mesh so the join is
    // readable in 3D, not only on the MapLibre lot lines.
    if (game) {
      for (const [child, parent] of Object.entries(game.merged ?? {})) {
        tints.set(child, [0.78, 1.14, 1.12]);
        tints.set(parent, [0.82, 1.16, 1.14]);
      }
    }
    if (selectedBBL) {
      const site = game ? siteDeeds(game, selectedBBL) : [selectedBBL];
      const siteSet = new Set(site);
      for (const d of site) {
        for (const n of adjacency?.[d] ?? []) {
          if (!siteSet.has(n)) tints.set(n, [0.72, 1.12, 1.04]);
        }
      }
      // the site itself is lit by setHighlight, and keeps its own colour
      for (const d of site) tints.delete(d);
    }

    // Map filter: dim everything outside the book / crane set without hiding it.
    if (game && mapFilter !== "all") {
      const keep = new Set<string>();
      if (mapFilter === "owned") {
        for (const bbl of Object.keys(game.holdings)) keep.add(bbl);
      } else {
        for (const d of Object.values(game.developments ?? {})) keep.add(d.bbl);
        for (const j of game.cityJobs ?? []) keep.add(j.bbl);
      }
      for (const bbl of layer.rangesByBBL.keys()) {
        if (keep.has(bbl)) continue;
        const cur = tints.get(bbl) ?? [1, 1, 1];
        tints.set(bbl, [cur[0] * 0.55, cur[1] * 0.55, cur[2] * 0.55]);
      }
    }
    layer.setTints(tints);
  }, [selectedBBL, adjacency, paintSig, mapReady, lens, mapFilter, parcels]);

  // THE CITY'S VACANCY, ON THE CITY.
  //
  // Nothing about the economy reached the map. You could own half the
  // waterfront and be bleeding on every foot of it and the picture would be
  // identical to the picture of a full book, so the simulation and the thing
  // filling the screen were two objects sharing a window. A principal does not
  // open a spreadsheet to find out which of his towers is empty — he looks at
  // it, and then he looks at everybody else's.
  //
  // Your own buildings report the truth off the rent roll, to the square foot.
  // Everything else reports what the model says a building of that class, on
  // that corner, in that condition is running at — which is not cheating,
  // because a half-dark building is the most public fact in real estate. It
  // moves with the cycle, so a glut arrives on the map as the city going dark
  // a district at a time, and you can watch it happen from the air.
  useEffect(() => {
    const game = useStore.getState().game;
    const layer = threeRef.current;
    if (!layer || !mapReady || !game || !parcels) return;
    const occ = new Map<string, number>();
    // ...and the shops separately, because a full office tower can still have
    // a dead ground floor, and the street knows the difference.
    const ret = new Map<string, number>();
    // ...and the condition index every price reader in the engine uses: the
    // holding's own where it is yours, the age-derived reading elsewhere.
    const cond = new Map<string, number>();
    for (const bbl of layer.rangesByBBL.keys()) {
      const h = game.holdings[bbl];
      const rec = resolveRec(parcels, game, bbl);
      if (!rec || rec.class === "land" || !rec.bldgArea) continue;
      cond.set(bbl, condIdxOf(rec, game.month, h?.condition, h));
      if (h) {
        const leased = h.tenants.reduce((n, t) => n + t.sf, 0);
        occ.set(bbl, Math.max(0, Math.min(1, leased / Math.max(1, rec.bldgArea))));
      } else {
        occ.set(bbl, occupancy(rec, game.econ));
      }
      const retailSf = useSf(rec, "retail");
      if (retailSf > 300) {
        if (h) {
          const let_ = h.tenants.reduce((n, t) => n + ((t.use ?? rec.class) === "retail" ? t.sf : 0), 0);
          ret.set(bbl, Math.max(0, Math.min(1, let_ / retailSf)));
        } else {
          ret.set(bbl, useOccupancy(rec, game.econ, "retail"));
        }
      }
    }
    // BLOCK TROUBLE AS A LOOK. One dark shop is noise; a street with three
    // empty bays is what you see from the air months before the Economy page
    // moves. Fold retail occupancy by block and write the block mean onto
    // every shopfront on that block — same shader, legible neighbourhood.
    {
      const byBlock = new Map<string, { sum: number; n: number; bbls: string[] }>();
      for (const [bbl, v] of ret) {
        const rec = resolveRec(parcels, game, bbl);
        if (!rec?.block) continue;
        const row = byBlock.get(rec.block) ?? { sum: 0, n: 0, bbls: [] };
        row.sum += v;
        row.n++;
        row.bbls.push(bbl);
        byBlock.set(rec.block, row);
      }
      for (const row of byBlock.values()) {
        if (row.n < 2) continue;
        const mean = row.sum / row.n;
        for (const bbl of row.bbls) ret.set(bbl, mean);
      }
    }
    layer.setOccupancy(occ);
    layer.setRetail(ret);
    layer.setCondition(cond);
    // the courthouse on the door: auction lots, noticed foreclosures, and
    // owned balloons inside eighteen months — cycle risk on the skyline.
    const notices = new Set<string>();
    for (const l of game.auction?.lots ?? []) if (game.month < (game.auction?.m ?? 0)) notices.add(l.bbl);
    for (const f of game.bankFcls ?? []) notices.add(f.bbl);
    for (const h of Object.values(game.holdings)) {
      if (!h.loan) continue;
      const mo = h.loan.maturityM - game.month;
      if (mo > 0 && mo <= 18) notices.add(h.bbl);
    }
    layer.setNotices([...notices]);
    // THE BROKER'S BOARD, only where a real listing would put one up. A
    // house broker's first look (earlyUntilM) is a phone call, not a sign;
    // your own quiet listing is a number waiting for someone to ring. A
    // marketed campaign, and anything on the open tape, is on the street.
    const onTape = game.listings
      .filter((l) => !(l.earlyUntilM !== undefined && game.month < l.earlyUntilM))
      .map((l) => l.bbl);
    const mine = Object.values(game.holdings)
      .filter((h) => h.sale && !h.sale.unsolicited && h.sale.mode === "marketed")
      .map((h) => h.bbl);
    layer.setForSale(onTape.sort(), mine.sort());
  }, [paintSig, mapReady, parcels, city]);

  // player construction and city growth onto the skyline
  const dynSigRef = useRef("");
  useEffect(() => {
    const game = useStore.getState().game;
    const layer = threeRef.current;
    if (!layer || !mapReady || !game) return;
    // ONE FLOOR-TO-FLOOR, BECAUSE A STOREY IS A STOREY.
    //
    // The player's buildings extruded at 3.4 m a floor and the generator's city
    // at 3.55 (citygen.mjs:1250 and :1643), so the same twenty-storey building
    // stood three metres shorter if the player put it up — the same quantity
    // with two answers, in the one place the two populations stand next to each
    // other and get compared by eye. 3.55 is the city's, and the city is the
    // thing there is more of.
    const FLOOR_M = 3.55;
    // THE YEAR IT WAS FINISHED, because that is what decides what it looks
    // like. The renderer used to guess — every building the player or a rival
    // put up was painted somewhere in a hard-coded 1992-2017 band, whatever
    // year the campaign was actually in — and it chose its facade off class
    // alone. The renderer's familyFor answers both, and it needs the year to
    // give them.
    const nowYear = START_YEAR + Math.floor(game.month / 12);
    const items: { bbl: string; cls: string; heightM: number; floors: number; construction: boolean; fresh?: boolean; cov?: number; year?: number; design?: BuildingDesign }[] = [];
    for (const d of Object.values(game.developments ?? {})) {
      const total = Math.max(1, d.deliverM - d.startM);
      const prog = Math.min(1, Math.max(0.15, (game.month - d.startM + 1) / total));
      items.push({ bbl: d.bbl, cls: d.use, heightM: d.floors * FLOOR_M * prog, floors: d.floors, construction: true, cov: d.coverage, year: nowYear });
    }
    // EVERYBODY ELSE'S CRANES. The city's pipeline was invisible until the day
    // it opened, so the supply you were reading about on the Economy page had
    // no presence on the map at all — and a rival's tower going up across the
    // street from your lease-up is the single most legible thing in this
    // business. An orphaned frame stops rising and stands there.
    for (const j of game.cityJobs ?? []) {
      if (game.built?.[j.bbl] || game.developments?.[j.bbl]) continue;
      const total = Math.max(1, j.deliverM - j.startM);
      const raw = (game.month - j.startM + 1) / total;
      const prog = Math.min(1, Math.max(0.12, j.orphaned ? Math.min(raw, 0.75) : raw));
      // EVERY CRANE IN THE CITY IS DRAWN AT 61% COVERAGE, and that is a gap
      // rather than a decision. The player's jobs carry the footprint they were
      // dialled at; a rival's pipeline entry does not carry one at all, so the
      // renderer falls back to the old flat 0.78 inset for all of them and the
      // whole rival population has one footprint. Read optionally so the moment
      // the pipeline records the coverage it was planned at, the rivals get
      // honest plates with no change here. Deriving it from `sf / floors /
      // lotArea` was considered and refused: rentable is not gross, so that
      // would be a SECOND answer to a quantity the planner already has.
      const jcov = (j as { coverage?: number }).coverage;
      items.push({ bbl: j.bbl, cls: j.use, heightM: j.floors * FLOOR_M * prog, floors: j.floors, construction: true, year: nowYear, cov: jcov });
    }
    for (const [bbl, b] of Object.entries(game.built ?? {})) {
      if (game.developments?.[bbl]) continue; // conversion shell is represented by the construction massing
      // bunting for the first three months after delivery — a grand opening
      const dM = game.holdings[bbl]?.deliveredM;
      const fresh = dM !== undefined && game.month - dM <= 3;
      // b.yearBuilt is the delivery year the engine stamped. A building keeps
      // the skin of the decade it went up in for the rest of the campaign;
      // it does not restyle itself as the years pass.
      items.push({ bbl, cls: b.class, heightM: b.floors * FLOOR_M, floors: b.floors, construction: false, fresh, cov: b.cov, year: b.yearBuilt || nowYear, design: b.design });
    }
    // AN ASSEMBLED SITE IS ONE BUILDING ON SEVERAL DEEDS. The massing lives on
    // the parent lot; without this a tower built on three merged lots rose out
    // of one of them while the other two stayed conspicuously empty, which is
    // the opposite of what assembling them was for.
    const merged = game.merged ?? {};
    if (Object.keys(merged).length) {
      const byParent = new Map(items.map((i) => [i.bbl, i]));
      for (const [child, parent] of Object.entries(merged)) {
        const p = byParent.get(parent);
        if (p) items.push({ ...p, bbl: child });
      }
    }
    // meshes are rebuilt only when the skyline actually changed. Construction
    // height is in this string so a rising frame still updates; setPlayerBuildings
    // keeps finished stock on its own layer so that monthly growth does not
    // remesh every delivered tower.
    const sig = items.map((i) => i.bbl + ":" + i.heightM.toFixed(1) + (i.construction ? "c" : "") + (i.fresh ? "f" : "") + (i.design ? JSON.stringify(i.design) : "")).join("|");
    if (sig !== dynSigRef.current) {
      dynSigRef.current = sig;
      layer.setPlayerBuildings(items);
    }
    const parcelsNow = useStore.getState().parcels;
    const cityNow = useStore.getState().city;
    if (parcelsNow) {
      layer.setCivicWorks(civicWorks3d(
        game,
        parcelsNow,
        cityNow?.parcelFeatures as GeoJSON.FeatureCollection | undefined,
        cityNow?.context as GeoJSON.FeatureCollection | null,
      ));
    }
  }, [paintSig, mapReady]);

  const gameMonth = useStore((s) => s.game?.month ?? 0);
  const visualGame = useStore.getState().game;
  const cityVisual = visualGame
    ? cityVisualState(visualGame)
    : { weather: "clear" as const, precipitation: 0, overcast: 0, activity: 1 };
  useEffect(() => {
    if (!mapReady) return;
    threeRef.current?.setMonth(gameMonth);
    // the yards follow the leaf (style.ts blocksPaint) — same vigour ladder
    // the 3D lawns and trees read off the month
    const LEAF = [0, 0, 0.12, 0.55, 0.9, 1, 1, 0.96, 0.82, 0.52, 0.16, 0.02];
    const mo = ((Math.floor(gameMonth) % 12) + 12) % 12;
    const map = mapRef.current;
    const snowLying = cityVisual.weather === "snow" ? 0.35 + cityVisual.precipitation * 0.55 : 0;
    if (map?.getLayer("blocks")) map.setPaintProperty("blocks", "fill-color", blocksPaint(LEAF[mo], snowLying) as never);
    if (map?.getLayer("parks")) map.setPaintProperty("parks", "fill-color", parksPaint(snowLying) as never);
    if (map?.getLayer("median")) {
      const m0 = [0xa8, 0xbd, 0x93], sn = [234, 238, 241];
      map.setPaintProperty("median", "fill-color", "#" + m0.map((v, i) => Math.round(v + (sn[i] - v) * snowLying).toString(16).padStart(2, "0")).join(""));
    }
  }, [gameMonth, mapReady, cityVisual.weather, cityVisual.precipitation]);
  useEffect(() => {
    if (!mapReady) return;
    threeRef.current?.setActivity(cityVisual.activity);
  }, [cityVisual.activity, mapReady]);
  // THE SCHEME ON THE DESK: while the Build desk's Design tab is open, the
  // building is drawn finished on its lot in the look being chosen.
  const designPreview = useStore((s) => s.designPreview);
  useEffect(() => {
    if (!mapReady) return;
    const layer = threeRef.current as unknown as { setPreview?: (i: unknown) => void } | null;
    if (!layer?.setPreview) return;
    const p = designPreview;
    const month = useStore.getState().game?.month ?? 0;
    const FLOOR_M = 3.55;   // the storey the skyline effect below draws player stock at
    layer.setPreview(p ? {
      bbl: p.bbl, cls: p.use, heightM: p.floors * FLOOR_M, floors: p.floors, construction: false,
      cov: p.cov, year: START_YEAR + Math.floor(month / 12), design: p.design,
    } : null);
  }, [designPreview, mapReady]);
  // THE HOUR. Always the calibrated afternoon every colour in the renderer
  // was tuned under. There used to be a dusk cycle while Play ran and a
  // blue-hour photo frame; the owner's call: "we don't need a night mode,
  // that's pointless". Both renderers still accept setDayPhase; nothing
  // drives it off zero. The month still owns the sun's angle and the season.
  useEffect(() => {
    if (!mapReady) return;
    threeRef.current?.setDayPhase(0);
  }, [mapReady]);
  const graphics = useStore((s) => s.graphics);
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    threeRef.current?.setQuality(graphics);
    // The pixel ratio is pinned explicitly, so MapLibre will NOT follow the
    // display on its own: browser zoom, or dragging the window to a screen of
    // a different density, left the canvas at the old ratio and the browser
    // upscaled it. Re-pin whenever devicePixelRatio changes.
    let mq: MediaQueryList | null = null;
    const apply = () => {
      const dpr = window.devicePixelRatio || 1;
      const want = ratioFor(graphics, dpr);
      if (map && map.getPixelRatio() !== want) map.setPixelRatio(want);
      mq?.removeEventListener("change", apply);
      mq = window.matchMedia(`(resolution: ${dpr}dppx)`);
      mq.addEventListener("change", apply);
    };
    apply();
    return () => mq?.removeEventListener("change", apply);
  }, [graphics, mapReady]);
  useEffect(() => {
    if (!mapReady) return;
    threeRef.current?.setWeather(
      cityVisual.weather,
      cityVisual.precipitation,
      cityVisual.overcast,
    );
    const map = mapRef.current;
    if (map) {
      // one sky, one light — the constants live in style.ts beside the style
      // that opens on them, so a weather tick can never revert a sky retune
      const cloud = cityVisual.overcast;
      map.setSky(skySpec(cloud) as never);
      map.setLight(lightSpec(cloud) as never);
    }
  }, [cityVisual.weather, cityVisual.precipitation, cityVisual.overcast, mapReady]);

  // lenses — repaint when toggled and as the market moves
  //
  // THE CITY STAYS UP UNDER A LENS. Every analysis lens used to call
  // ghostBuildings(true): the whole three.js layer switched off and flat grey
  // MapLibre extrusions stood in for it, so the moment you asked where the
  // demand was, the buildings the demand was FOR disappeared — and with them
  // every cue (height, age, what is already standing) that makes a heat map
  // mean anything. The layer now stays, desaturates its walls and paints the
  // ROOFS with the same ramp the ground carries (RealCityLayer.setLens), so
  // the heat map covers the whole city seen from above rather than the gaps
  // between its buildings.
  //
  // AND EVERY BRANCH STARTS FROM THE DEFAULTS. The old shape restored the
  // default paint only in the final else, so moving from one lens straight to
  // another inherited whatever the first had set — the listings lens recoloured
  // the lot lines red and nothing ever put them back, even on the way out to
  // no lens at all. Reset, then override: a lens is only ever its own paint.
  useEffect(() => {
    const game = useStore.getState().game;
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const layer = threeRef.current;
    if (layer) {
      // the flat extrusions are the no-mesh fallback only
      map.setLayoutProperty("bw-bldg-3d", "visibility", "none");
    }
    // ---- reset: every property any lens touches, straight from the style
    {
      const defs = gameLayers();
      const paintOf = (id: string, prop: string) => {
        const l = defs.find((x) => x.id === id);
        return l && "paint" in l && l.paint ? (l.paint as Record<string, unknown>)[prop] : undefined;
      };
      const layoutOf = (id: string, prop: string) => {
        const l = defs.find((x) => x.id === id);
        return l && "layout" in l && l.layout ? (l.layout as Record<string, unknown>)[prop] : undefined;
      };
      for (const [id, prop] of [
        ["bw-parcel-fill", "fill-color"], ["bw-parcel-fill", "fill-opacity"],
        ["bw-parcel-line", "line-color"], ["bw-bldg-3d", "fill-extrusion-opacity"],
      ] as const) {
        if (map.getLayer(id)) map.setPaintProperty(id, prop, paintOf(id, prop) as never);
      }
      for (const id of ["bw-forsale-pts", "bw-forsale-halo"]) {
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", (layoutOf(id, "visibility") as "visible" | "none" | undefined) ?? "visible");
      }
    }
    // NEIGHBOURHOODS UNDER THE LENSES. The heat map answers "where is it hot"
    // but not "what is that place called", so while either market lens is up
    // the district names come up full-strength at every zoom (the CSS side of
    // the class below) and the seams between districts get a dashed line.
    // Both go away with the lens — the normal view keeps its clean model look.
    const hoods = lens === "demand" || lens === "land" || lens === "zoning" || lens === "leases" || lens === "vacancy";
    map.getContainer().classList.toggle("bw-lens-hoods", hoods);
    if (hoods && !map.getLayer("bw-hood-line")) {
      const cityNow = useStore.getState().city;
      const ctx = cityNow?.context as GeoJSON.FeatureCollection | null;
      // The same origin the 3D layer is pinned to — see CITY_CENTER. This one
      // only sets metres-per-degree for the seam merge, so being a few hundred
      // kilometres out is a slow drift rather than a catastrophe; it is read
      // from the city for the same reason all the same.
      const core = (cityNow?.manifest as unknown as CityFrame | undefined)?.core;
      map.addSource("bw-hoods", {
        type: "geojson",
        data: hoodBoundaries(ctx, Array.isArray(core) ? core : CITY_CENTER) as never,
      });
      map.addLayer({
        id: "bw-hood-line",
        type: "line",
        source: "bw-hoods",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#6b6250",
          "line-width": ["interpolate", ["linear"], ["zoom"], 13, 1.4, 16.5, 3] as never,
          "line-opacity": 0.5,
          "line-dasharray": [3, 2.4],
        },
      }, map.getLayer("bw-owned-pts") ? "bw-owned-pts" : undefined);
    }
    if (map.getLayer("bw-hood-line")) map.setLayoutProperty("bw-hood-line", "visibility", hoods ? "visible" : "none");

    // ONE RAMP, TWO SURFACES. Each lens's stops are its own (demand is
    // measured 2-100, the envelope in per cent, land in dollars), so the roof
    // is handed a position on [0, 1] with stop i at i/(n-1) — which is exactly
    // how the parcel fill's `interpolate` spaces the same colours — and the
    // roof over a lot and the lot around it come out the same colour.
    const toT = (v: number, stops: number[]) => {
      const n = stops.length;
      if (v <= stops[0]) return 0;
      for (let i = 0; i < n - 1; i++) {
        if (v <= stops[i + 1]) return (i + (v - stops[i]) / Math.max(1e-9, stops[i + 1] - stops[i])) / (n - 1);
      }
      return 1;
    };
    const roofLens = (vals: Map<string, number>, stops: number[], ramp: string[]) => {
      const t = new Map<string, number>();
      for (const [bbl, v] of vals) t.set(bbl, toT(v, stops));
      layer?.setLens(t, ramp);
    };

    if (lens === "demand" && parcels) {
      const stops = [5, 30, 50, 70, 92];
      const ramp = ["#eef0e8", "#cfe0d5", "#93c4b1", "#4f9887", "#1e6a60"];
      map.setPaintProperty("bw-parcel-fill", "fill-color", [
        "interpolate", ["linear"], LIVE_DEMAND,
        ...stops.flatMap((s, i) => [s, ramp[i]]),
      ] as never);
      map.setPaintProperty("bw-parcel-fill", "fill-opacity", 0.82 as never);
      // the same live figure the fill reads: the parcel's score plus its
      // block's drift, on the engine's own clamp
      const vals = new Map<string, number>();
      for (const bbl of Object.keys(parcels)) {
        const r = parcels[bbl];
        vals.set(bbl, Math.max(2, Math.min(100, r.demandScore + (game?.blockD?.[r.block] ?? 0))));
      }
      roofLens(vals, stops, ramp);
      return;
    }
    if (lens === "zoning" && game && parcels) {
      // Dark where the envelope is spent, bright where it is not. The ramp is
      // deliberately steep at the bottom: the difference between a lot that is
      // 95% built out and one that is 80% built out is the difference between
      // nothing and a deal, and a linear ramp buries it.
      const stops = [0, 10, 25, 50, 75, 100];
      const ramp = ["#3b3327", "#6b5836", "#9c7f3c", "#c9a23f", "#e3c766", "#f5e6a8"];
      map.setPaintProperty("bw-parcel-fill", "fill-color", [
        "interpolate", ["linear"], ["coalesce", ["feature-state", "room"], 0],
        ...stops.flatMap((s, i) => [s, ramp[i]]),
      ] as never);
      map.setPaintProperty("bw-parcel-fill", "fill-opacity", 0.85 as never);
      // zoneRef was filled by the zoning effect above, which runs first in
      // the same commit; a lot it has no number for is 0 on the fill too
      const vals = new Map<string, number>();
      for (const bbl of Object.keys(parcels)) vals.set(bbl, zoneRef.current.get(bbl) ?? 0);
      roofLens(vals, stops, ramp);
      return;
    }
    if (lens === "leases" && game && parcels) {
      // Mute lots with no state (−1); owned roll-risk paints warm. leaseSoon is 0–100.
      const stops = [0, 25, 50, 75, 100];
      const ramp = ["#3a3428", "#6b5230", "#b07a2e", "#d4a03a", "#f0c96a"];
      map.setPaintProperty("bw-parcel-fill", "fill-color", [
        "case",
        ["<", ["coalesce", ["feature-state", "leaseSoon"], -1], 0], "#d8d2c4",
        ["interpolate", ["linear"], ["coalesce", ["feature-state", "leaseSoon"], 0],
          ...stops.flatMap((s, i) => [s, ramp[i]])],
      ] as never);
      map.setPaintProperty("bw-parcel-fill", "fill-opacity", 0.88 as never);
      // only your buildings carry a number; everything else stays pale card
      roofLens(new Map(leaseRef.current), stops, ramp);
      return;
    }
    if (lens === "vacancy" && game && parcels) {
      // Dark is vacant, light is full — the demand lens's ramp run the other
      // way. Most of the city sits between 80% and full, so the stops crowd
      // up there: a building at 85% and one at 97% should not look alike.
      const stops = [40, 65, 80, 90, 97];
      const ramp = ["#1f2a3c", "#3d5170", "#7088ab", "#b5c3d7", "#eef1f5"];
      map.setPaintProperty("bw-parcel-fill", "fill-color", [
        "case",
        ["<", ["coalesce", ["feature-state", "occPct"], -1], 0], "#d8d2c4",
        ["interpolate", ["linear"], ["coalesce", ["feature-state", "occPct"], 0],
          ...stops.flatMap((s, i) => [s, ramp[i]])],
      ] as never);
      map.setPaintProperty("bw-parcel-fill", "fill-opacity", 0.85 as never);
      roofLens(new Map(vacRef.current), stops, ramp);
      return;
    }
    if (lens === "listings" && game) {
      layer?.setLens(null);
      map.setPaintProperty("bw-parcel-fill", "fill-color", [
        "case",
        ["boolean", ["feature-state", "listed"], false], "#c8452f",
        "#8d8a82",
      ] as never);
      map.setPaintProperty("bw-parcel-fill", "fill-opacity", [
        "case",
        ["boolean", ["feature-state", "listed"], false], 0.52,
        0.07,
      ] as never);
      map.setPaintProperty("bw-parcel-line", "line-color", [
        "case",
        ["boolean", ["feature-state", "listed"], false], "#a83828",
        "#8a8577",
      ] as never);
      map.setPaintProperty("bw-bldg-3d", "fill-extrusion-opacity", 0.28 as never);
      if (map.getLayer("bw-forsale-pts")) map.setLayoutProperty("bw-forsale-pts", "visibility", "visible");
      if (map.getLayer("bw-forsale-halo")) map.setLayoutProperty("bw-forsale-halo", "visibility", "visible");
      return;
    }
    if (lens === "land" && game && parcels) {
      // percentile stops over CURRENT land $/sf so the ramp stays contrasty
      const nowPsf = (bbl: string) => {
        const r = parcels[bbl];
        const d = Math.max(2, Math.min(100, r.demandScore + (game.blockD?.[r.block] ?? 0)));
        return r.landPsf * game.econ.landIdx * (1 + 0.22 * (0.25 + 0.9 * (d / 100)) * game.econ.cycleDev);
      };
      const vals: number[] = [];
      const bbls = Object.keys(parcels);
      const step = Math.max(1, Math.floor(bbls.length / 4000));
      for (let i = 0; i < bbls.length; i += step) vals.push(nowPsf(bbls[i]));
      vals.sort((a, b) => a - b);
      const q = (p: number) => vals[Math.min(vals.length - 1, Math.floor(vals.length * p))];
      const stops = [q(0.05), q(0.35), q(0.6), q(0.82), q(0.97)];
      map.setPaintProperty("bw-parcel-fill", "fill-color", landLensColor(game.econ.landIdx, game.econ.cycleDev, stops) as never);
      map.setPaintProperty("bw-parcel-fill", "fill-opacity", 0.82 as never);
      const all = new Map<string, number>();
      for (const bbl of bbls) all.set(bbl, nowPsf(bbl));
      // the colours landLensColor interpolates between, in its order
      roofLens(all, stops, ["#f0ead8", "#e3c876", "#cf9738", "#a85f1d", "#6e3414"]);
      return;
    }
    // no lens (or owners, which paints through the tints): the city's own face
    layer?.setLens(null);
  }, [lens, paintSig, parcels, mapReady]);

  // hover tooltip: address before you commit to a click. Photo frame drops it
  // with the labels — the effect re-runs on toggle, so it detaches cleanly and
  // a tip left showing at the moment of the switch is wiped.
  const tipRef = useRef<HTMLDivElement>(null);
  const hoverCardOn = useStore((s) => s.hoverCard);
  useEffect(() => {
    const map = mapRef.current;
    const tip = tipRef.current;
    if (!map || !mapReady || !tip) return;
    if (photoFrame || !hoverCardOn) {
      tip.style.display = "none";
      return;
    }
    const container = map.getContainer();
    let tipKey = "";
    const onMove = (e: MouseEvent) => {
      const { hoveredBBL, parcels: table, selectedBBL, game: g, hoverCard } = useStore.getState();
      const rec = hoverCard && hoveredBBL && hoveredBBL !== selectedBBL ? table?.[hoveredBBL] : null;
      if (!rec) { tip.style.display = "none"; return; }
      // One card per lot and month: the same numbers the property panel
      // prints, read off the same functions, so the glance and the click agree.
      const key = `${rec.bbl}|${g?.month}|${g?.holdings?.[rec.bbl] ? 1 : 0}|${g?.listings?.length}`;
      if (key !== tipKey) { tipKey = key; tip.innerHTML = g ? tipHtml(g, table!, rec) : esc(rec.address); }
      tip.style.display = "block";
      const r = container.getBoundingClientRect();
      // keep the card on the map: flip it left / up near the far edges
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      tip.style.left = (x + 14 + tw > r.width ? x - 14 - tw : x + 14) + "px";
      tip.style.top = (y + 16 + th > r.height ? y - 12 - th : y + 16) + "px";
    };
    const onLeave = () => { tip.style.display = "none"; };
    container.addEventListener("mousemove", onMove);
    container.addEventListener("mouseleave", onLeave);
    return () => {
      container.removeEventListener("mousemove", onMove);
      container.removeEventListener("mouseleave", onLeave);
    };
  }, [mapReady, photoFrame, hoverCardOn]);

  return (
    <>
      <div ref={el} className="map-root" />
      <div ref={tipRef} className="hover-tip" style={{ display: "none" }} />
      {/* buildings that need the principal, pinned to their parcels —
          subscribes to its own signature, never to game identity */}
      <Badges mapRef={mapRef} mapReady={mapReady} />
      {/* what the last advance did, rising off the parcels for a few seconds */}
      <EventPops mapRef={mapRef} mapReady={mapReady} />
    </>
  );
}
