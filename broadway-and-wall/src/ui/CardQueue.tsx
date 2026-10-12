import { useEffect, useState } from "react";

/**
 * HOW MANY CARDS ARE WAITING.
 *
 * The engine's cards (an alert, a default notice, a letter, the auction) and
 * the moments (the year, a goal, an exit, a delivery) now take the screen one
 * at a time — hud.css draws only the first. Without a count, answering one
 * and having another appear reads as the game nagging; with one, it reads as
 * a short stack of mail. It counts the cards actually mounted on the shell,
 * so it can never disagree with what is behind the one you are reading.
 */
export default function CardQueue() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const app = document.querySelector(".app");
    if (!app) return;
    // A card that holds a queue of its own (four letters, three workouts)
    // says how many with data-queue; anything else counts as one.
    let shown: HTMLElement | null = null;
    const count = () => {
      const cards = Array.from(app.querySelectorAll<HTMLElement>(":scope > .modal-backdrop, :scope > .delivery-ceremony"));
      setN(cards.reduce((a, el) => a + Math.max(1, Number(el.dataset.queue) || 1), 0));
      // FOCUS GOES WITH THE CARD. A card that takes the screen left keyboard
      // focus on whatever was clicked behind it, so Tab walked the hidden
      // page. The card itself takes focus (not its first button — Enter must
      // never sign a lease by accident); Tab moves into its buttons from there.
      const top = cards.find((el) => el.getClientRects().length > 0) ?? null;
      const inner = top?.querySelector<HTMLElement>(".modal, .delivery-stamp") ?? null;
      if (inner && inner !== shown) {
        shown = inner;
        if (!inner.hasAttribute("tabindex")) inner.setAttribute("tabindex", "-1");
        if (!inner.contains(document.activeElement)) inner.focus({ preventScroll: true });
      }
      if (!inner) shown = null;
    };
    // The queue inside a card changes without the card remounting.
    const mo2 = new MutationObserver(count);
    mo2.observe(app, { subtree: true, attributes: true, attributeFilter: ["data-queue"] });
    count();
    const mo = new MutationObserver(count);
    mo.observe(app, { childList: true });
    return () => { mo.disconnect(); mo2.disconnect(); };
  }, []);
  if (n < 2) return null;
  return (
    <div className="card-queue" role="status" aria-live="polite">
      <span className="card-queue-dot" aria-hidden="true" />
      {n - 1} more {n - 1 === 1 ? "card" : "cards"} after this one
      <span className="card-queue-key"><kbd>Esc</kbd> not now</span>
    </div>
  );
}
