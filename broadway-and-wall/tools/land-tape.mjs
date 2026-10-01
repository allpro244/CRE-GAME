// THE VACANT LOTS ON THE TAPE, AND WHO COULD BUY THEM ON THE RESIDUAL.
//
//   pnpm engine && SEEDS=7777 MONTHS=240 node tools/land-tape.mjs
//
// Every month, every vacant listing: which bid set the land price, whether
// the residual's own scheme clears at the ask on the shared desk, and how
// many firms that build could fund the close (cash + line vs equity + reserve).
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(process.env.ENGINE ? (process.env.ENGINE.startsWith("/") ? process.env.ENGINE : join(HERE, "..", process.env.ENGINE)) : join(HERE, "..", "test", ".engine.mjs"));
const { loadCity } = await import(join(HERE, "..", "test", "city.mjs"));
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);
const seeds = (process.env.SEEDS ?? "7777").split(",").map(Number);
const MONTHS = +(process.env.MONTHS ?? 240);
const q = (xs, p) => { const a = xs.slice().sort((x, y) => x - y); return a.length ? a[Math.floor((a.length - 1) * p)] : NaN; };
for (const seed of seeds) {
  let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  const seen = new Set();
  const t = { lots: 0, builder: 0, holder: 0, texture: 0, clears: 0, fundable: 0, sold: 0, soldClear: 0, askOverResid: [] };
  for (let m = 0; m < MONTHS; m++) {
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
    const before = new Map();
    for (const l of g.listings ?? []) {
      const rec = E.resolveRec(parcels, g, l.bbl);
      if (!rec || rec.class !== "land") continue;
      const read = E.landRead(rec, g.econ);
      const sc = read.scheme;
      const uw = sc && sc.psf > 0 ? E.underwriteDevelopment(g, parcels, l.bbl, sc.use, sc.floors, sc.coverage, l.ask) : null;
      before.set(l.bbl, !!uw?.clears);
      if (seen.has(l.bbl + ":" + l.listedM)) continue;
      seen.add(l.bbl + ":" + l.listedM);
      t.lots++; t[read.winner]++;
      if (sc && sc.psf > 0) t.askOverResid.push(l.ask / (sc.psf * rec.lotArea));
      if (uw?.clears) {
        t.clears++;
        // firms that build, allowed land by their style, able to fund half the price + reserve from cash + line
        let n = 0; const why = [];
        for (const r of g.rivals ?? []) {
          if (r.failedM !== undefined || !(E.buildAppetite(r.style) > 0)) continue;
          const cls = E.STYLE_OF(r.style).classes; if (cls && !cls.includes("land")) continue;
          const room = Math.max(0, E.lineRoom(g, r, r.aum ?? 0, r.markNoi ?? 0, r.markLand ?? 0));
          const need = l.ask * 0.52 + Math.max(500_000, r.cash * 0.05);
          if (r.cash + room >= need) n++; else why.push(`${r.style} ${(r.cash/1e6).toFixed(1)}+${(room/1e6).toFixed(1)}<${(need/1e6).toFixed(1)}`);
        }
        if (n) t.fundable++;
        if (process.env.V) console.log(`  m${g.month} ${l.bbl} ask $${(l.ask/1e6).toFixed(2)}M ${sc.use} ${sc.floors}fl: ${n} builders could fund; ${why.slice(0,6).join(", ")}`);
      }
    }
    g = E.advanceQuarter(g, parcels, bbls, adjacency);
    const still = new Set((g.listings ?? []).map((l) => l.bbl));
    for (const [b, c] of before) if (!still.has(b) && (g.lastTradeM?.[b] === g.month || g.lastTradeM?.[b] === g.month - 1)) { t.sold++; if (c) t.soldClear++; }
  }
  console.log(`seed ${seed} ${MONTHS}m: ${t.lots} vacant listings — priced by builder ${t.builder} / holder ${t.holder} / texture ${t.texture}; residual scheme clears at the ask on ${t.clears}, with a builder able to fund ${t.fundable}`);
  console.log(`   sold ${t.sold}, of which clearing at the ask ${t.soldClear}; ask / builder residual p10 ${q(t.askOverResid, .1).toFixed(2)} p50 ${q(t.askOverResid, .5).toFixed(2)} p90 ${q(t.askOverResid, .9).toFixed(2)}`);
}
