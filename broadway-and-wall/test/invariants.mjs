// Run the invariant checks against every month of full campaigns, across
// strategies chosen to stress different parts of the engine. Reports the FIRST
// month each distinct violation appears, because that is the month with the
// bug in it.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
// Cities live in per-city dirs now; the harness runs against one of them.
// BW_CITY picks which (default newalden — the original balance target).
const P = join(HERE, "..", "public", "data", process.env.BW_CITY ?? "newalden") + "/";
const parcels = JSON.parse(gunzipSync(readFileSync(P + "parcels.json.gz")).toString());
const adjacency = JSON.parse(gunzipSync(readFileSync(P + "adjacency.json.gz")).toString());
const bbls = Object.keys(parcels);
const E = await import(process.env.ENGINE ?? join(HERE, ".engine.mjs"));
E.normalizeParcels(parcels);   // legacy "mixed" records become a class + a mix

const HORIZON = Number(process.env.HORIZON ?? 1200);
const SEEDS = Number(process.env.SEEDS ?? 8);

// Each bot is chosen to walk a different code path to its edges.
const BOTS = {
  // maximum leverage, never sells: drives loans to breach, sweep and balloon
  levered: {
    buy: (c) => c.built, lev: 1, prod: () => "cordage", refi: true, sell: () => false, every: 5,
  },
  // builds constantly: exercises draws, reserves, contingency, delivery
  builder: { buy: () => true, lev: 0.9, prod: (c) => (c.built ? "savings" : "land"), dev: true, sell: (g) => g > 0.5, every: 7 },
  // churns: exercises sale, tax, 1031, exits
  churner: { buy: (c) => c.built, lev: 0.7, prod: () => "savings", sell: (g) => g > 0.15, every: 3 },
  // mezz + participating + caps: the exotic end of the desk
  exotic: { buy: (c) => c.built, lev: 1, prod: (c) => (c.yield > 0.06 ? "pelican" : "cordage"), refi: true, mezz: true, sell: () => false, every: 6 },
};

const firstSeen = new Map();   // code|where-kind -> {month, seed, bot, detail}
let checks = 0;

function record(bot, seed, month, v) {
  const key = `${bot}|${v.code}|${v.where.replace(/\d+/g, "#")}`;
  if (!firstSeen.has(key)) firstSeen.set(key, { month, seed, bot, ...v });
}

function run(botName, seed) {
  const B = BOTS[botName];
  let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  for (let m = 0; m < HORIZON; m++) {
    g = E.advanceQuarter(g, parcels, bbls, adjacency);
    checks++;
    for (const v of E.checkInvariants(g, parcels)) record(botName, seed, g.month, v);
    if (g.gameOver) break;

    for (const loi of [...g.lois]) {
      const r = E.respondLOI(g, parcels, loi.id, m % 7 === 0 ? "counter" : "accept", true);
      g = r.err ? E.respondLOI(g, parcels, loi.id, "decline").s : r.s;
    }
    for (const v of E.checkInvariants(g, parcels)) record(botName, seed, g.month, v);

    for (const bbl of Object.keys(g.holdings)) {
      const h = g.holdings[bbl];
      if (!h.sale?.offer) continue;
      const q = E.saleTaxQuote(h, h.sale.offer.price);
      const gp = h.costBasis > 0 ? q.gain / h.costBasis : 0;
      if (B.sell(gp) || h.sale.unsolicited) {
        const r = E.acceptSaleOffer(g, parcels, bbl);
        if (!r.err) g = r.s;
      }
    }

    if (m % B.every === 2) {
      const cands = g.listings.map((l) => ({ l, r: E.resolveRec(parcels, g, l.bbl) })).filter((x) => x.r)
        .map((x) => {
          const built = x.r.class !== "land" && x.r.bldgArea > 0;
          const noi = built ? E.noiYr(x.r, g.econ, E.initialCondition(x.r)) : 0;
          return { ...x, built, yield: built && x.l.ask > 0 ? noi / x.l.ask : 0 };
        }).filter(B.buy);
      for (const c of cands.slice(0, 6)) {
        const r = E.buyListing(g, parcels, c.l.bbl, B.prod(c), B.lev, Math.round(c.l.ask * 0.97));
        if (!r.err) { g = r.s; break; }
      }
    }

    if (B.dev && m % 11 === 4) {
      for (const bbl of Object.keys(g.holdings)) {
        const rec = E.resolveRec(parcels, g, bbl);
        if (!rec || rec.class !== "land" || g.developments[bbl]) continue;
        for (let fl = Math.min(E.maxFloorsFor(rec, 0.6), 20); fl >= 2; fl--) {
          const plan = E.planDevelopment(g, parcels, bbl, m % 3 === 0 ? "multifamily" : "office", fl, 0.6, 0.3, m % 2 ? "gmp" : "costplus");
          if (!plan || plan.commitment === 0 || plan.equityAtClose > g.cash * 0.5) continue;
          const r = E.startDevelopment(g, parcels, bbl, m % 3 === 0 ? "multifamily" : "office", fl, 0.6, 0.3, m % 2 ? "gmp" : "costplus");
          if (!r.err) { g = r.s; break; }
        }
        break;
      }
    }

    if (B.refi && m % 29 === 7) {
      for (const bbl of Object.keys(g.holdings)) {
        const h = g.holdings[bbl];
        if (!h.loan || g.month - h.loan.originM < 40) continue;
        const { quotes } = E.refiQuotes(g, parcels, bbl);
        const pick = B.mezz
          ? quotes.find((q) => q.available && q.id === "mezz") ?? quotes.filter((q) => q.available)[0]
          : quotes.filter((q) => q.available).sort((a, b) => b.maxProceeds - a.maxProceeds)[0];
        if (pick) {
          const r = E.refinance(g, parcels, bbl, pick.id, 1);
          if (!r.err) g = r.s;
        }
        break;
      }
      // and buy a cap now and then, because that path has money in it
      for (const bbl of Object.keys(g.holdings)) {
        const r = E.buyRateCap(g, parcels, bbl);
        if (!r.err) { g = r.s; break; }
      }
    }
    for (const v of E.checkInvariants(g, parcels)) record(botName, seed, g.month, v);
  }
}

const t0 = process.hrtime.bigint();
for (const bot of Object.keys(BOTS)) {
  for (let i = 0; i < SEEDS; i++) run(bot, 4000 + i * 53);
}
const ms = Number(process.hrtime.bigint() - t0) / 1e6;

console.log(`${checks.toLocaleString()} months checked across ${Object.keys(BOTS).length} bots × ${SEEDS} seeds · ${(ms / 1000).toFixed(1)}s`);
if (!firstSeen.size) {
  console.log("no violations");
} else {
  console.log(`${firstSeen.size} distinct violation(s), first appearance each:`);
  for (const v of [...firstSeen.values()].sort((a, b) => a.month - b.month)) {
    console.log(`  m${String(v.month).padStart(4)} ${v.bot.padEnd(8)} seed ${v.seed}  [${v.code}] ${v.where}: ${v.detail}`);
  }
  process.exitCode = 1;
}
