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

/** A deal's size weight: (equity ÷ reference)^(1/3) — diminishing returns, so one mega-deal cannot swamp a record. */
export function sizeWeight(equity: number, level = 1): number {
  return equity > 0 ? Math.cbrt(equity / (REF_EQUITY * Math.max(1e-6, level))) : 0;
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
      actual = e.irr;
      pitch = e.planIrr;
      multiple = (e.equityOut ?? 0) / (e.equityIn ?? 1);
      equity = e.equityIn ?? 0;
    }
    // Sizes are measured in opening-year dollars: deflate by the price level
    // at realisation (the nearest the record keeps to the deal's own vintage).
    const size = sizeWeight(equity, level);
    let ev = outcomeEvidence(actual, pitch, multiple);
    if (ev > 0) ev *= size;
    else if (syn?.misconduct) {
      // A broken completion guarantee is the sponsor's, never the market's: ×2 (§3.4).
      ev *= 2 * (0.6 + 1.4 * Math.min(1, equity / Math.max(1, managed)));
    } else {
      ev *= faultMult(s, e.boughtM, e.soldM);
      ev *= 0.6 + 1.4 * Math.min(1, equity / Math.max(1, managed));
      if (gpShare >= 0.10) ev *= 0.85;   // the sponsor's own money suffered alongside
    }
    // Own-money evidence counts at 90%; a deal blends by its outside share, so
    // a token raise cannot turn an own-money deal into an investor one.
    ev *= OWN_WEIGHT + (1 - OWN_WEIGHT) * outside;
    out.push({ m: e.soldM, ev, size: ev > 0 ? size : 0, kind: syn ? "investor" : "own", label: e.address });
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
      ev *= 0.6 + 1.4 * Math.min(1, equity / Math.max(1, managed + equity));
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
      ev *= 0.6 + 1.4 * Math.min(1, f.called / Math.max(1, managed + f.called));
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
      ev *= faultMult(s, d.m - 36, d.m);
      ev *= 0.6 + 1.4 * Math.min(1, d.eq / Math.max(1, managed));
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
  if (sc.score >= 40 && sc.n >= 8 && sc.deals >= 3 && sc.investorDeals >= 1) return "Institutional";
  if (sc.score >= 25 && sc.n >= 3 && sc.deals >= 2) return "Proven";
  if (sc.score >= 10) return "Emerging";
  return "Unknown";
}

/** The band a rank holds among `of` firms: top 3% (at least #1), next 10%, 20%, 27%, bottom 40%. */
export function rankBand(rank: number, of: number): Band {
  const blue = Math.max(1, Math.round(0.03 * of));
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

/** Rivals' styles that run outside capital as a matter of course (count as a realised investor vehicle). */
const INSTITUTIONAL_STYLES = new Set(["core", "pe", "reit", "opportunistic", "merchant", "foreign"]);

export interface FirmStanding { id: string; name: string; score: number; n: number; rank: number; band: Band }

/**
 * THE STREET'S RANKING. Every living firm, scored and placed. Ties break
 * deterministically — score, then experience, then age, then id — so no RNG
 * stream is drawn and the economy's random draws never move.
 */
export function rankStreet(s: GameState): FirmStanding[] {
  const rows: { id: string; name: string; sc: ReturnType<typeof scoreOf>; bornM: number; fund: boolean; inst: boolean }[] = [];
  const pe = playerEvidence(s);
  // Blue-chip needs a realised fund that returned its capital.
  const fundDone = (s.fundHistory ?? []).some((f) => f.called > 0 && f.distributed >= f.called);
  rows.push({ id: "you", name: "You", sc: scoreOf(pe, s.month), bornM: 0, fund: fundDone, inst: false });
  for (const r of s.rivals ?? []) {
    if (r.failedM !== undefined || r.retiredM !== undefined) continue;
    rows.push({ id: r.id, name: r.name, sc: scoreOf(rivalEvidence(s, r), s.month), bornM: r.bornM, fund: false, inst: INSTITUTIONAL_STYLES.has(r.style) });
  }
  rows.sort((a, b) => b.sc.score - a.sc.score || b.sc.n - a.sc.n || a.bornM - b.bornM || (a.id < b.id ? -1 : 1));
  const of = rows.length;
  return rows.map((x, i) => {
    const sc = x.inst && x.sc.investorDeals === 0 ? { ...x.sc, investorDeals: x.sc.deals } : x.sc;
    return { id: x.id, name: x.name, score: Math.round(x.sc.score * 10) / 10, n: x.sc.n, rank: i + 1, band: minBand(rankBand(i + 1, of), floorBand(sc, x.fund)) };
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
export function updateReputation(s: GameState): void {
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
        ? `Investors have started to read you as ${band}: #${r.rank} of ${r.of} on the street, a record scoring ${r.score.toFixed(0)}. Better terms, and more people who will take the call.`
        : `Investors now read you as ${band} (#${r.rank} of ${r.of}, score ${r.score.toFixed(0)}). The money that was there last quarter is asking harder questions.`,
    });
  }
  const street: Record<string, Band> = {};
  for (const f of rankStreet(s)) if (f.id !== "you") street[f.id] = f.band;
  s.reputation = { band, pending, pendingQ, score: r.score, rank: r.rank, of: r.of, m: s.month, street };
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
  return { ...BAND_TERMS[band], band };
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
