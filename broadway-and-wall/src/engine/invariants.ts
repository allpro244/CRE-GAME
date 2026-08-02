// THINGS THAT MUST NEVER BE TRUE.
//
// Every bug this game has shipped had the same shape: a number that was wrong
// but plausible. A NOI before property tax. A condition string that wasn't a
// Condition, quietly turning the whole valuation chain into NaN. An overhead
// charge that billed a small operator more than their building earned. None of
// them threw; they all just produced a number, and the number looked fine
// until a hundred playthroughs said otherwise.
//
// So this is the other kind of test. Not "does the balance feel right" — the
// audit harness answers that — but "is the state internally coherent at all".
// It is cheap enough to run on every month of a full campaign, and it is meant
// to be run that way: the point is to catch the month it first went wrong, not
// the century it finally showed up in.
//
// Nothing here is a judgement call. Every check below is either an accounting
// identity, a definitional bound, or a rule the engine states elsewhere in
// prose. If a check is arguable, it does not belong in this file.
import type { ParcelTable } from "@/data/types";
import type { BuiltClass, GameState } from "./types";
import { resolveRec, holdingValue, holdingNOIYr, netWorth } from "./value";
import { mixOf, useSf } from "./mix";

export interface Violation {
  code: string;
  where: string;
  detail: string;
}

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Check one state. Returns every violation found, so a broken month reports
 * its whole story rather than the first symptom.
 */
export function checkInvariants(s: GameState, parcels: ParcelTable): Violation[] {
  const v: Violation[] = [];
  const bad = (code: string, where: string, detail: string) => v.push({ code, where, detail });

  // ---------------------------------------------------------------- the firm
  if (!fin(s.cash)) bad("nan", "firm", `cash is ${s.cash}`);
  if (!fin(s.month) || s.month < 0) bad("month", "firm", `month is ${s.month}`);
  if (!fin(s.taxesPaid) || s.taxesPaid < 0) bad("tax", "firm", `lifetime tax ${s.taxesPaid}`);
  if (s.loc) {
    if (!fin(s.loc.balance) || s.loc.balance < 0) bad("loc", "firm", `line balance ${s.loc.balance}`);
    if (s.loc.balance > s.loc.drawnTotal + 1) bad("loc", "firm", `line balance ${Math.round(s.loc.balance)} exceeds everything ever drawn ${Math.round(s.loc.drawnTotal)}`);
  }
  const nw = netWorth(s, parcels);
  if (!fin(nw)) bad("nan", "firm", "net worth is not a number");

  // ------------------------------------------------------------- the economy
  const e = s.econ;
  for (const [k, x] of Object.entries({ indexRate: e.indexRate, landIdx: e.landIdx, costIdx: e.costIdx, cycleDev: e.cycleDev, creditIdx: e.creditIdx })) {
    if (!fin(x)) bad("nan", "econ", `${k} is ${x}`);
  }
  if (fin(e.indexRate) && (e.indexRate < 0 || e.indexRate > 40)) bad("rate", "econ", `index rate ${e.indexRate}%`);
  if (fin(e.cycleDev) && Math.abs(e.cycleDev) > 1.0001) bad("cycle", "econ", `cycleDev ${e.cycleDev} outside [-1,1]`);
  for (const [cls, r] of Object.entries(e.rentIdx ?? {})) {
    if (!fin(r) || r <= 0) bad("rent", "econ", `${cls} rent index ${r}`);
  }
  for (const [cls, c] of Object.entries(e.capRate ?? {})) {
    if (!fin(c) || c <= 0.5 || c > 40) bad("cap", "econ", `${cls} cap rate ${c}%`);
  }

  // ------------------------------------------------------------- the holdings
  for (const [bbl, h] of Object.entries(s.holdings)) {
    const at = `holding ${bbl}`;
    const rec = resolveRec(parcels, s, bbl);
    if (!rec) { bad("orphan", at, "owned parcel is not in the parcel table"); continue; }
    if (h.bbl !== bbl) bad("key", at, `holding keyed ${bbl} but says it is ${h.bbl}`);
    if (!fin(h.costBasis) || h.costBasis < 0) bad("basis", at, `cost basis ${h.costBasis}`);
    if (h.boughtM > s.month) bad("time", at, `bought in month ${h.boughtM}, it is month ${s.month}`);
    if (h.deprTaken !== undefined && (!fin(h.deprTaken) || h.deprTaken < -1)) bad("depr", at, `accumulated depreciation ${h.deprTaken}`);

    const val = holdingValue(rec, s.econ, h, s.month);
    if (!fin(val) || val < 0) bad("value", at, `holding value ${val}`);
    const noi = holdingNOIYr(rec, s.econ, h, s.month);
    if (!fin(noi)) bad("nan", at, "NOI is not a number");

    // the rent roll cannot be bigger than the building
    const leased = h.tenants.reduce((a, t) => a + t.sf, 0);
    if (!fin(leased) || leased < 0) bad("roll", at, `leased area ${leased}`);
    if (rec.bldgArea > 0 && leased > rec.bldgArea + 1) {
      bad("overleased", at, `${Math.round(leased).toLocaleString()} sf leased in a ${rec.bldgArea.toLocaleString()} sf building`);
    }
    if (rec.class === "land" && leased > 0) bad("roll", at, "a vacant site has tenants on it");

    // THE MIX. Shares must be a real partition of the building, and no tenant
    // may occupy a use the building does not have — you cannot lease office
    // space in a building that is entirely flats.
    const m = mixOf(rec);
    const shares = Object.values(m);
    if (rec.class !== "land") {
      const tot = shares.reduce((x, y) => x + y, 0);
      if (!fin(tot) || Math.abs(tot - 1) > 0.005) bad("mix", at, `use shares sum to ${tot.toFixed(3)}, not 1`);
      for (const [u, sh] of Object.entries(m)) {
        if (!fin(sh) || sh <= 0 || sh > 1.0001) bad("mix", at, `${u} share is ${sh}`);
      }
      // each component holds only what fits in it
      for (const u of Object.keys(m) as BuiltClass[]) {
        const cap = useSf(rec, u);
        const inUse = h.tenants.filter((tn) => (tn.use ?? rec.class) === u).reduce((n, tn) => n + tn.sf, 0);
        if (inUse > cap + 1) {
          bad("overleased", at, `${Math.round(inUse).toLocaleString()} sf let in the ${u} part, which is ${Math.round(cap).toLocaleString()} sf`);
        }
      }
      for (const tn of h.tenants) {
        if (tn.use && !(tn.use in m)) bad("mix", at, `${tn.name} occupies ${tn.use} space in a building with none`);
        if (tn.use === "multifamily") bad("mix", at, `${tn.name} is a named tenant in the residential part`);
      }
    }
    for (const t of h.tenants) {
      if (!fin(t.sf) || t.sf <= 0) bad("tenant", at, `${t.name} occupies ${t.sf} sf`);
      if (!fin(t.rentPsf) || t.rentPsf < 0) bad("tenant", at, `${t.name} pays ${t.rentPsf}/sf`);
      if (t.endM < t.startM) bad("tenant", at, `${t.name}'s lease ends before it begins`);
    }
    // space being turned is space that exists
    const turning = (h.makeReady ?? []).reduce((a, m) => a + m.sf, 0);
    if (rec.bldgArea > 0 && leased + turning > rec.bldgArea * 1.02) {
      bad("overleased", at, `${Math.round(leased + turning).toLocaleString()} sf leased-or-turning in a ${rec.bldgArea.toLocaleString()} sf building`);
    }
    if (h.occ !== undefined && (!fin(h.occ) || h.occ < 0 || h.occ > 1)) bad("occ", at, `occupancy ${h.occ}`);
    for (const f of h.latent ?? []) {
      if (!fin(f.cost) || f.cost < 0) bad("latent", at, `an unfound ${f.kind} issue costs ${f.cost}`);
      if (f.found) bad("latent", at, `a FOUND issue was carried into ownership as latent`);
    }

    // the loan
    const l = h.loan;
    if (l) {
      if (!fin(l.balance) || l.balance < 0) bad("loan", at, `balance ${l.balance}`);
      if (!fin(l.principal) || l.principal <= 0) bad("loan", at, `original principal ${l.principal}`);
      if (l.balance > l.principal + 1) bad("loan", at, `balance ${Math.round(l.balance)} exceeds original principal ${Math.round(l.principal)}`);
      if (!fin(l.ratePct) || l.ratePct < 0 || l.ratePct > 60) bad("loan", at, `coupon ${l.ratePct}%`);
      if (!fin(l.monthlyPmt) || l.monthlyPmt < 0) bad("loan", at, `payment ${l.monthlyPmt}`);
      if (l.maturityM <= l.originM) bad("loan", at, "matures on or before it was written");
      if (l.originM > s.month) bad("loan", at, `originated in month ${l.originM}, it is month ${s.month}`);
      // an interest-only loan pays interest; an amortising one pays more
      const interest = (l.balance * l.ratePct) / 100 / 12;
      if (l.balance > 1000 && l.monthlyPmt + 1 < interest * 0.999) {
        bad("loan", at, `payment ${Math.round(l.monthlyPmt)} does not cover interest ${Math.round(interest)}`);
      }
    }
    // you cannot be selling a building you are also building
    if (h.sale && s.developments[bbl]) bad("state", at, "listed for sale while under construction");
  }

  // ---------------------------------------------------------- the development
  for (const [bbl, d] of Object.entries(s.developments ?? {})) {
    const at = `development ${bbl}`;
    if (!fin(d.costTotal) || d.costTotal <= 0) bad("dev", at, `budget ${d.costTotal}`);
    if (!fin(d.drawn) || d.drawn < 0) bad("dev", at, `drawn ${d.drawn}`);
    if (d.drawn > d.commitment + 1) bad("dev", at, `drawn ${Math.round(d.drawn)} exceeds the commitment ${Math.round(d.commitment)}`);
    if (d.loanBalance < d.drawn - 1) bad("dev", at, `loan balance ${Math.round(d.loanBalance)} is below what has been drawn ${Math.round(d.drawn)}`);
    if (d.reserveUsed > d.interestReserve + 1) bad("dev", at, `interest reserve overdrawn by ${Math.round(d.reserveUsed - d.interestReserve)}`);
    if (d.contingencyUsed > d.contingency + 1) bad("dev", at, `contingency overdrawn by ${Math.round(d.contingencyUsed - d.contingency)}`);
    if (d.equitySpent > d.equityBudget * 3) bad("dev", at, `equity spent ${Math.round(d.equitySpent)} against a budget of ${Math.round(d.equityBudget)}`);
    if (d.deliverM <= d.startM) bad("dev", at, "delivers on or before it starts");
    if (!fin(d.sf) || d.sf <= 0) bad("dev", at, `programme is ${d.sf} sf`);
    if (s.holdings[bbl] && s.holdings[bbl].sale) bad("state", at, "under construction and on the market at once");
  }

  // -------------------------------------------------------------- the market
  const seen = new Set<string>();
  for (const li of s.listings) {
    if (!parcels[li.bbl]) bad("listing", `listing ${li.bbl}`, "not a real parcel");
    if (!fin(li.ask) || li.ask <= 0) bad("listing", `listing ${li.bbl}`, `ask ${li.ask}`);
    if (s.holdings[li.bbl]) bad("listing", `listing ${li.bbl}`, "the market is selling you a building you already own");
    if (seen.has(li.bbl)) bad("listing", `listing ${li.bbl}`, "listed twice at once");
    seen.add(li.bbl);
  }
  const loiIds = new Set<number>();
  for (const loi of s.lois) {
    const at = `LOI ${loi.id}`;
    if (loiIds.has(loi.id)) bad("loi", at, "duplicate LOI id");
    loiIds.add(loi.id);
    if (!s.holdings[loi.bbl]) bad("loi", at, "a tenant is negotiating for a building you do not own");
    if (!fin(loi.sf) || loi.sf <= 0) bad("loi", at, `${loi.sf} sf`);
    if (!fin(loi.rentPsf) || loi.rentPsf < 0) bad("loi", at, `$${loi.rentPsf}/sf`);
    if (loi.id >= s.nextLoiId) bad("loi", at, `id ${loi.id} is at or past the next id ${s.nextLoiId}`);
  }

  // ----------------------------------------------------------- the city itself
  for (const [bbl, b] of Object.entries(s.built ?? {})) {
    const at = `built ${bbl}`;
    if (!parcels[bbl]) { bad("built", at, "not a real parcel"); continue; }
    if (!fin(b.bldgArea) || b.bldgArea <= 0) bad("built", at, `${b.bldgArea} sf`);
    if (!fin(b.floors) || b.floors < 1) bad("built", at, `${b.floors} floors`);
    if (b.yearBuilt < 1800 || b.yearBuilt > 2200) bad("built", at, `built in ${b.yearBuilt}`);
    if (b.mix) {
      const tot = Object.values(b.mix).reduce((x, y) => x + y, 0);
      if (!fin(tot) || Math.abs(tot - 1) > 0.005) bad("mix", at, `delivered mix sums to ${tot}`);
      if (!(b.class in b.mix)) bad("mix", at, `filed as ${b.class}, which is not in its own mix`);
    }
  }
  for (const [id, d] of Object.entries(s.blockD ?? {})) {
    if (!fin(d)) bad("nan", `block ${id}`, `demand drift is ${d}`);
    else if (Math.abs(d) > 40) bad("demand", `block ${id}`, `demand drift ${d.toFixed(1)} beyond the cap`);
  }

  // ----------------------------------------------------------- under contract
  if (s.escrow) {
    const e = s.escrow;
    const at = `escrow ${e.bbl}`;
    if (!parcels[e.bbl]) bad("escrow", at, "under contract on a parcel that does not exist");
    if (s.holdings[e.bbl]) bad("escrow", at, "under contract on a building you already own");
    if (!fin(e.price) || e.price <= 0) bad("escrow", at, `price ${e.price}`);
    if (!fin(e.deposit) || e.deposit < 0) bad("escrow", at, `deposit ${e.deposit}`);
    if (e.deposit > e.price) bad("escrow", at, "the deposit is larger than the price");
    if (e.openedM > s.month) bad("escrow", at, `opened in month ${e.openedM}, it is month ${s.month}`);
    if (e.closesM < e.openedM) bad("escrow", at, "closes before it opened");
    if (e.diligenceM > 0 && s.listings.some((l) => l.bbl === e.bbl)) {
      bad("escrow", at, "under contract and still on the market");
    }
    for (const f of e.findings) {
      if (!fin(f.cost) || f.cost < 0) bad("escrow", at, `${f.kind} finding costs ${f.cost}`);
    }
  }

  // -------------------------------------------------------------- the street
  const claimed = new Map<string, string>();
  for (const r of s.rivals ?? []) {
    const at = `rival ${r.name}`;
    if (!fin(r.cash)) bad("nan", at, `cash is ${r.cash}`);
    if (!fin(r.debt) || r.debt < 0) bad("rival", at, `debt ${r.debt}`);
    // a failed firm may still hold assets — a receiver sells the book down
    // over years — but it cannot have failed in the future
    if (r.failedM !== undefined && r.failedM > s.month) bad("rival", at, `failed in month ${r.failedM}, it is month ${s.month}`);
    for (const bbl of r.bbls) {
      if (!parcels[bbl]) { bad("rival", at, `owns ${bbl}, which is not a parcel`); continue; }
      if (s.holdings[bbl]) bad("rival", at, `owns ${bbl}, and so do you`);
      const other = claimed.get(bbl);
      if (other) bad("rival", at, `owns ${bbl}, and so does ${other}`);
      claimed.set(bbl, r.name);
    }
  }

  return v;
}

/** Throwing form, for a test that should stop at the first broken month. */
export function assertInvariants(s: GameState, parcels: ParcelTable): void {
  const v = checkInvariants(s, parcels);
  if (v.length) {
    throw new Error(`month ${s.month}: ${v.length} invariant violation(s)\n` + v.map((x) => `  [${x.code}] ${x.where}: ${x.detail}`).join("\n"));
  }
}
