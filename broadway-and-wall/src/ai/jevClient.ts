// A TINY TYPED CLIENT FOR TYPESAFE'S SYSTEM ONE ENDPOINT.
//
//   POST https://api.typesafe.ai/v1/systemone
//   Authorization: Bearer <key>
//   { state, model: "jev-latest", questions } → { model, answers, usage }
//
// TypeSafe publishes a JS SDK (@typesafe-ai/sdk), but it is not installable in
// this offline tree and the game needs to run in a browser tab too, so this is
// the documented HTTP API with the SDK's retry behaviour: one retry with
// backoff on 429 / 5xx / 529, honouring Retry-After. A timeout per call, a
// response validated against the questions sent, and a circuit breaker so a
// run whose Jev is down falls back to the scripted street instead of stalling.
//
// The key is passed in at call time and sent only in the Authorization header
// to the configured base URL: api.typesafe.ai directly (Node), or the local
// bridge (`pnpm ai-bridge`, which holds the key itself) from a browser —
// api.typesafe.ai does not answer CORS preflights from localhost origins.
import type { JevAnswer, JevRequest, JevResponse } from "./jevQuestions";
import { validateJevRequest } from "./jevQuestions";

export const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";
export const BRIDGE_URL = "http://127.0.0.1:8788/jev";

export interface JevClientOptions {
  /** Full endpoint URL (default api.typesafe.ai). The bridge is BRIDGE_URL. */
  url?: string;
  apiKey?: string;
  timeoutMs?: number;
  /** Retries after the first attempt, on 429 / 5xx / timeout (default 1). */
  retries?: number;
  fetchImpl?: typeof fetch;
}

export interface JevCallResult { response: JevResponse; ms: number; attempts: number }

export class JevError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One System One call. Throws JevError on a bad request, transport failure, HTTP error or a malformed answer. */
export async function callJev(req: JevRequest, o: JevClientOptions = {}): Promise<JevCallResult> {
  const errs = validateJevRequest(req);
  if (errs.length) throw new JevError(`request invalid: ${errs.slice(0, 3).join("; ")}`, 422);
  const fetchImpl = o.fetchImpl ?? fetch;
  const url = o.url ?? TYPESAFE_URL;
  const retries = o.retries ?? 1;
  const t0 = Date.now();
  let last: JevError | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? 5000);
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...(o.apiKey ? { authorization: `Bearer ${o.apiKey}` } : {}) },
        body: JSON.stringify(req),
        signal: ctl.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        last = new JevError(`HTTP ${res.status}: ${text.slice(0, 200)}`, res.status);
        const retryable = res.status === 429 || res.status >= 500;
        if (!retryable || attempt === retries) throw last;
        const ra = Number(res.headers.get("retry-after-ms") ?? NaN);
        const rs = Number(res.headers.get("retry-after") ?? NaN);
        await sleep(Math.min(2000, Number.isFinite(ra) ? ra : Number.isFinite(rs) ? rs * 1000 : 300 * (attempt + 1)));
        continue;
      }
      const json = JSON.parse(text) as JevResponse;
      checkResponse(req, json);
      return { response: json, ms: Date.now() - t0, attempts: attempt + 1 };
    } catch (e) {
      if (e instanceof JevError && e.status && e.status !== 429 && e.status < 500) throw e;
      last = e instanceof JevError ? e : new JevError((e as Error).name === "AbortError" ? `timed out after ${o.timeoutMs ?? 5000}ms` : (e as Error).message);
      if (attempt === retries) throw last;
      await sleep(300 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw last ?? new JevError("unreachable");
}

/** Every question answered, with the type it was asked as, and numbers in range. */
export function checkResponse(req: JevRequest, res: JevResponse): void {
  if (!res || typeof res !== "object" || !res.answers) throw new JevError("response has no answers");
  for (const [id, q] of Object.entries(req.questions)) {
    const a = res.answers[id] as JevAnswer | undefined;
    if (!a) throw new JevError(`no answer for ${id}`);
    if (a.type !== q.type) throw new JevError(`${id}: asked ${q.type}, answered ${a.type}`);
    if (a.type === "noul" && !(a.noul >= 0 && a.noul <= 1)) throw new JevError(`${id}: noul out of range`);
    if (a.type === "choice" && !(a.choice in (q.criteria as Record<string, unknown>))) throw new JevError(`${id}: choice ${a.choice} was not an option`);
    if (a.type !== "noul" && !(a.confidence >= 0 && a.confidence <= 1)) throw new JevError(`${id}: confidence out of range`);
  }
}

/**
 * THE CIRCUIT BREAKER. After `threshold` consecutive failed calls the breaker
 * opens: no calls are made for `coolPeriods` decision periods (every Jev-run
 * firm runs on its scripted rules, and the UI says "Jev offline"), then one
 * trial call is allowed through.
 */
export class JevBreaker {
  failures = 0;
  openUntilPeriod = -1;
  constructor(readonly threshold = 3, readonly coolPeriods = 4) {}
  allow(period: number): boolean { return period >= this.openUntilPeriod; }
  ok(): void { this.failures = 0; }
  fail(period: number): void {
    this.failures++;
    if (this.failures >= this.threshold) { this.openUntilPeriod = period + this.coolPeriods; this.failures = this.threshold - 1; }
  }
  isOpen(period: number): boolean { return period < this.openUntilPeriod; }
}
