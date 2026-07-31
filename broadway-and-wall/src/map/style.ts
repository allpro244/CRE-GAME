import type { StyleSpecification, SourceSpecification, LayerSpecification } from "maplibre-gl";

// Basemap style URL — configurable, keyless default. If unreachable at runtime
// we fall back to a self-contained dark style built from our own context.geojson.
export const BASEMAP_URL: string =
  (import.meta.env.VITE_BASEMAP_STYLE as string | undefined) ??
  "https://tiles.openfreemap.org/styles/liberty";

const data = (f: string) => import.meta.env.BASE_URL + "data/" + f;

export function gameSources(): Record<string, SourceSpecification> {
  return {
    "bw-parcels": {
      type: "vector",
      url: "pmtiles://" + new URL(data("parcels.pmtiles"), location.href).href,
      promoteId: undefined,
    },
    "bw-buildings": {
      type: "vector",
      url: "pmtiles://" + new URL(data("buildings.pmtiles"), location.href).href,
    },
  };
}

// Architectural-model palette: warm parchment lines over a deep slate world,
// limestone-to-slate extrusions ramped by height.
export function gameLayers(): LayerSpecification[] {
  const hovered = ["boolean", ["feature-state", "hover"], false];
  const selected = ["boolean", ["feature-state", "selected"], false];
  const neighbor = ["boolean", ["feature-state", "neighbor"], false];
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
          neighbor, "#5fa8a0",
          hovered, "#e8dcc0",
          "#e8dcc0",
        ] as never,
        "fill-opacity": [
          "case",
          selected, 0.38,
          neighbor, 0.28,
          hovered, 0.22,
          0.04,
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
          selected, "#f2c14e",
          neighbor, "#6fc2b9",
          hovered, "#f0e6cc",
          "#c9bda0",
        ] as never,
        "line-width": [
          "interpolate", ["linear"], ["zoom"],
          13, ["case", selected, 2.2, neighbor, 1.5, hovered, 1.1, 0.2],
          16.5, ["case", selected, 3.2, neighbor, 2.2, hovered, 1.8, 0.8],
        ] as never,
        "line-opacity": [
          "interpolate", ["linear"], ["zoom"],
          13, ["case", selected, 1, neighbor, 0.95, hovered, 0.9, 0.25],
          15, ["case", selected, 1, neighbor, 0.95, hovered, 0.9, 0.5],
          16.5, ["case", selected, 1, neighbor, 0.95, hovered, 0.9, 0.75],
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
          hovered, "#c8bfa8",
          ["interpolate", ["linear"], ["get", "heightM"],
            10, "#b8b2a4",
            60, "#a7a49e",
            150, "#8e929c",
            260, "#767e8f",
          ],
        ] as never,
        "fill-extrusion-opacity": 0.96,
        "fill-extrusion-vertical-gradient": true,
      },
    },
  ];
}

// Fully offline fallback: dark harbor, parchment-edged landmass from context.geojson.
export function fallbackBaseStyle(): StyleSpecification {
  return {
    version: 8,
    name: "bw-fallback",
    sources: {
      "bw-context": { type: "geojson", data: data("context.geojson") },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#0d1720" } },
      {
        id: "land",
        type: "fill",
        source: "bw-context",
        paint: { "fill-color": "#1a2129", "fill-outline-color": "#2c3947" },
      },
      {
        id: "shore",
        type: "line",
        source: "bw-context",
        paint: { "line-color": "#3d4f61", "line-width": 1.2 },
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
  return {
    ...base,
    sources: { ...base.sources, ...gameSources() },
    layers: [...(base.layers ?? []), ...gameLayers()],
  };
}
