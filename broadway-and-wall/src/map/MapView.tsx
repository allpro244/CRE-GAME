import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";
import { useStore } from "@/state/store";
import { composeStyle, gameLayers, landLensColor, resolveBaseStyle } from "./style";

// Fly-in: open over the harbor with the whole island in frame, then dive
// to the Financial District at map-model pitch.
const FIDI = { center: [-74.0095, 40.7068] as [number, number], zoom: 15.2, pitch: 55, bearing: -14 };
const HARBOR = { center: [-73.985, 40.72] as [number, number], zoom: 11.2, pitch: 30, bearing: -25 };

let protocolAdded = false;

export default function MapView() {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const hoveredRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const neighborsRef = useRef<string[]>([]);
  const ownedRef = useRef<Set<string>>(new Set());
  const listedRef = useRef<Set<string>>(new Set());
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
      const base = await resolveBaseStyle();
      if (disposed || !el.current) return;
      const map = new maplibregl.Map({
        container: el.current,
        style: composeStyle(base),
        ...HARBOR,
        minZoom: 10.2, // game tiles start at z10 — never let the city vanish
        maxPitch: 70,
        attributionControl: { compact: true },
        canvasContextAttributes: { antialias: true },
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");

      const featureIdsFor = (bbl: string) => Number(bbl);
      const setState = (bbl: string, state: Record<string, boolean>) => {
        const id = featureIdsFor(bbl);
        map.setFeatureState({ source: "bw-parcels", sourceLayer: "parcels", id }, state);
        map.setFeatureState({ source: "bw-buildings", sourceLayer: "buildings", id }, state);
      };

      map.on("load", () => {
        setMapReady(true);
        // the cinematic fly-in
        map.flyTo({ ...FIDI, duration: 6000, essential: true });

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
  }, [game, parcels, mapReady]);

  // land-value lens — repaints when toggled and as the market moves
  const lens = useStore((s) => s.lens);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (lens === "land" && game && parcels) {
      // percentile stops over CURRENT land $/sf so the ramp stays contrasty
      const vals: number[] = [];
      const bbls = Object.keys(parcels);
      const step = Math.max(1, Math.floor(bbls.length / 4000));
      for (let i = 0; i < bbls.length; i += step) {
        const r = parcels[bbls[i]];
        vals.push(r.landPsf * game.econ.landIdx * (1 + 0.22 * (0.25 + 0.9 * (r.demandScore / 100)) * game.econ.cycleDev));
      }
      vals.sort((a, b) => a - b);
      const q = (p: number) => vals[Math.min(vals.length - 1, Math.floor(vals.length * p))];
      const stops = [q(0.05), q(0.35), q(0.6), q(0.82), q(0.97)];
      map.setPaintProperty("bw-parcel-fill", "fill-color", landLensColor(game.econ.landIdx, game.econ.cycleDev, stops) as never);
      map.setPaintProperty("bw-parcel-fill", "fill-opacity", 0.82 as never);
      map.setPaintProperty("bw-bldg-3d", "fill-extrusion-opacity", 0.18 as never);
    } else {
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

  return <div ref={el} className="map-root" />;
}
