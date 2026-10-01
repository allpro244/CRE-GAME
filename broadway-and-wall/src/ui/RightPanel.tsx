// The game's chrome: a glance card on the map, and firm desks as big rooms.
// Detail pages are parchment sheets sized for underwriting — not a narrow
// right-hand column that crams a rent roll into six hundred pixels.
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/state/store";
import type { Page } from "@/state/store";
import StaffPage from "@/ui/StaffPage";
import Palette from "@/ui/Palette";
import FirmTimeline from "@/ui/FirmTimeline";
import { ParcelPanel } from "@/ui/panels/ParcelDesk";
import { PortfolioPage } from "@/ui/panels/PortfolioPage";
import { DealsPage } from "@/ui/panels/DealsPage";
import { MarketPage } from "@/ui/panels/MarketPage";
import { ResearchPage } from "@/ui/panels/ResearchPage";
import { NotesPage } from "@/ui/panels/NotesPage";
import { EconomyPage } from "@/ui/panels/EconomyPage";
import { BooksPage } from "@/ui/panels/BooksPage";
import { NewsPage } from "@/ui/panels/NewsPage";
import { SavesPage, SettingsPage, PrimerPage } from "@/ui/panels/MiscPages";
import { MatchPage } from "@/ui/panels/JevPanel";
import { LeasingPage } from "@/ui/panels/LeasingPage";
import { DebtPage } from "@/ui/panels/DebtPage";
import { PropertyPage } from "@/ui/panels/PropertyPage";
import {
  DecisionModal, AlertModal, AuctionModal, DefaultNoticeModal, GameOverPage,
} from "@/ui/panels/modals";

import { PAGE_KEYS } from "@/ui/Shortcuts";

export { liveBrokerCalls } from "@/ui/panels/broker";

export default function GamePanels() {
  // Subscribe narrowly: a full `game` subscription re-rendered this shell (and
  // used to re-render the docked ParcelPanel) on every Advance/cash write.
  const gameOver = useStore((s) => !!s.game?.gameOver);
  const hasGame = useStore((s) => !!s.game);
  const page = useStore((s) => s.page);
  const mapOnly = useStore((s) => s.mapOnly);
  const setPage = useStore((s) => s.setPage);
  const pageRef = useRef<HTMLDivElement>(null);
  useHintFolds(pageRef, page);
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
      // A dropdown owns its arrow and letter keys, and Space on a focused
      // button presses that button — it must not also advance the month.
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      if (e.code === "Space" && tag === "BUTTON") return;
      if (e.key === "Escape") {
        const st0 = useStore.getState();
        if (st0.photoFrame) {
          st0.setPhotoFrame(false);
          return;
        }
        if (document.querySelector(".modal-backdrop")) {
          useStore.setState({
            toast: { text: "Use the card’s action or defer button before closing it.", kind: "err", at: Date.now() },
          });
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
      // Desk hotkeys, 1-9 — the list and the "?" card share PAGE_KEYS.
      if (!e.metaKey && !e.ctrlKey && !e.altKey && /^Digit[1-9]$/.test(e.code) && !document.querySelector(".modal-backdrop")) {
        const hit = PAGE_KEYS.find((k) => k.key === e.code.slice(5));
        if (hit) { e.preventDefault(); setPage(page === hit.page ? "none" : hit.page); return; }
      }
      if (e.code === "KeyG" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        if (!st.game?.gameOver) st.setAutoplay(st.autoplay ? 0 : 1);
        return;
      }
      if (st.advancing) return;
      const wantsTime = e.code === "Space" || e.code === "KeyY" || e.code === "KeyN";
      if (wantsTime && document.querySelector(".modal-backdrop")) {
        e.preventDefault();
        useStore.setState({
          toast: { text: "Answer or dismiss the card on your desk before advancing time.", kind: "err", at: Date.now() },
        });
        return;
      }
      if (e.code === "Space") { e.preventDefault(); st.advance(); }
      else if (e.code === "KeyY") st.advanceYear();
      else if (e.code === "KeyN") st.advanceUntil();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [page, setPage]);
  if (!hasGame) return null;
  const title = page === "portfolio" ? "Portfolio"
    : page === "deals" ? "The Deals Desk"
    : page === "books" ? "The Books"
    : page === "news" ? "The Tape"
    : page === "leasing" ? "Leasing & Occupancy"
    : page === "debt" ? "Debt"
    : page === "property" ? "Property"
    : page === "saves" ? "Saved Games"
    : page === "economy" ? "Economy"
    : page === "research" ? "Research"
    : page === "notes" ? "The Note Desk"
    : page === "staff" ? "The Desk"
    : page === "firm" ? "The Record"
    : page === "settings" ? "Settings"
    : page === "primer" ? "How this business works"
    : page === "match" ? "The Jev Match"
    : "The Marketplace";
  const kicker = page === "portfolio" || page === "leasing" || page === "staff" || page === "property" || page === "firm" ? "Assets"
    : page === "deals" || page === "market" || page === "notes" ? "Acquire"
    : page === "debt" || page === "books" ? "Capital"
    : page === "economy" ? "Economy"
    : page === "research" || page === "news" ? "World"
    : page === "saves" ? "Campaign"
    : page === "settings" ? "Preferences"
    : page === "primer" ? "Primer"
    : page === "match" ? "Street"
    : "Acquire";
  const subtitle = page === "portfolio" ? "Value, income, concentration and the shape of what you own."
    : page === "deals" ? "Every live negotiation, bid, contract and clock on your desk."
    : page === "books" ? "Cash movement, operating results and the record of the firm."
    : page === "news" ? "What changed in the city, and what may change next."
    : page === "leasing" ? "Occupancy, expirations and the mandate you have delegated."
    : page === "debt" ? "Coverage, maturities, pricing and refinancing risk across the book."
    : page === "property" ? "The complete operating, financing and development record."
    : page === "saves" ? "Named snapshots you can return to. The live campaign autosaves on its own."
    : page === "economy" ? "The real economy, space markets and construction cycle beneath every deal."
    : page === "research" ? "Comparable evidence, submarkets and the assumptions behind value."
    : page === "notes" ? "Buy bank paper, write private bridges, service what you hold."
    : page === "staff" ? "Capacity, judgment and the people carrying your mandates."
    : page === "firm" ? "Every deed, delivery, exit and refinancing since founding — the campaign on one strip."
    : page === "settings" ? "Display, interruption and simulation controls."
    : page === "primer" ? "The quantities this game expects you to reason with."
    : page === "match" ? "Firms whose judgement Jev informs: how they are doing, what Jev said, and what code did with it."
    : "On-market listings, off-market calls and motivated sellers.";
  // The map card is a glance. Firm desks open as rooms (~1100px parchment)
  // so a rent roll, deal stage or debt book is readable — the narrow right
  // dock from the map-first pass was too small for that work.
  return (
    <>
      <Palette />
      {page === "none" && <ParcelPanel />}
      {page !== "none" && !mapOnly && (
        <div
          className="page-backdrop"
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
            <SectionNav page={page} pageRef={pageRef} />
            {page === "portfolio" && <PortfolioPage />}
            {page === "deals" && <DealsPage />}
            {page === "market" && <MarketPage />}
            {page === "research" && <ResearchPage />}
            {page === "notes" && <NotesPage />}
            {page === "economy" && <EconomyPage />}
            {page === "books" && <BooksPage />}
            {page === "news" && <NewsPage />}
            {page === "saves" && <SavesPage />}
            {page === "leasing" && <LeasingPage />}
            {page === "debt" && <DebtPage />}
            {page === "property" && <PropertyPage />}
            {page === "staff" && <StaffPage />}
            {page === "firm" && <FirmTimeline />}
            {page === "settings" && <SettingsPage />}
            {page === "primer" && <PrimerPage />}
            {page === "match" && <MatchPage />}
          </div>
        </div>
      )}
      {/* THE INTERRUPTIONS THE ENGINE RAISES, ABOVE THE ONES IT SCHEDULES. An
          alert and a letter of intent can land in the same month, and the order
          matters: the bank that failed is the reason you would answer the letter
          differently. Both render at the same z-index, so the one written last
          is the one on top. */}
      <DecisionModal />
      <AlertModal />
      <AuctionModal />
      <DefaultNoticeModal />
      {/* yield to the saves page — this used to paint over it at the same
          z-index, leaving every control on it visible and dead */}
      {gameOver && page !== "saves" && <GameOverPage />}
    </>
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
const HEAD_SEL = ".page-section-head, .deal-head, .page-section";
type Sec = { el: HTMLElement; label: string };

function secLabel(el: HTMLElement): string | null {
  // A `.page-section` is usually a container; only the bare-text ones are heads.
  if (el.classList.contains("page-section") && !el.classList.contains("page-section-head") && el.children.length > 0) return null;
  const raw = (el.textContent ?? "").replace(/\s+/g, " ").trim();
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
  useEffect(() => {
    const root = pageRef.current;
    if (!root) return;
    let raf = 0;
    const scan = () => {
      raf = 0;
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
    const mo = new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(scan); });
    mo.observe(root, { childList: true, subtree: true, characterData: true });
    return () => { mo.disconnect(); if (raf) cancelAnimationFrame(raf); };
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
 * a few lines is clamped to three, and opens in place on a click. Hints with
 * controls in them are left alone, and the Primer (which is meant to be read)
 * never folds.
 */
const FOLD_CHARS = 300;
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
        el.title = "Click to read the rest";
      }
    };
    scan();
    const mo = new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(scan); });
    mo.observe(root, { childList: true, subtree: true });
    return () => { mo.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, [ref, page]);
}
