import { useState } from "react";
import { useMasonry } from "@/ui/useMasonry";
import type { Econ } from "@/engine/types";
import { useStore } from "@/state/store";
import { monthLabel, START_YEAR } from "@/engine/types";
import type { BuiltClass, EconHistoryPoint } from "@/engine/types";
import { capitalRatio, targetCapital } from "@/engine/lenders";
import { NATURAL_VAC, RENT_BASE, SECTOR_LABEL, CITY_STOCK, frictionFloor, housableStock, islandResidents, PEOPLE_PER_HOME, chairStance } from "@/engine/market";
import { submarkets, legVacancy, legRent, legDemand, deliverySchedule, projectVacancy, marketBalance, monthsOfSupply, availability } from "@/engine/space";
import { LineChart, BarChart, Gauge } from "@/ui/Chart";
import { bandTable } from "@/engine/bands";
import { sizeMean } from "@/engine/plates";
import type { BarGroup } from "@/ui/Chart";
import { pctSigned } from "@/ui/format";
import { TheBanks } from "@/ui/panels/BanksDesk";
import { LandValueChart } from "@/ui/panels/MarketPage";
import { creditWord, real, workStage, Row, useDeskView } from "@/ui/panels/shared";
import { Employers, Districts, boardClimate, pendingHearings } from "@/ui/panels/CityStances";

/** The cycle in a sentence. Read by City → Pulse, which leads with it. */
export const PHASE_BLURB: Record<string, string> = {
  expansion: "Demand growing, rents rising, capital available.",
  peak: "Tight pricing, low cap rates, thin margins.",
  recession: "Demand falling, lending tight, prices down.",
  recovery: "Vacancy falling, concessions shrinking.",
  depression: "Oversupply persists, vacancy high.",
};

/** REAL EFFECTIVE RENT, TWELVE MONTHS ON — what a tenant actually pays after
 *  concessions, deflated, against the same a year ago. One function so the
 *  Markets card and the Pulse table cannot disagree about it. */
export function realRentYoy(e: Econ, k: BuiltClass): number {
  const history = e.history ?? [];
  const yearAgo = history.length > 12 ? history[history.length - 13] : undefined;
  const realEffNow = (e.effRentIdx?.[k] ?? e.rentIdx[k]) / Math.max(0.01, e.cpi ?? 1);
  const realEffThen = yearAgo
    ? (yearAgo.effRent?.[k] ?? yearAgo.rent?.[k] ?? e.rentIdx[k]) / Math.max(0.01, yearAgo.cpi ?? 1)
    : realEffNow;
  return realEffNow / Math.max(0.01, realEffThen) - 1;
}

/**
 * THE CITY, SIX CHARTS WIDE — the "general" card's detail view.
 *
 * The stat strips print today's numbers; these are the six city series with
 * their history attached, one per cell, because the level of a demand series
 * is nearly meaningless without the path it took to get there.
 * Wages and output are REAL — already deflated by the price level in the
 * sixth chart — so a flat real wage across a decade of inflation is a city
 * treading water, not one getting richer.
 *
 * `spanYrs` is how much of the record the page's window switch has selected.
 * The heading used to say "the last twenty years" in fixed text, which stopped
 * being true the moment that switch existed.
 */
/**
 * DEFLATE. THE ENGINE KEEPS NOMINAL SERIES AND THIS PAGE WAS PLOTTING THEM RAW.
 *
 * `wageIdx` is nominal — `market.ts` says so in capitals ("WAGES ARE NOMINAL AND
 * THEY TRACK PRICES") and builds it out of `inflExp/12 + productivity/12`.
 * `outputIdx` is `jobs x wageIdx`, so it is nominal city product. Both were
 * drawn here under titles that said "real" and notes that said "inflation is
 * already taken out", and the division was simply never done.
 *
 * That is the third kind of fake number — one quantity with two answers — and
 * it is also the whole of the complaint that the wage chart "looks like a
 * straight line up that never comes down". A NOMINAL wage index cannot come
 * down: downward nominal rigidity is modelled on purpose (market.ts, the
 * wageDebt block), and measured over six seeds x 50 years it fell in 0.00% of
 * twelve-month windows, worst -0.01%. The real wage, the same runs, fell in
 * 15.87% of them, worst -3.64% — about one year in six, against US real average
 * hourly earnings falling roughly one year in five and -2.8% in 2022 alone.
 * Trend real growth is 0.87%/yr (range 0.50-1.09 across seeds), which is the
 * 1.1% productivity centre less labour hoarding and the wage debt worked off
 * after freezes.
 *
 * So the series the player was told they were looking at existed all along.
 */

export function CityEconCharts({ tail, spanYrs }: { tail: EconHistoryPoint[]; spanYrs: number }) {
  // The wage and output indices open at the town's own dollars (`wage0` —
  // density premium x price level, 0.26 on one measured town), not at 1, so
  // "1.00 = year 2000" needs them divided by where they started (2026-10-13).
  const w0 = useStore((s) => s.game?.econ.wage0) ?? 1;
  if (tail.length < 2) return <div className="hint">Not enough history.</div>;
  const x: [string, string] = [monthLabel(tail[0].q), monthLabel(tail[tail.length - 1].q)];
  const kFmt = (v: number) => `${v.toFixed(0)}k`;
  const idxFmt = (v: number) => v.toFixed(2);
  return (
    <>
      <div className="page-section">City economy · {spanYrs} yr{spanYrs === 1 ? "" : "s"}</div>
      <div className="chart-grid">
        <div className="chart-cell">
          <div className="chart-title">Region population</div>
          <LineChart height={108} series={[{ label: "population", color: "#7a5c1e", pts: tail.map((h) => (h.population ?? 0) / 1000) }]} yFmt={kFmt} xLabels={x} xAt={(i) => monthLabel(tail[i]?.q ?? 0)} />
          <div className="chart-note">Region incl. mainland · lags jobs ~1 yr</div>
        </div>
        <div className="chart-cell">
          <div className="chart-title">Jobs</div>
          <LineChart height={108} series={[{ label: "jobs", color: "#2f6f7a", pts: tail.map((h) => (h.jobs ?? 0) / 1000) }]} yFmt={kFmt} xLabels={x} xAt={(i) => monthLabel(tail[i]?.q ?? 0)} />
          <div className="chart-note">Filled positions</div>
        </div>
        <div className="chart-cell">
          <div className="chart-title">Unemployment</div>
          <LineChart height={108} series={[{ label: "unemployment", color: "#a8402e", pts: tail.map((h) => (h.unemployment ?? 0) * 100) }]} yFmt={(v) => `${v.toFixed(1)}%`} xLabels={x} xAt={(i) => monthLabel(tail[i]?.q ?? 0)} />
          <div className="chart-note">Share of labor force · lagging indicator</div>
        </div>
        <div className="chart-cell">
          <div className="chart-title">Real wage · index, 2000 = 1.00</div>
          {/* THE REAL WAGE GETS THIS AXIS TO ITSELF. Drawing the nominal index
              beside it was the obvious way to show the contrast and it does not
              work: nominal reaches 4.5x over a campaign against real's 1.35x, so
              the shared scale flattens the series that matters into a rule along
              the bottom — which is the very "straight line" complaint this chart
              exists to answer. The nominal figure is a Row instead, where a
              number does the job a squashed line cannot: see `CityFigures`
              directly below this grid. That sentence was written when the Row
              did not exist anywhere in the game — the line was dropped for a
              good reason and the number that was meant to replace it was never
              written — and it is true now. */}
          <LineChart height={108} series={[{ label: "real wage", color: "#3a7d46", pts: tail.map((h) => real((h.wageIdx ?? w0) / w0, h.cpi)) }]} yFmt={idxFmt} xLabels={x} xAt={(i) => monthLabel(tail[i]?.q ?? 0)} />
          <div className="chart-note">Inflation-adjusted · drives retail and multifamily rents</div>
        </div>
        <div className="chart-cell">
          <div className="chart-title">Real output · index, 2000 = 1.00</div>
          <LineChart height={108} series={[{ label: "real output", color: "#3d6f9e", pts: tail.map((h) => real((h.outputIdx ?? w0) / w0, h.cpi)) }]} yFmt={idxFmt} xLabels={x} xAt={(i) => monthLabel(tail[i]?.q ?? 0)} />
          <div className="chart-note">Jobs × productivity, real</div>
        </div>
        <div className="chart-cell">
          <div className="chart-title">Price level · index, 2000 = 1.00</div>
          <LineChart height={108} series={[{ label: "price level", color: "#8a5620", pts: tail.map((h) => h.cpi ?? 1) }]} yFmt={idxFmt} xLabels={x} xAt={(i) => monthLabel(tail[i]?.q ?? 0)} />
          <div className="chart-note">Cumulative inflation · deflator for real series</div>
        </div>
      </div>
      <CityFigures />
      <CentralBankBox />
    </>
  );
}

/**
 * THE CITY'S NUMBERS, WHICH A CHART CANNOT GIVE YOU.
 *
 * These eight rows used to be printed under the land chart on Research. When
 * Land moved onto the Economy page the two population/jobs charts above it came
 * with it — they are the six cells in `CityEconCharts` — and the eight ROWS were
 * deleted with the section rather than moved. Nothing asked for that, and it
 * took real information out of the game: a chart says which way and how fast,
 * and it cannot say how many people are in the town or what the price level has
 * done since the year 2000 — and those are the figures a person quotes.
 *
 * The nominal wage is the sharpest case, because the comment on the real-wage
 * chart above ASSERTS that it is "a Row on the Economy page instead, where a
 * number does the job a squashed line cannot." It was not. It was nowhere in
 * the game at all — the chart dropped the line for a good reason, and the Row
 * that was supposed to catch it never got written. That prose is now true.
 *
 * Levels, not deltas, except where a level says nothing: "jobs added this year"
 * is the one figure on this list that only exists as a change, and it is the
 * first thing anybody underwriting a market looks up.
 */
export function CityFigures() {
  const game = useStore((s) => s.game)!;
  const e = game.econ;
  const h = e.history ?? [];
  const n = h.length;
  // Twelve months back, on the same series the chart above draws — not a
  // separate estimate of the same growth rate.
  const jobsYr = n > 12 && h[n - 13].jobs ? (h[n - 1].jobs! / h[n - 13].jobs! - 1) * 100 : 0;
  // THE WAGE AGAINST ITS OWN YEAR AND AGAINST THE COUNTRY (2026-10-13).
  // Same series as the chart: the year-on-year change in what pay buys; then
  // pay against the national pay path — what employers compare when they
  // decide where to hire (`wageDemand`) — as a LEVEL, because the town opened
  // at its density premium (`wage0`) over the national reference and the
  // national path is carried in the town's own units from there; and real pay
  // against real national pay — what movers compare (`realPremEma`) — as a
  // change since the opening only, because the engine does not record the
  // town's opening cost of living against the nation (cpi and natCpi both
  // open at 1), so a level would be a guess.
  // Every wage figure below is read against the opening (`wage0`), which is in
  // the town's own dollars; the rows used to compare against 1.0 and printed
  // "-74% against the year 2000" on a town whose real pay had grown.
  const w0 = e.wage0 ?? 1;
  const realYr = n > 12 && h[n - 13].wageIdx && h[n - 13].cpi
    ? (real(h[n - 1].wageIdx, h[n - 1].cpi) / real(h[n - 13].wageIdx, h[n - 13].cpi) - 1) * 100 : 0;
  const natW = e.natWageIdx ?? e.wageIdx ?? 1;
  // The opening premium over national pay is wage0 net of the town's price
  // level (density and dearness — what a dense, dear town pays above the
  // reference); the national path then carries it forward in this town's units.
  const payVsNation = (w0 / Math.max(1e-6, e.priceLevel ?? 1) * (e.wageIdx ?? w0) / Math.max(1e-6, natW) - 1) * 100;
  const realVsNationChg = (real(e.wageIdx, e.cpi) / Math.max(1e-6, real(natW, e.natCpi)) - 1) * 100;
  // ...and as a LEVEL where the save carries the opening cost of living
  // against the nation (`col0`, struck at the opening with the CPI's own
  // weights): cost of living today = col0 x local prices / national prices,
  // and real pay against the nation = pay against the nation / that.
  const col = e.col0 !== undefined ? e.col0 * (e.cpi ?? 1) / Math.max(1e-6, e.natCpi ?? e.cpi ?? 1) : undefined;
  const realVsNation = col !== undefined ? ((1 + payVsNation / 100) / col - 1) * 100 : undefined;
  return (
    <>
      <div className="page-section" style={{ marginTop: 14 }}>City today</div>
      <div className="grid">
        <Row k="Region population" v={(e.population ?? 0).toLocaleString()} strong
          title="Island and mainland" />
        {(() => { const isl = islandResidents(e); return (<>
          <Row k="Island residents" v={`${isl.residents.toLocaleString()} (${((isl.residents / Math.max(1, e.population ?? 1)) * 100).toFixed(0)}%)`}
            title={`~${isl.homes.toLocaleString()} occupied homes × ${PEOPLE_PER_HOME}`} />
          <Row k="Commuters" v={isl.commuters.toLocaleString()} title="Island jobs held by mainland residents" />
        </>); })()}
        <Row k="Jobs" v={(e.jobs ?? 0).toLocaleString()} />
        <Row k="Job growth, 12 mo" v={`${jobsYr >= 0 ? "+" : ""}${jobsYr.toFixed(1)}%`} bad={jobsYr < 0} strong />
        {/* The 8.5% flag is the one these rows carried before they were
            deleted, kept rather than re-picked: `initEcon` opens the city at
            5.2% and `tickEcon` falls back to 5.5% wherever the field is
            missing, so eight and a half is about three points of slack above
            where this town sits when nothing is wrong. */}
        <Row k="Unemployment" v={`${((e.unemployment ?? 0) * 100).toFixed(1)}%`} bad={(e.unemployment ?? 0) > 0.085} />
        <Row k="Real wage" v={`${((real((e.wageIdx ?? w0) / w0, e.cpi) - 1) * 100).toFixed(0)}% vs 2000`} />
        {/* THE ROW THE CHART ABOVE PROMISED. Its own note records why the line
            was dropped — nominal measured at 4.5x over a campaign against
            real's 1.35x, so a shared axis flattens the series that matters —
            and that is exactly why the figure has to be said SOMEWHERE, or the
            player has no way to see the gap between what they are paid and
            what it buys. */}
        <Row k="Nominal wage" v={`${(((e.wageIdx ?? w0) / w0 - 1) * 100).toFixed(0)}% vs 2000`} />
        <Row k="Real wage, 12 mo" v={pctSigned(realYr / 100, 1)} bad={realYr < 0}
          title="Year-on-year, inflation-adjusted" />
        <Row k="Pay vs national" v={`${payVsNation >= 0 ? "+" : ""}${payVsNation.toFixed(0)}%`}
          title="Local pay vs national average · higher pay reduces hiring" />
        {col !== undefined && (
          <Row k="Cost of living vs national" v={`${col >= 1 ? "+" : ""}${((col - 1) * 100).toFixed(0)}%`}
            title="Local CPI basket vs national" />
        )}
        {realVsNation !== undefined ? (
          <Row k="Real pay vs national" v={`${realVsNation >= 0 ? "+" : ""}${realVsNation.toFixed(0)}% (${realVsNationChg >= 0 ? "+" : ""}${realVsNationChg.toFixed(0)} pts since 2000)`}
            bad={realVsNation < 0}
            title="Pay after cost of living vs national · drives migration" />
        ) : (
          <Row k="Real pay vs national" v={`${realVsNationChg >= 0 ? "+" : ""}${realVsNationChg.toFixed(0)}% since 2000`}
            title="Change since 2000 only (older save)" />
        )}
        <Row k="Real output" v={`${((real((e.outputIdx ?? w0) / w0, e.cpi) - 1) * 100).toFixed(0)}% vs 2000`} />
        <Row k="Price level" v={`+${(((e.cpi ?? 1) - 1) * 100).toFixed(0)}% since 2000`} />
      </div>
    </>
  );
}

/**
 * THE CENTRAL BANK, at a glance: who is in the chair and how the market reads
 * them, where policy sits against what the rule asks, and whether the public
 * believes the target. A chair change is also announced in the news.
 */
export function CentralBankBox() {
  const game = useStore((s) => s.game)!;
  const n = game.econ.nat;
  if (!n) return null;
  const pct = (x: number | undefined, d = 1) => `${((x ?? 0) * 100).toFixed(d)}%`;
  const chair = n.chair;
  const stance = chair ? chairStance(chair.resolve) : "centrist";
  const yr = (m: number) => 2000 + Math.floor(m / 12);
  const cred = n.credibility ?? 0.8;
  const credLabel = cred > 0.8 ? "believed" : cred > 0.5 ? "doubted" : "lost";
  return (
    <details className="page-section" style={{ marginTop: 14 }}>
      <summary style={{ cursor: "pointer" }}>
        Central bank · {chair?.name ?? "chair"} ({stance}) · policy {(n.policy ?? 0).toFixed(2)}% · inflation {pct(n.infl)}
      </summary>
      <div className="grid">
        <Row k="Chair" v={`${chair?.name ?? "—"}${chair?.sinceM !== undefined ? `, since ${yr(chair.sinceM)}` : ""}`} strong
          title="Terms 4-12 years" />
        <Row k="Stance" v={stance === "hawk" ? "Hawk · inflation first" : stance === "dove" ? "Dove · growth first" : "Centrist"} />
        {chair && <Row k="Term ends" v={`${yr(chair.untilM)}`} />}
        <Row k="Policy rate" v={`${(n.policy ?? 0).toFixed(2)}%`} strong />
        <Row k="Rule rate" v={`${(n.ruleRate ?? n.policy ?? 0).toFixed(2)}%`}
          title="Target from reaction function · reached in steps" />
        <Row k="Inflation target" v={pct(n.inflTarget ?? 0.02)} />
        <Row k="Inflation, national" v={pct(n.infl)} bad={(n.infl ?? 0) > 0.04} />
        <Row k="Inflation expectations" v={pct(n.inflExp)} />
        <Row k="Credibility" v={`${Math.round(cred * 100)} · ${credLabel}`} bad={cred <= 0.5}
          title="Low credibility: expectations follow past inflation" />
      </div>
    </details>
  );
}

/**
 * THE ECONOMY, WHOLE.
 *
 * Everything outside your buildings, on one page, arranged the way a market
 * report is: the cycle at the top, then — for each asset class — the four
 * questions that decide whether to buy, hold, or build.
 *
 *   How tight is it?      vacancy against its natural rate
 *   Which way is it going? rents and vacancy over the last twenty years, or
 *                          over the whole run — one switch, every chart
 *   What is coming?        the construction pipeline, by the year it lands
 *   Where does it end up?  vacancy projected forward if nobody else starts
 *
 * And below that, the same question asked of each NEIGHBOURHOOD, because
 * "office vacancy is 12%" is not a decision and "the Exchange is at 6% and
 * Millside is at 21%" is.
 */

const STOCK_CLASSES: BuiltClass[] = ["office", "retail", "multifamily", "industrial"];
const STOCK_COLOR: Record<BuiltClass, string> = {
  office: "#3d6f9e", retail: "#a8562e", multifamily: "#4a7d5a", industrial: "#7a6a45",
};

function sfShort(v: number) {
  const a = Math.abs(v);
  return a >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : a >= 1e4 ? `${Math.round(v / 1e3)}k` : a >= 1 ? `${Math.round(v / 100) / 10}k` : "0";
}

/**
 * Standing inventory vs space leased, walked from the live month-end back
 * through the tape. Points stamped after this field existed use the recorded
 * stocks; older points reconstruct occupied from vacancy and walk stock back
 * by that month's completions (demolitions are not on the tape, so a teardown
 * will overstate earlier inventory — new games carry the real stocks).
 */
function standingVsLeased(
  tail: EconHistoryPoint[],
  k: BuiltClass,
  liveStock: number,
): { stock: number[]; leased: number[] } {
  const stock: number[] = new Array(tail.length);
  const leased: number[] = new Array(tail.length);
  let stk = liveStock;
  for (let i = tail.length - 1; i >= 0; i--) {
    const h = tail[i];
    if (h.stock?.[k] != null) stk = h.stock[k]!;
    stock[i] = stk;
    leased[i] = h.occupied?.[k] != null
      ? h.occupied[k]!
      : Math.max(0, Math.round(stk * (1 - (h.vac?.[k] ?? 0))));
    stk = Math.max(0, stk - (h.comp?.[k] ?? 0));
  }
  return { stock, leased };
}

function StockVsLeased({ tail, live, xFrom, xTo, spanYrs }: {
  tail: EconHistoryPoint[];
  live: { stock?: Partial<Record<BuiltClass, number>>; occupied?: Partial<Record<BuiltClass, number>> };
  xFrom: string;
  xTo: string;
  spanYrs: number;
}) {
  if (tail.length < 2) return null;
  const xl: [string, string] = [xFrom, xTo];
  return (
    <>
      <div className="page-section">Stock vs leased · {spanYrs} yr{spanYrs === 1 ? "" : "s"}</div>
      <div className="hint">Solid: total stock · dashed: leased · gap: vacancy</div>
      <div className="chart-grid">
        {STOCK_CLASSES.map((k) => {
          const liveStk = live.stock?.[k] ?? tail[tail.length - 1]?.stock?.[k] ?? 0;
          const { stock, leased } = standingVsLeased(tail, k, liveStk);
          return (
            <div className="chart-cell" key={k}>
              <div className="chart-title">{SECTOR_LABEL[k]} · stock vs leased</div>
              <LineChart
                height={108}
                series={[
                  { label: "stock", color: STOCK_COLOR[k], pts: stock },
                  { label: "leased", color: "#7d8a96", pts: leased, dashed: true },
                ]}
                yFmt={sfShort}
                zeroBase
                xLabels={xl}
                xAt={(i) => monthLabel(tail[i]?.q ?? 0)}
              />
              <div className="chart-note">
                {sfShort(stock[stock.length - 1] ?? 0)} standing · {sfShort(leased[leased.length - 1] ?? 0)} leased
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

const CLASSES_ALL = ["office", "retail", "multifamily", "industrial"] as const;
type Stance = BuiltClass | "general" | "land" | "banks" | "employers" | "districts";
const STANCES: readonly Stance[] = ["general", ...CLASSES_ALL, "land", "banks", "employers", "districts"];

/**
 * THE REST OF THE STAT STRIP, WITH ITS HISTORY. The credit window, employment,
 * build costs and land index were printed as today's number only, though
 * recordHistory has been writing every one of them monthly. Each chart is
 * drawn on the strip's own scale (x100, or % for the window), so the number in
 * the tile is the last point on the line. creditIdx, employIdx and costIdx are
 * optional on old saves, so each series starts at its first recorded month
 * instead of drawing a fake level before it existed.
 */
function MacroCharts({ hist }: { hist: EconHistoryPoint[] }) {
  const cell = (
    title: string,
    color: string,
    get: (p: EconHistoryPoint) => number | undefined,
    note: string,
    fmt: (v: number) => string = (v) => v.toFixed(0),
    bands: { at: number; label?: string }[] = [],
  ) => {
    const start = hist.findIndex((p) => get(p) !== undefined);
    const pts = start < 0 ? [] : hist.slice(start);
    return (
      <div className="chart-cell">
        <div className="chart-title">{title}</div>
        {pts.length < 2 ? (
          <div className="hint">Not enough history.</div>
        ) : (
          <LineChart
            height={108}
            series={[{ label: title, color, pts: pts.map((p) => (get(p) ?? 0) * 100) }]}
            bands={bands}
            yFmt={fmt}
            xLabels={[monthLabel(pts[0].q), monthLabel(pts[pts.length - 1].q)]}
            xAt={(i) => monthLabel(pts[i]?.q ?? 0)}
          />
        )}
        <div className="chart-note">{note}</div>
      </div>
    );
  };
  return (
    <div className="chart-grid">
      {cell("Credit window", "#5a4f8a", (p) => p.creditIdx,
        "Lender appetite · below 70%: fewer quotes, lower proceeds, wider spreads",
        (v) => `${v.toFixed(0)}%`, [{ at: 70, label: "tight" }])}
      {cell("Employment", "#2f6f7a", (p) => p.employIdx,
        "Labor demand, start = 100 · drives leasing with a lag")}
      {cell("Build costs", "#8a5620", (p) => p.costIdx,
        "Construction and operating cost index")}
      {cell("Land index", "#7a5c1e", (p) => p.landIdx,
        "Land value index")}
    </div>
  );
}

export function EconomyPage() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const bbls = useStore((s) => s.bbls);
  const e = game.econ;
  const hist = e.history ?? [];
  // A fifth stance joins the four classes: "general" swaps the class detail
  // for the city itself — the six series every rent in the game is downstream
  // of. It lands first because the class cards only make sense against it.
  //
  // LAND AND THE BANKS ARE THE SIXTH AND SEVENTH, and they arrived here from
  // Research by request. They were never research: research is the view you
  // form before you shop, and these two are the market picture itself. Land is
  // the input to every appraisal and every development budget on this page —
  // reading the rent cycle on one screen and the land cycle on another is how
  // you come to believe a site pencils. The banks are the other half of a cap
  // rate: what a building is worth is what somebody can borrow against it, and
  // the credit-window stat at the top of this page is a single number derived
  // from those five balance sheets. Both are stances of the same page now, one
  // on screen at a time, exactly like the four classes.
  //
  // EMPLOYERS AND DISTRICTS ARE THE EIGHTH AND NINTH, from the old Research
  // page's Trades and Districts tabs: the industries that fill the space and
  // the envelope the board lets out or pulls in. Same reasoning — read beside
  // the rent and vacancy they move, not a desk away. The stance can be asked
  // for from outside (Pulse's rows, its Employers and Board cards).
  const [sel, setSel] = useDeskView<Stance>("economy", "general", STANCES);
  // The class charts are of very different heights (a chart plus three
  // paragraphs beside a chart and a line), and a plain two-column grid left a
  // screen of blank beside the tall ones. Masonry drops each into whichever
  // column frees up first — see ui/useMasonry.
  const masonry = useMasonry();
  const isClass = (CLASSES_ALL as readonly string[]).includes(sel);
  // Every per-class computation below still wants a concrete class, and the
  // cheapest way to keep the non-class stances from breaking marketBalance(e,
  // focus) and its neighbours is to let them run against office while another
  // grid is up — nothing they produce is rendered then.
  const focus: BuiltClass = isClass ? (sel as BuiltClass) : "office";
  const CLASSES: BuiltClass[] = ["office", "retail", "multifamily", "industrial"];
  const COLOR: Record<BuiltClass, string> = {
    office: "#3d6f9e", retail: "#a8562e", multifamily: "#4a7d5a", industrial: "#7a6a45",
  };

  const bal = marketBalance(e, focus);
  // Availability is the vacancy the rest of this page already uses for
  // balance, months-of-supply and the projection. Direct cityVac is the
  // landlord empty-floor rate and sits on its frictional clamp for years
  // in a shortage — plotting that is how each class looked like a ruler
  // for twenty years while the market (sublet + empty) was the one that
  // moved, or failed to.
  const directNow = e.cityVac?.[focus] ?? NATURAL_VAC[focus];
  const vacNow = availability(e, focus);
  const stock = e.stock?.[focus] ?? CITY_STOCK[focus];
  const mos = monthsOfSupply(e, focus);
  const sched = deliverySchedule(e, game.month, 4)[focus];
  const proj = projectVacancy(e, focus, game.month, 36);
  const subs = submarkets(game, parcels, bbls);
  // The map's fly-to action, under a name that does not collide with the
  // class this page is focused on.
  const flyTo = useStore((s) => s.focus);

  // THE AUTHORITATIVE QUEUE. deliveryQueue is one row per physical project —
  // player, rival, city, reuse. Cohorts/pipeline are derived views. Walk the
  // queue so the table cannot disagree with what vacancy will receive.
  const pipeJobs = (() => {
    const rows: { bbl: string; who: string; sf: number; floors: number; deliverM: number; stalled?: boolean; mixed?: boolean }[] = [];
    for (const p of e.deliveryQueue ?? []) {
      if (!p.bbl || p.deliverM - game.month >= 24) continue;
      const csf = Math.round(p.sfByUse[focus] ?? 0);
      if (csf <= 0) continue;
      const d = game.developments[p.bbl];
      const j = (game.cityJobs ?? []).find((x) => x.bbl === p.bbl);
      const who = p.source === "player" || p.source === "reuse" ? "You"
        : j?.firmId ? (game.rivals.find((r) => r.id === j.firmId)?.name ?? "A competitor")
        : p.source === "rival" ? "A competitor"
        : (j?.builderId && (game.builders ?? []).find((b) => b.id === j.builderId)?.name) || "A local developer";
      const floors = d?.floors ?? j?.floors ?? 0;
      const legs = Object.values(p.sfByUse).filter((v) => (v ?? 0) > 0).length;
      rows.push({
        bbl: p.bbl,
        who,
        sf: csf,
        floors,
        deliverM: p.deliverM,
        stalled: p.status === "stalled" || !!j?.orphaned,
        mixed: legs > 1,
      });
    }
    return rows.sort((a, b) => b.sf - a.sf);
  })();
  const pipeJobsSf = pipeJobs.reduce((a, r) => a + r.sf, 0);

  // HOW MUCH OF THE RECORD THIS PAGE IS LOOKING AT.
  //
  // Twenty years was the only window there was, and twenty years is one and a
  // half cycles — long enough to see the last glut and too short to see
  // whether it was the biggest one. The owner asked for the whole run on the
  // vacancy chart.
  //
  // The switch drives EVERY chart on the page that reads `tail`, not just
  // vacancy, and that is deliberate: rent/cap, absorbed/delivered, the
  // concession gap and the six city series are all fed by this one array and
  // all sit inside one scroll. Moving one of them to a fifty-year axis while
  // its neighbour stays on a twenty-year one invites reading a level off one
  // chart and a date off the other, which is the specific mistake the page
  // exists to prevent. `flowYears` is untouched — it is explicitly the last
  // eight years of annual bars and slices `hist` itself.
  //
  // "All" really is all: recordHistory stamps one point a month and trims at
  // 1260 (105 years), so nothing a run of this game can produce hits the cap.
  const SPAN_M = 240;
  const [span, setSpan] = useState<"20y" | "all">("20y");
  const tail = span === "all" ? hist : hist.slice(-SPAN_M);
  // Every x-axis on the page was computed as `game.month - <some length>`,
  // which was right only while the window was exactly 240 long. The first
  // point carries its own month; use it, and the labels follow the switch.
  const xFrom = `${START_YEAR + Math.floor((tail[0]?.q ?? game.month) / 12)}`;
  const xTo = `${START_YEAR + Math.floor(game.month / 12)}`;
  const spanYrs = Math.max(1, Math.round(((tail[tail.length - 1]?.q ?? game.month) - (tail[0]?.q ?? game.month)) / 12));
  const vacSeries = tail.map((h) => (h.avail?.[focus] ?? h.vac?.[focus] ?? NATURAL_VAC[focus]) * 100);
  const directSeries = tail.map((h) => (h.vac?.[focus] ?? NATURAL_VAC[focus]) * 100);
  const rentSeries = tail.map((h) => h.rent?.[focus] ?? e.rentIdx[focus]);
  // pre-v30 history has no effective series; fall back to asking so the two
  // lines simply overlap until the concession machinery has lived a month
  const effSeries = tail.map((h) => h.effRent?.[focus] ?? h.rent?.[focus] ?? e.rentIdx[focus]);
  const capSeries = tail.map((h) => h.cap?.[focus] ?? e.capRate[focus]);
  // the past twenty years of vacancy, then the next three of projection, on
  // one axis — the join is where the pipeline takes over from the record
  const vacWithProj = [...vacSeries, ...proj.map((v) => v * 100)];

  // annual flows: completions against net absorption, last eight years
  const flowYears: BarGroup[] = (() => {
    const byYear = new Map<number, { abs: number; comp: number }>();
    for (const h of hist) {
      const yr = Math.floor(h.q / 12);
      const cur = byYear.get(yr) ?? { abs: 0, comp: 0 };
      cur.abs += h.abs?.[focus] ?? 0;
      cur.comp += h.comp?.[focus] ?? 0;
      byYear.set(yr, cur);
    }
    return [...byYear.entries()].slice(-8).map(([yr, v]) => ({
      label: String((START_YEAR + yr) % 100).padStart(2, "0"),
      bars: [{ v: v.abs, color: "#4a7d5a" }, { v: -v.comp, color: "#a8562e" }],
    }));
  })();

  const pipeGroups: BarGroup[] = sched.map((sf, i) => ({
    label: i === 0 ? "next 12m" : `yr ${i + 1}`,
    bars: [{ v: sf, color: COLOR[focus] }],
  }));

  // THE WINDOW SWITCH, and it only exists when it can do something.
  // Below month 240 the whole record IS the last twenty years, and a
  // control that redraws the identical chart is worse than no control —
  // it teaches the player that the button does nothing. It is drawn twice,
  // over the money charts at the top and over the market charts below, and
  // both copies drive the one `span`: the reader should not have to scroll
  // past the space market to find the control for the chart they are on.
  const spanSwitch = (lead: string) => hist.length > SPAN_M && (
    <div className="btn-row" style={{ marginTop: 10, alignItems: "baseline" }}>
      <span className="hint" style={{ marginRight: 4 }}>{lead}</span>
      <button className={"btn" + (span === "20y" ? " btn-on" : "")} onClick={() => setSpan("20y")}
        title="Last 20 years">
        20 yrs
      </button>
      <button className={"btn" + (span === "all" ? " btn-on" : "")} onClick={() => setSpan("all")}
        title="Full history">
        all {Math.round((hist.length - 1) / 12)} yrs
      </button>
    </div>
  );

  const pctFmt = (v: number) => `${v.toFixed(1)}%`;
  // square feet at whatever magnitude the data actually is — a 40,000 sf
  // pipeline printed as "0.0M" four times is not a chart, it is a blank
  const sfFmt = (v: number) => {
    const a = Math.abs(v);
    return a >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : a >= 1e4 ? `${Math.round(v / 1e3)}k` : a >= 1 ? `${Math.round(v / 100) / 10}k` : "0";
  };

  const rateChart = (
    <>
      {/* THE RATE, WITH ITS HISTORY. Asked for twice. The series was already
          being written — every EconHistoryPoint carries indexRate, and
          recordHistory has been stamping one a month since month zero — and
          nothing had ever drawn it. A single number tells you what money costs
          today; the line tells you whether you are early or late, which is the
          whole fix-or-float decision and most of the refinancing one.
          The long-run rate is drawn alongside because the gap between them is
          the thing to read: the cycle moves the index a point or two, the era
          decides whether it is orbiting 3% or 13%. */}
      {hist.length > 8 && (
        <div className="page-section" style={{ marginTop: 12 }}>
          <div className="page-section-head">Rates</div>
          {spanSwitch("Range")}
          <LineChart
            height={132}
            series={[
              { label: "Base rate %", color: "#8a4b2a", pts: tail.map((p) => p.indexRate) },
              ...(tail.some((p) => p.rateRegime !== undefined)
                ? [{ label: "Long-run rate %", color: "#8b8370", dashed: true,
                     pts: tail.map((p) => p.rateRegime ?? p.indexRate) }]
                : []),
            ]}
            yFmt={(v) => v.toFixed(1) + "%"}
            xLabels={[monthLabel(tail[0].q), monthLabel(tail[tail.length - 1].q)]}
            xAt={(i) => monthLabel(tail[i]?.q ?? 0)}
          />
          <div className="hint">Solid: base rate (loans price off it) · dashed: long-run rate</div>
          <MacroCharts hist={tail} />
        </div>
      )}

    </>
  );

  return (
    <div>
      {/* The headline strip — cycle, base rate, credit, costs, land — moved to
          City → Pulse, which is the one-screen read. This page is the depth
          behind it: pick a market, read it. */}
      {/* ---- the four markets, at a glance ---- */}
      <div className="page-section">Space market</div>
      <div className="mkt-cards">
        {/* The pseudo-card. No gauge, because the city has no natural rate to
            sit against — its numbers are the level everything else is read
            off. Clicking it swaps the class detail below for six city charts. */}
        <button
          className={"mkt-card" + (sel === "general" ? " mkt-card-on" : "")}
          onClick={() => setSel("general")}
        >
          <div className="mkt-card-head">
            <span className="mkt-card-name">City</span>
            <span className="mono">{((e.population ?? 0) / 1000).toFixed(0)}k</span>
          </div>
          <div className="mkt-card-state">population</div>
          <div className="mkt-card-sub mono">
            {((e.jobs ?? 0) / 1000).toFixed(0)}k jobs · {((e.unemployment ?? 0) * 100).toFixed(1)}% unemployment
          </div>
        </button>
        {CLASSES.map((k) => {
          const b = marketBalance(e, k);
          const v = availability(e, k);
          const rentYoy = realRentYoy(e, k);
          const rentWord = rentYoy > 0.025 ? "rising"
            : rentYoy < -0.025 ? "falling"
              : "flat";
          // The stock has always been the denominator under the pipeline
          // percentage on this card and the card never printed it, which made
          // the four classes unreadable against each other: a 6% pipeline on
          // 40M sf of office and the same 6% on 4M sf of industrial are not
          // the same fact about the city.
          const stockSf = e.stock?.[k] ?? CITY_STOCK[k];
          const pipe = (e.pipeline?.[k] ?? 0) / stockSf;
          return (
            <button
              key={k}
              className={"mkt-card" + (sel === k ? " mkt-card-on" : "")}
              onClick={() => setSel(k)}
            >
              <div className="mkt-card-head">
                <span className="mkt-card-name">{SECTOR_LABEL[k]}</span>
                <span className="mono">{(v * 100).toFixed(1)}%</span>
              </div>
              <Gauge value={v} natural={NATURAL_VAC[k]} lo={0} hi={0.28} fmt={(x) => `${(x * 100).toFixed(1)}%`} />
              <div className="mkt-card-state">{b.state}</div>
              <div className={"mkt-card-sub" + (rentYoy < -0.025 ? " neg" : "")}>
                effective rents {rentWord} · {pctSigned(rentYoy)} real / 12m
              </div>
              {/* Each class runs its own cycle now, and which part of it you
                  are standing in is the single most useful thing on this card:
                  the same vacancy means opposite things on the way up and on
                  the way down. */}
              {e.sectorPhase?.[k] && e.sectorPhase[k] !== "steady" && (
                <div className={"mkt-card-sub" + (e.sectorPhase[k] === "bust" ? " neg" : "")}>
                  tenants {e.sectorPhase[k] === "boom" ? "expanding" : "contracting"}
                </div>
              )}
              <div className="mkt-card-sub mono">
                ${e.rentIdx[k].toFixed(0)}/sf · {e.capRate[k].toFixed(2)}% cap · {sfFmt(stockSf)} sf · pipeline {(pipe * 100).toFixed(1)}%
              </div>
              {e.rentWhy?.[k] && (
                <div className="mkt-card-sub" title={e.rentWhy[k]}>
                  {e.rentWhy[k]}
                </div>
              )}
            </button>
          );
        })}
      </div>
      <div className="mkt-cards mkt-cards-aux">
        {/* THE TWO MARKETS THAT ARE NOT SPACE MARKETS, on the same rail as the
            four that are — because they are read the same way and at the same
            moment. Land has no vacancy and no natural rate to gauge against;
            the twelve-month move is its state. The banks have no rent; the
            credit window IS their state, and it is the multiplier on the next
            advance rate anybody in this town gets quoted. */}
        {(() => {
          const h = e.history ?? [];
          const yoy = h.length > 12 ? e.landIdx / h[h.length - 13].landIdx - 1 : 0;
          // DESKS THAT STILL QUOTE. A lender in receivership carries a capital
          // ratio that has already gone through the floor — measured, one sat
          // at −47% of book — and it is not a warning about anything, because
          // nothing new is ever written there again. The number worth putting
          // on a card is how close the WEAKEST LIVE desk is to the same fate.
          const banks = (game.lenders ?? []).filter((l) => l.failedM === undefined);
          const failed = (game.lenders ?? []).length - banks.length;
          const worst = banks.length
            ? banks.reduce((a, l) => Math.min(a, capitalRatio(l) / targetCapital(l.name)), Infinity) : 0;
          return (
            <>
              <button className={"mkt-card" + (sel === "land" ? " mkt-card-on" : "")} onClick={() => setSel("land")}>
                <div className="mkt-card-head">
                  <span className="mkt-card-name">Land</span>
                  <span className="mono">{(e.landIdx * 100).toFixed(0)}</span>
                </div>
                <div className={"mkt-card-state" + (yoy < -0.02 ? " neg" : "")}>
                  {yoy > 0.06 ? "rising fast" : yoy > 0.015 ? "rising" : yoy < -0.06 ? "falling fast"
                    : yoy < -0.015 ? "easing" : "flat"}
                </div>
                <div className="mkt-card-sub mono">
                  {pctSigned(yoy)} / 12m
                </div>
              </button>
              {/* The card exists while there is a lending market to read at
                  all — including a street where every desk has been seized,
                  which is the single most important thing the page could be
                  telling you. Only the "weakest" figure skips the dead ones. */}
              {(game.lenders ?? []).length > 0 && (
                <button className={"mkt-card" + (sel === "banks" ? " mkt-card-on" : "")} onClick={() => setSel("banks")}>
                  <div className="mkt-card-head">
                    <span className="mkt-card-name">Banks</span>
                    <span className="mono">{Math.round(e.creditIdx * 100)}%</span>
                  </div>
                  <div className={"mkt-card-state" + (e.creditIdx < 0.72 ? " neg" : "")}>
                    credit {creditWord(e.creditIdx ?? 1)}
                  </div>
                  <div className="mkt-card-sub mono">
                    {banks.length} lender{banks.length === 1 ? "" : "s"} active
                    {failed ? ` · ${failed} failed` : ""}
                    {banks.length ? ` · weakest ${worst.toFixed(2)}× capital target` : " · none lending"}
                  </div>
                </button>
              )}
              {/* THE TRADES and THE BOARD — what fills the space, and how much
                  of it the city will let anyone build. */}
              {(() => {
                const ph = game.econ.industryPhase ?? {};
                const booms = Object.values(ph).filter((p) => p === "boom").length;
                const busts = Object.values(ph).filter((p) => p === "bust").length;
                return (
                  <button className={"mkt-card" + (sel === "employers" ? " mkt-card-on" : "")} onClick={() => setSel("employers")}>
                    <div className="mkt-card-head">
                      <span className="mkt-card-name">Employers</span>
                      <span className="mono">{booms}↑ {busts}↓</span>
                    </div>
                    <div className={"mkt-card-state" + (busts > booms ? " neg" : "")}>
                      {busts > booms ? "contracting" : booms > busts ? "hiring" : "steady"}
                    </div>
                    <div className="mkt-card-sub mono">{booms} hiring · {busts} contracting</div>
                  </button>
                );
              })()}
              {(() => {
                const { up, down } = boardClimate(game);
                const filed = pendingHearings(game).length;
                return (
                  <button className={"mkt-card" + (sel === "districts" ? " mkt-card-on" : "")} onClick={() => setSel("districts")}>
                    <div className="mkt-card-head">
                      <span className="mkt-card-name">Districts</span>
                      <span className="mono">{up}↑ {down}↓</span>
                    </div>
                    <div className={"mkt-card-state" + (down > up ? " neg" : "")}>
                      {up + down === 0 ? "no rezonings" : up > down ? "net upzoning" : up < down ? "net downzoning" : "mixed"}
                    </div>
                    <div className="mkt-card-sub mono">rezonings · 5 yrs{filed ? ` · ${filed} of yours pending` : ""}</div>
                  </button>
                );
              })()}
            </>
          );
        })()}
      </div>

      {(sel === "general" || isClass) && spanSwitch("Range")}

      {/* ---- the general view: the city's six series, or one class in depth ---- */}
      {/* The four stock-vs-leased charts are the city's view: all four
          markets side by side belong under The city, not repeated under each
          class's own card (the owner's call, 2026-10-15). */}
      {sel === "general" && (
        <StockVsLeased tail={tail} live={e} xFrom={xFrom} xTo={xTo} spanYrs={spanYrs} />
      )}
      {sel === "general" && <>{rateChart}<CityEconCharts tail={tail} spanYrs={spanYrs} /></>}
      {sel === "land" && <LandValueChart />}
      {sel === "banks" && <>{rateChart}<TheBanks /></>}
      {sel === "employers" && <Employers />}
      {sel === "districts" && <Districts />}
      {isClass && <>
      <div className="page-section">{SECTOR_LABEL[focus]} · {bal.state}</div>
      <div className="hint">{bal.note}</div>
      <div className="grid" style={{ marginTop: 6 }}>
        <Row k="Inventory" v={`${(stock / 1e6).toFixed(1)}M sf`} />
        <Row k="Vacant space" v={`${((stock * vacNow) / 1e6).toFixed(2)}M sf · ${(vacNow * 100).toFixed(1)}% available · natural ${(NATURAL_VAC[focus] * 100).toFixed(1)}%`} bad={bal.gap > 0.025} strong />
        {Math.abs(vacNow - directNow) > 0.003 && (
          <Row
            k="Direct vacancy"
            v={`${(directNow * 100).toFixed(1)}% · frictional floor ${(frictionFloor(focus) * 100).toFixed(1)}%`}
            strong={directNow <= frictionFloor(focus) + 1e-6}
          />
        )}
        {(() => {
          // Same YoY tell as the top bar — for the focused class on this page.
          if (hist.length <= 12) return null;
          const then = hist[hist.length - 13]?.avail?.[focus]
            ?? hist[hist.length - 13]?.vac?.[focus]
            ?? vacNow;
          const dpp = (vacNow - then) * 100;
          return (
            <Row
              k="Vacancy Δ / yr"
              v={`${dpp >= 0 ? "+" : ""}${dpp.toFixed(1)} pp`}
              bad={dpp >= 2}
              strong={Math.abs(dpp) >= 1}
            />
          );
        })()}
        {(() => {
          // THE SHORTAGE (MDGA phase 6). Requirement looking for space the
          // city has no suite for — the looking book over housable stock.
          // When this is positive the market is short of floor, rents carry
          // the queue, and the next cranes belong in this class.
          const unmet = Math.max(0, (e.pool?.[focus] ?? 0) - housableStock(e, focus));
          if (!(unmet > stock * 0.002)) return null;
          return (
            <Row
              k="Unhoused demand"
              v={`${(unmet / 1e6).toFixed(2)}M sf · ${((unmet / Math.max(1, stock)) * 100).toFixed(1)}% of stock`}
              bad
              strong
              title="Tenant demand with no suitable space"
            />
          );
        })()}
        {/* THE DEMAND LEDGER. Letters still come from a finite looking book,
            not from empty floors: the search pool (`e.pool`) and this month's
            requirement (`marketRequirement`) are the same quantities
            leasingOdds reads on the desk, and they still gate every LOI.
            They are no longer PRINTED here — two intermediate stocks the
            player cannot act on directly, on a page whose job is the tells
            they can. The tells they can act on stay: what is let, and whether
            the city wants more floors than it has. */}
        {(() => {
          const occ = e.occupied?.[focus] ?? stock * (1 - directNow);
          const struct = e.structTight?.[focus] ?? 0;
          return (
            <>
              <Row k="Occupied" v={`${(occ / 1e6).toFixed(2)}M sf`} />
              {struct > 0.02 && (
                <Row
                  k="Unmet structural demand"
                  v={`${(struct * 100).toFixed(1)}% of stock`}
                  bad
                />
              )}
            </>
          );
        })()}
        <Row k="Under construction" v={`${((e.pipeline?.[focus] ?? 0) / 1e6).toFixed(2)}M sf · ${(((e.pipeline?.[focus] ?? 0) / stock) * 100).toFixed(1)}% of stock`} bad={(e.pipeline?.[focus] ?? 0) / stock > 0.05} />
        <Row k="Net absorption (12m)" v={`${(e.absorb12?.[focus] ?? 0) >= 0 ? "+" : ""}${((e.absorb12?.[focus] ?? 0) / 1e6).toFixed(2)}M sf`} bad={(e.absorb12?.[focus] ?? 0) < 0} />
        <Row k="Completions (12m)" v={`${((e.completions12?.[focus] ?? 0) / 1e6).toFixed(2)}M sf`} />
        <Row
          k="Months of supply"
          v={mos === null
            ? "n/a · negative absorption"
            : `${mos.toFixed(0)} months (vacancy + pipeline)`}
          bad={mos === null || mos > 60}
        />
        {/* "93% off its long-run base" reads as a discount when the rent is
            nearly double it. Say which way it has gone. */}
        <Row k="Rent" v={(() => {
          const d = ((e.rentIdx[focus] / RENT_BASE[focus]) - 1) * 100;
          return `$${e.rentIdx[focus].toFixed(2)}/sf · ${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(0)}% vs long-run base`;
        })()} />
        {(() => {
          const history = e.history ?? [];
          const yearAgo = history.length > 12 ? history[history.length - 13] : undefined;
          const now = (e.effRentIdx?.[focus] ?? e.rentIdx[focus]) / Math.max(0.01, e.cpi ?? 1);
          const then = yearAgo
            ? (yearAgo.effRent?.[focus] ?? yearAgo.rent?.[focus] ?? e.rentIdx[focus]) / Math.max(0.01, yearAgo.cpi ?? 1)
            : now;
          const move = now / Math.max(0.01, then) - 1;
          return <Row
            k="Effective rent trend"
            v={`${move >= 0 ? "+" : ""}${(move * 100).toFixed(1)}% real / 12 mo · `
              + (move > 0.025 ? "rising" : move < -0.025 ? "falling" : "flat")}
            bad={move < -0.025}
            strong
          />;
        })()}
        {/* The concession dial, read out loud. Face rates are sticky by design
            (ECONOMY.md §2c) — this row is where the market tells the truth
            before asking admits it. */}
        {(() => {
          const c = e.concIdx?.[focus] ?? 0;
          const off = c * 14;
          return <Row k="Concessions"
            v={c < 0.05 ? "none"
              : `~${off.toFixed(0)}% under asking (free rent + TI)${c > 0.7 ? " · deep" : ""}`}
            bad={c > 0.7} />;
        })()}
      </div>

      <div className="chart-grid chart-masonry" ref={masonry}>
        <div className="chart-cell">
          <div className="chart-title">Vacancy · {spanYrs} yr{spanYrs === 1 ? "" : "s"} history, 3 yr projection</div>
          {/* The projection is appended to whatever history is selected, and
              `split` is where the record stops — so it stays the length of
              vacSeries and the dotted join lands on the right month in both
              windows. The left x-label is the first point's own month rather
              than `game.month - 240`, which only agreed with the data while
              the window was exactly 240 long. */}
          <LineChart
            series={[
              { label: "availability", color: COLOR[focus], pts: vacWithProj },
              ...(vacSeries.some((v, i) => Math.abs(v - directSeries[i]) > 0.35)
                ? [{
                    label: "direct vacancy",
                    color: "#8b8370",
                    dashed: true as const,
                    pts: [...directSeries, ...Array.from({ length: proj.length }, () => directSeries[directSeries.length - 1] ?? 0)],
                  }]
                : []),
            ]}
            bands={[{ at: NATURAL_VAC[focus] * 100, label: "natural rate" }]}
            yFmt={pctFmt}
            split={vacSeries.length}
            xLabels={[xFrom, `${START_YEAR + Math.floor((game.month + 36) / 12)}`]}
          />
          <div className="chart-note">
            Projection: current pipeline at current absorption, no new starts. Availability = vacant + sublet. Dashed: direct vacancy.
          </div>
          {/* THE MARKET BY QUALITY (TENANT_TIERS_PLAN.md): which floors the vacancy is in. */}
          {(() => {
            const rows = bandTable(game.econ, focus).filter((r) => r.stock > 0);
            if (!rows.length) return null;
            return (
              <>
                <div className="hint" style={{ marginTop: 8 }}>By building score · market stock</div>
                {focus !== "multifamily" && (() => {
                  // How many firms that floor is: occupied over the average lease (plates.ts sizeMean).
                  const avg = sizeMean(focus);
                  const n = Math.round((game.econ.occupied?.[focus] ?? 0) / avg);
                  const pop = Math.max(1, game.econ.population ?? 1);
                  return (
                    <div className="hint">
                      ~{n.toLocaleString()} {focus === "retail" ? "shops" : "firms"} · avg {Math.round(avg).toLocaleString()} sf
                      {" "}· {(1000 * n / pop).toFixed(1)} per 1,000 residents
                    </div>
                  );
                })()}
                <table className="mini-table mono" style={{ width: "100%", fontSize: 12 }}>
                  <thead><tr><th style={{ textAlign: "left" }}>Score</th><th>Floor</th><th>Vacant</th><th>Normal</th><th>Rent vs class</th></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.lo}>
                        <td style={{ textAlign: "left" }}>{r.lo}–{r.lo + 10}</td>
                        <td style={{ textAlign: "right" }}>{sfFmt(r.stock)}</td>
                        <td style={{ textAlign: "right" }} className={r.vac > r.nat + 0.03 ? "neg" : ""}>{(r.vac * 100).toFixed(1)}%</td>
                        <td style={{ textAlign: "right" }}>{(r.nat * 100).toFixed(1)}%</td>
                        <td style={{ textAlign: "right" }}>{pctSigned(r.rent - 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="chart-note">Score 1-100: location + building quality</div>
              </>
            );
          })()}
        </div>
        <div className="chart-cell">
          <div className="chart-title">Pipeline by delivery year</div>
          {sched.some((v) => v > 0)
            ? <BarChart groups={pipeGroups} yFmt={sfFmt} />
            : <div className="hint" style={{ padding: "26px 0" }}>Nothing under construction.</div>}
          <div className="chart-note">SF under construction by delivery year</div>
          {/* THE CRANES BEHIND THE BARS. "400k sf is coming" is a different
              fact when one tower is most of it than when twenty infills are —
              one delivery date to watch against twenty you can ignore. These
              are the largest jobs feeding the bars, named: the city's, the
              rivals', and yours. Click one and the map takes you there. */}
          {pipeJobs.length > 0 && (
            <>
              <div className="hint" style={{ marginTop: 8 }}>
                {pipeJobs.length} building{pipeJobs.length === 1 ? "" : "s"} · {sfFmt(pipeJobsSf)} sf of{" "}
                {SECTOR_LABEL[focus].toLowerCase()} due within 24 months
              </div>
              <div className="mini-list">
                {pipeJobs.slice(0, 5).map((j) => (
                  <button key={j.bbl} className="neighbor" onClick={() => flyTo(j.bbl, true)}>
                    <span className="neighbor-addr">{j.stalled ? "⚠ " : ""}{parcels[j.bbl]?.address ?? j.bbl}</span>
                    <span className="neighbor-meta mono">
                      {j.who} · {sfFmt(j.sf)} sf{j.mixed ? " of a mixed job" : ""} · {j.floors} fl ·{" "}
                      {j.stalled ? "stalled · sponsor failed" : `due ${monthLabel(j.deliverM)}`}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
          {/* PERMITS FILED. A scheme is decided months before the hole is dug —
              design, permits, the loan — and a permit is public record, so the
              broker's pipeline report lists it. The developers themselves only
              count what has started (that blindness is how markets overbuild);
              you get the permit list, the way a careful owner does. */}
          {(() => {
            const plans = (game.cityPlans ?? []).filter((p) => p.use === focus || (p.use === "mixed" && (focus === "retail" || focus === "multifamily")))
              .sort((a, b) => a.breakM - b.breakM);
            if (!plans.length) return null;
            return (
              <>
                <div className="hint" style={{ marginTop: 8 }}>
                  Permitted, not started: {plans.length}
                </div>
                <div className="mini-list">
                  {plans.slice(0, 5).map((p) => {
                    const b = (game.builders ?? []).find((x) => x.id === p.builderId) ?? game.rivals.find((r) => r.id === p.firmId);
                    return (
                      <button key={p.bbl} className="neighbor" onClick={() => flyTo(p.bbl, true)}>
                        <span className="neighbor-addr">{parcels[p.bbl]?.address ?? p.bbl}</span>
                        <span className="neighbor-meta mono">
                          {b?.name ?? "A local developer"} · {p.floors} fl {p.use} · start ~{monthLabel(p.breakM)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            );
          })()}
          {/* THE TOWN'S DEVELOPERS. Who builds here, what they have delivered,
              how it opened — and who has folded. */}
          {game.builderFirms && (() => {
            // The town's builders are firms on the street: who owns what it built, what is under way, who went under.
            const firms = game.rivals.filter((r) => r.builderProf);
            const live = firms.filter((r) => r.failedM === undefined && r.retiredM === undefined);
            const top = [...live].sort((a, b) => b.bbls.length - a.bbls.length || b.cash - a.cash).slice(0, 6);
            const failed = firms.filter((r) => r.failedM !== undefined).sort((a, b) => (b.failedM ?? 0) - (a.failedM ?? 0)).slice(0, 3);
            if (!top.length && !failed.length) return null;
            return (
              <>
                <div className="hint" style={{ marginTop: 8 }}>
                  Developers: {live.length}{failed.length ? ` · ${firms.filter((r) => r.failedM !== undefined).length} failed` : ""}
                </div>
                <div className="mini-list">
                  {top.map((r) => {
                    const building = (game.cityJobs ?? []).filter((j) => j.firmId === r.id && !j.orphaned).length;
                    return (
                      <div key={r.id} className="neighbor">
                        <span className="neighbor-addr">{r.name}</span>
                        <span className="neighbor-meta mono">
                          {r.style === "developer" ? "build-to-hold" : "merchant builder"} · owns {r.bbls.length}{building ? ` · ${building} under way` : ""}
                        </span>
                      </div>
                    );
                  })}
                  {failed.map((r) => (
                    <div key={r.id} className="neighbor">
                      <span className="neighbor-addr neg">✕ {r.name}</span>
                      <span className="neighbor-meta mono">failed {monthLabel(r.failedM ?? 0)}</span>
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
          {!game.builderFirms && (() => {
            const all = game.builders ?? [];
            const live = all.filter((b) => b.failedM === undefined && b.starts > 0)
              .sort((a, b) => b.sfDelivered - a.sfDelivered).slice(0, 6);
            const folded = all.filter((b) => b.endReason === "folded").sort((a, b) => (b.failedM ?? 0) - (a.failedM ?? 0)).slice(0, 3);
            if (!live.length && !folded.length) return null;
            return (
              <>
                <div className="hint" style={{ marginTop: 8 }}>
                  Developers: {all.filter((b) => b.failedM === undefined).length} active
                  {all.some((b) => b.endReason === "folded") ? ` · ${all.filter((b) => b.endReason === "folded").length} folded (20 yrs)` : ""}
                </div>
                <div className="mini-list">
                  {live.map((b) => {
                    const building = (game.cityJobs ?? []).filter((j) => j.builderId === b.id && !j.firmId).length;
                    return (
                      <div key={b.id} className="neighbor">
                        <span className="neighbor-addr">{b.name}</span>
                        <span className="neighbor-meta mono">
                          {b.delivered} built · {sfFmt(b.sfDelivered)} sf{building ? ` · ${building} under way` : ""}
                          {b.worst !== undefined ? ` · openings ${Math.round(b.worst * 100)}–${Math.round((b.best ?? b.worst) * 100)}% of cost` : ""}
                        </span>
                      </div>
                    );
                  })}
                  {folded.map((b) => (
                    <div key={b.id} className="neighbor">
                      <span className="neighbor-addr neg">✕ {b.name}</span>
                      <span className="neighbor-meta mono">folded {monthLabel(b.failedM ?? 0)} · {b.delivered} built · {b.handedBack} handed back</span>
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
        </div>
        <div className="chart-cell">
          <div className="chart-title">Absorption vs completions, per year</div>
          <BarChart groups={flowYears} yFmt={sfFmt} />
          <div className="chart-note">Green: net absorption · orange: completions</div>
        </div>
        <div className="chart-cell">
          <div className="chart-title">Asking rent, effective rent, cap rate</div>
          <LineChart series={[
            { label: "asking", color: COLOR[focus], pts: rentSeries },
            { label: "effective", color: "#7d8a96", pts: effSeries, dashed: true },
          ]} yFmt={(v) => `$${v.toFixed(0)}`} height={92}
            xLabels={[xFrom, xTo]} xAt={(i) => monthLabel(tail[i]?.q ?? 0)} />
          <LineChart series={[{ label: "cap", color: "#8a5620", pts: capSeries, dashed: true }]} yFmt={pctFmt} height={92}
            xLabels={[xFrom, xTo]} xAt={(i) => monthLabel(tail[i]?.q ?? 0)} />
          <div className="chart-note">Effective = asking less free rent and TI · cap rate below</div>
        </div>
        <>
          {/* TWO CHARTS, TWO CAPTIONS — and now two cells, so the masonry can
              put the concession gap in whichever column has room for it.
              This cell had one title and one note covering both, and the note
              gave the bottom chart a single compressed sentence. The owner
              screenshotted the cell asking what it was — and what they had
              screenshotted was the CONCESSION GAP, the line that sits at 14%,
              collapses to nothing for twenty years and climbs back. Nothing on
              the page said what a concession gap is. Each chart now carries its
              own heading and its own note, directly above and below itself. */}
          {(() => {
            // The annual bars in the cell to the left show the FLOWS; this
            // pair shows the stocks. Running totals of the same abs/comp
            // series — when the delivered line pulls away from the absorbed
            // line, the widening wedge between them is the vacancy the market
            // has to eat, and you can see which blade of the scissors cut.
            let a = 0, c = 0;
            const absCum: number[] = [], compCum: number[] = [];
            for (const h of tail) {
              a += h.abs?.[focus] ?? 0; c += h.comp?.[focus] ?? 0;
              absCum.push(a); compCum.push(c);
            }
            // The effective-vs-asking gap as ONE line, in per cent off asking.
            // The cell above charts the same pair, but the gap is the signal
            // and reading it off the distance between two lines hides its shape.
            const gap = tail.map((h) => {
              const ask = h.rent?.[focus] ?? 0;
              return ask > 0 ? Math.max(0, 1 - (h.effRent?.[focus] ?? ask) / ask) * 100 : 0;
            });
            const xl: [string, string] = [xFrom, xTo];
            return (<>
              <div className="chart-cell">
              <div className="chart-title">Cumulative absorption vs completions</div>
              <LineChart height={92} series={[
                { label: "absorbed", color: "#4a7d5a", pts: absCum },
                { label: "delivered", color: "#a8562e", pts: compCum, dashed: true },
              ]} yFmt={sfFmt} zeroBase xLabels={xl} xAt={(i) => monthLabel(tail[i]?.q ?? 0)} />
              <div className="chart-note">Solid: absorbed · dashed: delivered · dashed above solid = oversupply</div>
              </div>
              <div className="chart-cell">
              <div className="chart-title">Concessions</div>
              <LineChart height={92} series={[{ label: "concession gap", color: "#7d8a96", pts: gap }]}
                yFmt={pctFmt} zeroBase xLabels={xl} xAt={(i) => monthLabel(tail[i]?.q ?? 0)} />
              {/* WHAT THE OWNER WAS LOOKING AT. This is the line that opens to
                  about a third, falls to nothing, and climbs back — and until
                  now the page assumed the reader already knew what a concession
                  is. It used to top out at 14% because the index said so and
                  the index had not been measured against the leasing desk; see
                  CONC_DEPTH in engine/market.ts. */}
              <div className="chart-note">% off asking from free rent and TI · 0% landlord market, 30% max · leads asking rent</div>
              </div>
            </>);
          })()}
        </>
      </div>

      {/* ---- submarkets ---- */}
      <div className="page-section">Submarkets · {SECTOR_LABEL[focus]}</div>
      <table className="tbl">
        <thead>
          <tr>
            <th>Neighbourhood</th><th className="num">Inventory</th><th className="num">Vacancy</th>
            <th className="num">vs city</th><th className="num">Avg rent</th><th className="num">Demand</th>
            <th className="num">Vacant lots</th><th>Read</th>
          </tr>
        </thead>
        <tbody>
          {subs.map((m) => {
            const leg = m.legs[focus];
            if (leg.sf < 20000) return null;
            const v = legVacancy(leg);
            const d = v - vacNow;
            return (
              <tr key={m.district} style={{ cursor: "default" }}>
                <td>{m.name}</td>
                <td className="num">{(leg.sf / 1e6).toFixed(2)}M sf</td>
                <td className={"num" + (v > NATURAL_VAC[focus] + 0.03 ? " neg" : "")}>{(v * 100).toFixed(1)}%</td>
                <td className="num dim">{d >= 0 ? "+" : ""}{(d * 100).toFixed(1)} pts</td>
                <td className="num">${legRent(leg).toFixed(2)}</td>
                <td className="num">{legDemand(leg).toFixed(0)}</td>
                <td className="num">{m.vacantLots}</td>
                <td className="dim">
                  {v < NATURAL_VAC[focus] - 0.02 ? "tight"
                    : v > NATURAL_VAC[focus] + 0.04 ? "soft"
                    : "balanced"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </>}

      {/* Block-level drift and the civic works are geography, so they ride
          with the Districts stance rather than under every market. */}
      {sel === "districts" && (() => {
        const emergent = Object.values(game.blockE ?? {});
        if (!emergent.length) return null;
        const abs = emergent.map((d) => Math.abs(d));
        const max = Math.max(...abs);
        const spread = Math.max(...emergent) - Math.min(...emergent);
        return (
          <>
            <div className="page-section">Neighbourhood demand</div>
            <div className="grid">
              <Row k="Blocks shifting" v={`${emergent.length}`} />
              <Row k="Largest move" v={`±${max.toFixed(0)} pts since 2000`} strong={max >= 8} />
              <Row k="Spread" v={`${spread.toFixed(0)} pts`} />
              <Row k="Civic works" v={(() => {
                const n = { open: 0, digging: 0, funded: 0, rumoured: 0 };
                for (const l of game.lines ?? []) n[workStage(game.month, l).word]++;
                return `${n.open} open · ${n.digging} digging · ${n.funded} funded · ${n.rumoured} rumoured`;
              })()} />
            </div>
            {(game.lines ?? []).length > 0 && (
              <>
                <div className="mini-list" style={{ marginTop: 8 }}>
                  {/* EVERY WORK, WITH ITS STAGE AND ITS PRICE. "Rumoured" alone
                      was the whole readout, and the trade lives in the rest of
                      the sentence: what the work is worth to the ground under
                      it, which date moves it to the next stage, and how much of
                      the lift the market has already paid itself. */}
                  {(game.lines ?? []).map((l) => {
                    const kind = l.kind ?? "station";
                    const st = workStage(game.month, l);
                    const when = st.word === "open" ? `opened ${monthLabel(l.openM)}`
                      : st.word === "digging" ? `opens ${monthLabel(l.openM)}`
                      : st.word === "funded" ? `funded ${monthLabel(l.annM)} · opens ${monthLabel(l.openM)}`
                      : `${l.rumorM !== undefined ? `since ${monthLabel(l.rumorM)} · ` : ""}hearing ${monthLabel(l.annM)}`;
                    return (
                      <button
                        key={`${l.id}:${l.annM}`}
                        className="neighbor"
                        disabled={!l.bbl}
                        title={l.bbl ? "Show on map" : undefined}
                        onClick={() => { if (l.bbl) useStore.getState().focus(l.bbl, true); }}
                      >
                        <span className="neighbor-addr">{l.name} {kind}{l.bbl ? " ✈" : ""}</span>
                        <span className="neighbor-meta mono">
                          {st.word} · {when} · {l.pts} pts
                          {" "}· {st.priced >= 1 ? "fully priced" : `${Math.round(st.priced * 100)}% priced in`}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="hint">
                  Land prices in a work at rumour, funding, construction and opening · pts = full demand lift · ~1 in 4 rumours fail at hearing
                  {/* "one in four" mirrors SHELVE_ODDS in engine/demand.ts, which
                      is not exported — if the hearing gets kinder, so must this. */}
                </div>
              </>
            )}
            <div className="hint">Demand is zero-sum across blocks.</div>
          </>
        );
      })()}

      {(sel === "general" || isClass) && <>
      <div className="page-section">Model</div>
      <div className="hint">
        Employment → space demand (lagged) · rents move on vacancy vs natural rate · starts follow rent vs build cost · your deliveries count as supply
      </div>
      </>}
    </div>
  );
}

/**
 * RESEARCH — what the market is doing, as opposed to what is for sale.
 *
 * These two things were one page and they are not one job. Deciding whether to
 * buy a specific building is a different activity from forming a view on where
 * office cap rates are going, which trades are hiring, what has actually
 * traded, and which of the other firms is levering into the top. Every real
 * shop separates them and so does this now: the tape lives on Marketplace,
 * and everything you would read BEFORE looking at the tape lives here.
 */

/**
 * THE MARKETPLACE — the tape, and only the tape.
 *
 * What is actually for sale, priced against what it earns and what it is
 * worth. Everything you would read to form a view BEFORE working this list —
 * where cap rates are, which trades are hiring, what has traded, who is
 * buying — is on Research, because reading the market and shopping it are two
 * different jobs and squeezing both onto one page made neither of them good.
 */
/**
 * EVERY BUILDING IN TOWN, AS A TABLE YOU CAN WORK.
 *
 * The street answers "who owns what", firm by firm; this answers "what exists"
 * — the whole standing stock, sortable on any column, filterable by class,
 * searchable by address. It is the screen a buyer's analyst actually keeps open: sort by
 * $/sf of value against demand and the mispriced corners fall out the bottom.
 * Occupancy and value here are the same models the engine prices with, so
 * this table cannot disagree with a deal card.
 */
