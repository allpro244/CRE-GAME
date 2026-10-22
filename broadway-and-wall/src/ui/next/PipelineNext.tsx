/**
 * THE PIPELINE (PLAN §3.1, §5 step 6): every deal in motion, by lane and
 * stage. Buying (doors knocked, brokers' calls, talks, contracts), Building
 * (raises, jobs in the ground, lease-up), Selling (listed, bids, offers) and,
 * in the region, Land (farm › board › entitled › streets › lots).
 *
 * Board: each lane as stage columns of compact cards. Each lane's tab: the
 * same rows as a dense table. Rows open the building file, where the verbs
 * are. Every figure is read off the engine's own records.
 */
import { useMemo, type ReactNode } from "react";
import { useStore } from "@/state/store";
import type { GameState } from "@/engine/types";
import type { ParcelTable } from "@/data/types";
import { monthLabel } from "@/engine/types";
import { initialCondition, marketAppraisal, ownedHoldingValue, resolveRec } from "@/engine/value";
import { occupancyRead } from "@/engine/leasing";
import { committedTotal } from "@/engine/investors";
import { APPROACH_LIFE_M } from "@/engine/sim";
import { MAX_TALKS } from "@/engine/acquire";
import { derive } from "@/ui/derive";
import { usd } from "@/ui/format";
import { DataTable, Stat, StatStrip, type Col } from "./DataTable";
import { Figure, fmtFig } from "./Figure";
import { landRows, type LandRow, type LandStage } from "./HoldingsNext";

// ---------------------------------------------------------------- rows
export type BuyStage = "knocked" | "inbound" | "talking" | "agreed";
export interface BuyRow {
  bbl: string; addr: string; stage: BuyStage; theirs: number | null; yours: number | null;
  value: number | null; clockM: number | null; deposit: number | null; who: string; round: string;
}
export type BuildStage = "raising" | "equity" | "draws" | "stalled" | "leaseup";
export interface BuildRow {
  key: string; bbl: string; addr: string; stage: BuildStage; use: string; sf: number | null; floors: number | null;
  budget: number | null; spentPct: number | null; drawn: number | null; commitment: number | null;
  doneM: number | null; preleased: number | null; occ: number | null; events: number | null;
  target: number | null; committed: number | null;
}
export type SellStage = "listed" | "bids" | "offer" | "contract" | "book";
export interface SellRow {
  key: string; bbl: string | null; addr: string; stage: SellStage; ask: number | null; best: number | null;
  offer: number | null; value: number | null; nBids: number; listedM: number | null; clockM: number | null;
}

const addrOf = (p: ParcelTable, g: GameState, bbl: string) => resolveRec(p, g, bbl)?.address || p[bbl]?.address || bbl;

export function buyRows(g: GameState, p: ParcelTable): BuyRow[] {
  return derive(g, "next.pipe.buy", () => {
    const out: BuyRow[] = [];
    const value = (bbl: string) => {
      const rec = resolveRec(p, g, bbl);
      return rec ? marketAppraisal(g, rec, bbl, initialCondition(rec)) : null;
    };
    for (const t of Object.values(g.talks ?? {})) {
      out.push({
        bbl: t.bbl, addr: addrOf(p, g, t.bbl), stage: t.agreed ? "agreed" : "talking",
        theirs: t.agreed ? t.agreedPrice ?? t.theirPrice : t.theirPrice, yours: t.agreed ? null : t.yourPrice,
        value: value(t.bbl), clockM: t.agreed ? (t.closeByM ?? null) : null, deposit: t.deposit ?? null,
        who: t.sellerName, round: t.agreed ? "" : t.final ? "final" : `${t.round}/${t.maxRounds}`,
      });
    }
    for (const [bbl, a] of Object.entries(g.approaches)) {
      if (a.refused || g.holdings[bbl] || g.talks?.[bbl]) continue;
      if (a.inbound ? !a.ask : !(a.ask || a.reserve)) continue;
      out.push({
        bbl, addr: addrOf(p, g, bbl), stage: a.inbound ? "inbound" : "knocked",
        theirs: a.ask ?? null, yours: null, value: value(bbl), clockM: a.q + APPROACH_LIFE_M, deposit: null,
        who: a.inbound ? "broker" : "", round: a.ask === undefined ? "blind" : "",
      });
    }
    return out;
  }, [p]);
}

export function buildRows(g: GameState, p: ParcelTable): BuildRow[] {
  return derive(g, "next.pipe.build", () => {
    const out: BuildRow[] = [];
    const blank = { sf: null, floors: null, budget: null, spentPct: null, drawn: null, commitment: null, doneM: null, preleased: null, occ: null, events: null, target: null, committed: null };
    for (const r of Object.values(g.raises ?? {})) {
      out.push({ ...blank, key: "raise:" + r.bbl, bbl: r.bbl, addr: addrOf(p, g, r.bbl), stage: "raising", use: r.job.use, floors: r.job.floors, doneM: r.deadlineM, target: r.target, committed: committedTotal(r) });
    }
    for (const d of Object.values(g.developments)) {
      const spent = d.equitySpent + d.drawn;
      const signed = (d.signed ?? []).reduce((a, x) => a + x.sf, 0);
      out.push({
        ...blank, key: "job:" + d.bbl, bbl: d.bbl, addr: addrOf(p, g, d.bbl),
        stage: d.repudiatedM !== undefined ? "stalled" : d.equitySpent < d.equityBudget ? "equity" : "draws",
        use: d.use, sf: d.sf, floors: d.floors, budget: d.costTotal,
        spentPct: d.costTotal > 0 ? Math.min(1, spent / d.costTotal) : null,
        drawn: d.drawn, commitment: d.commitment, doneM: d.deliverM,
        preleased: d.sf > 0 ? signed / d.sf : null, events: d.events,
      });
    }
    // delivered and not yet stabilised (90% let, the industry's line)
    for (const h of Object.values(g.holdings)) {
      if (h.deliveredM === undefined || g.developments[h.bbl]) continue;
      const rec = resolveRec(p, g, h.bbl);
      if (!rec || !rec.bldgArea) continue;
      const occ = occupancyRead(rec, h).lettableOcc;
      if (occ >= 0.9) continue;
      out.push({ ...blank, key: "lease:" + h.bbl, bbl: h.bbl, addr: rec.address || h.bbl, stage: "leaseup", use: rec.class, sf: rec.bldgArea, floors: rec.floors ?? null, doneM: h.deliveredM, occ });
    }
    return out;
  }, [p]);
}

export function sellRows(g: GameState, p: ParcelTable): SellRow[] {
  return derive(g, "next.pipe.sell", () => {
    const out: SellRow[] = [];
    for (const h of Object.values(g.holdings)) {
      const s = h.sale;
      if (!s) continue;
      const bids = (s.bids ?? []).filter((b) => !b.dropped);
      const best = bids.length ? Math.max(...bids.map((b) => b.price)) : null;
      out.push({
        key: h.bbl, bbl: h.bbl, addr: addrOf(p, g, h.bbl),
        stage: s.offer?.contract ? "contract" : s.offer ? "offer" : bids.length ? "bids" : "listed",
        ask: s.ask, best, offer: s.offer?.price ?? null, value: ownedHoldingValue(g, p, h), nBids: bids.length,
        listedM: s.listedM, clockM: s.offer?.expiresM ?? s.callM ?? null,
      });
    }
    const ps = g.portfolioSale;
    if (ps) {
      const best = ps.bids.length ? Math.max(...ps.bids.map((b) => b.price)) : null;
      out.push({
        key: "book", bbl: null, addr: `Book · ${ps.bbls.length} deeds`, stage: "book",
        ask: ps.ask, best, offer: null, value: ps.sumOfParts, nBids: ps.bids.length, listedM: ps.listedM, clockM: null,
      });
    }
    return out;
  }, [p]);
}

// ---------------------------------------------------------------- shared bits
const open = (bbl: string | null, tab: "summary" | "money" | "build" | "deal" = "summary") => {
  if (!bbl) { useStore.getState().setPage("portfolio"); return; }
  if (tab === "summary") useStore.getState().select(bbl);
  else useStore.getState().openProperty(bbl, tab);
};
const mo = (m: number | null) => <span className="mono">{m !== null ? monthLabel(m) : "—"}</span>;
const left = (g: GameState, m: number | null) => (m !== null ? m - g.month : null);
const sum = (xs: (number | null)[]) => xs.reduce<number>((a, x) => a + (x ?? 0), 0);

const BUY: { id: BuyStage; label: string }[] = [
  { id: "knocked", label: "Knocked" }, { id: "inbound", label: "Brokers" }, { id: "talking", label: "Talking" }, { id: "agreed", label: "Contract" },
];
const BUILD: { id: BuildStage; label: string }[] = [
  { id: "raising", label: "Raising" }, { id: "equity", label: "Equity" }, { id: "draws", label: "Draws" }, { id: "stalled", label: "Stalled" }, { id: "leaseup", label: "Lease-up" },
];
const SELL: { id: SellStage; label: string }[] = [
  { id: "listed", label: "Listed" }, { id: "bids", label: "Bids" }, { id: "offer", label: "Offer" }, { id: "contract", label: "Contract" }, { id: "book", label: "Book" },
];
const LAND: { id: LandStage; label: string }[] = [
  { id: "farm", label: "Farm" }, { id: "board", label: "Board" }, { id: "entitled", label: "Entitled" }, { id: "streets", label: "Streets" }, { id: "lots", label: "Lots" },
];
const label = <T extends string>(set: { id: T; label: string }[], id: T) => set.find((s) => s.id === id)?.label ?? id;
const stageCell = <T extends string>(set: { id: T; label: string }[], id: T) => <span className={"nx-stage nx-stage-" + id}>{label(set, id)}</span>;

function usePipe() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  return useMemo(() => ({
    game, parcels,
    buy: buyRows(game, parcels), build: buildRows(game, parcels), sell: sellRows(game, parcels), land: landRows(game, parcels),
  }), [game, parcels]);
}

// ---------------------------------------------------------------- board
interface Card { key: string; title: string; a: ReactNode; b?: ReactNode; tone?: "neg" | "pos"; go: () => void }

function Lane<T extends string>({ name, stages, cards, foot }: { name: string; stages: { id: T; label: string }[]; cards: Record<string, Card[]>; foot?: (id: T) => ReactNode }) {
  return (
    <div className="nx-lane">
      <div className="nx-lane-name">{name}</div>
      <div className="nx-lane-cols" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}>
        {stages.map((s) => {
          const cs = cards[s.id] ?? [];
          return (
            <div key={s.id} className={"nx-col" + (cs.length ? "" : " nx-col-empty")}>
              <div className="nx-col-head"><span>{s.label}</span><span className="mono">{cs.length || ""}</span></div>
              {foot && cs.length > 0 && <div className="nx-col-sum mono">{foot(s.id)}</div>}
              {cs.slice(0, 6).map((c) => (
                <button key={c.key} type="button" className="nx-card" onClick={c.go}>
                  <span className="nx-card-t">{c.title}</span>
                  <span className={"nx-card-a mono" + (c.tone ? " nx-" + c.tone : "")}>{c.a}</span>
                  {c.b !== undefined && <span className="nx-card-b mono">{c.b}</span>}
                </button>
              ))}
              {cs.length > 6 && <div className="nx-col-more mono">+{cs.length - 6}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function group<R, T extends string>(rows: R[], stage: (r: R) => T, card: (r: R) => Card): Record<string, Card[]> {
  const out: Record<string, Card[]> = {};
  for (const r of rows) (out[stage(r)] ??= []).push(card(r));
  return out;
}

export function PipelineBoard() {
  const { game, buy, build, sell, land } = usePipe();
  const live = Object.keys(game.talks ?? {}).length;
  const agreed = buy.filter((r) => r.stage === "agreed");
  const jobs = build.filter((r) => r.stage !== "raising" && r.stage !== "leaseup");
  const hasLand = land.length > 0;
  return (
    <div className="nx-place">
      <StatStrip>
        <Stat label="Talks"><Figure value={live} fmt="n" text={`${live}/${MAX_TALKS}`} /></Stat>
        <Stat label="Contracts"><Figure value={sum(agreed.map((r) => r.theirs))} fmt="usd" /></Stat>
        <Stat label="Deposits"><Figure value={sum(agreed.map((r) => r.deposit))} fmt="usd" /></Stat>
        <Stat label="Jobs"><Figure value={jobs.length} fmt="n" /></Stat>
        <Stat label="Budget"><Figure value={sum(jobs.map((r) => r.budget))} fmt="usd" /></Stat>
        <Stat label="Undrawn"><Figure value={sum(jobs.map((r) => (r.commitment ?? 0) - (r.drawn ?? 0)))} fmt="usd" /></Stat>
        <Stat label="Listed"><Figure value={sum(sell.map((r) => r.ask))} fmt="usd" /></Stat>
        <Stat label="Cash"><Figure value={game.cash} fmt="usd" drill="cash" tone={game.cash < 0 ? "neg" : undefined} /></Stat>
      </StatStrip>
      <Lane name="Buying" stages={BUY}
        cards={group(buy, (r) => r.stage, (r) => ({
          key: r.bbl, title: r.addr, a: r.theirs === null ? "blind" : fmtFig(r.theirs, "usd"),
          b: r.stage === "agreed" ? `fund ${monthLabel((r.clockM ?? game.month + 1) - 1)}` : r.yours !== null ? `you ${usd(r.yours)} · ${r.round}` : r.clockM !== null ? `lapses ${monthLabel(r.clockM)}` : undefined,
          tone: r.stage === "agreed" && (left(game, r.clockM) ?? 9) <= 1 ? "neg" : undefined,
          go: () => open(r.bbl),
        }))}
        foot={(id) => usd(sum(buy.filter((r) => r.stage === id).map((r) => r.theirs)))} />
      <Lane name="Building" stages={BUILD}
        cards={group(build, (r) => r.stage, (r) => ({
          key: r.key, title: r.addr,
          a: r.stage === "raising" ? `${fmtFig(r.committed, "usd")} / ${fmtFig(r.target, "usd")}` : r.stage === "leaseup" ? `${fmtFig(r.occ, "pct")} let` : `${fmtFig(r.spentPct, "pct")} · ${fmtFig(r.budget, "usd")}`,
          b: r.stage === "leaseup" ? `${r.use}` : `${r.stage === "raising" ? "closes" : "opens"} ${r.doneM !== null ? monthLabel(r.doneM) : "—"}`,
          tone: r.stage === "stalled" ? "neg" : undefined,
          go: () => open(r.bbl, r.stage === "raising" || r.stage === "leaseup" ? "summary" : "build"),
        }))}
        foot={(id) => usd(sum(build.filter((r) => r.stage === id).map((r) => r.budget ?? r.target)))} />
      <Lane name="Selling" stages={SELL}
        cards={group(sell, (r) => r.stage, (r) => ({
          key: r.key, title: r.addr, a: fmtFig(r.offer ?? r.best ?? r.ask, "usd"),
          b: r.ask !== null && (r.offer ?? r.best) !== null ? `ask ${usd(r.ask)}` : r.nBids ? `${r.nBids} bids` : r.listedM !== null ? `since ${monthLabel(r.listedM)}` : undefined,
          go: () => open(r.bbl, "deal"),
        }))}
        foot={(id) => usd(sum(sell.filter((r) => r.stage === id).map((r) => r.offer ?? r.best ?? r.ask)))} />
      {hasLand && (
        <Lane name="Land" stages={LAND}
          cards={group(land, (r) => r.stage, (r: LandRow) => ({
            key: r.key, title: r.addr.replace(/ \(\d+ ac\)$/, ""),
            a: r.stage === "lots" ? `${r.owned ?? 0} held · ${r.sold ?? 0} sold` : `${r.acres.toFixed(1)} ac${r.lots ? ` · ${r.lots} lots` : ""}`,
            b: r.stage === "board" ? `${monthLabel(r.when!)} · ${fmtFig(r.odds, "pct")}` : r.when !== null ? monthLabel(r.when) : undefined,
            tone: r.offer ? "pos" : undefined,
            go: () => open(r.bbl),
          }))} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- lane tables
export function PipelineBuying() {
  const { game, buy } = usePipe();
  const cols: Col<BuyRow>[] = [
    { id: "addr", label: "Address", get: (r) => r.addr, cell: (r) => <span className="nx-strong-cell">{r.addr}</span> },
    { id: "stage", label: "Stage", get: (r) => BUY.findIndex((s) => s.id === r.stage), cell: (r) => stageCell(BUY, r.stage) },
    { id: "who", label: "Seller", get: (r) => r.who },
    { id: "theirs", label: "Their price", get: (r) => r.theirs, fmt: "usd" },
    { id: "yours", label: "Yours", get: (r) => r.yours, fmt: "usd" },
    { id: "gap", label: "Gap", get: (r) => (r.theirs !== null && r.yours !== null ? r.theirs - r.yours : null), fmt: "usd" },
    { id: "value", label: "Value", get: (r) => r.value, fmt: "usd" },
    { id: "vs", label: "vs value", get: (r) => (r.theirs && r.value ? r.value / r.theirs - 1 : null), fmt: "pct", tone: (r) => (r.theirs && r.value ? (r.value >= r.theirs ? "pos" : "neg") : undefined) },
    { id: "round", label: "Round", get: (r) => r.round },
    { id: "dep", label: "Deposit", get: (r) => r.deposit, fmt: "usd" },
    { id: "clock", label: "Clock", get: (r) => r.clockM, cell: (r) => mo(r.clockM) },
    { id: "left", label: "Months", get: (r) => left(game, r.clockM), fmt: "n", tone: (r) => ((left(game, r.clockM) ?? 9) <= 1 ? "neg" : undefined) },
  ];
  return (
    <div className="nx-place">
      <StageStrip set={BUY} rows={buy} stage={(r) => r.stage} amt={(r) => r.theirs} />
      <DataTable id="pipe-buy" cols={cols} rows={buy} rowKey={(r) => r.bbl} initialSort={{ col: "stage", dir: -1 }} empty="No deals"
        onRow={(r) => open(r.bbl)}
        actions={(r) => r.stage === "inbound"
          ? <button type="button" className="nx-btn nx-sm" onClick={() => useStore.getState().hangUpCall(r.bbl)}>Pass</button>
          : <button type="button" className={"nx-btn nx-sm" + (r.stage === "agreed" ? " nx-primary" : "")} onClick={() => open(r.bbl)}>{r.stage === "agreed" ? "Fund" : "Open"}</button>} />
    </div>
  );
}

export function PipelineBuilding() {
  const { game, build } = usePipe();
  const cols: Col<BuildRow>[] = [
    { id: "addr", label: "Address", get: (r) => r.addr, cell: (r) => <span className="nx-strong-cell">{r.addr}</span> },
    { id: "stage", label: "Stage", get: (r) => BUILD.findIndex((s) => s.id === r.stage), cell: (r) => stageCell(BUILD, r.stage) },
    { id: "use", label: "Use", get: (r) => r.use },
    { id: "sf", label: "sf", get: (r) => r.sf, fmt: "n" },
    { id: "floors", label: "Fl", get: (r) => r.floors, fmt: "n" },
    { id: "budget", label: "Budget", get: (r) => r.budget ?? r.target, fmt: "usd" },
    { id: "spent", label: "Spent", get: (r) => r.spentPct ?? (r.target ? (r.committed ?? 0) / r.target : null), fmt: "pct" },
    { id: "drawn", label: "Drawn", get: (r) => r.drawn ?? r.committed, fmt: "usd" },
    { id: "commit", label: "Loan", get: (r) => r.commitment, fmt: "usd" },
    { id: "pre", label: "Pre-let", get: (r) => r.preleased ?? r.occ, fmt: "pct" },
    { id: "done", label: "Opens", get: (r) => r.doneM, cell: (r) => mo(r.doneM) },
    { id: "left", label: "Months", get: (r) => left(game, r.doneM), fmt: "n" },
    { id: "events", label: "Events", get: (r) => r.events, fmt: "n", tone: (r) => ((r.events ?? 0) > 0 ? "neg" : undefined), hidden: true },
  ];
  return (
    <div className="nx-place">
      <StageStrip set={BUILD} rows={build} stage={(r) => r.stage} amt={(r) => r.budget ?? r.target} />
      <DataTable id="pipe-build" cols={cols} rows={build} rowKey={(r) => r.key} initialSort={{ col: "done", dir: 1 }} empty="No jobs"
        onRow={(r) => open(r.bbl, r.stage === "raising" || r.stage === "leaseup" ? "summary" : "build")}
        actions={(r) => r.stage === "raising"
          ? <span className="nx-row-verbs">
              <button type="button" className="nx-btn nx-sm" disabled={(r.committed ?? 0) < (r.target ?? 0) / 2} title={(r.committed ?? 0) < (r.target ?? 0) / 2 ? "Needs half the target" : undefined} onClick={() => useStore.getState().closeRaiseNow(r.bbl)}>Close</button>
              <button type="button" className="nx-btn nx-sm" onClick={() => useStore.getState().cancelRaise(r.bbl)}>Cancel</button>
            </span>
          : null} />
    </div>
  );
}

export function PipelineSelling() {
  const { sell } = usePipe();
  const cols: Col<SellRow>[] = [
    { id: "addr", label: "Address", get: (r) => r.addr, cell: (r) => <span className="nx-strong-cell">{r.addr}</span> },
    { id: "stage", label: "Stage", get: (r) => SELL.findIndex((s) => s.id === r.stage), cell: (r) => stageCell(SELL, r.stage) },
    { id: "ask", label: "Ask", get: (r) => r.ask, fmt: "usd" },
    { id: "best", label: "Best bid", get: (r) => r.best, fmt: "usd" },
    { id: "bids", label: "Bids", get: (r) => r.nBids, fmt: "n" },
    { id: "offer", label: "Offer", get: (r) => r.offer, fmt: "usd" },
    { id: "value", label: "Value", get: (r) => r.value, fmt: "usd" },
    { id: "vs", label: "vs value", get: (r) => { const px = r.offer ?? r.best ?? r.ask; return px && r.value ? px / r.value - 1 : null; }, fmt: "pct", tone: (r) => { const px = r.offer ?? r.best ?? r.ask; return px && r.value ? (px >= r.value ? "pos" : "neg") : undefined; } },
    { id: "listed", label: "Listed", get: (r) => r.listedM, cell: (r) => mo(r.listedM) },
    { id: "clock", label: "Due", get: (r) => r.clockM, cell: (r) => mo(r.clockM) },
  ];
  return (
    <div className="nx-place">
      <StageStrip set={SELL} rows={sell} stage={(r) => r.stage} amt={(r) => r.offer ?? r.best ?? r.ask} />
      <DataTable id="pipe-sell" cols={cols} rows={sell} rowKey={(r) => r.key} initialSort={{ col: "stage", dir: -1 }} empty="Nothing listed"
        onRow={(r) => open(r.bbl, "deal")}
        actions={(r) => {
          if (!r.bbl) return null;
          const st = useStore.getState();
          if (r.stage === "offer") return (
            <span className="nx-row-verbs">
              <button type="button" className="nx-btn nx-sm" onClick={() => open(r.bbl, "deal")}>Open</button>
              <button type="button" className="nx-btn nx-sm" onClick={() => st.declineOffer(r.bbl!)}>Decline</button>
            </span>
          );
          if (r.stage === "bids") return <button type="button" className="nx-btn nx-sm nx-primary" title={usd(r.best ?? 0)} onClick={() => st.takeBid(r.bbl!, 0)}>Take best</button>;
          return <button type="button" className="nx-btn nx-sm" onClick={() => st.delistSale(r.bbl!)}>Delist</button>;
        }} />
    </div>
  );
}

/** Count and dollars per stage, one strip above a lane's table. */
function StageStrip<R, T extends string>({ set, rows, stage, amt }: { set: { id: T; label: string }[]; rows: R[]; stage: (r: R) => T; amt: (r: R) => number | null }) {
  return (
    <StatStrip>
      {set.map((s) => {
        const in_ = rows.filter((r) => stage(r) === s.id);
        return (
          <Stat key={s.id} label={s.label}>
            <span className="mono">{in_.length}</span>
            {in_.length > 0 && <span className="nx-dim mono nx-stat-sub"> {usd(sum(in_.map(amt)))}</span>}
          </Stat>
        );
      })}
    </StatStrip>
  );
}
