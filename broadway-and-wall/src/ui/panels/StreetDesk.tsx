import { useEffect, useRef, useState } from "react";
import { derive, nwOf } from "@/ui/derive";
import { useStore } from "@/state/store";
import { monthLabel, type Rival } from "@/engine/types";
import { DataTable, type Col } from "@/ui/next/DataTable";
import { distressTally } from "@/engine/history";
import { resolveRec, portfolioMark } from "@/engine/value";
import { marketAppetite, markRival, rivalCondition, firmEntryPitch } from "@/engine/rivals";
import { ownerById } from "@/engine/ownership";
import { OwnerStatement } from "@/ui/panels/OwnersDesk";
import { firmName } from "@/engine/firm";
import { usd, sf } from "@/ui/format";
import { Row, STYLE_MAX, CONDITION_WORD, STYLE_WORD } from "@/ui/panels/shared";
import { TakePrivateDesk, TakenPrivateRecord } from "@/ui/panels/TakePrivateDesk";
import { HeadlinerStrip, RaceChart, FirmPage, StreetTicker } from "@/ui/panels/CompetitorCards";
import { labelOf } from "@/engine/storyline";
import Fold from "@/ui/Fold";

// THE STREET. Who else is buying, what they own, and how much rope they have
// left. This is not decoration: the appetite number at the top is the same one
// that decides whether your lowball gets refused, and a firm sliding toward
// its covenants is a firm whose buildings are about to be cheap.
/**
 * WHAT A RIVAL IS WORTH, once — gross assets marked the way `markRival` marks
 * them, less the debt against them, plus what is in the bank. It is the same
 * arithmetic the player's own Books page calls net worth, which is the point:
 * a league table is only a league table if both sides are measured the same
 * way. Written down here because three places on this page print it and one
 * quantity does not get three expressions.
 */
export { rivalEquity } from "@/engine/standing";
import { rivalEquity } from "@/engine/standing";
import { targetCapital } from "@/engine/lenders";
import { NOTICE_M, FORECLOSE_M } from "@/engine/workout";

/** `q` filters the table by firm or principal name (City → Players' search
 *  box); the league-table summary above it always counts everyone. */
export function TheStreet({ q = "", scrollToYou = 0 }: { q?: string; scrollToYou?: number } = {}) {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const focus = useStore((s) => s.focus);
  // Coming back from "show on the map", their row is open again.
  const [open, setOpen] = useState<string | null>(() => useStore.getState().firmFocus ?? (useStore.getState().mapFilter === "firm" ? useStore.getState().mapFirm ?? null : null));
  // A FIRM'S NAME CLICKED ELSEWHERE (a deed's owner, the map's firm chip) opens its row here, in view
  const firmFocus = useStore((s) => s.firmFocus);
  useEffect(() => {
    if (!firmFocus) return;
    setOpen(firmFocus);
    const t = window.setTimeout(() => document.querySelector(`[data-firm="${firmFocus}"]`)?.scrollIntoView({ block: "start" }), 80);
    return () => window.clearTimeout(t);
  }, [firmFocus]);
  // YOU ARE THE ROW YOU CAME FOR. The top bar's Street readout opens this
  // table, and in most of a career your row is twenty-odd firms down — below
  // the fold, under the leaders. Bring it into view when a link brought you
  // here (`scrollToYou` counts those) — not when you opened City → Players
  // from its tab, where the filter strip and search box are what you came for.
  const youRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scrollToYou > 0) youRef.current?.querySelector("tr.on")?.scrollIntoView({ block: "center" }); }, [scrollToYou]);
  // A card opened from the table lands at its top.
  // The page is kept mounted between visits: opened again from the rail (no
  // firm asked for, not back from "show on the map"), it opens on the table.
  const page = useStore((s) => s.page);
  useEffect(() => {
    if (page !== "players") return;
    const st = useStore.getState();
    if (!st.firmFocus && !(st.mapFilter === "firm" && st.mapFirm)) setOpen(null);
  }, [page]);
  const cardRef = useRef<HTMLDivElement>(null);
  const opened = useRef(open);
  useEffect(() => {
    if (open && open !== opened.current) cardRef.current?.scrollIntoView({ block: "start" });
    opened.current = open;
  }, [open]);
  const rivals = game.rivals ?? [];
  // Marked once per month, not once per click: opening a firm's card used to
  // re-mark every rival's whole book and the player's own.
  // Same number as TopBar / Books — a street rank that re-derives equity is
  // one quantity with two answers (facility, loc, deposits, CIP, notes).
  // Once per state for every screen that prints it (ui/derive), so a revisit
  // in the same month marks nothing.
  const playerEquity = nwOf(game, parcels);
  // YOUR FIRM ON THE BOARD, measured the rivals' way: gross assets marked,
  // net equity the Books page's own number, and the debt the identity between
  // them (assets + cash − equity) — so the row cannot disagree with the rank.
  const mine = derive(game, "street.mine", () => {
    const gav = portfolioMark(game, parcels).gav;
    const cash = Math.max(0, game.cash);
    const debt = Math.max(0, gav + game.cash - playerEquity);
    const buildings = Object.keys(game.holdings).filter((b) => !game.merged?.[b]).length;
    return { gav, cash, debt, buildings, ltv: gav > 0 ? debt / gav : 0 };
  }, [parcels]);
  const marked = derive(game, "street.marked", () => rivals.map((r) => ({ r, m: markRival(game, parcels, r) }))
    // by net equity, the league table's own measure, so your row stands
    // exactly at your rank; failed firms at the foot
    .sort((a, b) => (a.r.failedM !== undefined ? 1 : 0) - (b.r.failedM !== undefined ? 1 : 0) || rivalEquity(b.m, b.r) - rivalEquity(a.m, a.r)),
  [parcels]);
  if (!rivals.length) return null;
  const needle = q.trim().toLowerCase();
  // Firms only (ECONOMY.md "Firms only"): the search reads firm names.
  const hit = (name: string) => !needle || name.toLowerCase().includes(needle);
  const noHit = !!needle && !hit(firmName(game)) && !marked.some(({ r }) => hit(r.name));
  const appetite = marketAppetite(game);
  const approach = game.takePrivate?.offer && game.month <= game.takePrivate.offer.expiresM ? game.takePrivate.offer : null;
  const openRival = open ? rivals.find((r) => r.id === open) : undefined;

  // ONE FIRM'S CARD, in place of the table (a click on a row opens it; "All
  // firms" goes back). The drawer is the same one the table used to expand
  // into: OwnerStatement, the firm page and the take-private desk.
  if (openRival) {
    const r = openRival;
    const m = marked.find((x) => x.r.id === r.id)?.m ?? markRival(game, parcels, r);
    const dead = r.failedM !== undefined;
    const view = ownerById(game, parcels, r.id);
    return (
      <div ref={cardRef} data-firm={r.id}>
        <div className="btn-row" style={{ alignItems: "baseline", marginBottom: 6 }}>
          <button type="button" className="btn btn-sm" onClick={() => { setOpen(null); useStore.getState().openFirm(null); }}>← All firms</button>
          <div className="page-section" style={{ margin: 0 }}>{r.name}</div>
          <span className="dim">{statusOf(r, m)}</span>
        </div>
        {view && (
          <OwnerStatement
            o={view}
            onFocus={(b) => focus(b, true)}
            extra={<FirmPage r={r} />}
            extraLate={
              <>
                {/* BUY THE WHOLE FIRM. The entity desk — see engine/takeprivate.ts. */}
                {!dead && <TakePrivateDesk firmId={r.id} />}
                {/* WHAT A FIRM HAS THAT A HOLDER DOES NOT: a covenant it is
                    running against, a book that fills and empties, a capital
                    plan it can be short of the cash for, and partners it has
                    already paid. */}
                <div className="grid" style={{ margin: "6px 0" }}>
                  <Row k="Max LTV" v={`${(STYLE_MAX[r.style] * 100).toFixed(0)}% LTV`} bad={m.ltv > STYLE_MAX[r.style]} />
                  {r.occ !== undefined && (
                    <Row k="Portfolio occupancy" v={`${(r.occ * 100).toFixed(0)}%`} bad={r.occ < 0.8} />
                  )}
                  <Row k="Portfolio condition"
                    v={`${CONDITION_WORD[rivalCondition(r)]} · ${usd(r.capexYr ?? 0)} capex YTD`}
                    bad={(r.condIdx ?? 1) < 0.55} />
                  <Row k="Distributed to date" v={usd(r.distributed ?? 0)}
                    title="Paid out · not on balance sheet" />
                  <Row k="Founded" v={r.bornM > 0 ? monthLabel(r.bornM) : "pre-start"} />
                  {r.spawnedFrom && (
                    <Row k="Spun out of" v={r.spawnedFrom.firmName} />
                  )}
                </div>
                {/* WHAT THEY HAVE IN THE GROUND: money spent, debt drawn,
                    nothing earning — and the space coming for your tenants. */}
                {(() => {
                  const jobs = (game.cityJobs ?? []).filter((j) => j.firmId === r.id);
                  if (!jobs.length) return null;
                  return (
                    <>
                      <div className="page-section" style={{ marginTop: 4 }}>
                        Under construction · {jobs.length}
                      </div>
                      <div className="mini-list">
                        {jobs.map((j) => {
                          const rec = resolveRec(parcels, game, j.bbl);
                          const pct = Math.min(100, Math.max(0, ((game.month - j.startM) / Math.max(1, j.deliverM - j.startM)) * 100));
                          return (
                            <button key={j.bbl} className="neighbor"
                              onClick={(ev) => { ev.stopPropagation(); focus(j.bbl, true); }}>
                              <span className="neighbor-addr">{rec?.address ?? j.bbl}</span>
                              <span className="neighbor-meta">
                                {sf(j.sf)} {j.use} · {j.floors} fl · {pct.toFixed(0)}% ·{" "}
                                {j.orphaned ? "stalled · sponsor failed" : `due ${monthLabel(j.deliverM)}`}
                                {j.debt ? ` · ${usd(j.debt)} drawn` : ""}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  );
                })()}
              </>
            }
          />
        )}
      </div>
    );
  }

  // THE FIRM TABLE FIRST (CLEANUP_PLAN §3): every firm on one line, every
  // column sorts, a click opens the firm's card. Deals are the buys and sales
  // the street log (engine/firmLog) holds for the last twelve months.
  const deals = new Map<string, number>();
  for (const x of game.firmLog ?? []) {
    if (x.m > game.month - 12 && (x.kind === "buy" || x.kind === "sell")) deals.set(x.firmId, (deals.get(x.firmId) ?? 0) + 1);
  }
  // Your own row counts the same thing from your deeds: buys still held, plus
  // every buy and every sale on the exits record, inside the twelve months.
  // (month 0 is the family book handed over at the start, not a trade)
  const since = Math.max(0, game.month - 12);
  const yours = Object.values(game.holdings).filter((h) => h.boughtM > since).length
    + (game.exits ?? []).reduce((n, e) => n + (e.soldM > since ? 1 : 0) + (e.boughtM > since ? 1 : 0), 0);
  const live = marked.filter(({ r }) => r.failedM === undefined);
  const rank = live.filter(({ r, m }) => rivalEquity(m, r) > playerEquity).length + 1;
  const rows: FirmRow[] = [
    {
      id: YOU, name: firmName(game), you: true, dead: false, style: "Yours", bldgs: mine.buildings, gav: mine.gav,
      debt: mine.debt, eq: playerEquity, ltv: mine.gav > 0 ? mine.ltv : null, cash: mine.cash, deals: yours,
      status: `${rank} of ${live.length + 1} by net equity`, from: "",
    },
    ...marked.map(({ r, m }): FirmRow => {
      const dead = r.failedM !== undefined;
      return {
        id: r.id, name: r.name, you: false, dead, style: r.sheet ? labelOf(r) : STYLE_WORD[r.style],
        bldgs: r.bbls.length, gav: dead ? null : m.aum, debt: dead ? null : r.debt, eq: dead ? null : rivalEquity(m, r),
        ltv: dead || m.aum <= 0 ? null : m.ltv, cash: dead ? null : Math.max(0, r.cash), deals: deals.get(r.id) ?? 0,
        status: statusOf(r, m), from: r.spawnedFrom?.firmName ?? "",
      };
    }),
  ].filter((row) => hit(row.name));
  const ep = firmEntryPitch(game);
  const streetOpen = ep.leverage > 0 && ep.product > 0 && ep.pitch > 0;
  const entryWhy = !streetOpen
    ? ep.leverage <= 0 ? "Closed: negative leverage (cap rates below debt cost)" : "Closed: no trades in 12 months"
    : `Open: positive leverage · ${ep.traded} trade${ep.traded === 1 ? "" : "s"} across ${ep.firms} firm${ep.firms === 1 ? "" : "s"} in 12 months${ep.thin > 1.15 ? " · few bidders" : ""}`;
  const bids = game.founderBids ?? [];
  const board = [{ name: firmName(game), eq: playerEquity }, ...live.map((x) => ({ name: x.r.name, eq: rivalEquity(x.m, x.r) }))]
    .sort((a, b) => b.eq - a.eq);
  return (
    <>
      {/* A BOARD THAT HAS COME TO YOU — the inbox item lands here. */}
      {approach && (
        <div className="hint" style={{ borderLeft: "3px solid var(--accent, #8a6d1f)", paddingLeft: 8, cursor: "pointer" }}
          title={approach.why} onClick={() => setOpen(approach.firmId)}>
          {approach.name} · take-private ask {usd(approach.ask)} · expires {monthLabel(approach.expiresM)}
        </div>
      )}
      <div className="grid" style={{ marginBottom: 8 }}>
        <Row k="Your rank" v={`${rank} of ${live.length + 1} by equity`} strong bad={rank > (live.length + 1) / 2} />
        <Row k="Largest firm" v={`${board[0].name} · ${usd(board[0].eq)}`} />
        <Row k="Buyer demand" v={appetite < 0.6 ? "none" : appetite < 0.9 ? "thin" : appetite > 1.15 ? "strong" : "normal"} />
        {/* THE DOOR TO THE STREET: firmEntryPitch is the engine's own raise
            gate, pure, the same call `pnpm firms` audits. */}
        <Row k="New firm entry" v={streetOpen ? `open · ${ep.traded} trades / 12m` : "closed"} title={entryWhy} />
        {bids.map((b) => (
          <Row
            key={`${b.fromFirmId}:${b.readyM}`}
            k="Raising now"
            v={`Spin-out from ${b.fromFirmName}`
              + (b.readyM > game.month
                ? ` · from ${monthLabel(b.readyM)}`
                : ` · ${Math.max(0, FOUNDER_WINDOW_M - (b.openMs ?? 0))} month${FOUNDER_WINDOW_M - (b.openMs ?? 0) === 1 ? "" : "s"} left to first close`)}
          />
        ))}
      </div>
      <div ref={youRef}>
        <DataTable id="street-firms" cols={FIRM_COLS} rows={rows} rowKey={(r) => r.id} selected={YOU}
          initialSort={{ col: "eq", dir: -1 }} empty={noHit ? "No match" : "None"}
          onRow={(r) => { if (r.you) useStore.getState().setPage("books"); else setOpen(r.id); }} />
      </div>
      <TakenPrivateRecord />
      <StreetTicker onOpen={(id) => setOpen(id)} />
      {/* THE DISTRESS BOARD (2026-10-14). Where the next forced sale comes
          from, before it is on the tape. */}
      {(() => {
        const stressed = rivals.filter((r) => r.failedM === undefined && (r.stressMs ?? 0) > 0)
          .sort((a, b) => (b.stressMs ?? 0) - (a.stressMs ?? 0));
        const weakDesks = (game.lenders ?? []).filter((l) => l.failedM === undefined && l.kind !== "conduit"
          && l.book > 0 && l.capital / l.book < targetCapital(l.name) * 0.8);
        const receiverSales = (game.listings ?? []).filter((l) => l.reason === "receiver" || l.receiverFor);
        const yr = distressTally(game, 12);
        const n = stressed.length + weakDesks.length + receiverSales.length + yr.defaults + yr.firms + yr.banks;
        return (
          <Fold id="competitors:distress" title="Distress board" summary={n ? `${stressed.length} firm${stressed.length === 1 ? "" : "s"} delinquent · ${weakDesks.length} lender${weakDesks.length === 1 ? "" : "s"} under target · ${receiverSales.length} receiver sale${receiverSales.length === 1 ? "" : "s"}` : "None"}>
            <Row k="Last 12 months"
              v={`${yr.defaults} foreclosure${yr.defaults === 1 ? "" : "s"} · ${yr.firms} firm${yr.firms === 1 ? "" : "s"} failed · ${yr.banks} bank${yr.banks === 1 ? "" : "s"} closed`}
              bad={yr.defaults + yr.firms + yr.banks > 0} />
            {stressed.map((r) => (
              <Row key={r.id} k={r.name}
                v={`${r.stressMs} month${r.stressMs === 1 ? "" : "s"} delinquent · ${r.bbls.length} building${r.bbls.length === 1 ? "" : "s"}`
                  + ((r.stressMs ?? 0) < NOTICE_M ? ` · filing in ${NOTICE_M - (r.stressMs ?? 0)} month${NOTICE_M - (r.stressMs ?? 0) === 1 ? "" : "s"}`
                    : ` · filed · 1 foreclosure/qtr · all in ${Math.max(0, NOTICE_M + FORECLOSE_M - (r.stressMs ?? 0) + 1)} months`)}
                bad />
            ))}
            {weakDesks.map((l) => (
              <Row key={l.id} k={l.name} v={`capital ${(100 * l.capital / l.book).toFixed(1)}% vs ${(100 * targetCapital(l.name)).toFixed(1)}% target · selling assets`} bad />
            ))}
            {receiverSales.slice(0, 8).map((l) => (
              <Row key={l.bbl} k={resolveRec(parcels, game, l.bbl)?.address ?? l.bbl}
                v={`${l.receiverFor ?? "receiver"} · ask ${usd(l.ask)} · until ${monthLabel(l.expiresM)}`} />
            ))}
          </Fold>
        );
      })()}
      {/* THE CAST (COMPETITORS_PLAN.md §6): who matters right now and what is
          about to happen to them — one click away, under the table. */}
      <Fold id="competitors:watch" title="The ones to watch">
        <HeadlinerStrip onOpen={(id) => setOpen(id)} />
      </Fold>
      <RaceChart />
    </>
  );
}

const YOU = "__you";

interface FirmRow {
  id: string; name: string; you: boolean; dead: boolean; style: string; bldgs: number; gav: number | null;
  debt: number | null; eq: number | null; ltv: number | null; cash: number | null; deals: number | null;
  status: string; from: string;
}

const FIRM_COLS: Col<FirmRow>[] = [
  {
    id: "name", label: "Firm", get: (r) => r.name,
    cell: (r) => (
      <span className={r.you ? "nx-strong-cell" : r.dead ? "nx-dim" : undefined}
        title={r.from ? `Raised out of ${r.from}` : r.you ? "Your firm · open Books" : r.status}>
        {r.you ? "★ " : ""}{r.name}
      </span>
    ),
  },
  { id: "style", label: "Style", get: (r) => r.style },
  { id: "gav", label: "Assets", get: (r) => r.gav, fmt: "usd" },
  { id: "debt", label: "Debt", get: (r) => r.debt, fmt: "usd" },
  { id: "eq", label: "Net equity", get: (r) => r.eq, fmt: "usd", tone: (r) => ((r.eq ?? 0) < 0 ? "neg" : undefined) },
  { id: "ltv", label: "LTV", get: (r) => r.ltv, fmt: "pct", tone: (r) => ((r.ltv ?? 0) > 0.8 ? "neg" : undefined) },
  { id: "deals", label: "Deals 12m", get: (r) => r.deals, fmt: "n" },
  { id: "bldgs", label: "Buildings", get: (r) => r.bldgs, fmt: "n", hidden: true },
  { id: "cash", label: "Cash", get: (r) => r.cash, fmt: "usd", hidden: true },
  { id: "status", label: "Status", get: (r) => r.status, hidden: true },
];

/** The status word the street table has always printed for a firm. */
function statusOf(r: Rival, m: { aum: number; ltv: number }): string {
  if (r.failedM !== undefined) {
    return r.takenPrivateM !== undefined
      ? `Taken private by you, ${monthLabel(r.takenPrivateM)}`
      : r.bbls.length ? `Failed ${monthLabel(r.failedM)} · receiver selling` : `Failed ${monthLabel(r.failedM)}`;
  }
  return m.aum <= 0 && r.debt > 0 ? "No assets, debt outstanding"
    : (r.stressMs ?? 0) > 0 ? "Distressed seller"
    : m.ltv > 0.75 ? "High leverage"
    : r.cash > m.aum * 0.06 ? "Cash-rich buyer"
    : "Fully invested";
}

// Open-market months a ready founder keeps pitching before the street closes
// on them — mirrored from FOUNDER_WINDOW_M inside maybeNewFirm in
// engine/rivals.ts, which is not exported. The window counts months the
// street would actually take a raise, not calendar months queued through a
// credit crunch; if the engine's window moves, this must move with it.
const FOUNDER_WINDOW_M = 18;

// The three label tables that used to live here moved to shared.tsx when the
// register and the street table started rendering the same drawer: StreetDesk
// imports OwnerStatement from OwnersDesk, so OwnersDesk cannot import labels
// back from here without a cycle. Re-exported because DebtPage re-exports them
// from this file and half a dozen call sites read them through that door.
export { STYLE_MAX, CONDITION_WORD, STYLE_WORD } from "@/ui/panels/shared";
