import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";
import { fetchGzJson, useStore } from "@/state/store";
import { dataBase } from "@/state/city";
import { composeStyle, gameLayers, landLensColor, LIVE_DEMAND, resolveBaseStyle } from "./style";
import { ThreeBuildings, type BuildingVolume } from "./ThreeBuildings";

const CITY_CENTER: [number, number] = [-70.9, 41.1];

// The two cameras are READ FROM THE DATA, not written down here. The pipeline
// puts the city's bounding box and its demand-weighted core into the manifest,
// so the opening shot frames whatever city was built and the dive lands on its
// business district. Hand-tuned constants meant every new map opened looking at
// the wrong piece of water.
type CityFrame = { bbox: [number, number, number, number]; core: [number, number] };
const FALLBACK: CityFrame = { bbox: [-70.912, 41.092, -70.888, 41.109], core: [-70.8966, 41.0997] };

// zoom that fits a span of `deg` longitude into `px` of viewport
function fitZoom(frame: CityFrame, px: number, fill: number) {
  const [w, s, e, n] = frame.bbox;
  const lonSpan = Math.max(1e-4, e - w);
  const latSpan = Math.max(1e-4, n - s) / Math.cos((((s + n) / 2) * Math.PI) / 180);
  const span = Math.max(lonSpan, latSpan);
  return Math.log2((px * 360) / (512 * span * fill));
}
const framesOf = (f: CityFrame, px: number) => {
  const [w, s, e, n] = f.bbox;
  const mid: [number, number] = [(w + e) / 2, (s + n) / 2];
  return {
    // the establishing shot: the whole city in frame, low pitch
    wide: { center: mid, zoom: Math.min(14.6, fitZoom(f, px, 1.25)), pitch: 30, bearing: -8 },
    // the dive: down onto the central business district
    core: { center: f.core as [number, number], zoom: 15.3, pitch: 55, bearing: -12 },
  };
};

let protocolAdded = false;

export default function MapView() {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const hoveredRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const neighborsRef = useRef<string[]>([]);
  const ownedRef = useRef<Set<string>>(new Set());
  const listedRef = useRef<Set<string>>(new Set());
  const threeRef = useRef<ThreeBuildings | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const select = useStore((s) => s.select);
  const hover = useStore((s) => s.hover);
  const setFps = useStore((s) => s.setFps);

  useEffect(() => {
    if (!el.current || mapRef.current) return;
    if (!protocolAdded) {
      const protocol = new Protocol();
      maplibregl.addProtocol("pmtiles", protocol.tile);
      protocolAdded = true;
    }
    let disposed = false;

    (async () => {
      const [base, frame] = await Promise.all([
        resolveBaseStyle(),
        fetch(dataBase() + "manifest.json")
          .then((r) => r.json())
          .then((m) => (Array.isArray(m?.bbox) && Array.isArray(m?.core) ? (m as CityFrame) : FALLBACK))
          .catch(() => FALLBACK),
      ]);
      if (disposed || !el.current) return;
      const shot = framesOf(frame, el.current.clientWidth || 1280);
      const map = new maplibregl.Map({
        container: el.current,
        style: composeStyle(base),
        ...shot.wide,
        minZoom: shot.wide.zoom - 0.9, // whole city stays in frame; tiles never vanish
        maxPitch: 70,
        attributionControl: { compact: true },
        canvasContextAttributes: { antialias: true },
      });
      mapRef.current = map;
      // handle for automated playtests and screenshots
      (window as unknown as { __map?: maplibregl.Map }).__map = map;
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");

      const featureIdsFor = (bbl: string) => Number(bbl);
      const setState = (bbl: string, state: Record<string, boolean>) => {
        const id = featureIdsFor(bbl);
        map.setFeatureState({ source: "bw-parcels", sourceLayer: "parcels", id }, state);
        map.setFeatureState({ source: "bw-buildings", sourceLayer: "buildings", id }, state);
      };

      map.on("load", () => {
        setMapReady(true);
        // the beautiful-buildings renderer: meshes with procedural facades
        Promise.all([
          fetchGzJson(dataBase() + "buildings3d.json.gz"),
          // the curb lines double as the planting plan for street trees
          fetch(dataBase() + "context.geojson").then((r) => r.json()).catch(() => null),
        ])
          .then(([volumes, ctx]: [BuildingVolume[], GeoJSON.FeatureCollection | null]) => {
            if (disposed || !volumes?.length) return;
            const curbs: [number, number][][] = (ctx?.features ?? [])
              .filter((f) => f.properties?.kind === "street" && f.geometry.type === "LineString")
              .map((f) => (f.geometry as GeoJSON.LineString).coordinates as [number, number][]);
            // park & esplanade trees and pier piles come along as 3D dressing
            const pointsOf = (kind: string): [number, number][] => (ctx?.features ?? [])
              .filter((f) => f.properties?.kind === kind && f.geometry.type === "Point")
              .map((f) => (f.geometry as GeoJSON.Point).coordinates as [number, number]);
            const layer = new ThreeBuildings(volumes, CITY_CENTER, curbs, {
              trees: pointsOf("tree"),
              piles: pointsOf("pile"),
            });
            threeRef.current = layer;
            map.addLayer(layer);
          })
          .catch(() => {
            // no mesh feed — fall back to the flat extrusions
            map.setLayoutProperty("bw-bldg-3d", "visibility", "visible");
          });
        // the cinematic fly-in
        map.flyTo({ ...shot.core, duration: 5500, essential: true });

        map.on("mousemove", "bw-parcel-fill", (e) => {
          const f = e.features?.[0];
          const bbl = f?.properties?.bbl as string | undefined;
          if (!bbl || bbl === hoveredRef.current) return;
          if (hoveredRef.current) setState(hoveredRef.current, { hover: false });
          hoveredRef.current = bbl;
          setState(bbl, { hover: true });
          hover(bbl);
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "bw-parcel-fill", () => {
          if (hoveredRef.current) setState(hoveredRef.current, { hover: false });
          hoveredRef.current = null;
          hover(null);
          map.getCanvas().style.cursor = "";
        });
        map.on("click", (e) => {
          const fs = map.queryRenderedFeatures(e.point, { layers: ["bw-parcel-fill"] });
          const bbl = (fs[0]?.properties?.bbl as string | undefined) ?? null;
          select(bbl);
        });
      });

      // fps meter — the spec's 60fps budget, made visible
      let frames = 0;
      let last = performance.now();
      const tick = () => {
        if (disposed) return;
        frames++;
        const now = performance.now();
        if (now - last >= 1000) {
          setFps(Math.round((frames * 1000) / (now - last)));
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // reflect selection + neighbor highlight into feature-state
  const selectedBBL = useStore((s) => s.selectedBBL);
  const adjacency = useStore((s) => s.adjacency);
  const parcels = useStore((s) => s.parcels);
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
      map.setFeatureState({ source: "bw-parcels", sourceLayer: "parcels", id }, state);
      map.setFeatureState({ source: "bw-buildings", sourceLayer: "buildings", id }, state);
    };
    if (selectedRef.current) setState(selectedRef.current, { selected: false });
    for (const n of neighborsRef.current) setState(n, { neighbor: false });
    neighborsRef.current = [];
    selectedRef.current = selectedBBL;
    if (selectedBBL) {
      setState(selectedBBL, { selected: true });
      const nbrs = adjacency?.[selectedBBL] ?? [];
      for (const n of nbrs) setState(n, { neighbor: true });
      neighborsRef.current = nbrs;
      // ease toward the parcel if it's far from view
      const rec = parcels?.[selectedBBL];
      if (rec) {
        const c = map.getCenter();
        const d = Math.hypot(c.lng - rec.centroid[0], c.lat - rec.centroid[1]);
        if (d > 0.004) map.easeTo({ center: rec.centroid, duration: 800 });
      }
    }
  }, [selectedBBL, adjacency, parcels]);

  // ownership + listings → feature-state and rooftop markers
  const game = useStore((s) => s.game);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !game || !parcels) return;
    const setState = (bbl: string, state: Record<string, boolean>) => {
      const id = Number(bbl);
      map.setFeatureState({ source: "bw-parcels", sourceLayer: "parcels", id }, state);
      map.setFeatureState({ source: "bw-buildings", sourceLayer: "buildings", id }, state);
    };
    const nowOwned = new Set(Object.keys(game.holdings));
    for (const bbl of ownedRef.current) if (!nowOwned.has(bbl)) setState(bbl, { owned: false });
    for (const bbl of nowOwned) if (!ownedRef.current.has(bbl)) setState(bbl, { owned: true });
    ownedRef.current = nowOwned;

    const nowListed = new Set(game.listings.map((l) => l.bbl));
    for (const bbl of listedRef.current) if (!nowListed.has(bbl)) setState(bbl, { listed: false });
    for (const bbl of nowListed) if (!listedRef.current.has(bbl)) setState(bbl, { listed: true });
    listedRef.current = nowListed;

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
  }, [game, parcels, mapReady]);

  const lens = useStore((s) => s.lens);

  // Live demand into feature-state, so the demand and land lenses paint what
  // the engine is actually pricing off. Only blocks that have MOVED are pushed
  // — on day one that is none of them, and after a century it is a few hundred
  // parcels, written once per month and only while a lens is open.
  const dmdRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
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
      map.setFeatureState({ source: "bw-parcels", sourceLayer: "parcels", id: Number(bbl) }, { dmd: v });
    }
    for (const bbl of dmdRef.current.keys()) {
      if (!next.has(bbl)) map.removeFeatureState({ source: "bw-parcels", sourceLayer: "parcels", id: Number(bbl) }, "dmd");
    }
    dmdRef.current = next;
  }, [game, parcels, mapReady, lens]);

  // name labels: districts, parks, water — DOM markers, no glyph server needed
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const markers: maplibregl.Marker[] = [];
    let disposed = false;
    fetch(dataBase() + "context.geojson")
      .then((r) => r.json())
      .then((fc: { features: { geometry: { type: string; coordinates: [number, number] }; properties: Record<string, string> }[] }) => {
        if (disposed) return;
        for (const f of fc.features) {
          if (f.properties.kind !== "label") continue;
          const el = document.createElement("div");
          el.className = "map-label map-label-" + f.properties.labelKind;
          el.textContent = f.properties.name;
          markers.push(new maplibregl.Marker({ element: el }).setLngLat(f.geometry.coordinates).addTo(map));
        }
        const fade = () => {
          const z = map.getZoom();
          for (const m of markers) {
            const el = m.getElement();
            const kind = el.className.includes("district") ? "district" : el.className.includes("park") ? "park" : "water";
            const on =
              kind === "district" ? z >= 12.2 && z <= 15.6 :
              kind === "park" ? z >= 13.2 :
              z <= 14.5;
            el.style.opacity = on ? "1" : "0";
          }
        };
        map.on("zoom", fade);
        fade();
      })
      .catch(() => { /* labels are decoration — never block the map */ });
    return () => {
      disposed = true;
      markers.forEach((m) => m.remove());
    };
  }, [mapReady]);

  // mesh tints: gold selection/ownership, teal neighbors, warm hover
  const hoveredBBL = useStore((s) => s.hoveredBBL);
  useEffect(() => {
    const layer = threeRef.current;
    if (!layer || !mapReady) return;
    const tints = new Map<string, [number, number, number]>();
    if (game) for (const l of game.listings) tints.set(l.bbl, [1.24, 0.9, 0.84]);   // on the market
    if (game) for (const bbl of Object.keys(game.holdings)) tints.set(bbl, [1.28, 1.1, 0.72]);
    if (selectedBBL) {
      for (const n of adjacency?.[selectedBBL] ?? []) tints.set(n, [0.72, 1.12, 1.04]);
      tints.set(selectedBBL, [1.5, 1.14, 0.5]);
    }
    if (hoveredBBL && hoveredBBL !== selectedBBL) tints.set(hoveredBBL, [1.14, 1.08, 0.92]);
    layer.setTints(tints);
  }, [selectedBBL, hoveredBBL, adjacency, game, mapReady]);

  // player construction and city growth onto the skyline
  const dynSigRef = useRef("");
  useEffect(() => {
    const layer = threeRef.current;
    if (!layer || !mapReady || !game) return;
    const items: { bbl: string; cls: string; heightM: number; floors: number; construction: boolean }[] = [];
    for (const d of Object.values(game.developments ?? {})) {
      const total = Math.max(1, d.deliverM - d.startM);
      const prog = Math.min(1, Math.max(0.15, (game.month - d.startM + 1) / total));
      items.push({ bbl: d.bbl, cls: d.use, heightM: d.floors * 3.4 * prog, floors: d.floors, construction: true });
    }
    for (const [bbl, b] of Object.entries(game.built ?? {})) {
      items.push({ bbl, cls: b.class, heightM: b.floors * 3.4, floors: b.floors, construction: false });
    }
    // meshes are rebuilt only when the skyline actually changed
    const sig = items.map((i) => i.bbl + ":" + i.heightM.toFixed(1) + (i.construction ? "c" : "")).join("|");
    if (sig === dynSigRef.current) return;
    dynSigRef.current = sig;
    layer.setPlayerBuildings(items);
  }, [game, mapReady]);

  // lenses — repaint when toggled and as the market moves
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const ghostBuildings = (on: boolean) => {
      if (threeRef.current) {
        threeRef.current.visible = !on;
        map.triggerRepaint();
        map.setLayoutProperty("bw-bldg-3d", "visibility", on ? "visible" : "none");
      }
    };
    if (lens === "demand" && parcels) {
      ghostBuildings(true);
      map.setPaintProperty("bw-parcel-fill", "fill-color", [
        "interpolate", ["linear"], LIVE_DEMAND,
        5, "#eef0e8", 30, "#cfe0d5", 50, "#93c4b1", 70, "#4f9887", 92, "#1e6a60",
      ] as never);
      map.setPaintProperty("bw-parcel-fill", "fill-opacity", 0.82 as never);
      map.setPaintProperty("bw-bldg-3d", "fill-extrusion-opacity", 0.18 as never);
      return;
    }
    if (lens === "land" && game && parcels) {
      ghostBuildings(true);
      // percentile stops over CURRENT land $/sf so the ramp stays contrasty
      const vals: number[] = [];
      const bbls = Object.keys(parcels);
      const step = Math.max(1, Math.floor(bbls.length / 4000));
      for (let i = 0; i < bbls.length; i += step) {
        const r = parcels[bbls[i]];
        const d = Math.max(2, Math.min(100, r.demandScore + (game.blockD?.[r.block] ?? 0)));
        vals.push(r.landPsf * game.econ.landIdx * (1 + 0.22 * (0.25 + 0.9 * (d / 100)) * game.econ.cycleDev));
      }
      vals.sort((a, b) => a - b);
      const q = (p: number) => vals[Math.min(vals.length - 1, Math.floor(vals.length * p))];
      const stops = [q(0.05), q(0.35), q(0.6), q(0.82), q(0.97)];
      map.setPaintProperty("bw-parcel-fill", "fill-color", landLensColor(game.econ.landIdx, game.econ.cycleDev, stops) as never);
      map.setPaintProperty("bw-parcel-fill", "fill-opacity", 0.82 as never);
      map.setPaintProperty("bw-bldg-3d", "fill-extrusion-opacity", 0.18 as never);
    } else {
      ghostBuildings(false);
      // restore the default paints straight from the style definition
      const fill = gameLayers().find((l) => l.id === "bw-parcel-fill");
      const bldg = gameLayers().find((l) => l.id === "bw-bldg-3d");
      if (fill && "paint" in fill && fill.paint) {
        map.setPaintProperty("bw-parcel-fill", "fill-color", (fill.paint as Record<string, unknown>)["fill-color"] as never);
        map.setPaintProperty("bw-parcel-fill", "fill-opacity", (fill.paint as Record<string, unknown>)["fill-opacity"] as never);
      }
      if (bldg && "paint" in bldg && bldg.paint) {
        map.setPaintProperty("bw-bldg-3d", "fill-extrusion-opacity", (bldg.paint as Record<string, unknown>)["fill-extrusion-opacity"] as never);
      }
    }
  }, [lens, game, parcels, mapReady]);

  // hover tooltip: address before you commit to a click
  const tipRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const map = mapRef.current;
    const tip = tipRef.current;
    if (!map || !mapReady || !tip) return;
    const container = map.getContainer();
    const onMove = (e: MouseEvent) => {
      const { hoveredBBL, parcels: table, selectedBBL, game: g } = useStore.getState();
      const rec = hoveredBBL && hoveredBBL !== selectedBBL ? table?.[hoveredBBL] : null;
      if (!rec) { tip.style.display = "none"; return; }
      const dmd = Math.round(Math.max(2, Math.min(100, rec.demandScore + (g?.blockD?.[rec.block] ?? 0))));
      tip.textContent = `${rec.address} · ${rec.class === "land" ? "vacant" : rec.floors + " fl"} · demand ${dmd}`;
      tip.style.display = "block";
      const r = container.getBoundingClientRect();
      tip.style.left = e.clientX - r.left + 14 + "px";
      tip.style.top = e.clientY - r.top + 16 + "px";
    };
    const onLeave = () => { tip.style.display = "none"; };
    container.addEventListener("mousemove", onMove);
    container.addEventListener("mouseleave", onLeave);
    return () => {
      container.removeEventListener("mousemove", onMove);
      container.removeEventListener("mouseleave", onLeave);
    };
  }, [mapReady]);

  return (
    <>
      <div ref={el} className="map-root" />
      <div ref={tipRef} className="hover-tip" style={{ display: "none" }} />
    </>
  );
}
