// THE PROPERTY MARKET (ONE_ECONOMY_PLAN.md step 7; engine/propmarket.ts).
//
//   1. cap rates open where the street's bidders say, not at a formula;
//   2. a crunch lowers what a bidder pays BECAUSE its loan shrinks and costs
//      more — the same building, the same firm, only the desks moved;
//   3. a seller's floor is its own situation: a forced seller clears its loan,
//      a firm in arrears takes any bid, a voluntary one wants its value in use;
//   4. in play, every class's cap is the median of its own prints (an
//      identity against the tape), trades close between named firms, and the
//      read and the trades are on the cause ledger in plain words.
//
//   pnpm engine && node test/property-market.mjs
import { assertFreshBundle } from "./fresh.mjs";
if (!process.env.ENGINE) assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(process.env.ENGINE ? join(HERE, "..", process.env.ENGINE) : join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

let fails = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) { fails++; console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`); }
  else console.log(`PASS  ${name}${detail ? " — " + detail : ""}`);
};
const K = ["office", "retail", "multifamily", "industrial"];
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);
const SEED = 4242;

// ---- 1. the opening
let g = E.firstListings(E.newGame(SEED, parcels), parcels, bbls);
{
  const caps = K.map((k) => g.econ.capRate[k]);
  ok("every class opens on a finite cap inside the record (2-20%)", caps.every((c) => Number.isFinite(c) && c > 2 && c < 20), caps.map((c) => c.toFixed(2)).join(" "));
  ok("the opening is a survey, not a print: no evidence yet", K.every((k) => g.econ.capRead?.[k]?.n === 0));
  ok("no class opens at the provisional table (CAP_BASE)", K.every((k) => Math.abs(g.econ.capRate[k] - E.CAP_BASE[k]) > 1e-6));
}

// ---- 2. a crunch, through the bidders' loans — run after five years of play
// (below), once every desk has books of its own to price off (lenders.ts)
function crunch() {
  const rec = bbls.map((b) => E.resolveRec(parcels, g, b))
    .filter((r) => r && r.class === "office" && r.bldgArea > 0 && !E.ownerOf(g, r.bbl))
    .sort((a, b) => b.bldgArea - a.bldgArea)[5];
  const firm = (g.rivals ?? []).find((r) => !r.stressMs && (!E.paramsOf(r).classes || E.paramsOf(r).classes.includes("office")) && r.targetLtv > 0.5);
  // A CRUNCH IS THE BANKS' OWN BOOKS (since step 5 a desk prices off its own
  // costs, pricing.ts): the window shuts, the street's appetite falls, and
  // each desk pays up for its money, books losses on its income loans and
  // rations — the shape of 2008-09, a point of funding and half a point of
  // loss. The buyers only read the quote.
  const at = (ci) => {
    const shut = ci < 1;
    const deskPx = Object.fromEntries(Object.entries(g.econ.deskPx ?? {}).map(([k, px]) => [k, shut
      ? { ...px, dFund: px.dFund + 1.0, dEl: { ...px.dEl, income: (px.dEl.income ?? 0) + 0.5 }, pull: Math.max(px.pull, 0.8 * 0.35) }
      : px]));
    const s = { ...g, bankApp: shut ? 0.65 : g.bankApp, econ: { ...g.econ, creditIdx: ci, deskPx } };
    const v = E.dealView(s, rec, rec.bbl, E.assetValue(rec, s.econ, E.initialCondition(rec)));
    const { max, uw } = E.maxPrice(s.econ, v, E.bidderOf(s, firm, rec), E.beliefSignals(s, firm));
    return { max, uw, a: v.debtA, rd: v.rd };
  };
  const open = at(1.1), shut = at(0.45);
  ok("a shut window writes a smaller advance", shut.a < open.a, `${open.a.toFixed(2)} -> ${shut.a.toFixed(2)}`);
  ok("...at a wider rate", shut.rd > open.rd, `${open.rd.toFixed(2)}% -> ${shut.rd.toFixed(2)}%`);
  ok("so the same firm pays less for the same building", shut.max < open.max * 0.97, `${(shut.max / open.max * 100).toFixed(1)}% of the open-window number`);
  ok("and nothing else moved: the equity target is the same", Math.abs(shut.uw.rE - open.uw.rE) < 1e-12);
}

// ---- 3. sellers
{
  const r = (g.rivals ?? []).find((x) => x.bbls.some((b) => E.resolveRec(parcels, g, b)?.class === "office"));
  const bbl = r.bbls.find((b) => E.resolveRec(parcels, g, b)?.class === "office");
  const rec = E.resolveRec(parcels, g, bbl);
  const mark = E.assetValue(rec, g.econ, E.initialCondition(rec));
  const owed = E.rowOn(g, r, bbl)?.balance ?? 0;
  const forced = E.sellerTerms(g, r, rec, bbl, mark, "forced");
  const duress = E.sellerTerms(g, r, rec, bbl, mark, "duress");
  const vol = E.sellerTerms(g, r, rec, bbl, mark, "voluntary");
  ok("a forced seller will not sell under the loan it must clear", forced.reserve >= owed - 1000, `reserve ${Math.round(forced.reserve)} vs loan ${Math.round(owed)}`);
  ok("a firm in arrears takes the best bid in the room", duress.reserve === 0);
  ok("a voluntary seller wants at least its value in use", vol.reserve >= vol.inUse - 1000 && vol.ask >= vol.reserve);
}

// ---- 4. in play
{
  const named = new Set((g.rivals ?? []).map((r) => r.name));
  let closedRounds = 0, namedBuyers = 0, trades = 0;
  for (let m = 0; m < 60; m++) {
    g = E.advanceQuarter(g, parcels, bbls, adjacency);
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
    for (const r of g.rivals ?? []) named.add(r.name);
    for (const p of g.capTape ?? []) if (p.m === g.month && p.kind === "t") { trades++; if (p.nb !== undefined) closedRounds++; }
  }
  for (const c of g.comps ?? []) if (c.sf > 0 && named.has(c.buyer)) namedBuyers++;
  ok("buildings trade, and the tape's trades went through bid rounds", trades > 10 && closedRounds > 5, `${trades} trades, ${closedRounds} from rounds`);
  ok("buyers on the comps sheet are named firms", namedBuyers > 0);
  // THE IDENTITY: each class's cap IS the weighted median of its own window,
  // restated through the grid — recomputed here from the tape alone.
  let checked = 0, off = 0;
  for (const k of K) {
    const rd = g.econ.capRead?.[k];
    if (!rd?.win) continue;
    const b = g.econ.capFit[k];
    // read at the top of the month (tickEcon), before this month's deals printed
    const pts = g.capTape.filter((p) => p.k === k && p.m > g.month - rd.win && p.m < g.month)
      .map((p) => ({ v: p.c * Math.exp(-(b[0] * (p.x[0] - 0.5) + b[1] * (p.x[1] - 0.6) + b[2] * (p.x[2] - 0.5))), w: p.w }))
      .sort((x, y) => x.v - y.v);
    const tot = pts.reduce((a, p) => a + p.w, 0);
    let acc = 0, med = NaN;
    for (const p of pts) { acc += p.w; if (acc >= tot / 2) { med = p.v; break; } }
    checked++;
    if (Math.abs(med - g.econ.capRate[k]) > 0.01) off++;
  }
  ok("every class with evidence reads exactly the median of its prints", checked > 0 && off === 0, `${checked} classes checked`);
  const ev = (g.why?.ev ?? []).filter((e) => e.k === "market.cap");
  ok("the read is on the cause ledger, numbers first", ev.length > 0 && /cap \d+\.\d+%: /.test(ev[ev.length - 1].t), ev[ev.length - 1]?.t);
  const tr = (g.why?.ev ?? []).filter((e) => e.k === "market.trade");
  ok("and so is every trade", tr.length > 0 && / paid \$/.test(tr[tr.length - 1].t), tr[tr.length - 1]?.t);
  const lines = K.map((k) => E.capReadLine(g.econ, k)).filter(Boolean);
  ok("the screens get one plain line per class", lines.length === 4, lines[0]);
}

crunch();

console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
