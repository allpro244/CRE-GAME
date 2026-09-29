// THE JEV QUESTION LIBRARY — every question the game asks Jev, and exactly how
// each answer becomes (or does not become) an action. One file, versioned, so
// a wording can be A/B-tested in `tools/jev-lab.mjs` and a change to what the
// firms are asked is a diff you can read.
//
// HOW THE QUESTIONS ARE WRITTEN, per TypeSafe's guidance for jev-1.13
// (docs: model-jaggedness, how-to-build-with-system-one, patterns/*):
//
//   · No arithmetic in the model. Every number is computed by the engine and
//     arrives as a phrase from src/ai/buckets.ts that carries the verdict AND
//     the numbers ("well above the firm's cost of debt (8.1% vs 6.9%)").
//   · One snap judgement per question, literal and one-hop, the subject named
//     in a field of a structured `instructions` object and referred to in
//     backticks. No double negatives; a noul's `true` always means "yes, do it".
//   · Each decision is asked ONE way: a Choice decides WHICH (always with an
//     explicit `none`/`hold`), Scores rate atomic qualities that code combines
//     with transparent weights, a Noul decides a single yes/no act.
//   · Small state: the shared `state` is only the firm's mandate, its book in
//     summary and the market; each candidate travels inside its own question.
//   · All of a firm's questions for the period go in ONE request
//     (speculative fan-out); code ignores what turns out not to matter.
//   · Confidence routing: code acts only above a per-decision threshold,
//     stricter for irreversible acts; below it the firm's scripted rule decides.
//
// Pure: no engine imports, no I/O. engine/jev.ts and engine/rivals.ts import
// the mapping functions; src/ai/jevRequest.ts imports the builders.

export const JEV_QUESTIONS_VERSION = "2026-09-29.2";
export const JEV_MODEL = "jev-latest";

// ------------------------------------------------------------------ wire types

export type Text = string | Record<string, unknown> | unknown[];
export type JevQuestion =
  | { type: "noul"; instructions: Text; criteria?: { true?: Text; false?: Text } }
  | { type: "choice"; instructions: Text; criteria: Record<string, Text | null> }
  | { type: "score"; instructions: Text; criteria: Text[] };

export interface JevRequest { state: unknown; model: string; questions: Record<string, JevQuestion> }

export type JevAnswer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: "score"; score: number; legend?: Record<string, string>; probabilities?: Record<string, number>; confidence: number };

export interface JevResponse { model: string; answers: Record<string, JevAnswer>; usage?: { input_tokens?: number; output_tokens?: number } }

// ------------------------------------------------------------------ charters

export type CharterId = "family" | "core" | "valueadd" | "opportunistic" | "merchant";

/** The weights code uses to combine a candidate's atomic scores. Preferences, stated — not calibrated. */
export interface BuyWeights { value: number; location: number; income: number; fit: number; timing: number }

export const CHARTERS: Record<CharterId, { label: string; mandate: string; weights: BuyWeights }> = {
  family: {
    label: "Family office",
    mandate: "A family office investing its own capital for the next generation. Holds for decades, borrows little, "
      + "buys well-located buildings with durable income, and never has to sell. Prefers safety of income over a bargain.",
    weights: { location: 0.30, income: 0.30, value: 0.15, fit: 0.15, timing: 0.10 },
  },
  core: {
    label: "Core fund",
    mandate: "An institutional core fund. Owns stabilised offices and apartments with steady income in good locations, "
      + "at moderate leverage, and sells slowly to rebalance. Will pay a fair price for quality; avoids lease-up and repair risk.",
    weights: { income: 0.35, location: 0.25, value: 0.15, fit: 0.15, timing: 0.10 },
  },
  valueadd: {
    label: "Value-add fund",
    mandate: "A value-add private equity fund with a five-year life. Buys tired or under-let buildings below value, fixes "
      + "and re-lets them, and sells once the value is made. Uses substantial leverage and cares most about the entry price.",
    weights: { value: 0.35, location: 0.20, income: 0.10, fit: 0.15, timing: 0.20 },
  },
  opportunistic: {
    label: "Opportunistic fund",
    mandate: "An opportunistic fund. Buys distress and deep discounts when others cannot, uses high leverage, "
      + "and times the cycle: aggressive near the bottom, a seller near the top.",
    weights: { value: 0.40, timing: 0.25, fit: 0.20, location: 0.10, income: 0.05 },
  },
  merchant: {
    label: "Merchant builder",
    mandate: "A merchant builder. Buys land and worn buildings in strong locations, builds what the market is short of, "
      + "and sells once the building is let. Starts only schemes that clear the required yield with demand waiting.",
    weights: { location: 0.35, value: 0.25, timing: 0.20, fit: 0.15, income: 0.05 },
  },
};

/** The charter a street style runs under by default. */
export function charterForStyle(style: string): CharterId {
  switch (style) {
    case "family": case "foreign": case "owneruser": return "family";
    case "core": case "reit": return "core";
    case "pe": case "slumlord": return "valueadd";
    case "opportunistic": case "vulture": return "opportunistic";
    case "developer": case "merchant": return "merchant";
    default: return "valueadd";
  }
}

// ------------------------------------------------------------------ thresholds

/**
 * WHEN CODE ACTS ON AN ANSWER. Conservative defaults, stricter for acts that
 * cannot be undone (a sale, a groundbreak). Stored on the state so a run is
 * reproducible from its save; changed in Settings → Jev or the match config.
 */
export interface JevThresholds {
  /** buy_pick Choice confidence needed to act on the pick (or on `none`). */
  buyPick: number;
  /** Composite (0-1) the picked candidate must reach to be bought. */
  buyComposite: number;
  /** Minimum confidence on each of the picked candidate's Scores. */
  scoreConf: number;
  /** sell_* Noul: list at or above this; at or below `sellHold` on every holding the firm holds. */
  sellAct: number;
  sellHold: number;
  /** refi Noul: act at or above; pass at or below 1 − refiAct. */
  refiAct: number;
  /** build_pick Choice confidence to start a scheme (or to hold). */
  build: number;
  /** claim_jobs Noul at or below this keeps the firm out of city work this period. */
  claimVeto: number;
  /** distress_pick Choice confidence to choose which building goes. */
  distress: number;
}

export const DEFAULT_THRESHOLDS: JevThresholds = {
  buyPick: 0.45, buyComposite: 0.6, scoreConf: 0.35,
  sellAct: 0.8, sellHold: 0.2,
  refiAct: 0.75,
  build: 0.65,
  claimVeto: 0.25,
  distress: 0.5,
};

// ------------------------------------------------------------------ ids

export const QID = {
  buyPick: "buy_pick",
  buyTiming: "buy_timing",
  buyScore: (k: "value" | "location" | "income" | "fit", bbl: string) => `buy_${k}_${bbl}`,
  sell: (bbl: string) => `sell_${bbl}`,
  refi: "refi",
  buildPick: "build_pick",
  claim: "claim_jobs",
  distressPick: "distress_pick",
} as const;

export const NONE = "none";
export const HOLD = "hold";

// ------------------------------------------------------------------ builders

const FIVE = (xs: [string, string, string, string, string]) => xs;

/** Choice over pre-filtered listings, keyed by bbl, plus `none`. */
export function qBuyPick(options: Record<string, Text>): JevQuestion {
  return {
    type: "choice",
    instructions: "Which one of these listed buildings should the firm buy this quarter, given `firm_mandate`, `firm` and `market`? "
      + "Every option is a building the firm can afford and is allowed to buy. Choose `none` if no listing is a good purchase for this firm right now.",
    criteria: { ...options, [NONE]: "Buy nothing this quarter: none of the listings is a good purchase for this firm now." },
  };
}

export function qBuyValue(candidate: Record<string, unknown>): JevQuestion {
  return {
    type: "score",
    instructions: { candidate, question: "How attractive is the price of `candidate`, judged by `candidate.price` and `candidate.going_in_yield`?" },
    criteria: FIVE([
      "Poor: priced above its value, and its yield is below the firm's cost of debt",
      "Weak: priced at or above value, with a thin yield",
      "Fair: priced near value, with an ordinary yield",
      "Good: priced below value, or yielding clearly above the cost of debt",
      "Excellent: priced well below value and yielding well above the cost of debt",
    ]),
  };
}

export function qBuyLocation(candidate: Record<string, unknown>): JevQuestion {
  return {
    type: "score",
    instructions: { candidate, question: "How strong is the location of `candidate` for a building of its use, judged by `candidate.location` and `candidate.submarket`?" },
    criteria: FIVE([
      "Poor: a location tenants avoid for this use",
      "Weak: below-average demand for this use",
      "Average: ordinary demand for this use",
      "Strong: a location tenants seek out for this use",
      "Prime: among the best locations in the city for this use",
    ]),
  };
}

export function qBuyIncome(candidate: Record<string, unknown>): JevQuestion {
  return {
    type: "score",
    instructions: { candidate, question: "How secure is the rental income of `candidate` over the next three years, judged by `candidate.occupancy`, `candidate.rent_roll`, `candidate.condition` and `candidate.submarket`?" },
    criteria: FIVE([
      "Very insecure: mostly empty, or the building is failing",
      "Insecure: well below market occupancy or in poor condition",
      "Average: market occupancy and ordinary condition",
      "Secure: well let in a healthy submarket and in good condition",
      "Very secure: fully let with a disclosed rent roll, in good condition, in a tight submarket",
    ]),
  };
}

export function qBuyFit(candidate: Record<string, unknown>): JevQuestion {
  return {
    type: "score",
    instructions: { candidate, question: "How well does buying `candidate` fit `firm_mandate` and the firm's current book in `firm`?" },
    criteria: FIVE([
      "Poor fit: the mandate says not to buy this kind of building",
      "Weak fit: outside the mandate's focus, or it over-concentrates the book",
      "Neutral fit",
      "Good fit: the kind of building the mandate describes",
      "Excellent fit: exactly what the mandate describes, and it balances the book",
    ]),
  };
}

/**
 * TIMING, ASKED LITERALLY. The first wording ("how good a time is it for a
 * firm with `firm_mandate` to buy…") put a hop through the mandate into the
 * question, and against the live model it came back with confidence 0.0-0.3
 * on most calls — the docs' signature of an ambiguous rubric. This asks one
 * observable thing about `market` only; how much each charter cares about it
 * is the weight in code (CHARTERS[…].weights.timing).
 */
export function qBuyTiming(): JevQuestion {
  return {
    type: "score",
    instructions: "Is `market` a buyer's market or a seller's market for income property right now, judged by `market.cycle` and `market.credit`?",
    criteria: FIVE([
      "Strong seller's market: values at a peak and lenders eager",
      "Seller's market: values high and rising",
      "Balanced market",
      "Buyer's market: values falling, or recovering from a fall, and sellers under pressure",
      "Strong buyer's market: deep distress, few buyers and scarce credit",
    ]),
  };
}

export function qSell(holding: Record<string, unknown>): JevQuestion {
  return {
    type: "noul",
    instructions: { holding, question: "Should the firm put `holding` up for sale now, given `firm_mandate` and `market`?" },
    criteria: {
      true: "Yes: selling now serves the mandate — the value has been made, the income is at risk, or the money is better used elsewhere.",
      false: "No: keeping the building serves the mandate better than selling it now.",
    },
  };
}

export function qRefi(refinance: Record<string, unknown>): JevQuestion {
  return {
    type: "noul",
    instructions: { refinance, question: "Should the firm take the loan described in `refinance` now, borrowing more against its buildings to raise cash for new purchases?" },
    criteria: {
      true: "Yes: the extra debt is affordable and the mandate and market favour raising cash to invest now.",
      false: "No: the extra debt adds too much risk for this mandate or this market.",
    },
  };
}

export function qBuildPick(options: Record<string, Text>): JevQuestion {
  return {
    type: "choice",
    instructions: "Which one of these development schemes on land the firm already owns should it start now, given `firm_mandate`, `firm` and `market`? "
      + "Every option passes zoning and the lender's test. Starting commits the firm to years of construction spending. Choose `hold` to start nothing this quarter.",
    criteria: { ...options, [HOLD]: "Start nothing this quarter." },
  };
}

export function qClaim(construction: Record<string, unknown>): JevQuestion {
  return {
    type: "noul",
    instructions: { construction, question: "Should the firm take on new construction projects this quarter, judged by `construction` and `market`?" },
    criteria: {
      true: "Yes: the firm has the capacity and money, and the market wants new buildings.",
      false: "No: the firm is stretched, short of money, or the market does not need more space.",
    },
  };
}

export function qDistressPick(options: Record<string, Text>, shortfall: string): JevQuestion {
  return {
    type: "choice",
    instructions: { shortfall, question: "The firm has missed a debt payment and must sell one building to cover `shortfall`. Which building should it sell, given `firm_mandate`?" },
    criteria: options,
  };
}

// ------------------------------------------------------------------ mapping

/** Normalise a 5-level Score (0..4) to 0..1. */
export const unit = (a: JevAnswer | undefined) => (a && a.type === "score" ? Math.max(0, Math.min(1, a.score / 4)) : NaN);

export type Path = "jev" | "pass" | "fallback";
export interface Verdict<T = unknown> { path: Path; why: string; act?: T; detail?: Record<string, number | string> }

/** BUY: pick → composite → act / pass / fallback. */
export function decideBuy(
  ans: Record<string, JevAnswer>, candidates: string[], w: BuyWeights, t: JevThresholds,
): Verdict<{ bbl: string; composite: number }> {
  const pick = ans[QID.buyPick];
  if (!candidates.length) return { path: "fallback", why: "no candidates were asked about" };
  if (!pick || pick.type !== "choice") return { path: "fallback", why: "no answer to buy_pick" };
  if (pick.confidence < t.buyPick) return { path: "fallback", why: `buy_pick confidence ${pick.confidence.toFixed(2)} < ${t.buyPick}`, detail: { choice: pick.choice } };
  if (pick.choice === NONE) return { path: "pass", why: `Jev: buy nothing (confidence ${pick.confidence.toFixed(2)})` };
  if (!candidates.includes(pick.choice)) return { path: "fallback", why: `buy_pick chose an unknown option ${pick.choice}` };
  const b = pick.choice;
  const parts: [keyof BuyWeights, JevAnswer | undefined][] = [
    ["value", ans[QID.buyScore("value", b)]], ["location", ans[QID.buyScore("location", b)]],
    ["income", ans[QID.buyScore("income", b)]], ["fit", ans[QID.buyScore("fit", b)]], ["timing", ans[QID.buyTiming]],
  ];
  let c = 0;
  const detail: Record<string, number | string> = { choice: b, pickConfidence: +pick.confidence.toFixed(2) };
  for (const [k, a] of parts) {
    if (!a || a.type !== "score") return { path: "fallback", why: `no ${k} score for ${b}`, detail };
    if (a.confidence < t.scoreConf) return { path: "fallback", why: `${k} score confidence ${a.confidence.toFixed(2)} < ${t.scoreConf}`, detail };
    detail[k] = +unit(a).toFixed(2);
    c += w[k] * unit(a);
  }
  detail.composite = +c.toFixed(3);
  if (c < t.buyComposite) return { path: "pass", why: `composite ${c.toFixed(2)} < ${t.buyComposite}: pass`, detail };
  return { path: "jev", why: `buy ${b}: composite ${c.toFixed(2)}`, act: { bbl: b, composite: c }, detail };
}

/** SELL: the most-wanted sale if it clears the bar; a firm hold if every holding is a clear no. */
export function decideSell(
  ans: Record<string, JevAnswer>, holdings: string[], t: JevThresholds,
): Verdict<{ bbl: string; p: number; askMult: number }> {
  if (!holdings.length) return { path: "fallback", why: "no holdings were asked about" };
  let best = "", bp = -1, all = true;
  for (const b of holdings) {
    const a = ans[QID.sell(b)];
    if (!a || a.type !== "noul") return { path: "fallback", why: `no answer to ${QID.sell(b)}` };
    if (a.noul > bp) { bp = a.noul; best = b; }
    if (a.noul > t.sellHold) all = false;
  }
  if (bp >= t.sellAct) {
    // The eager seller asks less: the scripted voluntary seller asks 1.00-1.14x the
    // conveyed value; certainty maps across that same range, most certain → 1.00x.
    const askMult = 1.14 - 0.14 * Math.min(1, (bp - t.sellAct) / Math.max(1e-9, 1 - t.sellAct));
    return { path: "jev", why: `sell ${best}: p=${bp.toFixed(2)}`, act: { bbl: best, p: bp, askMult }, detail: { p: +bp.toFixed(2) } };
  }
  if (all) return { path: "pass", why: `every holding ≤ ${t.sellHold}: hold`, detail: { maxP: +bp.toFixed(2) } };
  return { path: "fallback", why: `max sell p=${bp.toFixed(2)} between ${t.sellHold} and ${t.sellAct}`, detail: { maxP: +bp.toFixed(2) } };
}

/** REFI: a single yes/no with a dead band that belongs to the scripted rule. */
export function decideNoul(ans: Record<string, JevAnswer>, id: string, act: number): Verdict<{ p: number }> {
  const a = ans[id];
  if (!a || a.type !== "noul") return { path: "fallback", why: `no answer to ${id}` };
  if (a.noul >= act) return { path: "jev", why: `${id}: yes p=${a.noul.toFixed(2)}`, act: { p: a.noul }, detail: { p: +a.noul.toFixed(2) } };
  if (a.noul <= 1 - act) return { path: "pass", why: `${id}: no p=${a.noul.toFixed(2)}`, detail: { p: +a.noul.toFixed(2) } };
  return { path: "fallback", why: `${id}: p=${a.noul.toFixed(2)} in the dead band`, detail: { p: +a.noul.toFixed(2) } };
}

/** BUILD / DISTRESS: a Choice with a confidence gate; `hold` (build) is a confident pass. */
export function decideChoice(
  ans: Record<string, JevAnswer>, id: string, options: string[], conf: number,
): Verdict<{ option: string; confidence: number }> {
  const a = ans[id];
  if (!options.length) return { path: "fallback", why: `no options for ${id}` };
  if (!a || a.type !== "choice") return { path: "fallback", why: `no answer to ${id}` };
  if (a.confidence < conf) return { path: "fallback", why: `${id} confidence ${a.confidence.toFixed(2)} < ${conf}`, detail: { choice: a.choice } };
  if (a.choice === HOLD || a.choice === NONE) return { path: "pass", why: `${id}: ${a.choice} (confidence ${a.confidence.toFixed(2)})` };
  if (!options.includes(a.choice)) return { path: "fallback", why: `${id} chose an unknown option ${a.choice}` };
  return { path: "jev", why: `${id}: ${a.choice} (confidence ${a.confidence.toFixed(2)})`, act: { option: a.choice, confidence: a.confidence }, detail: { confidence: +a.confidence.toFixed(2) } };
}

/** CLAIM: Jev can keep a firm OUT of city work; a yes leaves the scripted appetite in charge. */
export function decideClaim(ans: Record<string, JevAnswer>, t: JevThresholds): Verdict {
  const a = ans[QID.claim];
  if (!a || a.type !== "noul") return { path: "fallback", why: "no answer to claim_jobs" };
  if (a.noul <= t.claimVeto) return { path: "pass", why: `claim_jobs: no p=${a.noul.toFixed(2)} — out of city work this period`, detail: { p: +a.noul.toFixed(2) } };
  return { path: "fallback", why: `claim_jobs p=${a.noul.toFixed(2)}: the scripted appetite decides`, detail: { p: +a.noul.toFixed(2) } };
}

// ------------------------------------------------------------------ validation

/**
 * THE API'S OWN RULES, CHECKED BEFORE A REQUEST LEAVES. From the TypeSafe API
 * reference: state/model/questions required; Choice ≤ 255 options (the game
 * also requires ≥ 2); Score 2–10 levels; instructions required. Also the
 * context budget from Models: 64k tokens for state + all questions, 32k for
 * state + the longest question (estimated at 4 characters a token).
 */
export function validateJevRequest(req: JevRequest): string[] {
  const errs: string[] = [];
  if (req.state === undefined || req.state === null) errs.push("state is required");
  if (typeof req.model !== "string" || !req.model) errs.push("model is required");
  const qs = req.questions ?? {};
  const ids = Object.keys(qs);
  if (!ids.length) errs.push("at least one question is required");
  const empty = (x: unknown) => x === undefined || x === null || (typeof x === "string" && !x.trim());
  let longest = 0;
  for (const id of ids) {
    const q = qs[id];
    const len = JSON.stringify(q).length;
    longest = Math.max(longest, len);
    if (empty(q.instructions)) errs.push(`${id}: instructions required`);
    if (q.type === "choice") {
      const n = Object.keys(q.criteria ?? {}).length;
      if (n < 2) errs.push(`${id}: choice needs at least 2 options (has ${n})`);
      if (n > 255) errs.push(`${id}: choice allows at most 255 options (has ${n})`);
    } else if (q.type === "score") {
      const n = (q.criteria ?? []).length;
      if (n < 2 || n > 10) errs.push(`${id}: score needs 2-10 levels (has ${n})`);
    } else if (q.type !== "noul") {
      errs.push(`${id}: unknown type ${(q as { type: string }).type}`);
    }
  }
  const stateLen = JSON.stringify(req.state).length;
  const total = stateLen + ids.reduce((a, id) => a + JSON.stringify(qs[id]).length, 0);
  if ((stateLen + longest) / 4 > 32_000) errs.push(`state + longest question ≈ ${Math.round((stateLen + longest) / 4)} tokens > 32k`);
  if (total / 4 > 64_000) errs.push(`request ≈ ${Math.round(total / 4)} tokens > 64k`);
  return errs;
}

/** Input tokens, estimated at 4 characters a token (for the cost meter before a response reports usage). */
export const estimateTokens = (req: JevRequest) => Math.round(JSON.stringify(req).length / 4);
/** Jev 1.13 list price: $0.042 per million input tokens; output is free (docs: Models). */
export const JEV_USD_PER_MTOK = 0.042;
