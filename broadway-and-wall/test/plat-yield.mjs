// HOW MUCH OF A FARM THE LAND DEVELOPER'S PLAT TURNS INTO LOTS.
//
//   node test/plat-yield.mjs [seed] [lotSf]
//
// For every plattable farm tract: the grid plat at the lot size (citygen
// region platTractLots), its lots' area as a share of the tract's BUILDABLE
// ground (dry, off the floodplain and the freeway, nothing standing on it) and
// of the parcel. A real suburban subdivision nets about 65-75% of gross in
// lots; streets take 20-25%. Fails if the clean tracts' median is under 60%.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const { makeCity, REGION, platTractLots } = await import(join(HERE, "..", "src", "citygen", "index.mjs"));

const seed = Number(process.argv[2] ?? 1), lotSf = Number(process.argv[3] ?? 7500);
const c = makeCity(REGION, seed);
const rows = [];
for (const p of Object.values(c.parcels)) {
  if (!p.ag || !p.tract) continue;
  const g = platTractLots(p.tract, lotSf);
  const lotSfSum = g.lots.reduce((a, l) => a + l.a, 0);
  rows.push({ addr: p.address, acres: p.lotArea / 43560, build: g.buildableSf / 43560, lots: g.lots.length, yb: lotSfSum / Math.max(1, g.buildableSf), yp: lotSfSum / p.lotArea, clean: g.buildableSf / p.lotArea });
}
rows.sort((a, b) => b.build - a.build);
console.log(`seed ${seed}, ${lotSf.toLocaleString()} sf lots: ${rows.length} plattable tracts`);
const pick = (process.env.TRACTS ?? "").split(",").filter(Boolean).map((t) => `tract ${t} (`);
for (const r of pick.length ? rows.filter((x) => pick.some((t) => x.addr.includes(t))) : rows.slice(0, 16)) console.log(`  ${r.addr.padEnd(28)} ${r.acres.toFixed(0).padStart(4)} ac, ${r.build.toFixed(0).padStart(4)} buildable: ${String(r.lots).padStart(4)} lots = ${(r.yb * 100).toFixed(0).padStart(3)}% of buildable, ${(r.yp * 100).toFixed(0).padStart(3)}% of the parcel`);
const clean = rows.filter((r) => r.clean > 0.9 && r.build > 8).map((r) => r.yb).sort((a, b) => a - b);
const all = rows.filter((r) => r.build > 4).map((r) => r.yb).sort((a, b) => a - b);
const med = (x) => x[x.length >> 1] ?? 0;
console.log(`  median yield of buildable: clean tracts ${(med(clean) * 100).toFixed(0)}% (n=${clean.length}), all ${(med(all) * 100).toFixed(0)}% (n=${all.length})`);
if (med(clean) < 0.6) { console.log("FAIL: clean tracts net under 60% in lots"); process.exit(1); }
