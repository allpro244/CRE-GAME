// REFINANCE YOUR PARTNERS OUT — the recap buyout, end to end.
//   pnpm engine && node test/recap.mjs
//
// A $1M sponsor syndicates a job, builds and leases it, and once it has
// stabilised buys its investors out at what a sale at the appraisal would
// have paid them through the waterfall, plus the band's fairness premium
// (CAPITAL_RAISING_PLAN.md §4.5). Checked: the price, the close as a realised
// exit, the sponsor's net worth moving only by the premium and any transfer
// tax (it buys their claim at its value), the cash identity, the basis step-up,
// and the reputation reading a quick flip as a cheap buyout.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels: P0, bbls, adjacency } = loadCity(0, E.normalizeParcels);

let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? "OK  " : "FAIL"}  ${m}`); if (!c) fails++; };
const M = (n) => `$${(n / 1e6).toFixed(3)}M`;
const IN = ["noi", "sold", "interest", "borrowed", "lpCalled", "fees"];
const OUT = ["debtSvc", "leasing", "capex", "dev", "taxes", "bought", "ga", "lpDistributed"];
const books = (g) => { let t = 0; for (const y of g.books ?? []) { for (const k of IN) t += y[k] ?? 0; for (const k of OUT) t -= y[k] ?? 0; } return t; };
const deposits = (g) => { let d = 0; for (const h of Object.values(g.holdings)) for (const t of h.tenants ?? []) d += t.deposit ?? 0; return d; };

let done = 0;
for (const seed of (process.env.SEEDS ?? "9401,9402").split(",").map(Number)) {
  const parcels = JSON.parse(JSON.stringify(P0));
  let g = E.firstListings(E.newGame(seed, parcels, 1_000_000), parcels, bbls);
  let lot = null;
  for (let m = 0; m < 200 && !g.gameOver; m++) {
    if (!lot && g.month % 3 === 0) {
      const own0 = E.fundableNow(g, parcels);
      let pick = null;
      for (const L of g.listings ?? []) {
        const rec = E.resolveRec(parcels, g, L.bbl);
        if (!rec || rec.class !== "land" || L.ask > own0 * 0.8) continue;
        for (const u of ["multifamily", "office", "retail", "industrial"]) for (const f of [2, 3, 4, 6, 8, 12]) {
          const p = E.planDevelopment(g, parcels, L.bbl, u, f, 0.6, "gmp");
          if (!p || p.hurdleRatio < 0.9) continue;
          const need = E.devFundingNeed(p).whole;
          if (need <= own0 - L.ask || need > (own0 - L.ask) * 2.2) continue;
          if (!pick || p.hurdleRatio > pick.p.hurdleRatio) pick = { L, u, f, p };
        }
      }
      if (pick) {
        const r = E.executePurchase(g, parcels, pick.L.bbl, pick.L.ask, "cash", false, 1);
        if (!r.err && r.s.holdings[pick.L.bbl]) {
          const g1 = r.s, b = pick.L.bbl;
          const p = E.planDevelopment(g1, parcels, b, pick.u, pick.f, 0.6, "gmp");
          const outside = E.maxOutside(g1, E.devFundingNeed(p).whole, E.ownedHoldingValue(g1, parcels, g1.holdings[b]));
          const rr = E.startDevelopment(g1, parcels, b, pick.u, pick.f, 0.6, "gmp", undefined, { syndicate: { outside } });
          if (!rr.err) { g = rr.s; lot = b; console.log(`seed ${seed} m${g.month}: ${pick.u} ${pick.f}fl syndicated, ${M(outside)} outside`); } else g = g1;
        }
      }
    }
    for (const loi of [...(g.lois ?? [])]) {
      const rec = E.resolveRec(parcels, g, loi.bbl), h = g.holdings[loi.bbl];
      if (!rec || !h) continue;
      const ask = E.managedRentPsfYr(rec, g.econ, h, loi.use);
      const r = E.respondLOI(g, parcels, loi.id, loi.rentPsf >= ask * 0.85 ? "accept" : "pass", true);
      if (!r.err) g = r.s;
    }
    if (lot && g.syndications?.[lot]) {
      const q = E.recapQuote(g, parcels, lot);
      if (q.ok && E.fundableNow(g, parcels) >= q.total) {
        const w0 = g.syndications[lot];
        const nw0 = E.netWorth(g, parcels);
        const basis0 = g.holdings[lot].costBasis;
        const lpDist0 = w0.lpDist, capShare = E.lpCapShare(w0);
        const r = E.recapBuyout(g, parcels, lot);
        ok(!r.err, `seed ${seed}: the buyout closes${r.err ? ` (${r.err})` : ""}`);
        if (r.err) break;
        const prev = { cash: g.cash, books: books(g), loc: g.loc?.balance ?? 0, dep: deposits(g) };
        g = r.s;
        const resid = (g.cash - prev.cash) - ((books(g) - prev.books) + ((g.loc?.balance ?? 0) - prev.loc) + (deposits(g) - prev.dep));
        const dNw = E.netWorth(g, parcels) - nw0;
        const rec = g.synClosed.at(-1);
        console.log(`  m${g.month}: appraisal ${M(q.appraisal)} · equity ${M(q.equity)} · their take ${M(q.investorsTake)} + premium ${M(q.premium)} + tax ${M(q.transferTax)} · investors ${M(rec.lpIn)} in, ${M(rec.lpOut)} out (${(rec.lpOut / rec.lpIn).toFixed(2)}x) · Δnet worth ${M(dNw)}`);
        ok(!g.syndications?.[lot] && g.holdings[lot] && !g.holdings[lot].fundOwned, `seed ${seed}: the deed is the sponsor's alone`);
        ok(rec.recap === true && rec.bbl === lot && rec.lpOut >= lpDist0 + q.price - 1, `seed ${seed}: the deal closes as a buyout, the price on the investors' record`);
        ok(q.investorsTake <= q.equity + 1, `seed ${seed}: they take no more than the equity`);
        ok(Math.abs(dNw + q.premium + q.transferTax) <= 0.01 * q.equity + 2, `seed ${seed}: net worth moves by the premium and tax only (${M(dNw)} vs ${M(-(q.premium + q.transferTax))})`);
        ok(Math.abs(resid) <= 1, `seed ${seed}: every dollar of the buyout on the ledger (residual ${resid.toFixed(2)})`);
        ok(Math.abs(g.holdings[lot].costBasis - Math.round(basis0 * (1 - capShare) + q.price)) <= 1, `seed ${seed}: the purchased share's basis steps up to the price`);
        const ev = E.playerEvidence(g);
        ok(ev.some((e) => /bought out/.test(e.label)), `seed ${seed}: investors count the buyout as a realised exit`);
        // A quick flip at 30% over the appraisal reads as a cheap buyout.
        g.exits.push({ bbl: lot, address: "flip", boughtM: 0, soldM: g.month + 6, price: Math.round(q.appraisal * 1.3), basis: 1, gain: 0 });
        ok(E.playerEvidence(g).some((e) => e.ev === -10 && /over the buyout appraisal/.test(e.label)), `seed ${seed}: selling it on at 30% over the buyout appraisal costs −10`);
        done++;
        break;
      }
    }
    g = E.advanceMonth(g, parcels, bbls, adjacency);
  }
}
ok(done >= 1, `buyouts exercised on ${done} seeds`);
console.log(fails ? "\nFAIL" : "\nPASS — investors bought out at what a sale would have paid them");
process.exit(fails ? 1 : 0);
