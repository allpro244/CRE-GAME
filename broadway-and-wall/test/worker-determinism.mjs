// THE MONTH IN THE SIM WORKER IS THE MONTH ON THE PAGE.
//
//   node test/worker-determinism.mjs          (MONTHS=24 SEED=550991 by default)
//
// The browser closes each month in a Web Worker (src/state/simWorker.ts): the
// town goes over once, then each month the page posts the state it holds and
// takes back the state the worker returns, with the register buffers
// transferred rather than copied. That is only allowed if it changes nothing,
// so this runs the REAL worker module under Node's worker_threads, the same
// way, and checks every month against the same months closed on one thread:
// the JSON of the state, hashed, byte for byte. Then a Year span (cap 12) the
// same way, which is what the 1 yr button sends.
//
// One bundle serves both sides, built here from src/ (not test/.engine.mjs),
// so the two runs are the same engine code by construction.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { build } from "esbuild";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, ".entry-simworker.ts");
const OUT = join(HERE, ".engine-simworker.mjs");
const MONTHS = Number(process.env.MONTHS ?? 24);
const SEED = Number(process.env.SEED ?? 550991);

writeFileSync(ENTRY, [
  `export * from "../src/state/simWorker";`,
  `export { advanceMonth, advanceUntilAttention, newGame, firstListings } from "../src/engine/sim";`,
  `export { normalizeParcels } from "../src/engine/mix";`,
].join("\n"));
// simWorker.ts talks to `self`, as a browser worker does. Under worker_threads
// `self` is the parent port; on the main thread it is a stub nobody calls.
const banner = `import { parentPort as __pp, isMainThread as __main } from "node:worker_threads";
globalThis.self = __main ? {} : { postMessage: (m, t) => __pp.postMessage(m, t), set onmessage(f) { __pp.on("message", (data) => f({ data })); } };`;
await build({
  entryPoints: [ENTRY], bundle: true, format: "esm", platform: "node", outfile: OUT,
  tsconfig: join(HERE, "..", "tsconfig.json"), banner: { js: banner }, logLevel: "warning",
});

const E = await import(OUT);
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels, bbls, adjacency } = loadCity(0, E.normalizeParcels);

/** The state as JSON, typed-array columns as their exact bytes, hashed. */
const hash = (s) => createHash("sha256").update(JSON.stringify(s, (_k, v) =>
  ArrayBuffer.isView(v) ? { [v.constructor.name]: Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("base64") } : v,
)).digest("hex");

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) fails++; };

const g0 = E.firstListings(E.newGame(SEED, parcels), parcels, bbls);
const g0Hash = hash(g0);
// --- the worker, driven the way state/simClient.ts drives it -----------------
const w = new Worker(OUT);
const waiting = new Map();
w.on("message", (r) => { const p = waiting.get(r.id); waiting.delete(r.id); p(r); });
w.on("error", (e) => { console.error("worker error:", e); process.exit(1); });
let seq = 0;
const ask = (msg) => new Promise((res) => { const id = ++seq; waiting.set(id, res); w.postMessage({ ...msg, id }); });
w.postMessage({ type: "town", town: { id: 1, parcels, bbls, adjacency } });

const viaWorker = [];
let tWorker = 0;
{
  let s = g0;
  for (let m = 0; m < MONTHS; m++) {
    const t = performance.now();
    const r = await ask({ type: "month", town: 1, s });
    tWorker += performance.now() - t;
    if (r.err) { console.error(r.err); process.exit(1); }
    s = r.s;
    viaWorker.push(hash(s));
  }
}
const spanW = await ask({ type: "span", town: 1, s: g0, cap: 12, seen: [] });
await w.terminate();
ok(hash(g0) === g0Hash, "posting the state to the worker leaves the page's copy untouched");

// --- the same months on one thread -------------------------------------------
const onPage = [];
let tPage = 0;
{
  let s = structuredClone(g0);
  for (let m = 0; m < MONTHS; m++) {
    const t = performance.now();
    s = E.advanceMonth(s, parcels, bbls, adjacency);
    tPage += performance.now() - t;
    onPage.push(hash(s));
  }
  // the check can fail: one household's weight moved is a different hash
  const probe = structuredClone(s);
  probe.households.a.wt[0] += 1;
  ok(hash(probe) !== onPage.at(-1), "the hash sees one register value move (the check can fail)");
}
const spanP = E.advanceUntilAttention(structuredClone(g0), parcels, bbls, adjacency, 12, []);

const firstOff = onPage.findIndex((h, i) => h !== viaWorker[i]);
ok(firstOff < 0, firstOff < 0
  ? `${MONTHS} months, worker vs one thread: every month byte-identical (final ${onPage.at(-1).slice(0, 16)})`
  : `${MONTHS} months, worker vs one thread: first differs at month ${firstOff + 1}`);
ok(spanW.span && hash(spanW.span.s) === hash(spanP.s) && spanW.span.months === spanP.months && spanW.span.reason === spanP.reason,
  `a Year span (cap 12), worker vs one thread: same state, ${spanP.months} months, stop "${spanP.reason ?? "none"}"`);
console.log(`      seed ${SEED}, ${bbls.length} lots · ${(tPage / MONTHS).toFixed(0)} ms/month on one thread, ${(tWorker / MONTHS).toFixed(0)} ms/month round trip through the worker`);
process.exit(fails ? 1 : 0);
