// THE WIRE PROTOCOL between the game and an outside AI that runs a firm.
//
// One request per firm per turn: the game sends a brief (engine/aifirms.ts,
// `aiBrief`) and expects back
//
//     { "reasoning": "<free text>", "orders": [ { "action": "buy", ... }, ... ] }
//
// Pure: no I/O here, so the browser controller, the headless match runner and
// the tests all parse replies with exactly this code. See AI_FIRMS.md.
import type { AiBrief } from "@/engine/aifirms";

export interface AiReply {
  reasoning: string;
  orders: unknown[];
}

/** The game, explained once, for chat-style providers. Stable text so providers can cache it. */
export const AI_SYSTEM_PROMPT = [
  "You run a commercial real estate investment firm in Broadway & Wall, a month-by-month simulation of a city's property market.",
  "Each turn (normally one per quarter) you receive a JSON brief: your firm's balance sheet and buildings, the market (cycle phase, policy rate, cap rates, vacancy),",
  "the buildings and land for sale on the tape, the street's leaderboard, recent news, the verdicts on your last orders, and the action menu with a JSON schema for each action.",
  "Your score is your firm's equity (assets at appraisal - debt + cash). Money only moves through real mechanics: purchases pay 2% closing costs; loans are sized by lenders on",
  "coverage, debt yield and advance rate; debt costs the policy rate + 1.9%; sales take months to find a buyer and pay 25% tax on gains; income is taxed; overhead is charged;",
  "a firm that cannot pay its debt service draws its credit line, then falls into arrears and can be wound up. Development must pass zoning, the block's cornice height, the",
  "town's required yield on cost, and wait for tenant demand; it takes years and draws equity monthly. Most deals should be walked away from.",
  "Identify buildings and lots by their `bbl` exactly as given. Orders are executed in order; a refused order costs nothing and its reason is shown next turn.",
  'Reply with ONLY a JSON object, no prose outside it: {"reasoning": "<2-6 sentences>", "orders": [ ... ]}. An empty orders list holds.',
].join(" ");

/** The user turn for a chat provider: the brief itself. */
export function briefMessage(brief: AiBrief): string {
  return JSON.stringify(brief);
}

/**
 * PULL A REPLY OUT OF WHATEVER CAME BACK. Models wrap JSON in prose and code
 * fences; webhooks return objects. Accepts an object with `orders`, a JSON
 * string, fenced JSON, or JSON embedded in text (the first balanced {...}
 * that parses and has `orders` or `reasoning`). Throws with a reason otherwise.
 */
export function parseAiReply(raw: unknown): AiReply {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return shape(raw as Record<string, unknown>);
  if (Array.isArray(raw)) return { reasoning: "", orders: raw };
  if (typeof raw !== "string") throw new Error("Reply was neither JSON nor text.");
  const text = raw.trim();
  const tries: string[] = [text];
  for (const m of text.matchAll(/```(?:json|JSON)?\s*([\s\S]*?)```/g)) tries.push(m[1].trim());
  for (const c of balancedObjects(text)) tries.push(c);
  for (const t of tries) {
    try {
      const v = JSON.parse(t);
      if (v && typeof v === "object" && !Array.isArray(v) && ("orders" in v || "reasoning" in v)) return shape(v);
      if (Array.isArray(v)) return { reasoning: "", orders: v };
    } catch { /* next candidate */ }
  }
  throw new Error(`No JSON {reasoning, orders} object found in the reply (${text.slice(0, 120).replace(/\s+/g, " ")}${text.length > 120 ? "…" : ""}).`);
}

function shape(v: Record<string, unknown>): AiReply {
  const orders = v.orders === undefined || v.orders === null ? [] : v.orders;
  if (!Array.isArray(orders)) throw new Error("`orders` must be an array.");
  const reasoning = typeof v.reasoning === "string" ? v.reasoning
    : v.reasoning === undefined ? "" : JSON.stringify(v.reasoning);
  return { reasoning: reasoning.slice(0, 4000), orders };
}

/** Every top-level balanced {...} substring, string-literal aware. */
function balancedObjects(t: string): string[] {
  const out: string[] = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") { if (depth === 0) start = i; depth++; }
    else if (c === "}" && depth > 0) { depth--; if (depth === 0 && start >= 0) { out.push(t.slice(start, i + 1)); start = -1; } }
  }
  return out;
}
