// ONE ISLAND AS A PLAT DRAWING. The generator's output, rendered the way a
// county clerk would file it: water, land, streets, blocks, lots colored by
// class, parks green, streams blue, aprons grey — and every sliver lot
// stroked red so the pathology the eye complains about is circled on the
// page. No browser, no game, ~1s per island; this is the instrument the
// gallery and every citygen change review through.
//
//   node tools/plat-svg.mjs <seed> [out.svg] [--size city] [--dev village]
import { writeFileSync } from "node:fs";
import { makeCity } from "../src/citygen/index.mjs";
import { makeProjection } from "../src/citygen/geom.mjs";
import { measurePlat } from "./platlib.mjs";

// The map's own class colors (src/data/types.ts CLASS_COLOR), hardcoded here
// because this tool must run without the TS build.
const CLASS_FILL = {
  office: "#7f95ad", retail: "#c08552", multifamily: "#8aab8a",
  industrial: "#8f8f7a", land: "#d6cbb0", mixed: "#a08fa5",
};
const KIND_STYLE = {
  land: { fill: "#e2ddd0" },
  beach: { fill: "#d9c9a3" },
  marsh: { fill: "#6a8a6e", opacity: 0.6 },
  esplanade: { fill: "#dcded2" },
  paveland: { fill: "#cbc7bb" },
  apron: { fill: "#918e88" },
  park: { fill: "#b7d29f" },
  pond: { fill: "#a9cadf" },
  stream: { fill: "#4e7f96" },
  bridge: { fill: "#797875" },
  pavement: { fill: "#7a7875" },
  street: { fill: "#9b978f" },
  block: { fill: "#e5dcc6" },
  seawall: { fill: "#9a958c" },
  quay: { fill: "#8f8a80" },
};
// Drawn in this order; anything not listed is skipped (trees, benches, rail
// and labels are noise at plat scale).
const DRAW_ORDER = ["land", "beach", "marsh", "esplanade", "paveland", "pavement", "block", "street", "park", "apron", "pond", "stream", "bridge", "seawall", "quay"];

export function renderPlatSVG(city, { w = 640 } = {}) {
  const proj = makeProjection(...city.manifest.core);
  const P = (pt) => proj.toXY(pt);
  const [x0, y0] = P([city.manifest.bbox[0], city.manifest.bbox[1]]);
  const [x1, y1] = P([city.manifest.bbox[2], city.manifest.bbox[3]]);
  const pad = 60;
  const sx = (w - 2) / (x1 - x0 + pad * 2);
  const h = Math.round((y1 - y0 + pad * 2) * sx);
  // SVG y grows down; the projection's y grows north.
  const X = (x) => ((x - x0 + pad) * sx).toFixed(1);
  const Y = (y) => (h - (y - y0 + pad) * sx).toFixed(1);
  const path = (ring) => "M" + ring.map((p) => `${X(p[0])},${Y(p[1])}`).join("L") + "Z";

  const m = measurePlat(city);
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h + 34}" viewBox="0 0 ${w} ${h + 34}">`,
    `<rect width="${w}" height="${h + 34}" fill="#a9c8dd"/>`];

  const byKind = new Map();
  for (const f of city.context.features) {
    const k = f.properties?.kind;
    if (!KIND_STYLE[k]) continue;
    if (!byKind.has(k)) byKind.set(k, []);
    byKind.get(k).push(f);
  }
  for (const kind of DRAW_ORDER) {
    const style = KIND_STYLE[kind];
    for (const f of byKind.get(kind) ?? []) {
      const g = f.geometry;
      if (g.type === "Polygon") {
        const ring = g.coordinates[0].map(P);
        parts.push(`<path d="${path(ring)}" fill="${style.fill}"${style.opacity ? ` fill-opacity="${style.opacity}"` : ""}/>`);
      } else if (g.type === "LineString") {
        const pts = g.coordinates.map(P);
        const d = "M" + pts.map((p) => `${X(p[0])},${Y(p[1])}`).join("L");
        parts.push(`<path d="${d}" fill="none" stroke="${style.fill}" stroke-width="1.2"/>`);
      }
    }
  }
  // Lots on top: class fill, hairline stroke; slivers stroked red so the
  // gallery circles its own defects.
  for (const l of m._lots) {
    const fill = CLASS_FILL[l.cls] ?? "#b5a67f";
    const stroke = l.sliver ? "#c8452f" : "#00000030";
    const sw = l.sliver ? 1.6 : 0.4;
    parts.push(`<path d="${path(l.ring)}" fill="${fill}" fill-opacity="0.82" stroke="${stroke}" stroke-width="${sw}"/>`);
  }
  const meander = m.streams.length ? Math.min(...m.streams.map((s) => s.meander)).toFixed(2) : "—";
  parts.push(`<text x="10" y="${h + 22}" font-family="Georgia,serif" font-size="15" fill="#2b251a">`
    + `${city.manifest.city} · ${city.seed} · ${m.lots} lots · sliver ${m.sliverPct}% · void ${m.largestVoidM2}m² · meander ${meander} · grad ${m.gradient ?? "—"}</text>`);
  parts.push("</svg>");
  return { svg: parts.join("\n"), metrics: m, width: w, height: h + 34 };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const seed = Number(args[0]);
  if (!seed) { console.error("usage: node tools/plat-svg.mjs <seed> [out.svg] [--size city] [--dev village]"); process.exit(1); }
  const out = args[1] && !args[1].startsWith("--") ? args[1] : `plat-${seed}.svg`;
  const flag = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : d; };
  const city = makeCity("somewhere", seed, { size: flag("size", "city"), density: flag("dev", "village") });
  const { svg, metrics } = renderPlatSVG(city);
  writeFileSync(out, svg);
  console.log(out, "·", metrics.lots, "lots · sliver", metrics.sliverPct + "%");
}
