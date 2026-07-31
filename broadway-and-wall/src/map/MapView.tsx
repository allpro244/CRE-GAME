import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";
import { useStore } from "@/state/store";
import { composeStyle, resolveBaseStyle } from "./style";

// Fly-in target: Financial District at map-model pitch.
const FIDI = { center: [-74.0095, 40.7068] as [number, number], zoom: 15.4, pitch: 55, bearing: -14 };
const HARBOR = { center: [-74.028, 40.685] as [number, number], zoom: 12.2, pitch: 20, bearing: -30 };

let protocolAdded = false;

export default function MapView() {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const hoveredRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const neighborsRef = useRef<string[]>([]);
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
        // the cinematic fly-in
        map.flyTo({ ...FIDI, duration: 5000, essential: true });

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

  return <div ref={el} className="map-root" />;
}
