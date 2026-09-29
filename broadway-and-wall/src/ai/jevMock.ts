// A DETERMINISTIC STAND-IN FOR JEV — for tests, the offline match and the lab's
// dry run. It is NOT Jev and makes no claim to Jev's judgement: it reads the
// same bucketed phrases a real request carries and answers with fixed rules,
// so the whole pipeline (request → answers → verdicts → actions) runs without
// a key and without the network, and two runs with the mock are identical.
//
// `fixtureJev(answers)` returns exactly the answers given (for tests that need
// a specific verdict); `mockJev(req)` answers every question by rule.
import type { JevAnswer, JevQuestion, JevRequest, JevResponse } from "./jevQuestions";
import { estimateTokens, HOLD, NONE } from "./jevQuestions";

const txt = (x: unknown) => (typeof x === "string" ? x : JSON.stringify(x ?? ""));

/** A Score answer peaked on `level` (0-4) with the given confidence. */
export function scoreAt(level: number, confidence = 0.75, levels = 5): JevAnswer {
  const L = Math.max(0, Math.min(levels - 1, Math.round(level)));
  const probs: Record<string, number> = {};
  const rest = (1 - confidence) / Math.max(1, levels - 1);
  for (let i = 0; i < levels; i++) probs[String(i)] = i === L ? confidence + rest * 0 : rest;
  const sum = Object.values(probs).reduce((a, b) => a + b, 0);
  for (const k of Object.keys(probs)) probs[k] /= sum;
  const score = Object.entries(probs).reduce((a, [k, p]) => a + Number(k) * p, 0);
  return { type: "score", score, probabilities: probs, confidence };
}

/** A Choice answer on `choice` among `options`. */
export function choiceOf(choice: string, options: string[], confidence = 0.75): JevAnswer {
  const n = options.length;
  // The docs' confidence for a peaked distribution: (n·peak − 1)/(n − 1).
  const peak = (confidence * (n - 1) + 1) / n;
  const probabilities: Record<string, number> = {};
  for (const o of options) probabilities[o] = o === choice ? peak : (1 - peak) / Math.max(1, n - 1);
  return { type: "choice", choice, probabilities, confidence };
}

const noul = (p: number): JevAnswer => ({ type: "noul", noul: Math.max(0, Math.min(1, p)) });

function has(t: string, ...ws: string[]) { return ws.some((w) => t.includes(w)); }

function rateWords(t: string): number {
  // price: far below +2 … far above −2; yield: well above +1 … well below −1
  let v = 0;
  if (has(t, "far below appraisal", "far below what")) v += 2; else if (has(t, "below appraisal", "below what")) v += 1;
  if (has(t, "far above appraisal", "far above what")) v -= 2; else if (has(t, "above appraisal", "above what")) v -= 1;
  if (t.includes("well above the firm's cost of debt")) v += 1;
  if (t.includes("well below the firm's cost of debt")) v -= 1;
  return v;
}

function answerOne(id: string, q: JevQuestion, state: string): JevAnswer {
  const t = txt(q.instructions);
  if (q.type === "score") {
    if (id.startsWith("buy_value_")) return scoreAt(2 + rateWords(t));
    if (id.startsWith("buy_location_")) return scoreAt(has(t, "prime location") ? 4 : has(t, "strong location") ? 3 : has(t, "average location") ? 2 : has(t, "weak location") ? 1 : 0);
    if (id.startsWith("buy_income_")) return scoreAt((has(t, "above the market") ? 3 : has(t, "in line with the market") ? 2 : has(t, "far below the market") ? 0 : 1) + (t.includes("disclosed by the seller") ? 1 : 0));
    if (id.startsWith("buy_fit_")) return scoreAt(t.includes("most of the book") ? 1 : 3);
    if (id === "buy_timing") {
      return scoreAt(has(state, "peak —") ? 0 : has(state, "expansion —") ? 1 : has(state, "depression —") ? 4 : 3);
    }
    return scoreAt(2, 0.5);
  }
  if (q.type === "noul") {
    if (id.startsWith("sell_")) return noul(has(t, "ends due now", "ends within 6 months") ? 0.85 : t.includes("well below the market cap rate") ? 0.82 : 0.12);
    if (id === "refi") return noul(t.includes("comfortable") ? 0.8 : t.includes("adequate") ? 0.5 : 0.1);
    if (id === "claim_jobs") return noul(t.includes("no use has tenants waiting") ? 0.1 : 0.6);
    return noul(0.5);
  }
  // choice
  const opts = Object.keys(q.criteria);
  if (id === "buy_pick") {
    let best = NONE, bv = 0;
    for (const o of opts) {
      if (o === NONE) continue;
      const v = rateWords(txt(q.criteria[o]));
      if (v > bv) { bv = v; best = o; }
    }
    return choiceOf(best, opts, best === NONE ? 0.6 : 0.7);
  }
  if (id === "build_pick") {
    const good = opts.find((o) => txt(q.criteria[o]).includes("clears comfortably")) ?? opts.find((o) => txt(q.criteria[o]).includes(" clears the required"));
    return choiceOf(good ?? HOLD, opts, 0.7);
  }
  return choiceOf(opts[0], opts, 0.6);
}

/** Answer every question by rule. */
export function mockJev(req: JevRequest): JevResponse {
  const state = txt(req.state);
  const answers: Record<string, JevAnswer> = {};
  for (const [id, q] of Object.entries(req.questions)) answers[id] = answerOne(id, q, state);
  return { model: "mock-jev", answers, usage: { input_tokens: estimateTokens(req), output_tokens: 0 } };
}

/** A fetch-shaped mock endpoint, so the real client can be exercised end to end offline. */
export function mockJevFetch(answer: (req: JevRequest) => JevResponse = mockJev): typeof fetch {
  return (async (_url: unknown, init?: { body?: unknown }) => {
    const req = JSON.parse(String(init?.body ?? "{}")) as JevRequest;
    const body = JSON.stringify(answer(req));
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}
