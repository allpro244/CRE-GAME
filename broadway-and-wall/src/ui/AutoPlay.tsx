import { useEffect } from "react";
import { useStore } from "@/state/store";
import { stopRule } from "@/engine/sim";

/** Milliseconds per month at each speed. The tick itself takes most of 0.3s on a large town. */
const PACE: Record<1 | 2, number> = { 1: 1000, 2: 330 };

/**
 * THE CLOCK, RUNNING. No UI of its own — the Play button in the top bar sets
 * `autoplay`, and this advances a month at a time while it is on. It pauses on
 * exactly what Yr ▸▸ would stop on (the same stopRule), on any card that wants
 * an answer (a decision modal, the year review, a delivery or exit card), and
 * when the run ends. A paused clock says why.
 */
export default function AutoPlay() {
  const autoplay = useStore((s) => s.autoplay);
  useEffect(() => {
    if (!autoplay) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const pause = (why: string, attnKey?: string, critical?: boolean) => {
      useStore.setState({ autoplay: 0, toast: { text: `Paused — ${why}`, kind: critical ? "critical" : "ok", at: Date.now(), attnKey } });
    };
    const step = () => {
      if (cancelled) return;
      const st = useStore.getState();
      if (!st.autoplay || !st.game || !st.parcels) return;
      if (st.game.gameOver) { useStore.setState({ autoplay: 0 }); return; }
      // A spectator is not at the desk; a card about the world does not stop the match.
      const blocking = st.game.spectator ? null : document.querySelector(".modal-backdrop, .delivery-ceremony");
      if (st.advancing || st.paletteOpen || blocking) {
        // A card on the desk: wait for it rather than stop, unless it is a
        // decision — those stop the clock like they stop Yr.
        if (document.querySelector(".modal-backdrop")) { pause("a card on your desk needs an answer"); return; }
        timer = setTimeout(step, 400);
        return;
      }
      const prev = st.game;
      const stop = stopRule(prev, st.parcels);
      st.advance({ quiet: true });
      const next = useStore.getState().game;
      if (next && next !== prev) {
        // A spectator is not at the desk: nothing of the player's stops the clock.
        const why = next.spectator ? undefined : stop(next);
        if (why) { pause(why.label, why.key, why.critical); return; }
        if (next.gameOver) { useStore.setState({ autoplay: 0 }); return; }
      }
      timer = setTimeout(step, PACE[useStore.getState().autoplay as 1 | 2] ?? PACE[1]);
    };
    timer = setTimeout(step, 150);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [autoplay]);
  return null;
}
