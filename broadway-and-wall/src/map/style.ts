import type { StyleSpecification, SourceSpecification, LayerSpecification } from "maplibre-gl";

// Ashport is fictional — the self-contained style built from context.geojson
// IS the basemap, so no network fetch by default. Set VITE_BASEMAP_STYLE to
// a style URL (e.g. OpenFreeMap Positron) when running on real NYC data.
export const BASEMAP_URL: string | undefined =
  import.meta.env.VITE_BASEMAP_STYLE as string | undefined;

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
      // flat extrusions — hidden by default (the Three.js mesh renderer draws
      // the city); shown ghosted while a lens is active
      id: "bw-bldg-3d",
      type: "fill-extrusion",
      source: "bw-buildings",
      "source-layer": "buildings",
      layout: { visibility: "none" },
      paint: {
        "fill-extrusion-height": ["get", "heightM"] as never,
        "fill-extrusion-base": ["get", "baseM"] as never,
        // facade palette: pre-war masonry runs warm, post-war glass runs
        // cool, and a stable per-building tone jitter breaks the uniformity
        "fill-extrusion-color": [
          "case",
          selected, "#e3b95c",
          owned, "#dcc389",
          hovered, "#ddd6c2",
          ["match", ["%", ["coalesce", ["get", "tone"], 0], 5],
            0, ["case", ["<", ["coalesce", ["get", "year"], 1950], 1961], "#efe9db", "#e9ebec"],
            1, ["case", ["<", ["coalesce", ["get", "year"], 1950], 1961], "#eae4d4", "#e4e7ea"],
            2, ["case", ["<", ["coalesce", ["get", "year"], 1950], 1961], "#ece7dc", "#e7e9e8"],
            3, ["case", ["<", ["coalesce", ["get", "year"], 1950], 1961], "#e6e0d0", "#dfe3e8"],
            ["case", ["<", ["coalesce", ["get", "year"], 1950], 1961], "#f1ece0", "#ecedec"],
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
        paint: { "fill-color": "#e6e3d9" },
      },
      {
        id: "esplanade",
        type: "fill",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "esplanade"],
        paint: { "fill-color": "#e9ebe0" },
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
        id: "park-outline",
        type: "line",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "park"],
        paint: { "line-color": "#b3cba6", "line-width": 1.2 },
      },
      {
        // the street network — paved gray against bare land
        id: "streets",
        type: "line",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "street"],
        paint: {
          "line-color": ["match", ["get", "cls"], "shore", "#d3cfc2", "#dcd8cb"],
          "line-width": [
            "interpolate", ["linear"], ["zoom"],
            12, ["match", ["get", "cls"], "shore", 1.6, 0.8],
            16, ["match", ["get", "cls"], "shore", 9, 5],
          ],
        },
        layout: { "line-join": "round", "line-cap": "round" },
      },
      {
        // center dashes on the shore road at close zoom
        id: "street-dash",
        type: "line",
        source: "bw-context",
        filter: ["all", ["==", ["get", "kind"], "street"], ["==", ["get", "cls"], "shore"]],
        minzoom: 14.5,
        paint: {
          "line-color": "#c8c4b6",
          "line-width": 0.9,
          "line-dasharray": [3, 3],
        },
      },
      {
        id: "trees",
        type: "circle",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "tree"],
        minzoom: 12.5,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 1.2, 16.5, 3.6],
          "circle-color": "#9dbd8e",
          "circle-stroke-color": "#87a878",
          "circle-stroke-width": 0.6,
          "circle-pitch-alignment": "map",
        },
      },
      {
        id: "shore",
        type: "line",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "land"],
        paint: { "line-color": "#a3b8c6", "line-width": 1 },
      },
      {
        // transit stations — the anchors of the demand map
        id: "stations",
        type: "circle",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "station"],
        minzoom: 12.5,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 2.5, 16, 4.5],
          "circle-color": "#5b6b7a",
          "circle-stroke-color": "#f4f3ef",
          "circle-stroke-width": 1.2,
          "circle-pitch-alignment": "map",
        },
      },
    ],
  };
}

export async function resolveBaseStyle(): Promise<StyleSpecification> {
  if (!BASEMAP_URL) return fallbackBaseStyle();
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
