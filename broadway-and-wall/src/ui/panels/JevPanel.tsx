// JEV ON SCREEN: the Settings panel (key, route, which firms, test connection,
// cost meter), the per-firm decision card the Street table opens, and the
// Match page. Engine: engine/jev.ts; questions: src/ai/jevQuestions.ts; glue:
// state/jevStore.ts. See JEV.md.
import { useMemo, useState } from "react";
import { useStore } from "@/state/store";
import { useJev, testJevConnection, asSpectator, jevConfigured, runDueJev } from "@/state/jevStore";
import { setJevFirms, jevStandings, defaultJevFirms } from "@/engine/jevmatch";
import { livingRivals } from "@/engine/rivals";
import { resolveRec } from "@/engine/value";
import { monthLabel } from "@/engine/types";
import type { GameState } from "@/engine/types";
import type { JevLogEntry } from "@/engine/jev";
import { CHARTERS, DEFAULT_THRESHOLDS, JEV_USD_PER_MTOK, type CharterId, type JevAnswer, type JevThresholds } from "@/ai/jevQuestions";
import { charterForStyle } from "@/ai/jevQuestions";
import { LineChart } from "@/ui/Chart";
import { usd } from "@/ui/format";

const COLORS = ["#8a3b2e", "#2f5d8a", "#5a7d2c", "#8a6d1f", "#6b3f86", "#1f7a74", "#a0522d", "#4a4a4a"];
const PATH_WORD: Record<string, string> = { jev: "Jev → acted", pass: "Jev → confident no", fallback: "scripted rule" };

export function JevBadge() {
  return <span className="chip" style={{ background: "#6b3f86", marginLeft: 6, fontSize: 10, padding: "1px 6px" }} title="Judgement informed by TypeSafe's Jev">JEV</span>;
}

// ------------------------------------------------------------------ settings

export function JevSettings() {
  const game = useStore((s) => s.game);
  const parcels = useStore((s) => s.parcels);
  const j = useJev();
  const [note, setNote] = useState("");
  const [n, setN] = useState(6);
  const put = (g: GameState) => useStore.setState({ game: g });
  const jevIds = new Set(game ? (game.rivals ?? []).filter((r) => r.jev && r.failedM === undefined).map((r) => r.id) : []);
  const thr: JevThresholds = game?.jev?.thresholds ?? DEFAULT_THRESHOLDS;
  const setThr = (k: keyof JevThresholds, v: number) => {
    if (!game?.jev) return;
    put({ ...game, jev: { ...game.jev, thresholds: { ...game.jev.thresholds, [k]: v } } });
  };
  const perCallTokens = j.meter.calls ? j.meter.tokens / j.meter.calls : 5000;
  const perYear = jevIds.size * (12 / Math.max(1, j.every)) * perCallTokens * JEV_USD_PER_MTOK / 1e6;
  const apply = (ids: string[], charters?: Record<string, CharterId>) => {
    if (!game) return;
    put(setJevFirms(game, { firms: ids.map((id) => ({ id, charter: charters?.[id] })), every: j.every }));
  };

  return (
    <div className="jev-settings">
      <div className="hint">
        Let TypeSafe's <b>Jev</b> inform the judgement of rival firms. Jev is a fast "System One" model: it does no arithmetic and
        writes no orders. Each quarter the engine computes every number, turns them into plain phrases, and asks each Jev-run firm's
        questions in one call — which listing to buy, whether to sell a holding, whether to take equity out, which scheme to start.
        Code acts only when Jev is confident; otherwise the firm's own scripted rule decides. Without a key the game is exactly the
        scripted game. See JEV.md.
      </div>
      <div className="grid" style={{ gridTemplateColumns: "180px 1fr", gap: "6px 10px", alignItems: "center" }}>
        <span>Status</span>
        <span className={j.status === "error" || j.status === "offline" ? "neg" : ""}>
          {!jevConfigured() ? "not set up — the street runs on its scripted rules"
            : j.status === "offline" ? "Jev offline — firms are on their scripted rules until it answers again"
              : j.status === "error" ? `last call failed: ${j.lastError.slice(0, 120)}`
                : j.status === "ok" ? "connected" : "set up; no call yet"}
          {j.busy ? " · asking Jev…" : ""}
        </span>
        <span>Usage this session</span>
        <span className="mono">{j.meter.calls} calls · {j.meter.tokens.toLocaleString()} tokens · ${j.meter.usd.toFixed(4)}{j.meter.ms ? ` · last ${j.meter.ms}ms` : ""}</span>
        <label htmlFor="jev-route">Route</label>
        <select id="jev-route" value={j.route} onChange={(e) => j.set({ route: e.target.value as "bridge" | "direct" })}>
          <option value="bridge">Through the local bridge (pnpm ai-bridge) — recommended</option>
          <option value="direct">Direct to api.typesafe.ai (only if TypeSafe allows this page's origin)</option>
        </select>
        {j.route === "bridge" && <>
          <label htmlFor="jev-bridge">Bridge URL</label>
          <input id="jev-bridge" className="ask-input mono" style={{ width: "100%", maxWidth: 420 }} value={j.bridgeUrl} onChange={(e) => j.set({ bridgeUrl: e.target.value })} />
        </>}
        <label htmlFor="jev-key">TypeSafe API key</label>
        <input id="jev-key" className="ask-input mono" style={{ width: "100%", maxWidth: 420 }} type="password" autoComplete="off"
          placeholder={j.route === "bridge" ? "empty if the bridge has TYPESAFE_API_KEY" : "sk-…"} value={j.key} onChange={(e) => j.set({ key: e.target.value })} />
        <span />
        <label className="hint" style={{ margin: 0 }}>
          <input type="checkbox" checked={j.remember} onChange={(e) => j.set({ remember: e.target.checked })} /> Remember the key on this device
          (never written into a save; sent only to {j.route === "bridge" ? "the bridge, which forwards it to api.typesafe.ai" : "api.typesafe.ai"})
        </label>
        <label htmlFor="jev-timeout">Give up on a call after</label>
        <select id="jev-timeout" value={j.timeoutMs} onChange={(e) => j.set({ timeoutMs: Number(e.target.value) })}>
          {[5000, 15000, 30000, 60000].map((ms) => <option key={ms} value={ms}>{ms / 1000} seconds{ms === 15000 ? " (default)" : ""}</option>)}
        </select>
        <label htmlFor="jev-every">Decision period</label>
        <select id="jev-every" value={j.every} onChange={(e) => {
          const every = Number(e.target.value);
          j.set({ every });
          if (game?.jev) put({ ...game, jev: { ...game.jev, every } });
        }}>
          <option value={1}>every month</option><option value={3}>every quarter</option><option value={6}>every half-year</option><option value={12}>every year</option>
        </select>
      </div>
      <div className="btn-row" style={{ marginTop: 8 }}>
        <button className="btn btn-sm" disabled={!jevConfigured()} onClick={() => {
          setNote("Calling…");
          testJevConnection().then(setNote, (e: Error) => setNote(`Failed: ${e.message}`));
        }}>Test connection</button>
        {game && jevIds.size > 0 && <button className="btn btn-sm" onClick={() => void runDueJev()}>Ask Jev now (if a period is due)</button>}
        {game && !game.spectator && <button className="btn btn-sm" onClick={() => put(asSpectator(game))}>Sit out — spectate from here</button>}
      </div>
      {note && <div className="hint">{note}</div>}

      {game && parcels && (
        <>
          <div className="page-section" style={{ marginTop: 12 }}>Which firms Jev runs</div>
          <div className="hint">
            {jevIds.size} firm{jevIds.size === 1 ? "" : "s"} · about {Math.round(perCallTokens).toLocaleString()} input tokens a call ·
            {" "}≈ ${perYear.toFixed(3)} a game-year at ${JEV_USD_PER_MTOK}/M input tokens (output is free) · 70–500ms a call.
          </div>
          <div className="btn-row" style={{ flexWrap: "wrap" }}>
            <select aria-label="How many firms" value={n} onChange={(e) => setN(Number(e.target.value))}>
              {[1, 2, 3, 4, 6, 8, 12].map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <button className="btn btn-sm btn-buy" onClick={() => apply(defaultJevFirms(game, parcels, n))}>Jev runs the {n} largest firms</button>
            <button className="btn btn-sm" onClick={() => apply(livingRivals(game).map((r) => r.id))}>All firms</button>
            <button className="btn btn-sm btn-sell" onClick={() => apply([])}>None</button>
          </div>
          <table className="tbl" style={{ marginTop: 6 }}>
            <thead><tr><th>Jev</th><th>Firm</th><th>Charter (sent to Jev as firm_mandate)</th></tr></thead>
            <tbody>
              {livingRivals(game).map((r) => (
                <tr key={r.id}>
                  <td><input type="checkbox" aria-label={`Jev runs ${r.name}`} checked={jevIds.has(r.id)} onChange={(e) => {
                    const ids = new Set(jevIds);
                    if (e.target.checked) ids.add(r.id); else ids.delete(r.id);
                    apply([...ids], Object.fromEntries((game.rivals ?? []).filter((x) => x.jev).map((x) => [x.id, x.jev!.charter])));
                  }} /></td>
                  <td>
                    {jevIds.has(r.id)
                      ? <input className="ask-input" style={{ width: 200 }} defaultValue={r.name} aria-label="Firm name"
                        onBlur={(e) => { if (e.target.value.trim() && e.target.value !== r.name) put(setJevFirms(game, { firms: (game.rivals ?? []).filter((x) => x.jev).map((x) => ({ id: x.id, charter: x.jev!.charter, name: x.id === r.id ? e.target.value : undefined })) })); }} />
                      : r.name}
                  </td>
                  <td>
                    {jevIds.has(r.id) ? (
                      <select value={r.jev!.charter} aria-label="Charter" onChange={(e) => put(setJevFirms(game, { firms: (game.rivals ?? []).filter((x) => x.jev).map((x) => ({ id: x.id, charter: x.id === r.id ? e.target.value as CharterId : x.jev!.charter })) }))}>
                        {(Object.keys(CHARTERS) as CharterId[]).map((c) => <option key={c} value={c}>{CHARTERS[c].label}</option>)}
                      </select>
                    ) : <span className="dim">{CHARTERS[charterForStyle(r.style)].label} (scripted)</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {game.jev && (
            <>
              <div className="page-section" style={{ marginTop: 12 }}>When code acts on an answer</div>
              <div className="grid" style={{ gridTemplateColumns: "300px 90px", gap: "4px 10px", alignItems: "center" }}>
                {([
                  ["buyPick", "Buy: pick confidence at least"], ["buyComposite", "Buy: composite score at least"], ["scoreConf", "Buy: each score's confidence at least"],
                  ["sellAct", "Sell: p(yes) at least"], ["sellHold", "Keep all: every p(yes) at most"], ["refiAct", "Refinance: p(yes) at least"],
                  ["build", "Build: pick confidence at least"], ["claimVeto", "Stay out of city work: p(yes) at most"], ["distress", "Forced sale: pick confidence at least"],
                ] as [keyof JevThresholds, string][]).map(([k, label]) => (
                  <label key={k} style={{ display: "contents" }}>
                    <span>{label}</span>
                    <input className="ask-input mono" type="number" min={0} max={1} step={0.05} value={thr[k]} onChange={(e) => setThr(k, Math.max(0, Math.min(1, Number(e.target.value))))} />
                  </label>
                ))}
              </div>
              <div className="hint">Below a threshold the firm's scripted rule decides that decision, and the log says so.</div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ the decision card

const addr = (g: GameState, parcels: unknown, bbl: string) => (parcels ? resolveRec(parcels as never, g, bbl)?.address : undefined) ?? bbl;

function answerLine(a: JevAnswer | undefined): string {
  if (!a) return "—";
  if (a.type === "noul") return `p(yes) ${a.noul.toFixed(2)}`;
  if (a.type === "score") return `${a.score.toFixed(2)} of 4 · confidence ${a.confidence.toFixed(2)}`;
  const top = Object.entries(a.probabilities).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, p]) => `${k} ${(p * 100).toFixed(0)}%`).join(", ");
  return `${a.choice} · confidence ${a.confidence.toFixed(2)} (${top})`;
}

/** One firm's latest Jev period: what was asked, what Jev said, what code did. */
export function JevFirmCard({ firmId }: { firmId: string }) {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels);
  const p = game.jev?.firms[firmId];
  if (!p) return <div className="hint">No Jev answers yet — the first are asked at the next decision period.</div>;
  if (p.error) return <div className="hint neg">{monthLabel(p.m)}: the call failed — every decision fell back to the scripted rule. {p.error}</div>;
  const log = (game.jev?.log ?? []).filter((l) => l.firmId === firmId && l.m > p.m && l.m <= p.m + p.every);
  const a = p.answers;
  const pick = a.buy_pick?.type === "choice" ? a.buy_pick.choice : undefined;
  const rows: [string, string, string][] = [];
  if (a.buy_pick) rows.push(["buy_pick", "Which listing to buy (choice)", answerLine(a.buy_pick).replace(pick ?? "\u0000", pick && pick !== "none" ? addr(game, parcels, pick) : "none")]);
  if (pick && pick !== "none") for (const k of ["value", "location", "income", "fit"]) rows.push([`buy_${k}`, `${k} of ${addr(game, parcels, pick)} (score)`, answerLine(a[`buy_${k}_${pick}`])]);
  if (a.buy_timing) rows.push(["buy_timing", "Buyer's or seller's market (score)", answerLine(a.buy_timing)]);
  const sells = p.ctx.sell.map((b) => [b, a[`sell_${b}`]] as const).filter(([, x]) => x?.type === "noul").sort((x, y) => (y[1] as { noul: number }).noul - (x[1] as { noul: number }).noul).slice(0, 4);
  for (const [b, x] of sells) rows.push([`sell_${b}`, `Sell ${addr(game, parcels, b)}? (noul)`, answerLine(x)]);
  if (a.refi) rows.push(["refi", "Take equity out? (noul)", answerLine(a.refi)]);
  if (a.build_pick) rows.push(["build_pick", "Which scheme to start (choice)", answerLine(a.build_pick)]);
  if (a.claim_jobs) rows.push(["claim_jobs", "Take on city work? (noul)", answerLine(a.claim_jobs)]);
  if (a.distress_pick) rows.push(["distress_pick", "Which building to sell under duress (choice)", answerLine(a.distress_pick)]);
  return (
    <div style={{ margin: "4px 0 8px" }}>
      <div className="hint" style={{ margin: 0 }}>
        Asked {monthLabel(p.m)} · {Object.keys(a).length} questions · {p.model ?? "?"} · {p.tokens?.toLocaleString() ?? "?"} tokens
      </div>
      <table className="tbl" style={{ marginTop: 4 }}>
        <thead><tr><th>Question</th><th>Jev's answer</th></tr></thead>
        <tbody>{rows.map(([id, q, ans]) => <tr key={id}><td title={id}>{q}</td><td className="mono" style={{ fontSize: 12 }}>{ans}</td></tr>)}</tbody>
      </table>
      <table className="tbl" style={{ marginTop: 4 }}>
        <thead><tr><th>Decision</th><th>Path</th><th>Why / what code did</th></tr></thead>
        <tbody>
          {log.length ? log.map((l, i) => (
            <tr key={i} className={l.path === "fallback" ? "dim" : ""}>
              <td>{l.point}</td><td>{PATH_WORD[l.path] ?? l.path}</td><td>{l.action ?? l.why}</td>
            </tr>
          )) : <tr><td colSpan={3} className="dim">No decision reached yet this period.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export const lastJevAct = (g: GameState, firmId: string): JevLogEntry | undefined =>
  [...(g.jev?.log ?? [])].reverse().find((l) => l.firmId === firmId && (l.action || l.path !== "fallback"));

// ------------------------------------------------------------------ the match page

export function MatchPage() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const focus = useStore((s) => s.focus);
  const busy = useJev((s) => s.busy);
  const [firm, setFirm] = useState<string | "all">("all");
  const st = useMemo(() => jevStandings(game, parcels), [game, parcels]);
  const jevs = st.filter((x) => x.jev);
  if (!jevs.length) {
    return <div className="hint">No firm is Jev-run. Settings → Jev: pick the firms, or tick "Jev runs N firms" on the start screen.</div>;
  }
  const hist = game.jevHistory ?? [];
  const series = jevs.map((x, i) => ({ label: x.name, color: COLORS[i % COLORS.length], pts: hist.map((h) => h.eq[x.id] ?? 0) }));
  const log = game.jev?.log ?? [];
  const stats = (id: string) => {
    const l = log.filter((x) => x.firmId === id && !x.action);
    return { jev: l.filter((x) => x.path === "jev").length, pass: l.filter((x) => x.path === "pass").length, fb: l.filter((x) => x.path === "fallback").length };
  };
  const scripted = st.filter((x) => !x.jev && x.failedM === undefined).map((x) => x.equity).sort((a, b) => a - b);
  const deals = Object.entries(game.jevBooks ?? {}).flatMap(([id, es]) => es.map((e) => ({ ...e, id })))
    .filter((e) => firm === "all" || e.id === firm).sort((a, b) => b.m - a.m).slice(0, 50);
  const acts = log.filter((l) => l.action && (firm === "all" || l.firmId === firm)).slice(-40).reverse();
  const name = (id: string) => st.find((x) => x.id === id)?.name ?? id;
  return (
    <div>
      <div className="hint">
        {game.spectator ? "Spectating — your own firm sits out. " : ""}
        Jev decides every {game.jev?.every ?? 3} month{(game.jev?.every ?? 3) === 1 ? "" : "s"}{busy ? " · asking Jev…" : ""}.
        The scripted street's median firm equity is {usd(scripted[Math.floor((scripted.length - 1) / 2)] ?? 0)} across {scripted.length} firms.
        Totals: {game.jev?.calls ?? 0} calls, {(game.jev?.tokens ?? 0).toLocaleString()} tokens (≈ ${((game.jev?.tokens ?? 0) * JEV_USD_PER_MTOK / 1e6).toFixed(4)}), {game.jev?.errors ?? 0} failed.
      </div>
      <div className="page-section">Jev-run firms</div>
      <table className="tbl">
        <thead><tr><th>Firm</th><th>Charter</th><th className="num">Equity</th><th className="num">Paid out</th><th className="num">Buildings</th><th className="num">Debt</th><th className="num">Acted / passed / scripted</th></tr></thead>
        <tbody>
          {jevs.map((x, i) => {
            const s = stats(x.id);
            return (
              <tr key={x.id} className={x.failedM !== undefined ? "dim" : ""} style={{ cursor: "pointer" }} onClick={() => setFirm(firm === x.id ? "all" : x.id)}>
                <td><span style={{ color: COLORS[i % COLORS.length] }}>■</span> {x.name}{x.failedM !== undefined ? ` · wound up ${monthLabel(x.failedM)}` : ""}</td>
                <td className="dim">{CHARTERS[x.charter].label}</td>
                <td className="num">{usd(x.equity)}</td><td className="num">{usd(x.distributed)}</td>
                <td className="num">{x.buildings}</td><td className="num">{usd(x.debt)}</td>
                <td className="num">{s.jev} / {s.pass} / {s.fb}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="page-section">Equity over time</div>
      <LineChart series={series} height={180} xAt={(i) => (hist[i] ? monthLabel(hist[i].m) : "")}
        xLabels={hist.length ? [monthLabel(hist[0].m), monthLabel(hist[hist.length - 1].m)] : undefined} />
      <div className="chip-row">{series.map((s) => <span key={s.label} className="chip" style={{ background: s.color }}>{s.label}</span>)}</div>
      {firm !== "all" && (
        <>
          <div className="page-section">{name(firm)} — the latest period <button className="btn btn-sm" style={{ marginLeft: 8 }} onClick={() => setFirm("all")}>show all</button></div>
          <JevFirmCard firmId={firm} />
        </>
      )}
      <div className="page-section">What code did with Jev's answers{firm !== "all" ? ` — ${name(firm)}` : ""}</div>
      {acts.length ? (
        <table className="tbl">
          <thead><tr><th>When</th><th>Firm</th><th>Decision</th><th>Path</th><th>What happened</th></tr></thead>
          <tbody>{acts.map((l, i) => <tr key={i} className={l.path === "fallback" ? "dim" : ""}><td>{monthLabel(l.m)}</td><td>{name(l.firmId)}</td><td>{l.point}</td><td>{PATH_WORD[l.path]}</td><td>{l.action}</td></tr>)}</tbody>
        </table>
      ) : <div className="hint">Nothing acted on yet.</div>}
      <div className="page-section">Deals{firm !== "all" ? ` — ${name(firm)}` : ""}</div>
      {deals.length ? (
        <table className="tbl">
          <thead><tr><th>When</th><th>Firm</th><th>What</th><th>Building</th><th className="num">Amount</th><th>By</th></tr></thead>
          <tbody>
            {deals.map((e, i) => (
              <tr key={i} style={{ cursor: e.bbl ? "pointer" : undefined }} onClick={() => e.bbl && focus(e.bbl, true)}>
                <td>{monthLabel(e.m)}</td><td>{name(e.id)}</td><td>{e.kind}</td>
                <td>{e.bbl ? addr(game, parcels, e.bbl) : "—"}</td><td className="num">{usd(e.amount)}</td><td className="dim">{e.by === "jev" ? "Jev" : e.by === "script" ? "scripted" : e.with ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <div className="hint">No deals yet.</div>}
    </div>
  );
}
