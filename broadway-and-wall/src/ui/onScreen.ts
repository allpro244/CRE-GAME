/**
 * THE FIRST MATCH THE PLAYER CAN SEE. The last desks visited stay mounted but
 * hidden (RightPanel, `<Activity mode="hidden">`), so a confirm left open on
 * one of them is still in the document. "Is a card on the desk?" means a card
 * on screen: a hidden one has no boxes and does not count.
 */
export function onScreen(selector: string): HTMLElement | null {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
    if (el.getClientRects().length) return el;
  }
  return null;
}
