import type { StyleSpecification, SourceSpecification, LayerSpecification } from "maplibre-gl";

// Ashport is fictional — the self-contained style built from context.geojson
// IS the basemap, so no network fetch by default. Set VITE_BASEMAP_STYLE to
// a style URL (e.g. OpenFreeMap Positron) when running on real NYC data.
export const BASEMAP_URL: string | undefined =
  import.meta.env.VITE_BASEMAP_STYLE as string | undefined;

import { dataBase } from "@/state/city";
const data = (f: string) => dataBase() + f;

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
    "bw-forsale": { type: "geojson", data: { type: "FeatureCollection", features: [] } } as never,
    "bw-owned": {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    },
  };
}

// The tiles carry the demand the generator baked in; a block's drift since
// then lives in game state and is pushed into feature-state by MapView. Both
// lenses read through this so they paint the number the engine is pricing off,
// falling back to the tile attribute wherever nothing has moved yet.
export const LIVE_DEMAND: unknown = ["coalesce", ["feature-state", "dmd"], ["get", "demand"]];

// Land-value lens: shade every lot by its CURRENT land $/sf. The expression
// mirrors engine/value.ts landPsfNow() exactly, computed from tile props.
export function landLensColor(landIdx: number, cycleDev: number, stops: number[]): unknown {
  const now = ["*", ["get", "landpsf"], landIdx,
    ["+", 1, ["*", 0.22 * cycleDev, ["+", 0.25, ["*", 0.009, LIVE_DEMAND]]]]];
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
    {
      // FOR SALE. Anything on the market gets a pin standing over the roof, so
      // you can read the availability of a whole district without opening a
      // single record. Two rings so it survives against both pale stone and
      // dark glass.
      id: "bw-forsale-halo",
      type: "circle",
      source: "bw-forsale",
      minzoom: 11.5,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 3.4, 14, 5.6, 17, 11] as never,
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 12, 1.2, 17, 2.6] as never,
        "circle-stroke-opacity": 0.9,
        "circle-pitch-alignment": "map",
      },
    },
    {
      id: "bw-forsale-pts",
      type: "circle",
      source: "bw-forsale",
      minzoom: 11.5,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 2.2, 14, 3.8, 17, 7.5] as never,
        "circle-color": ["match", ["get", "kind"], "land", "#3f7f4c", "offmkt", "#7d6a9c", "#c8452f"] as never,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 0.8,
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
      // open water is deeper than the harbor: the shallows band along the
      // coast is what makes the sea read as water with a bottom instead of a
      // sheet of blue paint
      // The Three.js layer paints the living sea over the top of this; the
      // background and the shallows band remain as the still-water fallback
      // for anyone whose WebGL context never comes up.
      { id: "bg", type: "background", paint: { "background-color": "#7fa3bd" } },
      {
        id: "shallows",
        type: "fill",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "shallows"],
        paint: { "fill-color": "#9dc0d6" },
      },
      {
        id: "land",
        type: "fill",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "land"],
        paint: { "fill-color": "#e6e3d9" },
      },
      {
        // the waterline itself: a pale foam stroke where the sea meets land
        id: "coast-foam",
        type: "line",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "coastline"],
        paint: {
          "line-color": "#e8f1f4",
          "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.8, 16, 2.6] as never,
          "line-opacity": 0.7,
          "line-blur": 1.2,
        },
      },
      {
        id: "esplanade",
        type: "fill",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "esplanade"],
        paint: { "fill-color": "#e9ebe0" },
      },
      {
        // THE PAVED CITY. Everything inside the shoreline, laid down before a
        // single block goes on top of it. The block fabric covers ~98% of it;
        // the rest is the strip between the last block and the waterline, and
        // this layer is what makes that strip read as a promenade instead of as
        // a hole in the map. It is deliberately a shade off the roadway so the
        // public realm and the carriageway aren't the same surface.
        id: "paveland",
        type: "fill",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "paveland"],
        paint: { "fill-color": "#d7d4ca" },
      },
      {
        // the carriageway that rings a park — under the green, not over it
        id: "apron",
        type: "fill",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "apron"],
        paint: { "fill-color": "#b9b6ae" },
      },
      {
        // timber decking, with a shadowed edge so the pier stands proud of
        // the water instead of floating on it
        id: "piers",
        type: "fill",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "pier"],
        paint: { "fill-color": "#cfb995" },
      },
      {
        id: "pier-edge",
        type: "line",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "pier"],
        paint: {
          "line-color": "#8f7a58",
          "line-width": ["interpolate", ["linear"], ["zoom"], 13, 0.6, 16.5, 2.2] as never,
        },
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
        // the walks: crushed-gravel paths through the green
        id: "park-paths",
        type: "line",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "parkpath"],
        minzoom: 13,
        paint: {
          "line-color": "#e3dbbe",
          "line-width": ["interpolate", ["linear"], ["zoom"], 13.5, 1, 16.5, 4.5] as never,
        },
        layout: { "line-join": "round", "line-cap": "round" },
      },
      {
        id: "park-pond",
        type: "fill",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "pond"],
        paint: { "fill-color": "#a9cadf" },
      },
      {
        id: "park-pond-edge",
        type: "line",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "pond"],
        paint: { "line-color": "#8fb3c9", "line-width": 1.4 },
      },
      {
        // ROADWAY. The cells tile the land, so painting them asphalt and then
        // painting the blocks back on top leaves exactly the street corridor
        // between two curbs. This is the surface; the layers below it are the
        // markings on it.
        id: "pavement",
        type: "fill",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "pavement"],
        // the colonial quarter is paved in setts, not fresh asphalt — a
        // warmer, browner surface that marks the old town at a glance
        paint: { "fill-color": ["match", ["get", "org"], 1, "#b3a894", "#b9b6ae"] as never },
      },
      {
        // painted crossings at the gridded corners
        id: "crosswalk",
        type: "fill",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "crosswalk"],
        minzoom: 14,
        paint: {
          "fill-color": "#e6e2d2",
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0.35, 16, 0.8] as never,
        },
      },
      {
        // the block itself — warm paper, a clear step off the asphalt; the
        // old town runs a shade warmer still
        id: "blocks",
        type: "fill",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "block"],
        paint: { "fill-color": ["match", ["get", "org"], 1, "#eae5d3", "#e9e6dc"] as never },
      },
      {
        // SIDEWALK: a pale band hugging the block, inside the curb line
        id: "sidewalk",
        type: "line",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "street"],
        paint: {
          "line-color": "#dedbd1",
          "line-width": ["interpolate", ["linear"], ["zoom"], 13, 1.1, 15, 3.4, 18, 15] as never,
        },
        layout: { "line-join": "round" },
      },
      {
        // CURB: the hard edge where pavement meets block
        id: "curb",
        type: "line",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "street"],
        minzoom: 14,
        paint: {
          "line-color": "#a9a69d",
          "line-width": ["interpolate", ["linear"], ["zoom"], 14, 0.4, 18, 1.4] as never,
          "line-offset": ["interpolate", ["linear"], ["zoom"], 14, -0.5, 18, -5.5] as never,
        },
      },
      {
        // LANE DIVIDER. Two neighbouring cells share their boundary, so the
        // cell ring runs exactly down the middle of the street — no separate
        // centreline geometry needed.
        // A road without a centreline is a paved corridor, not a road. These
        // come in a full zoom earlier and read brighter than they did.
        id: "lane-divider",
        type: "line",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "centerline"],
        minzoom: 14,
        paint: {
          "line-color": "#e6d99b",
          "line-width": ["interpolate", ["linear"], ["zoom"], 14, 0.4, 16, 0.9, 18, 1.8] as never,
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0.3, 16, 0.75, 18, 0.9] as never,
          "line-dasharray": [5, 7],
        },
      },
      {
        // the shore road still gets its own stroke
        id: "streets",
        type: "line",
        source: "bw-context",
        filter: ["all", ["==", ["get", "kind"], "street"], ["==", ["get", "cls"], "shore"]],
        paint: {
          "line-color": "#c6c2b6",
          "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1.6, 16, 9] as never,
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
        // timber piles along the pier edges — what holds a dock up
        id: "piles",
        type: "circle",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "pile"],
        minzoom: 14,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 0.8, 17, 2.4] as never,
          "circle-color": "#6e5a40",
          "circle-stroke-color": "#4c3e2c",
          "circle-stroke-width": 0.5,
        },
      },
      {
        id: "bollards",
        type: "circle",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "bollard"],
        minzoom: 15.5,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 15.5, 1, 18, 2.6] as never,
          "circle-color": "#3a3a3c",
        },
      },
      {
        // channel buoys: red to port, green to starboard, like the chart says
        id: "buoys",
        type: "circle",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "buoy"],
        minzoom: 12.5,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 2, 16, 4.5] as never,
          "circle-color": ["match", ["get", "side"], 0, "#b8402e", "#2e7d43"] as never,
          "circle-stroke-color": "#f4f1e6",
          "circle-stroke-width": 1,
        },
      },
      {
        // far-out canopy dots; the 3D trees take over as you come down
        id: "trees",
        type: "circle",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "tree"],
        minzoom: 12.5,
        maxzoom: 14.4,
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
    // THE HORIZON. Without one the world ends at a hard blue edge and the city
    // sits in a void. A graded sky, a pale band where it meets the sea, and a
    // whisper of ground fog in the last of the distance — which is the same
    // aerial perspective the building shader applies, so the 3D and the map
    // agree about how far away far is.
    sky: {
      "sky-color": "#7fb6e0",
      "sky-horizon-blend": 0.76,
      "horizon-color": "#e2ecf1",
      "horizon-fog-blend": 0.62,
      "fog-color": "#cfe0ea",
      "fog-ground-blend": 0.88,
      "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 12, 0.9, 15.5, 0.7, 18, 0.45],
    },
    sources: { ...base.sources, ...gameSources() },
    layers: [...baseLayers, ...gameLayers()],
  };
}
