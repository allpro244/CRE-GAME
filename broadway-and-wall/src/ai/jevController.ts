// THE JEV CONTROLLER — outside the engine, because it waits on the network.
//
// Once per decision period (default a quarter), before the month is advanced:
// for every Jev-run firm build ONE request with all of its questions
// (speculative fan-out), call Jev for all firms in parallel under a
// concurrency cap, and file each firm's answers on the state with
// `withJevAnswers`. The tick then reads them synchronously. The requests are
// all built from the same pre-period state, and the answers are filed in firm
// id order, so a run with the same answers is the same run.
//
// A failed or late call is filed as an error for that firm: every one of its
// decisions falls back to the scripted rule that period. After repeated
// failures the circuit breaker stops calling for a while ("Jev offline").
import type { ParcelTable } from "@/data/types";
import type { GameState } from "@/engine/types";
import { withJevAnswers, jevState } from "@/engine/jev";
import { jevRivals } from "@/engine/rivals";
import { stampJevHistory } from "@/engine/jevmatch";
import { buildJevRequest, type BuiltJevRequest } from "./jevRequest";
import { callJev, JevBreaker, type JevClientOptions } from "./jevClient";
import { estimateTokens, JEV_USD_PER_MTOK, type JevResponse, type JevRequest } from "./jevQuestions";

export interface JevRunOptions extends JevClientOptions {
  /** Parallel calls at most (default 4). */
  concurrency?: number;
  breaker?: JevBreaker;
  /** Answer without HTTP (the mock, or a lab fixture). */
  answer?: (req: JevRequest) => JevResponse | Promise<JevResponse>;
  /** File the answers for this decision month (default: the state's month). Used by the browser's prefetch. */
  forMonth?: number;
  onFirm?: (firmId: string, info: FirmCallInfo) => void;
}

export interface FirmCallInfo { ok: boolean; ms: number; tokens: number; usd: number; questions: number; error?: string }

export interface Fetched { built: BuiltJevRequest; response?: JevResponse; error?: string; ms: number; tokens: number }

/** Is a decision period due at this state's month (Jev firms exist and have no answers filed for it)? */
export function jevDue(s: GameState, forMonth = s.month): boolean {
  const ids = jevRivals(s).map((r) => r.id);
  if (!ids.length) return false;
  const every = s.jev?.every ?? 3;
  if (forMonth % every !== 0) return false;
  return ids.some((id) => s.jev?.firms[id]?.m !== forMonth);
}

/** Build and send every Jev firm's request. Does not change the state. */
export async function fetchJevDecisions(s: GameState, parcels: ParcelTable, o: JevRunOptions = {}): Promise<Fetched[]> {
  const forMonth = o.forMonth ?? s.month;
  const period = Math.floor(forMonth / Math.max(1, s.jev?.every ?? 3));
  const ids = jevRivals(s).map((r) => r.id).filter((id) => s.jev?.firms[id]?.m !== forMonth).sort();
  const out: Fetched[] = [];
  // BUILD EVERY REQUEST FIRST, then send them. Building is synchronous work
  // (the pro formas behind the build options); interleaving it with the calls
  // blocked the tab while earlier calls' timers ran, and in the browser the
  // answers arrived "late" although TypeSafe had replied in 200-300ms.
  const builts: BuiltJevRequest[] = [];
  for (const id of ids) {
    try { builts.push(buildJevRequest(s, parcels, id)); } catch { /* not a Jev firm any more */ }
  }
  const queue = [...builts];
  const worker = async () => {
    for (let built = queue.shift(); built; built = queue.shift()) {
      const id = built.firmId;
      const tokens = estimateTokens(built.request);
      const qn = Object.keys(built.request.questions).length;
      const t0 = Date.now();
      let f: Fetched;
      if (!qn) {
        f = { built, response: { model: "none", answers: {} }, ms: 0, tokens: 0 };
      } else if (o.breaker && !o.breaker.allow(period)) {
        f = { built, error: "Jev offline (circuit open after repeated failures) — scripted rules decide", ms: 0, tokens: 0 };
      } else {
        try {
          const response = o.answer ? await o.answer(built.request) : (await callJev(built.request, o)).response;
          o.breaker?.ok();
          f = { built, response, ms: Date.now() - t0, tokens: response.usage?.input_tokens ?? tokens };
        } catch (e) {
          o.breaker?.fail(period);
          f = { built, error: (e as Error).message || String(e), ms: Date.now() - t0, tokens: 0 };
        }
      }
      out.push(f);
      o.onFirm?.(id, { ok: !f.error, ms: f.ms, tokens: f.tokens, usd: f.tokens * JEV_USD_PER_MTOK / 1e6, questions: qn, error: f.error });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, o.concurrency ?? 4) }, worker));
  return out.sort((a, b) => (a.built.firmId < b.built.firmId ? -1 : 1));
}

/** File fetched answers on the state (firm id order), then mark the period for the match chart. */
export function applyJevDecisions(s0: GameState, parcels: ParcelTable, fetched: Fetched[], forMonth = s0.month): GameState {
  let s = s0;
  for (const f of fetched) {
    s = withJevAnswers(s, f.built.firmId, f.built.ctx, {
      answers: f.response?.answers, model: f.response?.model, tokens: f.tokens, error: f.error,
    }, forMonth);
  }
  if (fetched.length) jevState(s);
  return stampJevHistory(s, parcels);
}

/** Fetch and file in one step (headless runs, tests). */
export async function runJevPeriod(s: GameState, parcels: ParcelTable, o: JevRunOptions = {}): Promise<GameState> {
  const fetched = await fetchJevDecisions(s, parcels, o);
  return applyJevDecisions(s, parcels, fetched, o.forMonth ?? s.month);
}
