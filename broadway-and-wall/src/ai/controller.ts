// THE AI CONTROLLER — outside the engine, because it waits on the network.
//
// Between months, on the turn cadence (default: each quarter), for every
// living AI-run firm: build its brief from the state as it stands, call its
// provider, parse `{reasoning, orders}`, and hand the orders to the engine's
// `applyAiOrders`. The calls run in parallel off the SAME pre-turn state, so
// no firm sees another's orders before placing its own; the orders are then
// applied one firm at a time in a fixed order (firm id), so a run with the
// same replies is the same run.
//
// A failed call — timeout, HTTP error, refusal, unparseable reply — is retried
// once and then logged, and the firm holds that quarter. It never stops the
// clock and never costs the firm anything.
import type { ParcelTable } from "@/data/types";
import type { GameState } from "@/engine/types";
import { AI_BRIEF_CAP, aiBrief, aiFirmIds, applyAiOrders, stampAiHistory } from "@/engine/aifirms";
import { callProvider, type AiProviderConfig, type ProviderResult } from "./providers";

export interface AiControllerOptions {
  /** Months between turns (default 3 — a quarter). */
  everyMonths?: number;
  /** Cost guard: at most this many provider calls per turn; firms past it hold (default 12). */
  maxCallsPerTurn?: number;
  /** Cost guard across a run: a shared counter; once `used >= max` every firm holds. */
  budget?: { used: number; max: number };
  /** Retries after a failed call (default 1). */
  retries?: number;
  fetchImpl?: typeof fetch;
  /** Called after each firm's turn is filed. */
  onTurn?: (firmId: string, result: { ok: boolean; reasoning: string; error?: string; ms?: number; usage?: ProviderResult["usage"] }) => void;
}

/** Is a turn due at this state's month? True on the cadence, when AI firms exist and have not moved this month. */
export function aiTurnDue(s: GameState, everyMonths = 3): boolean {
  const ids = aiFirmIds(s);
  if (!ids.length || s.month % Math.max(1, everyMonths) !== 0) return false;
  const moved = new Set((s.aiTurns ?? []).filter((t) => t.m === s.month).map((t) => t.firmId));
  return ids.some((id) => !moved.has(id));
}

/**
 * RUN ONE TURN for every AI firm that has not moved this month. `configs`
 * maps firm id to its provider; a firm with no config holds and says why.
 * Returns the new state (the input is never mutated).
 */
export async function runAiTurn(
  s0: GameState, parcels: ParcelTable, configs: Record<string, AiProviderConfig | undefined>,
  opts: AiControllerOptions = {},
): Promise<GameState> {
  const moved = new Set((s0.aiTurns ?? []).filter((t) => t.m === s0.month).map((t) => t.firmId));
  const ids = aiFirmIds(s0).filter((id) => !moved.has(id)).sort();
  if (!ids.length) return s0;
  const cap = opts.maxCallsPerTurn ?? 12;
  const retries = opts.retries ?? 1;
  type Out = { id: string; orders: unknown[]; reasoning: string; error?: string; ms?: number; usage?: ProviderResult["usage"] };
  const outs = await Promise.all(ids.map(async (id, i): Promise<Out> => {
    const cfg = configs[id];
    if (!cfg) return { id, orders: [], reasoning: "", error: "No provider is configured for this firm on this device — it holds." };
    if (i >= cap) return { id, orders: [], reasoning: "", error: `Cost guard: only ${cap} calls per turn.` };
    if (opts.budget && opts.budget.used >= opts.budget.max) return { id, orders: [], reasoning: "", error: `Cost guard: the run's ${opts.budget.max}-call budget is spent.` };
    let brief;
    try {
      brief = aiBrief(s0, parcels, id);
    } catch (e) {
      return { id, orders: [], reasoning: "", error: `Brief failed: ${(e as Error).message}` };
    }
    const size = JSON.stringify(brief).length;
    if (size > AI_BRIEF_CAP * 1.5) return { id, orders: [], reasoning: "", error: `Brief is ${size} chars, over the cap.` };
    let last = "";
    for (let a = 0; a <= retries; a++) {
      if (opts.budget) opts.budget.used++;
      try {
        const r = await callProvider(cfg, brief, opts.fetchImpl);
        return { id, orders: r.reply.orders, reasoning: r.reply.reasoning, ms: r.ms, usage: r.usage };
      } catch (e) {
        last = (e as Error).message || String(e);
      }
    }
    return { id, orders: [], reasoning: "", error: `Call failed (${retries + 1} tries): ${last}` };
  }));
  let s = s0;
  for (const o of outs) {
    const provider = configs[o.id]?.kind;
    s = applyAiOrders(s, parcels, o.id, o.orders, { reasoning: o.reasoning, error: o.error, ms: o.ms, provider }).s;
    opts.onTurn?.(o.id, { ok: !o.error, reasoning: o.reasoning, error: o.error, ms: o.ms, usage: o.usage });
  }
  return stampAiHistory(s, parcels);
}
