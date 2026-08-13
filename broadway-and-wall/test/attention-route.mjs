// Every attentionItems key must route to a desk — no orphan inbox rows.
//   pnpm engine && pnpm attention
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);
const SEEDS = Number(process.env.SEEDS ?? 4);
const MONTHS = Number(process.env.HZ ?? 360);

let fails = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) { fails++; console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`); }
  else console.log(`PASS  ${name}${detail ? " — " + detail : ""}`);
};

const routed = (route) => !!(route.page || route.auction);

const seen = new Set();
for (let si = 0; si < SEEDS; si++) {
  let g = E.firstListings(E.newGame(9000 + si * 131, parcels), parcels, bbls);
  for (let m = 0; m < MONTHS; m++) {
    if (g.gameOver) g = { ...g, gameOver: null, cash: Math.max(g.cash, 6e6) };
    for (const item of E.attentionItems(g, parcels)) {
      seen.add(item.key);
      const route = E.routeAttention(item.key, g);
      if (!routed(route)) {
        fails++;
        console.log(`FAIL  orphan key ${item.key} (${item.label.slice(0, 60)})`);
      }
      for (const part of item.key.split(":")) {
        const rec = parcels[part];
        if (rec?.address && rec.address !== part && item.label.includes(part) && !item.label.includes(rec.address)) {
          fails++;
          console.log(`FAIL  label leaks bbl ${part}: ${item.label}`);
        }
      }
    }
    g = E.advanceQuarter(g, parcels, bbls, adjacency);
    for (const loi of [...g.lois].slice(0, 3)) {
      const r = E.respondLOI(g, parcels, loi.id, m % 5 === 0 ? "decline" : "accept");
      if (!r.err) g = r.s;
    }
  }
}

ok("collected attention keys from bot runs", seen.size > 20, `${seen.size} distinct keys`);
ok("every seen key routes", fails === 0, fails ? `${fails} orphan(s)` : `${seen.size} keys`);

{
  // Inbox copy must name the building, not the file number. Planted so the
  // check does not depend on a bot happening to list, default, or call capital.
  let g = E.firstListings(E.newGame(91001, parcels, 40_000_000), parcels, bbls);
  const L = (g.listings ?? []).find((x) => {
    const rec = E.resolveRec(parcels, g, x.bbl);
    return rec && rec.class !== "land" && rec.bldgArea > 0 && x.ask < 8_000_000;
  });
  ok("plant listing exists", !!L);
  if (L) {
    const rec = E.resolveRec(parcels, g, L.bbl);
    const r = E.executePurchase(g, parcels, L.bbl, L.ask, "cash", false, 1);
    ok("plant purchase", !r.err && !!r.s.holdings[L.bbl], r.err ?? "");
    g = r.s;
    const h = g.holdings[L.bbl];
    h.sale = {
      ask: L.ask, listedM: g.month, mode: "quiet",
      bids: [{ name: "First Harbor Bank", price: Math.round(L.ask * 0.92), credibility: 0.8, note: "plant" }],
    };
    h.planCutM = g.month;
    if (h.tenants[0]) h.tenants[0].nonRenewM = g.month;
    g.developments[L.bbl] = {
      bbl: L.bbl, use: "office", sf: rec.bldgArea || 20000, floors: rec.floors || 4,
      startM: g.month, deliverM: g.month + 18, costTotal: 1e6, drawn: 0, equity: 1e6,
      lastCapitalCallM: g.month, lastCapitalCall: 250_000,
    };
    g.workouts = {
      [L.bbl]: {
        bbl: L.bbl, lender: "First Harbor Bank", startM: g.month, stage: "notice",
        cause: "covenant", cure: 80_000, decideM: g.month + 6, asks: 0, missedMs: 0,
      },
    };
    const items = E.attentionItems(g, parcels);
    const want = ["sale-bids", "capital-plan", "capital-call", "workout"];
    if (h.tenants[0]) want.push("nonrenew");
    for (const head of want) {
      const row = items.find((a) => a.key.startsWith(head + ":"));
      ok(`planted ${head} routes`, !!row && routed(E.routeAttention(row.key, g)), row?.label ?? "missing");
      if (row) {
        ok(`planted ${head} names the street`, row.label.includes(rec.address), row.label);
        ok(`planted ${head} hides the bbl`, !row.label.includes(L.bbl) || rec.address === L.bbl, row.label);
      }
    }
  }

  ok("month toast omits sub-centimillion noise",
    E.monthCashBit(0) === "" && E.monthCashBit(4_999) === "" && E.monthCashBit(-4_999) === "");
  ok("month toast prints a centimillion",
    E.monthCashBit(10_000) === " · +$0.01M" && E.monthCashBit(-25_000) === " · −$0.03M");
}

// Static prefixes emitted by attentionItems — catch keys the bot never reached.
const PREFIXES = [
  "loi", "tenant-ask", "portfolio-bid", "broker", "early-look", "offer", "sale-bids",
  "nonrenew", "lease-roll", "capital-plan", "balloon", "sweep",
  "facility-balloon", "facility-sweep", "capital-call", "workout",
  "contract", "talks", "exchange", "note", "npl", "private-ask", "private-borrow",
  "street-book", "auction", "line-over", "cash", "cash-runway", "ti-book",
  "estate", "over",
];
for (const p of PREFIXES) {
  const sample = p === "tenant-ask" ? `${p}:1`
    : p === "portfolio-bid" ? `${p}:Acme:1000000`
    : p === "broker" || p === "early-look" || p === "offer" || p === "sale-bids" || p === "nonrenew"
      || p === "lease-roll" || p === "capital-plan" || p === "balloon"
      || p === "sweep" || p === "capital-call" || p === "workout"
      || p === "contract" || p === "talks"
      ? `${p}:0000010001:extra`
    : p === "facility-balloon" ? `${p}:far`
    : p === "note" || p === "private-ask" || p === "private-borrow" ? `${p}:1`
    : p === "npl" ? `${p}:1:12`
    : p === "street-book" ? `${p}:pkg1`
    : p === "auction" ? `${p}:84`
    : p === "estate" ? `${p}:120`
    : p;
  const route = E.routeAttention(sample, E.newGame(1, parcels));
  ok(`prefix ${p}`, routed(route));
}

console.log(`\n${fails === 0 ? "attention-route pass" : `${fails} attention-route failure(s)`}`);
process.exit(fails === 0 ? 0 : 1);
