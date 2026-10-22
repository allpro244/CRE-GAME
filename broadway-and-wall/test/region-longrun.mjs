// THE REGION OVER A CENTURY — does a long campaign hold up?
//
//   SEED=1 Y=100 BOT=1 pnpm -s exec node --expose-gc test/region-longrun.mjs
//   SEED=2 Y=100 BOT=0 ...                         no player: the world alone
//   SAVES=25,50,100 CHECK_M=12                     save/reload points (years)
//
// One seed per process (run seeds side by side, at most three). Every decade it
// prints the month's cost (the engine's tick, and the bot's on top), the parcel
// table, the save's size (structured clone, which is what IndexedDB writes, and
// JSON), the heap, and the five largest pieces of state, so a log that grows
// without bound shows itself. It asserts:
//   - no non-finite number anywhere in the state or the parcel table (every 5 y);
//   - the conservation identity at $0 every month (conserve.mjs's, with the
//     same bot — test/conserve-bot.mjs) while the bot plays;
//   - the world never freezes: gameOver is resurrected (HANDOFF §4 "the frozen
//     world") and counted, and the month must advance every tick;
//   - A SAVE IS THE GAME: at each SAVES year the state is written the way the
//     store writes it (v8 structured clone), a child process rebuilds the town
//     from the seed alone the way Continue does, puts the plats, splits and
//     unpacked neighbourhoods back from the state, and the parcel table it gets
//     must equal the live one — contents AND order, since order is iteration
//     order — and CHECK_M months on from both must hash the same.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import v8 from "node:v8";
import { makeConserveBot } from "./conserve-bot.mjs";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(pathToFileURL(join(HERE, ".engine.mjs")).href);
const { makeCity, REGION } = await import(pathToFileURL(join(HERE, "..", "src", "citygen", "index.mjs")).href);

const IN = ["noi", "sold", "interest", "borrowed", "lpCalled", "fees"];
const OUT = ["debtSvc", "leasing", "capex", "dev", "taxes", "bought", "ga", "lpDistributed"];
const bookSum = (g) => { let t = 0; for (const y of g.books ?? []) { for (const k of IN) t += y[k] ?? 0; for (const k of OUT) t -= y[k] ?? 0; } return t; };
const deposits = (g) => { let d = 0; for (const h of Object.values(g.holdings ?? {})) for (const t of h.tenants ?? []) d += t.deposit ?? 0; return d; };
const liquidity = (g) => g.cash + (g.fund?.cash ?? 0);
const sha = (x) => createHash("sha256").update(x).digest("hex").slice(0, 16);

function buildRegion(seed) {
  const city = makeCity(REGION, seed);
  E.normalizeParcels(city.parcels);
  return { parcels: city.parcels, bbls: Object.keys(city.parcels), adjacency: city.adjacency };
}
// what the store does on Continue after buildTown: the engine's tables, then the deeds the state cut
function restore(s, parcels, bbls) {
  if (s.plats) E.materializePlats(s, parcels, bbls);
  if (s.splits) E.materializeSplits(s, parcels, bbls);
  if (s.growth?.unpacked) E.materializeNeighbourhoods(s, parcels, bbls);
}
const tableHash = (parcels, bbls) => ({
  order: sha(bbls.join(",")),
  content: sha(JSON.stringify([...bbls].sort().map((b) => [b, parcels[b]]))),
  n: bbls.length,
});
const stateHash = (g) => sha(JSON.stringify(E.migrateSaveState(structuredClone(g))));

function makeRunner(seed, useBot, parcels, bbls, adjacency, botState) {
  const r = { resurrected: 0, breaks: [], worst: 0, months: 0, tickMs: 0, botMs: 0 };
  let bot = null;
  r.attach = (g) => {
    if (useBot) { bot = makeConserveBot(E, { seed, START: botState?.START ?? g.cash }); if (botState) Object.assign(bot, { built: botState.built, syndicated: botState.syndicated }); }
    r.prev = { cash: liquidity(g), books: bookSum(g), dep: deposits(g), loc: g.loc?.balance ?? 0 };
  };
  r.botState = (g) => bot && { START: botState?.START ?? r.START, built: bot.built, syndicated: bot.syndicated };
  r.step = (g, m) => {
    const m0 = g.month;
    let t = performance.now();
    g = E.advanceQuarter(g, parcels, bbls, adjacency);
    r.tickMs += performance.now() - t;
    if (g.month !== m0 + 1) throw new Error(`frozen world: month ${m0} -> ${g.month}`);
    let res = false;
    if (g.gameOver) { g = { ...g, gameOver: null, cash: 6e6 }; r.resurrected++; res = true; }
    if (bot) { t = performance.now(); g = bot.step(g, parcels, m); r.botMs += performance.now() - t; }
    const nb = bookSum(g), nd = deposits(g), nl = g.loc?.balance ?? 0;
    const resid = (liquidity(g) - r.prev.cash) - ((nb - r.prev.books) + (nl - r.prev.loc) + (nd - r.prev.dep));
    if (!res && Math.abs(resid) > 1000) {
      if (Math.abs(resid) > Math.abs(r.worst)) r.worst = resid;
      if (r.breaks.length < 6) r.breaks.push({ m: g.month, resid: Math.round(resid), news: (g.news ?? []).filter((n) => n.q === g.month).map((n) => n.text.slice(0, 90)).slice(0, 3) });
    }
    r.prev = { cash: liquidity(g), books: nb, dep: nd, loc: nl };
    r.months++;
    return g;
  };
  return r;
}

// ---- child: a Continue from a save file
if (process.argv[2] === "--reload") {
  const [, , , file, seedS, monthsS, botJson] = process.argv;
  const seed = Number(seedS), months = Number(monthsS), botState = botJson === "null" ? null : JSON.parse(botJson);
  const raw = v8.deserialize(readFileSync(file));
  const prep = E.prepareSaveForResume(raw);
  if (!prep.ok) { console.log(JSON.stringify({ err: prep.reason })); process.exit(0); }
  let g = prep.state;
  const { parcels, bbls, adjacency } = buildRegion(seed);
  // the store's Continue gate runs BEFORE anything is materialised (store.ts continueRun)
  const fitsBefore = Object.keys(g.holdings).every((b) => parcels[b]) && g.listings.every((l) => parcels[l.bbl]);
  restore(g, parcels, bbls);
  const fitsAfter = Object.keys(g.holdings).every((b) => parcels[b]) && g.listings.every((l) => parcels[l.bbl]);
  const table = tableHash(parcels, bbls);
  const run = makeRunner(seed, !!botState, parcels, bbls, adjacency, botState);
  run.attach(g);
  for (let m = 0; m < months; m++) g = run.step(g, botState?.m0 != null ? botState.m0 + m : m);
  console.log(JSON.stringify({ fitsBefore, fitsAfter, table, after: stateHash(g), afterTable: tableHash(parcels, bbls) }));
  process.exit(0);
}

// ---- main
const SEED = Number(process.env.SEED ?? 1);
const YEARS = Number(process.env.Y ?? 100);
const BOT = process.env.BOT !== "0";
const SAVES = (process.env.SAVES ?? "25,50,100").split(",").filter(Boolean).map(Number);
const CHECK_M = Number(process.env.CHECK_M ?? 12);
let fails = 0;
const fail = (m) => { fails++; console.log("  FAIL " + m); };
const nonFinite = (o, path, out, seen = new Set()) => {
  if (out.length >= 5 || !o || typeof o !== "object" || seen.has(o)) return;
  seen.add(o);
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === "number" && !Number.isFinite(v)) { out.push(`${path}${k}=${v}`); if (out.length >= 5) return; }
    else if (v && typeof v === "object") nonFinite(v, `${path}${k}.`, out, seen);
  }
};
const mb = (n) => (n / 1048576).toFixed(1);
const biggest = (g) => Object.entries(g).map(([k, v]) => [k, v == null ? 0 : JSON.stringify(v)?.length ?? 0]).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k} ${mb(n)}`).join(", ");

const { parcels, bbls, adjacency } = buildRegion(SEED);
const lots0 = bbls.length;
let g = E.firstListings(E.newGame(SEED, parcels, undefined, undefined, { citySize: "region", cityLots: bbls.length }), parcels, bbls);
// what the store stamps on a save (store.ts saveTo) so Continue can rebuild the town
g = { ...g, cityIsland: g.cityIsland ?? REGION, citySeed: g.citySeed ?? SEED, citySize: g.citySize ?? "region" };
const run = makeRunner(SEED, BOT, parcels, bbls, adjacency, null);
run.START = g.cash;
run.attach(g);
console.log(`region-longrun seed ${SEED}, ${YEARS} years, ${BOT ? "conserve bot playing" : "no player"}; ${lots0} parcels at the opening`);
console.log(`  yrs     tick ms/mo  bot ms/mo  parcels  save MB (v8 / json)  heap MB  rss MB  resurrected | largest state keys (MB json)`);
// KEEP=dir keeps the save files (y25.bin ...) for a profile or a later look
const tmp = process.env.KEEP ?? join(tmpdir(), `bw-longrun-${process.pid}`);
mkdirSync(tmp, { recursive: true });
const decade = [];
let lastT = 0, lastB = 0, lastM = 0;
const pending = [];
for (let m = 0; m < YEARS * 12; m++) {
  g = run.step(g, m);
  const yr = (m + 1) / 12;
  if ((m + 1) % 60 === 0) {
    const bad = [];
    nonFinite(g, "s.", bad);
    for (const b of bbls) { if (bad.length >= 5) break; const p = parcels[b]; for (const [k, v] of Object.entries(p)) if (typeof v === "number" && !Number.isFinite(v)) bad.push(`parcels[${b}].${k}=${v}`); }
    if (bad.length) fail(`year ${yr}: non-finite ${bad.join("; ")}`);
  }
  if ((m + 1) % 120 === 0 || m + 1 === YEARS * 12) {
    if (globalThis.gc) globalThis.gc();
    const mem = process.memoryUsage();
    const vb = v8.serialize(g).length, jb = Buffer.byteLength(JSON.stringify(g));
    const n = run.months - lastM;
    const row = { yr, tick: (run.tickMs - lastT) / n, bot: (run.botMs - lastB) / n, parcels: bbls.length, v8: vb, json: jb, heap: mem.heapUsed, rss: mem.rss };
    decade.push(row);
    lastT = run.tickMs; lastB = run.botMs; lastM = run.months;
    console.log(`  ${String(yr - 10).padStart(3)}-${String(yr).padEnd(3)}  ${row.tick.toFixed(0).padStart(8)}  ${row.bot.toFixed(0).padStart(9)}  ${String(row.parcels).padStart(7)}  ${mb(vb).padStart(8)} / ${mb(jb).padEnd(8)}  ${mb(mem.heapUsed).padStart(7)}  ${mb(mem.rss).padStart(6)}  ${String(run.resurrected).padStart(5)}       | ${biggest(g)}`);
  }
  if (SAVES.includes(yr)) {
    // the save, as IndexedDB would store it; a child process Continues it
    const file = join(tmp, `s${SEED}-y${yr}.bin`);
    writeFileSync(file, v8.serialize(g));
    const live = tableHash(parcels, bbls);
    const botState = BOT ? { ...run.botState(g), START: run.START, m0: m + 1 } : null;
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--reload", file, String(SEED), String(CHECK_M), JSON.stringify(botState)], { encoding: "utf8", timeout: 900_000, maxBuffer: 1 << 24 });
    let c = null;
    try { c = JSON.parse(child.stdout.trim().split("\n").at(-1)); } catch { c = { err: `child failed: ${child.status} ${child.stderr?.slice(-400)}` }; }
    pending.push({ yr, m: m + 1, live, c, file });
  }
  // compare a reload once the live run has gone CHECK_M months past it
  for (const p of pending) if (!p.done && m + 1 === p.m + CHECK_M) {
    p.done = true;
    const c = p.c;
    if (c.err) { fail(`year ${p.yr} reload: ${c.err}`); continue; }
    const after = stateHash(g), afterTable = tableHash(parcels, bbls);
    const ok = c.table.content === p.live.content && c.table.order === p.live.order && c.after === after && c.afterTable.content === afterTable.content;
    console.log(`  reload @ year ${p.yr}: Continue gate ${c.fitsBefore ? "passes" : "REFUSES (a deed not in the rebuilt table)"}${c.fitsAfter ? "" : ", still missing after restore"}; table ${c.table.n}/${p.live.n} parcels, contents ${c.table.content === p.live.content ? "same" : "DIFFER"}, order ${c.table.order === p.live.order ? "same" : "DIFFERS"}; ${CHECK_M} months on: state ${c.after === after ? "identical" : "DIVERGED"}, table ${c.afterTable.content === afterTable.content ? "same" : "DIFFERS"}`);
    if (!ok) fail(`year ${p.yr}: the reloaded game is not the game`);
    if (!c.fitsBefore) fail(`year ${p.yr}: Continue would refuse this save`);
  }
}
// saves at the very end: run the live game the extra months so the comparison happens
for (const p of pending) if (!p.done) {
  for (let k = 0; k < CHECK_M && !p.done; k++) {
    g = run.step(g, YEARS * 12 + k);
    if (YEARS * 12 + k + 1 === p.m + CHECK_M) {
      p.done = true;
      const c = p.c;
      if (c.err) { fail(`year ${p.yr} reload: ${c.err}`); continue; }
      const after = stateHash(g), afterTable = tableHash(parcels, bbls);
      const ok = c.table.content === p.live.content && c.table.order === p.live.order && c.after === after && c.afterTable.content === afterTable.content;
      console.log(`  reload @ year ${p.yr}: Continue gate ${c.fitsBefore ? "passes" : "REFUSES (a deed not in the rebuilt table)"}${c.fitsAfter ? "" : ", still missing after restore"}; table ${c.table.n}/${p.live.n} parcels, contents ${c.table.content === p.live.content ? "same" : "DIFFER"}, order ${c.table.order === p.live.order ? "same" : "DIFFERS"}; ${CHECK_M} months on: state ${c.after === after ? "identical" : "DIVERGED"}, table ${c.afterTable.content === afterTable.content ? "same" : "DIFFERS"}`);
      if (!ok) fail(`year ${p.yr}: the reloaded game is not the game`);
      if (!c.fitsBefore) fail(`year ${p.yr}: Continue would refuse this save`);
    }
  }
}
if (!process.env.KEEP) rmSync(tmp, { recursive: true, force: true });
const avg = decade.reduce((a, r) => a + r.tick * 120, 0) / (decade.length * 120 || 1);
console.log(`  mean tick ${avg.toFixed(0)} ms/month over ${YEARS} y; parcels ${lots0} -> ${bbls.length}; final save ${mb(decade.at(-1)?.v8 ?? 0)} MB; resurrected ${run.resurrected}x`);
if (BOT) {
  console.log(`  ledger: ${run.breaks.length ? `${run.breaks.length}+ month(s) out of balance, worst $${run.worst.toLocaleString()}` : `${run.months} months at $0 unexplained`}`);
  for (const b of run.breaks) console.log(`    m${b.m} ${b.resid} · ${b.news.join(" · ")}`);
  if (run.breaks.length) fail("ledger out of balance");
}
console.log(`LONGRUN ${JSON.stringify({ seed: SEED, bot: BOT, decade: decade.map((r) => ({ yr: r.yr, tick: Math.round(r.tick), bot: Math.round(r.bot), parcels: r.parcels, v8MB: +mb(r.v8), jsonMB: +mb(r.json), heapMB: +mb(r.heap) })), hash: stateHash(g) })}`);
if (fails) { console.log(`\n${fails} failure(s)`); process.exit(1); }
console.log("region-longrun pass");
