// THOROUGH PLAYER-SURFACE PLAYTHROUGH — find bugs a session would hit.
//
// Not a balance bot. Walks the desks a principal actually uses: listings,
// off-market, close, refi, lease, staff, line, develop, list/delist, attention
// routing, and the numbers those desks print. Reports throws, NaNs, invariant
// breaks, quote/close mismatches, and action-contract lies.
//
//   pnpm engine && BW_SIZE=hamlet node test/playthrough.mjs
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

const MONTHS = Number(process.env.HORIZON ?? 48);
const SEED = Number(process.env.SEED ?? 20261);
const CASH0 = Number(process.env.CASH0 ?? 5_000_000);

const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);

let fails = 0;
const notes = [];
const fail = (msg) => { fails++; console.log(`FAIL  ${msg}`); };
const pass = (msg) => { console.log(`PASS  ${msg}`); };
const note = (msg) => { notes.push(msg); console.log(`NOTE  ${msg}`); };

function scanNaN(v, path, out, depth = 0) {
  if (depth > 12 || out.length > 40) return;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) out.push(`${path}=${v}`);
    return;
  }
  if (!v || typeof v !== "object") return;
  if (Array.isArray(v)) {
    for (let i = 0; i < Math.min(v.length, 80); i++) scanNaN(v[i], `${path}[${i}]`, out, depth + 1);
    return;
  }
  for (const [k, x] of Object.entries(v)) {
    if (k === "rng" || k === "streams" || k === "news" || k === "hist") continue;
    scanNaN(x, path ? `${path}.${k}` : k, out, depth + 1);
  }
}

function checkState(g, label, prev) {
  const nans = [];
  scanNaN(g, "g", nans);
  if (nans.length) fail(`${label}: NaN/Inf ${nans.slice(0, 8).join("; ")}`);
  try {
    const vs = E.checkInvariants(g, parcels, prev);
    for (const v of vs.slice(0, 6)) fail(`${label}: invariant ${v.code} @ ${v.where} — ${v.detail}`);
    if (vs.length > 6) fail(`${label}: +${vs.length - 6} more invariant(s)`);
  } catch (e) {
    fail(`${label}: checkInvariants threw ${e.message}`);
  }
  try {
    const nw = E.netWorth(g, parcels);
    if (!Number.isFinite(nw)) fail(`${label}: netWorth is ${nw}`);
  } catch (e) {
    fail(`${label}: netWorth threw ${e.message}`);
  }
}

function deskNumbers(g, bbl) {
  const rec = E.resolveRec(parcels, g, bbl);
  if (!rec) return;
  const cond = g.holdings[bbl]?.condition ?? E.initialCondition(rec);
  const val = E.assetValue(rec, g.econ, cond);
  if (!Number.isFinite(val)) throw new Error(`assetValue ${val}`);
  const land = E.landPsfNow(rec, g.econ);
  if (!Number.isFinite(land)) throw new Error(`landPsfNow ${land}`);
  const rent = rec.class !== "land" && rec.bldgArea
    ? E.marketRentPsfYr(rec, g.econ, cond)
    : 0;
  if (!Number.isFinite(rent)) throw new Error(`marketRentPsfYr ${rent}`);
  if (rec.class !== "land" && rec.bldgArea) {
    const ip = E.inPlace(rec, g, bbl, val);
    if (!Number.isFinite(ip.noi) || !Number.isFinite(ip.occ)) {
      throw new Error(`inPlace noi=${ip.noi} occ=${ip.occ}`);
    }
  }
  const h = g.holdings[bbl];
  if (h) {
    const hv = E.holdingValue(rec, g.econ, h, g.month);
    if (!Number.isFinite(hv)) throw new Error(`holdingValue ${hv}`);
    const noi = E.ownedHoldingNoiYr(g, parcels, h);
    if (!Number.isFinite(noi)) throw new Error(`ownedHoldingNoiYr ${noi}`);
  }
}

function walkListings(g) {
  for (const L of g.listings ?? []) {
    deskNumbers(g, L.bbl);
    for (const prod of ["cash", "savings", "harbor", "cordage", "land"]) {
      const q = E.buyQuote(g, parcels, L.bbl, L.ask, prod, 1);
      if (!Number.isFinite(q.equity) || !Number.isFinite(q.principal) || !Number.isFinite(q.ratePct)) {
        throw new Error(`buyQuote ${prod} equity=${q.equity} principal=${q.principal} rate=${q.ratePct}`);
      }
    }
  }
}

function walkHoldings(g) {
  for (const h of Object.values(g.holdings)) {
    deskNumbers(g, h.bbl);
    if (h.loan) {
      const d = E.dscr(E.resolveRec(parcels, g, h.bbl), g, h);
      const l = E.ltv(E.resolveRec(parcels, g, h.bbl), g, h);
      if (d != null && !Number.isFinite(d)) throw new Error(`dscr ${d}`);
      if (l != null && !Number.isFinite(l)) throw new Error(`ltv ${l}`);
    }
    const rec = E.resolveRec(parcels, g, h.bbl);
    if (rec && rec.class === "land") {
      const plan = E.planDevelopment(g, parcels, h.bbl, "office", 8, 0.6);
      if (plan) {
        for (const k of ["sf", "costTotal", "equity", "yieldOnCost", "requiredYield", "months"]) {
          if (!Number.isFinite(plan[k])) throw new Error(`planDevelopment.${k}=${plan[k]}`);
        }
      }
    }
  }
}

function walkAttention(g) {
  for (const item of E.attentionItems(g, parcels)) {
    const route = E.routeAttention(item.key, g);
    if (!route.page && !route.auction) fail(`orphan attention ${item.key} (${item.label})`);
  }
}

console.log(`\nPLAYTHROUGH  seed=${SEED}  cash=${CASH0}  months=${MONTHS}  lots=${bbls.length}\n`);

let g = E.firstListings(E.newGame(SEED, parcels, CASH0), parcels, bbls);
checkState(g, "open");
pass(`opened with ${g.listings.length} listings, cash ${Math.round(g.cash)}`);

try { walkListings(g); pass("opening tape quotes are finite"); }
catch (e) { fail(`opening tape: ${e.message}`); }

try { walkAttention(g); }
catch (e) { fail(`opening attention: ${e.message}`); }

// ---- buy at ask on the cheapest financeable building ----------------------
{
  const ranked = [...(g.listings ?? [])]
    .map((L) => {
      const rec = E.resolveRec(parcels, g, L.bbl);
      const q = E.buyQuote(g, parcels, L.bbl, L.ask, "savings", 1);
      const cashQ = E.buyQuote(g, parcels, L.bbl, L.ask, "cash", 1);
      return { L, rec, q, cashQ };
    })
    .filter((x) => x.rec && x.rec.class !== "land" && x.rec.bldgArea > 0 && x.L.ask > 200_000)
    .sort((a, b) => a.L.ask - b.L.ask);

  let bought = 0;
  for (const x of ranked) {
    if (bought >= 2) break;
    const prod = x.q.principal > 0 && g.cash >= x.q.equity ? "savings"
      : g.cash >= x.cashQ.equity ? "cash" : null;
    if (!prod) continue;
    const quote = E.buyQuote(g, parcels, x.L.bbl, x.L.ask, prod, 1);
    const cash0 = g.cash;
    const r = E.buyListing(g, parcels, x.L.bbl, prod, 1, x.L.ask);
    if (r.err) { note(`buy ${x.rec.address} err: ${r.err}`); continue; }
    if (r.refused) {
      fail(`pay-ask returned refused on ${x.rec.address} — full ask must close`);
      g = r.s;
      continue;
    }
    if (!r.s.holdings[x.L.bbl]) {
      fail(`pay-ask on ${x.rec.address} wrote no deed (msg=${r.msg})`);
      g = r.s;
      continue;
    }
    const h = r.s.holdings[x.L.bbl];
    if (prod !== "cash") {
      if (!h.loan) fail(`levered close on ${x.rec.address} wrote no loan`);
      else if (h.loan.balance !== quote.principal) {
        fail(`quote/close principal ${quote.principal} vs written ${h.loan.balance} @ ${x.rec.address}`);
      }
    }
    const spent = cash0 - r.s.cash;
    if (Math.abs(spent - quote.equity) > 2) {
      fail(`quote/close equity ${quote.equity} vs cash out ${spent} @ ${x.rec.address}`);
    }
    g = r.s;
    bought++;
    pass(`bought ${x.rec.address} at ${Math.round(x.L.ask)} via ${prod}`);
    checkState(g, `after buy ${x.L.bbl}`);
  }
  if (bought === 0) fail("could not close any listing at ask with $5M");
}

// ---- off-market approach on a handful of unlisted buildings ----------------
{
  let named = 0, blind = 0, refused = 0, approached = 0;
  const cands = bbls.filter((b) => {
    const rec = E.resolveRec(parcels, g, b);
    return rec && rec.class !== "land" && rec.bldgArea > 0 && !g.holdings[b]
      && !(g.listings ?? []).some((l) => l.bbl === b);
  }).slice(0, 25);
  for (const bbl of cands) {
    if (g.approaches[bbl]) continue;
    const r = E.approachOwner(g, parcels, adjacency, bbl);
    if (r.err) continue;
    g = r.s;
    approached++;
    const ap = g.approaches[bbl];
    if (!ap) { fail("approach wrote no record"); continue; }
    if (r.refused || ap.refused) { refused++; continue; }
    if (ap.ask !== undefined) named++;
    else blind++;
    // Blind bid at a number near appraisal so we exercise the contract path.
    if (ap.ask === undefined && ap.reserve !== undefined) {
      const rec = E.resolveRec(parcels, g, bbl);
      const val = E.assetValue(rec, g.econ, E.initialCondition(rec));
      const bid = E.submitBlindBid(g, parcels, bbl, Math.round(val * 1.05));
      if (!bid.err) g = bid.s;
    } else if (ap.ask) {
      const low = E.buyOffMarket(g, parcels, bbl, "cash", 1, Math.round(ap.ask * 0.7));
      if (!low.err) g = low.s;
    }
  }
  pass(`approached ${approached} (named ${named}, blind ${blind}, refused ${refused})`);
  checkState(g, "after approaches");
}

// ---- staff: refresh pool and hire if anyone is on it ----------------------
{
  const next = JSON.parse(JSON.stringify(g));
  E.refreshPool(next, true);
  g = next;
  const pool = g.hirePool?.list ?? [];
  if (pool.length === 0) note("hire pool empty after forced refresh");
  else {
    const r = E.hire(g, pool[0].id);
    if (r.err) note(`hire: ${r.err}`);
    else {
      g = r.s;
      pass(`hired ${pool[0].name ?? pool[0].id}`);
    }
  }
  checkState(g, "after hire");
}

// ---- line draw / repay -----------------------------------------------------
{
  try {
    const lim = E.locLimit(g, parcels);
    if (!Number.isFinite(lim)) fail(`locLimit ${lim}`);
    if (lim > 50_000) {
      const micro = E.drawLoc(g, parcels, 4_000);
      if (!micro.err) {
        const t = micro.s.news[0]?.text ?? "";
        if (/\$0\.00M/.test(t)) fail(`drawLoc printed $0.00M for $4k: ${t}`);
        g = micro.s;
      }
      const d = E.drawLoc(g, parcels, Math.min(50_000, Math.floor(lim / 4)));
      if (d.err) note(`drawLoc: ${d.err}`);
      else {
        g = d.s;
        const p = E.repayLoc(g, 10_000);
        if (!p.err) {
          const t = p.s.news[0]?.text ?? "";
          if (/\$0\.00M/.test(t)) fail(`repayLoc printed $0.00M for $10k: ${t}`);
          g = p.s;
        }
        pass("line draw/repay");
      }
    }
  } catch (e) { fail(`line: ${e.message}`); }
  checkState(g, "after loc");
}

// ---- refi / list / delist on first holding --------------------------------
{
  const bbl = Object.keys(g.holdings)[0];
  if (bbl) {
    try {
      const quotes = E.PRODUCTS
        ? E.PRODUCTS.filter((p) => !p.mezz).map((p) => ({ id: p.id, q: E.refinanceQuote?.(g, parcels, bbl, p.id) }))
        : [];
      void quotes;
      const r = E.refinance(g, parcels, bbl, "savings", 1);
      if (r.err) note(`refi: ${r.err}`);
      else { g = r.s; pass("refinanced first holding"); }
    } catch (e) { fail(`refi threw: ${e.message}`); }

    try {
      const rec = E.resolveRec(parcels, g, bbl);
      const h = g.holdings[bbl];
      const ask = rec && h ? E.holdingValue(rec, g.econ, h, g.month) : 0;
      const listed = E.listForSale(g, parcels, bbl, ask);
      if (listed.err) note(`list: ${listed.err}`);
      else {
        g = listed.s;
        g = E.delist(g, bbl);
        pass("list then delist");
      }
    } catch (e) { fail(`list/delist threw: ${e.message}`); }

    try {
      const reno = E.startRenovation(g, parcels, bbl);
      if (reno.err) note(`renovate: ${reno.err}`);
      else { g = reno.s; pass("started renovation"); }
    } catch (e) { fail(`renovate threw: ${e.message}`); }

    try {
      const tax = E.taxAppealQuote(g, parcels, bbl);
      if (tax && !Number.isFinite(tax.fee)) fail(`taxAppealQuote.fee ${tax.fee}`);
    } catch (e) { fail(`taxAppealQuote threw: ${e.message}`); }
  }
  checkState(g, "after holding desks");
}

// ---- develop a vacant lot if one is owned or cheap on the tape ------------
{
  let landBbl = Object.keys(g.holdings).find((b) => {
    const rec = E.resolveRec(parcels, g, b);
    return rec && rec.class === "land";
  });
  if (!landBbl) {
    const landL = (g.listings ?? []).find((L) => {
      const rec = E.resolveRec(parcels, g, L.bbl);
      const q = E.buyQuote(g, parcels, L.bbl, L.ask, "cash", 1);
      return rec && rec.class === "land" && q.equity <= g.cash * 0.4;
    });
    if (landL) {
      const r = E.buyListing(g, parcels, landL.bbl, "cash", 1, landL.ask);
      if (!r.err && !r.refused && r.s.holdings[landL.bbl]) {
        g = r.s;
        landBbl = landL.bbl;
        pass(`bought land ${parcels[landL.bbl]?.address}`);
      }
    }
  }
  if (landBbl) {
    try {
      const rec = E.resolveRec(parcels, g, landBbl);
      const fl = Math.min(6, E.maxFloorsFor(rec, 0.6, "office"));
      const plan = E.planDevelopment(g, parcels, landBbl, "office", fl, 0.6);
      if (!plan) note("planDevelopment returned null on owned land");
      else {
        const start = E.startDevelopment(g, parcels, landBbl, "office", fl, 0.6);
        if (start.err) note(`startDevelopment: ${start.err}`);
        else {
          g = start.s;
          pass(`broke ground ${parcels[landBbl]?.address}`);
        }
      }
    } catch (e) { fail(`develop threw: ${e.message}`); }
  } else {
    note("no land in book or affordable on tape");
  }
  checkState(g, "after develop");
}

// ---- assemble a neighbour if one is owned ---------------------------------
{
  const owned = Object.keys(g.holdings);
  for (const bbl of owned) {
    try {
      if (E.hasOwnedSiteNeighbor(g, adjacency, bbl)) {
        const r = E.assembleLots(g, parcels, adjacency, bbl);
        if (r.err) note(`assemble: ${r.err}`);
        else { g = r.s; pass(`assembled at ${parcels[bbl]?.address}`); }
        break;
      }
    } catch (e) { fail(`assemble threw: ${e.message}`); }
  }
}

// ---- play months: answer the desk, buy when cheap, keep invariants --------
const stat = { lois: 0, sold: 0, bought: 0, throws: 0 };
for (let m = 0; m < MONTHS; m++) {
  const before = g;
  try {
    g = E.advanceMonth(g, parcels, bbls, adjacency);
  } catch (e) {
    fail(`advanceMonth threw at month ${before.month}: ${e.message}`);
    stat.throws++;
    break;
  }
  if (g.gameOver) {
    note(`gameOver at month ${g.month}: ${g.gameOver}`);
    g = { ...g, gameOver: null, cash: Math.max(g.cash, CASH0) };
  }
  checkState(g, `m${g.month}`, before);

  try { walkHoldings(g); }
  catch (e) { fail(`m${g.month} holdings: ${e.message}`); }

  try { walkAttention(g); }
  catch (e) { fail(`m${g.month} attention: ${e.message}`); }

  for (const loi of [...g.lois]) {
    try {
      const rec = E.resolveRec(parcels, g, loi.bbl);
      if (!rec || !g.holdings[loi.bbl]) continue;
      const market = E.managedRentPsfYr(rec, g.econ, g.holdings[loi.bbl], loi.use);
      const action = loi.rentPsf >= market * 0.92 ? "accept" : (loi.stage === "countered" ? "pass" : "counter");
      const r = action === "counter"
        ? E.respondLOI(g, parcels, loi.id, "counter", false, { rentPsf: +(market * 0.99).toFixed(2) })
        : E.respondLOI(g, parcels, loi.id, action);
      if (!r.err) {
        g = r.s;
        if (action === "accept") stat.lois++;
      }
    } catch (e) { fail(`m${g.month} LOI ${loi.id}: ${e.message}`); }
  }

  for (const h of Object.values(g.holdings)) {
    if (!h.sale?.offer) continue;
    try {
      const rec = E.resolveRec(parcels, g, h.bbl);
      if (!rec) continue;
      const v = E.holdingValue(rec, g.econ, h, g.month);
      if (h.sale.offer.price >= v * 1.08) {
        const r = E.acceptSaleOffer(g, parcels, h.bbl);
        if (!r.err) { g = r.s; stat.sold++; }
      }
    } catch (e) { fail(`m${g.month} sale offer: ${e.message}`); }
  }

  if (m % 6 === 2 && Object.keys(g.holdings).length < 6) {
    for (const L of g.listings ?? []) {
      const rec = E.resolveRec(parcels, g, L.bbl);
      if (!rec || rec.class === "land" || !rec.bldgArea) continue;
      const q = E.buyQuote(g, parcels, L.bbl, L.ask, "savings", 1);
      if (q.principal <= 0 || g.cash < q.equity + 250_000) continue;
      const r = E.buyListing(g, parcels, L.bbl, "savings", 1, L.ask);
      if (r.err || r.refused) continue;
      if (r.s.holdings[L.bbl]) { g = r.s; stat.bought++; }
      break;
    }
  }

  if (m % 12 === 0) {
    try { walkListings(g); }
    catch (e) { fail(`m${g.month} tape: ${e.message}`); }
  }
}

pass(`played ${g.month} months · holdings ${Object.keys(g.holdings).length} · leases ${stat.lois} · extra buys ${stat.bought} · sales ${stat.sold}`);

// ---- UI-facing format of live numbers -------------------------------------
{
  const samples = [
    ["cash", g.cash],
    ["nw", E.netWorth(g, parcels)],
    ["index", g.econ.indexRate],
    ["cpi", g.econ.cpi],
    ["office rent", g.econ.rentIdx?.office],
    ["office vac", g.econ.cityVac?.office],
    ["cap office", g.econ.capRate?.office],
  ];
  for (const [k, v] of samples) {
    if (!Number.isFinite(v)) fail(`HUD ${k} is ${v}`);
  }
  if (E.monthCashBit(4_999) !== "" || E.monthCashBit(10_000) !== " · +$0.01M") {
    fail(`monthCashBit contract ${JSON.stringify({ a: E.monthCashBit(4999), b: E.monthCashBit(10000) })}`);
  }
}

console.log("");
if (notes.length) {
  console.log("Notes:");
  for (const n of notes) console.log(`  - ${n}`);
  console.log("");
}
console.log(fails === 0 ? "playthrough pass" : `${fails} playthrough failure(s)`);
process.exit(fails === 0 ? 0 : 1);
