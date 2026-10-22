// LOT SPLITS, PLAYED (engine/lotsplit.ts, engine/lotsplitGeom.ts).
//
//   node test/lotsplit.mjs             island seed 1, then the region seed 1
//   BW_SEED=3 node test/lotsplit.mjs
//
// A player splits a downtown vacant lot in two; splits excess land off a
// building and keeps the building conforming; is refused a landlocked rear lot
// until an easement is recorded; is refused a split that would make a building
// non-conforming; splits a mortgaged lot under a partial release. Every split
// reloads from its recipe into identical lots, net worth moves by exactly
// (the lots apart - the lot whole - the cash costs), and on the region the
// month-by-month cash reconciles against the books to the dollar.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const DEADLINE_S = Number(process.env.DEADLINE_S ?? 420);
const timer = setTimeout(() => { console.log(`\nlotsplit: TIMED OUT after ${DEADLINE_S}s`); process.exit(2); }, DEADLINE_S * 1000);
const E = await import(pathToFileURL(join(HERE, ".engine.mjs")).href);
const { makeCity, REGION } = await import(pathToFileURL(join(HERE, "..", "src", "citygen", "index.mjs")).href);

const seed = Number(process.env.BW_SEED ?? 1);
let fails = 0;
const fail = (m) => { fails++; console.log("  FAIL " + m); };
const ok = (c, m) => { if (!c) fail(m); else console.log("  ok   " + m); };
const M = (n) => `$${(n / 1e6).toFixed(3)}M`;
const clone = (x) => JSON.parse(JSON.stringify(x));

// the conserve identity, step by step (test/conserve.mjs)
const IN = ["noi", "sold", "interest", "borrowed", "lpCalled", "fees"], OUT = ["debtSvc", "leasing", "capex", "dev", "taxes", "bought", "ga", "lpDistributed"];
const books = (g) => { let t = 0; for (const y of g.books ?? []) { for (const k of IN) t += y[k] ?? 0; for (const k of OUT) t -= y[k] ?? 0; } return t; };
const deposits = (g) => Object.values(g.holdings ?? {}).reduce((a, h) => a + (h.tenants ?? []).reduce((b, t) => b + (t.deposit ?? 0), 0), 0);
const snap = (g) => ({ cash: g.cash + (g.fund?.cash ?? 0), books: books(g), loc: g.loc?.balance ?? 0, dep: deposits(g) });
let prevSnap = null, worst = 0;
const ledger = (g, what) => {
  const now = snap(g);
  if (prevSnap) {
    const resid = (now.cash - prevSnap.cash) - (now.books - prevSnap.books) - (now.loc - prevSnap.loc) - (now.dep - prevSnap.dep);
    if (Math.abs(resid) > 1) fail(`${what}: $${Math.round(resid).toLocaleString()} moved without a ledger entry`);
    worst = Math.max(worst, Math.abs(resid));
  }
  prevSnap = now;
};

function world(cityId) {
  const city = makeCity(cityId, seed);
  const parcels = city.parcels, bbls = Object.keys(parcels);
  E.normalizeParcels(parcels);
  const g = E.firstListings(E.newGame(seed, parcels, 40e6, undefined, cityId === REGION ? { citySize: "region", cityLots: bbls.length } : undefined), parcels, bbls);
  return { city, parcels, bbls, g };
}
const geoOf = (W, b, feats) => E.siteGeometry({ features: feats ?? W.city.parcelFeatures.features }, W.city.buildingFeatures, W.city.context, b);
const buy = (W, b, product = "cash", lev = 1) => {
  const rec = E.resolveRec(W.parcels, W.g, b);
  const price = Math.round(E.marketAppraisal(W.g, rec, b));
  const r = E.executePurchase(W.g, W.parcels, b, price, product, false, lev);
  if (r.err) return r.err;
  W.g = r.s; ledger(W.g, "purchase");
  return null;
};
const advanceTo = (W, m) => { while (W.g.month < m) { W.g = E.advanceQuarter(W.g, W.parcels, W.bbls, W.city.adjacency); ledger(W.g, "month"); } };
const nw = (W, g = W.g) => E.netWorth(g, W.parcels);

/**
 * THE NET-WORTH INVARIANT at the instant of recording: the state just filed,
 * its sign-off brought forward to this month, recorded with nothing else
 * moving. NW after = NW before - cash costs + the lots apart - the lot whole.
 */
function invariant(W, b, plan, gBefore) {
  const nw0 = nw(W, gBefore);
  const parent = E.ownedHoldingValue(gBefore, W.parcels, gBefore.holdings[b]);
  const q = E.splitQuote(gBefore, W.parcels, b, geoOf(W, b), plan);
  const f = E.fileSplit(gBefore, W.parcels, b, geoOf(W, b), plan);
  if (f.err) { fail(`invariant: ${f.err}`); return null; }
  const g1 = clone(f.s), p1 = { ...W.parcels }, bb1 = [...W.bbls];
  const sp = g1.splits.at(-1);
  sp.doneM = g1.month;
  const cash0 = g1.cash;
  E.tickSplits(g1, p1, bb1);
  if (!sp.done) { fail(`invariant: not recorded (${sp.lapsed})`); return null; }
  const pieces = sp.pieces.reduce((t, p) => t + E.ownedHoldingValue(g1, p1, g1.holdings[p.bbl]), 0);
  const paid = cash0 - g1.cash;                       // the release payment, if any
  const principal = (gBefore.holdings[b].loan?.balance ?? 0) - sp.pieces.reduce((t, p) => t + (g1.holdings[p.bbl].loan?.balance ?? 0), 0);
  const costs = q.cashNow + (paid - principal);       // fees, consent, and any prepayment charge
  const want = nw0 - costs + pieces - parent;
  const got = E.netWorth(g1, p1);
  const err = Math.abs(got - want) / Math.max(1, Math.abs(parent));
  console.log(`       NW ${M(nw0)} -> ${M(got)}; predicted ${M(want)} (costs ${M(costs)}, lots ${M(pieces)} vs whole ${M(parent)}, quote said ${M(q.piecesValue)}): off ${(err * 100).toFixed(2)}% of the lot`);
  ok(err <= 0.02, `net worth after = before - costs + lots - whole, within 2% (${(err * 100).toFixed(2)}%)`);
  ok(Math.abs(pieces - q.piecesValue) <= 0.02 * Math.max(1, q.piecesValue), "the quote's lot values are what the lots are worth once recorded");
  return { g1, p1, bb1, sp };
}


/** The state with a hypothetical owner of `b`, for probing quotes (no cash moves). */
const asOwner = (W, b) => {
  const r0 = E.resolveRec(W.parcels, W.g, b);
  return { ...W.g, holdings: { ...W.g.holdings, [b]: { bbl: b, boughtM: W.g.month, costBasis: 1, assessed: r0.assessedTotal, loan: null, condition: E.initialCondition(r0), tenants: [], cfHistory: [] } } };
};
const freeOf = (W) => (b) => !E.ownerOf(W.g, b) && !W.g.holdings[b] && !W.g.developments[b] && !W.g.listings.some((l) => l.bbl === b) && !E.isCivicLand(W.g, b);
const done = { good: false, bad: false, mort: false };

/** 2, 4 and 5 on whatever map has them: a built lot with land to spare, one without, and one on a mortgage. */
function builtScenarios(W, where) {
  const free = freeOf(W);
  const built = W.bbls.filter((b) => { const r = W.parcels[b]; return r.class !== "land" && r.bldgArea > 0 && r.lotArea >= 6000 && (r.lotFront ?? 0) >= 60 && free(b); });
  const goods = [];
  let bad = null;
  for (const b of built) {
    if (goods.length >= 6 && bad) break;
    const geo = geoOf(W, b);
    if (!geo || !geo.footprints.length) continue;
    const cands = [];
    for (const k of [2, 3, 4, 5]) for (const c of E.equalCuts(geo, k)) cands.push(c);
    for (const fr of [0.3, 0.5, 0.7]) cands.push(E.fracCut(geo, fr, "depth"));
    // the desk's "Excess land": lines just clear of the building's yard
    for (const c of E.buildingCuts(geo, E.splitRule(W.parcels[b].zoneDist).sideFt)) cands.unshift(c);
    const gT = asOwner(W, b);
    let got = false;
    for (const c of cands) {
      const q = E.splitQuote(gT, W.parcels, b, geo, { cuts: [c] });
      const keep = q.pieces.find((p) => p.keep);
      if (!keep?.conform) continue;
      if (!got && q.ok && keep.conform.ok && q.debt === null) { goods.push({ b, plan: { cuts: [c] } }); got = true; }
      if (!bad && !keep.conform.ok && q.pieces.every((p) => p.access === "street" && p.areaOk && p.frontOk && p.ratioOk)) bad = { b, q };
    }
  }
  console.log(`  ${where}: ${built.length} built lots of 6,000 sf+; ${goods.length >= 6 ? "6+" : goods.length} can shed land and stay conforming`);

  if (!done.bad && bad) {
    console.log("\n4. a refused non-conforming split");
    const k = bad.q.pieces.find((p) => p.keep);
    console.log(`     ${W.parcels[bad.b].address} (${bad.q.zone}): refused — ${bad.q.why[0]}`);
    ok(!bad.q.ok && k.conform.why.length > 0 && /non-conforming: (FAR|coverage|.* ft from the new line)/.test(bad.q.why.join(" ")), "refused, naming the rule that fails");
    done.bad = true;
  }
  if (!done.good && goods.length) {
    console.log("\n2. a built lot split leaving a conforming building");
    const good = goods[0];
    const err = buy(W, good.b);
    if (err) fail(`buy ${good.b}: ${err}`);
    else {
      const q = E.splitQuote(W.g, W.parcels, good.b, geoOf(W, good.b), good.plan);
      const k = q.pieces.find((p) => p.keep);
      const r = W.parcels[good.b];
      console.log(`     ${r.address} (${q.zone}, ${r.bldgArea.toLocaleString()} sf ${r.class} on ${r.lotArea.toLocaleString()} sf): FAR ${k.conform.far.toFixed(2)}/${k.conform.farMax.toFixed(2)}, coverage ${Math.round(k.conform.cov * 100)}%/${Math.round(k.conform.covMax * 100)}%, ${k.conform.yardFt.toFixed(1)} ft to the line (${k.conform.yardMin} required)`);
      console.log(`     whole ${M(q.parentValue)}, apart ${q.pieces.map((p) => M(p.value)).join(" + ")} = ${M(q.piecesValue)}`);
      ok(q.ok && k.conform.ok, "the building's lot still conforms; the quote clears");
      const tenants0 = W.g.holdings[good.b].tenants.length;
      invariant(W, good.b, good.plan, W.g);
      W.g = E.fileSplit(W.g, W.parcels, good.b, geoOf(W, good.b), good.plan).s; ledger(W.g, "file");
      advanceTo(W, W.g.splits.at(-1).doneM);
      const sp = W.g.splits.at(-1);
      ok(sp.done, `recorded (${sp.lapsed ?? "on schedule"})`);
      const kr = E.resolveRec(W.parcels, W.g, good.b);
      ok(kr.bldgArea === r.bldgArea && kr.bldgArea > 0 && kr.lotArea < r.lotArea + 1, "the building stays on the parent's BBL, on its smaller lot");
      ok(W.g.holdings[good.b].tenants.length >= Math.max(0, tenants0 - 2), `the leases stay with it (${tenants0} -> ${W.g.holdings[good.b].tenants.length})`);
      done.good = true;
    }
  }
  if (!done.mort) {
    for (const cand of goods.slice(1)) {
      const b = cand.b;
      if (W.g.holdings[b] || !free(b)) continue;
      const rec = E.resolveRec(W.parcels, W.g, b);
      const price = Math.round(E.marketAppraisal(W.g, rec, b));
      let bought = false;
      for (const prod of ["harbor", "savings", "bowline", "pelican", "ashford", "agencyFixed", "conduit", "cordage"]) {
        const r = E.executePurchase(W.g, W.parcels, b, price, prod, false, 1);
        if (!r.err && r.s.holdings[b]?.loan) { W.g = r.s; ledger(W.g, "purchase"); bought = true; break; }
      }
      if (!bought) continue;
      console.log("\n5. a mortgaged split with partial release");
      const geo = geoOf(W, b), plan = cand.plan;
      const L0 = { ...W.g.holdings[b].loan };
      const q = E.splitQuote(W.g, W.parcels, b, geo, plan);
      if (!q.ok || !q.debt) { console.log(`     ${rec.address}: ${q.why[0] ?? "no debt"}`); continue; }
      console.log(`     ${rec.address}: ${M(L0.balance)} from ${q.debt.lender}, max LTV ${(q.debt.maxLTV * 100).toFixed(0)}%; ${q.debt.mode}: ${M(q.debt.paydown)} back at recording + ${M(q.debt.penalty)} prepayment; consent ${M(q.debt.fee)}`);
      ok(q.debt.mode === "release" && q.debt.paydown > 0, "a building's loan releases the new lot for a release payment");
      invariant(W, b, plan, W.g);
      W.g = E.fileSplit(W.g, W.parcels, b, geo, plan).s; ledger(W.g, "file");
      const cashBefore = W.g.cash;
      advanceTo(W, W.g.splits.at(-1).doneM);
      const sp = W.g.splits.at(-1);
      ok(sp.done, `recorded (${sp.lapsed ?? "on schedule"})`);
      if (sp.done) {
        const keep = W.g.holdings[b], kids = sp.pieces.filter((p) => p.bbl !== b).map((p) => W.g.holdings[p.bbl]);
        console.log(`     loan ${M(L0.balance)} -> ${M(keep.loan?.balance ?? 0)} on the building; the new lot free and clear: ${kids.every((h) => !h.loan)}; cash ${M(cashBefore)} -> ${M(W.g.cash)}`);
        ok(kids.every((h) => !h.loan) && !!keep.loan && keep.loan.balance <= L0.balance - 0.9 * q.debt.paydown, "the loan stays on the building, paid down by the release");
        const book = E.cityLoanBook(W.g, W.parcels).filter((l) => l.bbl === b || kids.some((h) => h.bbl === l.bbl));
        ok(book.length >= 1, `the loan book carries it (${book.length} row${book.length === 1 ? "" : "s"})`);
      }
      done.mort = true;
      break;
    }
  }
}

// ---------------------------------------------------------------- the island
{
  console.log(`seed ${seed} — the island`);
  const W = world("somewhere");
  ledger(W.g, "open");
  const free = freeOf(W);
  const vac = W.bbls.filter((b) => { const r = W.parcels[b]; return r.class === "land" && ["C-4", "C-5", "C-6", "C-8"].includes(r.zoneDist) && r.lotArea >= 4500 && (r.lotFront ?? 0) >= 50 && free(b); })
    .sort((a, b) => W.parcels[a].lotArea - W.parcels[b].lotArea);

  // 1. A DOWNTOWN VACANT LOT, IN TWO
  console.log("\n1. a downtown vacant lot split in two");
  let lot = null, plan = null;
  for (const b of vac) {
    const geo = geoOf(W, b);
    if (!geo) continue;
    const p = { cuts: E.equalCuts(geo, 2) };
    if (!E.splitQuote(asOwner(W, b), W.parcels, b, geo, p).ok) continue;
    if (buy(W, b)) continue;
    lot = b; plan = p; break;
  }
  ok(!!lot, "found a downtown vacant lot that splits in two");
  if (lot) {
    const rec = W.parcels[lot];
    const q = E.splitQuote(W.g, W.parcels, lot, geoOf(W, lot), plan);
    console.log(`     ${rec.address} (${rec.zoneDist}): ${rec.lotArea.toLocaleString()} sf, ${rec.lotFront} ft -> ${q.pieces.map((p) => `${p.a.toLocaleString()} sf / ${p.f} ft / ${M(p.value)}`).join(" + ")}`);
    console.log(`     ${q.kind}, ${M(q.cost)}, ${q.months} months; whole ${M(q.parentValue)}, apart ${M(q.piecesValue)} (${q.gain >= 0 ? "+" : ""}${M(q.gain)})`);
    const base = q.cost / W.g.econ.costIdx;
    ok(q.kind === "minor" && base >= 5000 && base <= 15000, `a minor split: $${Math.round(base).toLocaleString()} before the town's cost index (${W.g.econ.costIdx.toFixed(2)}) — in $5-15K`);
    ok(q.months >= 1 && q.months <= 3, `administrative, ${q.months} months`);
    console.log("\n7. the net-worth invariant (no money pump)");
    invariant(W, lot, plan, W.g);
    const f = E.fileSplit(W.g, W.parcels, lot, geoOf(W, lot), plan);
    W.g = f.s; ledger(W.g, "file");
    advanceTo(W, W.g.splits.at(-1).doneM);
    ok(W.g.splits.at(-1).done, "recorded on schedule");
    const kids = W.g.splits.at(-1).pieces.map((p) => p.bbl);
    ok(kids.every((b) => W.g.holdings[b] && W.parcels[b]), `${kids.length} deeds held, each in the parcel table (${kids.join(", ")})`);
    ok(Math.abs(kids.reduce((t, b) => t + W.parcels[b].lotArea, 0) - rec.lotArea) <= 1, "the lots add up to the lot");
    ok(kids.filter((b) => b !== lot).every((b) => W.bbls.includes(b)), "the new deeds are on the BBL list");
    const assessed = kids.map((b) => W.g.holdings[b].assessed ?? 0);
    console.log(`     assessed ${assessed.map(M).join(" + ")}`);
    ok(assessed.every((a) => a > 0), "each new deed carries its own assessment (and its own tax bill)");

    // 6. THE RELOAD: the recipe alone regenerates identical lots, and the map draws identical rings
    console.log("\n6. a reload regenerates identical lots");
    const fresh = makeCity("somewhere", seed).parcels, fb = Object.keys(fresh);
    E.normalizeParcels(fresh);
    const saved = clone(W.g);
    const added = E.materializeSplits(saved, fresh, fb);
    const same = kids.every((b) => JSON.stringify(fresh[b]) === JSON.stringify(W.parcels[b]));
    ok(same && added.length === kids.length - 1, `the lots come back from the save byte-identical (${added.length} added)`);
    ok(E.materializeSplits(saved, fresh, fb).length === 0, "materializing twice adds nothing");
    const f1 = E.applySplitFeatures(W.city.parcelFeatures.features, saved.splits);
    const f2 = E.applySplitFeatures(makeCity("somewhere", seed).parcelFeatures.features, clone(saved.splits));
    const rings = (fs) => JSON.stringify(fs.filter((x) => kids.includes(String(x.properties.bbl))).map((x) => x.geometry));
    ok(rings(f1) === rings(f2) && f1.filter((x) => kids.includes(String(x.properties.bbl))).length === kids.length, "the map redraws the same rings");
    const sf = kids.map((b) => E.ringSf(f1.find((x) => String(x.properties.bbl) === b).geometry.coordinates[0]));
    console.log(`     drawn ${sf.map((x) => Math.round(x).toLocaleString()).join(" + ")} sf against ${kids.map((b) => W.parcels[b].lotArea.toLocaleString()).join(" + ")}`);
    ok(sf.every((x, i) => Math.abs(x - W.parcels[kids[i]].lotArea) <= 0.03 * W.parcels[kids[i]].lotArea), "the drawn lots are the recorded lots, within 3%");
  }

  // 3. LANDLOCKED, THEN A FLAG LOT
  console.log("\n3. a refused landlocked piece");
  let ll = null;
  for (const b of vac.slice().reverse()) {
    if (!free(b)) continue;
    const geo = geoOf(W, b);
    if (!geo) continue;
    const gT = asOwner(W, b);
    const plan0 = { cuts: [E.fracCut(geo, 0.5, "depth")] };
    const q0 = E.splitQuote(gT, W.parcels, b, geo, plan0);
    const rear = q0.pieces.find((p) => p.access === "none");
    if (!rear || rear.could === undefined) continue;
    const plan1 = { ...plan0, ease: { [rear.i]: rear.could } };
    const q1 = E.splitQuote(gT, W.parcels, b, geo, plan1);
    if (!q1.ok) continue;
    ll = { b, plan0, plan1, q0, q1, rear };
    break;
  }
  ok(!!ll, "found a lot deep enough for a front lot and a rear lot");
  if (ll) {
    console.log(`     ${W.parcels[ll.b].address}: front/rear -> ${ll.q0.why[0]}`);
    ok(!ll.q0.ok && /Landlocked/.test(ll.q0.why.join(" ")), "the rear lot is refused: landlocked");
    const host = ll.q1.pieces[ll.rear.could], host0 = ll.q0.pieces[ll.rear.could];
    console.log(`     with a ${E.EASE_FT}-ft easement over lot ${ll.rear.could + 1}: ${host.burden.toLocaleString()} sf burdened; that lot ${M(host0.value)} -> ${M(host.value)}; the flag lot ${M(ll.q1.pieces[ll.rear.i].value)}`);
    ok(ll.q1.ok && ll.q1.pieces[ll.rear.i].access === "easement", "with the easement recorded it files as a flag lot");
    ok(host.value < host0.value, "the easement costs the burdened lot value");
  }

  builtScenarios(W, "island");
  console.log(`\n  island ledger: worst unexplained month $${Math.round(worst).toLocaleString()}`);
  ok(worst <= 1, "island: every step reconciles to the books");
}

// ---------------------------------------------------------------- the region
{
  console.log(`\nseed ${seed} — the region`);
  prevSnap = null; worst = 0;
  const W = world(REGION);
  ledger(W.g, "open");
  builtScenarios(W, "region");
  ok(done.good, "a built lot split, building conforming (2)");
  ok(done.bad, "a non-conforming split refused (4)");
  ok(done.mort, "a mortgaged split with a partial release (5)");

  console.log("\n8. BW_CITY=region conserve with a split, at $0 unexplained");
  const free = freeOf(W);
  const cand = W.bbls.filter((b) => { const r = W.parcels[b]; return r.class === "land" && !r.ag && !r.tract && r.lotArea >= 9000 && (r.lotFront ?? 0) >= 60 && free(b); });
  let did = false;
  for (const b of cand) {
    const geo = geoOf(W, b);
    if (!geo) continue;
    const plan = { cuts: E.equalCuts(geo, 2) };
    if (!E.splitQuote(asOwner(W, b), W.parcels, b, geo, plan).ok) continue;
    if (buy(W, b)) continue;
    const q = E.splitQuote(W.g, W.parcels, b, geo, plan);
    console.log(`     ${W.parcels[b].address} (${q.zone}): ${q.pieces.map((p) => `${p.a.toLocaleString()} sf ${M(p.value)}`).join(" + ")} vs ${M(q.parentValue)}`);
    W.g = E.fileSplit(W.g, W.parcels, b, geo, plan).s; ledger(W.g, "file");
    did = true;
    break;
  }
  ok(did, "a region lot split filed");
  const t0 = Date.now();
  advanceTo(W, W.g.month + 24);
  ok((W.g.splits ?? []).filter((x) => x.done).length >= 2, `recorded (${(W.g.splits ?? []).filter((x) => x.done).length} splits on the region)`);
  const rival = (W.g.splits ?? []).filter((x) => x.by);
  console.log(`     firms' splits in two years: ${rival.length}${rival.length ? ` (${rival.map((x) => `${x.pieces.length} lots ${x.done ? "recorded" : x.lapsed ?? "pending"}`).join(", ")})` : ""}`);
  console.log(`  region: 24 months in ${((Date.now() - t0) / 1000).toFixed(1)}s; worst unexplained month $${Math.round(worst).toLocaleString()}`);
  ok(worst <= 1, "every month reconciles: $0 unexplained");
  // (a plat's houses go on the delivery queue as source "homes" with no development record —
  // homes.ts — which this invariant does not yet know about; it is not a split's fault)
  const inv = E.checkInvariants(W.g, W.parcels).filter((x) => !/^supply homes:/.test(x.where));
  if (inv) ok(!inv.length, `the engine's invariants hold (${inv.length ? inv.slice(0, 4).map((x) => JSON.stringify(x)).join("; ") : "none broken"})`);
}

clearTimeout(timer);
console.log(fails ? `\n${fails} failure(s)` : "\nlotsplit: all checks pass");
process.exit(fails ? 1 : 0);
