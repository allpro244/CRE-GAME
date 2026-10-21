// THE REFEREE FOR PERFORMANCE WORK.
//
// A speed-up is only a speed-up if it computes the same game. This runs the
// engine N months from fixed seeds on the reference test city and hashes the
// WHOLE state (and the parcel table, which the engine also writes) after every
// month, with a serializer that tells -0 from 0 and NaN from null, so a single
// changed bit anywhere moves the hash. It also times each month.
//
//   pnpm engine && pnpm -s exec node tools/perf-identical.mjs            compare against the saved baseline
//   pnpm engine && pnpm -s exec node tools/perf-identical.mjs --save     write the baseline (only from code you trust)
//   MONTHS=36 SEEDS=550991,12007 ...                                     the defaults
//
// The baseline lives in tools/perf-identical.baseline.json. If a hash moves, a
// number changed: the optimisation is wrong, whatever the timing says.
import { assertFreshBundle } from "../test/fresh.mjs";
assertFreshBundle();
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, "..", "test", ".engine.mjs"));
const { loadCity } = await import(join(HERE, "..", "test", "city.mjs"));

const MONTHS = Number(process.env.MONTHS ?? 36);
const SEEDS = (process.env.SEEDS ?? "550991,12007").split(",").map(Number);
const SAVE = process.argv.includes("--save");
const BASE = join(HERE, "perf-identical.baseline.json");

// Exact, order-preserving serialisation. Insertion order is part of the state
// (it decides iteration order downstream), so keys are NOT sorted.
function feed(h, v, seen) {
  if (v === null) return h.update("n");
  switch (typeof v) {
    case "number":
      return h.update(Object.is(v, -0) ? "d-0;" : `d${v};`);
    case "string": return h.update(`s${v.length}:${v}`);
    case "boolean": return h.update(v ? "T" : "F");
    case "undefined": return h.update("u");
    case "bigint": return h.update(`b${v};`);
    case "function": return h.update("f");
    case "object": break;
    default: return h.update("?");
  }
  if (seen.has(v)) { h.update("@"); }
  seen.add(v);
  if (Array.isArray(v)) {
    h.update(`[${v.length}`);
    for (let i = 0; i < v.length; i++) feed(h, v[i], seen);
    h.update("]");
  } else if (v instanceof Map) {
    h.update(`M${v.size}`);
    for (const [k, x] of v) { feed(h, k, seen); feed(h, x, seen); }
  } else if (v instanceof Set) {
    h.update(`S${v.size}`);
    for (const x of v) feed(h, x, seen);
  } else if (ArrayBuffer.isView(v)) {
    h.update(`A${v.constructor.name}${v.length}`);
    for (let i = 0; i < v.length; i++) feed(h, v[i], seen);
  } else {
    const ks = Object.keys(v);
    h.update(`{${ks.length}`);
    for (const k of ks) { h.update(`k${k.length}:${k}`); feed(h, v[k], seen); }
    h.update("}");
  }
  seen.delete(v);
}
const hashOf = (...vs) => {
  const h = createHash("sha256");
  for (const v of vs) feed(h, v, new Set());
  return h.digest("hex").slice(0, 16);
};

const { parcels: P0, adjacency, bbls } = loadCity(0, E.normalizeParcels);
const out = {};
const times = [];
for (const seed of SEEDS) {
  const parcels = JSON.parse(JSON.stringify(P0));
  let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  const hs = [hashOf(g, parcels)];
  for (let m = 0; m < MONTHS; m++) {
    const t0 = performance.now();
    g = E.advanceMonth(g, parcels, bbls, adjacency);
    times.push(performance.now() - t0);
    hs.push(hashOf(g, parcels));
  }
  out[seed] = hs;
}

const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const steady = times.filter((_, i) => i % MONTHS !== 0);
console.log(`${Object.keys(P0).length ?? "?"} parcels, ${SEEDS.length} seeds x ${MONTHS} months`);
console.log(`ms/month  median ${q(steady, 0.5).toFixed(1)}  p90 ${q(steady, 0.9).toFixed(1)}  mean ${(steady.reduce((a, b) => a + b, 0) / steady.length).toFixed(1)}  total ${(times.reduce((a, b) => a + b, 0) / 1000).toFixed(2)}s`);

const key = `${MONTHS}:${SEEDS.join(",")}`;
if (SAVE) {
  const all = existsSync(BASE) ? JSON.parse(readFileSync(BASE, "utf8")) : {};
  all[key] = out;
  writeFileSync(BASE, JSON.stringify(all, null, 1));
  console.log(`baseline saved for ${key}`);
} else {
  const all = existsSync(BASE) ? JSON.parse(readFileSync(BASE, "utf8")) : {};
  const want = all[key];
  if (!want) { console.log(`no baseline for ${key}; run with --save on trusted code`); process.exit(2); }
  let bad = 0;
  for (const seed of SEEDS) {
    const i = out[seed].findIndex((h, j) => h !== want[seed]?.[j]);
    if (i >= 0) { bad++; console.log(`FAIL  seed ${seed}: state differs from month ${i - 1 < 0 ? "start" : i}`); }
    else console.log(`PASS  seed ${seed}: ${out[seed].length} states identical`);
  }
  process.exit(bad ? 1 : 0);
}
