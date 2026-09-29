// THE AI-FIRM PLUG-IN, ON SCREEN: the Settings panel where a provider is
// configured and tested, the Match page where the firms are watched, and the
// card the Street table opens on an AI firm. The engine side is
// engine/aifirms.ts; the wire is src/ai; the browser glue is state/aiStore.ts.
import { useMemo, useState } from "react";
import { useStore } from "@/state/store";
import { useAi, testProfile, addFirmToGame, convertFirm, asSpectator, runDueAiTurn, type AiProfile } from "@/state/aiStore";
import { aiStandings, type AiTurn } from "@/engine/aifirms";
import { aiRivals, livingRivals } from "@/engine/rivals";
import { resolveRec } from "@/engine/value";
import { monthLabel } from "@/engine/types";
import type { GameState } from "@/engine/types";
import { AI_PROVIDER_DEFAULTS as DEFAULTS, ANTHROPIC_MODELS, type ProviderKind } from "@/ai";
import { LineChart } from "@/ui/Chart";
import { usd } from "@/ui/format";

const KINDS: { k: ProviderKind; label: string; hint: string }[] = [
  { k: "openai-compatible", label: "OpenAI-compatible", hint: "POST {base}/chat/completions — OpenAI, OpenRouter, Together, Groq, Mistral, vLLM, Ollama, LM Studio, most third-party APIs." },
  { k: "anthropic", label: "Anthropic (Claude)", hint: `POST {base}/v1/messages. Models: ${ANTHROPIC_MODELS.join(", ")}.` },
  { k: "webhook", label: "Webhook", hint: "POST the brief JSON to your URL; it returns {reasoning, orders}. The simplest contract for a custom service." },
  { k: "mock", label: "Built-in demo (no API)", hint: "A scripted player that reads the same brief — for trying a match without a key. Styles: yield, contrarian, builder, hold." },
];
const COLORS = ["#8a3b2e", "#2f5d8a", "#5a7d2c", "#8a6d1f", "#6b3f86", "#1f7a74", "#a0522d", "#4a4a4a"];

export function AiBadge() {
  return <span className="chip" style={{ background: "#2f5d8a", marginLeft: 6, fontSize: 10, padding: "1px 6px" }} title="Run by an outside AI">AI</span>;
}

// ------------------------------------------------------------------ settings

export function AiFirmsSettings() {
  const game = useStore((s) => s.game);
  const parcels = useStore((s) => s.parcels);
  const ai = useAi();
  const [draft, setDraft] = useState<AiProfile>({ name: "", kind: "openai-compatible" });
  const [key, setKey] = useState("");
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [convertId, setConvertId] = useState("");
  const d = DEFAULTS[draft.kind];
  const onStreet = game ? new Set(aiRivals(game).map((r) => r.name)) : new Set<string>();
  const put = (g: GameState) => useStore.setState({ game: g });

  const test = async (p: AiProfile) => {
    if (!game || !parcels) return;
    setBusy(p.name);
    setNote((n) => ({ ...n, [p.name]: "Calling…" }));
    try {
      const msg = await testProfile(p, ai.keys[p.name], game, parcels);
      setNote((n) => ({ ...n, [p.name]: msg }));
    } catch (e) {
      setNote((n) => ({ ...n, [p.name]: `Failed: ${(e as Error).message}` }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="ai-settings">
      <div className="hint">
        Let an outside AI run a rival firm. Each quarter the firm's AI is sent a brief — its books, the tape, rates,
        the leaderboard — and answers with orders the engine executes through the same machinery the street uses.
        Keys are held in memory for this session and saved on this device only if you tick "remember"; they are never
        written into a save and are sent only to the endpoint you set. Browsers usually cannot call AI APIs directly —
        run <span className="mono">pnpm ai-bridge</span> and point the base URL at <span className="mono">http://127.0.0.1:8788/openai</span>,
        <span className="mono"> …/anthropic</span> or <span className="mono">…/webhook</span>. See AI_FIRMS.md.
      </div>

      {ai.profiles.map((p) => (
        <div key={p.name} className="deal" style={{ display: "block" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
            <b>{p.name}</b>
            <span className="dim">{KINDS.find((k) => k.k === p.kind)?.label} · {p.model || DEFAULTS[p.kind].model || "—"} · {p.baseUrl || DEFAULTS[p.kind].baseUrl}</span>
            <span className="dim">{ai.keys[p.name] ? (p.remember ? "key saved on this device" : "key for this session") : "no key"}</span>
            {onStreet.has(p.name) && <AiBadge />}
          </div>
          <div className="btn-row" style={{ marginTop: 6 }}>
            <button className="btn btn-sm" disabled={!game || busy !== null} onClick={() => void test(p)}>Test connection</button>
            {game && !onStreet.has(p.name) && (
              <button className="btn btn-sm btn-buy" onClick={() => put(addFirmToGame(game, p, ai.startCash))}>
                Add to this run ({usd(ai.startCash)})
              </button>
            )}
            <button className="btn btn-sm" onClick={() => { setDraft(p); setKey(ai.keys[p.name] ?? ""); }}>Edit</button>
            <button className="btn btn-sm btn-sell" onClick={() => ai.removeProfile(p.name)}>Remove</button>
          </div>
          {(note[p.name] || ai.last[p.name]) && (
            <div className="hint" style={{ margin: "4px 0 0" }}>
              {note[p.name] ?? `Last turn: ${ai.last[p.name].ok ? "ok" : "failed"} — ${ai.last[p.name].note}`}
            </div>
          )}
        </div>
      ))}

      <div className="page-section" style={{ marginTop: 12 }}>{ai.profiles.some((p) => p.name === draft.name) ? "Edit firm" : "Add a firm"}</div>
      <div className="grid ai-form" style={{ gridTemplateColumns: "140px 1fr", gap: "6px 10px", alignItems: "center" }}>
        <label htmlFor="ai-name">Firm name</label>
        <input id="ai-name" className="ask-input" style={{ width: "100%", maxWidth: 520 }} value={draft.name} placeholder="JEV Capital" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <label htmlFor="ai-kind">Provider</label>
        <select id="ai-kind" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as ProviderKind })}>
          {KINDS.map((k) => <option key={k.k} value={k.k}>{k.label}</option>)}
        </select>
        <span />
        <span className="hint" style={{ margin: 0 }}>{KINDS.find((k) => k.k === draft.kind)?.hint}</span>
        {draft.kind !== "mock" && <>
          <label htmlFor="ai-url">{draft.kind === "webhook" ? "URL" : "Base URL"}</label>
          <input id="ai-url" className="ask-input mono" style={{ width: "100%", maxWidth: 520 }} value={draft.baseUrl ?? ""} placeholder={d.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} />
        </>}
        {draft.kind === "mock" && <>
          <label htmlFor="ai-style">Style</label>
          <select id="ai-style" value={draft.model || "yield"} onChange={(e) => setDraft({ ...draft, model: e.target.value })}>
            {["yield", "contrarian", "builder", "hold"].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </>}
        {draft.kind !== "webhook" && draft.kind !== "mock" && <>
          <label htmlFor="ai-model">Model</label>
          <input id="ai-model" className="ask-input mono" style={{ width: "100%", maxWidth: 520 }} list={draft.kind === "anthropic" ? "ai-claude-models" : undefined} value={draft.model ?? ""} placeholder={d.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} />
          <datalist id="ai-claude-models">{ANTHROPIC_MODELS.map((m) => <option key={m} value={m} />)}</datalist>
        </>}
        {draft.kind !== "mock" && <>
          <label htmlFor="ai-key">API key</label>
          <input id="ai-key" className="ask-input mono" style={{ width: "100%", maxWidth: 520 }} type="password" autoComplete="off" value={key} placeholder={draft.kind === "webhook" ? "optional (sent as Bearer)" : "empty if the bridge holds it"} onChange={(e) => setKey(e.target.value)} />
          <span />
          <label className="hint" style={{ margin: 0 }}>
            <input type="checkbox" checked={!!draft.remember} onChange={(e) => setDraft({ ...draft, remember: e.target.checked })} /> Remember the key on this device
          </label>
        </>}
        {draft.kind === "anthropic" && <>
          <span />
          <label className="hint" style={{ margin: 0 }}>
            <input type="checkbox" checked={!!draft.browserDirect} onChange={(e) => setDraft({ ...draft, browserDirect: e.target.checked })} /> Direct from the browser (sends anthropic-dangerous-direct-browser-access)
          </label>
        </>}
        {draft.kind === "openai-compatible" && <>
          <span />
          <label className="hint" style={{ margin: 0 }}>
            <input type="checkbox" checked={!!draft.jsonMode} onChange={(e) => setDraft({ ...draft, jsonMode: e.target.checked })} /> JSON mode (response_format json_object)
          </label>
        </>}
      </div>
      <div className="btn-row" style={{ marginTop: 8 }}>
        <button className="btn btn-buy" disabled={!draft.name.trim()} onClick={() => {
          ai.saveProfile({ ...draft, name: draft.name.trim() }, key);
          setDraft({ name: "", kind: draft.kind });
          setKey("");
        }}>Save firm</button>
      </div>

      <div className="page-section" style={{ marginTop: 14 }}>The match</div>
      <div className="grid" style={{ gridTemplateColumns: "220px 1fr", gap: "6px 10px", alignItems: "center" }}>
        <label htmlFor="ai-every">A turn every</label>
        <select id="ai-every" value={ai.everyMonths} onChange={(e) => ai.set({ everyMonths: Number(e.target.value) })}>
          <option value={1}>month</option><option value={3}>quarter</option><option value={6}>half-year</option><option value={12}>year</option>
        </select>
        <label htmlFor="ai-cash">Starting capital per new firm</label>
        <select id="ai-cash" value={ai.startCash} onChange={(e) => ai.set({ startCash: Number(e.target.value) })}>
          {[5e6, 10e6, 25e6, 50e6, 100e6].map((c) => <option key={c} value={c}>{usd(c)}</option>)}
        </select>
      </div>
      {game && (
        <>
          <div className="btn-row" style={{ marginTop: 8, flexWrap: "wrap" }}>
            <select aria-label="Scripted firm to hand to an AI" value={convertId} onChange={(e) => setConvertId(e.target.value)}>
              <option value="">Hand a street firm to an AI…</option>
              {livingRivals(game).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            {convertId && ai.profiles.map((p) => (
              <button key={p.name} className="btn btn-sm" onClick={() => { put(convertFirm(game, convertId, p)); setConvertId(""); }}>
                with {p.name}'s provider
              </button>
            ))}
            {!game.spectator && aiRivals(game).length > 0 && (
              <button className="btn btn-sm" onClick={() => put(asSpectator(game))}>Sit out — spectate from here</button>
            )}
            {aiRivals(game).length > 0 && (
              <button className="btn btn-sm" disabled={useAi.getState().busy} onClick={() => void runDueAiTurn()}>Run the due turn now</button>
            )}
          </div>
          <div className="hint">To start a fresh match, tick "AI firms" (and "Spectator") on the start screen: every saved firm above opens with the same starting capital.</div>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ the turn card

function orderLine(o: unknown, game: GameState, parcels: Record<string, never> | null): string {
  if (!o || typeof o !== "object") return JSON.stringify(o);
  const x = o as Record<string, unknown>;
  const bbl = typeof x.bbl === "string" ? x.bbl : undefined;
  const addr = bbl && parcels ? resolveRec(parcels as never, game, bbl)?.address ?? bbl : bbl;
  const bits = [String(x.action ?? "?"), addr, x.maxPrice ? `≤ ${usd(Number(x.maxPrice))}` : "", x.minPrice ? `≥ ${usd(Number(x.minPrice))}` : "",
    x.ask ? `ask ${usd(Number(x.ask))}` : "", x.leverage !== undefined ? `${Math.round(Number(x.leverage) * 100)}% debt` : "",
    x.use ? `${x.use} × ${x.floors}` : "", x.amount ? usd(Number(x.amount)) : ""];
  return bits.filter(Boolean).join(" ");
}

export function AiTurnCard({ turn }: { turn: AiTurn | undefined }) {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels) as Record<string, never> | null;
  if (!turn) return <div className="hint">No turn yet — the first is taken at the next quarter.</div>;
  return (
    <div className="ai-turn" style={{ margin: "6px 0" }}>
      <div className="hint" style={{ margin: 0 }}>
        <b>{monthLabel(turn.m)}</b> · {turn.provider}{turn.error ? <span className="neg"> · held: {turn.error}</span> : null}
      </div>
      {turn.reasoning && <div style={{ fontStyle: "italic", margin: "3px 0 4px" }}>"{turn.reasoning}"</div>}
      {turn.results.length > 0 && (
        <ul style={{ margin: "2px 0 0 18px", padding: 0 }}>
          {turn.results.map((r, i) => (
            <li key={i} className={r.ok ? "" : "dim"}>
              <span className={r.ok ? "pos" : "neg"}>{r.ok ? "✓" : "✗"}</span> {orderLine(r.order, game, parcels)} — {r.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const lastTurnOf = (g: GameState, firmId: string) => [...(g.aiTurns ?? [])].reverse().find((t) => t.firmId === firmId);

// ------------------------------------------------------------------ the match page

export function MatchPage() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const focus = useStore((s) => s.focus);
  const busy = useAi((s) => s.busy);
  const [firm, setFirm] = useState<string | "all">("all");
  const st = useMemo(() => aiStandings(game, parcels), [game, parcels]);
  if (!st.length) {
    return (
      <div>
        <div className="hint">No AI firms on the street. Add one under Settings → AI firms, or start a run with AI firms (and Spectator) ticked.</div>
      </div>
    );
  }
  const hist = game.aiHistory ?? [];
  const series = st.map((x, i) => ({ label: x.name, color: COLORS[i % COLORS.length], pts: hist.map((h) => h.eq[x.id] ?? 0) }));
  const deals = Object.entries(game.aiBooks ?? {}).flatMap(([id, es]) => es.map((e) => ({ ...e, id })))
    .filter((e) => e.kind !== "paydown" && (firm === "all" || e.id === firm))
    .sort((a, b) => b.m - a.m).slice(0, 60);
  const name = (id: string) => st.find((x) => x.id === id)?.name ?? id;
  const turns = (game.aiTurns ?? []).filter((t) => firm === "all" || t.firmId === firm).slice(-24).reverse();
  return (
    <div>
      <div className="hint">
        {game.spectator ? "Spectating — your own firm sits out. " : ""}
        Turns every {useAi.getState().everyMonths} month{useAi.getState().everyMonths === 1 ? "" : "s"}{busy ? " · the AIs are thinking…" : ""}.
        Equity is assets at appraisal less debt plus cash; AI firms distribute nothing, so equity is the score.
      </div>
      <div className="page-section">Leaderboard</div>
      <table className="tbl">
        <thead><tr><th>#</th><th>Firm</th><th>Provider</th><th className="num">Equity</th><th className="num">Multiple</th><th className="num">Buildings</th><th className="num">Debt</th><th className="num">Deals</th></tr></thead>
        <tbody>
          {st.map((x, i) => {
            const start = hist.find((h) => h.eq[x.id] !== undefined)?.eq[x.id];
            return (
              <tr key={x.id} className={x.failedM !== undefined ? "dim" : ""} style={{ cursor: "pointer" }} onClick={() => setFirm(firm === x.id ? "all" : x.id)}>
                <td>{i + 1}</td>
                <td><span style={{ color: COLORS[i % COLORS.length] }}>■</span> {x.name}{x.failedM !== undefined ? ` · wound up ${monthLabel(x.failedM)}` : ""}</td>
                <td className="dim">{x.provider}{x.model ? ` · ${x.model}` : ""}</td>
                <td className="num">{usd(x.equity)}</td>
                <td className="num">{start ? `${(x.equity / start).toFixed(2)}x` : "—"}</td>
                <td className="num">{x.buildings}</td>
                <td className="num">{usd(x.debt)}</td>
                <td className="num">{x.deals}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="page-section">Equity over time</div>
      <LineChart series={series} height={180} xAt={(i) => (hist[i] ? monthLabel(hist[i].m) : "")}
        xLabels={hist.length ? [monthLabel(hist[0].m), monthLabel(hist[hist.length - 1].m)] : undefined} />
      <div className="chip-row">
        {series.map((s) => <span key={s.label} className="chip" style={{ background: s.color }}>{s.label}</span>)}
      </div>
      <div className="page-section">
        {firm === "all" ? "Deals — every AI firm" : `Deals — ${name(firm)}`}
        {firm !== "all" && <button className="btn btn-sm" style={{ marginLeft: 8 }} onClick={() => setFirm("all")}>show all</button>}
      </div>
      {deals.length ? (
        <table className="tbl">
          <thead><tr><th>When</th><th>Firm</th><th>What</th><th>Building</th><th className="num">Amount</th><th>With</th></tr></thead>
          <tbody>
            {deals.map((e, i) => (
              <tr key={i} style={{ cursor: e.bbl ? "pointer" : undefined }} onClick={() => e.bbl && focus(e.bbl, true)}>
                <td>{monthLabel(e.m)}</td><td>{name(e.id)}</td><td>{e.kind}</td>
                <td>{e.bbl ? resolveRec(parcels, game, e.bbl)?.address ?? e.bbl : "—"}</td>
                <td className="num">{usd(e.amount)}</td><td className="dim">{e.with ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <div className="hint">No deals yet.</div>}
      <div className="page-section">Turns — reasoning and verdicts</div>
      {turns.length ? turns.map((t, i) => (
        <div key={i} className="deal" style={{ display: "block" }}>
          <b>{name(t.firmId)}</b>
          <AiTurnCard turn={t} />
        </div>
      )) : <div className="hint">No turns yet.</div>}
    </div>
  );
}
