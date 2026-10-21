import { useEffect, useState } from "react";
import MapView from "@/map/MapView";
import TopBar from "@/ui/TopBar";
import RightPanel from "@/ui/RightPanel";
import DesignPeekBar from "@/ui/DesignPeekBar";
import StartMenu from "@/ui/StartMenu";
import MapRail from "@/ui/MapRail";
import MapControls from "@/ui/MapControls";
import YearReview, { MilestoneFlash, ExitCard, GoalCard } from "@/ui/YearReview";
import Shortcuts from "@/ui/Shortcuts";
import AutoPlay from "@/ui/AutoPlay";
import Sounds from "@/ui/Sounds";
import RunRecorder from "@/ui/RunRecords";
import DeliveryCeremony from "@/ui/DeliveryCeremony";
import PrimerOffer from "@/ui/PrimerOffer";
import { bootMenu, useStore } from "@/state/store";
import AtRiskBanner from "@/ui/AtRiskBanner";
import CardQueue from "@/ui/CardQueue";
import MapBoundary from "@/ui/MapBoundary";
import UnrealSurface from "@/ui/UnrealSurface";
import { UNREAL_HOST, startUnrealHost } from "@/state/unrealHost";
import { useNext } from "@/ui/next/nextStore";
import Shell from "@/ui/next/Shell";

export default function App() {
  const loadError = useStore((s) => s.loadError);
  // THE GAME NO LONGER STARTS ITSELF. Mounting used to generate a city and
  // drop the player into it; it now checks for a named save and stops, and the
  // start screen decides what gets built. MapView stays mounted throughout —
  // it waits on `city`, which is null until somebody breaks ground.
  const playing = useStore((s) => s.phase === "playing");
  const photoFrame = useStore((s) => s.photoFrame);
  // THE NEW INTERFACE (ui-revamp), behind Settings › Interface. It replaces the
  // top bar, the desks, the map rail and the map controls; the moments are
  // not mounted in it (PLAN R6) and their events still reach the news.
  const next = useNext((s) => s.uiShell === "next");
  // ONE CARD AT A TIME. The year's review, a goal verdict, an exit and a
  // delivery are each a moment, and one advance can produce all four — they
  // used to arrive stacked on top of each other. They queue now, in the order
  // a principal would read them: the year, the goal, the sale, the building.
  // Each still clears its own state, and the next one shows when it does.
  // A card that would not draw itself (pop-ups off, the run over) must not
  // hold the queue either, so the gates here are the cards' own.
  const card = useStore((s) => {
    if (s.popupsOff) return null;
    const over = !!s.game?.gameOver;
    return s.yearReviewY !== null && s.yearReviewOpen && !over ? "year"
      : s.goalCard && s.game?.goal ? "goal"
      : s.exitCard && !over ? "exit"
      : s.deliveryCeremony ? "delivery"
      : null;
  });
  // How many moments wait behind the one on screen: the pill counts mounted
  // cards, and only one moment is ever mounted.
  const momentsWaiting = useStore((s) => {
    if (s.popupsOff) return 0;
    const over = !!s.game?.gameOver;
    const n = [s.yearReviewY !== null && s.yearReviewOpen && !over, !!(s.goalCard && s.game?.goal),
      !!(s.exitCard && !over), !!s.deliveryCeremony].filter(Boolean).length;
    return Math.max(0, n - 1);
  });
  useEffect(() => {
    void bootMenu();
    startUnrealHost();
  }, []);
  // RightPanel (and its keybindings) unmount in photo frame — keep P/Esc here.
  useEffect(() => {
    if (!photoFrame) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Escape" || (e.code === "KeyP" && !e.metaKey && !e.ctrlKey && !e.altKey)) {
        e.preventDefault();
        useStore.getState().setPhotoFrame(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [photoFrame]);
  return (
    <div className={"app" + (photoFrame ? " photo-frame" : "")}>
      {UNREAL_HOST ? <UnrealSurface /> : <MapBoundary><MapView /></MapBoundary>}
      {playing && !photoFrame && next && <Shell />}
      {playing && !photoFrame && !next && <TopBar />}
      {playing && !photoFrame && !next && <MapRail />}
      {playing && !photoFrame && !next && <MapControls />}
      {playing && !photoFrame && <DesignPeekBar />}
      {!photoFrame && !(next && playing) && <RightPanel />}
      {!photoFrame && (card === "delivery" && !next || !playing) && <DeliveryCeremony />}
      {playing && !photoFrame && !next && card === "year" && <YearReview />}
      {playing && !photoFrame && !next && <MilestoneFlash />}
      {playing && !photoFrame && !next && card === "exit" && <ExitCard />}
      {playing && !photoFrame && !next && card === "goal" && <GoalCard />}
      {playing && <Shortcuts />}
      {playing && <AutoPlay />}
      {playing && <Sounds />}
      {playing && <RunRecorder />}
      {playing && !photoFrame && !next && <PrimerOffer />}
      {playing && !photoFrame && !next && <CardQueue extra={momentsWaiting} />}
      {photoFrame && <PhotoFrameHint />}
      <Toast />
      {!playing && <StartMenu />}
      {/* The start screen carries its own copy of this, because a city that
          would not build is the one error you can still act on from there. */}
      {loadError && playing && <div className="load-error">{loadError}</div>}
    </div>
  );
}

function PhotoFrameHint() {
  const setPhotoFrame = useStore((s) => s.setPhotoFrame);
  return (
    <button
      type="button"
      className="photo-frame-hint"
      onClick={() => setPhotoFrame(false)}
      title="Exit photo frame (P or Escape)"
    >
      Photo frame · P / Esc to exit
    </button>
  );
}

/**
 * THE TOAST LANE. One slot used to mean the month-close line overwrote
 * whatever the same click had just said ("◆ Delivered", "Stopped after…") on
 * the same tick. The store still sets a single `toast`; this keeps the last
 * three on screen, newest at the bottom, each for as long as it takes to read.
 */
type ToastItem = { text: string; kind: "ok" | "err" | "critical"; at: number; attnKey?: string; yearReview?: boolean; id: number };
let toastSeq = 0;
function Toast() {
  const toast = useStore((s) => s.toast);
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    if (!toast) return;
    const id = ++toastSeq;
    // A line about the same thing replaces the older one: a balloon toasted
    // in June ("7 months") and again in July ("6 months") used to sit stacked,
    // the same sentence twice with one number changed.
    setItems((xs) => [...xs.filter((x) => x.text !== toast.text && !(toast.attnKey && x.attnKey === toast.attnKey)), { ...toast, id }].slice(-3));
    // ~3s for a short line, longer for a long one; errors linger, and a stop
    // for something being taken from you lingers longest.
    const ms = Math.min(9000, 2600 + toast.text.length * 35)
      + (toast.kind === "err" ? 1500 : toast.kind === "critical" ? 6000 : 0);
    // Not cleared when the next toast lands — each line keeps its own clock.
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), ms);
  }, [toast]);
  const playing = useStore((s) => s.phase === "playing" && !s.photoFrame);
  const next = useNext((s) => s.uiShell === "next");
  if (!items.length && !playing) return null;
  return (
    <div className="toast-stack">
      {playing && !next && <AtRiskBanner />}
      {items.map((t) => (
        <div
          key={t.id}
          className={"toast toast-" + t.kind + (t.attnKey || t.yearReview ? " toast-link" : "")}
          title={t.attnKey || t.yearReview ? "Open it" : undefined}
          role={t.kind === "ok" ? "status" : "alert"}
          aria-live={t.kind === "ok" ? "polite" : "assertive"}
          aria-atomic="true"
          onClick={() => {
            setItems((xs) => xs.filter((x) => x.id !== t.id));
            // A stop names the thing that stopped it; the click takes you there.
            if (t.attnKey) useStore.getState().openAttention(t.attnKey);
            if (t.yearReview) useStore.getState().openYearReview();
          }}
        >
          {t.kind === "critical" && <span className="toast-alarm" aria-hidden="true">⚠ </span>}
          {t.text}
          {(t.attnKey || t.yearReview) && <span className="toast-go" aria-hidden="true"> Open →</span>}
        </div>
      ))}
    </div>
  );
}
