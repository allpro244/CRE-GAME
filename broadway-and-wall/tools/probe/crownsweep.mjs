// WHICH CROWNS THE CITY CAN ACTUALLY REACH.
//
// A crown is geometry with no label on it. `pnpm styles` counts facades because
// every wall vertex carries `aStyle`; nothing in the repo could count CROWNS,
// so "is this crown reachable" was a question no harness could ask — and
// BUILDINGS.md §4 is explicit about what that costs: a gate on a condition the
// generator never produces renders nothing, compiles cleanly, and is invisible
// to every other check here. Four families died that way before anybody counted.
//
// The deco kit made that urgent. Sixteen new crown kinds went in behind gates
// on height, on plan area, on `o.roof` and on one style id each, and every one
// of those is a chance to write `f >= 20` in a town whose tallest building is
// fourteen floors. So `crownTop` now reports the kind it built, and this sweeps
// the REAL function over the REAL stock — the same twelve generated islands the
// style audit uses, through the same `styleFor` — and counts.
//
//   node tools/probe/crownsweep.mjs [seeds]
//
// DEAD is a fault and exits non-zero. A crown reachable but absent from these
// islands is reported as untenanted with the shape of building that would
// select it, exactly as the style audit does: a mooring mast drawing zero in a
// harbour town whose tallest building is 50 m is correct, and the player path
// below is where it is actually reached.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "crownsweep-"));
// maplibre-gl touches `window` at import; the renderer's module scope only
// needs the binding to exist, and nothing this probe calls goes near it.
writeFileSync(join(dir, "mlstub.js"), "export default {};\n");
const out = join(dir, "tb.mjs");
execFileSync("npx", ["esbuild", "src/map/ThreeBuildings.ts", "--bundle", "--format=esm",
  "--platform=node", "--outfile=" + out, "--alias:maplibre-gl=" + join(dir, "mlstub.js"),
  "--alias:@=./src", "--log-level=error"], { stdio: ["ignore", "ignore", "inherit"] });
const TB = await import(out);
const S = await import(out.replace("tb.mjs", "st.mjs")).catch(() => null);
const St = S ?? await (async () => {
  const o2 = join(dir, "st.mjs");
  execFileSync("npx", ["esbuild", "src/map/styles.ts", "--bundle", "--format=esm",
    "--platform=neutral", "--outfile=" + o2], { stdio: ["ignore", "ignore", "inherit"] });
  return import(o2);
})();
const { generateCity } = await import("../../src/citygen/citygen.mjs");
const { buildCityData } = await import("../../src/citygen/build.mjs");
const { islandConfig } = await import("../../src/citygen/island.mjs");

const NAME = {};
for (const [k, v] of Object.entries(St)) if (/^S_[A-Z_]+$/.test(k) && typeof v === "number") NAME[v] = k.slice(2).toLowerCase();

// Every crown kind the ladder can name. Read off the source rather than typed
// out here, so a kind added without a pool entry shows up as DEAD instead of
// being quietly left out of the census.
const src = (await import("node:fs")).default.readFileSync("src/map/ThreeBuildings.ts", "utf8");
const KINDS = new Set();
for (const m of src.matchAll(/crown === "([a-z]+)"/g)) KINDS.add(m[1]);
for (const m of src.matchAll(/crowns\.push\(([^)]*)\)/g)) for (const q of m[1].matchAll(/"([a-z]+)"/g)) KINDS.add(q[1]);
KINDS.add("finial");   // composition-only: never the primary crown, so it has no `crown ===` test

/** One volume through the real crown ladder. Returns { crown, extra }. */
function crownOf(v, style, seed) {
  const W = TB.geomBuf(), R = TB.geomBuf();
  const mason = TB.makeMason({ era: 0.4, deck: 0, wear: 0.5, bearX: 1, bearY: 0 });
  // A plate of the right SIZE and the right SHAPE, since six of the deco crowns
  // are placed off the longest edge and three are sized off the plan area.
  const w = Math.sqrt(Math.max(40, v.plate)) * 1.35, d = Math.max(40, v.plate) / w;
  const ring = [[0, 0], [w, 0], [w, d], [0, d]];
  let area = 0;
  for (let i = 0; i < 4; i++) { const a = ring[i], b = ring[(i + 1) % 4]; area += a[0] * b[1] - b[0] * a[1]; }
  const key = (seed ^ Math.imul(v.i + 1, 2246822519)) >>> 0;
  return TB.crownTop(mason, W, R, {
    ring, z1: v.z1, roof: true, deco: false, bbl: String(1000 + v.i),
    style, rnd: 0.4, varr: 0.55, fh: v.fh, industrial: v.cls === "industrial", area,
    cs: (n) => St.hash01(key ^ Math.imul(n + 1, 0x9e3779b1), 0x00c0ffee),
    pier: (n) => St.hash01(key ^ Math.imul(n, 2654435761), seed),
    props: [],
  });
}

const SEEDS = Number(process.argv[2] ?? 12);
const gen = new Map(), genByStyle = new Map();
let nBld = 0;
for (let i = 0; i < SEEDS; i++) {
  const seed = (20261 + i * 7919) >>> 0;
  const city = generateCity({ ...islandConfig(seed), seed });
  const data = buildCityData({
    rawParcels: city.parcels, rawBuildings: city.buildings, rawStations: city.stations,
    manifest: { ...city.manifest, seed }, employment: city.employment ?? null,
  });
  const seen = new Set();
  let j = 0;
  for (const v of data.buildings3d ?? []) {
    if (v.d || v.k || !v.b) continue;
    if (!v.x) continue;                                   // only the roof volume gets a crown
    if (seen.has(v.b)) continue;
    seen.add(v.b);
    const style = St.styleFor(v);
    let plate = 0;
    // The ring is in lon/lat here; the volume's own floors and height are what
    // the crown gates read, and the plate only needs to be plausible for its
    // class — a shed is wide, a tower is not.
    plate = v.c === "industrial" ? 1800 : v.f >= 8 ? 700 : 320;
    const r = crownOf({ i: j++, z1: v.z1, fh: Math.max(2.6, v.z1 / Math.max(1, v.f)), cls: v.c, plate }, style, seed);
    gen.set(r.crown, (gen.get(r.crown) || 0) + 1);
    for (const e of r.extra) gen.set("+" + e, (gen.get("+" + e) || 0) + 1);
    if (St.isDeco(style)) {
      const k2 = NAME[style] + " -> " + r.crown + (r.extra.length ? " +" + r.extra.join("+") : "");
      genByStyle.set(k2, (genByStyle.get(k2) || 0) + 1);
    }
    nBld++;
  }
}

// THE OTHER PATH. `setPlayerBuildings` is where a tower family actually lives —
// a generated town has seven buildings over 34 m — so the sweep that matters
// for the deco kit is over what a player can build, not over what the town
// starts with. Same chooser (`styleForBuilt`), same crown ladder.
const ply = new Map(), plyDeco = new Map();
let nPly = 0;
for (const cls of ["office", "multifamily", "retail", "industrial", "mixed"]) {
  for (let year = 1925; year <= 2035; year += 1) {
    for (let fl = 1; fl <= 40; fl++) {
      for (let deed = 0; deed < 6; deed++) {
        // `styleForBuilt` takes a BuildingVolume, so it gets one: the deed
        // string is what its own hash stream keys off, which is how a player
        // gets a different facade on the lot next door.
        const style = St.styleForBuilt({
          b: String(4000000 + deed * 7919 + fl * 31), c: cls, y: year, t: deed % 5,
          f: fl, z0: 0, z1: fl * 3.55, d: 0, x: 1, r: [[0, 0], [1, 0], [1, 1], [0, 1]],
        });
        if (style == null || style < 0) continue;
        const fh = 3.55, z1 = fl * fh;
        const r = crownOf({ i: deed * 977 + fl, z1, fh, cls, plate: cls === "industrial" ? 1800 : fl >= 8 ? 700 : 320 }, style, 0xbeef);
        ply.set(r.crown, (ply.get(r.crown) || 0) + 1);
        for (const e of r.extra) ply.set("+" + e, (ply.get("+" + e) || 0) + 1);
        if (St.isDeco(style)) plyDeco.set(NAME[style] + " -> " + r.crown, (plyDeco.get(NAME[style] + " -> " + r.crown) || 0) + 1);
        nPly++;
      }
    }
  }
}

const show = (t, n) => [...t.entries()].sort((a, b) => b[1] - a[1])
  .map(([k, c]) => `${k} ${(100 * c / n).toFixed(2)}%`).join(" · ");
console.log(`GENERATED STOCK  ${nBld} roof volumes, ${SEEDS} islands`);
console.log("  " + show(gen, nBld));
console.log(`PLAYER PATH      ${nPly} (class, year, floors, deed) combinations`);
console.log("  " + show(ply, nPly));
console.log("\nDECO FAMILIES, GENERATED  (family -> crown)");
for (const [k, c] of [...genByStyle.entries()].sort()) console.log(`  ${k}  ${c}`);
console.log("\nDECO FAMILIES, PLAYER-BUILT");
for (const [k, c] of [...plyDeco.entries()].sort()) console.log(`  ${k}  ${c}`);
const reached = new Set([...gen.keys(), ...ply.keys()].map((k) => k.replace(/^\+/, "")));
const dead = [...KINDS].filter((k) => !reached.has(k)).sort();
console.log("\n--- verdict ---");
console.log("crown kinds in the ladder: " + KINDS.size);
console.log("reached by one path or the other: " + reached.size);
console.log("DEAD: " + (dead.length ? dead.join(", ") : "none"));
rmSync(dir, { recursive: true, force: true });
if (dead.length) process.exit(1);
