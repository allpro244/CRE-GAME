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
  };
}

// Architectural-model look: near-white massing whose sides darken via the
// vertical gradient, faint gray lot lines on pale ground, gold selection.
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
          neighbor, "#3f8f87",
          hovered, "#8a8577",
          "#7d7a70",
        ] as never,
        "fill-opacity": [
          "case",
          selected, 0.45,
          neighbor, 0.35,
          hovered, 0.18,
          0.06,
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
          "#9b968b",
        ] as never,
        "line-width": [
          "interpolate", ["linear"], ["zoom"],
          13, ["case", selected, 2.2, neighbor, 1.5, hovered, 1.1, 0.2],
          16.5, ["case", selected, 3.2, neighbor, 2.2, hovered, 1.8, 0.8],
        ] as never,
        "line-opacity": [
          "interpolate", ["linear"], ["zoom"],
          13, ["case", selected, 1, neighbor, 0.95, hovered, 0.9, 0.3],
          15, ["case", selected, 1, neighbor, 0.95, hovered, 0.9, 0.55],
          16.5, ["case", selected, 1, neighbor, 0.95, hovered, 0.9, 0.8],
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
  return {
    ...base,
    sources: { ...base.sources, ...gameSources() },
    layers: [...(base.layers ?? []), ...gameLayers()],
  };
}
