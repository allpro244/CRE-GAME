// Audit the street fabric of an exported city (bw-city/1): how much of the
// asphalt is a street (within its centre line's half-width of one) and how much
// is unclaimed slab — the "weird road" the eye reads as a car park nobody drew.
//
//   node unreal/tools/audit-streets.mjs [city.json] [--map out.ppm]
//
// Ground is classified by its top layer, as the renderer stacks it: water, then
// lawn (park/median), footway (sidewalk/block), else asphalt (pavement, apron,
// base paving). A footway or lot is not asphalt. Sampled on a 2 m grid.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const file = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : join(HERE, "..", "BroadwayWall", "Data", "city-1-metro.json");
const d = JSON.parse(readFileSync(file, "utf8"));

// polygons with bboxes, for point-in-polygon
const poly = (r) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); y0 = Math.min(y0, r[i + 1]); y1 = Math.max(y1, r[i + 1]); } return { r, x0, y0, x1, y1 }; };
const inside = (p, x, y) => {
  if (x < p.x0 || x > p.x1 || y < p.y0 || y > p.y1) return false;
  const r = p.r; let c = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const G = (k) => (d.ground[k] ?? []).map(poly);
const land = G("land"), paveland = G("paveland"), carriage = [...G("pavement"), ...G("apron")], water = [...G("pond"), ...G("stream")], lawn = [...G("park"), ...G("median")], foot = [...G("sidewalk"), ...G("block")];
const lots = d.parcels.filter((p) => p.ring.length >= 6).map((p) => poly(p.ring));

// centre lines as segments with half-widths, bucketed on a 50 m grid
const B = 5000, buckets = new Map();
const key = (x, y) => `${Math.floor(x / B)},${Math.floor(y / B)}`;
for (const c of d.markings.centerlines) {
  const L = c.line, hw = c.w / 2;
  for (let i = 0; i + 3 < L.length; i += 2) {
    const s = { ax: L[i], ay: L[i + 1], bx: L[i + 2], by: L[i + 3], hw };
    const x0 = Math.min(s.ax, s.bx) - hw, x1 = Math.max(s.ax, s.bx) + hw, y0 = Math.min(s.ay, s.by) - hw, y1 = Math.max(s.ay, s.by) + hw;
    for (let gx = Math.floor(x0 / B); gx <= Math.floor(x1 / B); gx++)
      for (let gy = Math.floor(y0 / B); gy <= Math.floor(y1 / B); gy++) {
        const k = `${gx},${gy}`; if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(s);
      }
  }
}
const claimed = (x, y) => {
  for (const s of buckets.get(key(x, y)) ?? []) {
    const dx = s.bx - s.ax, dy = s.by - s.ay, L2 = dx * dx + dy * dy;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / L2)) : 0;
    const ex = s.ax + dx * t - x, ey = s.ay + dy * t - y;
    // a junction's corners: 3 m of grace past the half-width
    if (ex * ex + ey * ey <= (s.hw + 300) ** 2) return true;
  }
  return false;
};

const step = 200, { minX, maxX, minY, maxY } = d.bounds;
const W = Math.ceil((maxY - minY) / step), H = Math.ceil((maxX - minX) / step);
const img = new Uint8Array(W * H * 3);
const n = { asphalt: 0, dead: 0, plaza: 0, foot: 0, lawn: 0, water: 0, lot: 0 };
for (let row = 0; row < H; row++) for (let col = 0; col < W; col++) {
  const x = maxX - row * step, y = minY + col * step;                 // north up, east right
  if (!land.some((p) => inside(p, x, y))) continue;
  let k;
  if (water.some((p) => inside(p, x, y))) k = "water";
  else if (lawn.some((p) => inside(p, x, y))) k = "lawn";
  else if (foot.some((p) => inside(p, x, y))) k = "foot";
  else if (lots.some((p) => inside(p, x, y))) k = "lot";
  // outside the base paving is the shore band: the waterfront promenade, paved for walking
  else if (!paveland.some((p) => inside(p, x, y))) k = "foot";
  // the base paving where no carriageway is drawn: paved open ground (the web map draws it light), not road
  else if (!carriage.some((p) => inside(p, x, y))) k = "plaza";
  else k = claimed(x, y) ? "asphalt" : "dead";
  n[k]++;
  const col3 = { asphalt: [70, 70, 75], dead: [230, 40, 40], foot: [200, 195, 185], plaza: [235, 225, 160], lawn: [90, 140, 60], water: [60, 110, 160], lot: [150, 140, 120] }[k];
  img.set(col3, (row * W + col) * 3);
}
const road = n.asphalt + n.dead, m2 = (c) => Math.round((c * step * step) / 1e4);
console.log(`asphalt ${m2(road)} m2, of which unclaimed by any street ${m2(n.dead)} m2 (${((100 * n.dead) / Math.max(1, road)).toFixed(1)}%)`);
console.log(`open paved ground ${m2(n.plaza)} m2 · footway ${m2(n.foot)} m2 · lawn ${m2(n.lawn)} m2 · lots ${m2(n.lot)} m2 · water ${m2(n.water)} m2`);
const out = arg("--map");
if (out) { writeFileSync(out, Buffer.concat([Buffer.from(`P6 ${W} ${H} 255\n`), Buffer.from(img)])); console.log(`map -> ${out} (red = unclaimed asphalt)`); }
