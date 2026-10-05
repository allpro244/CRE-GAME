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

export default function App() {
  const loadError = useStore((s) => s.loadError);
  // THE GAME NO LONGER STARTS ITSELF. Mounting used to generate a city and
  // drop the player into it; it now checks for a named save and stops, and the
  // start screen decides what gets built. MapView stays mounted throughout —
  // it waits on `city`, which is null until somebody breaks ground.
  const playing = useStore((s) => s.phase === "playing");
  const photoFrame = useStore((s) => s.photoFrame);
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
    return s.yearReviewY !== null && !over ? "year"
      : s.goalCard && s.game?.goal ? "goal"
      : s.exitCard && !over ? "exit"
      : s.deliveryCeremony ? "delivery"
      : null;
  });
  useEffect(() => {
    void bootMenu();
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
      <MapView />
      {playing && !photoFrame && <TopBar />}
      {playing && !photoFrame && <MapRail />}
      {playing && !photoFrame && <MapControls />}
      {playing && !photoFrame && <DesignPeekBar />}
      {!photoFrame && <RightPanel />}
      {!photoFrame && (card === "delivery" || !playing) && <DeliveryCeremony />}
      {playing && !photoFrame && card === "year" && <YearReview />}
      {playing && !photoFrame && <MilestoneFlash />}
      {playing && !photoFrame && card === "exit" && <ExitCard />}
      {playing && !photoFrame && card === "goal" && <GoalCard />}
      {playing && <Shortcuts />}
      {playing && <AutoPlay />}
      {playing && <Sounds />}
      {playing && <RunRecorder />}
      {playing && !photoFrame && <PrimerOffer />}
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
type ToastItem = { text: string; kind: "ok" | "err"; at: number; id: number };
let toastSeq = 0;
function Toast() {
  const toast = useStore((s) => s.toast);
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    if (!toast) return;
    const id = ++toastSeq;
    setItems((xs) => [...xs.filter((x) => x.text !== toast.text), { ...toast, id }].slice(-3));
    // ~3s for a short line, longer for a long one; errors linger.
    const ms = Math.min(9000, 2600 + toast.text.length * 35) + (toast.kind === "err" ? 1500 : 0);
    // Not cleared when the next toast lands — each line keeps its own clock.
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), ms);
  }, [toast]);
  if (!items.length) return null;
  return (
    <div className="toast-stack">
      {items.map((t) => (
        <div
          key={t.id}
          className={"toast toast-" + t.kind}
          role={t.kind === "err" ? "alert" : "status"}
          aria-live={t.kind === "err" ? "assertive" : "polite"}
          aria-atomic="true"
          onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
