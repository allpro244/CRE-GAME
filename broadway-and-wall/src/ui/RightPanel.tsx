// The game's chrome: a parcel card docked to the map, and full-page views
// for Portfolio / Deals / Market — big rooms, not side-panel squints.
import { useEffect } from "react";
import { useStore } from "@/state/store";
import StaffPage from "@/ui/StaffPage";
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
import { LeasingPage } from "@/ui/panels/LeasingPage";
import { DebtPage } from "@/ui/panels/DebtPage";
import { PropertyPage } from "@/ui/panels/PropertyPage";
import {
  DecisionModal, AlertModal, AuctionModal, DefaultNoticeModal, GameOverPage,
} from "@/ui/panels/modals";

export { liveBrokerCalls } from "@/ui/panels/broker";

export default function GamePanels() {
  // Subscribe narrowly: a full `game` subscription re-rendered this shell (and
  // used to re-render the docked ParcelPanel) on every Advance/cash write.
  const gameOver = useStore((s) => !!s.game?.gameOver);
  const hasGame = useStore((s) => !!s.game);
  const page = useStore((s) => s.page);
  const setPage = useStore((s) => s.setPage);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Escape") { setPage("none"); return; }
      const st = useStore.getState();
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
  }, [setPage]);
  if (!hasGame) return null;
  const title = page === "portfolio" ? "Portfolio"
    : page === "deals" ? "The Deals Desk"
    : page === "books" ? "The Books"
    : page === "news" ? "The Tape"
    : page === "leasing" ? "Leasing & Occupancy"
    : page === "debt" ? "Debt"
    : page === "property" ? "Property"
    : page === "saves" ? "Saved Games"
    : page === "economy" ? "The Economy"
    : page === "research" ? "Research"
    : page === "notes" ? "The Note Desk"
    : page === "staff" ? "The Desk"
    : page === "settings" ? "Settings"
    : page === "primer" ? "How this business works"
    : "The Marketplace";
  return (
    <>
      <ParcelPanel />
      {page !== "none" && (
        <div className="page-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setPage("none"); }}>
          <div className="page">
            <div className="page-head">
              <div className="page-title">{title}</div>
              <button className="panel-close" onClick={() => setPage("none")}>×</button>
            </div>
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
            {page === "settings" && <SettingsPage />}
            {page === "primer" && <PrimerPage />}
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
