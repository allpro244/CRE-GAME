// WHERE THE STREET'S FIRMS COME FROM AND WHERE THEY GO, per decade of an
// unplayed century (world kept alive). The decomposition behind ECONOMY.md
// "THE STREET THINNED TO TWO".
//
//   pnpm engine && SEEDS=7777,4242 node tools/firm-flows.mjs
//   ENGINE=/abs/path/to/other/.engine.mjs DUMP=out.json ...   another build; raw rows
//
// Columns: living firms at the decade's start | entries (anonymous raise,
// founder/spinout, heir) | exits (arrears with a book, arrears on an empty
// book, empty-book wind-up, taken private) | founder bids queued, refused |
// the entry pitch's terms averaged over the decade (leverage, product, thin,
// pitch), trades a year, mean cap, mean index, % of months leverage and
// product read zero. Exits are classified by the state the month they fail.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(process.env.ENGINE ? (process.env.ENGINE.startsWith("/") ? process.env.ENGINE : join(HERE, "..", process.env.ENGINE)) : join(HERE, "..", "test", ".engine.mjs"));
const { loadCity } = await import(join(HERE, "..", "test", "city.mjs"));
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);
const seeds = (process.env.SEEDS ?? "7777,4242").split(",").map(Number);
const MONTHS = +(process.env.MONTHS ?? 1200);
const monthly = []; const exits = []; const jobsOut = [];
for (const seed of seeds) {
  let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  const dec = [];
  let cur = null;
  const known = new Set((g.rivals ?? []).map((r) => r.id));
  const dead = new Set(); const seenNews = new Set(); const track = {}; const seenJobs = new Set();
  for (let m = 0; m < MONTHS; m++) {
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
    if (m % 120 === 0) {
      cur = { d: m / 120, start: (g.rivals ?? []).filter((r) => r.failedM === undefined).length,
        entA: 0, entF: 0, entH: 0, exArrBook: 0, exArrEmpty: 0, exHusk: 0, exTake: 0, refused: 0, bidsQ: 0,
        rivalJobs: 0, anonJobs: 0, lev: 0, prod: 0, thin: 0, pitch: 0, traded: 0, levZero: 0, prodZero: 0, n: 0, cap: 0, idx: 0 };
      dec.push(cur);
    }
    const p = E.firmEntryPitch(g);
    { const c = g.econ.capRate; const cap = (c.office + c.retail + c.multifamily + c.industrial) / 4;
      const ie = g.econ.nat?.inflExp ?? 0.02; const gr = Math.max(2, ie * 100);
      monthly.push({ seed, m, cap, idx: g.econ.indexRate, ie, old: cap - (g.econ.indexRate + 1.9), tot: cap + gr - (g.econ.indexRate + 1.9),
        firms: p.firms, traded: p.traded, thin: p.thin }); }
    const c = g.econ.capRate;
    cur.cap += (c.office + c.retail + c.multifamily + c.industrial) / 4; cur.idx += g.econ.indexRate;
    cur.lev += p.leverage; cur.prod += p.product; cur.thin += p.thin; cur.pitch += p.pitch; cur.traded += p.traded; cur.n++;
    if (p.leverage === 0) cur.levZero++;
    if (p.product === 0) cur.prodZero++;
    const prevBids = new Set((g.founderBids ?? []).map((b) => b.name));
    const pre = new Map((g.rivals ?? []).map((r) => [r.id, { bbls: r.bbls.length }]));
    g = E.advanceQuarter(g, parcels, bbls, adjacency);
    for (const j of g.cityJobs ?? []) { const k = j.bbl + ":" + j.startM; if (seenJobs.has(k)) continue; seenJobs.add(k); if (j.firmId) cur.rivalJobs++; else cur.anonJobs++; }
    for (const r of g.rivals ?? []) { if (r.failedM !== undefined) continue; const t = (track[r.id] ??= { max: 0, buys: 0, last: r.bbls.length, lastBuyM: null, entered: m });
      if (r.bbls.length > t.last) { t.buys += r.bbls.length - t.last; t.lastBuyM = m; } t.max = Math.max(t.max, r.bbls.length); t.last = r.bbls.length; }
    for (const b of g.founderBids ?? []) if (!prevBids.has(b.name)) cur.bidsQ++;
    for (const n of g.news ?? []) { if (n.q !== g.month - 0 && n.q !== g.month - 1) continue; if (/could not raise/.test(n.text) && !seenNews.has(n.text)) { seenNews.add(n.text); cur.refused++; } }
    for (const r of g.rivals ?? []) {
      if (!known.has(r.id)) {
        known.add(r.id);
        if (r.spawnedFrom) cur.entF++; else if (r.id.startsWith("h:")) cur.entH++; else cur.entA++;
      }
      if (r.failedM === undefined || dead.has(r.id)) continue;
      dead.add(r.id);
      const p0 = pre.get(r.id);
      exits.push({ seed, m, style: r.style, age: m - (r.bornM ?? 0), husk: (r.emptyMs ?? 0) > 24, spawned: !!r.spawnedFrom, heir: r.id.startsWith("h:"), orig: (r.bornM ?? 0) === 0, buys: track[r.id]?.buys ?? 0, max: track[r.id]?.max ?? 0, sinceBuy: track[r.id]?.lastBuyM == null ? null : m - track[r.id].lastBuyM, distributed: r.distributed ?? 0, cash: r.cash });
      if (r.takenPrivateM !== undefined) cur.exTake++;
      else if ((r.emptyMs ?? 0) > 24) cur.exHusk++;
      else if (p0 && p0.bbls > 0) cur.exArrBook++; else cur.exArrEmpty++;
    }
  }
  console.log(`seed ${seed}`);
  console.log("dec start | entA entF entH | arrBook arrEmpty husk take | bidsQ refused | lev prod thin pitch traded cap idx levZero% prodZero%");
  for (const c of dec) console.log(`${c.d} ${String(c.start).padStart(3)} | ${c.entA} ${c.entF} ${c.entH} | ${c.exArrBook} ${c.exArrEmpty} ${c.exHusk} ${c.exTake} | ${c.bidsQ} ${c.refused} | ${(c.lev / c.n).toFixed(2)} ${(c.prod / c.n).toFixed(2)} ${(c.thin / c.n).toFixed(2)} ${(c.pitch / c.n).toFixed(3)} ${(c.traded / c.n).toFixed(1)} ${(c.cap / c.n).toFixed(2)} ${(c.idx / c.n).toFixed(2)} ${(100 * c.levZero / c.n).toFixed(0)} ${(100 * c.prodZero / c.n).toFixed(0)}`);
  console.log("end", (g.rivals ?? []).filter((r) => r.failedM === undefined).length);
  console.log("jobs rival/anon by decade:", dec.map((c) => `${c.rivalJobs}/${c.anonJobs}`).join(" "));
  jobsOut.push({ seed, rival: dec.map((c) => c.rivalJobs), anon: dec.map((c) => c.anonJobs), buys: Object.values(track).reduce((a, t) => a + t.buys, 0) });
}

import { writeFileSync } from "node:fs";
if (process.env.DUMP) writeFileSync(process.env.DUMP, JSON.stringify({ monthly, exits, jobsOut }));
