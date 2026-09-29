// JEV IN THE ENGINE — the deterministic half.
//
// The controller (src/ai/jevController.ts) asks Jev its questions BETWEEN
// months and files the answers here with `withJevAnswers`. The tick then reads
// them synchronously at each of a Jev-run firm's decision points through
// `jevVerdict`, which turns answers into one of three paths using the mapping
// in src/ai/jevQuestions.ts:
//
//   "jev"       code acts on Jev's judgement (through the street's own machinery)
//   "pass"      Jev was confident the answer is "do nothing" — the scripted rule
//               for that decision is skipped this period
//   "fallback"  no answer, low confidence, or a dead-band noul — the firm's
//               scripted rule decides, exactly as it would without Jev
//
// Every verdict is logged once per period with the question ids, the answer
// and the path. Nothing here draws on the RNG and nothing here runs for a firm
// without `r.jev`, so a run with no Jev firm is the run it always was.
//
// Imports nothing from rivals.ts (rivals.ts imports this).
import type { GameState, Rival } from "./types";
import {
  CHARTERS, DEFAULT_THRESHOLDS, QID,
  decideBuy, decideChoice, decideClaim, decideNoul, decideSell,
  type JevAnswer, type JevThresholds, type Path, type Verdict,
} from "../ai/jevQuestions";

export type JevPoint = "buy" | "sell" | "refi" | "build" | "claim" | "distress";

/** What the questions were about, so the tick can map answers back onto the world. */
export interface JevCtx {
  buy: { bbl: string; ask: number }[];
  sell: string[];
  refi: boolean;
  build: { id: string; bbl: string; use: string; floors: number }[];
  claim: boolean;
  distress: string[];
}

export interface JevFirmPeriod {
  /** The state month the questions were built from; answers apply to ticks m+1 … m+every. */
  m: number;
  every: number;
  answers: Record<string, JevAnswer>;
  ctx: JevCtx;
  model?: string;
  tokens?: number;
  error?: string;
  /** Verdicts, memoised on first use so a period is decided once and logged once. */
  verdicts?: Partial<Record<JevPoint, Verdict>>;
  /** One-shot acts already carried out this period. */
  done?: Partial<Record<JevPoint, true>>;
}

export interface JevLogEntry {
  firmId: string;
  m: number;
  point: JevPoint;
  path: Path;
  why: string;
  /** What code actually did (or why it could not). */
  action?: string;
  detail?: Record<string, number | string>;
}

export interface JevState {
  thresholds: JevThresholds;
  /** Months per decision period. */
  every: number;
  firms: Record<string, JevFirmPeriod>;
  log: JevLogEntry[];
  /** Running totals for the cost meter. */
  calls: number;
  tokens: number;
  errors: number;
}

const LOG_CAP = 600;

export function jevState(s: GameState): JevState {
  return (s.jev ??= { thresholds: { ...DEFAULT_THRESHOLDS }, every: 3, firms: {}, log: [], calls: 0, tokens: 0, errors: 0 });
}

/** The period of answers this firm is acting on this tick, if any. */
export function jevPeriod(s: GameState, r: Rival): JevFirmPeriod | null {
  if (!r.jev) return null;
  const p = s.jev?.firms[r.id];
  if (!p || p.error) return null;
  return s.month > p.m && s.month <= p.m + p.every ? p : null;
}

export function jevLog(s: GameState, e: JevLogEntry): void {
  const st = jevState(s);
  st.log.push(e);
  if (st.log.length > LOG_CAP) st.log.splice(0, st.log.length - LOG_CAP);
}

/**
 * THE VERDICT AT ONE DECISION POINT, for this period. A firm without Jev, or
 * without answers for this tick, always gets "fallback" — and a caller that
 * sees "fallback" runs its original scripted code untouched.
 */
export function jevVerdict(s: GameState, r: Rival, point: JevPoint): Verdict {
  const p = jevPeriod(s, r);
  if (!p) return { path: "fallback", why: "no Jev answers this period" };
  const memo = (p.verdicts ??= {});
  const hit = memo[point];
  if (hit) return hit;
  const t = s.jev!.thresholds;
  const a = p.answers;
  // A point nobody was asked about (no candidates, not eligible) is the
  // scripted rule's, silently — logging it would bury the real decisions.
  const asked = point === "buy" ? p.ctx.buy.length > 0 : point === "sell" ? p.ctx.sell.length > 0
    : point === "refi" ? p.ctx.refi : point === "build" ? p.ctx.build.length > 0
      : point === "claim" ? p.ctx.claim : p.ctx.distress.length > 0;
  if (!asked) return (memo[point] = { path: "fallback", why: "not asked this period" });
  let v: Verdict;
  switch (point) {
    case "buy": v = decideBuy(a, p.ctx.buy.map((x) => x.bbl), CHARTERS[r.jev!.charter].weights, t); break;
    case "sell": v = decideSell(a, p.ctx.sell, t); break;
    case "refi": v = p.ctx.refi ? decideNoul(a, QID.refi, t.refiAct) : { path: "fallback", why: "not eligible to refinance when asked" }; break;
    case "build": v = decideChoice(a, QID.buildPick, p.ctx.build.map((x) => x.id), t.build); break;
    case "claim": v = p.ctx.claim ? decideClaim(a, t) : { path: "fallback", why: "not asked" }; break;
    case "distress": v = decideChoice(a, QID.distressPick, p.ctx.distress, t.distress); break;
  }
  memo[point] = v;
  jevLog(s, { firmId: r.id, m: s.month, point, path: v.path, why: v.why, detail: v.detail });
  return v;
}

/** Record what code did with a "jev" verdict (or why it could not), and close the one-shot. */
export function jevDid(s: GameState, r: Rival, point: JevPoint, action: string, ok = true): void {
  const p = jevPeriod(s, r);
  if (!p) return;
  (p.done ??= {})[point] = true;
  jevLog(s, { firmId: r.id, m: s.month, point, path: ok ? "jev" : "fallback", why: ok ? "acted" : "could not act", action });
  // An act that could not be carried out hands the decision back to the script.
  if (!ok && p.verdicts) p.verdicts[point] = { path: "fallback", why: `could not act: ${action}` };
}

/** Is Jev in charge of this decision this period (acted, or confidently passed)? */
export function jevHolds(s: GameState, r: Rival, point: JevPoint): boolean {
  if (!r.jev) return false;
  const v = jevVerdict(s, r, point);
  return v.path === "pass" || (v.path === "jev" && !!jevPeriod(s, r)?.done?.[point]);
}

/** A one-shot act is due now: a "jev" verdict not yet carried out. */
export function jevActDue(s: GameState, r: Rival, point: JevPoint): Verdict | null {
  if (!r.jev) return null;
  const v = jevVerdict(s, r, point);
  if (v.path !== "jev" || jevPeriod(s, r)?.done?.[point]) return null;
  return v;
}

/**
 * FILE A PERIOD'S ANSWERS (or its failure) for one firm. Returns a new state;
 * the input is not mutated. A failed call is filed with `error` and the firm's
 * scripted rules decide everything that period.
 */
export function withJevAnswers(
  s0: GameState, firmId: string, ctx: JevCtx,
  res: { answers?: Record<string, JevAnswer>; model?: string; tokens?: number; error?: string },
  m = s0.month,
): GameState {
  const s: GameState = { ...s0, jev: s0.jev ? { ...s0.jev, firms: { ...s0.jev.firms }, log: [...s0.jev.log] } : undefined };
  const st = jevState(s);
  st.firms[firmId] = {
    m, every: st.every, answers: res.answers ?? {}, ctx,
    model: res.model, tokens: res.tokens, error: res.error,
  };
  st.calls += 1;
  st.tokens += res.tokens ?? 0;
  if (res.error) {
    st.errors += 1;
    st.log.push({ firmId, m, point: "buy", path: "fallback", why: `Jev call failed — every decision falls back this period: ${res.error.slice(0, 160)}` });
  }
  return s;
}
