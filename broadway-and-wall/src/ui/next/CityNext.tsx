/**
 * CITY › MARKETS, NEWS, PLAYERS, RANKINGS, RECORD, AS TABLES (PLAN §5 step 5).
 *
 * Markets folds the classic Economy and Pulse pages into one: the four classes
 * read off the same `availability` / `marketBalance` / `realRentYoy` /
 * `monthsOfSupply` / `deliverySchedule` the cards read, the city series off
 * `econ.history`, the neighbourhoods off `submarkets`. News is the wire with
 * repeats folded (the Headlines fold) and the paper's stories (`writePaper`).
 * Players is the street table (`markRival` / `rivalEquity`, the same cached
 * marks StreetDesk keeps) and the register (`allOwners`). Rankings is
 * `cityRankings`. Record is `firmCapital` and the firm's dated record, read
 * from the same state FirmTimeline reads.
 */
import { useMemo, useState } from "react";
import { useStore } from "@/state/store";
import { FirmPage } from "@/ui/panels/CompetitorCards";
import type { BuiltClass, EconHistoryPoint, GameState, NewsItem } from "@/engine/types";
import { monthLabel, START_YEAR } from "@/engine/types";
import type { ParcelTable } from "@/data/types";
import { cityValueToReplacement } from "@/engine/dev";
import { standardsWord, underwritingStandards } from "@/engine/debt";
import { CITY_STOCK, normalVac, SECTOR_LABEL, shortIndexOf } from "@/engine/market";
import { availability, deliverySchedule, legDemand, legRent, legVacancy, marketBalance, monthsOfSupply, submarkets } from "@/engine/space";
import { resolveRec, portfolioMark } from "@/engine/value";
import { markRival, marketAppetite, rivalCondition } from "@/engine/rivals";
import { rivalEquity } from "@/engine/standing";
import { distressTally } from "@/engine/history";
import { movesOf, streetMoves } from "@/engine/firmLog";
import { allOwners } from "@/engine/ownership";
import { holdersLikelyToSell } from "@/engine/owners";
import { labelOf } from "@/engine/storyline";
import { firmName, firmShort } from "@/engine/firm";
import { cityRankings, type RankRow } from "@/engine/peers";
import { firmCapital, firmMilestonesHit, nextFirmMilestone } from "@/engine/firmCapital";
import { MILESTONES } from "@/engine/sim";
import { storyRank, writePaper, type Story } from "@/engine/stories";
import { derive, nwOf, standingOf } from "@/ui/derive";
import { realRentYoy } from "@/ui/panels/EconomyPage";
import { boardClimate, pendingHearings, tradeRows } from "@/ui/panels/CityStances";
import { real, STYLE_WORD } from "@/ui/panels/shared";
import { CityHallBox } from "@/ui/panels/CityHall";
import { Chips, DataTable, Stat, StatStrip, type Col } from "./DataTable";
import { Figure, Spark, fmtFig, type FigFmt } from "./Figure";
import { BarChart, Gauge, LineChart } from "@/ui/Chart";

const CLASSES: BuiltClass[] = ["office", "retail", "multifamily", "industrial"];
const SPAN_M = 240;
const sel = (bbl?: string) => { if (bbl) useStore.getState().select(bbl); };
const mo = (m: number | null | undefined) => <span className="mono">{m === null || m === undefined ? "—" : monthLabel(m)}</span>;
const sparkCell = (pts: number[]) => <Spark pts={pts} />;
const head = (t: string) => <div className="nx-box-head nx-sec">{t}</div>;

// ==================================================================== MARKETS

interface ClassRow {
  k: BuiltClass; label: string; avail: number; nat: number; direct: number; state: string; gap: number;
  rent: number; eff: number; realYoy: number; cap: number; stock: number; occ: number; pipe: number; pipePct: number;
  sched: number[]; abs12: number; comp12: number; dmd: number; mos: number | null; conc: number; phase: string;
  vacYr: number | null; availS: number[]; rentS: number[]; capS: number[];
}

function classRows(g: GameState): ClassRow[] {
  return derive(g, "next.city.classes", () => {
    const e = g.econ;
    const hist = e.history ?? [];
    const tail = hist.slice(-SPAN_M);
    const sched = deliverySchedule(e, g.month, 4);
    return CLASSES.map((k) => {
      const avail = availability(e, k);
      const bal = marketBalance(e, k);
      const stock = e.stock?.[k] ?? CITY_STOCK[k];
      const direct = e.cityVac?.[k] ?? normalVac(e, k);
      const pipe = e.pipeline?.[k] ?? 0;
      const abs12 = e.absorb12?.[k] ?? 0;
      const then = hist.length > 12 ? (hist[hist.length - 13]?.avail?.[k] ?? hist[hist.length - 13]?.vac?.[k]) : undefined;
      return {
        k, label: SECTOR_LABEL[k], avail, nat: normalVac(e, k), direct, state: bal.state, gap: bal.gap,
        rent: e.rentIdx[k], eff: e.effRentIdx?.[k] ?? e.rentIdx[k], realYoy: realRentYoy(e, k), cap: e.capRate[k],
        stock, occ: e.occupied?.[k] ?? stock * (1 - direct), pipe, pipePct: stock > 0 ? pipe / stock : 0,
        sched: sched[k], abs12, comp12: e.completions12?.[k] ?? 0, dmd: stock > 0 ? abs12 / stock : 0,
        mos: monthsOfSupply(e, k), conc: (e.concIdx?.[k] ?? 0) * 0.14, phase: e.sectorPhase?.[k] ?? "steady",
        vacYr: then === undefined ? null : (avail - then) * 1e4,
        availS: tail.map((h) => (h.avail?.[k] ?? h.vac?.[k] ?? NaN)),
        rentS: tail.map((h) => h.rent?.[k] ?? NaN),
        capS: tail.map((h) => h.cap?.[k] ?? NaN),
      };
    });
  });
}

const classCols: Col<ClassRow>[] = [
  { id: "label", label: "Market", get: (r) => r.label, cell: (r) => <span className="nx-strong-cell">{r.label}</span> },
  { id: "avail", label: "Avail", get: (r) => r.avail, fmt: "pct", tone: (r) => (r.gap > 0.018 ? "neg" : undefined) },
  { id: "availS", label: "Avail 20y", get: (r) => r.avail, num: false, cell: (r) => sparkCell(r.availS) },
  { id: "nat", label: "Natural", get: (r) => r.nat, fmt: "pct", hidden: true },
  { id: "direct", label: "Direct", get: (r) => r.direct, fmt: "pct", hidden: true },
  { id: "vacYr", label: "Δ 12m", get: (r) => r.vacYr, fmt: "bp", tone: (r) => ((r.vacYr ?? 0) >= 200 ? "neg" : undefined) },
  { id: "state", label: "Balance", get: (r) => r.state, tone: (r) => (r.gap > 0.018 ? "neg" : undefined) },
  { id: "rent", label: "Rent", get: (r) => r.rent, fmt: "psf" },
  { id: "rentS", label: "Rent 20y", get: (r) => r.rent, num: false, cell: (r) => sparkCell(r.rentS) },
  { id: "eff", label: "Effective", get: (r) => r.eff, fmt: "psf", hidden: true },
  { id: "realYoy", label: "Real 12m", get: (r) => r.realYoy, fmt: "pct", tone: (r) => (r.realYoy < -0.025 ? "neg" : r.realYoy > 0.025 ? "pos" : undefined) },
  { id: "conc", label: "Concession", get: (r) => r.conc, fmt: "pct", tone: (r) => (r.conc > 0.098 ? "neg" : undefined), hidden: true },
  { id: "cap", label: "Cap", get: (r) => r.cap, fmt: "pctv" },
  { id: "capS", label: "Cap 20y", get: (r) => r.cap, num: false, cell: (r) => sparkCell(r.capS) },
  { id: "stock", label: "Stock", get: (r) => r.stock, fmt: "sf", hidden: true },
  { id: "occ", label: "Occupied", get: (r) => r.occ, fmt: "sf", hidden: true },
  { id: "abs12", label: "Absorbed 12m", get: (r) => r.abs12, fmt: "sf", tone: (r) => (r.abs12 < 0 ? "neg" : undefined), hidden: true },
  { id: "dmd", label: "Demand 12m", get: (r) => r.dmd, fmt: "pct", tone: (r) => (r.dmd < -0.002 ? "neg" : undefined), hidden: true },
  { id: "comp12", label: "Built 12m", get: (r) => r.comp12, fmt: "sf", hidden: true },
  { id: "pipe", label: "Pipeline", get: (r) => r.pipe, fmt: "sf", hidden: true },
  { id: "pipePct", label: "Pipe %", get: (r) => r.pipePct, fmt: "pct", tone: (r) => (r.pipePct > 0.05 ? "neg" : undefined) },
  { id: "y1", label: "Next 12m", get: (r) => r.sched[0] ?? 0, fmt: "sf" },
  { id: "y2", label: "Year 2", get: (r) => r.sched[1] ?? 0, fmt: "sf", hidden: true },
  { id: "y3", label: "Year 3", get: (r) => r.sched[2] ?? 0, fmt: "sf", hidden: true },
  { id: "y4", label: "Year 4", get: (r) => r.sched[3] ?? 0, fmt: "sf", hidden: true },
  { id: "mos", label: "Supply mo", get: (r) => r.mos, fmt: "n", tone: (r) => (r.mos === null || r.mos > 60 ? "neg" : undefined), hidden: true },
  { id: "phase", label: "Tenants", get: (r) => r.phase, tone: (r) => (r.phase === "bust" ? "neg" : r.phase === "boom" ? "pos" : undefined), hidden: true },
];

interface SeriesRow { id: string; label: string; fmt: FigFmt; now: number | null; ago: number | null; d: number | null; dFmt: FigFmt; pts: number[] }

function seriesRows(g: GameState): SeriesRow[] {
  return derive(g, "next.city.series", () => {
    const e = g.econ;
    const hist = e.history ?? [];
    const tail = hist.slice(-SPAN_M);
    const w0 = e.wage0 ?? 1;
    const ago = hist.length > 12 ? hist[hist.length - 13] : undefined;
    const fin = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? null : v);
    const defs: { id: string; label: string; fmt: FigFmt; get: (h: EconHistoryPoint) => number | undefined; now: number | undefined; d: "bp" | "pp" | "chg" }[] = [
      { id: "r10", label: "10Y", fmt: "pctv", get: (h) => h.indexRate, now: e.indexRate, d: "bp" },
      { id: "regime", label: "Long-run rate", fmt: "pctv", get: (h) => h.rateRegime, now: e.rateRegime, d: "bp" },
      { id: "policy", label: "Policy rate", fmt: "pctv", get: (h) => h.policy, now: e.nat?.policy, d: "bp" },
      { id: "credit", label: "Credit window", fmt: "pct", get: (h) => h.creditIdx, now: e.creditIdx, d: "pp" },
      { id: "employ", label: "Employment", fmt: "n", get: (h) => (h.employIdx === undefined ? undefined : h.employIdx * 100), now: e.employIdx * 100, d: "chg" },
      { id: "pop", label: "Population", fmt: "n", get: (h) => h.population, now: e.population, d: "chg" },
      { id: "jobs", label: "Jobs", fmt: "n", get: (h) => h.jobs, now: e.jobs, d: "chg" },
      { id: "unemp", label: "Unemployment", fmt: "pct", get: (h) => h.unemployment, now: e.unemployment, d: "pp" },
      { id: "rwage", label: "Real wage", fmt: "x", get: (h) => real((h.wageIdx ?? w0) / w0, h.cpi), now: real((e.wageIdx ?? w0) / w0, e.cpi), d: "chg" },
      { id: "nwage", label: "Nominal wage", fmt: "x", get: (h) => (h.wageIdx ?? w0) / w0, now: (e.wageIdx ?? w0) / w0, d: "chg" },
      { id: "rout", label: "Real output", fmt: "x", get: (h) => real((h.outputIdx ?? w0) / w0, h.cpi), now: real((e.outputIdx ?? w0) / w0, e.cpi), d: "chg" },
      { id: "cpi", label: "Price level", fmt: "x", get: (h) => h.cpi, now: e.cpi, d: "chg" },
      { id: "cost", label: "Build costs", fmt: "n", get: (h) => (h.costIdx === undefined ? undefined : h.costIdx * 100), now: e.costIdx * 100, d: "chg" },
      { id: "land", label: "Land index", fmt: "n", get: (h) => h.landIdx * 100, now: e.landIdx * 100, d: "chg" },
    ];
    return defs.map((x) => {
      const now = fin(x.now);
      const then = ago ? fin(x.get(ago)) : null;
      const d = now === null || then === null ? null
        : x.d === "bp" ? (now - then) * 100
        : x.d === "pp" ? (now - then) * 1e4
        : then !== 0 ? now / then - 1 : null;
      return {
        id: x.id, label: x.label, fmt: x.fmt, now, ago: then, d, dFmt: x.d === "chg" ? "pct" : "bp",
        pts: tail.map((h) => x.get(h) ?? NaN),
      };
    });
  });
}

const seriesCols: Col<SeriesRow>[] = [
  { id: "label", label: "Series", get: (r) => r.label, cell: (r) => <span className="nx-strong-cell">{r.label}</span> },
  { id: "now", label: "Now", get: (r) => r.now, num: true, cell: (r) => fmtFig(r.now, r.fmt) },
  { id: "ago", label: "12m ago", get: (r) => r.ago, num: true, cell: (r) => fmtFig(r.ago, r.fmt) },
  { id: "d", label: "Δ 12m", get: (r) => r.d, num: true, cell: (r) => fmtFig(r.d, r.dFmt), tone: (r) => ((r.d ?? 0) < 0 ? "neg" : (r.d ?? 0) > 0 ? "pos" : undefined) },
  { id: "pts", label: "20y", get: (r) => r.now, cell: (r) => sparkCell(r.pts) },
];

interface SubRow { key: string; district: string; name: string; k: BuiltClass; use: string; sf: number; vac: number; vs: number; rent: number; demand: number; lots: number; vacantLots: number; nat: number }

function subRows(g: GameState, p: ParcelTable, bbls: string[]): SubRow[] {
  return derive(g, "next.city.subs", () => {
    const e = g.econ;
    const out: SubRow[] = [];
    for (const m of submarkets(g, p, bbls)) {
      for (const k of CLASSES) {
        const leg = m.legs[k];
        if (leg.sf < 20000) continue;
        const v = legVacancy(leg);
        out.push({
          key: `${m.district}:${k}`, district: m.district, name: m.name, k, use: SECTOR_LABEL[k], sf: leg.sf, vac: v,
          vs: (v - availability(e, k)) * 1e4, rent: legRent(leg), demand: legDemand(leg), lots: leg.lots, vacantLots: m.vacantLots, nat: normalVac(e, k),
        });
      }
    }
    return out;
  }, [p, bbls]);
}

const subCols: Col<SubRow>[] = [
  { id: "name", label: "District", get: (r) => r.name, cell: (r) => <span className="nx-strong-cell">{r.name}</span> },
  { id: "use", label: "Use", get: (r) => r.use },
  { id: "sf", label: "Inventory", get: (r) => r.sf, fmt: "sf" },
  { id: "lots", label: "Lots", get: (r) => r.lots, fmt: "n", hidden: true },
  { id: "vac", label: "Vacancy", get: (r) => r.vac, fmt: "pct", tone: (r) => (r.vac > r.nat + 0.03 ? "neg" : r.vac < r.nat - 0.02 ? "pos" : undefined) },
  { id: "vs", label: "vs city", get: (r) => r.vs, fmt: "bp" },
  { id: "rent", label: "Avg rent", get: (r) => r.rent, fmt: "psf" },
  { id: "demand", label: "Demand", get: (r) => r.demand, fmt: "n" },
  { id: "vacantLots", label: "Vacant lots", get: (r) => r.vacantLots, fmt: "n" },
];

interface PipeRow { key: string; bbl: string; addr: string; who: string; k: BuiltClass; use: string; sf: number; floors: number; deliverM: number; stalled: boolean; mixed: boolean }

function pipeRows(g: GameState, p: ParcelTable): PipeRow[] {
  return derive(g, "next.city.pipe", () => {
    const e = g.econ;
    const out: PipeRow[] = [];
    for (const q of e.deliveryQueue ?? []) {
      if (!q.bbl || q.deliverM - g.month >= 24) continue;
      const d = g.developments[q.bbl];
      const j = (g.cityJobs ?? []).find((x) => x.bbl === q.bbl);
      const who = q.source === "player" || q.source === "reuse" ? "You"
        : j?.firmId ? (g.rivals.find((r) => r.id === j.firmId)?.name ?? "Competitor")
        : q.source === "rival" ? "Competitor"
        : (j?.builderId && (g.builders ?? []).find((b) => b.id === j.builderId)?.name) || "Local developer";
      const legs = Object.values(q.sfByUse).filter((v) => (v ?? 0) > 0).length;
      for (const k of CLASSES) {
        const csf = Math.round(q.sfByUse[k] ?? 0);
        if (csf <= 0) continue;
        out.push({
          key: `${q.bbl}:${k}:${q.deliverM}`, bbl: q.bbl, addr: resolveRec(p, g, q.bbl)?.address ?? q.bbl, who, k, use: SECTOR_LABEL[k],
          sf: csf, floors: d?.floors ?? j?.floors ?? 0, deliverM: q.deliverM, stalled: q.status === "stalled" || !!j?.orphaned, mixed: legs > 1,
        });
      }
    }
    return out;
  }, [p]);
}

const pipeCols: Col<PipeRow>[] = [
  { id: "addr", label: "Address", get: (r) => r.addr, cell: (r) => <span className="nx-strong-cell">{r.addr}{r.stalled ? <span className="nx-chip nx-chip-red">Stalled</span> : null}{r.mixed ? <span className="nx-chip nx-chip-teal">Mixed</span> : null}</span> },
  { id: "who", label: "Builder", get: (r) => r.who },
  { id: "use", label: "Use", get: (r) => r.use },
  { id: "sf", label: "sf", get: (r) => r.sf, fmt: "n" },
  { id: "floors", label: "Floors", get: (r) => r.floors || null, fmt: "n" },
  { id: "deliver", label: "Delivers", get: (r) => r.deliverM, cell: (r) => mo(r.deliverM) },
];

type TradeRow = ReturnType<typeof tradeRows>[number];
const tradeCols: Col<TradeRow>[] = [
  { id: "label", label: "Trade", get: (r) => r.label },
  { id: "phase", label: "Phase", get: (r) => r.phase, tone: (r) => (r.phase === "bust" ? "neg" : r.phase === "boom" ? "pos" : undefined) },
  { id: "mom", label: "Momentum", get: (r) => r.mom, num: true, cell: (r) => (r.mom * 100).toFixed(2), tone: (r) => (r.mom < -0.004 ? "neg" : undefined) },
  { id: "mine", label: "Your roll", get: (r) => r.mine, fmt: "pct", tone: (r) => (r.mine > 0.4 ? "neg" : undefined) },
];

type Hearing = ReturnType<typeof pendingHearings>[number];

export type MarketsPart = "sectors" | "districts" | "building";

export function CityMarkets({ part }: { part: MarketsPart }) {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const bbls = useStore((s) => s.bbls);
  const [f, setF] = useState<BuiltClass[]>([]);
  const e = game.econ;
  const classes = useMemo(() => classRows(game), [game]);
  const series = useMemo(() => seriesRows(game), [game]);
  const subs = useMemo(() => subRows(game, parcels, bbls), [game, parcels, bbls]);
  const pipe = useMemo(() => pipeRows(game, parcels), [game, parcels]);
  const trades = useMemo(() => tradeRows(game), [game]);
  const hearings = pendingHearings(game);
  const climate = boardClimate(game);
  const uw = underwritingStandards(game);
  const x = cityValueToReplacement(game);
  const h = e.history ?? [];
  const n = h.length;
  const jobsYr = n > 12 && h[n - 13].jobs ? h[n - 1].jobs! / h[n - 13].jobs! - 1 : null;
  const on = (k: BuiltClass) => !f.length || f.includes(k);
  const subShown = subs.filter((r) => on(r.k));
  const pipeShown = pipe.filter((r) => on(r.k));
  const hearCols: Col<Hearing>[] = [
    { id: "addr", label: "Site", get: (r) => resolveRec(parcels, game, r.bbl)?.address ?? r.bbl },
    { id: "decide", label: "Sits", get: (r) => r.decideM, cell: (r) => mo(r.decideM) },
    { id: "odds", label: "Odds", get: (r) => r.odds, fmt: "pct" },
  ];
  return (
    <div className="nx-place">
      {part === "sectors" && <StatStrip>
        <Stat label="Phase"><Figure value={null} fmt="n" text={e.phase} /></Stat>
        {e.rumoredPhase && <Stat label="Rumored"><Figure value={null} fmt="n" text={e.rumoredPhase} /></Stat>}
        <Stat label="10Y"><Figure value={e.indexRate} fmt="pctv" drill="rate" /></Stat>
        {e.rateRegime !== undefined && <Stat label="Long-run"><Figure value={e.rateRegime} fmt="pctv" drill="rate" tone={e.rateRegime > 9 ? "neg" : undefined} /></Stat>}
        <Stat label="Short index"><Figure value={shortIndexOf(e)} fmt="pctv" drill="rate" /></Stat>
        {e.nat?.policy !== undefined && <Stat label="Policy"><Figure value={e.nat.policy} fmt="pctv" drill="rate" /></Stat>}
        {e.nat?.infl !== undefined && <Stat label="Inflation"><Figure value={e.nat.infl} fmt="pct" tone={e.nat.infl > 0.04 ? "neg" : undefined} /></Stat>}
        <Stat label="Credit"><Figure value={e.creditIdx} fmt="pct" tone={e.creditIdx < 0.7 ? "neg" : undefined} /></Stat>
        <Stat label="Underwriting"><Figure value={null} fmt="n" text={standardsWord(uw)} tone={uw < -0.5 ? "neg" : undefined} /></Stat>
        <Stat label="Value / build"><Figure value={x} fmt="x" tone={x < 0.95 ? "neg" : undefined} /></Stat>
        <Stat label="Population"><Figure value={e.population ?? 0} fmt="n" /></Stat>
        <Stat label="Jobs"><Figure value={e.jobs ?? 0} fmt="n" /></Stat>
        <Stat label="Jobs 12m"><Figure value={jobsYr} fmt="pct" tone={(jobsYr ?? 0) < 0 ? "neg" : undefined} /></Stat>
        <Stat label="Unemployment"><Figure value={e.unemployment ?? 0} fmt="pct" tone={(e.unemployment ?? 0) > 0.085 ? "neg" : undefined} /></Stat>
        <Stat label="Build costs"><Figure value={e.costIdx * 100} fmt="n" /></Stat>
        <Stat label="Land"><Figure value={e.landIdx * 100} fmt="n" /></Stat>
        <Stat label="Board 5y"><Figure value={null} fmt="n" text={`${climate.up}↑ ${climate.down}↓`} /></Stat>
      </StatStrip>}
      {part === "sectors" && <>
      <DataTable id="city-classes" cols={classCols} rows={classes} rowKey={(r) => r.k} />
      {head("City series")}
      <DataTable id="city-series" cols={seriesCols} rows={series} rowKey={(r) => r.id} />
      </>}
      {part !== "sectors" && <Chips<BuiltClass>
        chips={CLASSES.map((k) => ({ id: k, label: SECTOR_LABEL[k], n: subs.filter((r) => r.k === k).length }))}
        on={f}
        set={setF}
      />}
      {part === "districts" && <DataTable id="city-subs" cols={subCols} rows={subShown} rowKey={(r) => r.key} initialSort={{ col: "sf", dir: -1 }} />}
      {part === "building" && <>
      {head("Under construction")}
      <DataTable id="city-pipe" cols={pipeCols} rows={pipeShown} rowKey={(r) => r.key}
        initialSort={{ col: "deliver", dir: 1 }} onRow={(r) => sel(r.bbl)} />
      {head("Employers")}
      <DataTable id="city-trades" cols={tradeCols} rows={trades} rowKey={(r) => r.k} initialSort={{ col: "mine", dir: -1 }} />
      {hearings.length > 0 && <>
        {head("Your hearings")}
        <DataTable id="city-hearings" cols={hearCols} rows={hearings} rowKey={(r) => r.bbl} onRow={(r) => sel(r.bbl)} />
      </>}
      </>}
    </div>
  );
}

// ============================================================ MARKETS OVERVIEW

const CLASS_COLOR: Record<BuiltClass, string> = { office: "#3b6fb6", multifamily: "#8a4fb0", retail: "#d9822b", industrial: "#6b7280" };
const BAL_TONE: Record<string, string> = { "acute shortage": "pos", "landlord's market": "pos", "tenant's market": "neg", glut: "neg" };

/**
 * THE MARKETS AT A GLANCE (owner: "much more digestible with graphs"). One
 * card per use reads the balance in a word, the rent and the cap, with the
 * engine's own sentence on what that balance means for an owner; the charts
 * below are the same series the Sectors tables print, drawn.
 */
export function MarketsOverview() {
  const game = useStore((s) => s.game)!;
  const classes = useMemo(() => classRows(game), [game]);
  const e = game.econ;
  const tail = (e.history ?? []).slice(-SPAN_M);
  if (tail.length < 2) return <div className="nx-place"><div className="hint">History: few months</div></div>;
  const x: [string, string] = [monthLabel(tail[0].q), monthLabel(tail[tail.length - 1].q)];
  const xAt = (i: number) => monthLabel(tail[i]?.q ?? 0);
  const pct = (v: number) => `${v.toFixed(1)}%`;
  const ser = (pick: (r: ClassRow) => number[], scale = 1) =>
    classes.map((r) => ({ label: r.label, color: CLASS_COLOR[r.k], pts: pick(r).map((v) => v * scale) }));
  // rents in different units per use read on one chart only as an index
  const rentIdx = classes.map((r) => {
    const base = r.rentS.find((v) => Number.isFinite(v) && v > 0) ?? 1;
    return { label: r.label, color: CLASS_COLOR[r.k], pts: r.rentS.map((v) => (v / base) * 100) };
  });
  const hist = e.history ?? [];
  const yrAgo = hist.length > 12 ? hist[hist.length - 13]?.costIdx : undefined;
  const costYoy = yrAgo ? e.costIdx / yrAgo - 1 : null;
  // both lines at 100 on the chart's first month, so they read against each other
  const rebase = (v: number[]) => { const b0 = v.find((x) => Number.isFinite(x) && x > 0) ?? 1; return v.map((x) => (x / b0) * 100); };
  const years = ["Next 12m", "Year 2", "Year 3", "Year 4"];
  const supply = years.map((label, i) => ({ label, bars: classes.map((r) => ({ v: (r.sched[i] ?? 0) / 1000, color: CLASS_COLOR[r.k] })) }));
  return (
    <div className="nx-place">
      <div className="mk-cards">
        {classes.map((r) => {
          const bal = marketBalance(e, r.k);
          return (
            <div className="mk-card" key={r.k} style={{ borderTopColor: CLASS_COLOR[r.k] }}>
              <div className="mk-card-head"><b>{r.label}</b><span className={`mk-state ${BAL_TONE[bal.state] ?? ""}`}>{bal.state}</span></div>
              <div className="mk-figs">
                <div><small>Available</small><Figure value={r.avail} fmt="pct" /></div>
                <div><small>Rent</small><Figure value={r.rent} fmt="psf" /></div>
                <div><small>Real 12m</small><Figure value={r.realYoy} fmt="pct" tone={r.realYoy < 0 ? "neg" : "pos"} /></div>
                <div><small>Cap</small><Figure value={r.cap} fmt="pctv" /></div>
              </div>
              <Gauge value={r.avail} natural={r.nat} lo={0} hi={Math.max(0.3, r.avail * 1.2)} fmt={(v) => `${(v * 100).toFixed(1)}%`} />
              <div className="mk-note">{bal.note}</div>
            </div>
          );
        })}
      </div>
      <div className="mk-legend">{classes.map((r) => <span key={r.k}><i style={{ background: CLASS_COLOR[r.k] }} />{r.label}</span>)}</div>
      <div className="chart-grid">
        <div className="chart-cell">
          <div className="chart-title">Availability · % of space</div>
          <LineChart series={ser((r) => r.availS, 100)} yFmt={pct} xLabels={x} xAt={xAt} zeroBase />
        </div>
        <div className="chart-cell">
          <div className="chart-title">Rents — indexed, 100 = {x[0]}</div>
          <LineChart series={rentIdx} yFmt={(v) => v.toFixed(0)} xLabels={x} xAt={xAt} />
        </div>
        <div className="chart-cell">
          <div className="chart-title">Cap rates</div>
          <LineChart series={ser((r) => r.capS)} yFmt={(v) => `${v.toFixed(2)}%`} xLabels={x} xAt={xAt} />
        </div>
        <div className="chart-cell">
          <div className="chart-title">Deliveries · k sf</div>
          <BarChart groups={supply} />
        </div>
        <div className="chart-cell">
          <div className="chart-title">Interest rates</div>
          <LineChart series={[
            { label: "10Y", color: "#2f6f7a", pts: tail.map((h) => h.indexRate) },
            { label: "Policy", color: "#a8402e", pts: tail.map((h) => h.policy ?? NaN), dashed: true },
          ]} yFmt={(v) => `${v.toFixed(1)}%`} xLabels={x} xAt={xAt} />
        </div>
        {/* THE CONSTRUCTION COST INDEX (owner, Oct 2026: "needs to be in the markets page"),
            against the price level, so a real rise in building costs reads as a gap */}
        <div className="chart-cell">
          <div className="chart-title">Construction costs · index {(e.costIdx * 100).toFixed(0)}{costYoy !== null ? ` · ${costYoy >= 0 ? "+" : ""}${(costYoy * 100).toFixed(1)}% 12m` : ""}</div>
          <LineChart series={[
            { label: "Build costs", color: "#b07f1e", pts: rebase(tail.map((h) => h.costIdx ?? NaN)) },
            { label: "Price level", color: "#665e4d", pts: rebase(tail.map((h) => h.cpi ?? NaN)), dashed: true },
          ]} yFmt={(v) => v.toFixed(0)} xLabels={x} xAt={xAt} />
        </div>
        <div className="chart-cell">
          <div className="chart-title">Jobs — thousands</div>
          <LineChart series={[{ label: "Jobs", color: "#3a7d46", pts: tail.map((h) => (h.jobs ?? 0) / 1000) }]} yFmt={(v) => `${v.toFixed(0)}k`} xLabels={x} xAt={xAt} />
        </div>
      </div>
      <CityHallBox />
    </div>
  );
}

// ======================================================================= NEWS

/** The wire's repeat key — the Headlines fold (NewsPage `wireKey`). */
const wireKey = (t: string) =>
  t.replace(/[−-]?\$[\d,.]+[MKB]?/g, "$#").replace(/[−-]?\d+(\.\d+)?%/g, "#%").replace(/\d+\.\d+/g, "#")
    .replace(/\b\d+ (cents|months?|years?|points?)\b/g, "# $1");

type NK = NewsItem["kind"] | "mine";
const NEWS_CHIPS: { id: NK; label: string }[] = [
  { id: "warn", label: "Warnings" },
  { id: "event", label: "Events" },
  { id: "deal", label: "Deals" },
  { id: "info", label: "Notices" },
  { id: "rumor", label: "Rumors" },
  { id: "mine", label: "Your book" },
];
interface NewsRow { key: string; q: number; kind: string; text: string; bbl?: string; place: string; mine: boolean; also: number }

export function CityNews() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const [f, setF] = useState<NK[]>([]);
  const news = game.news ?? [];
  const mine = useMemo(() => new Set([...Object.keys(game.holdings), ...(game.exits ?? []).map((x) => x.bbl), ...(game.watch ?? [])]), [game.holdings, game.exits, game.watch]);
  const isMine = (n: NewsItem) => !!n.bbl && mine.has(n.bbl);
  const rows = useMemo(() => {
    const pass = (n: NewsItem) => !f.length || f.some((k) => (k === "mine" ? isMine(n) : n.kind === k));
    const keeper = new Map<string, NewsRow>();
    const out: NewsRow[] = [];
    news.forEach((n, i) => {
      if (!pass(n)) return;
      const k = `${n.kind}|${wireKey(n.text)}`;
      const kept = keeper.get(k);
      if (kept) { kept.also++; return; }
      const r: NewsRow = { key: `${n.q}:${i}`, q: n.q, kind: n.kind, text: n.text, bbl: n.bbl, place: n.bbl ? parcels[n.bbl]?.address ?? n.bbl : "", mine: isMine(n), also: 0 };
      keeper.set(k, r);
      out.push(r);
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [news, f, mine, parcels]);
  const count = (k: NK) => news.filter((n) => (k === "mine" ? isMine(n) : n.kind === k)).length;
  const now = news.filter((n) => n.q === game.month);
  const prints12 = (game.comps ?? []).filter((c) => c.m >= game.month - 12).length;
  const paper = derive(game, "next.city.paper", () => writePaper(game, parcels), [parcels]);
  const stories = paper.stories;
  const cols: Col<NewsRow>[] = [
    { id: "q", label: "Month", get: (r) => r.q, cell: (r) => mo(r.q), width: 90 },
    { id: "kind", label: "Kind", get: (r) => r.kind, tone: (r) => (r.kind === "warn" ? "neg" : undefined), width: 70 },
    { id: "text", label: "Headline", get: (r) => r.text, cell: (r) => <span className={r.mine ? "nx-strong-cell" : undefined}>{r.text}</span> },
    { id: "place", label: "Place", get: (r) => r.place, hidden: true },
    { id: "also", label: "Repeats", get: (r) => r.also || null, fmt: "n", width: 70 },
  ];
  const storyCols: Col<Story>[] = [
    { id: "m", label: "Month", get: (r) => r.m, cell: (r) => mo(r.m), width: 90 },
    { id: "section", label: "Section", get: (r) => r.section, width: 80 },
    { id: "kicker", label: "Kicker", get: (r) => r.kicker },
    { id: "head", label: "Headline", get: (r) => r.head, cell: (r) => <span className={r.mine ? "nx-strong-cell" : undefined}>{r.head}</span> },
    { id: "beats", label: "Beats", get: (r) => r.beats?.length ?? null, fmt: "n", hidden: true },
    { id: "rank", label: "Rank", get: (r) => storyRank(r, game.month), num: true, cell: (r) => storyRank(r, game.month).toFixed(1) },
  ];
  type Num = (typeof paper.numbers)[number];
  const numCols: Col<Num>[] = [
    { id: "label", label: "Figure", get: (r) => r.label },
    { id: "value", label: "Value", get: (r) => r.value, num: true, tone: (r) => (r.flag ? "neg" : undefined) },
  ];
  return (
    <div className="nx-place">
      <StatStrip>
        <Stat label="Items"><Figure value={news.length} fmt="n" /></Stat>
        <Stat label="This month"><Figure value={now.length} fmt="n" /></Stat>
        <Stat label="Warnings"><Figure value={now.filter((n) => n.kind === "warn").length} fmt="n" tone={now.some((n) => n.kind === "warn") ? "neg" : undefined} /></Stat>
        <Stat label="Your book"><Figure value={count("mine")} fmt="n" /></Stat>
        <Stat label="Prints 12m"><Figure value={prints12} fmt="n" /></Stat>
        <Stat label="Stories"><Figure value={stories.length} fmt="n" /></Stat>
      </StatStrip>
      <Chips<NK> chips={NEWS_CHIPS.map((c) => ({ ...c, n: count(c.id) }))} on={f} set={setF} />
      <DataTable id="city-news" cols={cols} rows={rows} rowKey={(r) => r.key} initialSort={{ col: "q", dir: -1 }}
        onRow={(r) => sel(r.bbl)} maxHeight={560} />
      {head("Stories")}
      <DataTable id="city-stories" cols={storyCols} rows={stories} rowKey={(r) => r.id} initialSort={{ col: "rank", dir: -1 }}
        onRow={(r) => sel(r.bbl)} maxHeight={420} />
      {paper.numbers.length > 0 && <>
        {head("By the numbers")}
        <DataTable id="city-paper-numbers" cols={numCols} rows={paper.numbers} rowKey={(r) => r.label} />
      </>}
    </div>
  );
}

// ==================================================================== PLAYERS

interface FirmRow {
  id: string; name: string; you: boolean; profile: string; bldgs: number; gav: number | null; debt: number | null;
  eq: number | null; ltv: number | null; dry: number | null; noi: number | null; stress: number; rank: number | null;
  status: string; lastM: number | null; last: string; from: string; cond: string; builder: boolean; dead: boolean;
}

/** The street's marks — the same derivation, under the same key, as StreetDesk. */
function streetMarked(game: GameState, parcels: ParcelTable) {
  const rivals = game.rivals ?? [];
  return derive(game, "street.marked", () => rivals.map((r) => ({ r, m: markRival(game, parcels, r) }))
    .sort((a, b) => (a.r.failedM !== undefined ? 1 : 0) - (b.r.failedM !== undefined ? 1 : 0) || rivalEquity(b.m, b.r) - rivalEquity(a.m, a.r)),
  [parcels]);
}
function streetMine(game: GameState, parcels: ParcelTable) {
  const playerEquity = nwOf(game, parcels);
  return derive(game, "street.mine", () => {
    const gav = portfolioMark(game, parcels).gav;
    const cash = Math.max(0, game.cash);
    const debt = Math.max(0, gav + game.cash - playerEquity);
    const buildings = Object.keys(game.holdings).filter((b) => !game.merged?.[b]).length;
    return { gav, cash, debt, buildings, ltv: gav > 0 ? debt / gav : 0 };
  }, [parcels]);
}

function firmRows(game: GameState, parcels: ParcelTable): FirmRow[] {
  return derive(game, "next.city.firms", () => {
    const marked = streetMarked(game, parcels);
    const me = streetMine(game, parcels);
    const nw = nwOf(game, parcels);
    const live = [{ id: "__you", eq: nw }, ...marked.filter((x) => x.r.failedM === undefined).map((x) => ({ id: x.r.id, eq: rivalEquity(x.m, x.r) }))]
      .sort((a, b) => b.eq - a.eq);
    const rankOf = new Map(live.map((x, i) => [x.id, i + 1]));
    const out: FirmRow[] = [{
      id: "__you", name: firmName(game), you: true, profile: "Yours", bldgs: me.buildings, gav: me.gav, debt: me.debt, eq: nw,
      ltv: me.gav > 0 ? me.ltv : null, dry: me.cash, noi: null, stress: 0, rank: rankOf.get("__you") ?? null, status: "", lastM: null, last: "",
      from: "", cond: "", builder: false, dead: false,
    }];
    for (const { r, m } of marked) {
      const dead = r.failedM !== undefined;
      const stress = r.stressMs ?? 0;
      const eq = rivalEquity(m, r);
      const lm = movesOf(game, r.id, 1)[0];
      const status = dead
        ? r.takenPrivateM !== undefined ? "taken private" : r.endReason === "absorbed" ? "absorbed" : r.bbls.length ? "receivership" : "gone"
        : m.aum <= 0 && r.debt > 0 ? "finished"
        : stress > 0 ? "selling"
        : m.ltv > 0.75 ? "levered"
        : r.cash > m.aum * 0.06 ? "cash-rich"
        : "invested";
      out.push({
        id: r.id, name: r.name, you: false, profile: r.sheet ? labelOf(r) : STYLE_WORD[r.style] ?? r.style, bldgs: r.bbls.length,
        gav: dead ? null : m.aum, debt: dead ? null : r.debt, eq: dead ? null : eq, ltv: dead || m.aum <= 0 ? null : m.ltv,
        dry: dead ? null : Math.max(0, r.cash), noi: dead ? null : m.noiYr, stress, rank: rankOf.get(r.id) ?? null, status,
        lastM: lm?.m ?? (dead ? r.failedM ?? null : null), last: lm?.kind ?? "", from: r.spawnedFrom?.firmName ?? "",
        cond: rivalCondition(r), builder: !!r.builderProf, dead,
      });
    }
    return out;
  }, [parcels]);
}

const firmCols: Col<FirmRow>[] = [
  { id: "name", label: "Firm", get: (r) => r.name, cell: (r) => <span className={r.you ? "nx-strong-cell" : r.dead ? "nx-dim" : undefined}>{r.you ? "★ " : ""}{r.name}{r.builder ? <span className="nx-chip nx-chip-gold">Builder</span> : null}</span> },
  { id: "profile", label: "Style", get: (r) => r.profile, hidden: true },
  { id: "rank", label: "Rank", get: (r) => r.rank, fmt: "n" },
  { id: "bldgs", label: "Deeds", get: (r) => r.bldgs, fmt: "n" },
  { id: "gav", label: "Gross", get: (r) => r.gav, fmt: "usd" },
  { id: "debt", label: "Debt", get: (r) => r.debt, fmt: "usd" },
  { id: "eq", label: "Equity", get: (r) => r.eq, fmt: "usd", tone: (r) => ((r.eq ?? 0) < 0 ? "neg" : undefined) },
  { id: "ltv", label: "LTV", get: (r) => r.ltv, fmt: "pct", tone: (r) => ((r.ltv ?? 0) > 0.8 ? "neg" : undefined) },
  { id: "dry", label: "Dry powder", get: (r) => r.dry, fmt: "usd" },
  { id: "noi", label: "NOI / yr", get: (r) => r.noi, fmt: "usd", hidden: true },
  { id: "stress", label: "Behind mo", get: (r) => r.stress || null, fmt: "n", tone: (r) => (r.stress > 0 ? "neg" : undefined), hidden: true },
  { id: "status", label: "Read", get: (r) => r.status, tone: (r) => (r.status === "selling" || r.status === "finished" || r.status === "levered" ? "neg" : undefined) },
  { id: "lastM", label: "Last move", get: (r) => r.lastM, cell: (r) => <span className="mono">{r.lastM !== null ? `${monthLabel(r.lastM)} ${r.last}` : "—"}</span>, hidden: true },
  { id: "cond", label: "Upkeep", get: (r) => r.cond, hidden: true },
  { id: "from", label: "Raised from", get: (r) => r.from, hidden: true },
];

type Move = ReturnType<typeof streetMoves>[number];
type OwnerRow = { o: ReturnType<typeof allOwners>[number]; sf: number; likely: boolean };
type PV = "firms" | "private" | "all";

export function CityPlayers() {
  const focus = useStore((s) => s.firmFocus);
  const focused = useStore((s) => (focus ? s.game?.rivals.find((r) => r.id === focus) : undefined));
  // A RIVAL'S OWN PAGE (owner, Oct 2026: a firm's name should open that firm,
  // not the list): the profile the classic street desk shows, with a way back.
  if (focused) {
    return (
      <div className="nx-place">
        <button type="button" className="nx-btn nx-sm" onClick={() => useStore.getState().openFirm(null)}>← All firms</button>
        <h3 style={{ margin: "8px 0" }}>{focused.name}</h3>
        <FirmPage r={focused} />
      </div>
    );
  }
  return <CityPlayersList />;
}

function CityPlayersList() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const [view, setView] = useState<PV>("firms");
  const firms = useMemo(() => firmRows(game, parcels), [game, parcels]);
  const owners = useMemo(() => derive(game, "next.city.owners", () => {
    const likely = new Set(holdersLikelyToSell(game, parcels).map((x) => x.h.id));
    return allOwners(game, parcels).map((o): OwnerRow => {
      let area = 0;
      for (const b of o.book) area += resolveRec(parcels, game, b)?.bldgArea ?? 0;
      return { o, sf: area, likely: likely.has(o.id) };
    });
  }, [parcels]), [game, parcels]);
  const st = standingOf(game, parcels);
  const yr = distressTally(game, 12);
  const live = (game.rivals ?? []).filter((r) => r.failedM === undefined).length;
  const stressed = (game.rivals ?? []).filter((r) => r.failedM === undefined && (r.stressMs ?? 0) > 0).length;
  const moves = streetMoves(game, game.month - 6, 40);
  const nameOf = (id: string) => game.rivals.find((x) => x.id === id)?.name ?? id;
  const totAssets = owners.reduce((a, r) => a + r.o.sheet.assets, 0);
  const top10 = owners.slice().sort((a, b) => b.o.sheet.assets - a.o.sheet.assets).slice(0, 10).reduce((a, r) => a + r.o.sheet.assets, 0);
  const moveCols: Col<Move>[] = [
    { id: "m", label: "Month", get: (r) => r.m, cell: (r) => mo(r.m), width: 90 },
    { id: "firm", label: "Firm", get: (r) => nameOf(r.firmId) },
    { id: "kind", label: "Move", get: (r) => r.kind, tone: (r) => (r.kind === "sell" ? "neg" : r.kind === "buy" ? "pos" : undefined), width: 60 },
    { id: "text", label: "Detail", get: (r) => r.text },
    { id: "px", label: "Price", get: (r) => r.px ?? null, fmt: "usd" },
  ];
  const ownerCols: Col<OwnerRow>[] = [
    { id: "name", label: "Owner", get: (r) => r.o.name, cell: (r) => <span className={r.o.failedM !== undefined ? "nx-dim" : "nx-strong-cell"}>{r.o.name}{r.likely ? <span className="nx-chip nx-chip-gold">Likely seller</span> : null}</span> },
    { id: "type", label: "Type", get: (r) => (r.o.failedM !== undefined ? "receivership" : r.o.operator ? (r.o.style ? STYLE_WORD[r.o.style] ?? r.o.style : "operator") : `${r.o.kind} holder`) },
    { id: "book", label: "Deeds", get: (r) => r.o.book.length, fmt: "n" },
    { id: "sf", label: "sf", get: (r) => r.sf || null, fmt: "sf" },
    { id: "assets", label: "Assets", get: (r) => r.o.sheet.assets, fmt: "usd" },
    { id: "yld", label: "Yield", get: (r) => (r.o.sheet.assets > 0 ? r.o.income.noi / r.o.sheet.assets : null), fmt: "pct" },
    { id: "debt", label: "Debt", get: (r) => r.o.sheet.debt || null, fmt: "usd" },
    { id: "eq", label: "Net worth", get: (r) => r.o.sheet.equity, fmt: "usd", tone: (r) => (r.o.sheet.equity < 0 ? "neg" : undefined) },
    { id: "cf", label: "Cash / yr", get: (r) => r.o.income.net, fmt: "usd", tone: (r) => (r.o.income.net < 0 ? "neg" : undefined) },
    { id: "since", label: "Since", get: (r) => r.o.since, num: true, hidden: true },
    { id: "standing", label: "Standing", get: (r) => r.o.standing, tone: (r) => (r.o.cold ? "neg" : undefined) },
  ];
  const ownersShown = owners.filter((r) => view === "all" || !r.o.operator);
  return (
    <div className="nx-place">
      <StatStrip>
        <Stat label="Firms"><Figure value={live} fmt="n" /></Stat>
        <Stat label="Your rank"><Figure value={st.rank} fmt="n" text={`${st.rank} / ${st.of}`} drill="rank" /></Stat>
        <Stat label="Leader"><Figure value={st.leader.eq} fmt="usd" drill="rank" /></Stat>
        <Stat label="Median rival"><Figure value={st.medianRival} fmt="usd" drill="rank" /></Stat>
        <Stat label="Appetite"><Figure value={marketAppetite(game)} fmt="x" /></Stat>
        <Stat label="Behind"><Figure value={stressed} fmt="n" tone={stressed ? "neg" : undefined} /></Stat>
        <Stat label="Defaults 12m"><Figure value={yr.defaults} fmt="n" tone={yr.defaults ? "neg" : undefined} /></Stat>
        <Stat label="Failed 12m"><Figure value={yr.firms} fmt="n" tone={yr.firms ? "neg" : undefined} /></Stat>
        <Stat label="Banks 12m"><Figure value={yr.banks} fmt="n" tone={yr.banks ? "neg" : undefined} /></Stat>
        <Stat label="Owners"><Figure value={owners.length} fmt="n" /></Stat>
        <Stat label="Top 10"><Figure value={totAssets > 0 ? top10 / totAssets : null} fmt="pct" /></Stat>
      </StatStrip>
      <Chips<PV>
        chips={[
          { id: "firms", label: "Firms", n: live },
          { id: "private", label: "Private holders", n: owners.filter((r) => !r.o.operator).length },
          { id: "all", label: "Everyone", n: owners.length },
        ]}
        on={[view]}
        set={(v) => { const nx = v.find((x) => x !== view); if (nx) setView(nx); }}
      />
      {view === "firms" ? <>
        <DataTable id="city-firms" cols={firmCols} rows={firms} rowKey={(r) => r.id} selected="__you" initialSort={{ col: "eq", dir: -1 }}
          onRow={(r) => { if (!r.you) useStore.getState().openFirm(r.id); }} />
        {head("Street moves")}
        <DataTable id="city-moves" cols={moveCols} rows={moves} rowKey={(r) => `${r.m}:${r.firmId}:${r.kind}:${r.bbl ?? r.text}`}
          initialSort={{ col: "m", dir: -1 }} onRow={(r) => sel(r.bbl)} />
      </> : (
        <DataTable id={`city-owners-${view}`} cols={ownerCols} rows={ownersShown} rowKey={(r) => r.o.id} initialSort={{ col: "assets", dir: -1 }}
          onRow={(r) => sel(r.o.book[0])} />
      )}
    </div>
  );
}

// =================================================================== RANKINGS

type RK = "pop" | "growth10" | "unemp" | "pay" | "rent2br" | "afford";
const RCOLS: { key: RK; label: string; better: "high" | "low"; fmt: FigFmt }[] = [
  { key: "pop", label: "Population", better: "high", fmt: "n" },
  { key: "growth10", label: "Growth 10y", better: "high", fmt: "pct" },
  { key: "unemp", label: "Unemployment", better: "low", fmt: "pctv" },
  { key: "pay", label: "Avg pay", better: "high", fmt: "usd" },
  { key: "rent2br", label: "Two-bed rent", better: "low", fmt: "usd" },
  { key: "afford", label: "Rent / pay", better: "low", fmt: "pct" },
];
const rval = (r: RankRow, k: RK): number | null =>
  k === "afford" ? (r.pay > 0 ? (r.rent2br * 12) / r.pay : null) : (r[k] as number | null);

export function CityRankings() {
  const game = useStore((s) => s.game)!;
  const manifest = useStore((s) => s.manifest);
  const town = manifest?.city ?? "Your town";
  const table = useMemo(() => cityRankings(game, town), [game, town]);
  const keyOf = (r: RankRow) => r.name + "|" + r.state;
  const you = table.rows.find((r) => r.you);
  const rankOf = (k: RK) => {
    const c = RCOLS.find((x) => x.key === k)!;
    const xs = table.rows.filter((r) => rval(r, k) !== null)
      .sort((a, b) => (c.better === "high" ? rval(b, k)! - rval(a, k)! : rval(a, k)! - rval(b, k)!));
    const i = xs.findIndex((r) => r.you);
    return { i: i >= 0 ? i + 1 : null, n: xs.length };
  };
  const cols: Col<RankRow>[] = [
    { id: "name", label: "City", get: (r) => r.name, cell: (r) => <span className={r.you ? "nx-strong-cell" : undefined}>{r.you ? `★ ${r.name}` : `${r.name}, ${r.state}`}{r.projected ? " *" : ""}</span> },
    ...RCOLS.map((c): Col<RankRow> => ({ id: c.key, label: c.label, get: (r) => rval(r, c.key), fmt: c.fmt })),
    { id: "proj", label: "Projected", get: (r) => (r.projected ? "yes" : ""), hidden: true },
  ];
  return (
    <div className="nx-place">
      <StatStrip>
        <Stat label="Year"><Figure value={table.year} fmt="n" text={String(table.year)} /></Stat>
        <Stat label="Cities"><Figure value={table.rows.length} fmt="n" /></Stat>
        {RCOLS.map((c) => {
          const r = rankOf(c.key);
          return <Stat key={c.key} label={c.label}><Figure value={r.i} fmt="n" text={r.i ? `#${r.i} / ${r.n}` : "—"} tone={r.i && r.i > r.n / 2 ? "neg" : undefined} /></Stat>;
        })}
        <Stat label="Record ends"><Figure value={table.recordEnds} fmt="n" text={String(table.recordEnds)} /></Stat>
      </StatStrip>
      <DataTable id="city-rankings" cols={cols} rows={table.rows} rowKey={keyOf} selected={you ? keyOf(you) : null} initialSort={{ col: "pop", dir: -1 }} />
    </div>
  );
}

// ===================================================================== RECORD

type Cat = "founding" | "bought" | "sold" | "taken" | "build" | "delivered" | "planning" | "sponsor" | "milestone" | "epithet" | "swan" | "seizure" | "over";
const CAT_WORD: Record<Cat, string> = {
  founding: "Founded", bought: "Bought", sold: "Sold", taken: "Taken", build: "Ground broken", delivered: "Delivered",
  planning: "Planning", sponsor: "Sponsor", milestone: "Milestone", epithet: "Epithet", swan: "Swan", seizure: "Bank seized", over: "Ended",
};
type RecF = "deals" | "build" | "record" | "city";
const CAT_GROUP: Record<Cat, RecF> = {
  founding: "record", bought: "deals", sold: "deals", taken: "deals", build: "build", delivered: "build", planning: "build",
  sponsor: "record", milestone: "record", epithet: "record", swan: "city", seizure: "city", over: "record",
};
interface RecRow {
  key: string; m: number; cat: Cat; item: string; note: string; amount: number | null; mult: number | null;
  irr: number | null; sf: number | null; floors: number | null; bbl?: string;
}

const MILESTONE_LABEL: Record<string, string> = { ...Object.fromEntries(MILESTONES.map((m) => [m.id, m.label])), century: "A century in town" };

/** The firm's dated record — the same facts FirmTimeline merges, as rows. */
function recordRows(game: GameState, parcels: ParcelTable): RecRow[] {
  return derive(game, "next.city.record", () => {
    const short = firmShort(game);
    const rows: RecRow[] = [];
    const seen = new Set<string>();
    const push = (r: RecRow) => { if (!seen.has(r.key)) { seen.add(r.key); rows.push(r); } };
    const addr = (bbl: string) => resolveRec(parcels, game, bbl)?.address ?? bbl;
    const blank = { note: "", amount: null, mult: null, irr: null, sf: null, floors: null };
    push({ ...blank, key: "founded", m: game.firm?.foundedM ?? 0, cat: "founding", item: firmName(game) });
    const exits = game.exits ?? [];
    const forcedExitAt = new Set<string>();
    exits.forEach((x, i) => {
      if (x.forced) forcedExitAt.add(`${x.soldM}:${x.address}`);
      push({
        ...blank, key: `exit:${x.bbl}:${x.soldM}:${i}`, m: x.soldM, cat: x.forced ? "taken" : "sold", item: x.address, bbl: x.bbl,
        amount: x.gain, mult: x.basis > 0 ? x.price / x.basis : null, irr: x.irr ?? null,
      });
    });
    const spans = new Map<string, { a: number; b: number }[]>();
    for (const x of exits) { const l = spans.get(x.bbl) ?? []; l.push({ a: x.boughtM, b: x.soldM }); spans.set(x.bbl, l); }
    const ownedThen = (bbl: string, m: number) => {
      const h = game.holdings[bbl];
      if (h && m >= h.boughtM) return true;
      return (spans.get(bbl) ?? []).some((x) => m >= x.a && m <= x.b);
    };
    for (const [bbl, log] of Object.entries(game.propertyLog ?? {})) {
      for (const e of log) {
        if (e.kind === "trade" && e.party === short) {
          push({ ...blank, key: `bought:${bbl}:${e.m}`, m: e.m, cat: "bought", item: addr(bbl), bbl, amount: e.amount ?? null, note: e.outcome ?? "" });
        } else if (e.kind === "build-start" && e.party === short) {
          push({ ...blank, key: `build:${bbl}:${e.m}`, m: e.m, cat: "build", item: addr(bbl), bbl, sf: e.sf ?? null, floors: e.floors ?? null, note: e.use ?? "" });
        } else if (e.kind === "delivered" && e.party === short) {
          push({ ...blank, key: `delivered:${bbl}:${e.m}`, m: e.m, cat: "delivered", item: addr(bbl), bbl, sf: e.sf ?? null, note: e.use ?? "" });
        } else if (e.kind === "planning" && ownedThen(bbl, e.m)) {
          push({ ...blank, key: `planning:${bbl}:${e.m}:${e.outcome ?? ""}`, m: e.m, cat: "planning", item: addr(bbl), bbl, note: e.outcome ?? "" });
        }
      }
    }
    for (const h of Object.values(game.holdings)) {
      push({ ...blank, key: `bought:${h.bbl}:${h.boughtM}`, m: h.boughtM, cat: "bought", item: addr(h.bbl), bbl: h.bbl, amount: h.costBasis, note: "basis" });
      if (h.deliveredM !== undefined) {
        const rec = resolveRec(parcels, game, h.bbl);
        push({ ...blank, key: `delivered:${h.bbl}:${h.deliveredM}`, m: h.deliveredM, cat: "delivered", item: addr(h.bbl), bbl: h.bbl, sf: rec && rec.bldgArea > 0 ? rec.bldgArea : null });
      }
    }
    (game.sponsor?.events ?? []).forEach((e, i) => {
      if (e.kind === "forced" && forcedExitAt.has(`${e.m}:${e.address}`)) return;
      push({ ...blank, key: `sponsor:${i}:${e.m}:${e.kind}`, m: e.m, cat: "sponsor", item: e.address, note: e.kind, amount: e.amount > 0 ? -e.amount : null });
    });
    for (const [id, m] of Object.entries(game.milestones ?? {})) {
      const label = MILESTONE_LABEL[id];
      if (label) push({ ...blank, key: `milestone:${id}`, m, cat: "milestone", item: label.replace(/\.$/, "") });
    }
    for (const ep of game.firm?.epithets ?? []) push({ ...blank, key: `epithet:${ep.id}`, m: ep.sinceM, cat: "epithet", item: ep.text });
    (game.swanLog ?? []).forEach((sw, i) => push({ ...blank, key: `swan:${i}:${sw.m}`, m: sw.m, cat: "swan", item: sw.title, note: `${sw.dir < 0 ? "black" : "white"} · ${sw.key}` }));
    (game.seizures ?? []).forEach((m, i) => push({ ...blank, key: `seizure:${i}:${m}`, m, cat: "seizure", item: "" }));
    if (game.gameOver) push({ ...blank, key: "over", m: game.month, cat: "over", item: game.gameOver.cause });
    return rows;
  }, [parcels]);
}

const recCols: Col<RecRow>[] = [
  { id: "m", label: "Month", get: (r) => r.m, cell: (r) => mo(r.m), width: 90 },
  { id: "cat", label: "Kind", get: (r) => CAT_WORD[r.cat], tone: (r) => (r.cat === "taken" || r.cat === "sponsor" || r.cat === "over" ? "neg" : undefined) },
  { id: "item", label: "Item", get: (r) => r.item, cell: (r) => <span className={CAT_GROUP[r.cat] === "city" ? "nx-dim" : "nx-strong-cell"}>{r.item}</span> },
  { id: "note", label: "Note", get: (r) => r.note },
  { id: "amount", label: "Amount", get: (r) => r.amount, fmt: "usd", tone: (r) => (r.amount !== null && r.amount < 0 ? "neg" : undefined) },
  { id: "mult", label: "Multiple", get: (r) => r.mult, fmt: "x" },
  { id: "irr", label: "IRR", get: (r) => r.irr, fmt: "pct", hidden: true },
  { id: "sf", label: "sf", get: (r) => r.sf, fmt: "n" },
  { id: "floors", label: "Floors", get: (r) => r.floors, fmt: "n", hidden: true },
];

interface YearRow { k: BuiltClass; label: string; rent: number | null; vac: number | null; dVac: number | null; comp: number; abs: number }
interface EventRow { key: string; m: number; kind: string; name: string }

export function CityRecord() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const [f, setF] = useState<RecF[]>([]);
  const rows = useMemo(() => recordRows(game, parcels), [game, parcels]);
  const fc = firmCapital(game);
  const hit = firmMilestonesHit(game);
  const next = nextFirmMilestone(game);
  const st = (game.rivals?.length ?? 0) > 0 ? standingOf(game, parcels) : null;
  const m = game.month;
  const start = m - 11;
  // the year in review (FirmTimeline `review`)
  const nw = game.nwHistory ?? [];
  const nwNow = nw.length ? nw[nw.length - 1] : 0;
  const dNW = nw.length > 1 ? nwNow - nw[Math.max(0, nw.length - 1 - 12)] : 0;
  let cashIn = 0, cashOut = 0, haveBooks = false;
  for (const b of game.booksMonthly ?? []) {
    if (b.m < start || b.m > m) continue;
    haveBooks = true;
    cashIn += b.noi + b.sold + b.interest;
    cashOut += b.debtSvc + b.leasing + b.capex + b.dev + b.taxes + b.bought + b.ga;
  }
  const exits = game.exits ?? [];
  const soldExits = exits.filter((x) => x.soldM >= start && x.soldM <= m);
  const forcedN = soldExits.filter((x) => x.forced).length;
  const boughtN = Object.values(game.holdings).filter((h) => h.boughtM >= start && h.boughtM <= m).length
    + exits.filter((x) => x.boughtM >= start && x.boughtM <= m).length;
  const sfDelivered = rows.filter((r) => r.cat === "delivered" && r.m >= start && r.m <= m).reduce((a, r) => a + (r.sf ?? 0), 0);
  const shown = rows.filter((r) => !f.length || f.includes(CAT_GROUP[r.cat]));
  const n = (g: RecF) => rows.filter((r) => CAT_GROUP[r.cat] === g).length;

  // the street this year (FirmTimeline `StreetYear`)
  const hist = game.econ.history ?? [];
  const then = hist.find((h) => h.q >= start) ?? hist[0];
  const now = hist[hist.length - 1];
  const win = hist.filter((h) => h.q >= start);
  const yearRows: YearRow[] = then && now ? CLASSES.map((k) => {
    const r0 = then.effRent?.[k] ?? then.rent?.[k], r1 = now.effRent?.[k] ?? now.rent?.[k];
    const v0 = then.vac?.[k], v1 = now.vac?.[k];
    return {
      k, label: SECTOR_LABEL[k], rent: r0 && r1 ? r1 / r0 - 1 : null, vac: v1 ?? null,
      dVac: v0 !== undefined && v1 !== undefined ? (v1 - v0) * 1e4 : null,
      comp: win.reduce((a, h) => a + (h.comp?.[k] ?? 0), 0), abs: win.reduce((a, h) => a + (h.abs?.[k] ?? 0), 0),
    };
  }) : [];
  const inWin = (x?: number) => x !== undefined && x >= start && x <= m;
  const events: EventRow[] = [];
  for (const w of game.econ.blackSwans ?? []) if (inWin(w.m)) events.push({ key: `sw:${w.m}:${w.kind}`, m: w.m, kind: "swan", name: w.title ?? w.kind });
  for (const b of game.bankFails ?? []) if (inWin(b.m)) events.push({ key: `bk:${b.m}:${b.lender}`, m: b.m, kind: "bank seized", name: b.lender });
  for (const r of game.rivals ?? []) {
    if (!inWin(r.failedM)) continue;
    if (r.endReason === "failed") events.push({ key: `rf:${r.id}`, m: r.failedM!, kind: "firm failed", name: r.name });
    else if (r.endReason === "absorbed") events.push({ key: `ra:${r.id}`, m: r.failedM!, kind: "absorbed", name: r.name });
  }
  for (const b of game.builders ?? []) {
    if (b.endReason === "folded" && inWin(b.failedM)) events.push({ key: `bf:${b.id}`, m: b.failedM!, kind: "builder folded", name: b.name });
    if (inWin(b.bornM) && b.bornM > 0) events.push({ key: `bn:${b.id}`, m: b.bornM, kind: "builder founded", name: b.name });
  }
  const yearCols: Col<YearRow>[] = [
    { id: "label", label: "Market", get: (r) => r.label },
    { id: "rent", label: "Eff rent 12m", get: (r) => r.rent, fmt: "pct", tone: (r) => ((r.rent ?? 0) < 0 ? "neg" : undefined) },
    { id: "vac", label: "Vacancy", get: (r) => r.vac, fmt: "pct" },
    { id: "dVac", label: "Δ 12m", get: (r) => r.dVac, fmt: "bp", tone: (r) => ((r.dVac ?? 0) > 50 ? "neg" : undefined) },
    { id: "comp", label: "Delivered", get: (r) => r.comp || null, fmt: "sf" },
    { id: "abs", label: "Taken up", get: (r) => r.abs || null, fmt: "sf", tone: (r) => (r.abs < 0 ? "neg" : undefined) },
  ];
  const eventCols: Col<EventRow>[] = [
    { id: "m", label: "Month", get: (r) => r.m, cell: (r) => mo(r.m), width: 90 },
    { id: "kind", label: "Kind", get: (r) => r.kind },
    { id: "name", label: "Name", get: (r) => r.name },
  ];
  type Pillar = (typeof fc.pillars)[number];
  const pillarCols: Col<Pillar>[] = [
    { id: "label", label: "Pillar", get: (r) => r.label },
    { id: "score", label: "Score", get: (r) => r.score, fmt: "pct" },
    { id: "detail", label: "Detail", get: (r) => r.detail },
  ];
  type MsRow = { id: string; label: string; atM: number | null };
  const msRows: MsRow[] = [...hit, ...(next ? [{ ...next, atM: null }] : [])];
  const msCols: Col<MsRow>[] = [
    { id: "label", label: "Milestone", get: (r) => r.label, cell: (r) => <span className={r.atM === null ? "nx-dim" : undefined}>{r.label}</span> },
    { id: "atM", label: "Month", get: (r) => r.atM, cell: (r) => (r.atM === null ? <span className="nx-dim">next</span> : mo(r.atM)) },
  ];
  return (
    <div className="nx-place">
      <StatStrip>
        <Stat label="Standing"><Figure value={null} fmt="n" text={fc.label} /></Stat>
        <Stat label="Tier"><Figure value={fc.tier} fmt="n" text={`${fc.tier} / 5`} /></Stat>
        <Stat label="Score"><Figure value={fc.score} fmt="pct" /></Stat>
        <Stat label="Milestones"><Figure value={fc.milestonesHit} fmt="n" text={`${fc.milestonesHit} / ${fc.milestonesTotal}`} /></Stat>
        <Stat label="Net worth"><span className="nx-with-spark"><Figure value={nwNow} fmt="usd" drill="nw" /><Spark pts={nw} w={96} /></span></Stat>
        <Stat label={m < 12 ? "Since founding" : "Δ 12m"}><Figure value={dNW} fmt="usd" drill="nw" tone={dNW < 0 ? "neg" : dNW > 0 ? "pos" : undefined} /></Stat>
        <Stat label="Cash in"><Figure value={haveBooks ? cashIn : null} fmt="usd" drill="cash" /></Stat>
        <Stat label="Cash out"><Figure value={haveBooks ? cashOut : null} fmt="usd" drill="cash" /></Stat>
        <Stat label="Deeds on"><Figure value={boughtN} fmt="n" /></Stat>
        <Stat label="Deeds off"><Figure value={soldExits.length} fmt="n" /></Stat>
        {forcedN > 0 && <Stat label="Taken"><Figure value={forcedN} fmt="n" tone="neg" /></Stat>}
        <Stat label="Delivered"><Figure value={sfDelivered || null} fmt="sf" /></Stat>
        {st && <Stat label="Rank"><Figure value={st.rank} fmt="n" text={`${st.rank} / ${st.of}`} drill="rank" /></Stat>}
        <Stat label="Founded"><Figure value={null} fmt="n" text={String(START_YEAR + Math.floor((game.firm?.foundedM ?? 0) / 12))} /></Stat>
      </StatStrip>
      <Chips<RecF>
        chips={[
          { id: "deals", label: "Deals", n: n("deals") },
          { id: "build", label: "Building", n: n("build") },
          { id: "record", label: "Record", n: n("record") },
          { id: "city", label: "City", n: n("city") },
        ]}
        on={f}
        set={setF}
      />
      <DataTable id="city-record" cols={recCols} rows={shown} rowKey={(r) => r.key} initialSort={{ col: "m", dir: -1 }}
        onRow={(r) => sel(r.bbl)} maxHeight={560} />
      {head("Standing")}
      <DataTable id="city-pillars" cols={pillarCols} rows={fc.pillars} rowKey={(r) => r.id} />
      <DataTable id="city-milestones" cols={msCols} rows={msRows} rowKey={(r) => r.id} initialSort={{ col: "atM", dir: -1 }} />
      {yearRows.length > 0 && <>
        {head("Street this year")}
        <DataTable id="city-year" cols={yearCols} rows={yearRows} rowKey={(r) => r.k} />
        <DataTable id="city-year-events" cols={eventCols} rows={events} rowKey={(r) => r.key} initialSort={{ col: "m", dir: -1 }} />
      </>}
    </div>
  );
}
