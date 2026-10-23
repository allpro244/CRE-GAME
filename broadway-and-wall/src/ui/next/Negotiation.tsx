/**
 * THE NEGOTIATION PANEL: one place for every way of buying a building. A
 * banner with their last answer and the next step, a price ladder (the ask,
 * the appraisal, their number, the band where the engine's odds run 25-75%,
 * the insult line) with your price as the handle, the numbers at your price,
 * and the thread so far. The one primary move sits in the file's footer
 * (NegotiationFooter), so it is the same button from every tab.
 */
import { useState } from "react";
import { useStore } from "@/state/store";
import type { GameState } from "@/engine/types";
import type { ParcelTable } from "@/data/types";
import { monthLabel } from "@/engine/types";
import { inPlace, resolveRec } from "@/engine/value";
import { ParcelPanel } from "@/ui/panels/ParcelDesk";
import { usd } from "@/ui/format";
import { ActionFooter, type Verb } from "./Drawer";
import { Figure, fmtFig } from "./Figure";
import { buyPreview, buyDesks } from "./buy";
import { useNext, type DealLine } from "./nextStore";
import { dealAct, dealHeadline, dealView, type DealView } from "./deal";

const EMPTY: DealLine[] = [];

/** The price on the dial: what the player set, else the stage's default. */
export function useDealPx(bbl: string, v: DealView | null): number {
  const set = useNext((s) => s.dealPx[bbl]);
  return set ?? v?.defaultPx ?? 0;
}

function Ladder({ v, px, onPx }: { v: DealView; px: number; onPx: (n: number) => void }) {
  const pts = [v.ask, v.appraisal, v.theirs, v.yours, v.band?.lo, v.band?.hi, v.insult,
    // a blind bid has only the appraisal to stand on: give the dial room either side of it
    ...(v.stage === "blind" ? [v.appraisal * 0.6, v.appraisal * 1.6] : [])].filter((x): x is number => typeof x === "number" && x > 0);
  const lo0 = Math.min(...pts), hi0 = Math.max(...pts);
  const pad = Math.max((hi0 - lo0) * 0.08, hi0 * 0.04);
  const lo = Math.max(0, lo0 - pad), hi = hi0 + pad;
  const at = (x: number) => `${(((x - lo) / (hi - lo)) * 100).toFixed(2)}%`;
  const step = Math.max(1000, Math.round((hi - lo) / 400 / 1000) * 1000);
  const marks: { x: number; k: string; cls: string }[] = [];
  if (v.ask) marks.push({ x: v.ask, k: v.offMarket ? "Their ask" : "Ask", cls: "ask" });
  marks.push({ x: v.appraisal, k: "Appraisal", cls: "appr" });
  if (v.theirs && v.theirs !== v.ask) marks.push({ x: v.theirs, k: v.stage === "agreed" ? "Agreed" : "Their number", cls: "theirs" });
  const odds = v.odds ? v.odds(px) : null;
  return (
    <div className="nx-pl">
      <div className="nx-pl-track">
        {v.insult && <div className="nx-pl-zone nx-pl-insult" style={{ left: 0, width: at(v.insult) }} title="They hang up" />}
        {v.band && <div className="nx-pl-zone nx-pl-band" style={{ left: at(v.band.lo), width: `calc(${at(v.band.hi)} - ${at(v.band.lo)})` }} title={v.odds ? "Even odds or better" : "Usual close"} />}
        {marks.map((m) => (
          <div key={m.k} className={"nx-pl-mark nx-pl-" + m.cls} style={{ left: at(m.x) }}>
            <span className="nx-pl-k">{m.k}</span><span className="nx-pl-v mono">{usd(m.x)}</span>
          </div>
        ))}
        <div className="nx-pl-you" style={{ left: at(Math.min(hi, Math.max(lo, px))) }}>
          <span className="mono">{usd(px)}</span>
          {odds !== null && <span className={"nx-pl-odds " + (odds >= 0.6 ? "nx-pos" : odds < 0.25 ? "nx-neg" : "")}>{Math.round(odds * 100)}%</span>}
        </div>
        <input className="nx-pl-input" type="range" min={lo} max={hi} step={step} value={px} aria-label="Your price"
          disabled={v.stage === "agreed" || v.stage === "refused"}
          onChange={(e) => onPx(Math.round(Number(e.target.value) / 1000) * 1000)} />
      </div>
      <div className="nx-pl-legend mono">
        {v.insult && <span><i className="nx-sw nx-sw-insult" />walk-away {usd(v.insult)}</span>}
        {v.band && <span><i className="nx-sw nx-sw-band" />{v.odds ? "likely yes" : "usual close"} {usd(v.band.lo)}–{usd(v.band.hi)}</span>}
        {!v.odds && v.stage === "blind" && <span className="nx-dim">no number given</span>}
      </div>
    </div>
  );
}

export function NegotiationPanel({ game, parcels, bbl }: { game: GameState; parcels: ParcelTable; bbl: string }) {
  const adjacency = useStore((s) => s.adjacency);
  const v = dealView(game, parcels, adjacency, bbl);
  const px = useDealPx(bbl, v);
  const log = useNext((s) => s.dealLog[bbl]) ?? EMPTY;
  const preset = useNext((s) => s.buyPreset);
  const [desk, setDesk] = useState(false);
  if (!v) return null;
  const rec = resolveRec(parcels, game, bbl)!;
  const last = [...log].reverse().find((l) => l.who === "them");
  const hl = dealHeadline(v, last, game.month);
  const price = v.stage === "agreed" ? v.agreed! : px;
  const ip = inPlace(rec, game, bbl, price);
  const q = buyPreview(game, parcels, bbl, price, preset);
  const odds = v.odds ? v.odds(px) : null;
  return (
    <div className="nx-deal">
      <div className={"nx-deal-banner nx-deal-" + hl.tone}>
        <span className="nx-deal-head">{hl.head}</span>
        {hl.px !== undefined && <span className="nx-deal-px mono">{usd(hl.px)}</span>}
        <span className="nx-deal-next">{hl.next}</span>
        <span className="nx-deal-who">{v.seller}</span>
      </div>
      {v.stage !== "approach" && <Ladder v={v} px={price} onPx={(n) => useNext.getState().setDealPx(bbl, n)} />}
      <div className="nx-strip nx-strip-sm">
        <div className="nx-stat"><div className="nx-stat-label">{v.stage === "agreed" ? "Price" : "Your price"}</div><div className="nx-stat-value"><Figure value={price} fmt="usd" /></div></div>
        {v.ask !== null && <div className="nx-stat"><div className="nx-stat-label">vs ask</div><div className="nx-stat-value"><Figure value={price / v.ask - 1} fmt="pct" tone={price <= v.ask ? "pos" : "neg"} /></div></div>}
        <div className="nx-stat"><div className="nx-stat-label">vs appraisal</div><div className="nx-stat-value"><Figure value={price / v.appraisal - 1} fmt="pct" tone={price <= v.appraisal ? "pos" : "neg"} /></div></div>
        {odds !== null && v.stage !== "agreed" && <div className="nx-stat"><div className="nx-stat-label">Odds</div><div className="nx-stat-value"><Figure value={odds} fmt="pct" tone={odds >= 0.6 ? "pos" : odds < 0.25 ? "neg" : undefined} /></div></div>}
        {rec.class !== "land" && <div className="nx-stat"><div className="nx-stat-label">Going-in</div><div className="nx-stat-value"><Figure value={price > 0 ? ip.noi / price : null} fmt="pct" drill="cap" args={{ bbl, price }} /></div></div>}
        <div className="nx-stat"><div className="nx-stat-label">Equity</div><div className="nx-stat-value"><Figure value={q.equity} fmt="usd" drill="cash" /></div></div>
        {q.dscr !== null && <div className="nx-stat"><div className="nx-stat-label">DSCR</div><div className="nx-stat-value"><Figure value={q.dscr} fmt="x" /></div></div>}
      </div>
      {log.length > 0 && (
        <ol className="nx-thread">
          {log.map((l, i) => (
            <li key={i} className={"nx-thread-" + l.who + (l.tone ? " nx-thread-" + l.tone : "")}>
              <span className="nx-thread-who">{l.who === "you" ? "You" : "Them"}</span>
              <span className="nx-thread-what">{l.what}</span>
              <span className="nx-thread-px mono">{l.px !== undefined ? usd(l.px) : ""}</span>
              <span className="nx-thread-m mono nx-dim">{monthLabel(l.m)}</span>
            </li>
          ))}
        </ol>
      )}
      {v.stage === "agreed" && v.deposit !== null && (
        <div className="nx-deal-note mono nx-dim">{`deposit ${usd(v.deposit)} hard · close by ${v.closeByM !== null ? monthLabel(v.closeByM - 1) : "—"}`}</div>
      )}
      <div className="nx-desk">
        <button type="button" className="nx-link" onClick={() => setDesk(!desk)}>{desk ? "Hide desk ▴" : "Desk ▾"}</button>
        {desk && <div className="nx-hosted"><ParcelPanel embedded tab="deal" /></div>}
      </div>
    </div>
  );
}

/** The file's footer while you are buying: one primary move, and the honest alternatives. */
export function NegotiationFooter({ game, parcels, bbl, onDeal }: { game: GameState; parcels: ParcelTable; bbl: string; onDeal: () => void }) {
  const adjacency = useStore((s) => s.adjacency);
  const preset = useNext((s) => s.buyPreset);
  const v = dealView(game, parcels, adjacency, bbl);
  const px = useDealPx(bbl, v);
  if (!v) return null;
  const go = (f: () => void) => () => { f(); onDeal(); };
  const steps = ["Price", "Confirm"];
  const isLand = parcels[bbl]?.class === "land";
  const finance = (price: number) => {
    const q = buyPreview(game, parcels, bbl, price, preset);
    return { q, left: <><PresetPicker isLand={isLand} /><span className="nx-dim mono">{q.label}{q.principal ? ` · ${q.ratePct.toFixed(2)}%` : ""}</span></> };
  };
  let verbs: Verb[] = [];
  let left: React.ReactNode = undefined;
  let step = 0;
  switch (v.stage) {
    case "approach":
      verbs = [{ label: "Approach", primary: true, run: go(() => dealAct(bbl, "approach")) }];
      break;
    case "refused":
      verbs = [{ label: "Approach", primary: true, disabled: v.shutUntil && v.shutUntil > game.month ? `Shut until ${monthLabel(v.shutUntil)}` : undefined, run: go(() => dealAct(bbl, "approach")) }];
      break;
    case "blind":
      verbs = [{ label: `Bid ${usd(px)}`, primary: true, run: go(() => dealAct(bbl, "bid", px)) }];
      break;
    case "named": {
      const buy = v.countered || px >= v.ask!;
      if (buy) {
        const f = finance(v.ask!);
        left = f.left; step = 1;
        verbs = [{ label: `Buy at ${usd(v.ask!)}`, primary: true, run: go(() => dealAct(bbl, "close", v.ask!, { product: f.q.product, lev: f.q.lev || 1 })) }];
      } else {
        verbs = [
          { label: `Buy at ${usd(v.ask!)}`, run: go(() => useNext.getState().setDealPx(bbl, v.ask!)) },
          { label: `Counter ${usd(px)}`, primary: true, run: go(() => dealAct(bbl, "counterOff", px)) },
        ];
      }
      break;
    }
    case "listed": {
      const pay = px >= v.ask!;
      verbs = [
        ...(pay ? [] : [{ label: "Best & final", run: go(() => dealAct(bbl, "final", px)) }]),
        { label: pay ? `Pay ask ${usd(v.ask!)}` : `Offer ${usd(px)}`, primary: true, key: "B", run: go(() => dealAct(bbl, "offer", pay ? v.ask! : px)) },
      ];
      break;
    }
    case "talks": {
      const take = px >= v.theirs!;
      verbs = [
        { label: "Walk", run: go(() => dealAct(bbl, "walk")) },
        ...(take ? [] : [{ label: `Take ${usd(v.theirs!)}`, run: go(() => dealAct(bbl, "take")) }]),
        take
          ? { label: `Take ${usd(v.theirs!)}`, primary: true, run: go(() => dealAct(bbl, "take")) }
          : { label: `Counter ${usd(px)}`, primary: true, run: go(() => dealAct(bbl, "offer", px)) },
      ];
      break;
    }
    case "final":
      verbs = [
        { label: "Walk", run: go(() => dealAct(bbl, "walk")) },
        { label: `Take ${usd(v.theirs!)}`, primary: true, run: go(() => dealAct(bbl, "take")) },
      ];
      break;
    case "agreed": {
      const f = finance(v.agreed!);
      left = f.left; step = 1;
      verbs = [
        { label: "Walk", run: go(() => dealAct(bbl, "walk")) },
        { label: "Confirm", primary: true, run: go(() => dealAct(bbl, "close", v.agreed!, { product: f.q.product, lev: f.q.lev || 1 })) },
      ];
      break;
    }
  }
  return <ActionFooter steps={steps} step={step} left={left} verbs={verbs} />;
}

export function PresetPicker({ isLand }: { isLand: boolean }) {
  const preset = useNext((s) => s.buyPreset);
  const set = useNext((s) => s.setBuyPreset);
  const desks = buyDesks(isLand);
  return (
    <span className="nx-preset">
      <select className="nx-select" value={preset.product} onChange={(e) => set({ ...preset, product: e.target.value })} aria-label="Lender">
        <option value="cheapest">Cheapest</option>
        <option value="cash">All cash</option>
        {desks.map((d) => <option key={d.id} value={d.id}>{d.lender}</option>)}
      </select>
      <select className="nx-select" value={String(preset.lev)} onChange={(e) => set({ ...preset, lev: Number(e.target.value) })} aria-label="Leverage">
        {[1, 0.85, 0.7, 0.5].map((l) => <option key={l} value={l}>{fmtFig(l, "pct")} of max</option>)}
      </select>
    </span>
  );
}
