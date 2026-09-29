// HOW THE GAME TALKS TO AN OUTSIDE AI. Four transports, one contract:
// brief in, `{reasoning, orders}` out.
//
//   openai-compatible  POST {baseUrl}/chat/completions — OpenAI, and the many
//                      APIs that copy its shape (Together, Groq, Mistral,
//                      OpenRouter, vLLM, Ollama, LM Studio…).
//   anthropic          POST {baseUrl}/v1/messages — Claude's Messages API.
//   webhook            POST the brief JSON to a URL, read {reasoning, orders}
//                      back. The simplest contract for a custom service.
//   mock               a local function, for tests and the offline match.
//
// Keys: a key is passed in the config at call time and sent ONLY to the
// configured endpoint, in the header that endpoint expects. Nothing in this
// file stores one. See AI_FIRMS.md for the local bridge that keeps keys out of
// the browser entirely.
import type { AiBrief } from "@/engine/aifirms";
import { AI_SYSTEM_PROMPT, briefMessage, parseAiReply, type AiReply } from "./protocol";

export type ProviderKind = "openai-compatible" | "anthropic" | "webhook" | "mock";

export interface AiProviderConfig {
  kind: ProviderKind;
  /** openai-compatible: API root incl. /v1 (default https://api.openai.com/v1). anthropic: API root (default https://api.anthropic.com). webhook: the full URL. */
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  /** Extra headers, e.g. a custom service's own auth header. */
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxTokens?: number;
  /** openai-compatible: ask for `response_format: {type: "json_object"}` (not every server accepts it). */
  jsonMode?: boolean;
  /** anthropic from a browser tab: send `anthropic-dangerous-direct-browser-access: true`. */
  browserDirect?: boolean;
  /** mock: the scripted player. */
  script?: (brief: AiBrief) => AiReply | Promise<AiReply>;
}

export const ANTHROPIC_MODELS = ["claude-sonnet-5", "claude-opus-5", "claude-opus-5-5", "claude-haiku-4-5"] as const;
export const DEFAULTS: Record<ProviderKind, { baseUrl: string; model: string }> = {
  "openai-compatible": { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  anthropic: { baseUrl: "https://api.anthropic.com", model: "claude-sonnet-5" },
  webhook: { baseUrl: "http://127.0.0.1:8787/turn", model: "" },
  mock: { baseUrl: "", model: "mock" },
};

export interface ProviderResult {
  reply: AiReply;
  ms: number;
  /** Tokens in/out when the provider reports them. */
  usage?: { input?: number; output?: number };
}

type FetchLike = typeof fetch;

/** One call, with a timeout. Throws on transport, HTTP, refusal or unparseable reply. */
export async function callProvider(cfg: AiProviderConfig, brief: AiBrief, fetchImpl: FetchLike = fetch): Promise<ProviderResult> {
  const t0 = Date.now();
  if (cfg.kind === "mock") {
    if (!cfg.script) throw new Error("mock provider has no script");
    return { reply: parseAiReply(await cfg.script(brief)), ms: Date.now() - t0 };
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), cfg.timeoutMs ?? 60_000);
  try {
    const d = DEFAULTS[cfg.kind];
    const base = (cfg.baseUrl || d.baseUrl).replace(/\/+$/, "");
    const model = cfg.model || d.model;
    let url: string, headers: Record<string, string>, body: unknown;
    if (cfg.kind === "openai-compatible") {
      url = `${base}/chat/completions`;
      headers = { "content-type": "application/json", ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) };
      body = {
        model,
        messages: [{ role: "system", content: AI_SYSTEM_PROMPT }, { role: "user", content: briefMessage(brief) }],
        max_tokens: cfg.maxTokens ?? 4000,
        ...(cfg.jsonMode ? { response_format: { type: "json_object" } } : {}),
      };
    } else if (cfg.kind === "anthropic") {
      url = `${base}/v1/messages`;
      headers = {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        ...(cfg.apiKey ? { "x-api-key": cfg.apiKey } : {}),
        ...(cfg.browserDirect ? { "anthropic-dangerous-direct-browser-access": "true" } : {}),
      };
      // No sampling parameters: current Claude models reject temperature/top_p.
      // Thinking is left at the model's default; its tokens count against max_tokens.
      body = {
        model,
        max_tokens: cfg.maxTokens ?? 8000,
        system: AI_SYSTEM_PROMPT,
        messages: [{ role: "user", content: briefMessage(brief) }],
      };
    } else {
      url = base;
      headers = { "content-type": "application/json", ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) };
      body = brief;
    }
    const res = await fetchImpl(url, {
      method: "POST", headers: { ...headers, ...(cfg.headers ?? {}) }, body: JSON.stringify(body), signal: ctl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${cfg.kind}: ${text.slice(0, 300)}`);
    let json: unknown = undefined;
    try { json = JSON.parse(text); } catch { /* webhook may return fenced text */ }
    if (cfg.kind === "webhook") {
      return { reply: parseAiReply(json ?? text), ms: Date.now() - t0 };
    }
    if (cfg.kind === "openai-compatible") {
      const j = json as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } } | undefined;
      const content = j?.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error(`No choices[0].message.content in the reply: ${text.slice(0, 200)}`);
      return { reply: parseAiReply(content), ms: Date.now() - t0, usage: { input: j?.usage?.prompt_tokens, output: j?.usage?.completion_tokens } };
    }
    const j = json as { content?: { type: string; text?: string }[]; stop_reason?: string; stop_details?: { category?: string; explanation?: string }; usage?: { input_tokens?: number; output_tokens?: number } } | undefined;
    if (j?.stop_reason === "refusal") throw new Error(`The model declined (${j.stop_details?.category ?? "refusal"}).`);
    const content = (j?.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
    if (!content) throw new Error(`No text in the reply (stop_reason ${j?.stop_reason ?? "?"}): ${text.slice(0, 200)}`);
    return { reply: parseAiReply(content), ms: Date.now() - t0, usage: { input: j?.usage?.input_tokens, output: j?.usage?.output_tokens } };
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error(`Timed out after ${Math.round((cfg.timeoutMs ?? 60_000) / 1000)}s.`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
