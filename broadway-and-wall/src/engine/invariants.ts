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
import type { BuiltClass, DevUse, GameState } from "./types";
import { resolveRec, holdingValue, holdingNOIYr, netWorth, assetValue, initialCondition, FAR_CEILING } from "./value";
import { mixOf, useSf } from "./mix";
import { MAX_FLOORS_BY_USE } from "./dev";
import { SECTORS } from "./market";

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

  // ----------------------------------------------------------------- planning
  // The envelope is the land value. A multiplier that runs away, or a variance
  // on a lot you do not own, is net worth invented out of nothing.
  for (const [d, x] of Object.entries(s.zoneAdj ?? {})) {
    if (!fin(x) || x < 0.4 || x > 3) bad("zoning", `district ${d}`, `envelope multiplier ${x}`);
  }
  for (const [bbl, x] of Object.entries(s.variance ?? {})) {
    if (!fin(x) || x < 0 || x > FAR_CEILING * 0.4) bad("zoning", `variance ${bbl}`, `granted ${x} FAR`);
  }
  if (s.varianceApp) {
    const a = s.varianceApp;
    if (a.decideM < a.filedM) bad("zoning", "variance", "a hearing that decided before it was filed");
    if (!fin(a.odds) || a.odds < 0 || a.odds > 1) bad("zoning", "variance", `odds ${a.odds}`);
  }
  // A landmark cannot also be under construction — nobody builds on one.
  for (const bbl of Object.keys(s.landmarks ?? {})) {
    if (s.developments[bbl]) bad("zoning", `landmark ${bbl}`, "landmarked and under construction at once");
  }

  // --------------------------------------------------------------- the trades
  for (const k of SECTORS) {
    const mom = s.econ.industryMom?.[k];
    if (mom !== undefined && (!fin(mom) || Math.abs(mom) > 0.06)) {
      bad("industry", "econ", `${k} momentum ${mom}`);
    }
    const ph = s.econ.industryPhase?.[k];
    if (ph !== undefined && ph !== "boom" && ph !== "steady" && ph !== "bust") {
      bad("industry", "econ", `${k} is in phase "${ph}"`);
    }
  }

  // ------------------------------------------------------------ what got built
  // SHOPS DO NOT STACK. This applies to buildings created during play only —
  // the shipped cities carry some three-storey retail as history, and that is
  // theirs to have. Anything the game itself puts up has to obey the rule, and
  // it did not: the city's growth loop was starting fifty-storey shops and the
  // planner would approve a sixty-one-storey one.
  for (const [bbl, b] of Object.entries(s.built ?? {})) {
    const cap = MAX_FLOORS_BY_USE[b.class as DevUse];
    if (cap !== undefined && b.floors > cap) {
      bad("massing", `built ${bbl}`, `${b.floors}-storey ${b.class} — the cap is ${cap}`);
    }
  }
  for (const j of s.cityJobs ?? []) {
    const cap = MAX_FLOORS_BY_USE[j.use as DevUse];
    if (cap !== undefined && j.floors > cap) {
      bad("massing", `job ${j.bbl}`, `${j.floors}-storey ${j.use} under construction — the cap is ${cap}`);
    }
  }
  for (const d of Object.values(s.developments ?? {})) {
    const cap = MAX_FLOORS_BY_USE[d.use];
    if (cap !== undefined && d.floors > cap) {
      bad("massing", `development ${d.bbl}`, `${d.floors}-storey ${d.use} — the cap is ${cap}`);
    }
  }

  // ------------------------------------------------------------- assemblage
  // A merged deed's land has moved somewhere. If the parent is gone, or the
  // child is itself a parent, the land has either vanished or been counted in
  // two places — and land that is counted twice is net worth that is wrong.
  for (const [child, parent] of Object.entries(s.merged ?? {})) {
    const at = `assemblage ${child}`;
    if (child === parent) bad("merge", at, "a lot merged into itself");
    if (!s.holdings[child]) bad("merge", at, "a merged deed you do not own");
    if (!s.holdings[parent]) bad("merge", at, `merged into ${parent}, which you do not own`);
    if (s.merged![parent]) bad("merge", at, `merged into ${parent}, which is itself merged into something else`);
  }
  for (const [bbl, gl] of Object.entries(s.groundLeases ?? {})) {
    const at = `ground lease ${bbl}`;
    if (!s.holdings[bbl]) bad("ground", at, "a ground lease on land you do not own");
    if (!fin(gl.rentYr) || gl.rentYr < 0) bad("ground", at, `ground rent ${gl.rentYr}`);
    if (gl.endM <= gl.startM) bad("ground", at, "a lease that ends before it starts");
  }

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
    // NOBODY GIVES A BUILDING AWAY. The deepest honest discount in this game is
    // a motivated seller or a receiver at about thirty per cent under; anything
    // beneath that is an arithmetic fault somewhere upstream, and it used to be
    // one — static records priced as dirt, and a compounding stale-listing
    // markdown with no floor under it. A little slack below the 70% floor for
    // a market that moved inside the month.
    {
      const lr = resolveRec(parcels, s, li.bbl);
      const v = lr ? assetValue(lr, s.econ, initialCondition(lr)) : 0;
      if (v > 0 && li.ask < v * 0.60) {
        bad("listing", `listing ${li.bbl}`, `asking ${(li.ask / 1e6).toFixed(2)}M against a ${(v / 1e6).toFixed(2)}M appraisal — ${((1 - li.ask / v) * 100).toFixed(0)}% under`);
      }
    }
  }
  // The same rule for an owner who was never selling: their number is a premium
  // to appraisal, and a fraction of it means something upstream mispriced them.
  for (const [bbl, a] of Object.entries(s.approaches)) {
    if (a.refused || !a.ask) continue;
    const ar = resolveRec(parcels, s, bbl);
    const v = ar ? assetValue(ar, s.econ, initialCondition(ar)) : 0;
    if (v > 0 && a.ask < v * 0.60) {
      bad("listing", `approach ${bbl}`, `owner asking ${(a.ask / 1e6).toFixed(2)}M against a ${(v / 1e6).toFixed(2)}M appraisal`);
    }
  }
  // SECURITY DEPOSITS. One to two months of rent, never more, never negative,
  // and never sitting on a lease that has already ended.
  for (const h of Object.values(s.holdings)) {
    for (const t of h.tenants) {
      const d = t.deposit ?? 0;
      if (d < 0 || !fin(d)) bad("deposit", `${h.bbl} ${t.name}`, `deposit ${d}`);
      const monthly = (t.rentPsf * t.sf) / 12;
      if (monthly > 0 && d > monthly * 3.2) {
        bad("deposit", `${h.bbl} ${t.name}`, `deposit is ${(d / monthly).toFixed(1)} months of rent`);
      }
    }
    // A building you have stopped letting must not be signing anybody.
    if (h.leasingHold && s.lois.some((l) => l.bbl === h.bbl)) {
      bad("leasing", `hold ${h.bbl}`, "letting is stopped and there is a live letter of intent on it");
    }
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

  // ------------------------------------------------------------ negotiations
  // A price agreed puts you under contract, and the contract is a state that
  // can go wrong in ways a negotiation cannot: a stale closing date, a deed
  // reserved on a building somebody else already took, a contract with no
  // price on it.
  if (s.talks) {
    const t = s.talks;
    const at = `talks ${t.bbl}`;
    if (!parcels[t.bbl]) bad("talks", at, "negotiating over a parcel that does not exist");
    if (s.holdings[t.bbl]) bad("talks", at, "negotiating over a building you already own");
    if (!fin(t.yourPrice) || t.yourPrice <= 0) bad("talks", at, `your price ${t.yourPrice}`);
    if (!fin(t.theirPrice) || t.theirPrice <= 0) bad("talks", at, `their price ${t.theirPrice}`);
    if (t.openedM > s.month) bad("talks", at, `opened in month ${t.openedM}, it is month ${s.month}`);
    if (t.round < 1) bad("talks", at, `round ${t.round}`);
    if (t.agreed) {
      if (!fin(t.agreedPrice ?? NaN) || (t.agreedPrice ?? 0) <= 0) bad("talks", at, `under contract at ${t.agreedPrice}`);
      if (t.closeByM === undefined) bad("talks", at, "under contract with no closing date");
      else if (t.closeByM <= s.month) bad("talks", at, `closing date ${t.closeByM} has passed and the contract is still live`);
      if (!s.listings.some((l) => l.bbl === t.bbl)) bad("talks", at, "under contract on something that is no longer for sale");
    }
  }


  // -------------------------------------------------------------- the street
  const claimed = new Map<string, string>();
  for (const r of s.rivals ?? []) {
    const at = `rival ${r.name}`;
    if (!fin(r.cash)) bad("nan", at, `cash is ${r.cash}`);
    if (!fin(r.debt) || r.debt < 0) bad("rival", at, `debt ${r.debt}`);
    // The street keeps books now — a cost basis, tax paid, distributions — so
    // those have to stay coherent too. A negative basis means a sale relieved
    // more basis than was ever put in, which would be a firm printing losses.
    if (r.basis !== undefined && (!fin(r.basis) || r.basis < 0)) bad("rival", at, `cost basis ${r.basis}`);
    if (r.taxPaid !== undefined && (!fin(r.taxPaid) || r.taxPaid < 0)) bad("rival", at, `lifetime tax ${r.taxPaid}`);
    if (r.distributed !== undefined && (!fin(r.distributed) || r.distributed < 0)) bad("rival", at, `distributions ${r.distributed}`);
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
