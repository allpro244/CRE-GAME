/**
 * INVESTOR REPUTATION — how the people who write equity cheques read a
 * sponsor (CAPITAL_RAISING_PLAN.md §3.4).
 *
 * Two linked numbers per firm:
 *   - a TRACK-RECORD SCORE, −100..+100, the evidence from the firm's own
 *     realised record, judged against what it promised. The player starts
 *     at 0.
 *   - an INVESTOR RANK, the score's place among every living firm. Strict:
 *     exactly one #1, no ties. Investor confidence is a relative good —
 *     each year's money goes to whoever looks best against everyone else
 *     asking (fundraising concentration in private real estate is
 *     well documented; PERE / Preqin fundraising league tables).
 * The band investors act on is the lower of the rank's band and the score's
 * floor band, so the best of a weak field does not unlock pensions.
 *
 * A READOUT OF FACTS, NOT XP. Nothing grants reputation; it is recomputed
 * from the ledger. Scope is investors only: lenders (sponsor.ts), sellers'
 * memory of lowballs and brokers' goodwill are untouched and do not read it.
 *
 * Every number below that is not a citation is a STARTING DESIGN for the
 * owner's intent ("really hard to raise money at the beginning … screwing up
 * has a big impact"), labelled as a shape parameter, to be measured.
 */
import type { Econ, GameState, Rival } from "./types";

export type Band = "Toxic" | "Questioned" | "Unknown" | "Emerging" | "Proven" | "Institutional" | "Blue-chip";
export const BANDS: Band[] = ["Toxic", "Questioned", "Unknown", "Emerging", "Proven", "Institutional", "Blue-chip"];
export const bandIdx = (b: Band) => BANDS.indexOf(b);

/** The reference deal: ~$2M of equity in opening-year dollars, carried at inflation. Shape parameter. */
export const REF_EQUITY = 2_000_000;
/** Shrinkage on positive evidence: shrink(x) = x·N/(N+K). Shape parameter. */
export const SHRINK_K = 4;
/** An own-money deal's evidence counts at 90% of an investor deal's. Shape parameter. */
export const OWN_WEIGHT = 0.9;
/** A record goes stale after 7 quiet years and reaches nothing 10 years later. Shape parameters. */
const QUIET_M = 84, FADE_M = 120, DROP_M = 360, NEG_FADE_M = 120, MISCONDUCT_FADE_M = 240;

const priceLevel = (e: Econ) => (e.priceLevel ?? 1) * (e.cpi ?? 1);

/** One piece of evidence on a firm's record. */
export interface Evidence {
  /** Month the result was realised. */
  m: number;
  /** Signed evidence after fault, size, alignment and own-money weights. */
  ev: number;
  /** Size weight (for experience N); 0 for a credit event. */
  size: number;
  kind: "own" | "investor" | "credit" | "derived" | "warning" | "misconduct";
  label: string;
  /** A broken guarantee or the like: fades over 20 years, and keeps the firm Toxic while it lives. */
  misconduct?: boolean;
}

/**
 * THE OUTCOME TABLE (§3.4): investors' actual IRR against the pitch, and their
 * multiple. Making money is not enough — delivering less than promised
 * counts against the sponsor. Rates are fractions (0.12 = 12%).
 */
export function outcomeEvidence(actual: number | null | undefined, pitch: number | null | undefined, multiple: number): number {
  if (multiple < 0.4) return -60;
  if (multiple < 0.7) return -45;
  if (multiple < 0.9) return -30;
  if (multiple < 1.0) return -20;
  // A deal with no recorded plan, or an IRR that did not solve, is judged on
  // the money alone: capital back with a profit is a promise met.
  if (actual == null || pitch == null || !Number.isFinite(actual) || !Number.isFinite(pitch)) return 4;
  const d = actual - pitch;
  if (d >= 0.05 && multiple >= 1.8) return 8;   // capped: the biggest beats are partly luck
  if (d >= 0.02) return 6;
  if (d > -0.02) return 4;
  if (d > -0.05) return -8;
  return -15;
}

/**
 * OWN MONEY ON ITS MULTIPLE. Nobody was pitched, so there is no promise to
 * beat — but the deeds show what was paid and what it is worth, and a firm
 * that tripled its equity has shown more than one that got its money back
 * with a little on top. A loss reads off the outcome table as before.
 */
export function ownMoneyEvidence(multiple: number): number {
  if (multiple < 1) return outcomeEvidence(null, null, multiple);
  if (multiple >= 2.5) return 8;
  if (multiple >= 1.6) return 6;
  return 4;
}

/**
 * HELD, AT THE MARK (owner, Oct 2026: "the highest returns by net worth,
 * never selling, and still a tiny investor reputation"). A track record in
 * the business carries unrealised deals at their appraised value, discounted
 * because a mark is not a sale. A deed held two years or more counts at 60%
 * of what the same multiple would earn realised, a loss as well as a gain
 * (both are estimates), weighed against the whole book; within 10% of cost a
 * mark is noise and counts for nothing. It is dated today and
 * so does not fade while the deed is held; once sold, the exit replaces it.
 */
export const UNREALISED_WEIGHT = 0.6;
const UNREALISED_MIN_Y = 2;

/** A deal's size weight: (equity ÷ reference)^(1/3) — diminishing returns, so one mega-deal cannot swamp a record. */
export function sizeWeight(equity: number, level = 1): number {
  return equity > 0 ? Math.cbrt(equity / (REF_EQUITY * Math.max(1e-6, level))) : 0;
}

/**
 * HOW MUCH OF THE BOOK A BAD RESULT WAS: ×0.6 for a sliver, ×2.0 for the
 * whole of it (§3.4). A promise broken to investors is never a sliver
 * (owner, Oct 2026: a broken promise must weigh far more than a kept one):
 * it counts at least in full, and more when the deal was much of the book.
 */
function concentration(share: number, promised: boolean): number {
  const c = 0.6 + 1.4 * Math.min(1, Math.max(0, share));
  return promised ? Math.max(1, c) : c;
}

/** The city's value index at month m (office rent over office cap), for the market-wide fault test. */
function marketIndex(s: GameState, m: number): number | null {
  const h = s.econ.history ?? [];
  let best = null as null | (typeof h)[number];
  for (const p of h) { if (p.q <= m) best = p; else break; }
  if (!best || !(best.capOffice > 0) || !(best.rentOffice > 0)) return null;
  return best.rentOffice / best.capOffice;
}

/**
 * MARKET-WIDE OR YOURS. A miss in a market whose values fell 10% or more over
 * the hold is mostly the market's (×0.5 on negative evidence, §3.4); otherwise
 * it is the deal's (×1). Read off the city's own value index; peers' realised
 * deals will replace it when rivals carry per-deal ledgers.
 */
function faultMult(s: GameState, fromM: number, toM: number): number {
  const a = marketIndex(s, fromM), b = marketIndex(s, toM);
  return a && b && b / a <= 0.9 ? 0.5 : 1;
}

/** The player's realised record, as evidence. */
export function playerEvidence(s: GameState): Evidence[] {
  const out: Evidence[] = [];
  const exits = (s.exits ?? []).filter((e) => e.irr !== undefined && (e.equityIn ?? 0) > 0);
  const closed = s.synClosed ?? [];
  const level = priceLevel(s.econ);
  // Bad results scale by the deal's share of all the equity the sponsor has
  // ever put to work (×0.6 for a sliver, ×2.0 for the whole book).
  let managed = 0;
  for (const e of exits) managed += e.equityIn ?? 0;
  for (const e of exits) {
    const syn = closed.find((c) => !c.recap && c.bbl === e.bbl && Math.abs(c.closedM - e.soldM) <= 2);
    let actual: number | null | undefined, pitch: number | null | undefined, multiple: number, equity: number, outside = 0, gpShare = 1;
    if (syn && syn.lpIn > 0) {
      actual = syn.lpIrr;
      pitch = syn.pitchIrr ?? e.planIrr;
      multiple = syn.lpOut / syn.lpIn;
      equity = syn.lpIn + syn.gpIn;
      outside = syn.lpIn / equity;
      gpShare = syn.gpIn / equity;
    } else {
      // OWN MONEY IS JUDGED AS A RIVAL'S OWN-MONEY SALE IS (rivalEvidence):
      // nobody outside the firm saw a pitch, so there is no promise to miss.
      // The deeds show what it paid and what it sold for, so a loss is on the
      // record at its multiple; a sale on the firm's own schedule at a profit
      // is a promise met; one on its lender's schedule is the table's "missed
      // the plan" row. (It used to be judged against the firm's own
      // underwriting, which rivals never were: a $138M firm with ten good
      // deals sold a $111K lot below its development plan and ranked 91st of
      // 92 — "Questioned" — for four years.)
      actual = null;
      pitch = null;
      multiple = (e.equityOut ?? 0) / (e.equityIn ?? 1);
      // (judged on its multiple below — ownMoneyEvidence)
      equity = e.equityIn ?? 0;
    }
    // Sizes are measured in opening-year dollars: deflate by the price level
    // at realisation (the nearest the record keeps to the deal's own vintage).
    const size = sizeWeight(equity, level);
    let ev = syn ? outcomeEvidence(actual, pitch, multiple) : ownMoneyEvidence(multiple);
    if (!syn && e.forced) ev = Math.min(ev, -8);
    // A good result is weighted by the deal's size. A PROMISE BROKEN TO
    // INVESTORS IS NOT: however small the deal, people who were told one
    // thing got another, and that counts in full (owner, Oct 2026: a broken
    // promise must weigh far more than a kept one). An own-money loss
    // broke no promise, so it is weighted by size like a gain — a small
    // deal's miss says as little about a sponsor as a small deal's beat.
    if (ev > 0) ev *= size;
    else if (syn?.misconduct) {
      // A broken completion guarantee is the sponsor's, never the market's: ×2 (§3.4).
      ev *= 2 * concentration(equity / Math.max(1, managed), true);
    } else {
      if (!syn) ev *= size;
      ev *= faultMult(s, e.boughtM, e.soldM);
      ev *= concentration(equity / Math.max(1, managed), !!syn);
      if (gpShare >= 0.10) ev *= 0.85;   // the sponsor's own money suffered alongside
    }
    // Own-money evidence counts at 90%; a deal blends by its outside share, so
    // a token raise cannot turn an own-money deal into an investor one.
    ev *= OWN_WEIGHT + (1 - OWN_WEIGHT) * outside;
    out.push({ m: e.soldM, ev, size: ev > 0 ? size : 0, kind: syn ? "investor" : "own", label: e.address });
  }
  // THE BOOK STILL HELD, at the quarterly mark (see UNREALISED_WEIGHT).
  // A mark is weighed against the whole book — realised and still held.
  const heldBook = (s.reputation?.held ?? []).reduce((a, d) => a + Math.max(0, d.eqIn), 0);
  for (const d of s.reputation?.held ?? []) {
    if (d.years < UNREALISED_MIN_Y || !(d.eqIn > 0)) continue;
    // Within 10% of cost an appraisal is noise, not a result.
    if (d.mult >= 0.9 && d.mult < 1) continue;
    const size = sizeWeight(d.eqIn, level);
    let ev = ownMoneyEvidence(d.mult);
    // An estimate both ways: a held loss is discounted as a held gain is.
    if (ev > 0) ev *= size * UNREALISED_WEIGHT;
    else ev *= size * UNREALISED_WEIGHT * concentration(d.eqIn / Math.max(1, managed + heldBook), false);
    ev *= OWN_WEIGHT;
    out.push({ m: s.month, ev, size: ev > 0 ? size * UNREALISED_WEIGHT : 0, kind: "own", label: `${d.mult.toFixed(2)}x held, at the mark` });
  }
  // WHAT THE FIRM'S GROWTH IMPLIES (owner, Oct 2026: the wealthiest firm in
  // town must have leverage with investors). A rival on the opening roster is
  // credited the record its equity implies (rivalEvidence: 2·log2(equity ÷
  // reference deal), at most 10, each a promise met at 15% of the firm). The
  // player is held to the same rule on what it BUILT: the record today's net
  // worth implies, less what its starting cash implied — starting rich earns
  // nothing. It is the firm's scale as evidence, as the rivals' is; the deeds
  // themselves (sold, or held at the mark) count on top, so a firm that grew
  // on good buildings always reads better than one that grew on nothing.
  {
    const implied = (eq: number) => eq > REF_EQUITY * level ? Math.min(10, Math.floor(2 * Math.log2(eq / (REF_EQUITY * level)))) : 0;
    const nw = Math.max(0, s.nwHistory?.[s.nwHistory.length - 1] ?? 0);
    const start = Math.max(0, s.nwHistory?.[0] ?? 0);
    // Both ends at today's prices, so a moving price level manufactures no growth.
    const fill = nw > start ? Math.max(0, implied(nw) - implied(start)) : 0;
    const size = sizeWeight(0.15 * nw, level);
    for (let i = 0; i < fill; i++) out.push({ m: s.month, ev: 4 * size * OWN_WEIGHT, size, kind: "derived", label: "the record the firm's growth implies" });
  }
  // A RECAP BUYOUT IS A REALISED EXIT to the investors bought out (recap.ts):
  // judged like any wound-up deal, though the deed never sold.
  for (const c of closed) {
    if (!c.recap || !(c.lpIn > 0)) continue;
    const equity = c.lpIn + c.gpIn;
    const multiple = c.lpOut / c.lpIn;
    const size = sizeWeight(equity, level);
    let ev = outcomeEvidence(c.lpIrr, c.pitchIrr, multiple);
    if (ev > 0) ev *= size;
    else {
      ev *= concentration(equity / Math.max(1, managed + equity), true);
      if (c.gpIn / equity >= 0.10) ev *= 0.85;
    }
    ev *= OWN_WEIGHT + (1 - OWN_WEIGHT) * (c.lpIn / equity);
    out.push({ m: c.closedM, ev, size: ev > 0 ? size : 0, kind: "investor", label: `${c.address} (bought out)` });
  }
  // BOUGHT OUT CHEAP. A building sold within 24 months of a buyout for more
  // than 15% above the appraisal the investors were paid on: −10, and the
  // investors remember it (§4.5).
  for (const r of s.recaps ?? []) {
    const e = (s.exits ?? []).find((x) => x.bbl === r.bbl && x.soldM >= r.m && x.soldM - r.m <= 24);
    if (e && r.value > 0 && e.price > 1.15 * r.value) out.push({ m: e.soldM, ev: -10, size: 0, kind: "credit", label: `${e.address}: sold ${Math.round((e.price / r.value - 1) * 100)}% over the buyout appraisal` });
  }
  // A WOUND-UP FUND (fund.ts settleFund) is an investor vehicle realised: its
  // LPs judge it on what came back (the fund does not carry a pitched IRR, so
  // the multiple speaks), sized by its commitments.
  for (const f of s.fundHistory ?? []) {
    if (!(f.called > 0)) continue;
    const multiple = f.distributed / f.called;
    const size = sizeWeight(f.size, level);
    let ev = outcomeEvidence(null, null, multiple);
    if (ev > 0) ev *= size;
    else {
      ev *= faultMult(s, f.raisedM, f.closedM);
      ev *= concentration(f.called / Math.max(1, managed + f.called), true);
      if (f.gpCommit / Math.max(1, f.size) >= 0.10) ev *= 0.85;
    }
    out.push({ m: f.closedM, ev, size: ev > 0 ? size : 0, kind: "investor", label: `Your fund, ${multiple.toFixed(2)}x to its LPs` });
  }
  // MISCONDUCT (§3.4): a deed lost while its syndicated job was still in the
  // ground broke the completion guarantee — a separate −25 on top of the
  // outcome, fading over 20 years, Toxic while it lives.
  for (const c of closed) if (c.misconduct) out.push({ m: c.closedM, ev: -25, size: 0, kind: "misconduct", label: `${c.address}: completion guarantee broken`, misconduct: true });
  // WARNING SIGNS on live deals (syndicate.ts reviewSyndications): −3 a flag,
  // at most −10 a deal, provisional until the deal's real result replaces it.
  for (const w of Object.values(s.syndications ?? {})) {
    const n = w.flags?.length ?? 0;
    if (n > 0) out.push({ m: s.month, ev: Math.max(-10, -3 * n), size: 0, kind: "warning", label: `Investor report flags on a live deal: ${w.flags!.join(", ")}` });
  }
  // Credit events not already inside a realised deal's outcome.
  for (const c of s.sponsor?.events ?? []) {
    const inside = (s.exits ?? []).some((e) => e.address === c.address && Math.abs(e.soldM - c.m) <= 3 && e.irr !== undefined);
    if (inside) continue;
    out.push({ m: c.m, ev: -30, size: 0, kind: "credit", label: `${c.kind === "forced" ? "Forced sale" : c.kind === "deficiency" ? "Deficiency" : c.kind === "seized" ? "Seizure" : "Discounted payoff"} · ${c.address}` });
  }
  return out;
}

/**
 * A RIVAL'S RECORD (§3.4 "Rivals": same formula, same record).
 *   - PREHISTORY, derived. A firm on the opening roster raised its equity
 *     from investors before the game began, and that capital is the evidence
 *     of a record: 2·log2(equity ÷ reference deal) realised deals, at most
 *     10, dated back from month 0 at three-year intervals, each sized at 15%
 *     of the firm's opening equity and taken as a promise met. $4M of equity
 *     implies 2; $16M, 6; $64M or more, 10. (Shape parameters; the way
 *     regime.ts runs a prehistory for the economy.) It fades like any record
 *     once the firm stops realising deals.
 *   - IN THE GAME, observed. Every deed that left the book is a row on
 *     `Rival.realised` (rivals.ts noteRealised), through the same outcome
 *     table, size, fault and concentration rules as the player's exits:
 *       a syndicated deed on its deal investors' realised IRR against the
 *       net IRR the offering pitched them (rivals.ts jvFund — the job's
 *       projection after the promote, the player's own rule), and on their
 *       multiple; a deal raised before pitches were recorded is judged on the
 *       money alone, as a player deal with no recorded plan is;
 *       a deed lost to its lender at 0x;
 *       an own-money sale, whose multiple nobody outside the firm can see,
 *       as a promise met when the firm sold on its own schedule and as the
 *       table's "missed the plan" row (−8) when it sold in trouble — it sold
 *       on its lender's schedule, not its own.
 *   - A firm in stress (six or more months in trouble) carries a live miss,
 *     −15, halved when the whole city fell with it.
 * It replaced a tenure stand-in (one promise met every three years alive),
 * which credited a firm for existing while the player was credited only for
 * what it sold: a $2.5M start that compounded to $43M over fifty years with
 * a 2.18x deal on its record still ranked 20th of 21 (career bot, seed 9702).
 * Measured and printed by test/reputation.mjs.
 */
export function rivalEvidence(s: GameState, r: Rival): Evidence[] {
  const out: Evidence[] = [];
  const level = priceLevel(s.econ);
  if (r.bornM <= 0) {
    // What it opened with: the first yearly point, or today's mark before one exists.
    const eqNow = Math.max(0, (r.aum ?? 0) - r.debt + r.cash);
    const firstEq = Math.max(0, r.eqHist?.length ? r.eqHist[0][1] : eqNow);
    const implied = firstEq > REF_EQUITY ? Math.min(10, Math.floor(2 * Math.log2(firstEq / REF_EQUITY))) : 0;
    const size = sizeWeight(0.15 * firstEq, 1);
    for (let i = 1; i <= implied; i++) out.push({ m: -36 * i, ev: 4 * size, size, kind: "derived", label: "realised before the game (derived)" });
  }
  const rows = r.realised ?? [];
  let managed = 0;
  for (const d of rows) managed += d.eq;
  for (const d of rows) {
    const size = sizeWeight(d.eq, level);
    let ev = d.mult !== undefined ? outcomeEvidence(d.irr, d.pitch, d.mult) : d.forced ? -8 : 4;
    if (ev > 0) ev *= size;
    else {
      if (!d.lp) ev *= size;   // own money: no promise broken (see playerEvidence)
      ev *= faultMult(s, d.m - 36, d.m);
      ev *= concentration(d.eq / Math.max(1, managed), !!d.lp);
      if (d.lp) ev *= 0.85;   // the sponsor's co-invest suffered alongside
    }
    ev *= d.lp ? 1 : OWN_WEIGHT;
    out.push({ m: d.m, ev, size: ev > 0 ? size : 0, kind: d.lp ? "investor" : "own", label: d.mult === 0 ? "a deed lost" : d.mult !== undefined ? `investors got ${d.mult.toFixed(2)}x` : d.forced ? "sold in trouble" : "a deed sold" });
  }
  for (const h of r.heritage ?? []) out.push({ m: h.m, ev: h.ev, size: h.size, kind: "derived", label: `the team's record at ${r.spawnedFrom?.firmName ?? "its last firm"}` });
  if ((r.stressMs ?? 0) >= 6) out.push({ m: s.month, ev: -15 * faultMult(s, s.month - 36, s.month), size: 0, kind: "derived", label: "in stress" });
  return out;
}

/**
 * A SPINOUT CARRIES PART OF THE TEAM'S RECORD (§3.4 "Rivals"): track-record
 * portability is partial in practice — investors credit the people who did the
 * deals, but not all of a platform's results were theirs — so a third to a
 * half of the parent's positive evidence comes with them, here 0.4 (a shape
 * parameter at the middle of that range), dated as it was so it fades on the
 * same clock. None of the parent's losses or marks.
 */
export const HERITAGE_SHARE = 0.4;
export function inheritRecord(s: GameState, parent: Rival): { m: number; ev: number; size: number }[] {
  return rivalEvidence(s, parent)
    .filter((e) => e.ev > 0 && s.month - e.m <= DROP_M)
    .sort((a, b) => b.m - a.m)
    .slice(0, 30)
    .map((e) => ({ m: e.m, ev: Math.round(e.ev * HERITAGE_SHARE * 100) / 100, size: Math.round(e.size * HERITAGE_SHARE * 1000) / 1000 }));
}

/**
 * WHAT ONE MORE INVESTOR DEAL WOULD DO TO THE RECORD, today, by outcome —
 * the same weights playerEvidence gives a realised syndicate: size on a kept
 * promise, the concentration floor of ×1 on a broken one, ×0.85 when the
 * sponsor's own money is in at 10% or more, and the own-money blend. For the
 * Build desk, so the sponsor sees what it is staking before it pitches.
 */
export function dealStakes(s: GameState, equity: number, outsideShare: number): { met: number; beat: number; miss3: number; miss8: number; lost: number } {
  const ev0 = playerEvidence(s);
  const base = scoreOf(ev0, s.month).score;
  let managed = 0;
  for (const e of s.exits ?? []) if (e.irr !== undefined && (e.equityIn ?? 0) > 0) managed += e.equityIn ?? 0;
  const size = sizeWeight(equity, priceLevel(s.econ));
  const blend = OWN_WEIGHT + (1 - OWN_WEIGHT) * outsideShare;
  const neg = concentration(equity / Math.max(1, managed + equity), true) * (1 - outsideShare >= 0.10 ? 0.85 : 1) * blend;
  const at = (ev: number) => {
    const w = ev > 0 ? ev * size * blend : ev * neg;
    return scoreOf([...ev0, { m: s.month, ev: w, size: w > 0 ? size : 0, kind: "investor", label: "" }], s.month).score - base;
  };
  return { met: at(4), beat: at(6), miss3: at(-8), miss8: at(-15), lost: at(-30) };
}

/** Score a record at month `now`: shrink(positive) + negative, with fading. */
export function scoreOf(ev: Evidence[], now: number): { score: number; n: number; deals: number; investorDeals: number; misconduct: boolean } {
  const live = ev.filter((e) => now - e.m <= DROP_M);
  const lastPos = live.reduce((a, e) => (e.ev > 0 ? Math.max(a, e.m) : a), -Infinity);
  const quiet = now - lastPos;
  const posFade = quiet <= QUIET_M ? 1 : Math.max(0, 1 - (quiet - QUIET_M) / FADE_M);
  let pos = 0, neg = 0, n = 0, deals = 0, investorDeals = 0, misconduct = false;
  for (const e of live) {
    if (e.ev > 0) { pos += e.ev * posFade; n += e.size * posFade; deals++; if (e.kind === "investor") investorDeals++; }
    else if (e.ev < 0) {
      const fade = e.misconduct ? MISCONDUCT_FADE_M : NEG_FADE_M;
      const f = Math.max(0, 1 - (now - e.m) / fade);
      neg += e.ev * f;
      if (e.misconduct && f > 0) misconduct = true;
    }
  }
  const shrunk = pos * (n / (n + SHRINK_K));
  return { score: Math.max(-100, Math.min(100, shrunk + neg)), n, deals, investorDeals, misconduct };
}

/** The highest band a score and record allow, before rank (§3.4, floors). */
export function floorBand(sc: { score: number; n: number; deals: number; investorDeals: number; misconduct?: boolean }, fund = false): Band {
  if (sc.score < -40 || sc.misconduct) return "Toxic";
  if (sc.score < -10) return "Questioned";
  if (sc.score >= 55 && sc.n >= 12 && sc.deals >= 4 && fund) return "Blue-chip";
  // Institutional money wants to have seen the firm handle someone else's
  // money — or a long enough record on its own that the question answers
  // itself: a dozen good deals of size (a family office that compounded).
  if (sc.score >= 40 && sc.n >= 8 && sc.deals >= 3 && (sc.investorDeals >= 1 || (sc.n >= 12 && sc.deals >= 6))) return "Institutional";
  if (sc.score >= 25 && sc.n >= 3 && sc.deals >= 2) return "Proven";
  if (sc.score >= 10) return "Emerging";
  return "Unknown";
}

/** The band a rank holds among `of` firms: top 5% (at least #1), next 10%, 20%, 27%, bottom 38%. */
export function rankBand(rank: number, of: number): Band {
  // Top 5% (was 3%): Blue-chip still needs a fund that returned its capital
  // (floorBand), so this opens the band to the few firms that have run one,
  // not to size alone.
  const blue = Math.max(1, Math.round(0.05 * of));
  const inst = blue + Math.round(0.10 * of);
  const proven = inst + Math.round(0.20 * of);
  const emerging = proven + Math.round(0.27 * of);
  if (rank <= blue) return "Blue-chip";
  if (rank <= inst) return "Institutional";
  if (rank <= proven) return "Proven";
  if (rank <= emerging) return "Emerging";
  return "Unknown";
}

const minBand = (a: Band, b: Band) => (bandIdx(a) <= bandIdx(b) ? a : b);

/**
 * WHAT THE NEXT BAND NEEDS, against what the record has today — the floors
 * (floorBand) and the rank cut (rankBand) as checklist rows, for the
 * Investors page. Misconduct is its own row: nothing else counts while it lives.
 */
export function nextBandNeeds(s: GameState): { next: Band; rows: { label: string; have: string; need: string; ok: boolean }[] } | null {
  const cur = s.reputation?.band ?? "Unknown";
  const i = bandIdx(cur);
  if (i >= BANDS.length - 1) return null;
  const next = BANDS[i + 1];
  const sc = scoreOf(playerEvidence(s), s.month);
  const me = rankStreet(s).find((x) => x.id === "you");
  const of = Math.max(1, rankStreet(s).length);
  const rows: { label: string; have: string; need: string; ok: boolean }[] = [];
  const f1 = (x: number) => x.toFixed(1);
  if (sc.misconduct) rows.push({ label: "Misconduct on the record", have: "live", need: "faded (20 years)", ok: false });
  const floor: Partial<Record<Band, { score: number; n?: number; deals?: number; inv?: number; fund?: boolean }>> = {
    Questioned: { score: -40 }, Unknown: { score: -10 }, Emerging: { score: 10 },
    Proven: { score: 25, n: 3, deals: 2 }, Institutional: { score: 40, n: 8, deals: 3, inv: 1 }, "Blue-chip": { score: 55, n: 12, deals: 4, fund: true },
  };
  const f = floor[next];
  if (f) {
    rows.push({ label: "Track-record score", have: f1(sc.score), need: `${f.score}+`, ok: sc.score >= f.score });
    if (f.n) rows.push({ label: "Experience (deals weighted by size)", have: f1(sc.n), need: `${f.n}+`, ok: sc.n >= f.n });
    if (f.deals) rows.push({ label: "Good deals (sold, or held 2+ years at the mark)", have: String(sc.deals), need: `${f.deals}+`, ok: sc.deals >= f.deals });
    if (f.inv) {
      const longOwn = sc.n >= 12 && sc.deals >= 6;
      rows.push({ label: "…one with outside investors, or 6+ deals and 12+ experience on your own", have: `${sc.investorDeals} with investors · ${sc.deals} deals, ${f1(sc.n)}`, need: `1+ · or 6+ and 12+`, ok: sc.investorDeals >= f.inv || longOwn });
    }
    if (f.fund) { const ok = (s.fundHistory ?? []).some((x) => x.called > 0 && x.distributed >= x.called); rows.push({ label: "A fund that returned its capital", have: ok ? "yes" : "no", need: "yes", ok }); }
  }
  // The rank cut: the lowest rank that still holds `next` (rankBand), for bands the rank gates.
  if (bandIdx(next) >= bandIdx("Emerging") && me) {
    let cut = 0;
    for (let r = 1; r <= of; r++) if (bandIdx(rankBand(r, of)) >= bandIdx(next)) cut = r;
    const best = Math.min(me.rank, me.sizeRank);
    rows.push({ label: "Rank on the street (record or size)", have: `#${me.rank} by record · #${me.sizeRank} by size`, need: `#${cut} or better on either`, ok: best <= cut });
  }
  return { next, rows };
}

/** Rivals' styles that run outside capital as a matter of course (count as a realised investor vehicle). */
const INSTITUTIONAL_STYLES = new Set(["core", "pe", "reit", "opportunistic", "merchant", "foreign"]);

export interface FirmStanding { id: string; name: string; score: number; n: number; rank: number; band: Band; sizeRank: number; eq: number }

/** A firm's equity as investors see it: the player's net worth, a rival's book less its debt plus its cash. */
function firmEq(s: GameState, r?: Rival): number {
  if (!r) return Math.max(0, s.nwHistory?.[s.nwHistory.length - 1] ?? 0);
  return Math.max(0, (r.aum ?? 0) - r.debt + r.cash);
}
const maxBand = (a: Band, b: Band) => (bandIdx(a) >= bandIdx(b) ? a : b);

/**
 * SCALE OPENS DOORS (owner, Oct 2026). Money follows the biggest names:
 * fundraising concentrates in the largest managers, who also draw on capital
 * from well beyond their own city. A firm's place on the street BY EQUITY
 * multiplies what investors put in per dollar of its own, how fast they
 * commit, and how much out-of-town money it can reach — 1x at the median
 * firm, rising to 2x at the top. Read from the quarterly ranking.
 */
export function scaleMult(s: GameState): number {
  const r = s.reputation;
  if (!r?.sizeRank || !(r.of > 1)) return 1;
  const pct = (r.of - r.sizeRank) / (r.of - 1);
  return 1 + Math.pow(Math.max(0, (pct - 0.5) / 0.5), 2);
}

/**
 * THE STREET'S RANKING. Every living firm, scored and placed. Ties break
 * deterministically — score, then experience, then age, then id — so no RNG
 * stream is drawn and the economy's random draws never move.
 */
export function rankStreet(s: GameState): FirmStanding[] {
  const rows: { id: string; name: string; sc: ReturnType<typeof scoreOf>; bornM: number; fund: boolean; inst: boolean; eq: number }[] = [];
  const pe = playerEvidence(s);
  // Blue-chip needs a realised fund that returned its capital.
  const fundDone = (s.fundHistory ?? []).some((f) => f.called > 0 && f.distributed >= f.called);
  rows.push({ id: "you", name: "You", sc: scoreOf(pe, s.month), bornM: 0, fund: fundDone, inst: false, eq: firmEq(s) });
  for (const r of s.rivals ?? []) {
    if (r.failedM !== undefined || r.retiredM !== undefined) continue;
    rows.push({ id: r.id, name: r.name, sc: scoreOf(rivalEvidence(s, r), s.month), bornM: r.bornM, fund: false, inst: INSTITUTIONAL_STYLES.has(r.style), eq: firmEq(s, r) });
  }
  rows.sort((a, b) => b.sc.score - a.sc.score || b.sc.n - a.sc.n || a.bornM - b.bornM || (a.id < b.id ? -1 : 1));
  const of = rows.length;
  // The street by size, for the better of the two rank bands: a firm among
  // the biggest gets the meeting its record alone would not — but never past
  // the floors its record sets (floorBand), so size cannot buy a pension's
  // money for a firm that has never handled anyone else's.
  const bySize = [...rows].sort((a, b) => b.eq - a.eq || (a.id < b.id ? -1 : 1));
  const sizeRank = new Map(bySize.map((x, i) => [x.id, i + 1]));
  return rows.map((x, i) => {
    const sc = x.inst && x.sc.investorDeals === 0 ? { ...x.sc, investorDeals: x.sc.deals } : x.sc;
    const sr = sizeRank.get(x.id) ?? of;
    return { id: x.id, name: x.name, score: Math.round(x.sc.score * 10) / 10, n: x.sc.n, rank: i + 1, sizeRank: sr, eq: x.eq,
      band: minBand(maxBand(rankBand(i + 1, of), rankBand(sr, of)), floorBand(sc, x.fund)) };
  });
}

/** What the player's record and rank say today, with the breakdown. */
export interface Reputation {
  score: number;
  n: number;
  deals: number;
  rank: number;
  of: number;
  /** 100 = #1, 0 = last. */
  percentile: number;
  /** The band computed today (before the stability rule). */
  bandNow: Band;
  /** The band investors act on (after the stability rule). */
  band: Band;
  evidence: Evidence[];
}

export function reputationNow(s: GameState): Reputation {
  const street = rankStreet(s);
  const me = street.find((x) => x.id === "you")!;
  const ev = playerEvidence(s);
  const sc = scoreOf(ev, s.month);
  const of = street.length;
  return {
    score: me.score, n: sc.n, deals: sc.deals, rank: me.rank, of,
    percentile: of > 1 ? Math.round(100 * (of - me.rank) / (of - 1)) : 100,
    bandNow: me.band, band: s.reputation?.band ?? "Unknown", evidence: ev,
  };
}

/**
 * THE QUARTERLY READ (investor-reporting cadence). Mutates `s.reputation`.
 * Downgrades are immediate; an upgrade needs two consecutive quarters at the
 * new band, so one quarter's noise does not flip it.
 */
export function updateReputation(s: GameState, held?: { bbl: string; equityIn: number; multiple: number; years: number }[]): void {
  // The unrealised record is read off the marks first, so this quarter's ranking sees it.
  if (held) {
    const marks = held.map((d) => ({ bbl: d.bbl, eqIn: Math.round(d.equityIn), mult: Math.round(d.multiple * 1000) / 1000, years: Math.round(d.years * 10) / 10 }));
    s.reputation = { ...(s.reputation ?? { band: "Unknown", score: 0, rank: 0, of: 0, m: s.month }), held: marks };
  }
  const r = reputationNow(s);
  const cur: { band: Band; pending?: Band; pendingQ?: number } = s.reputation ?? { band: "Unknown" };
  let band = cur.band, pending = cur.pending, pendingQ = cur.pendingQ ?? 0;
  if (bandIdx(r.bandNow) < bandIdx(band)) { band = r.bandNow; pending = undefined; pendingQ = 0; }
  else if (bandIdx(r.bandNow) > bandIdx(band)) {
    if (pending === r.bandNow && pendingQ >= 1) { band = r.bandNow; pending = undefined; pendingQ = 0; }
    else { pending = r.bandNow; pendingQ = pending === cur.pending ? pendingQ + 1 : 1; }
  } else { pending = undefined; pendingQ = 0; }
  if (band !== cur.band) {
    s.news.unshift({
      q: s.month, kind: bandIdx(band) > bandIdx(cur.band) ? "deal" : "warn",
      text: bandIdx(band) > bandIdx(cur.band)
        ? `Reputation up: ${band} (#${r.rank} of ${r.of}, score ${r.score.toFixed(0)}). Better terms and more access.`
        : `Reputation down: ${band} (#${r.rank} of ${r.of}, score ${r.score.toFixed(0)}). Tighter terms.`,
    });
  }
  const street: Record<string, Band> = {};
  for (const f of rankStreet(s)) if (f.id !== "you") street[f.id] = f.band;
  const me = rankStreet(s).find((x) => x.id === "you");
  s.reputation = { band, pending, pendingQ, score: r.score, rank: r.rank, of: r.of, m: s.month, street, sizeRank: me?.sizeRank, held: s.reputation?.held };
}

/**
 * HOW INVESTORS READ A RIVAL when it raises: its band at the last quarterly
 * ranking (updateReputation), or — for a firm founded since — the floor its
 * own record allows, which is Unknown for a new name and more for a spinout
 * carrying its team's record. Rank is not recomputed here: it draws nothing
 * and is cheap, but the street's order is a quarterly read like the player's.
 */
export function rivalBand(s: GameState, r: Rival): Band {
  const cached = s.reputation?.street?.[r.id];
  if (cached) return cached;
  return floorBand(scoreOf(rivalEvidence(s, r), s.month));
}

/**
 * WHAT INVESTORS WILL SIGN, BY BAND (§3.4, the band table). `perOwn` is the
 * most outside equity per $1 of the sponsor's; `hurdles`/`promotes` the
 * waterfall (`promotes[k]` applies above `hurdles[k]`); `devFee` and `amFee`
 * the fees the sponsor may charge (§4.1, read by the fee step); `investor` who
 * writes the cheque. Starting design values from the plan's table, which
 * cites small-sponsor syndication and institutional JV practice; not tuned.
 */
export interface BandTerms { perOwn: number; hurdles: number[]; promotes: number[]; devFee: number; amFee: number; investor: string; guarantee: boolean }
export const BAND_TERMS: Record<Band, BandTerms> = {
  "Toxic":         { perOwn: 0,   hurdles: [0.12],             promotes: [0],               devFee: 0,     amFee: 0,     investor: "Nobody",                         guarantee: true },
  "Questioned":    { perOwn: 0.5, hurdles: [0.125],            promotes: [0],               devFee: 0,     amFee: 0,     investor: "Friends and family made whole",  guarantee: true },
  "Unknown":       { perOwn: 1,   hurdles: [0.12, 0.15],       promotes: [0, 0.10],         devFee: 0,     amFee: 0,     investor: "Friends and family",             guarantee: true },
  "Emerging":      { perOwn: 3,   hurdles: [0.10, 0.12],       promotes: [0, 0.175],        devFee: 0.02,  amFee: 0,     investor: "Local private investors",        guarantee: true },
  "Proven":        { perOwn: 6,   hurdles: [0.09, 0.12, 0.18], promotes: [0, 0.20, 0.30],   devFee: 0.03,  amFee: 0.01,  investor: "Family offices and platforms",   guarantee: true },
  "Institutional": { perOwn: 9,   hurdles: [0.08, 0.12, 0.18], promotes: [0.20, 0.20, 0.30], devFee: 0.035, amFee: 0.0125, investor: "Endowments and pensions",     guarantee: false },
  "Blue-chip":     { perOwn: 19,  hurdles: [0.075, 0.12, 0.18], promotes: [0.20, 0.25, 0.30], devFee: 0.04, amFee: 0.015, investor: "Pensions, insurers and sovereign funds", guarantee: false },
};

/** The terms the player raises on today. */
export function playerTerms(s: GameState): BandTerms & { band: Band } {
  const band = s.reputation?.band ?? "Unknown";
  const t = BAND_TERMS[band];
  // Scale buys more outside money per dollar of the sponsor's own (scaleMult).
  return { ...t, perOwn: t.perOwn > 0 ? +(t.perOwn * scaleMult(s)).toFixed(2) : 0, band };
}

/** The waterfall in a line: "9% pref · 20% to you above 12% · 30% above 18%". */
export function termsLine(t: { hurdles: number[]; promotes: number[] }): string {
  const pc = (x: number) => `${+(x * 100).toFixed(1)}%`;
  const parts = [`${pc(t.hurdles[0])} pref`];
  let first = true;
  for (let k = 0; k < t.hurdles.length; k++) {
    if (!(t.promotes[k] > 0)) continue;
    parts.push(`${pc(t.promotes[k])} ${first ? "to you " : ""}above ${k === 0 ? "the pref" : `a ${pc(t.hurdles[k])} IRR`}`);
    first = false;
  }
  if (first) parts.push("no promote");
  return parts.join(" · ");
}
