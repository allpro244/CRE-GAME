// WHAT THE CITY IS ACTUALLY MADE OF.
//
// Every city in this game is generated from a seed, so "does this facade family
// ever get drawn" is a question about a DISTRIBUTION and not about a screenshot.
// A family gated behind a condition the generator never produces is dead code
// that compiles, renders nothing, and is invisible to every other check in the
// repo — six were found that way and only by counting.
//
// So: build N cities across the shipped towns and seeds, run the real chooser
// over every building, and report. Three things are faults, not opinions.
//
//   DEAD      a family no city ever chose. It is dead code.
//   RARE      a family under 0.1% of buildings. It exists but nobody will see it.
//   DOMINANT  a family over 12% of buildings. It is the wallpaper problem again.
//
// Run: node tools/styleaudit.mjs [seeds]
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "styleaudit-"));
const out = join(dir, "styles.mjs");
execFileSync("npx", ["esbuild", "src/map/styles.ts", "--bundle", "--format=esm", "--platform=neutral", "--outfile=" + out], { stdio: ["ignore", "ignore", "inherit"] });
const S = await import(out);
const { generateCity } = await import("../src/citygen/citygen.mjs");
const { buildCityData } = await import("../src/citygen/build.mjs");
const { CITIES } = await import("../src/citygen/cities.mjs");

const NAME = {};
for (const [k, v] of Object.entries(S)) if (/^S_[A-Z_]+$/.test(k) && typeof v === "number") NAME[v] = k.slice(2).toLowerCase();

const SEEDS = Number(process.argv[2] ?? 6);
const towns = Object.keys(CITIES);
const total = {};
const perClass = {};
let buildings = 0, cities = 0;

for (const town of towns) {
  for (let i = 0; i < SEEDS; i++) {
    const seed = (20261 + i * 7919) >>> 0;
    const city = generateCity({ ...CITIES[town], seed });
    const data = buildCityData({
      rawParcels: city.parcels, rawBuildings: city.buildings, rawStations: city.stations,
      manifest: { ...city.manifest, seed }, employment: city.employment ?? null,
    });
    const seen = new Set();
    for (const v of data.buildings3d ?? []) {
      if (v.d || v.k || !v.b || seen.has(v.b)) continue;
      seen.add(v.b);
      const st = S.styleFor(v);
      total[st] = (total[st] ?? 0) + 1;
      (perClass[v.c] ??= {})[st] = ((perClass[v.c] ??= {})[st] ?? 0) + 1;
      buildings++;
    }
    cities++;
  }
}
rmSync(dir, { recursive: true, force: true });

const ids = Object.keys(NAME).map(Number).sort((a, b) => a - b);
// The park and prop surfaces are not facades and are never chosen by styleFor.
const NOT_A_FACADE = new Set([S.S_PLAIN, S.S_CORNICE, S.S_GREEN, S.S_LOT, S.S_GABLE, S.S_LAWN, S.S_PATH, S.S_POND]);
const facades = ids.filter((i) => !NOT_A_FACADE.has(i));

const rows = facades.map((i) => ({ i, n: total[i] ?? 0, p: (100 * (total[i] ?? 0)) / buildings }))
  .sort((a, b) => b.n - a.n);

console.log(`${cities} cities (${towns.join(", ")} x ${SEEDS} seeds), ${buildings} buildings, ${facades.length} facade families\n`);
console.log("family                 count    share");
for (const r of rows) {
  const flag = r.n === 0 ? "  DEAD" : r.p < 0.1 ? "  rare" : r.p > 12 ? "  DOMINANT" : "";
  console.log(NAME[r.i].padEnd(22), String(r.n).padStart(6), (r.p.toFixed(2) + "%").padStart(8), flag);
}
// IS IT DEAD, OR DOES THIS TOWN SIMPLY NOT HAVE THAT KIND OF BUILDING?
//
// Those are completely different faults and the count above cannot tell them
// apart. A supertall skin drawing zero times in a harbour town whose tallest
// building is fourteen floors is CORRECT — the town has no towers, the player
// builds them, and a later scenario will start with them. A family that no
// combination of year, class and height can ever select is dead code.
//
// So sweep the chooser over the whole input space it will ever see and ask
// which families are on the menu at all. Anything reachable but absent gets
// reported as untenanted rather than dead, with the shape of building that
// would select it, so the next city knows what to build.
const CLASSES = ["office", "mixed", "multifamily", "retail", "industrial"];
const reachable = new Map();
for (const c of CLASSES) {
  for (let y = 1820; y <= 2035; y += 5) {
    for (let f = 1; f <= 60; f++) {
      for (const st of S.stylePool({ b: "1", c, y, f, t: 0, z0: 0, z1: f * 3.6, d: 0, r: [] })) {
        if (!reachable.has(st)) reachable.set(st, { y, f, c });
      }
    }
  }
}
const dead = rows.filter((r) => r.n === 0 && !reachable.has(r.i)).map((r) => NAME[r.i]);
const untenanted = rows.filter((r) => r.n === 0 && reachable.has(r.i));
const rare = rows.filter((r) => r.n > 0 && r.p < 0.1).map((r) => NAME[r.i]);
const dom = rows.filter((r) => r.p > 12).map((r) => NAME[r.i]);
console.log("\n--- verdict ---");
console.log("DEAD (unreachable by any input):", dead.length ? dead.join(", ") : "none");
console.log("untenanted (reachable, absent from these towns):",
  untenanted.length
    ? untenanted.map((r) => { const g = reachable.get(r.i); return `${NAME[r.i]} (needs ${g.c} ${g.f}fl ${g.y})`; }).join(", ")
    : "none");
console.log("rare     :", rare.length ? rare.join(", ") : "none");
console.log("DOMINANT :", dom.length ? dom.join(", ") : "none");
// Evenness: how much of the city the top five families carry.
const top5 = rows.slice(0, 5).reduce((s, r) => s + r.p, 0);
console.log(`top-5 share: ${top5.toFixed(1)}%  (the two-family era was 71%)`);
console.log("\n--- by asset class ---");
for (const [cls, h] of Object.entries(perClass)) {
  const t = Object.values(h).reduce((a, b) => a + b, 0);
  const top = Object.entries(h).sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([k, n]) => `${NAME[k]} ${((100 * n) / t).toFixed(0)}%`).join(", ");
  console.log(`${cls.padEnd(12)} ${String(t).padStart(5)} across ${String(Object.keys(h).length).padStart(2)} families   top: ${top}`);
}
process.exit(dead.length ? 1 : 0);
