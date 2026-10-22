// A REGION SAVE IS THE GAME — the short form of region-longrun's reload check.
//
//   SEED=1 Y=8 K=12 pnpm -s exec node test/region-reload.mjs
//
// Plays the region Y years with no player, saves the state the way IndexedDB
// does (v8 structured clone), and Continues it in a fresh process: the town
// rebuilt from the seed, the cut lots put back from the state (sim.ts
// restoreCuts, which store.ts Continue runs before its fits gate). Then both
// play K more months and every month's state is compared key by key, so a
// divergence names the first month and the parts of the state it is in. A
// module-level cache that depends on history — not on the state — shows up here
// and nowhere else.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import v8 from "node:v8";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(pathToFileURL(join(HERE, ".engine.mjs")).href);
const { makeCity, REGION } = await import(pathToFileURL(join(HERE, "..", "src", "citygen", "index.mjs")).href);
const sha = (x) => createHash("sha256").update(x).digest("hex").slice(0, 12);
const keyHashes = (g) => {
  const m = E.migrateSaveState(structuredClone(g));
  const out = {};
  for (const k of Object.keys(m).sort()) out[k] = sha(JSON.stringify(m[k]) ?? "u");
  for (const k of Object.keys(m.econ ?? {}).sort()) out["econ." + k] = sha(JSON.stringify(m.econ[k]) ?? "u");
  return out;
};
function build(seed) {
  const city = makeCity(REGION, seed);
  E.normalizeParcels(city.parcels);
  return { parcels: city.parcels, bbls: Object.keys(city.parcels), adjacency: city.adjacency };
}
const tick = (g, t) => {
  g = E.advanceQuarter(g, t.parcels, t.bbls, t.adjacency);
  if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
  return g;
};

if (process.argv[2] === "--child") {
  const [, , , file, seedS, kS] = process.argv;
  const t = build(Number(seedS));
  const prep = E.prepareSaveForResume(v8.deserialize(readFileSync(file)));
  if (!prep.ok) { console.log(JSON.stringify({ err: prep.reason })); process.exit(0); }
  let g = prep.state;
  const fitsBefore = Object.keys(g.holdings).every((b) => t.parcels[b]) && g.listings.every((l) => t.parcels[l.bbl]);
  E.restoreCuts(g, t.parcels, t.bbls);
  const fitsAfter = Object.keys(g.holdings).every((b) => t.parcels[b]) && g.listings.every((l) => t.parcels[l.bbl]);
  const months = [{ order: sha(t.bbls.join(",")), table: sha(JSON.stringify([...t.bbls].sort().map((b) => t.parcels[b]))) }];
  for (let k = 0; k < Number(kS); k++) { g = tick(g, t); months.push(keyHashes(g)); if (k === 0) writeFileSync(file + ".m1.json", JSON.stringify(E.migrateSaveState(structuredClone(g)))); }
  console.log(JSON.stringify({ fitsBefore, fitsAfter, months }));
  process.exit(0);
}

const SEED = Number(process.env.SEED ?? 1), Y = Number(process.env.Y ?? 8), K = Number(process.env.K ?? 12);
const t = build(SEED);
let g = E.firstListings(E.newGame(SEED, t.parcels, undefined, undefined, { citySize: "region", cityLots: t.bbls.length }), t.parcels, t.bbls);
g = { ...g, cityIsland: REGION, citySeed: SEED, citySize: "region" };
for (let m = 0; m < Y * 12; m++) g = tick(g, t);
const dir = join(tmpdir(), `bw-reload-${process.pid}`);
mkdirSync(dir, { recursive: true });
const file = join(dir, "save.bin");
writeFileSync(file, v8.serialize(g));
const c = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--child", file, String(SEED), String(K)], { encoding: "utf8", timeout: 1_200_000, maxBuffer: 1 << 26 });
let child;
try { child = JSON.parse(c.stdout.trim().split("\n").at(-1)); } catch { console.log(`child failed ${c.status}: ${c.stderr?.slice(-600)}`); process.exit(1); }
if (child.err) { console.log(`FAIL the save would not open: ${child.err}`); process.exit(1); }
let fails = 0;
const fail = (m) => { fails++; console.log("  FAIL " + m); };
const live0 = { order: sha(t.bbls.join(",")), table: sha(JSON.stringify([...t.bbls].sort().map((b) => t.parcels[b]))) };
console.log(`seed ${SEED}: saved at year ${Y} with ${t.bbls.length} parcels, ${Object.keys(g.plats ?? {}).length} plats, ${(g.splits ?? []).length} splits`);
// store.ts Continue restores the cuts and then asks whether every deed and listing is on the table
if (!child.fitsBefore) console.log("  (the save names deeds the generator does not cut — plat or split lots — so the cuts must go back before the fits gate; they do)");
if (!child.fitsAfter) fail("Continue's fits gate would refuse it: a deed or listing is missing even with the cuts restored");
if (child.months[0].table !== live0.table) fail("the rebuilt parcel table differs from the live one");
if (child.months[0].order !== live0.order) fail("the rebuilt parcel table is in a different order (iteration order is the game)");
let first = null;
for (let k = 1; k <= K; k++) {
  g = tick(g, t);
  const live = keyHashes(g), re = child.months[k];
  const diff = Object.keys({ ...live, ...re }).filter((x) => live[x] !== re[x]);
  if (diff.length && !first && k === 1) {
    // the paths that differ, for the first month only (the child wrote its month-one state)
    const re1 = JSON.parse(readFileSync(file + ".m1.json", "utf8")), li1 = JSON.parse(JSON.stringify(E.migrateSaveState(structuredClone(g))));
    const out = [];
    const walk = (a, b, p) => { if (out.length >= 25) return; if (JSON.stringify(a) === JSON.stringify(b)) return; if (a && b && typeof a === "object" && typeof b === "object") { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], p + "." + k); } else out.push(`${p}: live ${JSON.stringify(a)?.slice(0, 80)} / reloaded ${JSON.stringify(b)?.slice(0, 80)}`); };
    walk(li1, re1, "s");
    for (const o of out) console.log("    " + o);
  }
  if (diff.length && !first) { first = k; fail(`month +${k}: the reloaded game diverged in ${diff.slice(0, 20).join(", ")}${diff.length > 20 ? ` (+${diff.length - 20})` : ""}`); }
}
rmSync(dir, { recursive: true, force: true });
if (!first) console.log(`  ${K} months on: identical, key by key`);
if (fails) { console.log(`${fails} failure(s)`); process.exit(1); }
console.log("region-reload pass");
