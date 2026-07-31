import type { StyleSpecification, SourceSpecification, LayerSpecification } from "maplibre-gl";

// Basemap style URL — configurable, keyless default. Positron is the clean
// pale architectural-model base (white streets, soft parks/water). If it is
// unreachable at runtime we fall back to a self-contained light style built
// from our own context.geojson.
export const BASEMAP_URL: string =
  (import.meta.env.VITE_BASEMAP_STYLE as string | undefined) ??
  "https://tiles.openfreemap.org/styles/positron";

const data = (f: string) => import.meta.env.BASE_URL + "data/" + f;

export function gameSources(): Record<string, SourceSpecification> {
  return {
    "bw-parcels": {
      type: "vector",
      url: "pmtiles://" + new URL(data("parcels.pmtiles"), location.href).href,
    },
    "bw-buildings": {
      type: "vector",
      url: "pmtiles://" + new URL(data("buildings.pmtiles"), location.href).href,
    },
    "bw-owned": {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    },
  };
}

// Land-value lens: shade every lot by its CURRENT land $/sf. The expression
// mirrors engine/value.ts landPsfNow() exactly, computed from tile props.
export function landLensColor(landIdx: number, cycleDev: number, stops: number[]): unknown {
  const now = ["*", ["get", "landpsf"], landIdx,
    ["+", 1, ["*", 0.22 * cycleDev, ["+", 0.25, ["*", 0.009, ["get", "demand"]]]]]];
  return ["interpolate", ["linear"], now,
    stops[0], "#f0ead8",
    stops[1], "#e3c876",
    stops[2], "#cf9738",
    stops[3], "#a85f1d",
    stops[4], "#6e3414",
  ];
}

// Architectural-model look: near-white massing whose sides darken via the
// vertical gradient, faint gray lot lines on pale ground, gold selection.
export function gameLayers(): LayerSpecification[] {
  const hovered = ["boolean", ["feature-state", "hover"], false];
  const selected = ["boolean", ["feature-state", "selected"], false];
  const neighbor = ["boolean", ["feature-state", "neighbor"], false];
  const owned = ["boolean", ["feature-state", "owned"], false];
  const listed = ["boolean", ["feature-state", "listed"], false];
  return [
    {
      id: "bw-parcel-fill",
      type: "fill",
      source: "bw-parcels",
      "source-layer": "parcels",
      paint: {
        "fill-color": [
          "case",
          selected, "#d9a648",
          neighbor, "#3f8f87",
          hovered, "#8a8577",
          owned, "#d9a648",
          listed, "#3f8f87",
          "#8d8a82",
        ] as never,
        // blocks sit a step darker than the white streets so the street
        // network stays legible even where the basemap is hidden
        "fill-opacity": [
          "case",
          selected, 0.45,
          neighbor, 0.35,
          hovered, 0.2,
          owned, 0.22,
          listed, 0.16,
          0.1,
        ] as never,
      },
    },
    {
      id: "bw-parcel-line",
      type: "line",
      source: "bw-parcels",
      "source-layer": "parcels",
      paint: {
        "line-color": [
          "case",
          selected, "#b07f1e",
          neighbor, "#2f7a72",
          hovered, "#57534a",
          owned, "#b07f1e",
          listed, "#2f7a72",
          "#9b968b",
        ] as never,
        "line-width": [
          "interpolate", ["linear"], ["zoom"],
          13, ["case", selected, 2.2, neighbor, 1.5, hovered, 1.1, ["case", owned, 1.4, listed, 1.2, 0.2]],
          16.5, ["case", selected, 3.2, neighbor, 2.2, hovered, 1.8, ["case", owned, 2.4, listed, 2, 0.8]],
        ] as never,
        "line-opacity": [
          "interpolate", ["linear"], ["zoom"],
          13, ["case", selected, 1, neighbor, 0.95, hovered, 0.9, ["case", owned, 0.9, listed, 0.8, 0.3]],
          15, ["case", selected, 1, neighbor, 0.95, hovered, 0.9, ["case", owned, 0.95, listed, 0.85, 0.55]],
          16.5, ["case", selected, 1, neighbor, 0.95, hovered, 0.9, ["case", owned, 1, listed, 0.9, 0.8]],
        ] as never,
      },
    },
    {
      id: "bw-bldg-3d",
      type: "fill-extrusion",
      source: "bw-buildings",
      "source-layer": "buildings",
      paint: {
        "fill-extrusion-height": ["get", "heightM"] as never,
        "fill-extrusion-base": 0,
        "fill-extrusion-color": [
          "case",
          selected, "#e3b95c",
          owned, "#dcc389",
          hovered, "#ddd6c2",
          ["interpolate", ["linear"], ["get", "heightM"],
            10, "#eceae4",
            80, "#e7e6e2",
            180, "#e2e3e2",
            260, "#dcdfe2",
          ],
        ] as never,
        "fill-extrusion-opacity": 1,
        "fill-extrusion-vertical-gradient": true,
      },
    },
    {
      // rooftop markers over player-owned buildings
      id: "bw-owned-pts",
      type: "circle",
      source: "bw-owned",
      minzoom: 12.5,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 3, 16, 5.5] as never,
        "circle-color": "#b07f1e",
        "circle-stroke-color": "#fdfbf4",
        "circle-stroke-width": 1.4,
        "circle-pitch-alignment": "map",
      },
    },
  ];
}

// Fully offline fallback: pale-blue harbor, white-paper landmass, soft parks
// and piers from context.geojson — the architectural-model base, self-contained.
export function fallbackBaseStyle(): StyleSpecification {
  return {
    version: 8,
    name: "bw-fallback",
    sources: {
      "bw-context": { type: "geojson", data: data("context.geojson") },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#b8d3e6" } },
      {
        id: "land",
        type: "fill",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "land"],
        paint: { "fill-color": "#f4f3ef" },
      },
      {
        id: "piers",
        type: "fill",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "pier"],
        paint: { "fill-color": "#e9e7e1" },
      },
      {
        id: "parks",
        type: "fill",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "park"],
        paint: { "fill-color": "#cde3c6" },
      },
      {
        id: "shore",
        type: "line",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "land"],
        paint: { "line-color": "#a3b8c6", "line-width": 1 },
      },
    ],
  };
}

export async function resolveBaseStyle(): Promise<StyleSpecification> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 3500);
    const res = await fetch(BASEMAP_URL, { signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(String(res.status));
    const style = (await res.json()) as StyleSpecification;
    return style;
  } catch {
    console.warn(`Basemap unreachable (${BASEMAP_URL}) — using self-contained fallback style.`);
    return fallbackBaseStyle();
  }
}

export function composeStyle(base: StyleSpecification): StyleSpecification {
  // Model-city cleanliness: strip basemap labels/POIs unless asked to keep
  // them (VITE_BASEMAP_LABELS=on). Roads, parks, and water stay.
  const keepLabels = import.meta.env.VITE_BASEMAP_LABELS === "on";
  const baseLayers = (base.layers ?? []).filter((l) => keepLabels || l.type !== "symbol");
  return {
    ...base,
    // a low sun off the port side gives extrusion faces the model-photo
    // contrast; anchored to the map so shading stays put as you orbit
    light: { anchor: "map", color: "#ffffff", intensity: 0.42, position: [1.15, 135, 55] },
    sources: { ...base.sources, ...gameSources() },
    layers: [...baseLayers, ...gameLayers()],
  };
}
