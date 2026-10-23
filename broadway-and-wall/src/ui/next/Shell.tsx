/**
 * THE NEW SHELL (ui-revamp PLAN §2, BUILD_SPEC 2.3): HUD across the top, the
 * rail down the left, one drawer beside the city, lenses along the foot.
 * Mounted by App instead of TopBar + GamePanels + MapRail + MapControls when
 * the interface switch is on New. The engine's cards, the palette and the
 * toasts stay as they are; the moments (year review, flashes) are not mounted.
 */
import { Activity, useEffect, useLayoutEffect, useMemo, useRef, type ReactElement } from "react";
import "./next.css";
import { useStore, type Page } from "@/state/store";
import { monthLabel } from "@/engine/types";
import { UNREAL_HOST } from "@/state/unrealHost";
import Palette from "@/ui/Palette";
import YearReview, { ExitCard, GoalCard } from "@/ui/YearReview";
import ClockProgress from "@/ui/ClockProgress";
import { LENSES } from "@/ui/MapControls";
import { tabCounts } from "@/ui/desks";
import FirmStanding from "@/ui/FirmStanding";
import FirmTimeline from "@/ui/FirmTimeline";
import { PortfolioPage } from "@/ui/panels/PortfolioPage";
import { MarketPage, BuildingDatabase } from "@/ui/panels/MarketPage";
import { PlayersPage } from "@/ui/panels/PlayersPage";
import { NotesPage } from "@/ui/panels/NotesPage";
import { EconomyPage } from "@/ui/panels/EconomyPage";
import { RankingsPage } from "@/ui/panels/RankingsPage";
import { BooksPage } from "@/ui/panels/BooksPage";
import { NewsPage } from "@/ui/panels/NewsPage";
import { SavesPage, SettingsPage, PrimerPage } from "@/ui/panels/MiscPages";
import { LeasingPage } from "@/ui/panels/LeasingPage";
import { DebtPage } from "@/ui/panels/DebtPage";
import { InvestorsPage } from "@/ui/panels/InvestorsPage";
import { BanksPage } from "@/ui/panels/BankProfile";
import { PulsePage } from "@/ui/panels/PulsePage";
import { DecisionModal, AlertModal, AuctionModal, DefaultNoticeModal, GameOverPage } from "@/ui/panels/modals";
import { useNext } from "./nextStore";
import { FOOT_PAGES, PLACES, placeById, placeOf, visibleTabs, type PlaceId } from "./places";
import { hudVitals } from "./derive";
import { Figure, DrillLayer } from "./Figure";
import { Drawer } from "./Drawer";
import { InboxDrawer, inboxBadge, useInbox } from "./Inbox";
import { BuildingFile } from "./BuildingFile";
import { openPlace, openTab, useNextKeys } from "./keys";
import { HoldingsBuildings, HoldingsLand } from "./HoldingsNext";
import { MarketForSale } from "./MarketNext";
import { MarketBooks, MarketDistressed, MarketSites } from "./MarketMore";
import { CapitalLoans, CapitalOverview } from "./CapitalNext";
import { CapitalBooks, CapitalInvestors, CapitalLenders } from "./CapitalMore";
import { LeasingExpiring, LeasingOffers, LeasingVacancy } from "./LeasingNext";
import { CityMarkets, MarketsOverview, CityNews, CityPlayers, CityRankings, CityRecord } from "./CityNext";
import { PipelineBoard, PipelineBuilding, PipelineBuying, PipelineSelling } from "./PipelineNext";

const PAGE_VIEW: Partial<Record<Page, ReactElement>> = {
  portfolio: <PortfolioPage />,
  market: <MarketPage />,
  pulse: <PulsePage />,
  players: <PlayersPage />,
  buildings: <BuildingDatabase />,
  notes: <NotesPage />,
  economy: <EconomyPage />,
  rankings: <RankingsPage />,
  books: <BooksPage />,
  news: <NewsPage />,
  saves: <SavesPage />,
  leasing: <LeasingPage />,
  debt: <DebtPage />,
  investors: <InvestorsPage />,
  banks: <BanksPage />,
  firm: <><FirmStanding /><FirmTimeline /></>,
  settings: <SettingsPage />,
  primer: <PrimerPage />,
};

export default function Shell() {
  useNextKeys();
  const page = useStore((s) => s.page);
  const sel = useStore((s) => s.selectedBBL);
  const gameOver = useStore((s) => !!s.game?.gameOver);
  const inboxOpen = useNext((s) => s.inboxOpen);
  const placeTab = useNext((s) => s.placeTab);
  const moment = useNext((s) => s.showMoment);
  const goalOn = useStore((s) => !!s.goalCard);
  const exitOn = useStore((s) => !!s.exitCard);
  useLayoutEffect(() => {
    document.documentElement.classList.add("ui-next");
    return () => document.documentElement.classList.remove("ui-next");
  }, []);
  // A deed picked or a room opened from anywhere closes the Inbox.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (sel || page !== "none") useNext.getState().setInboxOpen(false);
  }, [sel, page]);
  const where = placeOf(page, placeTab);
  const placeShown = page !== "property" && !inboxOpen && !!where;
  // THE PLACE DRAWER STAYS UP WHEN CLOSED, hidden, so the pages kept in it
  // (and their sort, scroll and open rows) survive a look at the city or a
  // building — reopening Holdings is a reveal, not a rebuild (P4).
  const lastWhere = useRef<{ place: PlaceId; tab: string; page: Page } | null>(null);
  if (where) lastWhere.current = { ...where, page };
  const drawer = page === "property" ? <BuildingFile />
    : inboxOpen ? <InboxDrawer />
    : where ? null
    : FOOT_PAGES.some((f) => f.page === page) || page === "primer" ? <FootDrawer page={page} />
    : page === "none" && sel ? <BuildingFile />
    : null;
  const kept = lastWhere.current;
  return (
    <>
      <HudBar />
      <Rail />
      {kept && (
        <Activity mode={placeShown ? "visible" : "hidden"}>
          <PlaceDrawer place={kept.place} tab={kept.tab} page={kept.page} />
        </Activity>
      )}
      {drawer}
      <LensBar />
      <DrillLayer />
      <Palette />
      <AlertModal />
      <DefaultNoticeModal />
      <DecisionModal />
      <AuctionModal />
      {/* the moments, drawn only when opened from their Inbox row (R6) */}
      <YearReview />
      {moment === "goal" && goalOn && <GoalCard />}
      {moment === "exit" && exitOn && <ExitCard />}
      {gameOver && page !== "saves" && <GameOverPage />}
    </>
  );
}

// ---------------------------------------------------------------- HUD
function Delta({ v, fmt }: { v: number | null; fmt: "usd" | "bp" | "n" }) {
  if (v === null || !Number.isFinite(v) || Math.round(v) === 0) return null;
  const up = v > 0;
  const t = fmt === "bp" ? `${Math.abs(Math.round(v))}bp` : fmt === "n" ? String(Math.abs(Math.round(v))) : null;
  return <span className={"nx-delta " + (up ? "nx-pos" : "nx-neg")}>{up ? "▲" : "▼"}{t ?? <Figure value={Math.abs(v)} fmt="usd" />}</span>;
}

function Readout({ label, cls, children }: { label: string; cls?: string; children: React.ReactNode }) {
  return <div className={"nx-ro" + (cls ? " " + cls : "")}><span className="nx-ro-label">{label}</span><span className="nx-ro-value">{children}</span></div>;
}

function HudBar() {
  const game = useStore((s) => s.game);
  const prev = useStore((s) => s.prevForDigest);
  const parcels = useStore((s) => s.parcels);
  const autoplay = useStore((s) => s.autoplay);
  const advancing = useStore((s) => s.advancing);
  const v = useMemo(() => (game && parcels ? hudVitals(game, prev, parcels) : null), [game, prev, parcels]);
  if (!game || !v) return null;
  const st = useStore.getState();
  const over = !!game.gameOver;
  return (
    <header className="nx-hud" role="banner">
      <div className="nx-clock nav-cluster-time">
        <span className="nx-date mono">{monthLabel(game.month)}</span>
        <button type="button" className={"nx-btn nx-sm" + (autoplay ? " nx-on" : "")} onClick={() => st.setAutoplay(autoplay ? 0 : 1)} disabled={over} title="Space">
          {autoplay ? "❚❚" : "▶"}
        </button>
        <button type="button" className="nx-btn nx-sm" onClick={() => void st.advance()} disabled={over || advancing} title=".">+1 mo</button>
        <button type="button" className="nx-btn nx-sm" onClick={() => st.advanceYear()} disabled={over || advancing} title="Y">+1 yr</button>
        <button type="button" className="nx-btn nx-sm" onClick={() => st.advanceUntil()} disabled={over || advancing} title="N">Next ›</button>
        <ClockProgress />
      </div>
      <div className="nx-readouts">
        <Readout label="Cash"><Figure value={v.cash} fmt="usd" drill="cash" tone={v.cash < 0 ? "neg" : undefined} /></Readout>
        <Readout label="Debt"><Figure value={v.debt} fmt="usd" drill="debt" /></Readout>
        <Readout label="NW"><Figure value={v.nw} fmt="usd" drill="nw" /><Delta v={v.dNw} fmt="usd" /></Readout>
        <Readout label="CF / yr"><Figure value={v.cfYr} fmt="usd" drill="cf" tone={v.cfYr < 0 ? "neg" : undefined} /><Delta v={v.dCfYr} fmt="usd" /></Readout>
        {v.rank !== null && <Readout label="Rank" cls="nx-shed-3"><Figure value={v.rank} fmt="n" text={`${v.rank}/${v.of}`} drill="rank" /><Delta v={v.dRank} fmt="n" /></Readout>}
        <Readout label="Occ" cls="nx-shed-2"><Figure value={v.occ} fmt="pct" drill="occ" /></Readout>
        <Readout label="10Y" cls="nx-shed-1"><Figure value={v.rate} fmt="pctv" drill="rate" /><Delta v={v.dRateBp} fmt="bp" /></Readout>
      </div>
      <div className="nx-hud-right">
        <button type="button" className="nx-btn nx-sm" disabled title="Region in step 9">Island</button>
        <button type="button" className="nx-btn nx-sm" onClick={() => st.setPaletteOpen(true)} title="Ctrl K">Search</button>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------- Rail
function Rail() {
  const game = useStore((s) => s.game);
  const page = useStore((s) => s.page);
  const inboxOpen = useNext((s) => s.inboxOpen);
  const placeTab = useNext((s) => s.placeTab);
  const { needs } = useInbox();
  const counts = useMemo(() => (game ? tabCounts(game) : {}), [game]);
  const here = inboxOpen ? "inbox" : placeOf(page, placeTab)?.place;
  const badge = (id: PlaceId): number | string => {
    if (id === "inbox") return inboxBadge(needs);
    if (id === "pipeline") return counts.deals ?? 0;
    if (id === "market") return (counts.market ?? 0) + (counts.notes ?? 0);
    if (id === "capital") return counts.debtWarn ? "!" : 0;
    if (id === "city") return counts.news ?? 0;
    return 0;
  };
  return (
    <nav className="nx-rail" aria-label="Places">
      {PLACES.map((p) => {
        const b = badge(p.id);
        return (
          <button key={p.id} type="button" className={"nx-rail-btn" + (here === p.id ? " on" : "")} onClick={() => openPlace(p.id)} title={p.key}>
            <span className="nx-rail-icon" aria-hidden="true">{p.icon}</span>
            <span className="nx-rail-label">{p.label}</span>
            {!!b && <span className={"nx-badge" + (p.id === "capital" ? " nx-warn" : "")}>{b}</span>}
          </button>
        );
      })}
      <span className="nx-rail-gap" />
      {FOOT_PAGES.map((f) => (
        <button key={f.page} type="button" className={"nx-rail-btn" + (page === f.page ? " on" : "")}
          onClick={() => useStore.getState().setPage(page === f.page ? "none" : f.page)}>
          <span className="nx-rail-icon" aria-hidden="true">{f.icon}</span>
          <span className="nx-rail-label">{f.label}</span>
        </button>
      ))}
      <button type="button" className="nx-rail-btn" onClick={() => useNext.getState().setUiShell("classic")}>
        <span className="nx-rail-icon" aria-hidden="true">⇄</span>
        <span className="nx-rail-label">Classic</span>
      </button>
    </nav>
  );
}

// ---------------------------------------------------------------- Drawers
const KEEP = 3;
/** The new tables that replace a hosted classic page (PLAN §5 step 5), by PlaceTab.view. */
const NEXT_VIEW: Record<string, ReactElement> = {
  "v:holdings": <HoldingsBuildings />,
  "v:land": <HoldingsLand />,
  "v:pipe-board": <PipelineBoard />,
  "v:pipe-buy": <PipelineBuying />,
  "v:pipe-build": <PipelineBuilding />,
  "v:pipe-sell": <PipelineSelling />,
  "v:forsale": <MarketForSale />,
  "v:sites": <MarketSites />,
  "v:distressed": <MarketDistressed />,
  "v:books": <MarketBooks />,
  "v:capital": <CapitalOverview />,
  "v:loans": <CapitalLoans />,
  "v:lenders": <CapitalLenders />,
  "v:investors": <CapitalInvestors />,
  "v:fbooks": <CapitalBooks />,
  "v:c-markets": <CityMarkets part="sectors" />,
  "v:m-overview": <MarketsOverview />,
  "v:l-offers": <LeasingOffers />,
  "v:l-expiring": <LeasingExpiring />,
  "v:l-vacancy": <LeasingVacancy />,
  "v:m-districts": <CityMarkets part="districts" />,
  "v:m-building": <CityMarkets part="building" />,
  "v:c-news": <CityNews />,
  "v:c-players": <CityPlayers />,
  "v:c-rankings": <CityRankings />,
  "v:c-record": <CityRecord />,
};
const viewOf = (k: string): ReactElement | undefined => NEXT_VIEW[k] ?? PAGE_VIEW[k as Page];

function useKept(page: string): string[] {
  const recent = useRef<string[]>([]);
  if (viewOf(page) && recent.current[recent.current.length - 1] !== page) {
    recent.current = [...recent.current.filter((p) => p !== page), page].slice(-KEEP);
  }
  return recent.current;
}

function useJump(body: React.RefObject<HTMLDivElement | null>, page: string) {
  const jump = useStore((s) => s.pageJump);
  useEffect(() => {
    if (!jump) return;
    let tries = 0;
    const want = jump.toLowerCase();
    const t = window.setInterval(() => {
      const root = body.current?.querySelector(`[data-page="${page}"]`) ?? body.current;
      const hit = Array.from(root?.querySelectorAll<HTMLElement>(".page-section-head, .deal-head, .page-section") ?? [])
        .find((el) => el.offsetParent && (el.textContent ?? "").trim().toLowerCase().startsWith(want));
      if (hit || ++tries > 20) {
        window.clearInterval(t);
        if (hit) hit.scrollIntoView({ block: "start" });
        useStore.setState({ pageJump: null });
      }
    }, 60);
    return () => window.clearInterval(t);
  }, [jump, page, body]);
}

function PlaceDrawer({ place, tab, page }: { place: PlaceId; tab: string; page: Page }) {
  const game = useStore((s) => s.game);
  const p = placeById(place);
  const tabs = visibleTabs(p, game);
  const t = tabs.find((x) => x.id === tab) ?? tabs[0];
  const key = t?.view ? "v:" + t.view : page;
  const kept = useKept(key);
  const body = useRef<HTMLDivElement>(null);
  // A new tab opens at its top; a jump then scrolls it to its section.
  useLayoutEffect(() => {
    const sc = body.current?.parentElement;
    if (sc) sc.scrollTop = 0;
  }, [page, t?.id]);
  useJump(body, key);
  return (
    <Drawer
      width={t?.width ?? "wide"}
      title={p.label}
      tabs={tabs.map((x) => ({ id: x.id, label: x.label }))}
      tab={t?.id}
      onTab={(id) => openTab(place, id)}
      onClose={() => useStore.getState().setPage("none")}
    >
      <div ref={body} className={`page nx-page page-${page}`}>
        {kept.map((k) => (
          <Activity key={k} mode={k === key ? "visible" : "hidden"}>
            <div className="page-view" data-page={k}>{viewOf(k)}</div>
          </Activity>
        ))}
      </div>
    </Drawer>
  );
}

function FootDrawer({ page }: { page: Page }) {
  const label = page === "saves" ? "Saves" : page === "settings" ? "Settings" : "Primer";
  return (
    <Drawer width="std" title={label} onClose={() => useStore.getState().setPage("none")}>
      <div className={`page nx-page page-${page}`}>
        {PAGE_VIEW[page]}
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------- Lenses
function LensBar() {
  const lens = useStore((s) => s.lens);
  const setLens = useStore((s) => s.setLens);
  return (
    <div className="nx-lensbar" role="toolbar" aria-label="Lenses">
      {LENSES.map((l) => (
        <button
          key={l.id}
          type="button"
          className={"nx-lens" + (lens === l.id ? " on" : "")}
          disabled={UNREAL_HOST}
          title={UNREAL_HOST ? "Not in 3D yet" : undefined}
          onClick={() => setLens(lens === l.id ? "none" : l.id)}
        >
          <span aria-hidden="true">{l.icon}</span> {l.label}
        </button>
      ))}
    </div>
  );
}
