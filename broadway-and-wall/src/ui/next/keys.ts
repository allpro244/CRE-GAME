/**
 * KEYS FOR THE NEW SHELL (BUILD_SPEC 2.4). Replaces the classic handler in
 * RightPanel when the new interface is on; the guards are the same ones:
 * nothing fires from a field, a card on screen blocks play and advance, and
 * Esc unwinds card → breakdown → drawer → selection.
 */
import { useEffect } from "react";
import { useStore } from "@/state/store";
import { topCard } from "@/ui/RightPanel";
import { onScreen } from "@/ui/onScreen";
import { useNext } from "./nextStore";
import { PLACES, placeById, placeOf, visibleTabs, type PlaceId } from "./places";

/** Open a place on its remembered tab; the open place closes. */
export function openPlace(id: PlaceId) {
  const nx = useNext.getState();
  const st = useStore.getState();
  if (id === "inbox") {
    const open = !nx.inboxOpen;
    nx.setInboxOpen(open);
    if (open && st.page !== "none") st.setPage("none");
    if (open && st.selectedBBL) st.select(null);
    return;
  }
  nx.setInboxOpen(false);
  const here = placeOf(st.page, nx.placeTab);
  if (here?.place === id) { st.setPage("none"); return; }
  const p = placeById(id);
  const tabs = visibleTabs(p, st.game);
  const t = tabs.find((x) => x.id === nx.placeTab[id]) ?? tabs[0];
  if (!t) return;
  nx.setPlaceTab(id, t.id);
  st.setPage(t.page, t.jump);
}

export function openTab(id: PlaceId, tabId: string) {
  const p = placeById(id);
  const t = p.tabs.find((x) => x.id === tabId);
  if (!t) return;
  useNext.getState().setPlaceTab(id, tabId);
  if (id === "inbox") return;
  useStore.getState().setPage(t.page, t.jump);
}

const busyToast = (what: string) =>
  useStore.setState({ toast: { text: `Answer the card first · ${what}`, kind: "err", at: Date.now() } });

export function useNextKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      const nx = useNext.getState();
      if ((e.metaKey || e.ctrlKey) && e.code === "KeyK") {
        e.preventDefault();
        if (st.game) st.setPaletteOpen(!st.paletteOpen);
        return;
      }
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      if (st.paletteOpen) return;
      if (e.code === "Space" && tag === "BUTTON") el?.blur();
      const plain = !e.metaKey && !e.ctrlKey && !e.altKey;

      if (e.key === "Escape") {
        if (st.photoFrame) { st.setPhotoFrame(false); return; }
        const card = topCard();
        if (card) {
          card.querySelector<HTMLButtonElement>("[data-esc]:not(:disabled)")?.click();
          return;
        }
        if (nx.drill) { nx.setDrill(null); return; }
        if (nx.inboxOpen) { nx.setInboxOpen(false); return; }
        if (st.page !== "none") {
          st.setPage("none");
          if (st.page === "property") st.select(null);
          return;
        }
        st.select(null);
        return;
      }
      if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); st.goBack(); return; }
      if (!plain) return;
      const modal = onScreen(".modal-backdrop");

      if (e.code === "KeyI" && !modal) { e.preventDefault(); openPlace("inbox"); return; }
      const digit = /^Digit([1-7])$/.exec(e.code);
      if (digit && !modal) {
        const p = PLACES.find((x) => x.key === digit[1]);
        if (p) { e.preventDefault(); openPlace(p.id); }
        return;
      }
      if (e.code === "KeyP") { e.preventDefault(); st.setPhotoFrame(!st.photoFrame); return; }
      if (e.code === "KeyM") { e.preventDefault(); st.setMapOnly(!st.mapOnly); return; }
      if (e.code === "KeyG" || e.code === "Space") {
        e.preventDefault();
        if (st.autoplay) { st.setAutoplay(0); return; }
        if (modal) { busyToast("play"); return; }
        if (!st.game?.gameOver) st.setAutoplay(1);
        return;
      }
      if (e.code === "KeyB" && st.selectedBBL && st.game) {
        const bbl = st.game.merged?.[st.selectedBBL] ?? st.selectedBBL;
        const li = st.game.listings.find((l) => l.bbl === bbl);
        if (li && !st.game.holdings[bbl] && !st.game.talks?.[bbl]) { e.preventDefault(); st.offer(bbl, li.ask, false); }
        return;
      }
      if (st.advancing) return;
      const time = e.code === "Period" || e.code === "KeyY" || e.code === "KeyN";
      if (time && modal) { e.preventDefault(); busyToast("advance"); return; }
      if (e.code === "Period") { e.preventDefault(); void st.advance(); }
      else if (e.code === "KeyY") st.advanceYear();
      else if (e.code === "KeyN") st.advanceUntil();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
