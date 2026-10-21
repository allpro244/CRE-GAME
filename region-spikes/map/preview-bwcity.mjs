#!/usr/bin/env node
/** Top-down SVG of a bw-city/1 file, to check an export before it goes to Unreal.
 *   node region-spikes/map/preview-bwcity.mjs out/city-region-3-crop2000.json  -> same name .svg
 * Reads the file the way CityData.cpp does: +X north, +Y east, cm. */
import fs from "node:fs";
const file = process.argv[2];
const c = JSON.parse(fs.readFileSync(file, "utf8"));
const { minX, maxX, minY, maxY } = c.bounds;
const sx = (Y) => ((Y - minY) / 100).toFixed(1), sy = (X) => ((maxX - X) / 100).toFixed(1); // east right, north up, metres
const ptsOf = (r) => { const o = []; for (let i = 0; i + 1 < r.length; i += 2) o.push(`${sx(r[i + 1])},${sy(r[i])}`); return o; };
const poly = (r) => "M" + ptsOf(r).join("L") + "Z";
const line = (r) => "M" + ptsOf(r).join("L");
const COL = { land: "#e8e4d4", marsh: "#a6c4a9", farm: "#ddd6b2", woods: "#9bb486", yard: "#c9dcaa", pavement: "#8f8f8f", block: "#b5aea4", park: "#8fc07a", stream: "#7fb0d8", pond: "#7fb0d8" };
const W = (maxY - minY) / 100, H = (maxX - minX) / 100;
const o = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${Math.min(2400, W / 2)}" height="${Math.min(2400, W / 2) * H / W}"><rect width="${W}" height="${H}" fill="#6f9fc8"/>`];
for (const [k, rings] of Object.entries(c.ground)) o.push(`<path d="${rings.map(poly).join("")}" fill="${COL[k] ?? "#f0f"}"/>`);
o.push(`<path d="${c.markings.centerlines.map((l) => line(l.line)).join("")}" stroke="#fff" stroke-width="1.2" fill="none"/>`);
const t = []; for (let i = 0; i + 1 < c.trees.length; i += 2) t.push(`M${sx(c.trees[i + 1])},${sy(c.trees[i])}h0.1`);
o.push(`<path d="${t.join("")}" stroke="#2f6b2a" stroke-width="4" stroke-linecap="round"/>`);
const shade = (v) => v.deco === "house" ? (v.z1 > 500 ? "#b0574a" : "#c98a62") : v.z1 > 355 * 20 ? "#2b2f4a" : v.z1 > 355 * 8 ? "#4b4f6a" : "#7a7488";
const byCol = new Map(); for (const v of c.volumes) { const k = shade(v); (byCol.get(k) || byCol.set(k, []).get(k)).push(poly(v.ring)); }
for (const [k, ps] of byCol) o.push(`<path d="${ps.join("")}" fill="${k}"/>`);
for (const l of c.labels) o.push(`<text x="${sx(l.at[1])}" y="${sy(l.at[0])}" font-size="${W / 60}" font-family="sans-serif" text-anchor="middle" stroke="#fff" stroke-width="${W / 400}" paint-order="stroke">${l.name}</text>`);
o.push("</svg>");
const out = file.replace(/\.json$/, ".preview.svg");
fs.writeFileSync(out, o.join("\n"));
console.log(out);
