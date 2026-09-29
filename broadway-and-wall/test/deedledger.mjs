// THE DEED LEDGER — is every property dollar on the deed it belongs to?
//
//   pnpm deedledger                  three seeds, thirty years each
//   SEEDS=11 HZ=120 pnpm deedledger  a quick pass
//
// An exit reports a levered, pre-tax equity multiple and IRR read off that
// deed's own cash ledger (GameState.deedCf), which `logBooks` writes whenever
// a call site names the deed. The number is only as honest as the tagging:
// a leasing cheque booked to the firm but not to the building makes every
// exit look better than it was, and nothing on the page would show it.
//
// So this asks four questions of a bot that buys, leases, refinances,
// develops and sells for thirty years:
//
//   1. PURELY PROPERTY CATEGORIES ARE FULLY TAGGED. noi, leasing, capex and
//      dev have no firm-level source at all, so the dollars tagged to deeds
//      must EQUAL the books to the dollar.
//   2. EVERY UNTAGGED DOLLAR ELSEWHERE HAS A NAMED REASON. bought, sold,
//      borrowed, debtSvc, lpCalled and lpDistributed also carry
//      portfolio-level cash (the facility, notes, the revolver, earnest
//      money, the fund vehicle). Books = tagged + untagged, and every
//      untagged call site must be on the list below — a new property cheque
//      that forgets its bbl shows up here by function name.
//   3. THE LEDGERS CONSERVE. Every tagged dollar is either still on an open
//      ledger or was folded into an exit; none was dropped by a deed leaving
//      the book with a cheque booked after its exit was closed.
//   4. THE OUTPUT IS REAL. At least one exit carries a finite multiple and
//      IRR, the multiple is above 1 exactly when equity back beats equity in,
//      and the IRR agrees in sign. The solver itself is checked on a known
//      series.
//
// A test that cannot fail is itself a fake: delete one `bbl` argument (say
// the signing cost in leasing.ts `signLoi`) and question 1 fails naming it.
import { permittedUse } from "./permitted-use.mjs";
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

const { parcels: P0, adjacency, bbls } = loadCity(0, E.normalizeParcels);
const SEEDS = (process.env.SEEDS ?? "550991,12007,73303").split(",").map(Number);
const HZ = Number(process.env.HZ ?? 360);
const M = (n) => `$${(n / 1e6).toFixed(3)}M`;

const PURE = ["noi", "leasing", "capex", "dev"];
const MIXED = ["bought", "sold", "borrowed", "debtSvc", "lpCalled", "lpDistributed"];
const SIGN = { noi: 1, sold: 1, borrowed: 1, lpCalled: 1, debtSvc: -1, leasing: -1, capex: -1, dev: -1, bought: -1, lpDistributed: -1 };

// WHERE UNTAGGED CASH IS ALLOWED TO COME FROM, by category and call site.
// Each is portfolio-level by construction — not one building's cash — or is
// the deliberate choice noted beside it. Anything not on this list fails.
const ALLOWED = {
  bought: {
    strikeDeal: "earnest money at the handshake — books to the deed in full at the closing",
    closeAgreed: "the earnest-money credit at the closing (the same dollars as above)",
    forfeitDeposit: "a dead deal's earnest money, reclassified to G&A — no deed",
    registerAuctionBids: "auction registration deposit — the deed's price books in full at the hammer",
    resolveAuction: "overbid on your own note's lot — the equity sits in the note",
    buyNote: "a mortgage note, not a deed",
    fundPrivateAsk: "a private loan, not a deed",
  },
  sold: {
    registerAuctionBids: "auction registration deposit returned on re-registration",
    resolveAuction: "auction registration deposit rolled back; a note paid off at the hammer",
    acceptPortfolioBid: "the crossed facility repaid out of package proceeds — pool principal",
    accelerate: "a receiver's surplus on a crossed pool",
    serviceNotes: "note payoffs and sales", modifyNote: "note paydown", sellNote: "note sale",
  },
  borrowed: {
    openFacility: "the crossed facility", takeFacilityRoll: "the crossed facility",
  },
  debtSvc: {
    tickLoc: "revolver interest and penalties",
    tickMonth: "the crossed facility's monthly payment (tickFacility's cash)",
    openFacility: "the crossed facility", releaseFromFacility: "the crossed facility",
    refinanceFacility: "the crossed facility", repayFacility: "the crossed facility",
    accelerate: "the crossed facility's recourse shortfall",
  },
  // A JV partner's calls and distributions ARE deed cash (tagged in jv.ts);
  // the fund vehicle's LP capital is the vehicle's, across every deed in it.
  lpCalled: { raiseFund: "the fund vehicle's first close", callFundCapital: "a fund capital call" },
  lpDistributed: { applyDistribute: "a fund distribution" },
};

// The solver, on a series whose answer is known.
{
  const r = E.deedIrr([0, -100, 12, 110]);
  if (r === null || Math.abs(r - 0.10) > 1e-6) {
    console.log(`FAIL  deedIrr([-100 @ m0, +110 @ m12]) = ${r}, expected 10.0%`);
    process.exit(1);
  }
  const r2 = E.deedIrr([0, -100, 1, 5, 24, 100]);
  if (r2 === null || !(r2 > 0.02 && r2 < 0.03)) {
    console.log(`FAIL  deedIrr on a 2-year hold returned ${r2}`);
    process.exit(1);
  }
  // -100, +230, -132 has two rates (10% and 20% a month): no single answer.
  if (E.deedIrr([0, -100, 1, 230, 2, -132]) !== null) {
    console.log("FAIL  deedIrr picked one of two rates for flows with two sign changes");
    process.exit(1);
  }
  if (E.deedIrr([0, -100, 12, -5]) !== null) {
    console.log("FAIL  deedIrr returned a rate for flows that never change sign");
    process.exit(1);
  }
}

E.deedCfProbe.on = true;
let failed = false;
const fail = (msg) => { failed = true; console.log(`FAIL  ${msg}`); };
let exitsAll = 0, exitsEq = 0, exitsIrr = 0, revived = 0, mezzN = 0, facN = 0, pooledExits = 0, jvN = 0, lhN = 0, paydownN = 0;
const pledgedAt = new Map();
const coverage = {};
const samples = [];

for (const seed of SEEDS) {
  const parcels = JSON.parse(JSON.stringify(P0));
  let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  const START = g.cash;
  let built = false, mezzDone = false, facDone = false, jvDone = false, lhDone = false;

  for (let m = 0; m < HZ; m++) {
    g = E.advanceQuarter(g, parcels, bbls, adjacency);
    // THE CONSERVE BOT — leases at market, buys on a clock with a reserve,
    // puts one crane up, sells when short, draws principal. See conserve.mjs
    // for why every threshold is a fraction of the opening balance.
    for (const loi of [...g.lois]) {
      const rec = E.resolveRec(parcels, g, loi.bbl), h = g.holdings[loi.bbl];
      if (!rec || !h) continue;
      const ask = E.managedRentPsfYr(rec, g.econ, h, loi.use) * E.staleDiscount(h.darkMs);
      const r = E.respondLOI(g, parcels, loi.id, loi.rentPsf >= ask * 0.92 ? "accept" : "pass");
      if (!r.err) g = r.s;
    }
    if (m % 9 === 0 && g.cash > START * 0.6) {
      for (const li of [...g.listings].slice(0, 8)) {
        const rec = E.resolveRec(parcels, g, li.bbl);
        if (!rec || g.holdings[li.bbl] || rec.class === "land") continue;
        if (li.ask > E.assetValue(rec, g.econ, E.initialCondition(rec))) continue;
        let closed = false;
        for (const lev of [0.60, 0.85]) {
          const q = E.buyQuote(g, parcels, li.bbl, li.ask, "harbor", lev);
          if (q.equity > g.cash - START * 0.25) continue;
          const r = E.executePurchase(g, parcels, li.bbl, li.ask, "harbor", false, lev);
          if (!r.err) { g = r.s; closed = true; break; }
        }
        if (closed) break;
      }
    }
    if (!Object.keys(g.developments ?? {}).length && !built && g.cash > START * 0.8) {
      const lot = [...g.listings].find((li) => {
        const rec = E.resolveRec(parcels, g, li.bbl);
        return rec && rec.class === "land" && !g.holdings[li.bbl] && li.ask < g.cash * 0.25;
      });
      if (lot) {
        const r = E.executePurchase(g, parcels, lot.bbl, lot.ask, "cash", false, 1);
        if (!r.err) g = r.s;
      }
      const dirt = Object.keys(g.holdings).find((b) => {
        const rec = E.resolveRec(parcels, g, b);
        return rec && rec.class === "land" && !g.developments[b] && !g.holdings[b].sale;
      });
      if (dirt) {
        const use = permittedUse(E, E.resolveRec(parcels, g, dirt), g.econ, ["office"]);
        const d = use ? E.startDevelopment(g, parcels, dirt, use, 4) : { err: "zoning" };
        if (!d.err) { g = d.s; built = true; }
      }
    }
    // SELL ON A CLOCK TOO. Conserve's bot only sells when short, which leaves
    // most runs with no exit to read a multiple off. Every four years the
    // longest-held standing building goes on the market.
    const sellClock = m > 0 && m % 48 === 0;
    if (g.cash < 1_200_000 || sellClock) {
      const own = Object.keys(g.holdings)
        .filter((b) => !g.holdings[b].sale && !g.developments[b] && !g.merged?.[b])
        .sort((a, b) => g.holdings[a].boughtM - g.holdings[b].boughtM);
      if (own.length > 1) {
        const bbl = own[0];
        const rec = E.resolveRec(parcels, g, bbl);
        if (rec) {
          const r = E.listForSale(g, parcels, bbl, Math.round(E.assetValue(rec, g.econ, E.initialCondition(rec)) * 0.92));
          if (!r.err) g = r.s;
        }
      }
    }
    for (const bbl of Object.keys(g.holdings)) {
      const off = g.holdings[bbl]?.sale?.offer;
      if (off) {
        const r = E.acceptSaleOffer(g, parcels, bbl);
        if (!r.err) g = r.s;
      }
    }
    if (m > 2 && m % 6 === 0) {
      for (const bbl of Object.keys(g.holdings)) {
        const h = g.holdings[bbl];
        const rec = E.resolveRec(parcels, g, bbl);
        if (!h || !rec || h.sale) continue;
        const desks = rec.class === "land"
          ? ["land"]
          : ((h.tenants?.length ?? 0) < 1 && rec.class !== "multifamily")
            ? []
            : ["cordage", "harbor", "savings"];
        let done = false;
        for (const desk of desks) {
          const r = E.refinance(g, parcels, bbl, desk, 1);
          if (!r.err) { g = r.s; done = true; break; }
        }
        if (done) break;
      }
    }
    // TWO MORE DOORS, once each: a mezzanine piece (its points, coupon and
    // balloon are deed cash) and a crossed facility (whose cash is NOT any one
    // deed's — its deeds must come out with no equity multiple at all).
    if (!mezzDone && m > 24 && m % 6 === 3) {
      for (const bbl of Object.keys(g.holdings)) {
        const r = E.placeMezz(g, parcels, bbl);
        if (!r.err) { g = r.s; mezzDone = true; mezzN++; break; }
      }
    }
    if (!g.facility && !facDone && m >= 150 && m % 12 === 0) {
      const pool = E.pledgeable(g, parcels).map((x) => x.bbl).filter((b) => !g.holdings[b].sale);
      if (pool.length >= E.FACILITY_MIN_ASSETS) {
        for (const q of E.facilityQuotes(g, parcels, pool)) {
          const r = E.openFacility(g, parcels, pool, q.productId, 1);
          if (!r.err) {
            g = r.s; facDone = true; facN++;
            for (const b of pool) pledgedAt.set(`${seed}:${b}`, g.month);
            break;
          }
        }
      }
    }
    // AND THE ONE-DEED EQUITY DOORS: a minority partner in and back out
    // (jv.ts), the land sold and leased back and later bought back
    // (leasehold.ts), and a voluntary principal paydown.
    if (m > 30 && m % 12 === 5) {
      const own = Object.keys(g.holdings).filter((b) => !g.holdings[b].sale && !g.developments[b]);
      for (const bbl of own) {
        const h = g.holdings[bbl];
        if (!jvDone && !h.jv) {
          const r = E.sellStake(g, parcels, bbl, 0.25);
          if (!r.err) { g = r.s; jvDone = true; jvN++; break; }
        } else if (h.jv && g.month - h.jv.sinceM >= 36) {
          const r = E.buyOutPartner(g, parcels, bbl);
          if (!r.err) { g = r.s; jvN++; break; }
        }
      }
      for (const bbl of own) {
        const h = g.holdings[bbl];
        if (!h) continue;
        if (!lhDone && !h.groundRentOut) {
          const r = E.sellLandLeaseBack(g, parcels, bbl);
          if (!r.err) { g = r.s; lhDone = true; lhN++; break; }
        } else if (h.groundRentOut && g.month - h.groundRentOut.startM >= 48) {
          const r = E.buyLandBack(g, parcels, bbl);
          if (!r.err) { g = r.s; lhN++; break; }
        }
      }
      for (const bbl of own) {
        const h = g.holdings[bbl];
        if (!h?.loan || h.loan.balance < 400_000 || g.cash < START * 0.5) continue;
        const r = E.paydownLoan(g, parcels, bbl, 100_000);
        if (!r.err) { g = r.s; paydownN++; break; }
      }
    }
    // A thirty-year probe must not stop at a game over — every later month
    // would be a copy of the one it died in (CLAUDE.md, the frozen world).
    // The cash is minted, which is fine HERE and nowhere else: this file
    // checks the tagging of the books, not the cash identity (conserve does).
    if (g.gameOver) { g = { ...g, gameOver: null, cash: START, insolventMs: 0, underwaterMs: 0 }; revived++; }
  }

  // ---- 1 & 2: tagged against the books ------------------------------------
  // The probe rides on the state, so an action whose clone was thrown away
  // took its probe entries with it.
  const probe = g._deedProbe ?? { tot: {}, untagged: {}, closed: 0, dropped: 0 };
  const books = {};
  for (const y of g.books ?? []) for (const k of Object.keys(SIGN)) books[k] = (books[k] ?? 0) + (y[k] ?? 0);
  console.log(`\nseed ${seed} · month ${g.month} · ${Object.keys(g.holdings).length} held · ${g.exits.length} exits`);
  console.log(`  category        books        tagged     untagged`);
  for (const k of [...PURE, ...MIXED]) {
    const b = books[k] ?? 0, t = probe.tot[k] ?? 0;
    console.log(`  ${k.padEnd(10)}${M(b).padStart(13)}${M(t).padStart(13)}${M(b - t).padStart(13)}`);
    if (PURE.includes(k) && Math.abs(b - t) > 1) {
      fail(`seed ${seed}: ${k} books ${b.toFixed(2)} but only ${t.toFixed(2)} was tagged to a deed — a property cheque is missing its bbl`);
    }
    coverage[k] = (coverage[k] ?? 0) + Math.abs(t);
  }
  for (const [kw, amt] of Object.entries(probe.untagged)) {
    const [k, who] = kw.split(" ");
    if (PURE.includes(k)) { fail(`seed ${seed}: ${M(amt)} of ${k} booked untagged by ${who}`); continue; }
    if (!MIXED.includes(k)) continue;
    if (!ALLOWED[k]?.[who]) fail(`seed ${seed}: ${M(amt)} of ${k} booked untagged by ${who}, which is not a portfolio-level source this test knows about`);
  }
  for (const k of MIXED) {
    const t = probe.tot[k] ?? 0;
    let un = 0;
    for (const [kw, amt] of Object.entries(probe.untagged)) if (kw.split(" ")[0] === k) un += amt;
    if (Math.abs((books[k] ?? 0) - t - un) > 1) fail(`seed ${seed}: ${k} books do not equal tagged + enumerated untagged`);
    if (t > (books[k] ?? 0) + 1 && un >= 0) fail(`seed ${seed}: more ${k} tagged than booked`);
  }
  const src = Object.entries(probe.untagged).filter(([kw]) => MIXED.includes(kw.split(" ")[0]));
  if (src.length) console.log(`  untagged by: ${src.map(([kw, a]) => `${kw} ${M(a)}`).join(" · ")}`);

  // ---- 3: the ledgers conserve --------------------------------------------
  let signedTagged = 0;
  for (const [k, v] of Object.entries(probe.tot)) signedTagged += (SIGN[k] ?? 0) * v;
  let open = 0, entries = 0;
  for (const l of Object.values(g.deedCf ?? {})) {
    for (let i = 1; i < l.cf.length; i += 2) open += l.cf[i];
    entries += l.cf.length / 2;
  }
  const resid = signedTagged - (probe.closed + probe.dropped + open);
  console.log(`  ledgers: tagged ${M(signedTagged)} = closed ${M(probe.closed)} + open ${M(open)} + dropped ${M(probe.dropped)}  (resid $${resid.toFixed(2)}, ${entries} open entries)`);
  // Entries are stored to the cent; the tolerance is that rounding and no more.
  if (Math.abs(resid) > 5) fail(`seed ${seed}: the deed ledgers lost $${resid.toFixed(2)} against what was tagged`);
  if (Math.abs(probe.dropped) > 1) {
    fail(`seed ${seed}: ${M(probe.dropped)} was tagged to deeds after they left the book — a cheque booked after its exit was closed`);
  }

  // ---- 4: the output is real ----------------------------------------------
  for (const e of g.exits) {
    exitsAll++;
    const pm = pledgedAt.get(`${seed}:${e.bbl}`);
    if (pm !== undefined && e.soldM >= pm && e.boughtM <= pm) {
      pooledExits++;
      if (e.equityIn !== undefined) fail(`seed ${seed}: ${e.address} was in the crossed facility and still reported an equity multiple`);
    }
    if (e.equityIn === undefined) continue;
    exitsEq++;
    const mult = e.equityOut / e.equityIn;
    if (!Number.isFinite(mult) || e.equityIn <= 0) fail(`seed ${seed}: ${e.address} multiple ${mult}`);
    if ((mult > 1) !== (e.equityOut > e.equityIn)) fail(`seed ${seed}: ${e.address} multiple ${mult} disagrees with ${e.equityOut} vs ${e.equityIn}`);
    if (e.irr !== null && e.irr !== undefined) {
      if (!Number.isFinite(e.irr)) fail(`seed ${seed}: ${e.address} IRR ${e.irr}`);
      else {
        exitsIrr++;
        // Sign agreement: a deed that returned more than it took has a
        // positive rate. Allow the knife-edge where the two are within a
        // dollar of each other.
        if (Math.abs(e.equityOut - e.equityIn) > 1 && (e.irr > 0) !== (e.equityOut > e.equityIn)) {
          fail(`seed ${seed}: ${e.address} IRR ${(e.irr * 100).toFixed(2)}% disagrees in sign with ${mult.toFixed(2)}x`);
        }
      }
    }
    if (samples.length < 8) samples.push({ seed, ...e });
  }
}

console.log(`\n${"=".repeat(64)}`);
for (const e of samples) {
  console.log(`  ${String(e.seed).padEnd(7)} ${e.address.slice(0, 26).padEnd(27)} held ${((e.soldM - e.boughtM) / 12).toFixed(1).padStart(4)}y  `
    + `in ${M(e.equityIn)}  back ${M(e.equityOut)}  ${(e.equityOut / e.equityIn).toFixed(2)}x  `
    + `IRR ${e.irr == null ? "—" : (e.irr * 100).toFixed(1) + "%"}${e.forced ? "  forced" : ""}`);
}
console.log(`exits ${exitsAll} · with an equity ledger ${exitsEq} · with an IRR ${exitsIrr} · out of a crossed pool ${pooledExits} · mezz ${mezzN} · facility ${facN} · JV ${jvN} · leasehold ${lhN} · paydown ${paydownN} · bot revived ${revived}x`);
console.log(`tagged: ${[...PURE, ...MIXED].map((k) => `${k} ${coverage[k] ? "yes" : "NO"}`).join("  ")}`);
// An identity nothing exercises proves nothing. Every category must have
// carried tagged dollars somewhere in the run.
for (const k of [...PURE, ...MIXED]) if (!coverage[k]) fail(`the bot never tagged ${k}, so its tagging was not tested`);
for (const [n, what] of [[mezzN, "mezzanine"], [jvN, "a JV stake"], [lhN, "a leasehold sale"], [paydownN, "a paydown"]]) {
  if (!n) fail(`the bot never exercised ${what}, so those tags were not tested`);
}
if (exitsIrr === 0) fail("no exit carried a finite IRR — the ledger was never read out");
if (failed) process.exit(1);
console.log("Every property dollar is on its deed, and every deed's ledger closed into its exit.");
