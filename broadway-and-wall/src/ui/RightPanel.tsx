// The game's chrome: a glance card on the map, and firm desks as big rooms.
// Detail pages are parchment sheets sized for underwriting — not a narrow
// right-hand column that crams a rent roll into six hundred pixels.
import { Activity, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useStore } from "@/state/store";
import type { Page } from "@/state/store";
import FirmStanding from "@/ui/FirmStanding";
import Palette from "@/ui/Palette";
import FirmTimeline from "@/ui/FirmTimeline";
import { ParcelPanel } from "@/ui/panels/ParcelDesk";
import { PortfolioPage } from "@/ui/panels/PortfolioPage";
import { DealsPage } from "@/ui/panels/DealsPage";
import { MarketPage, BuildingDatabase } from "@/ui/panels/MarketPage";
import { PulsePage } from "@/ui/panels/PulsePage";
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
import { PropertyPage } from "@/ui/panels/PropertyPage";
import {
  DecisionModal, AlertModal, AuctionModal, DefaultNoticeModal, GameOverPage,
} from "@/ui/panels/modals";

import { DESKS, deskOf, deskLanding, rememberTab, tabCounts, visibleTabs, type Desk } from "@/ui/desks";
import { onScreen } from "@/ui/onScreen";

export { liveBrokerCalls } from "@/ui/panels/broker";

export default function GamePanels() {
  // Subscribe narrowly: a full `game` subscription re-rendered this shell (and
  // used to re-render the docked ParcelPanel) on every Advance/cash write.
  const gameOver = useStore((s) => !!s.game?.gameOver);
  const hasGame = useStore((s) => !!s.game);
  const page = useStore((s) => s.page);
  const mapOnly = useStore((s) => s.mapOnly);
  const setPage = useStore((s) => s.setPage);
  // THE ROOM IS NAMED FOR THE BUILDING. The property file was titled
  // "Property" — the one word that is true of every page it can show — with
  // the address below seven stat tiles.
  const propAddr = useStore((s) => (s.page === "property" && s.selectedBBL ? s.parcels?.[s.selectedBBL]?.address ?? null : null));
  const propOwned = useStore((s) => (s.page === "property" && s.selectedBBL ? !!s.game?.holdings[s.selectedBBL] : false));
  const pageRef = useRef<HTMLDivElement>(null);
  useHintFolds(pageRef, page);
  useEffect(() => { rememberTab(page); }, [page]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The palette toggle fires even from inside an input — that is how every
      // palette closes, and its own search box is an input.
      if ((e.metaKey || e.ctrlKey) && e.code === "KeyK") {
        e.preventDefault();
        const st0 = useStore.getState();
        if (st0.game) st0.setPaletteOpen(!st0.paletteOpen);
        return;
      }
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      // A dropdown owns its arrow and letter keys. Space is always play and
      // pause, so a button left focused by a click does not swallow it (the
      // keydown's preventDefault below stops the button pressing as well).
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      if (e.code === "Space" && tag === "BUTTON") el?.blur();
      if (e.key === "Escape") {
        const st0 = useStore.getState();
        if (st0.photoFrame) {
          st0.setPhotoFrame(false);
          return;
        }
        // ESCAPE ANSWERS THE CARD WITH ITS OWN "NOT NOW". It used to refuse
        // with a toast; every card has a defer button (tagged data-esc), and
        // pressing it is what the player meant. A card with no safe default
        // (an LOI mid-counter) gives a small shake instead.
        const card = topCard();
        if (card) {
          const esc = card.querySelector<HTMLButtonElement>("[data-esc]:not(:disabled)");
          if (esc) esc.click();
          else nudgeCard(card);
        } else if (page !== "none") setPage("none");
        else useStore.getState().select(null);
        return;
      }
      const st = useStore.getState();
      if (e.code === "KeyP" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        st.setPhotoFrame(!st.photoFrame);
        return;
      }
      if (e.code === "KeyM" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        if (st.photoFrame) st.setPhotoFrame(false);
        else st.setMapOnly(!st.mapOnly);
        return;
      }
      // Desk hotkeys, 1-6 — the rail, the "?" card and these keys share DESKS.
      // Pressing a desk's key again closes it.
      if (!e.metaKey && !e.ctrlKey && !e.altKey && /^Digit[1-9]$/.test(e.code) && !onScreen(".modal-backdrop")) {
        const hit = DESKS.find((d) => d.key === e.code.slice(5));
        if (hit) {
          e.preventDefault();
          const g = useStore.getState().game;
          setPage(deskOf(page)?.id === hit.id && page !== "property" ? "none" : deskLanding(hit, g ? tabCounts(g) : undefined, g));
          return;
        }
      }
      // SPACE IS PLAY AND PAUSE, like G: pausing always works, even with a
      // card open; playing waits until the card is answered
      if ((e.code === "KeyG" || e.code === "Space") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        if (st.autoplay) { st.setAutoplay(0); return; }
        if (onScreen(".modal-backdrop")) {
          useStore.setState({ toast: { text: "Resolve the open card first.", kind: "err", at: Date.now() } });
          return;
        }
        if (!st.game?.gameOver) st.setAutoplay(1);
        return;
      }
      if (st.advancing) return;
      const wantsTime = e.code === "KeyY" || e.code === "KeyN";
      if (wantsTime && onScreen(".modal-backdrop")) {
        e.preventDefault();
        useStore.setState({
          toast: { text: "Resolve the open card first.", kind: "err", at: Date.now() },
        });
        return;
      }
      if (e.code === "KeyY") st.advanceYear();
      else if (e.code === "KeyN") st.advanceUntil();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [page, setPage]);
  const open = page !== "none" && !mapOnly;
  const kept = useKeptDesks(page, hasGame);
  // The room on screen, plus the desks kept warm behind it.
  const views = open && !kept.includes(page) ? [...kept, page] : kept;
  if (!hasGame) return null;
  const title = page === "portfolio" ? "Portfolio"
    : page === "deals" ? "Deals"
    : page === "books" ? "Books"
    : page === "news" ? "News"
    : page === "leasing" ? "Leasing & Occupancy"
    : page === "debt" ? "Debt"
    : page === "investors" ? "Investors"
    : page === "banks" ? "Banks"
    : page === "property" ? (propAddr ?? "Property")
    : page === "saves" ? "Saved Games"
    : page === "economy" ? "Markets"
    : page === "pulse" ? "City"
    : page === "players" ? "Players"
    : page === "buildings" ? "Buildings"
    : page === "rankings" ? "Rankings"
    : page === "notes" ? "Notes"
    : page === "firm" ? "The Record"
    : page === "settings" ? "Settings"
    : page === "primer" ? "Primer"
    : "Marketplace";
  const desk = deskOf(page);
  const kicker = page === "property" ? (propOwned ? "Portfolio · your building" : "Property file")
    : desk ? desk.label
    : page === "saves" ? "Campaign"
    : page === "settings" ? "Preferences"
    : page === "primer" ? "Primer"
    : "";
  const subtitle = page === "portfolio" ? "Value, income, concentration"
    : page === "deals" ? "Negotiations and contracts"
    : page === "books" ? "Cash flow and ledger"
    : page === "news" ? "Headlines and closed sales"
    : page === "leasing" ? "Occupancy and expirations"
    : page === "debt" ? "Coverage, maturities, refinancing"
    : page === "investors" ? "Investor capital and fund"
    : page === "banks" ? "Lender financials and loans"
    : page === "property" ? "Operations, financing, development"
    : page === "saves" ? "Named snapshots"
    : page === "economy" ? "Markets by sector"
    : page === "pulse" ? "City overview"
    : page === "players" ? "Rival firms"
    : page === "buildings" ? "All buildings"
    : page === "rankings" ? "Vs. 32 US cities"
    : page === "notes" ? "Loan trading and bridges"
    : page === "firm" ? "Firm history"
    : page === "settings" ? "Display and simulation"
    : page === "primer" ? "Core CRE metrics"
    : "Listings and off-market";
  // The map card is a glance. Firm desks open as rooms (~1100px parchment)
  // so a rent roll, deal stage or debt book is readable — the narrow right
  // dock from the map-first pass was too small for that work.
  return (
    <>
      <Palette />
      {page === "none" && <ParcelPanel />}
      {(open || kept.length > 0) && (
        // Closed, the room stays mounted and hidden so the desks kept below
        // survive a look at the map. It drops the `page-backdrop` class while
        // hidden: the toasts move aside for an open page (hud.css :has()).
        <Activity mode={open ? "visible" : "hidden"}>
        <div
          className={open ? "page-backdrop" : "page-backdrop-idle"}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPage("none");
          }}
        >
          <div
            className={`page page-${page}`}
            ref={pageRef}
            onClick={(e) => {
              const h = (e.target as HTMLElement).closest?.(".hint-fold");
              if (h) { h.classList.remove("hint-fold"); h.removeAttribute("title"); }
            }}
          >
            <div className="page-head">
              <div className="page-heading">
                <div className="page-kicker">{kicker}</div>
                <div className="page-title">{title}</div>
                <div className="page-subtitle">{subtitle}</div>
              </div>
              <button className="panel-close page-close" aria-label={`Close ${title}`} onClick={() => setPage("none")}>×</button>
            </div>
            {/* The property file has its own tabs; the desk's would be a
                second row above them with neither lit. */}
            {desk && desk.tabs.length > 1 && page !== "property" && <DeskTabs desk={desk} page={page} />}
            {/* Pages that carry their own view switch get no section rail —
                two strips of chips stacked under the desk tabs read as one
                cluttered control, and these pages are short enough per view. */}
            {open && !OWN_VIEWS.has(page) && <SectionNav page={page} pageRef={pageRef} />}
            {views.map((p) => (
              <Activity key={p} mode={open && p === page ? "visible" : "hidden"}>
                <div className="page-view" data-page={p}>{PAGE_VIEW[p]}</div>
              </Activity>
            ))}
          </div>
        </div>
        </Activity>
      )}
      {/* THE INTERRUPTIONS THE ENGINE RAISES, ONE AT A TIME. An alert and a
          letter of intent can land in the same month, and the order matters:
          the bank that failed is the reason you would answer the letter
          differently. They used to render together, so two or three cards sat
          stacked with their backdrops' blur compounding. Now the FIRST card in
          this order is the only one drawn (hud.css: `.app > .modal-backdrop ~
          .modal-backdrop`), and the rest wait their turn behind it with a
          count on screen (CardQueue). So: what happened, then what it does to
          your own deed, then what wants an answer, then the auction. */}
      <AlertModal />
      <DefaultNoticeModal />
      <DecisionModal />
      <AuctionModal />
      {/* yield to the saves page — this used to paint over it at the same
          z-index, leaving every control on it visible and dead */}
      {gameOver && page !== "saves" && <GameOverPage />}
    </>
  );
}

/**
 * WHAT EACH ROOM DRAWS. Built once, at module scope, so a kept desk's element
 * is the same object on every render of the shell: React bails out of it
 * instead of redrawing a hidden page whenever the title or the page changes.
 */
const PAGE_VIEW: Partial<Record<Page, ReactElement>> = {
  portfolio: <PortfolioPage />,
  deals: <DealsPage />,
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
  property: <PropertyPage />,
  firm: <><FirmStanding /><FirmTimeline /></>,
  settings: <SettingsPage />,
  primer: <PrimerPage />,
};

/**
 * THE LAST DESKS STAY UP. Every desk used to unmount the moment you left it,
 * so going Portfolio → Leasing → Portfolio rebuilt both from nothing each way
 * (~200 ms apiece on a fifty-building book). The current desk and the two
 * before it stay mounted, hidden with `<Activity mode="hidden">`: no effects,
 * no store subscriptions while hidden, and their page state (sort, open row)
 * is where you left it. Coming back after an advance redraws once with the
 * new month, as a fresh open would.
 *
 * The property file is not kept: it is one building's file, and its tabs and
 * inputs belong to the building it was opened on.
 */
const KEEP_DESKS = 3;
const keepable = (p: Page) => p !== "property" && !!deskOf(p) && !!PAGE_VIEW[p];

function useKeptDesks(page: Page, hasGame: boolean): Page[] {
  // `recent` is by recency (most recent last) and decides who is dropped;
  // `drawn` is the order they render in, which only ever appends, so a kept
  // desk is never moved in the DOM.
  const recent = useRef<Page[]>([]);
  const drawn = useRef<Page[]>([]);
  if (!hasGame) { recent.current = []; drawn.current = []; }
  else if (keepable(page) && recent.current[recent.current.length - 1] !== page) {
    const r = [...recent.current.filter((p) => p !== page), page].slice(-KEEP_DESKS);
    recent.current = r;
    const stay = drawn.current.filter((p) => r.includes(p));
    drawn.current = stay.includes(page) ? stay : [...stay, page];
  }
  return drawn.current;
}

/** The card the player is looking at: the visible one highest in the stack.
 *  A confirm inside a desk page sits in that page's layer (z 50). */
export function topCard(): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestZ = -Infinity;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(".modal-backdrop, .delivery-ceremony"))) {
    if (!el.getClientRects().length) continue;
    const z = el.closest(".page-backdrop") ? 50 : parseInt(getComputedStyle(el).zIndex, 10) || 0;
    if (z >= bestZ) { best = el; bestZ = z; }
  }
  return best;
}

function nudgeCard(card: HTMLElement) {
  const inner = card.querySelector<HTMLElement>(".modal, .delivery-stamp") ?? card;
  inner.classList.remove("card-nudge");
  void inner.offsetWidth; // restart the animation
  inner.classList.add("card-nudge");
}

/**
 * THE DESK'S ROOMS. A desk with more than one room shows them as tabs under
 * its title, each with the same badge the rail adds up — so a "2" on Market
 * says, once inside, whether it is the Marketplace or the Notes desk that
 * wants you.
 */
function DeskTabs({ desk, page }: { desk: Desk; page: Page }) {
  const game = useStore((s) => s.game);
  const setPage = useStore((s) => s.setPage);
  const counts = useMemo(() => (game ? tabCounts(game) : {}), [game]);
  const tabs = visibleTabs(desk, game, page);
  if (tabs.length < 2) return null;
  return (
    <div className="desk-tabs" role="tablist" aria-label={`${desk.label} desk`}>
      {tabs.map((t) => {
        const on = t.page === page;
        const n = counts[t.page] ?? 0;
        const warn = t.page === "debt" && counts.debtWarn;
        return (
          <button
            key={t.page}
            type="button"
            role="tab"
            aria-selected={on}
            className={"desk-tab" + (on ? " on" : "")}
            title={t.note}
            onClick={() => { if (!on) setPage(t.page); }}
          >
            {t.label}
            {n > 0 ? <span className="desk-tab-badge">{n}</span>
              : warn ? <span className="desk-tab-badge desk-tab-warn">{counts.debtWarn === "swept" ? "⚠" : "!"}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * THE SECTION RAIL.
 *
 * Market, Debt, Portfolio, Books and Economy are long rooms — a maturity
 * ladder at the bottom of Debt is a full screen below the tiles, and the only
 * way there was the wheel. The rail is one chip per heading on the page,
 * sticky under the top bar, the one in view lit. It reads the page's own
 * headings rather than a list each desk would have to keep in step: a section
 * head, a deal head, or one of the bare `.page-section` labels the Debt desk
 * uses. Three sections or fewer and it stays out of the way.
 *
 * `pageJump` (store) is a section asked for by name — the Capital menu's
 * Refinance entry opens Debt and lands on "Loan by loan" — and is consumed
 * here, once, after the first scan finds it.
 */
const OWN_VIEWS = new Set<Page>(["pulse", "players", "news", "buildings"]);
const HEAD_SEL = ".page-section-head, .deal-head, .page-section";
type Sec = { el: HTMLElement; label: string };

function secLabel(el: HTMLElement): string | null {
  // A `.page-section` is usually a container; only the bare-text ones are heads.
  if (el.classList.contains("page-section") && !el.classList.contains("page-section-head") && el.children.length > 0) return null;
  // A heading can carry its section's controls (Leasing's "By building" holds
  // the min-lease field and the auto-lease switch); their text is not the
  // heading's name — the chip read "By buildingMin. new lease, al…".
  const head0 = el.cloneNode(true) as HTMLElement;
  head0.querySelectorAll("label, input, button, select, .btn, .seg, .switch, .chip").forEach((n) => n.remove());
  const raw = (head0.textContent ?? "").replace(/\s+/g, " ").trim();
  if (!raw || raw.length > 72) return null;
  // "On the market · 7 · 2 of them yours" → "On the market"; "Milestones · 3 of 12" → "Milestones".
  // A numbered head ("1 · NOI — what the building earns") keeps its number:
  // cutting at the first " · " left "1", which the length test then dropped,
  // so the Primer's three lessons had no chips.
  const parts = raw.split(" · ");
  const head = /^\d+$/.test(parts[0].trim()) && parts.length > 1 ? `${parts[0].trim()} · ${parts[1]}` : parts[0];
  const label = head.split(" — ")[0].trim();
  if (!label || label.length < 3) return null;
  return label.length > 30 ? label.slice(0, 29).trimEnd() + "…" : label;
}

function SectionNav({ page, pageRef }: { page: Page; pageRef: React.RefObject<HTMLDivElement | null> }) {
  const [secs, setSecs] = useState<Sec[]>([]);
  const [active, setActive] = useState(0);
  const jumpDone = useRef<string | null>(null);
  const navRef = useRef<HTMLElement>(null);

  // A passive effect, deliberately: the ref on `.page` is the PARENT's, and
  // React attaches a parent's ref after its children's layout effects have
  // run — a layout-effect scan here saw a null ref on every fresh open and
  // never observed anything after.
  //
  // WATCHED CHEAPLY. This observed the whole page — every text node, every
  // table cell — and re-read layout (`offsetParent`) on the next frame after
  // any of it changed, so a page ticking its numbers re-scanned its headings
  // every frame. Now it watches only the desk on screen (the kept ones are
  // hidden siblings), rescans only when a mutation adds or removes something
  // that is or holds a heading, and at most every 150 ms.
  useEffect(() => {
    const page0 = pageRef.current;
    const root = page0?.querySelector<HTMLElement>(`:scope > .page-view[data-page="${page}"]`) ?? page0;
    if (!root) return;
    let timer = 0;
    const scan = () => {
      timer = 0;
      const seen = new Set<string>();
      const out: Sec[] = [];
      for (const el of Array.from(root.querySelectorAll<HTMLElement>(HEAD_SEL))) {
        // Nothing nested inside an expanded row (a refinance desk opened under
        // a loan) and nothing hidden earns a chip.
        if (el.closest(".panel-embed, .refi, .modal, .page-nav")) continue;
        if (!el.offsetParent) continue;
        const label = secLabel(el);
        if (!label || seen.has(label)) continue;
        seen.add(label);
        out.push({ el, label });
        if (out.length >= 12) break;
      }
      setSecs((prev) => (prev.length === out.length && prev.every((p, i) => p.el === out[i].el && p.label === out[i].label) ? prev : out));
    };
    scan();
    const touchesHead = (n: Node) =>
      n instanceof HTMLElement && (n.matches(HEAD_SEL) || !!n.querySelector(HEAD_SEL));
    const mo = new MutationObserver((recs) => {
      if (timer) return;
      for (const r of recs) {
        // a heading's own text changing (a count after the dot) is a child
        // list change of the heading itself
        const head = r.target instanceof HTMLElement && r.target.closest(".page-section-head, .deal-head");
        if (head || Array.from(r.addedNodes).some(touchesHead) || Array.from(r.removedNodes).some(touchesHead)) {
          timer = window.setTimeout(scan, 150);
          return;
        }
      }
    });
    mo.observe(root, { childList: true, subtree: true });
    return () => { mo.disconnect(); if (timer) clearTimeout(timer); };
  }, [page, pageRef]);

  // Which chip is lit: the last heading above the rail's own line.
  useEffect(() => {
    const root = pageRef.current;
    const scroller = root?.parentElement;
    if (!root || !scroller || secs.length < 3) return;
    let raf = 0;
    const mark = () => {
      raf = 0;
      const line = scroller.getBoundingClientRect().top + railOffset();
      let idx = 0;
      for (let i = 0; i < secs.length; i++) {
        if (secs[i].el.getBoundingClientRect().top <= line + 8) idx = i;
      }
      setActive(idx);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(mark); };
    mark();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => { scroller.removeEventListener("scroll", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [secs, pageRef]);

  // Where the rail's lower edge sits once it is stuck: the top bar, the
  // backdrop's 12px, the rail itself, and a breath.
  const railOffset = () => {
    const h = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--topbar-h")) || 91;
    return h + 12 + (navRef.current?.offsetHeight ?? 40) + 8;
  };
  const go = (sec: Sec, smooth = true) => {
    const root = pageRef.current;
    const scroller = root?.parentElement;
    if (!root || !scroller) return;
    const top = sec.el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - railOffset();
    scroller.scrollTo({ top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" });
  };

  // A section asked for by name, honoured once the page has painted it.
  const pageJump = useStore((s) => s.pageJump);
  useEffect(() => {
    if (!pageJump) { jumpDone.current = null; return; }
    if (jumpDone.current === pageJump) return;
    const want = pageJump.toLowerCase();
    const hit = secs.find((x) => x.label.toLowerCase().startsWith(want));
    if (!hit) return;
    jumpDone.current = pageJump;
    go(hit, false);
    useStore.setState({ pageJump: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageJump, secs]);

  if (secs.length < 3) return null;
  return (
    <nav className="page-nav" aria-label="Sections on this page" ref={navRef}>
      {secs.map((sec, i) => (
        <button
          key={sec.label}
          type="button"
          className={"page-nav-chip" + (i === active ? " on" : "")}
          onClick={() => go(sec)}
        >
          {sec.label}
        </button>
      ))}
    </nav>
  );
}

/**
 * PROGRESSIVE DISCLOSURE FOR THE LONG EXPLANATIONS.
 *
 * Many desks carry a paragraph of method under their numbers — useful once,
 * then a wall the eye has to climb past every visit. A plain hint longer than
 * about two lines at desk width is clamped to two, and opens in place on a
 * click. Hints with controls in them are left alone, and the Primer (which is
 * meant to be read) never folds. (It was 300 characters against a three-line
 * clamp, which at desk width folded almost nothing.)
 */
const FOLD_CHARS = 200;
function useHintFolds(ref: React.RefObject<HTMLDivElement | null>, page: Page) {
  useEffect(() => {
    const root = ref.current;
    if (!root || page === "primer") return;
    let raf = 0;
    const scan = () => {
      raf = 0;
      for (const el of Array.from(root.querySelectorAll<HTMLElement>(".hint:not([data-fold])"))) {
        el.dataset.fold = "1";
        if (el.closest(".modal, .primer-prose, .page-nav")) continue;
        if (el.querySelector("button, a, input, select, textarea")) continue;
        if ((el.textContent ?? "").length < FOLD_CHARS) continue;
        el.classList.add("hint-fold");
        el.title = "Expand";
      }
    };
    scan();
    const mo = new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(scan); });
    mo.observe(root, { childList: true, subtree: true });
    return () => { mo.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, [ref, page]);
}
