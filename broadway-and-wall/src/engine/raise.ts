/**
 * A DEAL-BY-DEAL RAISE, FROM LAUNCH TO CLOSE (CAPITAL_RAISING_PLAN.md §3.3).
 *
 * The Build desk launches a raise on a planned job: offering counsel is paid
 * (sunk), the target is set, and for up to three months the sources the
 * sponsor's band opens soft-circle it (investors.ts). When the commitments
 * cover the target the job breaks ground with them; at the deadline it closes
 * small if half or more is there and the sponsor can carry the rest, and
 * fails otherwise. Nothing is drawn from the pools until the close.
 */
import type { ParcelTable } from "@/data/types";
import type { BuildingDesign, Contract, DevUse, GameState, UseMix, BtsCommitment, BuiltClass } from "./types";
import { cloneState } from "./types";
import { startDevelopment, planDevelopment, devFundingNeed, takeoutHedgeCost, takeoutHedgeRequired, siteDebtAtGroundbreak, projectedDevIrr, type TakeoutKind, type DevPlan } from "./dev";
import { lpNetIrr } from "./waterfall";
import { resolveRec } from "./value";
import { playerTerms, dealStakes, scaleMult } from "./reputation";
import { ffAvailable, syndicateBar } from "./syndicate";
import { heldByRaises, pitchAppeal, PITCH_MULT, type PitchStyle, circleMonth, commitHazard, relationshipFactor, committedTotal, openSources, payRaiseLegal, raiseLegalCost, RAISE_WINDOW_M, streetPercentile, SOURCE_LABEL, type InvestorSource, type Raise } from "./investors";
import { money } from "./money";

export interface RaiseJob {
  use: DevUse; floors: number; coverage: number; contract: Contract; ltc?: number;
  custom?: { mix?: UseMix; suites?: Partial<Record<BuiltClass, number>>; bts?: BtsCommitment; groundRetail?: "auto" | "on" | "off"; design?: BuildingDesign; takeout?: TakeoutKind };
  lender?: string; spec: number;
  /** How the offering is pitched (investors.ts PITCH_MULT); conservative if absent. */
  pitch?: PitchStyle;
}

/**
 * Can this job raise `target`? The same checks the closing will run: the
 * groundbreaking itself must pass with the money in (startDevelopment on a
 * copy), and the band must open sources that could carry it.
 */
/**
 * THE SPONSOR'S OWN SHARE of a job raising `target`: the whole cash the job
 * needs from its owners (equity, points, the hedge, the change-order margin
 * and any land loan repaid at close), less what the investors bring. A raise
 * holds this much of the sponsor's money while it is open.
 */
export function sponsorShare(s: GameState, parcels: ParcelTable, bbl: string, job: RaiseJob, target: number): number {
  const plan = planDevelopment(s, parcels, bbl, job.use, job.floors, job.coverage, job.contract, job.ltc, job.custom, job.lender, job.spec);
  if (!plan) return 0;
  const kind: TakeoutKind = job.custom?.takeout ?? (takeoutHedgeRequired(plan) ? "cap" : "float");
  const need = devFundingNeed(plan, takeoutHedgeCost(plan, kind));
  return Math.max(0, Math.round(need.whole + siteDebtAtGroundbreak(s, bbl).due - target));
}

export { heldByRaises } from "./investors";

/** The net IRR this job would pitch investors on the sponsor's terms today — what startDevelopment records. */
export function offeringPitch(s: GameState, parcels: ParcelTable, bbl: string, job: RaiseJob): number | null {
  const plan = planDevelopment(s, parcels, bbl, job.use, job.floors, job.coverage, job.contract, job.ltc, job.custom, job.lender, job.spec);
  if (!plan) return null;
  const t = playerTerms(s);
  return lpNetIrr(projectedDevIrr(plan), Math.max(1, plan.months + 12) / 12, t.hurdles, t.promotes) * PITCH_MULT[job.pitch ?? "conservative"];
}

export function raiseQuote(s: GameState, parcels: ParcelTable, bbl: string, job: RaiseJob, target: number): { ok: boolean; why?: string; legal: number } {
  const legal = raiseLegalCost(s, target);
  const bar = syndicateBar(s, bbl);
  if (bar) return { ok: false, why: bar, legal };
  const pitch = offeringPitch(s, parcels, bbl, job);
  if (pitch !== null && pitchAppeal(pitch, playerTerms(s).hurdles[0] ?? 0, playerTerms(s).band) <= 0) {
    return { ok: false, why: `Nobody invests in a deal that projects a loss — this one pitches ${(pitch * 100).toFixed(1)}% a year. Rework the scheme first.`, legal };
  }
  if (s.raises?.[bbl]) return { ok: false, why: "A raise is already open on this lot.", legal };
  if (!(target > 0)) return { ok: false, why: "Nothing to raise.", legal };
  // The groundbreaking with the money in, tried on a copy with the counsel
  // paid — and without the money the sponsor's other open raises already
  // hold, or two raises would each be underwritten on the same cash and both
  // fail at their closings.
  const t = cloneState(s);
  t.cash -= legal + heldByRaises(s, bbl);
  const r = startDevelopment(t, parcels, bbl, job.use, job.floors, job.coverage, job.contract, job.ltc, { ...(job.custom ?? {}), syndicate: { outside: target, pitch: job.pitch } }, job.lender, job.spec);
  if (r.err) return { ok: false, why: r.err, legal };
  return { ok: true, legal };
}

/** Launch a raise. Pays the offering counsel. */
export function launchRaise(s: GameState, parcels: ParcelTable, bbl: string, job: RaiseJob, target: number): { s: GameState; err?: string; msg?: string } {
  const q = raiseQuote(s, parcels, bbl, job, target);
  if (!q.ok) return { s, err: q.why };
  const next = cloneState(s);
  payRaiseLegal(next, q.legal);
  const raise: Raise = { bbl, target: Math.round(target), openedM: next.month, deadlineM: next.month + RAISE_WINDOW_M, committed: {}, legal: q.legal, job: job as unknown as Raise["job"], reserve: sponsorShare(s, parcels, bbl, job, target),
    appeal: (() => { const p = offeringPitch(s, parcels, bbl, job); const t = playerTerms(s); return p === null ? 1 : pitchAppeal(p, t.hurdles[0] ?? 0, t.band); })() };
  (next.raises ??= {})[bbl] = raise;
  const addr = resolveRec(parcels, next, bbl)?.address ?? bbl;
  const who = openSources(next, playerTerms(next).band, ffAvailable(next)).map((x) => SOURCE_LABEL[x.id].toLowerCase()).join(", ");
  next.news.unshift({ q: next.month, kind: "deal", text: `You are raising ${money(target)} for ${addr} — ${who} have the offering. Counsel cost ${money(q.legal)}, paid whatever happens. The raise has ${RAISE_WINDOW_M} months.` });
  return { s: next, msg: `Raise launched: ${money(target)}, ${RAISE_WINDOW_M} months to close.` };
}

/** Walk away from a raise. The counsel is sunk; nobody's money moves. */
export function cancelRaise(s: GameState, bbl: string): { s: GameState; err?: string } {
  if (!s.raises?.[bbl]) return { s, err: "No raise open on that lot." };
  const next = cloneState(s);
  delete next.raises![bbl];
  next.news.unshift({ q: next.month, kind: "info", text: "You pulled the raise. The counsel's bill stands; the soft circles go back to their owners." });
  return { s: next };
}

/**
 * THE MONTH'S RAISING. Mutates `s`. Each open raise collects a month of soft
 * circles; a full one closes now, an expired one closes small or fails.
 */
export function tickRaises(s: GameState, parcels: ParcelTable): void {
  if (!s.raises) return;
  for (const bbl of Object.keys(s.raises)) {
    const r = s.raises[bbl];
    const addr = resolveRec(parcels, s, bbl)?.address ?? bbl;
    if (!s.holdings[bbl] || s.developments[bbl]) { delete s.raises[bbl]; continue; }
    const sources = openSources(s, playerTerms(s).band, ffAvailable(s));
    circleMonth(s, r, sources, streetPercentile(s));
    const have = committedTotal(r);
    const full = have >= r.target;
    if (!full && s.month < r.deadlineM) continue;
    const amt = Math.min(r.target, have);
    let closed = false, why = "";
    if (amt >= 0.5 * r.target) {
      // Who closes in, scaled to the amount taken.
      const scale = have > 0 ? amt / have : 0;
      const src: Partial<Record<InvestorSource, number>> = {};
      for (const [k, v] of Object.entries(r.committed)) if (v) src[k as InvestorSource] = Math.round(v * scale);
      const job = r.job as unknown as RaiseJob;
      const res = startDevelopment(s, parcels, bbl, job.use, job.floors, job.coverage, job.contract, job.ltc, { ...(job.custom ?? {}), syndicate: { outside: amt, sources: src, clamp: true, pitch: job.pitch } }, job.lender, job.spec);
      if (!res.err) {
        Object.assign(s, res.s);
        closed = true;
      } else why = res.err;
    } else why = `only ${money(have)} of ${money(r.target)} was circled`;
    delete s.raises![bbl];
    if (closed) {
      const took = s.syndications?.[bbl]?.lpCommit ?? amt;
      s.news.unshift({ q: s.month, kind: "deal", text: `The raise for ${addr} closed${took < r.target ? ` small, at ${money(took)} of ${money(r.target)}${took < amt ? " — all the rules let investors put in" : ""}` : ` at ${money(took)}`} after ${s.month - r.openedM} month${s.month - r.openedM === 1 ? "" : "s"}. Ground is broken.` });
    } else {
      s.news.unshift({ q: s.month, kind: "warn", text: `The raise for ${addr} failed — ${why}. The counsel's ${money(r.legal)} is gone and the lot is still dirt.` });
    }
  }
}

/**
 * THE OFFERING, AS THE SPONSOR WOULD SIGN IT (Build desk). What investors are
 * told they will earn — the job's own projection after this band's
 * promote, exactly what startDevelopment records as the pitch and what the
 * record will judge — how the money splits at plan and five points short,
 * what each outcome would do to the record today, and how a raise of this
 * size usually goes with the sources the band opens.
 */
export interface RaisePreview {
  years: number;
  dealIrr: number;
  /** What the offering promises (the projection × the pitch style) — the bar the record judges. */
  pitchIrr: number;
  /** What the projection itself says investors will earn. */
  expectIrr: number;
  lpMultiple: number;
  lpOut: number;
  gpOut: number;
  gpPromote: number;
  gpMultiple: number;
  miss: { lpIrr: number; lpOut: number; gpOut: number; gpMultiple: number };
  stakes: { met: number; beat: number; miss3: number; miss8: number; lost: number };
  /** Of 200 raises of this size today: the share that fill, close small, fail; months to the close. */
  odds: { full: number; small: number; fail: number; months: number };
  /** How the pitch reads to investors (pitchAppeal), and the pref it is read against. */
  appeal: number;
  pref: number;
}

export function raisePreview(s: GameState, plan: DevPlan, landEquity: number, cashNeed: number, outside: number, pitch: PitchStyle = "conservative"): RaisePreview | null {
  if (!(outside > 0)) return null;
  const t = playerTerms(s);
  const equity = Math.max(1, landEquity + cashNeed);
  const lpCap = Math.min(outside, equity), gpCap = Math.max(1, equity - lpCap);
  const years = Math.max(1, plan.months + 12) / 12;
  const split = (irr: number) => {
    const T = Math.pow(1 + Math.max(-0.99, irr), years);
    const lpIrr = lpNetIrr(irr, years, t.hurdles, t.promotes);
    const L = Math.pow(1 + lpIrr, years);
    const lpOut = lpCap * L, gpOut = gpCap * T + lpCap * Math.max(0, T - L);
    return { lpIrr, lpOut, gpOut, gpMultiple: gpOut / gpCap, promote: lpCap * Math.max(0, T - L) };
  };
  const dealIrr = projectedDevIrr(plan);
  const at = split(dealIrr), mi = split(dealIrr - 0.05);
  // The soft circles, run 200 times on a private generator (the game's own
  // random streams are not touched): each source's monthly hazard on the
  // offering, as circleMonth draws it.
  const sources = openSources(s, t.band, ffAvailable(s));
  const pct = streetPercentile(s);
  const pitched = at.lpIrr * PITCH_MULT[pitch];
  const appeal = pitchAppeal(pitched, t.hurdles[0] ?? 0, t.band) * scaleMult(s);
  let seed = 0x9e3779b9 ^ Math.round(outside);
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  let full = 0, small = 0, fail = 0, mSum = 0;
  for (let k = 0; k < 200; k++) {
    const got: Record<string, number> = {};
    let have = 0, m = 0;
    for (m = 1; m <= RAISE_WINDOW_M; m++) {
      for (const src of sources) {
        const need = outside - have;
        if (!(need > 0)) break;
        const room = Math.max(0, src.left - (got[src.id] ?? 0));
        const c = Math.min(need, room, Math.round(outside * Math.min(0.95, commitHazard(src.id, pct) * relationshipFactor(s, src.id) * appeal) * (0.6 + 0.8 * rnd())));
        if (c > 0) { got[src.id] = (got[src.id] ?? 0) + c; have += c; }
      }
      if (have >= outside) break;
    }
    if (have >= outside) { full++; mSum += m; } else if (have >= 0.5 * outside) { small++; mSum += RAISE_WINDOW_M; } else fail++;
  }
  const closed = full + small;
  return {
    years, dealIrr, pitchIrr: pitched, expectIrr: at.lpIrr, lpMultiple: at.lpOut / lpCap, lpOut: at.lpOut, gpOut: at.gpOut, gpPromote: at.promote, gpMultiple: at.gpMultiple,
    miss: { lpIrr: mi.lpIrr, lpOut: mi.lpOut, gpOut: mi.gpOut, gpMultiple: mi.gpMultiple },
    stakes: dealStakes(s, equity, lpCap / equity),
    odds: { full: full / 200, small: small / 200, fail: fail / 200, months: closed > 0 ? mSum / closed : RAISE_WINDOW_M },
    appeal, pref: t.hurdles[0] ?? 0,
  };
}
