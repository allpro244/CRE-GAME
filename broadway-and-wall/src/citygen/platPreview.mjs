// THE TOWN AS A PLAT, FOR THE SETUP SCREEN. The same drawing tools/plat-svg.mjs
// files for the gallery — water, land, streets, blocks, parks, and every lot
// coloured by what stands on it — without the defect-hunting overlay, so a
// player can look at what a seed deals before breaking ground on it.
import { makeProjection } from "./geom.mjs";

// The map's own class colours (src/data/types.ts CLASS_COLOR).
const CLASS_FILL = {
  office: "#7f95ad", retail: "#c08552", multifamily: "#8aab8a",
  industrial: "#8f8f7a", land: "#d6cbb0", mixed: "#a08fa5",
};
const KIND_FILL = {
  land: "#e2ddd0", beach: "#d9c9a3", marsh: "#8aa58c", esplanade: "#dcded2",
  paveland: "#cbc7bb", apron: "#918e88", median: "#a8bd93", park: "#b7d29f",
  pond: "#a9cadf", stream: "#4e7f96", bridge: "#797875", pavement: "#7a7875",
  street: "#9b978f", block: "#e5dcc6", alley: "#8d8981", seawall: "#9a958c", quay: "#8f8a80",
};
const DRAW_ORDER = ["land", "beach", "marsh", "esplanade", "paveland", "pavement", "block", "alley", "street", "park", "apron", "median", "pond", "stream", "bridge", "seawall", "quay"];

/** An SVG string of the town's plat, `w` px wide; the height follows the island. */
export function platPreviewSVG(city, w = 900) {
  const proj = makeProjection(...city.manifest.core);
  const P = (pt) => proj.toXY(pt);
  const [x0, y0] = P([city.manifest.bbox[0], city.manifest.bbox[1]]);
  const [x1, y1] = P([city.manifest.bbox[2], city.manifest.bbox[3]]);
  const pad = 60;
  const sx = (w - 2) / (x1 - x0 + pad * 2);
  const h = Math.round((y1 - y0 + pad * 2) * sx);
  const X = (x) => ((x - x0 + pad) * sx).toFixed(1);
  const Y = (y) => (h - (y - y0 + pad) * sx).toFixed(1);
  const path = (ring) => "M" + ring.map((p) => `${X(p[0])},${Y(p[1])}`).join("L") + "Z";
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">`,
    `<rect width="${w}" height="${h}" fill="#a9c8dd"/>`];
  const byKind = new Map();
  for (const f of city.context.features) {
    const k = f.properties?.kind;
    if (!KIND_FILL[k]) continue;
    if (!byKind.has(k)) byKind.set(k, []);
    byKind.get(k).push(f);
  }
  for (const kind of DRAW_ORDER) {
    const fill = KIND_FILL[kind];
    for (const f of byKind.get(kind) ?? []) {
      const g = f.geometry;
      if (g?.type === "Polygon") {
        parts.push(`<path d="${path(g.coordinates[0].map(P))}" fill="${fill}"/>`);
      } else if (g?.type === "LineString") {
        const pts = g.coordinates.map(P);
        parts.push(`<path d="M${pts.map((p) => `${X(p[0])},${Y(p[1])}`).join("L")}" fill="none" stroke="${fill}" stroke-width="1.2"/>`);
      }
    }
  }
  let lots = 0;
  for (const f of city.parcelFeatures.features) {
    const raw = f.geometry?.coordinates?.[0];
    if (!raw || raw.length < 4) continue;
    const ring = raw.map(P);
    if (!ring.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) continue;
    const cls = city.parcels[f.properties?.bbl]?.class ?? f.properties?.class;
    parts.push(`<path d="${path(ring)}" fill="${CLASS_FILL[cls] ?? "#b5a67f"}" fill-opacity="0.85" stroke="#00000055" stroke-width="0.4"/>`);
    lots++;
  }
  parts.push("</svg>");
  return { svg: parts.join(""), lots, name: city.manifest.city };
}
