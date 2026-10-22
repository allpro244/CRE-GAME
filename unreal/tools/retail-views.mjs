// Camera views of the region's retail (bbl prefix "3", class retail) for -LookFile renders:
//   node unreal/tools/retail-views.mjs <city.json> <views.json>
// Per site kind (neighbourhood, power and community centres, strips, a fast-food
// pad, a bank, gas): an oblique from the car park onto the storefronts (a
// volume's "front" is its storefront's middle), a closer eye-level one, and an
// aerial; plus a wide aerial over the power centre. Cm and degrees, as
// BWGame's -LookFile reads them (yaw: the way the camera looks).
import { readFileSync, writeFileSync } from "node:fs";

const [, , inFile, outFile] = process.argv;
const d = JSON.parse(readFileSync(inFile, "utf8"));
const cen = (r) => { let x = 0, y = 0; for (let i = 0; i < r.length; i += 2) { x += r[i]; y += r[i + 1]; } return [x / (r.length / 2), y / (r.length / 2)]; };
const area = (r) => { let a = 0; const n = r.length / 2; for (let i = 0; i < n; i++) { const j = (i + 1) % n; a += r[2 * i] * r[2 * j + 1] - r[2 * j] * r[2 * i + 1]; } return Math.abs(a / 2); };
const parcels = d.parcels.filter((p) => p.bbl.startsWith("3") && p.cls === "retail");
const vols = d.volumes.filter((v) => v.bbl.startsWith("3") && v.cls === "retail" && v.deco !== "sign");
const views = [];
const deg = (x, y) => (Math.atan2(y, x) * 180) / Math.PI;
function site(re, name, dist, pick = 0, which = "big") {
  const p = parcels.filter((q) => re.test(q.address))[pick];
  if (!p) return null;
  const vs = vols.filter((v) => v.bbl === p.bbl).sort((a, b) => area(b.ring) - area(a.ring));
  const v = which === "inline" ? vs.find((q) => q.role === "inline") ?? vs[0] : vs[0];
  if (!v) return null;
  const [bx, by] = cen(v.ring);
  let [fx, fy] = v.front ?? cen(p.ring);
  if (!v.front) { const k = 0.5; fx = bx + (fx - bx) * k; fy = by + (fy - by) * k; }
  const yaw = deg(bx - fx, by - fy);   // from the car park toward the store
  views.push({ name: `${name}-oblique`, x: fx, y: fy, z: 300, yaw: yaw + 28, pitch: -14, dist });
  views.push({ name: `${name}-eye`, x: fx, y: fy, z: 250, yaw: yaw - 18, pitch: -4, dist: dist * 0.55 });
  views.push({ name: `${name}-aerial`, x: fx, y: fy, z: 0, yaw: yaw + 12, pitch: -52, dist: dist * 2.6 });
  return { fx, fy, yaw };
}
site(/\(neighbourhood centre\), [^,]*$/, "nbhd", 6500);
site(/\(neighbourhood centre\), [^,]*$/, "nbhd-shops", 4500, 0, "inline");
site(/\(power centre\), [^,]*$/, "power", 9000);
site(/\(community centre\), [^,]*$/, "community", 8000);
site(/\(strip centre\), [^,]*$/, "strip", 4500);
site(/\(strip centre\), [^,]*$/, "strip2", 4500, 1);
site(/centre\), fast food/, "qsr", 3200);
site(/centre\), bank/, "bank", 3200);
site(/gas and convenience/, "gas", 4000);
site(/truck stop/, "truckstop", 6000);
// the back of the neighbourhood centre's grocery (docks, trailers), from behind
{
  const p = parcels.filter((q) => /\(neighbourhood centre\), [^,]*$/.test(q.address))[0];
  const v = p && vols.filter((q) => q.bbl === p.bbl && q.role === "grocery")[0];
  if (v) {
    const [bx, by] = cen(v.ring), [fx, fy] = v.front, yaw = deg(fx - bx, fy - by);
    views.push({ name: "nbhd-back", x: bx, y: by, z: 300, yaw: yaw + 30, pitch: -20, dist: 9000 });
  }
}
// the gas station from the road, under the canopy's edge
{
  const p = parcels.find((q) => /gas and convenience/.test(q.address));
  const v = p && vols.find((q) => q.bbl === p.bbl);
  if (v?.front) {
    const [bx, by] = cen(v.ring), [fx, fy] = v.front, yaw = deg(bx - fx, by - fy);
    views.push({ name: "gas-road", x: fx, y: fy, z: 300, yaw: yaw + 20, pitch: -3, dist: 6500 });
  }
}
// the pylon signs, from the road
d.volumes.filter((v) => v.role === "pylon").slice(0, 3).forEach((v, i) => {
  const [cx, cy] = cen(v.ring), [fx, fy] = v.front;
  views.push({ name: `pylon-${i}`, x: cx, y: cy, z: 550, yaw: deg(cx - fx, cy - fy) + 35, pitch: -6, dist: 3200 });
});
// INDUSTRIAL (RetailBuilder's industrial half): the biggest warehouse, a plant, a flex building; the park from above
for (const role of ["bulk", "manufacturing", "flex"]) {
  const v = d.volumes.filter((q) => q.role === role).sort((a, b) => area(b.ring) - area(a.ring))[0];
  if (!v?.front) continue;
  const [bx, by] = cen(v.ring), [fx, fy] = v.front, yaw = deg(bx - fx, by - fy);
  const big = Math.sqrt(area(v.ring)) * 0.9;
  views.push({ name: `ind-${role}-oblique`, x: fx, y: fy, z: 400, yaw: yaw + 30, pitch: -16, dist: Math.max(4500, big) });
  views.push({ name: `ind-${role}-aerial`, x: bx, y: by, z: 0, yaw: yaw + 15, pitch: -50, dist: Math.max(9000, big * 2.4) });
}
// HOUSES (HouseBuilder): a pre-war, a post-war and a late-century street, where houses stand thickest
{
  const houses = d.volumes.filter((v) => v.deco === "house").map((v) => ({ v, c: cen(v.ring) }));
  const pick = (lo, hi) => {
    const hs = houses.filter((h) => h.v.year >= lo && h.v.year < hi);
    let best = null, bn = -1;
    for (const h of hs.filter((_, i) => i % 3 === 0)) {
      const n = hs.filter((o) => Math.hypot(o.c[0] - h.c[0], o.c[1] - h.c[1]) < 6000).length;
      if (n > bn) { bn = n; best = h; }
    }
    return best;
  };
  for (const [name, lo, hi] of [["homes-prewar", 1900, 1946], ["homes-postwar", 1946, 1975], ["homes-late", 1975, 2030]]) {
    const h = pick(lo, hi);
    if (!h) continue;
    views.push({ name: `${name}-oblique`, x: h.c[0], y: h.c[1], z: 200, yaw: 35, pitch: -16, dist: 3500 });
    views.push({ name: `${name}-aerial`, x: h.c[0], y: h.c[1], z: 0, yaw: 20, pitch: -50, dist: 11000 });
  }
}
const pp = parcels.find((q) => /\(power centre\)/.test(q.address)) ?? parcels[0];
const [ax, ay] = cen(pp.ring);
views.push({ name: "region-aerial", x: ax, y: ay, yaw: 30, pitch: -40, dist: 60000 });
writeFileSync(outFile, JSON.stringify(views, null, 1));
console.log(views.map((v) => `${v.name} ${Math.round(v.x)},${Math.round(v.y)} yaw ${Math.round(v.yaw)}`).join("\n"));
