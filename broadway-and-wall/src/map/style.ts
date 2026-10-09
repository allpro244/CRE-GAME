import type { StyleSpecification, SourceSpecification, LayerSpecification } from "maplibre-gl";
// The one open-water colour both renderers paint; see `sea.ts` for why it lives
// in a leaf module of its own rather than next to the layer that uses it.
import { OPEN_SEA } from "./sea";


// Ashport is fictional — the self-contained style built from context.geojson
// IS the basemap, so no network fetch by default. Set VITE_BASEMAP_STYLE to
// a style URL (e.g. OpenFreeMap Positron) when running on real NYC data.
export const BASEMAP_URL: string | undefined =
  import.meta.env.VITE_BASEMAP_STYLE as string | undefined;

const EMPTY = { type: "FeatureCollection" as const, features: [] };

/**
 * A LINE WIDTH IN METRES, NOT PIXELS. MapLibre line widths are screen pixels,
 * so every stroke that stands for something physical — a kerb, a lane line, a
 * zebra — used to be one width at every scale: a 15 px "sidewalk" was a
 * footpath at one zoom and a dual carriageway at the next. Pixels per metre
 * double per zoom level, so an exponential-2 ramp is exact; `minPx` keeps a
 * mark from vanishing below a pixel when the camera pulls back.
 *
 * 59,100 is metres per pixel at zoom 0 on a 512 px tile (78,271.5) times
 * cos(41°), the latitude band every island here is generated in.
 */
/**
 * THE YARDS HAVE A SEASON. The block fill is what shows between and behind
 * the buildings — rear yards, courts, the strip in front of a row — and in a
 * real town from June to September that ground is mostly under leaf and
 * grass. It was one grey-beige twelve months a year. `leaf` is the month's
 * foliage vigour (the same ladder the 3D trees and lawns read), and the yard
 * slides from its winter stone-and-dirt tone toward a dusty summer green;
 * never to a park's lawn green, because a yard is walked on, parked on and
 * half paved.
 */
const YARD_WINTER = { org: [0xc9, 0xbf, 0xa8], t: [[0xc4, 0xc0, 0xb2], [0xbf, 0xc1, 0xb4], [0xc8, 0xbf, 0xae], [0xbd, 0xc2, 0xb3], [0xc6, 0xbc, 0xb2]] };
const YARD_SUMMER = { org: [0xb7, 0xb9, 0x98], t: [[0xb2, 0xb9, 0x9c], [0xab, 0xb7, 0x9b], [0xb6, 0xb7, 0x98], [0xa9, 0xb8, 0x9a], [0xb4, 0xb5, 0x9b]] };
// lying snow: the yards and lawns go white, the asphalt stays dark
const SNOW = [234, 238, 241];
export function blocksPaint(leaf: number, snow = 0): unknown {
  const k = Math.max(0, Math.min(1, leaf));
  const w = Math.max(0, Math.min(1, snow));
  const mix = (a: number[], b: number[]) =>
    "#" + a.map((v, i) => { const c = v + (b[i] - v) * k; return Math.round(c + (SNOW[i] - c) * w).toString(16).padStart(2, "0"); }).join("");
  const t = YARD_WINTER.t.map((w2, i) => mix(w2, YARD_SUMMER.t[i]));
  return [
    "case",
    ["==", ["get", "org"], 1], mix(YARD_WINTER.org, YARD_SUMMER.org),
    ["match", ["coalesce", ["get", "dt"], 0], 0, t[0], 1, t[1], 2, t[2], 3, t[3], 4, t[4], t[0]],
  ];
}
/** The park fill, snowed over by `snow` (0-1). */
export function parksPaint(snow = 0): unknown {
  const w = Math.max(0, Math.min(1, snow));
  const c = (hex: string) => { const v = parseInt(hex.slice(1), 16); return "#" + [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x, i) => Math.round(x + (SNOW[i] - x) * w).toString(16).padStart(2, "0")).join(""); };
  return ["match", ["coalesce", ["get", "flavour"], "park"], "cemetery", c("#8fa37a"), "battery", c("#c5c4a4"), "market", c("#cfc6b0"), c("#b7d29f")];
}

export function metres(m: number, minPx = 0, sign = 1): unknown {
  const stops: number[] = [];
  for (const z of [10, 13, 14, 15, 16, 17, 18, 19, 20, 22]) {
    stops.push(z, sign * Math.max(minPx, (m * Math.pow(2, z)) / 59100));
  }
  return ["interpolate", ["exponential", 2], ["zoom"], ...stops];
}

/**
 * THE CITY IS MADE, NOT FETCHED — so its layers are GeoJSON, not tiles.
 *
 * These two were PMTiles archives cut by the pipeline, which is the right
 * answer for forty thousand Manhattan lots and the wrong one here: a generated
 * city is sixteen hundred parcels and twelve hundred footprints, which MapLibre
 * eats without noticing, and an archive is a FILE — it has to be built by Node
 * and served over HTTP with byte-range support. That was the single thing
 * standing between this game and a new city on every run.
 *
 * Everything the tiles carried is still here. The parcel features keep their
 * `bbl`, `demand` and `landpsf` properties, which the lenses read; each has a
 * numeric feature id, which is what feature-state needs; the only difference
 * downstream is that nothing says `source-layer` any more.
 */
export function gameSources(city: {
  parcelFeatures?: unknown; buildingFeatures?: unknown;
} = {}): Record<string, SourceSpecification> {
  return {
    "bw-parcels": { type: "geojson", data: (city.parcelFeatures ?? EMPTY) as never },
    "bw-buildings": { type: "geojson", data: (city.buildingFeatures ?? EMPTY) as never },
    "bw-forsale": { type: "geojson", data: EMPTY } as never,
    "bw-owned": { type: "geojson", data: EMPTY },
    "bw-civic": { type: "geojson", data: EMPTY },
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
  // Assembled sites: teal join on every deed folded into a multi-lot plate.
  // Below selection/neighbor so a pick still reads gold; above owned so the
  // merge is visible without opening the land desk.
  const assembled = ["boolean", ["feature-state", "assembled"], false];
  const owned = ["boolean", ["feature-state", "owned"], false];
  const listed = ["boolean", ["feature-state", "listed"], false];
  return [
    {
      id: "bw-parcel-fill",
      type: "fill",
      source: "bw-parcels",
      paint: {
        "fill-color": [
          "case",
          selected, "#d9a648",
          neighbor, "#3f8f87",
          assembled, "#2f8f86",
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
          assembled, 0.28,
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
      paint: {
        "line-color": [
          "case",
          selected, "#b07f1e",
          neighbor, "#2f7a72",
          assembled, "#1f6f68",
          hovered, "#57534a",
          owned, "#b07f1e",
          listed, "#2f7a72",
          "#9b968b",
        ] as never,
        "line-width": [
          "interpolate", ["linear"], ["zoom"],
          13, ["case", selected, 2.2, neighbor, 1.5, assembled, 1.7, hovered, 1.1, ["case", owned, 1.4, listed, 1.2, 0.2]],
          16.5, ["case", selected, 3.2, neighbor, 2.2, assembled, 2.6, hovered, 1.8, ["case", owned, 2.4, listed, 2, 0.8]],
        ] as never,
        "line-opacity": [
          "interpolate", ["linear"], ["zoom"],
          13, ["case", selected, 1, neighbor, 0.95, assembled, 0.95, hovered, 0.9, ["case", owned, 0.9, listed, 0.8, 0.12]],
          15, ["case", selected, 1, neighbor, 0.95, assembled, 0.97, hovered, 0.9, ["case", owned, 0.95, listed, 0.85, 0.26]],
          16.5, ["case", selected, 1, neighbor, 0.95, assembled, 1, hovered, 0.9, ["case", owned, 1, listed, 0.9, 0.42]],
        ] as never,
      },
    },
    // THE SELECTED LOT, FROM ALTITUDE. The gold outline above is right at
    // street zoom and invisible from the opening camera, where the click
    // read as one slightly warmer roof among four hundred. A soft halo on the
    // ground around the site, wide enough to read at any zoom and drawn only
    // while something is selected.
    {
      id: "bw-select-halo",
      type: "line",
      source: "bw-parcels",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": "#f2c353",
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 6, 14, 9, 16.5, 16] as never,
        "line-opacity": ["case", selected, 0.5, 0] as never,
        "line-blur": 2.5,
      },
    },
    {
      // flat extrusions — hidden by default (the Three.js mesh renderer draws
      // the city); shown ghosted while a lens is active
      id: "bw-bldg-3d",
      type: "fill-extrusion",
      source: "bw-buildings",
      layout: { visibility: "none" },
      paint: {
        "fill-extrusion-height": ["get", "heightM"] as never,
        "fill-extrusion-base": ["get", "baseM"] as never,
        // facade palette: pre-war masonry runs warm, post-war glass runs
        // cool, and a stable per-building tone jitter breaks the uniformity
        "fill-extrusion-color": [
          "case",
          selected, "#e3b95c",
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
      // rooftop pin over player-owned buildings — the ownership mark. The
      // mesh itself is not washed gold; this is how you tell a holding from
      // the rest of the street without hiding the facade.
      id: "bw-owned-pts",
      type: "circle",
      source: "bw-owned",
      minzoom: 12.5,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 3.6, 16, 6.2] as never,
        "circle-color": "#b07f1e",
        "circle-stroke-color": "#fdfbf4",
        "circle-stroke-width": 1.6,
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
    {
      id: "bw-civic-park",
      type: "fill",
      source: "bw-civic",
      filter: ["==", ["get", "kind"], "park"],
      paint: {
        "fill-color": [
          "match", ["get", "stage"],
          "rumor", "#c5d4b0",
          "building", "#9cba7a",
          "#8fb56a",
        ] as never,
        "fill-opacity": [
          "match", ["get", "stage"],
          "rumor", 0.35,
          "building", 0.7,
          0.92,
        ] as never,
      },
    },
    {
      id: "bw-civic-park-line",
      type: "line",
      source: "bw-civic",
      filter: ["==", ["get", "kind"], "park"],
      paint: {
        "line-color": "#5a6e48",
        "line-width": ["interpolate", ["linear"], ["zoom"], 13, 0.8, 16.5, 2.2] as never,
      },
    },
    {
      id: "bw-civic-bridge",
      type: "fill",
      source: "bw-civic",
      filter: ["==", ["get", "kind"], "bridge"],
      paint: {
        "fill-color": [
          "match", ["get", "stage"],
          "rumor", "#b7b1a4",
          "building", "#7a6f5c",
          "#6e6758",
        ] as never,
        "fill-opacity": ["match", ["get", "stage"], "rumor", 0.4, 0.9] as never,
      },
    },
    {
      id: "bw-civic-station",
      type: "circle",
      source: "bw-civic",
      filter: ["==", ["get", "kind"], "station"],
      minzoom: 12,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 3.2, 16, 6.5] as never,
        "circle-color": [
          "match", ["get", "stage"],
          "rumor", "#8a93a0",
          "building", "#c4a35a",
          "#2f4a63",
        ] as never,
        "circle-stroke-color": "#f4f3ef",
        "circle-stroke-width": 1.6,
        "circle-opacity": ["match", ["get", "stage"], "rumor", 0.55, 1] as never,
        "circle-pitch-alignment": "map",
      },
    },
  ];
}

// Fully offline fallback: pale-blue harbor, white-paper landmass, soft parks
// and piers from context.geojson — the architectural-model base, self-contained.
export function fallbackBaseStyle(context?: unknown): StyleSpecification {
  return {
    version: 8,
    name: "bw-fallback",
    sources: {
      // The water, the parks, the piers and the street surfaces — generated
      // with the rest of the city rather than fetched beside it.
      "bw-context": { type: "geojson", data: (context ?? EMPTY) as never },
    },
    layers: [
      // open water is deeper than the harbor: the shallows band along the
      // coast is what makes the sea read as water with a bottom instead of a
      // sheet of blue paint
      // The Three.js layer paints the living sea over the top of this; the
      // background and the shallows band remain as the still-water fallback
      // for anyone whose WebGL context never comes up. Both are matched by eye
      // against what WATER_FRAG actually puts on screen at the gameplay camera
      // (its deep runs ~#3386b7 near, hazing lighter with distance), so the
      // loading frame and the living sea are the same harbour — the old slate
      // #2d5f86 was a different, duller ocean for the first second of every
      // session. The background also shows raw past the sea mesh at extreme
      // pitch, where a mismatch reads as a hard band across the world's edge.
      { id: "bg", type: "background", paint: { "background-color": OPEN_SEA } },
      {
        id: "shallows",
        type: "fill",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "shallows"],
        // deeper and greener than it was: the shoal is a bottom seen through
        // water, not a pale ring — kept between the open-water tone above and
        // WATER_FRAG's own shallow (~#4f88a1) so neither renderer's coast glows
        paint: { "fill-color": "#5d99ad" },
      },
      {
        id: "marsh",
        type: "fill",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "marsh"],
        paint: { "fill-color": "#6a8a6e", "fill-opacity": 0.72 },
      },
      {
        id: "rock",
        type: "fill",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "rock"],
        paint: { "fill-color": "#8a8680", "fill-opacity": 0.55 },
      },
      {
        id: "beach",
        type: "fill",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "beach"],
        // wet sand, not dry: measured on the wide shot the old pale band at
        // 0.7 was one third of the white ring hugging the island. Darker and
        // more transparent, it reads as the tide line a model-maker paints.
        paint: { "fill-color": "#cdbb92", "fill-opacity": 0.55 },
      },
      {
        id: "land",
        type: "fill",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "land"],
        paint: { "fill-color": "#e2ddd0" },
      },
      {
        id: "seawall",
        type: "fill",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "seawall"],
        // the masonry lip where the town meets the tide — darkened until it
        // reads as the hard waterline of a scale model, the one line on the
        // coast that is allowed to be emphatic
        paint: { "fill-color": "#837e75", "fill-opacity": 0.9 },
      },
      {
        // The waterline itself. This was a near-white stroke at 70% with more
        // blur than width, which against the old pale sea was a hint and
        // against a sea that now has a real value became a lit halo ringing
        // the whole island. A waterline is a wet edge, not a light source:
        // narrower than its blur radius, cooler, and much further down.
        // Taken further down again: sampled on the strategic shot the coast
        // still ringed the island in near-white, and this stroke plus the pale
        // esplanade were the land half of it. A wet edge belongs a step BELOW
        // the sand it darkens, so the colour drops toward the shoal.
        id: "coast-foam",
        type: "line",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "coastline"],
        paint: {
          "line-color": "#b7cdd4",
          "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 16, 1.4] as never,
          "line-opacity": 0.3,
          "line-blur": 0.4,
        },
      },
      {
        id: "esplanade",
        type: "fill",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "esplanade"],
        // the promenade ring was within a couple of points of the block fills,
        // which made it the widest single piece of the coastal halo. A worn
        // paving tone, clearly below the blocks and above the roadway.
        // and a step further: the promenade is worn granite setts, not chalk
        paint: { "fill-color": "#bdb9ab" },
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
        // sits with the sidewalks in the pedestrian family — a step below the
        // block fills, well above the asphalt — so an open lot reads as ground
        // between buildings rather than as more street
        paint: { "fill-color": "#bab5a6" },
      },
      {
        // the carriageway that rings a park — under the green, not over it.
        // Between the sidewalk band and the roadway in value: a frontage ring,
        // its own worn surface, matching neither.
        id: "apron",
        type: "fill",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "apron"],
        // the same asphalt as every other street: in the 3D city a lighter
        // frontage ring read as a patch, not a road (the park itself now has
        // a raised footway and kerb round it to mark the edge)
        paint: { "fill-color": "#55575a" },
      },
      {
        // THE MALL BETWEEN THE CARRIAGEWAYS. A grand boulevard is two roadways
        // either side of planted ground, not one field of asphalt — the
        // generator now cuts the reservation that way and this is the green in
        // the middle of it. A shade duller and drier than a park's lawn: it is
        // a median under allée trees, mown but walked over, and it must not
        // read as somewhere you could sit.
        id: "median",
        type: "fill",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "median"],
        paint: { "fill-color": "#a8bd93" },
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
        id: "breakwater",
        type: "fill",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "breakwater"],
        paint: { "fill-color": "#7a756c" },
      },
      {
        id: "breakwater-edge",
        type: "line",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "breakwater"],
        paint: {
          "line-color": "#4e4a44",
          "line-width": ["interpolate", ["linear"], ["zoom"], 13, 0.8, 16.5, 2.4] as never,
        },
      },
      {
        id: "quay",
        type: "line",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "quay"],
        paint: {
          "line-color": "#6e6a62",
          "line-width": ["interpolate", ["linear"], ["zoom"], 13, 1.2, 16.5, 3.4] as never,
        },
      },
      {
        // ROADWAY. The cells tile the land, so painting them asphalt and then
        // painting the blocks back on top leaves exactly the street corridor
        // between two curbs. This is the surface; the layers below it are the
        // markings on it. The green is painted AFTER this, so a leftover
        // sliver that still overlaps a park cannot paste a road on the lawn.
        id: "pavement",
        type: "fill",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "pavement"],
        // the colonial quarter is paved in setts, not fresh asphalt — a
        // warmer, browner surface that marks the old town at a glance.
        //
        // Darker again. The last pass took the asphalt down and it was still
        // not enough: at the strategic camera the whole interior read as one
        // mid-grey sheet, streets included. The calibration is a scale model —
        // chipboard blocks on basswood streets — where the carriageway is a
        // full material step below everything that is not a kerb line, and the
        // hierarchy this ladder is tuned against runs (dark to light) curb →
        // seam → asphalt → apron → sidewalk/paveland → esplanade → block. The
        // per-district tints keep their leanings; only the value moved.
        paint: {
          "fill-color": [
            "case",
            ["==", ["get", "org"], 1], "#5e574e",
            ["match", ["coalesce", ["get", "dt"], 0],
              0, "#55575a", 1, "#535759", 2, "#58575a", 3, "#545859", 4, "#57565a",
              "#55575a"],
          ] as never,
        },
      },
      {
        // THE ASPHALT HAS A SURFACE. A faint grain over the flat roadway paint
        // — aggregate speckle, tar seams and worn patches (an alpha texture
        // made at runtime, see groundGrain) — so the carriageway reads as a
        // material up close. Gone at the strategic zoom, where it would be
        // noise.
        id: "pavement-grain",
        type: "fill",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "pavement"],
        minzoom: 15,
        paint: {
          "fill-pattern": "bw-grain-asphalt",
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 15, 0, 16.5, 0.85] as never,
        },
      },
      {
        // painted crossings at the gridded corners
        id: "crosswalk",
        type: "fill",
        source: "bw-context",
        // retired: a solid nine-metre bar whatever the street's width. The
        // zebras below are measured from each corner's own carriageway.
        filter: ["==", ["get", "kind"], "__retired_crosswalk"],
        minzoom: 14,
        paint: {
          "fill-color": "#e6e2d2",
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0.35, 16, 0.8] as never,
        },
      },
      {
        // the block itself — warm paper, a clear step off the asphalt; the
        // old town runs a shade warmer still. Lifted only slightly: the block
        // is the palest ground surface and the top of the ladder, but the
        // bloom bright-pass (threshold set against January snow roofs) is
        // waiting just above these values, so the street-to-block contrast is
        // bought with dark asphalt, not with whiter paper.
        id: "blocks",
        type: "fill",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "block"],
        paint: {
          "fill-color": blocksPaint(0) as never,
        },
      },
      {
        // the yards are walked on and mown: a soft mottling over the block
        // paint, the same alpha-only trick as the asphalt grain
        id: "blocks-grain",
        type: "fill",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "block"],
        minzoom: 15,
        paint: {
          "fill-pattern": "bw-grain-yard",
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 15, 0, 16.5, 0.8] as never,
        },
      },
      {
        // THE BACK ALLEY (street plan 4). A 16 ft service lane down the spine
        // of an alley block: poured concrete gone grey, a step lighter than the
        // carriageway and a step darker than the yards either side of it, so
        // the two rows of lots read as backing onto something rather than
        // onto each other.
        id: "alley",
        type: "fill",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "alley"],
        paint: {
          "fill-color": "#6d6b66",
        },
      },
      {
        // THE FOOTWAY. A ring of concrete outside every block's kerb line, in
        // metres and as wide as the street it fronts warrants (citygen sizes
        // it) — the lightest ground surface in town, because a street is read
        // from the air by its two pale edges more than by its asphalt.
        id: "sidewalk",
        type: "fill",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "sidewalk"],
        paint: {
          "fill-color": [
            "case",
            ["==", ["get", "org"], 1], "#cfc5b2",
            ["match", ["coalesce", ["get", "dt"], 0],
              0, "#d2cfc6", 1, "#cdd0c9", 2, "#d4cec2", 3, "#ccd0c6", 4, "#d3ccc5",
              "#d2cfc6"],
          ] as never,
          "fill-antialias": true,
        },
      },
      {
        // CURB, PART ONE: the gutter. The darkest thing on the ground, as a
        // kerb's own shadow and the wet line of grit beside it always are.
        id: "curb-shadow",
        type: "line",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "curb"],
        minzoom: 14,
        paint: {
          "line-color": "#34353a",
          "line-width": metres(0.62, 0.5) as never,
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0.35, 16, 0.75] as never,
        },
        layout: { "line-join": "round" },
      },
      {
        // CURB, PART TWO: the granite top, catching the light
        id: "curb",
        type: "line",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "curb"],
        minzoom: 15,
        paint: {
          "line-color": "#b9b5ab",
          "line-width": metres(0.24) as never,
        },
        layout: { "line-join": "round" },
      },
      {
        // LANE MARKINGS, BY WIDTH. citygen measured each street: a narrow
        // residential street carries no paint, a working street a dashed
        // centre line, an avenue the double yellow. Metres again, so a line
        // is ten centimetres at every scale and does not swell into a stripe.
        id: "lane-divider",
        type: "line",
        source: "bw-context",
        filter: ["all", ["==", ["get", "kind"], "centerline"], ["==", ["get", "mk"], 1]],
        minzoom: 15,
        paint: {
          "line-color": "#ece6cf",
          "line-width": metres(0.15, 0.6) as never,
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 15, 0, 16, 0.75] as never,
          "line-dasharray": [10, 14],
        },
      },
      {
        id: "lane-double-a",
        type: "line",
        source: "bw-context",
        filter: ["all", ["==", ["get", "kind"], "centerline"], ["==", ["get", "mk"], 2]],
        minzoom: 14.5,
        paint: {
          "line-color": "#e2c35a",
          "line-width": metres(0.15, 0.55) as never,
          "line-offset": metres(0.2, 0.5) as never,
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 14.5, 0, 15.5, 0.85] as never,
        },
      },
      {
        id: "lane-double-b",
        type: "line",
        source: "bw-context",
        filter: ["all", ["==", ["get", "kind"], "centerline"], ["==", ["get", "mk"], 2]],
        minzoom: 14.5,
        paint: {
          "line-color": "#e2c35a",
          "line-width": metres(0.15, 0.55) as never,
          "line-offset": metres(0.2, 0.5, -1) as never,
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 14.5, 0, 15.5, 0.85] as never,
        },
      },
      {
        // ZEBRAS. A three-metre band laid across the carriageway and broken
        // into sixty-centimetre bars by its own dash pattern — a dash is a
        // multiple of the line's width, so the bars stay bars at any zoom.
        id: "zebra",
        type: "line",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "zebra"],
        minzoom: 15,
        paint: {
          "line-color": "#eeece4",
          "line-width": metres(3.0) as never,
          "line-dasharray": [0.2, 0.22],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 15, 0, 16, 0.85] as never,
        },
      },
      {
        // the shore road still gets its own stroke — sun-bleached concrete, a
        // shade off the darker grid asphalt but nowhere near the pale coast rim
        id: "streets",
        type: "line",
        source: "bw-context",
        filter: ["all", ["==", ["get", "kind"], "street"], ["==", ["get", "cls"], "shore"]],
        paint: {
          "line-color": "#6c6c6c",
          "line-width": metres(9, 1.2) as never,
        },
        layout: { "line-join": "round", "line-cap": "round" },
      },
      {
        // the boundary avenues: a heavier, older surface, kept a step below
        // the grid asphalt so the district seams still draw themselves
        id: "seam",
        type: "line",
        source: "bw-context",
        filter: ["all", ["==", ["get", "kind"], "street"], ["==", ["get", "cls"], "seam"]],
        paint: {
          "line-color": "#4c4d50",
          "line-width": metres(13, 1.6) as never,
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
        // TURF ABOVE THE ROADWAY. Apron stays underneath so the frontage
        // ring still reads; pavement, dashes, sidewalks and seams used to
        // sit on top of the green and that is the road through the Common.
        id: "parks",
        type: "fill",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "park"],
        paint: {
          "fill-color": parksPaint(0) as never,
        },
      },
      {
        // Kerbed edge of the painted green. Was a soft tint-on-tint outline
        // that disappeared against the lawn; without a hard stop the turf and
        // the flanking lots read as one field across the frontage road.
        id: "park-outline",
        type: "line",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "park"],
        paint: {
          "line-color": "#6e6b64",
          "line-width": ["interpolate", ["linear"], ["zoom"], 13, 0.8, 16.5, 2.4] as never,
        },
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
        // THE CREEK'S OWN GROUND. The lots were cut back from every channel
        // by a clearance band and the band was left as bare paving — a pale
        // strip either side of the water that read as a dry riverbed. It is
        // a bank: rough grass down to the stone, darker than a mown park.
        id: "bank",
        type: "fill",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "bank"],
        paint: { "fill-color": "#8f9f76" },
      },
      {
        // Inland water, ABOVE the roadway. Pavement used to paint over the
        // creek wherever a cell still overlapped the ribbon, which read as
        // asphalt triangles stretching to the bank.
        id: "streams",
        type: "fill",
        source: "bw-context",
        filter: ["all",
          ["==", ["get", "kind"], "stream"],
          ["!=", ["get", "water"], "pond"],
        ],
        paint: {
          "fill-color": [
            "match", ["coalesce", ["get", "water"], "creek"],
            "canal", "#4e7f96",
            "slip", "#3d6a80",
            "#4a7a8e",
          ] as never,
        },
      },
      {
        id: "stream-edge",
        type: "line",
        source: "bw-context",
        filter: ["all",
          ["==", ["get", "kind"], "stream"],
          ["!=", ["get", "water"], "pond"],
        ],
        paint: {
          "line-color": "#2f5566",
          "line-width": ["interpolate", ["linear"], ["zoom"], 13, 0.7, 16.5, 2.0] as never,
        },
      },
      {
        // Mill pond ON TOP of the ribbon so the race's straight bank does
        // not draw a chord through the water it already empties into.
        id: "stream-ponds",
        type: "fill",
        source: "bw-context",
        filter: ["all", ["==", ["get", "kind"], "stream"], ["==", ["get", "water"], "pond"]],
        paint: { "fill-color": "#3f6e82" },
      },
      {
        id: "stream-pond-edge",
        type: "line",
        source: "bw-context",
        filter: ["all", ["==", ["get", "kind"], "stream"], ["==", ["get", "water"], "pond"]],
        paint: { "line-color": "#2c5160", "line-width": 1.2 },
      },
      {
        // deck matches the roadway it carries — the asphalt darkened, so the
        // bridges follow, or every crossing arrives as a pale patch mid-stream
        id: "bridges",
        type: "fill",
        source: "bw-context",
        // retired: the 3D layer builds each crossing (RealCityLayer.buildBridges)
        // and a flat grey slab under it read as a second, sunken deck
        filter: ["==", ["get", "kind"], "__retired_bridge"],
        paint: { "fill-color": "#67665f" },
      },
      {
        id: "bridge-edge",
        type: "line",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "__retired_bridge"],
        paint: {
          "line-color": "#4a4844",
          "line-width": ["interpolate", ["linear"], ["zoom"], 13, 1.1, 16.5, 2.6] as never,
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
        // the drawn edge of the landmass: darker than the water beside it, so
        // the island ends on a line the way a model ends at its baseboard —
        // the old pale #a3b8c6 stroke was one more layer of coastal glow
        id: "shore",
        type: "line",
        source: "bw-context",
        filter: ["==", ["get", "kind"], "land"],
        paint: { "line-color": "#7f9dad", "line-width": 1.2 },
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

export async function resolveBaseStyle(context?: unknown): Promise<StyleSpecification> {
  if (!BASEMAP_URL) return fallbackBaseStyle(context);
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
    return fallbackBaseStyle(context);
  }
}

// weather mixing shared by the sky and light specs below
const mixRgb = (a: [number, number, number], b: [number, number, number], t: number) => {
  const k = Math.max(0, Math.min(1, t));
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * k));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
};

/**
 * THE SKY, ONCE. These constants used to live twice — here for the style, and
 * cloned into MapView's weather effect — and the first overcast tick silently
 * reverted whatever the style said. One function, taken by both callers, with
 * the overcast mix folded in: 0 is the clear-day sky the style opens on.
 *
 * THE HORIZON. Without one the world ends at a hard blue edge and the city
 * sits in a void. A graded sky, a pale band where it meets the sea, and a
 * whisper of ground fog in the last of the distance — which is the same
 * aerial perspective the building shader applies, so the 3D and the map
 * agree about how far away far is.
 * A SKY WITH A TOP TO IT. Every number here was pulling the same way: a
 * pale zenith, a horizon blend of 0.76 that dragged that pale band most of
 * the way up the dome, and an atmosphere blend of 0.9 that washed whatever
 * survived. The result was a flat cream field above a flat blue field —
 * no gradient, no altitude, and nothing for the skyline to be drawn
 * against. Deeper at the zenith, warmer where it meets the water, and the
 * blend pulled back so the transition happens near the horizon where a
 * real one does.
 * Retuned as a set: the zenith a step deeper (late afternoon has a top to
 * it), the horizon band pulled warm off the cool axis (the sea's own far
 * fade stays cool below it, which is the right way round for a low sun),
 * and the fog set to the exact HAZE_COOL the building shader scatters —
 * vec3(0.742, 0.818, 0.900) is #bdd1e6 — so the far city dissolves into
 * the same air the sky is made of instead of a slightly different one.
 */
export function skySpec(cloud: number): NonNullable<StyleSpecification["sky"]> {
  return {
    "sky-color": mixRgb([66, 133, 197], [112, 132, 145], cloud),
    "sky-horizon-blend": 0.52,
    "horizon-color": mixRgb([228, 231, 219], [197, 199, 189], cloud),
    "horizon-fog-blend": 0.72,
    "fog-color": mixRgb([189, 209, 230], [164, 177, 184], cloud),
    "fog-ground-blend": 0.80,
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 12, 0.72, 15.5, 0.52, 18, 0.32] as never,
  };
}

// a low sun off the port side gives extrusion faces the model-photo
// contrast; anchored to the map so shading stays put as you orbit. Overcast
// flattens it — same single-source rule as the sky.
export function lightSpec(cloud: number): NonNullable<StyleSpecification["light"]> {
  return {
    anchor: "map",
    color: mixRgb([255, 255, 255], [205, 211, 214], cloud),
    intensity: 0.42 - cloud * 0.12,
    position: [1.15, 135, 55],
  };
}

export function composeStyle(base: StyleSpecification, city?: {
  parcelFeatures?: unknown; buildingFeatures?: unknown;
}): StyleSpecification {
  // Model-city cleanliness: strip basemap labels/POIs unless asked to keep
  // them (VITE_BASEMAP_LABELS=on). Roads, parks, and water stay.
  const keepLabels = import.meta.env.VITE_BASEMAP_LABELS === "on";
  const baseLayers = (base.layers ?? []).filter((l) => keepLabels || l.type !== "symbol");
  return {
    ...base,
    light: lightSpec(0),
    sky: skySpec(0),
    sources: { ...base.sources, ...gameSources(city) },
    layers: [...baseLayers, ...gameLayers()],
  };
}


/**
 * Alpha-only ground textures, drawn once at runtime (no image files: the game
 * ships as one HTML file). Asphalt: fine light aggregate and dark tar specks,
 * a few long crack seams and darker repair patches. Yard: soft darker and
 * lighter mottling. Each pixel is black or white at low alpha, so it shades
 * whatever colour the layer below already painted (season, snow, district).
 */
export function groundGrain(kind: "asphalt" | "yard", size = 256): { width: number; height: number; data: Uint8Array } {
  const data = new Uint8Array(size * size * 4);
  let s = kind === "asphalt" ? 1234567 : 7654321;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const put = (x: number, y: number, v: number, a: number) => {
    const xi = ((Math.round(x) % size) + size) % size, yi = ((Math.round(y) % size) + size) % size;
    const i = (yi * size + xi) * 4;
    // composite over what is there
    const a0 = data[i + 3] / 255, a1 = a + a0 * (1 - a);
    const c = a1 > 0 ? (v * a + (data[i] / 255) * a0 * (1 - a)) / a1 : 0;
    data[i] = data[i + 1] = data[i + 2] = Math.round(c * 255); data[i + 3] = Math.round(a1 * 255);
  };
  const blob = (cx: number, cy: number, r: number, v: number, a: number) => {
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      const d = Math.hypot(x, y) / r;
      if (d < 1) put(cx + x, cy + y, v, a * (1 - d * d));
    }
  };
  if (kind === "asphalt") {
    for (let i = 0; i < size * size * 0.18; i++) put(rnd() * size, rnd() * size, rnd() < 0.5 ? 1 : 0, 0.05 + rnd() * 0.1);
    for (let i = 0; i < 5; i++) blob(rnd() * size, rnd() * size, 14 + rnd() * 26, 0, 0.1);
    for (let i = 0; i < 3; i++) {
      let x = rnd() * size, y = rnd() * size, a = rnd() * 6.28;
      for (let k = 0; k < 60; k++) { put(x, y, 0, 0.22); a += (rnd() - 0.5) * 0.6; x += Math.cos(a); y += Math.sin(a); }
    }
  } else {
    for (let i = 0; i < 40; i++) blob(rnd() * size, rnd() * size, 6 + rnd() * 18, rnd() < 0.6 ? 0 : 1, 0.06 + rnd() * 0.05);
    for (let i = 0; i < size * size * 0.06; i++) put(rnd() * size, rnd() * size, rnd() < 0.7 ? 0 : 1, 0.04 + rnd() * 0.05);
  }
  return { width: size, height: size, data };
}
