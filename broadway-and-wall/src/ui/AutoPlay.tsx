import { useEffect } from "react";
import { useStore } from "@/state/store";
import { onScreen } from "@/ui/onScreen";
import { stopRule } from "@/engine/sim";
import { beatsBetween } from "@/engine/storyline";

/** Headline stops spent this quarter — the pacing cap for a spectator. */
const beatBudget = { q: -1, n: 0 };

/** Milliseconds per month at each speed, start to start. The tick runs in the sim worker. */
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
      const blocking = st.game.spectator ? null : onScreen(".modal-backdrop, .delivery-ceremony");
      if (st.advancing || st.paletteOpen || blocking) {
        // A card on the desk: wait for it rather than stop, unless it is a
        // decision — those stop the clock like they stop Yr.
        if (onScreen(".modal-backdrop")) {
          // Name the card: "a card on your desk" said nothing the card did not.
          const t = document.querySelector(".app > .modal-backdrop .modal-title")?.textContent?.trim();
          pause(t ? `${t} is waiting on your answer` : "a card on your desk needs an answer");
          return;
        }
        timer = setTimeout(step, 400);
        return;
      }
      const prev = st.game;
      const stop = stopRule(prev, st.parcels, st.cardSeen);
      // The month closes in the sim worker; the map keeps drawing meanwhile.
      // The pace runs from the moment the month is on screen, so a slow tick
      // shortens the wait rather than stacking on top of it.
      const t0 = performance.now();
      void st.advance({ quiet: true }).then(() => {
        if (cancelled) return;
        const next = useStore.getState().game;
        if (next && next !== prev) {
          // A spectator is not at the desk: nothing of the player's stops the clock.
          const why = next.spectator ? undefined : stop(next);
          if (why) { pause(why.label, why.key, why.critical); return; }
          // BUT THE CITY'S STORY DOES (COMPETITORS_PLAN.md §7): a spectator's
          // clock stops on a headline beat — a firm going under, falling into
          // crisis, a tower topping out — at most three a quarter.
          if (next.spectator) {
            const beats = beatsBetween(prev, next);
            const q = Math.floor(next.month / 3);
            if (beatBudget.q !== q) { beatBudget.q = q; beatBudget.n = 0; }
            if (beats.length && beatBudget.n < 3) {
              beatBudget.n++;
              pause(`BREAKING: ${beats[0]}`);
              return;
            }
          }
          if (next.gameOver) { useStore.setState({ autoplay: 0 }); return; }
        }
        const pace = PACE[useStore.getState().autoplay as 1 | 2] ?? PACE[1];
        timer = setTimeout(step, Math.max(60, pace - (performance.now() - t0)));
      });
    };
    timer = setTimeout(step, 150);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [autoplay]);
  return null;
}
