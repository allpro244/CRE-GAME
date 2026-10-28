/**
 * CAPITAL › LENDERS, INVESTORS, BOOKS, AS TABLES (PLAN §3.1, §5 step 5).
 *
 * Lenders: every desk in town on one table — capital against its target,
 * book, margin, credit, appetite, what you owe it and your room under its
 * single-name limit — and a row opens what it will write today, term by term
 * (the classic bank file's own reads). Investors: your band and record, the
 * city's investor money by type, live and wound-up syndicates, the fund.
 * Books: balance sheet, income statement and cash flow, line by year.
 */
import { useMemo, useState, type ReactNode } from "react";
import { useStore } from "@/state/store";
import type { GameState } from "@/engine/types";
import { monthLabel, START_YEAR } from "@/engine/types";
import { capitalRatio, lenderConstitution, lenderHealth, lenderPressure, stayingPower, type Lender } from "@/engine/lenders";
import {
  PRODUCTS, advanceFactor, holdMaxOf, loanMin, relCurve, singleNameCap, statedLtv, underwritingStandards, standardsWord, windowOpen,
} from "@/engine/debt";
import { bankRatePct, liveSpread, lossClassOf, type DeskPx, type LossClass } from "@/engine/pricing";
import { shortIndexOf } from "@/engine/market";
import { lineLender } from "@/engine/credit";
import { ffAvailable, syndicateView } from "@/engine/syndicate";
import { BANDS, bandIdx, nextBandNeeds, playerTerms, rankStreet, reputationNow } from "@/engine/reputation";
import { EQUITY_PER_HEAD, INVESTOR_TYPES, cityAttractiveness } from "@/engine/investors";
import { FUND_PREF, FUND_PROMOTE, fundCanBuy, fundRaiseQuote, gpInterestInFund, waterfall } from "@/engine/fund";
import { balanceSnapshotView, buildBalanceSheet, pnlView, type BalanceSheetView } from "@/engine/books";
import { taxAppealQuote } from "@/engine/tax";
import { depositsHeld } from "@/engine/leasing";
import { ownedHoldingValue, resolveRec } from "@/engine/value";
import { derive, nwOf } from "@/ui/derive";
import { usd } from "@/ui/format";
import { DataTable, Stat, StatStrip, type Col } from "./DataTable";
import { Figure, Spark, fmtFig } from "./Figure";

const mo = (m: number | null | undefined) => <span className="mono">{m !== null && m !== undefined ? monthLabel(m) : "—"}</span>;
const strong = (s: ReactNode) => <span className="nx-strong-cell">{s}</span>;
const Box = ({ head, children }: { head: string; children: ReactNode }) => (
  <div className="nx-box"><div className="nx-box-head">{head}</div>{children}</div>
);

// ---------------------------------------------------------------- lenders
const TYPE_WORD: Record<LossClass, string> = {
  income: "Mortgages on income property", construction: "Construction", land: "Land", junior: "Bridge and mezzanine",
};
interface LRow { l: Lender; kind: string; open: boolean; ratio: number; vsTarget: number; book: number; capital: number; delinq: number; nim: number | null; net: number; appetite: number; pressure: number; yours: number; room: number; state: string; line: boolean; depRate: number | null; vsMkt: number | null; won: number | null; usual: number | null }

function lenderRows(g: GameState): LRow[] {
  return derive(g, "next.lenders", () => {
    const yourLine = lineLender(g)?.id;
    // Where each desk is pitching: its price over its own sheet (funding,
    // losses, rationing, competition) against the other open desks' average.
    const px = g.econ.deskPx ?? {};
    const pitch = (q?: DeskPx) => (q ? q.dFund + (q.dEl.income ?? 0) + q.pull + q.chase : null);
    const live = (g.lenders ?? []).filter((x) => x.failedM === undefined && px[x.name]);
    return (g.lenders ?? []).map((l) => {
      const mine = pitch(px[l.name]);
      const others = live.filter((o) => o !== l);
      const mkt = others.length ? others.reduce((a, o) => a + (pitch(px[o.name]) ?? 0), 0) / others.length : null;
      const c = lenderConstitution(l);
      const cr = capitalRatio(l);
      const failed = l.failedM !== undefined;
      return {
        l, kind: l.kind, open: !failed, ratio: cr, vsTarget: cr / Math.max(0.01, c.target), book: l.book, capital: l.capital,
        delinq: l.delinquent, nim: l.bookYield !== undefined ? l.bookYield - Math.max(0, (l.fundCost ?? 0) + (l.panicBps ?? 0)) : null,
        net: l.netIncomeYr, appetite: failed ? 0 : l.appetite, pressure: lenderPressure(l), yours: l.yours,
        room: Math.max(0, l.book * singleNameCap(l.kind) - l.yours), state: failed ? "closed" : stayingPower(g, l).word, line: yourLine === l.id,
        depRate: l.dep?.rate ?? null, vsMkt: mine !== null && mkt !== null && !failed ? mine - mkt : null,
        won: l.wonShare ?? null, usual: l.usualShare ?? null,
      };
    });
  }, []);
}

export function CapitalLenders() {
  const game = useStore((s) => s.game)!;
  const rows = useMemo(() => lenderRows(game), [game]);
  const [sel, setSel] = useState<string | null>(null);
  const st = underwritingStandards(game);
  const pick = rows.find((r) => r.l.id === sel) ?? null;
  const cols: Col<LRow>[] = [
    { id: "name", label: "Lender", get: (r) => r.l.name, cell: (r) => strong(<>{r.l.name}{r.line ? <span className="nx-chip nx-chip-teal">Line</span> : null}{!r.open ? <span className="nx-chip nx-chip-red">Closed</span> : null}</>) },
    { id: "kind", label: "Kind", get: (r) => r.kind },
    { id: "state", label: "Standing", get: (r) => r.state, tone: (r) => (lenderHealth(r.l, game.econ).bad || !r.open ? "neg" : undefined) },
    { id: "vs", label: "Capital ×", get: (r) => r.vsTarget, fmt: "x", tone: (r) => (r.vsTarget < 0.7 ? "neg" : r.vsTarget > 1.15 ? "pos" : undefined) },
    { id: "ratio", label: "Ratio", get: (r) => r.ratio, fmt: "pct", hidden: true },
    { id: "book", label: "Book", get: (r) => r.book, fmt: "usd" },
    { id: "capital", label: "Capital", get: (r) => r.capital, fmt: "usd", tone: (r) => (r.capital <= 0 ? "neg" : undefined) },
    { id: "delinq", label: "Late", get: (r) => r.delinq, fmt: "pct", tone: (r) => (r.delinq > 0.045 ? "neg" : undefined) },
    { id: "nim", label: "NIM", get: (r) => r.nim, fmt: "pctv" },
    { id: "net", label: "Net YTD", get: (r) => r.net, fmt: "usd", tone: (r) => (r.net < 0 ? "neg" : undefined) },
    { id: "dep", label: "Deposit rate", get: (r) => r.depRate, fmt: "pctv" },
    { id: "vsmkt", label: "Quote vs mkt", get: (r) => r.vsMkt, fmt: "pctv", tone: (r) => (r.vsMkt !== null && r.vsMkt > 0.25 ? "neg" : r.vsMkt !== null && r.vsMkt < -0.1 ? "pos" : undefined) },
    { id: "won", label: "Won (12m)", get: (r) => r.won, fmt: "pct", tone: (r) => (r.won !== null && r.usual !== null && r.won < r.usual * 0.5 ? "neg" : undefined) },
    { id: "usual", label: "Usual share", get: (r) => r.usual, fmt: "pct", hidden: true },
    { id: "app", label: "Appetite", get: (r) => r.appetite, fmt: "x" },
    { id: "press", label: "Pressure", get: (r) => r.pressure, fmt: "pct", tone: (r) => (r.pressure > 0.4 ? "neg" : undefined), hidden: true },
    { id: "yours", label: "You owe", get: (r) => r.yours, fmt: "usd" },
    { id: "room", label: "Your room", get: (r) => r.room, fmt: "usd" },
  ];
  return (
    <div className="nx-place">
      <StatStrip>
        <Stat label="Lenders"><Figure value={rows.length} fmt="n" /></Stat>
        <Stat label="Open"><Figure value={rows.filter((r) => r.open).length} fmt="n" /></Stat>
        <Stat label="Standards"><Figure value={st} fmt="n" text={`${standardsWord(st)} ${st >= 0 ? "+" : ""}${st.toFixed(2)}`} /></Stat>
        <Stat label="10Y"><Figure value={game.econ.indexRate} fmt="pctv" drill="rate" /></Stat>
        <Stat label="Short"><Figure value={shortIndexOf(game.econ)} fmt="pctv" drill="rate" /></Stat>
        <Stat label="You owe"><Figure value={rows.reduce((a, r) => a + r.yours, 0)} fmt="usd" drill="debt" /></Stat>
      </StatStrip>
      <DataTable id="capital-lenders" cols={cols} rows={rows} rowKey={(r) => r.l.id} selected={sel} initialSort={{ col: "book", dir: -1 }} empty="No lenders"
        onRow={(r) => setSel(sel === r.l.id ? null : r.l.id)} />
      {pick && <LenderTerms g={game} r={pick} />}
    </div>
  );
}

interface PRow { id: string; paper: string; sheet: number; after: number; rate: number; spread: number; floating: boolean; dscr: number | null; dy: number | null; term: string; min: number | null; max: number | null; cov: string; open: boolean }

function LenderTerms({ g, r }: { g: GameState; r: LRow }) {
  const l = r.l, e = g.econ;
  const adv = advanceFactor(g, l.name);
  const failed = l.failedM !== undefined;
  const rows: PRow[] = PRODUCTS.filter((p) => p.lender === l.name).map((p) => {
    const sheet = statedLtv(g, p, "office", "standard").ltv;
    const bench = p.floating ? shortIndexOf(e) : e.indexRate;
    const rate = bankRatePct(bench, liveSpread(e.deskPx?.[l.name], p.spread, lossClassOf(p)), { rel: relCurve(g, l.name) });
    return {
      id: p.id, paper: p.label.split(" · ").slice(1).join(" · ") || p.label, sheet, after: sheet * adv, rate, spread: rate - bench, floating: !!p.floating,
      dscr: p.uwDscr > 0 ? p.uwDscr : null, dy: p.uwDscr > 0 ? p.debtYield : null,
      term: `${Math.round(p.termM / 12)}y · ${Math.round(p.ioM / 12)}y IO · ${p.amortYears}y`,
      min: loanMin(g, p) || null, max: holdMaxOf(g, p) ?? null,
      cov: `${p.minDSCR > 0 ? `${p.minDSCR.toFixed(2)}× · ` : ""}${Math.round(p.maxLTV * 100)}%`, open: !failed && windowOpen(g, p),
    };
  });
  const cols: Col<PRow>[] = [
    { id: "paper", label: "Paper", get: (x) => x.paper, cell: (x) => strong(x.paper) },
    { id: "sheet", label: "Sheet LTV", get: (x) => x.sheet, fmt: "pct" },
    { id: "after", label: "Advance", get: (x) => x.after, fmt: "pct" },
    { id: "rate", label: "Coupon", get: (x) => x.rate, fmt: "pctv", cell: (x) => <span>{x.rate.toFixed(2)}%{x.floating ? " fl" : ""}</span> },
    { id: "spread", label: "Spread", get: (x) => x.spread, fmt: "pctv" },
    { id: "dscr", label: "UW DSCR", get: (x) => x.dscr, fmt: "x" },
    { id: "dy", label: "Debt yield", get: (x) => x.dy, fmt: "pct" },
    { id: "term", label: "Term", get: (x) => x.term },
    { id: "min", label: "Min", get: (x) => x.min, fmt: "usd" },
    { id: "max", label: "Max", get: (x) => x.max, fmt: "usd" },
    { id: "cov", label: "Covenants", get: (x) => x.cov },
    { id: "open", label: "Quoting", get: (x) => (x.open ? "yes" : "no"), tone: (x) => (x.open ? undefined : "neg") },
  ];
  const d = l.dep;
  return (
    <Box head={l.name}>
      <StatStrip>
        <Stat label="Capital ×"><Figure value={r.vsTarget} fmt="x" /></Stat>
        <Stat label="Book yield"><Figure value={l.bookYield ?? null} fmt="pctv" /></Stat>
        <Stat label="Cost of funds"><Figure value={l.fundCost ?? null} fmt="pctv" /></Stat>
        {d?.total !== undefined && <Stat label="Deposits"><Figure value={d.total} fmt="usd" /></Stat>}
        {d?.flowYr !== undefined && <Stat label="Deposit flow"><Figure value={d.flowYr} fmt="pct" tone={d.flowYr < -0.1 ? "neg" : undefined} /></Stat>}
        {d?.wholesale !== undefined && <Stat label="Wholesale"><Figure value={d.wholesale} fmt="usd" /></Stat>}
        <Stat label="Charge-offs"><Figure value={l.chargeOffsYr} fmt="usd" /></Stat>
        <Stat label="Advance"><Figure value={adv} fmt="pct" /></Stat>
      </StatStrip>
      <DataTable id="capital-lender-terms" cols={cols} rows={rows} rowKey={(x) => x.id} empty="Construction only" />
      <DataTable id="capital-lender-book" cols={[
        { id: "type", label: "Book by type", get: (x) => x.label, cell: (x) => strong(x.label) },
        { id: "n", label: "Loans", get: (x) => x.n, fmt: "n" },
        { id: "bal", label: "Balance", get: (x) => x.bal, fmt: "usd" },
        { id: "share", label: "Of book", get: (x) => (l.book > 0 ? x.bal / l.book : null), fmt: "pct" },
        { id: "def", label: "Not paying", get: (x) => (x.bal > 0 ? x.def / x.bal : null), fmt: "pct", tone: (x) => (x.def > 0 ? "neg" : undefined) },
        { id: "watch", label: "On watch", get: (x) => (x.bal > 0 ? x.watch / x.bal : null), fmt: "pct" },
        { id: "el", label: "Loss it prices", get: (x) => x.el, fmt: "pctv" },
      ]} rows={(["income", "construction", "land", "junior"] as LossClass[]).map((c) => ({
        c, label: TYPE_WORD[c], n: l.typeBook?.[c]?.n ?? 0, bal: l.typeBook?.[c]?.bal ?? 0, def: l.typeBook?.[c]?.def ?? 0,
        watch: l.typeBook?.[c]?.watch ?? 0, el: e.deskPx?.[l.name]?.el[c] ?? null,
      })).filter((x) => x.n > 0)} rowKey={(x) => x.c} empty="No loans" />
      {(l.lossLog?.length ?? 0) > 0 && (
        <DataTable id="capital-lender-losses" cols={[
          { id: "m", label: "Charged off", get: (x) => x.m, cell: (x) => mo(x.m) },
          { id: "who", label: "Borrower", get: (x) => x.borrower, cell: (x) => strong(x.borrower) },
          { id: "how", label: "How", get: (x) => x.how ?? TYPE_WORD[x.cls] },
          { id: "amt", label: "Loss", get: (x) => x.amount, fmt: "usd", tone: () => "neg" },
        ]} rows={(l.lossLog ?? []).slice(0, 12).map((x, i) => ({ ...x, i }))} rowKey={(x) => String(x.i)} initialSort={{ col: "m", dir: -1 }} />
      )}
      {(l.capHist?.length ?? 0) > 2 && (
        <div className="nx-with-spark nx-box-foot"><span className="nx-dim">Capital</span><Spark pts={l.capHist!.map((x) => (typeof x === "number" ? x : (x as { v?: number; capital?: number }).capital ?? (x as { v?: number }).v ?? NaN))} /></div>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------- investors
export function CapitalInvestors() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const rep = reputationNow(game);
  const terms = playerTerms(game);
  const cap = game.ffNetwork?.cap ?? Math.max(0, Math.round(game.nwHistory?.[0] ?? 0));
  const avail = ffAvailable(game);
  const street = useMemo(() => rankStreet(game), [game]);
  const nb = bandIdx(terms.band) < BANDS.length - 1 ? nextBandNeeds(game) : null;
  const yr = Math.floor(game.month / 12);
  const pool = game.investorPool && game.investorPool.yr === yr ? game.investorPool : null;
  const scale = Math.max(0, (game.econ.population ?? 0) * EQUITY_PER_HEAD * (game.econ.priceLevel ?? 1) * (game.econ.cpi ?? 1) * cityAttractiveness(game.econ));
  const types = INVESTOR_TYPES.map((t) => {
    const c = pool ? pool.cap[t.id] ?? 0 : Math.round(scale * t.share);
    const used = pool ? pool.used[t.id] ?? 0 : 0;
    const open = bandIdx(terms.band) >= bandIdx(t.band);
    return { id: t.id, label: t.label, band: t.band, cap: c, used, left: open ? Math.max(0, c - used) : null };
  });
  const live = Object.keys(game.syndications ?? {}).map((b) => ({ b, v: syndicateView(game, parcels, b), addr: resolveRec(parcels, game, b)?.address ?? b })).filter((x) => x.v);
  const closed = [...(game.synClosed ?? [])].reverse();
  const me = street.find((f) => f.id === "you");
  return (
    <div className="nx-place">
      <StatStrip>
        <Stat label="Band"><Figure value={bandIdx(terms.band)} fmt="n" text={terms.band} /></Stat>
        <Stat label="Rank"><Figure value={rep.rank} fmt="n" text={`${rep.rank}/${rep.of}`} /></Stat>
        <Stat label="Score"><Figure value={rep.score} fmt="n" text={rep.score.toFixed(1)} tone={rep.score < 0 ? "neg" : undefined} /></Stat>
        <Stat label="Per $1 yours"><Figure value={terms.perOwn} fmt="n" text={terms.perOwn > 0 ? `$${terms.perOwn}` : "—"} /></Stat>
        <Stat label="Size rank"><Figure value={me?.sizeRank ?? null} fmt="n" /></Stat>
        <Stat label="Network"><Figure value={cap} fmt="usd" /></Stat>
        <Stat label="Free to raise"><Figure value={avail} fmt="usd" tone={avail <= 0 ? "neg" : undefined} /></Stat>
        <Stat label="City pull"><Figure value={cityAttractiveness(game.econ)} fmt="pct" /></Stat>
      </StatStrip>
      {nb && (
        <Box head={`To ${nb.next}`}>
          <DataTable id="inv-next" cols={[
            { id: "k", label: "Test", get: (r) => r.label, cell: (r) => <span className={r.ok ? "nx-pos" : undefined}>{r.label}</span> },
            { id: "have", label: "You", get: (r) => r.have },
            { id: "need", label: "Needed", get: (r) => r.need, tone: (r) => (r.ok ? undefined : "neg") },
          ]} rows={nb.rows} rowKey={(r) => r.label} />
        </Box>
      )}
      <Box head="Investor money">
        <DataTable id="inv-pool" cols={[
          { id: "label", label: "Investors", get: (r) => r.label },
          { id: "band", label: "Opens at", get: (r) => r.band },
          { id: "cap", label: "This year", get: (r) => r.cap, fmt: "usd" },
          { id: "used", label: "Raised", get: (r) => r.used, fmt: "usd" },
          { id: "left", label: "Open to you", get: (r) => r.left, fmt: "usd" },
        ]} rows={types} rowKey={(r) => r.id} />
      </Box>
      <Box head="Live deals">
        <DataTable id="inv-live" cols={[
          { id: "addr", label: "Deal", get: (r) => r.addr, cell: (r) => strong(r.addr) },
          { id: "commit", label: "Committed", get: (r) => r.v!.lpCommit, fmt: "usd" },
          { id: "called", label: "Called", get: (r) => r.v!.lpCalled, fmt: "usd" },
          { id: "dist", label: "Paid back", get: (r) => r.v!.lpDist, fmt: "usd" },
          { id: "yours", label: "Yours", get: (r) => r.v!.yours, fmt: "usd" },
          { id: "theirs", label: "Theirs", get: (r) => r.v!.theirs, fmt: "usd" },
        ]} rows={live} rowKey={(r) => r.b} empty="None" onRow={(r) => useStore.getState().select(r.b)} />
      </Box>
      <Box head="Wound up">
        <DataTable id="inv-closed" cols={[
          { id: "addr", label: "Deal", get: (r) => r.address, cell: (r) => strong(r.address) },
          { id: "formed", label: "Formed", get: (r) => r.formedM, cell: (r) => mo(r.formedM) },
          { id: "closed", label: "Closed", get: (r) => r.closedM, cell: (r) => mo(r.closedM) },
          { id: "in", label: "LP in", get: (r) => r.lpIn, fmt: "usd" },
          { id: "out", label: "LP out", get: (r) => r.lpOut, fmt: "usd", tone: (r) => (r.lpOut < r.lpIn ? "neg" : undefined) },
          { id: "mult", label: "Multiple", get: (r) => (r.lpIn > 0 ? r.lpOut / r.lpIn : null), fmt: "x" },
          { id: "irr", label: "LP IRR", get: (r) => r.lpIrr, fmt: "pct" },
        ]} rows={closed} rowKey={(r) => `${r.bbl}-${r.closedM}`} initialSort={{ col: "closed", dir: -1 }} empty="None" />
      </Box>
      <Box head="Record">
        <DataTable id="inv-record" cols={[
          { id: "label", label: "Deal", get: (r) => r.label },
          { id: "m", label: "When", get: (r) => r.m, cell: (r) => mo(r.m) },
          { id: "kind", label: "Money", get: (r) => (r.kind === "investor" ? "investors" : r.kind === "own" ? "own" : "credit") },
          { id: "ev", label: "Evidence", get: (r) => r.ev, fmt: "n", cell: (r) => <span className={r.ev < 0 ? "nx-neg" : undefined}>{r.ev > 0 ? "+" : ""}{r.ev.toFixed(1)}</span> },
        ]} rows={rep.evidence.map((e, i) => ({ ...e, i }))} rowKey={(r) => String(r.i)} initialSort={{ col: "m", dir: -1 }} empty="None" />
      </Box>
      <Box head="Street">
        <DataTable id="inv-street" cols={[
          { id: "rank", label: "#", get: (r) => r.rank, fmt: "n" },
          { id: "name", label: "Firm", get: (r) => r.name, cell: (r) => (r.id === "you" ? strong(r.name) : <span>{r.name}</span>) },
          { id: "score", label: "Score", get: (r) => r.score, fmt: "n", cell: (r) => <span>{r.score.toFixed(1)}</span> },
          { id: "band", label: "Band", get: (r) => r.band },
          { id: "size", label: "Size rank", get: (r) => r.sizeRank, fmt: "n" },
        ]} rows={street} rowKey={(r) => r.id} initialSort={{ col: "rank", dir: 1 }} maxHeight={330} />
      </Box>
      <FundBox />
    </div>
  );
}

function FundBox() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const st = useStore.getState();
  const f = game.fund;
  const q = fundRaiseQuote(game);
  if (!f || f.settled) {
    return (
      <Box head="Fund">
        <div className="nx-box-foot">
          <button type="button" className="nx-btn nx-sm nx-primary" disabled={!q.ok} title={q.ok ? undefined : "Record too short"} onClick={() => st.raiseFund()}>
            {q.ok ? `Raise ${usd(q.size)}` : "Raise fund"}
          </button>
        </div>
      </Box>
    );
  }
  const deeds = Object.values(game.holdings).filter((h) => h.fundOwned).map((h) => {
    const v = ownedHoldingValue(game, parcels, h);
    const debt = (h.loan?.balance ?? 0) + (h.mezz?.balance ?? 0);
    return { bbl: h.bbl, addr: resolveRec(parcels, game, h.bbl)?.address ?? h.bbl, v, debt, eq: v - debt };
  });
  const nav = f.cash + deeds.reduce((a, d) => a + d.eq, 0);
  const w = waterfall(f, Math.max(0, nav));
  const dpi = f.called > 0 ? f.distributed / f.called : null;
  const tvpi = f.called > 0 ? (f.distributed + Math.max(0, nav)) / f.called : null;
  const endDpi = f.called > 0 ? (f.distributed + w.pref + w.capital + w.split) / f.called : null;
  return (
    <Box head={`Fund · ${monthLabel(f.raisedM)}`}>
      <StatStrip>
        <Stat label="Size"><Figure value={f.size} fmt="usd" /></Stat>
        <Stat label="NAV"><Figure value={nav} fmt="usd" tone={nav < 0 ? "neg" : undefined} /></Stat>
        <Stat label="Yours"><Figure value={gpInterestInFund(f, nav)} fmt="usd" /></Stat>
        <Stat label="Cash"><Figure value={f.cash} fmt="usd" /></Stat>
        <Stat label="Called"><Figure value={f.called} fmt="usd" /></Stat>
        <Stat label="Uncalled"><Figure value={f.uncalled} fmt="usd" /></Stat>
        <Stat label="Distributed"><Figure value={f.distributed} fmt="usd" /></Stat>
        <Stat label="DPI"><Figure value={dpi} fmt="x" /></Stat>
        <Stat label="TVPI"><Figure value={tvpi} fmt="x" tone={tvpi !== null && tvpi < 1 ? "neg" : undefined} /></Stat>
        <Stat label="Wind-down"><Figure value={endDpi} fmt="x" tone={endDpi !== null && endDpi < 1 ? "neg" : undefined} /></Stat>
        <Stat label="Pref owed"><Figure value={f.prefAccrued} fmt="usd" tone={f.prefAccrued > 0 ? "neg" : undefined} /></Stat>
        <Stat label="Invest ends"><Figure value={f.investEndM} fmt="n" text={monthLabel(f.investEndM)} /></Stat>
        <Stat label="Life ends"><Figure value={f.lifeEndM} fmt="n" text={monthLabel(f.extendedTo ?? f.lifeEndM)} /></Stat>
        <Stat label="Waterfall"><Figure value={FUND_PREF} fmt="pct" text={`${Math.round(FUND_PREF * 100)}% · ${Math.round(FUND_PROMOTE * 100)}%`} /></Stat>
      </StatStrip>
      <DataTable id="inv-fund-deeds" cols={[
        { id: "addr", label: "Deed", get: (r) => r.addr, cell: (r) => strong(r.addr) },
        { id: "v", label: "Mark", get: (r) => r.v, fmt: "usd" },
        { id: "debt", label: "Debt", get: (r) => r.debt, fmt: "usd" },
        { id: "eq", label: "Equity", get: (r) => r.eq, fmt: "usd", tone: (r) => (r.eq < 0 ? "neg" : undefined) },
      ]} rows={deeds} rowKey={(r) => r.bbl} empty="No deeds" onRow={(r) => st.select(r.bbl)} />
      <div className="nx-box-foot nx-row-verbs">
        <button type="button" className="nx-btn nx-sm" disabled={f.uncalled <= 0} onClick={() => st.callFundCapital(f.uncalled)}>Call capital</button>
        <button type="button" className="nx-btn nx-sm" disabled={f.cash < 100_000} onClick={() => st.distributeFund(f.cash)}>Distribute cash</button>
        <button type="button" className={"nx-btn nx-sm" + (game.fundPay ? " nx-on" : "")} disabled={!fundCanBuy(game) && !game.fundPay} onClick={() => st.setFundPay(!game.fundPay)}>Fund buys</button>
      </div>
    </Box>
  );
}

// ---------------------------------------------------------------- books
interface Line { k: string; v: (c: number) => number | null; strong?: boolean; neg?: boolean }

/** A statement: lines down, periods across, every figure from the engine's own view of that period. */
function Statement({ periods, lines }: { periods: string[]; lines: Line[] }) {
  return (
    <div className="nx-dt">
      <table className="nx-table nx-dt-table">
        <thead><tr><th />{periods.map((p, i) => <th key={i} className="num">{p}</th>)}</tr></thead>
        <tbody>
          {lines.map((ln) => (
            <tr key={ln.k} className={ln.strong ? "nx-strong-row" : undefined}>
              <td>{ln.strong ? <b>{ln.k}</b> : ln.k}</td>
              {periods.map((_, i) => {
                const v = ln.v(i);
                const shown = v === null ? null : ln.neg ? -v : v;
                return <td key={i} className={"num mono" + (shown !== null && shown < 0 ? " nx-neg" : "")}>{shown === null ? "—" : ln.strong ? <b>{fmtFig(shown, "usd")}</b> : fmtFig(shown, "usd")}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type BooksTab = "balance" | "pnl" | "cash";

export function CapitalBooks() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const [tab, setTab] = useState<BooksTab>("balance");
  const nw = nwOf(game, parcels);
  const realized = game.exits.reduce((a, e) => a + e.gain, 0);
  const sheets: BalanceSheetView[] = useMemo(() => [
    buildBalanceSheet(game, parcels),
    ...(game.balanceHistory ?? []).slice(-4).reverse().map(balanceSnapshotView),
  ], [game, parcels]);
  const pnls = useMemo(() => (game.pnl ?? []).slice(-5).reverse().map((e) => pnlView(game, e)), [game]);
  const years = (game.books ?? []).slice(-5).reverse();
  const appeals = useMemo(() => Object.values(game.holdings).flatMap((h) => {
    const q = taxAppealQuote(game, parcels, h.bbl);
    return q ? [{ bbl: h.bbl, addr: resolveRec(parcels, game, h.bbl)?.address ?? h.bbl, ...q }] : [];
  }), [game, parcels]);
  const pending = Object.values(game.holdings).filter((h) => h.taxAppeal);
  const b = (f: (s: BalanceSheetView) => number | undefined) => (i: number) => f(sheets[i]) ?? null;
  const p = (f: (s: (typeof pnls)[number]) => number) => (i: number) => f(pnls[i]);
  const c = (f: (s: (typeof years)[number]) => number | undefined) => (i: number) => f(years[i]) ?? null;
  return (
    <div className="nx-place">
      <StatStrip>
        <Stat label="Net worth"><Figure value={nw} fmt="usd" drill="nw" tone={nw < 0 ? "neg" : undefined} /></Stat>
        <Stat label="Cash"><Figure value={game.cash} fmt="usd" drill="cash" /></Stat>
        <Stat label="Deposits"><Figure value={depositsHeld(game)} fmt="usd" /></Stat>
        <Stat label="Realized"><Figure value={realized} fmt="usd" tone={realized < 0 ? "neg" : undefined} /></Stat>
        <Stat label="Taxes paid"><Figure value={game.taxesPaid ?? 0} fmt="usd" /></Stat>
        <Stat label="Loss banked"><Figure value={game.taxLossCarry ?? 0} fmt="usd" /></Stat>
        <Stat label="Exits"><Figure value={game.exits.length} fmt="n" /></Stat>
        <Stat label="NW 10y"><Spark pts={(game.nwHistory ?? []).slice(-120)} /></Stat>
      </StatStrip>
      <div className="nx-chips">
        {(["balance", "pnl", "cash"] as BooksTab[]).map((t) => (
          <button key={t} type="button" className={"nx-chipbtn" + (tab === t ? " on" : "")} onClick={() => setTab(t)}>
            {t === "balance" ? "Balance sheet" : t === "pnl" ? "Income" : "Cash flow"}
          </button>
        ))}
      </div>
      {tab === "balance" && (
        <Statement periods={sheets.map((s) => (s.historical ? monthLabel(s.m) : "Now"))} lines={[
          { k: "Cash", v: b((s) => s.cash) },
          { k: "Buildings", v: b((s) => s.propGross - s.landOnly) },
          { k: "Land", v: b((s) => s.landOnly) },
          { k: "Under construction", v: b((s) => s.cip) },
          { k: "Notes", v: b((s) => s.notesVal) },
          { k: "Fund interest", v: b((s) => s.fundInterest ?? 0) },
          { k: "Total assets", v: b((s) => s.totalAssets), strong: true },
          { k: "Mortgages", v: b((s) => s.mortgages), neg: true },
          { k: "Construction debt", v: b((s) => s.cipDebt), neg: true },
          { k: "Mezzanine", v: b((s) => s.mezz ?? 0), neg: true },
          { k: "Credit line", v: b((s) => s.locBal), neg: true },
          { k: "Facility", v: b((s) => s.facility), neg: true },
          { k: "Partners", v: b((s) => s.partners ?? 0), neg: true },
          { k: "Tenant deposits", v: b((s) => s.deposits), neg: true },
          { k: "Total liabilities", v: b((s) => s.totalLiab), neg: true, strong: true },
          { k: "Equity", v: b((s) => s.equity), strong: true },
        ]} />
      )}
      {tab === "pnl" && (
        <Statement periods={pnls.map((x) => x.label)} lines={[
          { k: "Rent revenue", v: p((x) => x.rev) },
          { k: "Interest income", v: p((x) => x.intInc) },
          { k: "Fees", v: p((x) => x.fees) },
          { k: "Total revenue", v: p((x) => x.totalRev), strong: true },
          { k: "Property opex", v: p((x) => x.propOpex), neg: true },
          { k: "Leasing", v: p((x) => x.leasing), neg: true },
          { k: "Capex", v: p((x) => x.capex), neg: true },
          { k: "Overhead", v: p((x) => x.ga), neg: true },
          { k: "EBITDA", v: p((x) => x.ebitda), strong: true },
          { k: "Depreciation", v: p((x) => x.depr), neg: true },
          { k: "Interest", v: p((x) => x.intExp), neg: true },
          { k: "Gains on sale", v: p((x) => x.gains) },
          { k: "Partners' share", v: p((x) => x.jv), neg: true },
          { k: "Pretax", v: p((x) => x.pretax), strong: true },
          { k: "Taxes", v: p((x) => x.taxes), neg: true },
          { k: "Net income", v: p((x) => x.net), strong: true },
        ]} />
      )}
      {tab === "cash" && (
        <Statement periods={years.map((y) => String(START_YEAR + y.yr))} lines={[
          { k: "NOI", v: c((y) => y.noi) },
          { k: "Interest", v: c((y) => y.interest) },
          { k: "Sales", v: c((y) => y.sold) },
          { k: "Borrowed", v: c((y) => y.borrowed ?? 0) },
          { k: "Debt service", v: c((y) => y.debtSvc), neg: true },
          { k: "Leasing", v: c((y) => y.leasing), neg: true },
          { k: "Capex", v: c((y) => y.capex), neg: true },
          { k: "Development", v: c((y) => y.dev), neg: true },
          { k: "Taxes", v: c((y) => y.taxes), neg: true },
          { k: "Purchases", v: c((y) => y.bought), neg: true },
          { k: "Overhead", v: c((y) => y.ga), neg: true },
          { k: "Net", v: c((y) => y.noi + y.interest + y.sold + (y.borrowed ?? 0) - y.debtSvc - y.leasing - y.capex - y.dev - y.taxes - y.bought - y.ga), strong: true },
        ]} />
      )}
      {(appeals.length > 0 || pending.length > 0) && (
        <Box head="Tax appeals">
          <DataTable id="books-appeals" cols={[
            { id: "addr", label: "Deed", get: (r) => r.addr, cell: (r) => strong(r.addr) },
            { id: "save", label: "Saving / yr", get: (r) => r.annualSavings, fmt: "usd" },
            { id: "fee", label: "Fee", get: (r) => r.fee, fmt: "usd" },
          ]} rows={appeals} rowKey={(r) => r.bbl} initialSort={{ col: "save", dir: -1 }} empty="None"
            onRow={(r) => useStore.getState().openProperty(r.bbl, "money")} />
          {pending.length > 0 && (
            <DataTable id="books-appeals-pending" cols={[
              { id: "addr", label: "Filed", get: (h) => resolveRec(parcels, game, h.bbl)?.address ?? h.bbl, cell: (h) => strong(resolveRec(parcels, game, h.bbl)?.address ?? h.bbl) },
              { id: "m", label: "Board sits", get: (h) => h.taxAppeal!.decideM, cell: (h) => mo(h.taxAppeal!.decideM) },
              { id: "odds", label: "Odds", get: (h) => h.taxAppeal!.odds, fmt: "pct" },
            ]} rows={pending} rowKey={(h) => h.bbl} />
          )}
        </Box>
      )}
    </div>
  );
}
