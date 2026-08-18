// THE RECORD — the firm's whole campaign on one strip: every deed on and off
// the book, every delivery, every mark the lending desks hold against the
// name, with the city's own weather — swans and bank seizures — dimmed in
// the margins. The year in review sits on top; under it, the net-worth curve
// with the near-deaths readable on it.
//
// Everything here is read off state the engine already keeps. No quantity is
// re-derived: exits carry their own gain and basis, the ledger's monthly
// buckets carry the cash, nwHistory carries the curve. The one thing the
// record cannot show is what the engine never wrote down — refinancings have
// no permanent event, and the per-deed log keeps only its last two dozen
// entries — and where that truncation can bite, the page says so instead of
// papering over it.
import { useId, useMemo, useState } from "react";
import { useStore } from "@/state/store";
import type { GameState } from "@/engine/types";
import { monthLabel, START_YEAR } from "@/engine/types";
import type { ParcelTable } from "@/data/types";
import { MILESTONES } from "@/engine/sim";
import { firmName, firmShort } from "@/engine/firm";
import { resolveRec } from "@/engine/value";
import { PROPERTY_HISTORY_CAP } from "@/engine/history";
import { usd, sf as fmtSf } from "@/ui/format";
import DeltaChip from "@/ui/vitals/DeltaChip";
import Spark from "@/ui/vitals/Spark";
import "./timeline.css";

// The engine trims the exit record to its last two hundred entries at every
// push site; the strip needs the same number to say when the early years
// have scrolled off.
const EXITS_CAP = 200;

const MILESTONE_LABEL: Record<string, string> = Object.fromEntries(
  MILESTONES.map((m) => [m.id, m.label]),
);
// Stamped outside the MILESTONES table (sim.ts marks the hundredth year on
// its own), so it needs its own words here.
MILESTONE_LABEL.century = "A century in town";

type Tone = "plain" | "gold" | "danger" | "dim";
type Cat =
  | "founding" | "bought" | "sold" | "build" | "delivered" | "planning"
  | "sponsor" | "milestone" | "epithet" | "swan" | "seizure" | "over";

interface Row {
  key: string;
  m: number;
  glyph: string;
  text: string;
  amount?: string;
  amountNeg?: boolean;
  bbl?: string;
  tone: Tone;
  /** City weather rather than firm history — collapsible in old years. */
  context?: boolean;
  title?: string;
  /** Square feet delivered, so the year in review can sum without re-walking. */
  sf?: number;
  cat: Cat;
}

/**
 * Every month-stamped fact in the save that carries the firm's name, merged
 * into one list. Pure read — resolveRec and the formatters are the only
 * helpers touched, and none of them steps a stream or writes state.
 */
function buildRows(game: GameState, parcels: ParcelTable): Row[] {
  const short = firmShort(game);
  const rows: Row[] = [];
  const seen = new Set<string>();
  const push = (r: Row) => {
    if (!seen.has(r.key)) { seen.add(r.key); rows.push(r); }
  };
  const addr = (bbl: string) => resolveRec(parcels, game, bbl)?.address ?? bbl;

  push({
    key: "founded", m: game.firm?.foundedM ?? 0, glyph: "❦",
    text: `${firmName(game)} opens its doors.`,
    tone: "gold", cat: "founding",
  });

  // Exits are the canonical record of deeds leaving the book — forced ones
  // included, which is why the sponsor's "forced" marks dedupe against them.
  const exits = game.exits ?? [];
  const forcedExitAt = new Set<string>();
  exits.forEach((e, i) => {
    if (e.forced) forcedExitAt.add(`${e.soldM}:${e.address}`);
    const mult = e.basis > 0 ? ` · ${(e.price / e.basis).toFixed(2)}x` : "";
    push({
      key: `exit:${e.bbl}:${e.soldM}:${i}`,
      m: e.soldM,
      glyph: e.forced ? "✕" : "○",
      text: e.forced ? `Taken back — ${e.address}` : `Sold ${e.address}`,
      amount: `${e.gain >= 0 ? "+" : ""}${usd(e.gain)}${mult}`,
      amountNeg: e.gain < 0,
      bbl: e.bbl,
      tone: e.forced ? "danger" : "plain",
      title: e.forced
        ? "Taken, not sold — a foreclosure, a receiver's sale, or keys handed back."
        : `Bought ${monthLabel(e.boughtM)} · ${usd(e.basis)} basis → ${usd(e.price)} price`,
      cat: "sold",
    });
  });

  // The permanent per-deed log, filtered to entries where the firm was a
  // party. Purchases come from here first because the log holds the price
  // paid; the live-holdings pass below is the fallback for deeds whose log
  // has rolled past the purchase.
  const exitSpans = new Map<string, { a: number; b: number }[]>();
  for (const e of exits) {
    const l = exitSpans.get(e.bbl) ?? [];
    l.push({ a: e.boughtM, b: e.soldM });
    exitSpans.set(e.bbl, l);
  }
  // Planning events carry no party — a variance ruling is a fact about the
  // site — so ownership at the time is the test for whose record it is.
  const ownedThen = (bbl: string, m: number) => {
    const h = game.holdings[bbl];
    if (h && m >= h.boughtM) return true;
    return (exitSpans.get(bbl) ?? []).some((x) => m >= x.a && m <= x.b);
  };
  for (const [bbl, log] of Object.entries(game.propertyLog ?? {})) {
    for (const e of log) {
      if (e.kind === "trade" && e.party === short) {
        push({
          key: `bought:${bbl}:${e.m}`, m: e.m, glyph: "●",
          text: `Bought ${addr(bbl)}`,
          amount: e.amount ? usd(e.amount) : undefined,
          title: e.outcome ? `Closed ${e.outcome}` : undefined,
          bbl, tone: "plain", cat: "bought",
        });
      } else if (e.kind === "build-start" && e.party === short) {
        push({
          key: `build:${bbl}:${e.m}`, m: e.m, glyph: "△",
          text: `Broke ground at ${addr(bbl)} — ${e.floors ?? "?"} floors, ${e.sf ? fmtSf(e.sf) : "a project"} of ${e.use ?? "mixed use"}`,
          bbl, tone: "plain", cat: "build",
        });
      } else if (e.kind === "delivered" && e.party === short) {
        push({
          key: `delivered:${bbl}:${e.m}`, m: e.m, glyph: "▲",
          text: `Delivered ${addr(bbl)} — ${e.sf ? fmtSf(e.sf) : "new space"} of ${e.use ?? "mixed use"}`,
          bbl, tone: "plain", cat: "delivered", sf: e.sf,
        });
      } else if (e.kind === "planning" && ownedThen(bbl, e.m)) {
        push({
          key: `planning:${bbl}:${e.m}:${e.outcome ?? ""}`, m: e.m, glyph: "§",
          text: `${addr(bbl)} — ${e.outcome ?? "the legal envelope changed"}`,
          bbl, tone: "plain", cat: "planning",
        });
      }
    }
  }

  // Live holdings: the fallback spine. costBasis is price plus closing costs
  // net of any 1031 rolled in — labelled as basis so it is not read as the
  // print. Deduped by the same key the log rows claim first.
  for (const h of Object.values(game.holdings)) {
    push({
      key: `bought:${h.bbl}:${h.boughtM}`, m: h.boughtM, glyph: "●",
      text: `Bought ${addr(h.bbl)}`,
      amount: usd(h.costBasis),
      title: "Cost basis — price plus closing costs, net of any 1031 rolled in.",
      bbl: h.bbl, tone: "plain", cat: "bought",
    });
    if (h.deliveredM !== undefined) {
      const rec = resolveRec(parcels, game, h.bbl);
      push({
        key: `delivered:${h.bbl}:${h.deliveredM}`, m: h.deliveredM, glyph: "▲",
        text: `Delivered ${addr(h.bbl)}${rec && rec.bldgArea > 0 ? ` — ${fmtSf(rec.bldgArea)}` : ""}`,
        bbl: h.bbl, tone: "plain", cat: "delivered",
        sf: rec && rec.bldgArea > 0 ? rec.bldgArea : undefined,
      });
    }
  }

  // What the lending desks hold against the name. A "forced" mark lands in
  // the same month as its forced exit, so it dedupes against that row.
  (game.sponsor?.events ?? []).forEach((e, i) => {
    if (e.kind === "forced" && forcedExitAt.has(`${e.m}:${e.address}`)) return;
    const text =
      e.kind === "deficiency" ? `Deficiency paid on ${e.address}`
      : e.kind === "seized" ? `Seized by creditors — ${e.address}`
      : e.kind === "dpo" ? `Debt settled at a discount — ${e.address}`
      : `Sold under pressure — ${e.address}`;
    push({
      key: `sponsor:${i}:${e.m}:${e.kind}`, m: e.m, glyph: "✕", text,
      amount: e.amount > 0 ? `${usd(-e.amount)} hole` : undefined,
      amountNeg: e.amount > 0,
      tone: "danger", cat: "sponsor",
      title: "On the sponsor record — every desk in town prices off it for a decade.",
    });
  });

  for (const [id, m] of Object.entries(game.milestones ?? {})) {
    const label = MILESTONE_LABEL[id];
    if (!label) continue;
    push({ key: `milestone:${id}`, m, glyph: "◆", text: `Milestone — ${label.replace(/\.$/, "")}.`, tone: "gold", cat: "milestone" });
  }

  for (const ep of game.firm?.epithets ?? []) {
    push({
      key: `epithet:${ep.id}`, m: ep.sinceM, glyph: "“",
      text: `The street starts calling you ${ep.text}.`,
      tone: "gold", cat: "epithet",
    });
  }

  // The city's weather — level events and bank seizures. Dimmed: these are
  // the context the firm rows happened in, not the firm's own record. The
  // seizure list is trimmed by the engine to the funding market's memory
  // (about three years), so only recent panics appear here.
  (game.swanLog ?? []).forEach((sw, i) => {
    push({
      key: `swan:${i}:${sw.m}`, m: sw.m,
      glyph: sw.dir < 0 ? "◉" : "◎",
      text: sw.title,
      tone: "dim", context: true, cat: "swan",
      title: `${sw.dir < 0 ? "A black swan" : "A white swan"} on ${sw.key} — the level shift lands over ${sw.glideM} months.`,
    });
  });
  (game.seizures ?? []).forEach((m, i) => {
    push({
      key: `seizure:${i}:${m}`, m,
      text: "A lending desk in town is seized; its book passes to the receiver.",
      glyph: "†", tone: "dim", context: true, cat: "seizure",
    });
  });

  if (game.gameOver) {
    push({
      key: "over", m: game.month, glyph: "∎",
      text: game.gameOver.cause,
      tone: "danger", cat: "over",
      title: "The ledger closes here.",
    });
  }

  return rows;
}

// Same rounding ladder as Chart.tsx's private ticks(). Not imported because
// the house LineChart has no notion of event markers or a century of year
// gridlines, and this page needs both — so it draws its own axes.
function niceTicks(lo: number, hi: number, want = 4): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / want;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((c) => c >= raw) ?? mag * 10;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(v);
  return out;
}

/**
 * The full-campaign net-worth line: nwHistory is one mark per month since
 * founding, so the dips ARE the near-deaths, and the zero line is drawn
 * solid because it is the line the whole game is played against. Swans,
 * bank seizures and the end of the run sit on the curve as shaped marks —
 * filled against hollow, circle against square — with the story on hover.
 */
function NetWorthLine({ game }: { game: GameState }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const nw = game.nwHistory ?? [];
  if (nw.length < 2) {
    return <div className="hint">Not enough months on the book to draw the curve yet.</div>;
  }
  const W = 760, H = 200, PL = 58, PR = 14, PT = 12, PB = 22;
  // Zero-based on purpose: insolvency is net worth through the floor, and a
  // scale that crops the floor out hides the only reading that matters.
  let lo = 0, hi = -Infinity;
  for (const v of nw) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!(hi > lo)) hi = lo + 1;
  const padY = (hi - lo) * 0.06;
  hi += padY;
  if (lo < 0) lo -= padY;
  const n = nw.length;
  const px = (i: number) => PL + ((W - PL - PR) * i) / (n - 1);
  const py = (v: number) => PT + (H - PT - PB) * (1 - (v - lo) / (hi - lo));
  const yTicks = niceTicks(lo, hi, 4);
  // Year gridlines, thinned so a two-century campaign does not draw two
  // hundred of them: every stride-th January gets a rule and a label.
  const years = Math.ceil(n / 12);
  const strideYears = years <= 8 ? 1 : years <= 16 ? 2 : years <= 40 ? 5 : years <= 80 ? 10 : 20;
  const xTicks: number[] = [];
  for (let m = 0; m < n; m += 12 * strideYears) xTicks.push(m);
  const atM = (m: number) => {
    const i = Math.max(0, Math.min(m, n - 1));
    return { x: px(i), y: py(nw[i] ?? 0) };
  };
  const swans = game.swanLog ?? [];
  const seizures = game.seizures ?? [];

  return (
    <div className="tl-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", display: "block", overflow: "visible" }}
        role="img"
        aria-label={`Net worth by month, ${monthLabel(0)} to ${monthLabel(n - 1)}`}
      >
        <defs>
          <linearGradient id={`${uid}-nw`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2f7a72" stopOpacity={0.26} />
            <stop offset="70%" stopColor="#2f7a72" stopOpacity={0.05} />
            <stop offset="100%" stopColor="#2f7a72" stopOpacity={0} />
          </linearGradient>
        </defs>
        {xTicks.map((m) => (
          <g key={`x${m}`}>
            <line
              x1={px(m)} x2={px(m)} y1={PT} y2={H - PB}
              stroke="#b9b099" strokeWidth={0.7} strokeDasharray="2 4" opacity={0.7}
              vectorEffect="non-scaling-stroke"
            />
            <text x={px(m)} y={H - 6} textAnchor="middle" fontSize={10} fill="#8b8370" style={{ fontFamily: "var(--mono)" }}>
              {START_YEAR + Math.floor(m / 12)}
            </text>
          </g>
        ))}
        {yTicks.map((v) => (
          <g key={`y${v}`}>
            <line
              x1={PL} x2={W - PR} y1={py(v)} y2={py(v)}
              stroke={v === 0 ? "#9b9384" : "#b9b099"}
              strokeWidth={v === 0 ? 1.2 : 0.7}
              strokeDasharray={v === 0 ? undefined : "2 4"}
              opacity={v === 0 ? 1 : 0.75}
              vectorEffect="non-scaling-stroke"
            />
            <text x={PL - 7} y={py(v) + 3.5} textAnchor="end" fontSize={10} fill="#8b8370" style={{ fontFamily: "var(--mono)" }}>
              {usd(v)}
            </text>
          </g>
        ))}
        <line x1={PL} x2={PL} y1={PT} y2={H - PB} stroke="#b1a891" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <polygon
          points={`${px(0)},${py(Math.max(0, lo))} ` + nw.map((v, i) => `${px(i)},${py(v)}`).join(" ") + ` ${px(n - 1)},${py(Math.max(0, lo))}`}
          fill={`url(#${uid}-nw)`}
          stroke="none"
        />
        <polyline
          points={nw.map((v, i) => `${px(i)},${py(v)}`).join(" ")}
          fill="none" stroke="#2f7a72" strokeWidth={1.8}
          vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round"
        />
        {swans.map((sw, i) => {
          const p = atM(sw.m);
          return (
            <circle
              key={`sw${i}`} cx={p.x} cy={p.y} r={3.6}
              fill={sw.dir < 0 ? "#2b251a" : "#f6f1e2"} stroke="#2b251a" strokeWidth={1.1}
            >
              <title>{`${monthLabel(sw.m)} — ${sw.title}`}</title>
            </circle>
          );
        })}
        {seizures.map((m, i) => {
          const p = atM(m);
          return (
            <rect
              key={`sz${i}`} x={p.x - 3.2} y={p.y - 3.2} width={6.4} height={6.4}
              fill="#f6f1e2" stroke="#a8402e" strokeWidth={1.2}
            >
              <title>{`${monthLabel(m)} — a lending desk seized; the funding market prices the panic.`}</title>
            </rect>
          );
        })}
        {game.gameOver && (
          <text x={px(n - 1)} y={py(nw[n - 1] ?? 0) - 6} textAnchor="middle" fontSize={13} fill="#a8402e">
            ✕<title>{`${monthLabel(game.month)} — ${game.gameOver.cause}`}</title>
          </text>
        )}
      </svg>
      <div className="tl-chart-key">
        ● a black swan · ○ a white one · □ a lending desk seized{game.gameOver ? " · ✕ the ledger closes" : ""} — hover a mark for the story.
      </div>
    </div>
  );
}

function TimelineRow({ r }: { r: Row }) {
  const inner = (
    <>
      <span className="tl-glyph" aria-hidden="true">{r.glyph}</span>
      <span className="tl-when mono">{monthLabel(r.m)}</span>
      <span className="tl-text">
        {r.text}
        {r.bbl ? <span className="tl-fly" aria-hidden="true"> ✈</span> : null}
      </span>
      {r.amount ? <span className={"tl-amt mono" + (r.amountNeg ? " neg" : "")}>{r.amount}</span> : <span />}
    </>
  );
  const cls = "tl-row" + (r.tone !== "plain" ? ` tl-${r.tone}` : "") + ` tl-cat-${r.cat}`;
  if (r.bbl) {
    const bbl = r.bbl;
    return (
      <button type="button" className={cls} title={r.title} onClick={() => useStore.getState().focus(bbl, true)}>
        {inner}
      </button>
    );
  }
  return <div className={cls} title={r.title}>{inner}</div>;
}

// How many year-groups render before the "show earlier" expander, and how
// many each press adds. The point is never to mount a two-century strip in
// one go — the DOM is the budget, not the record.
const YEARS_FIRST = 12;
const YEARS_PER_MORE = 24;
// Past this campaign age, city-context rows in years older than the recent
// window collapse to a one-line count per year.
const COLLAPSE_AFTER_YEARS = 40;
const CONTEXT_KEEP_YEARS = 15;

export default function FirmTimeline() {
  // Mounted only while the page is open (GamePanels gates on page === "firm"),
  // so a full game subscription here costs nothing while the strip is closed.
  const game = useStore((s) => s.game);
  const parcels = useStore((s) => s.parcels);
  const [shownYears, setShownYears] = useState(YEARS_FIRST);

  const rows = useMemo(
    () => (game && parcels ? buildRows(game, parcels) : []),
    [game, parcels],
  );

  const groups = useMemo(() => {
    const byYear = new Map<number, Row[]>();
    for (const r of rows) {
      const y = Math.floor(r.m / 12);
      const l = byYear.get(y);
      if (l) l.push(r);
      else byYear.set(y, [r]);
    }
    return [...byYear.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([y, rs]) => ({ y, rows: rs.sort((a, b) => b.m - a.m) }));
  }, [rows]);

  const review = useMemo(() => {
    if (!game) return null;
    const m = game.month;
    const start = m - 11;
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
    const soldExits = exits.filter((e) => e.soldM >= start && e.soldM <= m);
    const forcedN = soldExits.filter((e) => e.forced).length;
    const boughtN =
      Object.values(game.holdings).filter((h) => h.boughtM >= start && h.boughtM <= m).length
      + exits.filter((e) => e.boughtM >= start && e.boughtM <= m).length;
    let sfDelivered = 0;
    let bigDelivery: Row | null = null;
    for (const r of rows) {
      if (r.cat !== "delivered" || r.m < start || r.m > m || !r.sf) continue;
      sfDelivered += r.sf;
      if (!bigDelivery || r.sf > (bigDelivery.sf ?? 0)) bigDelivery = r;
    }
    // The largest single mark of the year: the exit with the biggest realized
    // move in either direction, and failing that the biggest delivery.
    let bigExit: (typeof soldExits)[number] | null = null;
    for (const e of soldExits) if (!bigExit || Math.abs(e.gain) > Math.abs(bigExit.gain)) bigExit = e;
    const biggest = bigExit
      ? `the ${bigExit.forced ? "loss of" : "sale of"} ${bigExit.address}, ${bigExit.gain >= 0 ? "+" : ""}${usd(bigExit.gain)} realized`
      : bigDelivery
        ? `delivering ${fmtSf(bigDelivery.sf ?? 0)} at ${resolveRec(parcels ?? {}, game, bigDelivery.bbl ?? "")?.address ?? "a site of your own"}`
        : null;
    return {
      m, dNW, nwNow, cashIn, cashOut, haveBooks,
      boughtN, soldN: soldExits.length, forcedN, sfDelivered, biggest,
      spark: nw.slice(Math.max(0, nw.length - 13)),
    };
  }, [game, parcels, rows]);

  if (!game || !parcels || !review) return null;

  const exits = game.exits ?? [];
  const young =
    exits.length === 0
    && Object.keys(game.holdings).length === 0
    && !rows.some((r) =>
      r.cat === "bought" || r.cat === "sold" || r.cat === "build"
      || r.cat === "delivered" || r.cat === "planning" || r.cat === "sponsor");

  if (young) {
    return (
      <div className="tl-empty">
        <div className="tl-founding">
          <span className="tl-glyph-inline" aria-hidden="true">❦</span>
          {firmName(game)} — founded {monthLabel(game.firm?.foundedM ?? 0)}.
        </div>
        <div className="hint">
          The record begins with the first deed. Nothing reaches this strip except what the
          firm buys, builds, signs and survives — and the Marketplace is where that starts.
        </div>
        <button className="btn" onClick={() => useStore.getState().setPage("market")}>
          Open the Marketplace →
        </button>
      </div>
    );
  }

  const campaignYears = Math.floor(game.month / 12) + 1;
  const visible = groups.slice(0, shownYears);
  const hiddenYears = groups.length - visible.length;
  // The caps that can silently eat early history: the exit record keeps its
  // last two hundred, each deed's log its last two dozen entries.
  const truncated =
    exits.length >= EXITS_CAP
    || Object.values(game.propertyLog ?? {}).some((l) => l.length >= PROPERTY_HISTORY_CAP);

  const grewWord = review.dNW >= 0 ? "more" : "less";
  const yearOne = game.month < 12;
  const windowWord = yearOne ? `Since founding` : `Twelve months to ${monthLabel(review.m)}`;
  // Same window in every sentence: a first-year firm's delta runs from
  // founding, and saying "a year ago" against a five-month-old number is
  // the two-answers fault in prose.
  const againstWord = yearOne ? "than at founding" : "than it was a year ago";

  return (
    <div>
      <div className="page-section" style={{ marginTop: 6 }}>
        <div className="page-section-head">The year in review</div>
        <div className="tl-lede">
          {windowWord}: {review.boughtN} deed{review.boughtN === 1 ? "" : "s"} onto the book and{" "}
          {review.soldN} off{review.forcedN > 0 ? ` — ${review.forcedN} of them taken, not sold` : ""},{" "}
          {review.sfDelivered > 0 ? `${fmtSf(review.sfDelivered)} delivered` : "nothing delivered"}.{" "}
          {review.biggest ? <>The largest single mark was {review.biggest}. </> : null}
          The firm is worth {usd(Math.abs(review.dNW))} {grewWord} {againstWord}.
        </div>
        <div className="tl-stats">
          <div className="tl-stat">
            <div className="tl-stat-label">Net worth</div>
            <div className="tl-stat-value">
              {usd(review.nwNow)}
              <DeltaChip value={review.dNW} fmt={usd} title={yearOne ? "Against founding" : "Against twelve months ago"} />
              <Spark values={review.spark} title={yearOne ? "Net worth since founding" : "Net worth, last twelve months"} />
            </div>
          </div>
          <div className="tl-stat">
            <div className="tl-stat-label">Cash generated</div>
            <div
              className="tl-stat-value"
              title="NOI, sale proceeds and interest banked over the window. Borrowings and fund flows move cash too, but they are financing, not generation."
            >
              {review.haveBooks ? usd(review.cashIn) : "—"}
            </div>
          </div>
          <div className="tl-stat">
            <div className="tl-stat-label">Cash spent</div>
            <div
              className="tl-stat-value"
              title="Debt service, leasing, capex, development, taxes, acquisitions and overhead over the window."
            >
              {review.haveBooks ? usd(review.cashOut) : "—"}
            </div>
          </div>
          <div className="tl-stat">
            <div className="tl-stat-label">Deeds on / off</div>
            <div className="tl-stat-value">
              +{review.boughtN} / −{review.soldN}
              {review.forcedN > 0 ? <span className="neg">({review.forcedN} taken)</span> : null}
            </div>
          </div>
          <div className="tl-stat">
            <div className="tl-stat-label">Delivered</div>
            <div className="tl-stat-value">{review.sfDelivered > 0 ? fmtSf(review.sfDelivered) : "—"}</div>
          </div>
        </div>
      </div>

      <div className="page-section">
        <div className="page-section-head">Net worth since founding</div>
        <NetWorthLine game={game} />
      </div>

      <div className="page-section">
        <div className="page-section-head">The strip · newest first</div>
        <div className="hint">
          Rows marked ✈ are about a deed — click one and the camera goes there. Dimmed rows
          are the city's weather, not the firm's record.
        </div>
        {visible.map(({ y, rows: rs }, gi) => {
          const collapseCtx = campaignYears > COLLAPSE_AFTER_YEARS && gi >= CONTEXT_KEEP_YEARS;
          const main = collapseCtx ? rs.filter((r) => !r.context) : rs;
          const swansN = collapseCtx ? rs.filter((r) => r.cat === "swan").length : 0;
          const banksN = collapseCtx ? rs.filter((r) => r.cat === "seizure").length : 0;
          const ctxBits = [
            swansN > 0 ? `${swansN} level event${swansN === 1 ? "" : "s"}` : null,
            banksN > 0 ? `${banksN} desk seizure${banksN === 1 ? "" : "s"}` : null,
          ].filter((b): b is string => b !== null);
          return (
            <div key={y} className="tl-yeargroup">
              <div className="tl-year">{START_YEAR + y}</div>
              <div className="tl-rows">
                {main.map((r) => <TimelineRow key={r.key} r={r} />)}
                {ctxBits.length > 0 && (
                  <div className="tl-row tl-dim">
                    <span className="tl-glyph" aria-hidden="true">·</span>
                    <span className="tl-when mono" />
                    <span className="tl-text">Around town that year: {ctxBits.join(", ")}.</span>
                    <span />
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {hiddenYears > 0 && (
          <button className="btn tl-more" onClick={() => setShownYears((v) => v + YEARS_PER_MORE)}>
            Show the earlier record — {hiddenYears} more year{hiddenYears === 1 ? "" : "s"}
          </button>
        )}
        {truncated && (
          <div className="hint">
            The ledgers are finite — a deed's log keeps its last {PROPERTY_HISTORY_CAP} entries
            and the exit record its last {EXITS_CAP} — so the earliest years above are
            summarized from what the record kept.
          </div>
        )}
      </div>
    </div>
  );
}
