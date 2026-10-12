import { useLayoutEffect, useState } from "react";

/**
 * TWO COLUMNS THAT COME OUT EVEN.
 *
 * The property page was `columns: 2` with unbreakable sections. CSS columns
 * fill strictly in order, so with sections of 120, 150, 270, 140 and 170px the
 * first column took the first four and the second sat half empty — and one
 * tall section (the refinance desk) emptied a whole column on its own.
 *
 * This is the grid-masonry layout: the container is a two-column grid with
 * 4px rows, and each section spans as many rows as it is tall. Auto-placement
 * then drops each section into whichever column frees up first — the shorter
 * one — in reading order. Nothing re-mounts (a slider half-dragged or a typed
 * offer survives a neighbour growing), because only `grid-row-end` changes.
 *
 * The CSS decides whether the grid is on (`.page-backdrop` and ≥900px); when
 * it is not, the spans are cleared and the sections stack as before. A
 * section that is the only one on the tab spans both columns and lays itself
 * out across them (`.solo`), rather than leaving the right half blank.
 */
const ROW = 4;

/** Returns a callback ref for the container. */
export function useMasonry(): (el: HTMLElement | null) => void {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return;
    let raf = 0;
    const fit = () => {
      raf = 0;
      const kids = [...el.children] as HTMLElement[];
      const grid = getComputedStyle(el).display === "grid";
      const inFlow = kids.filter((k) => getComputedStyle(k).display !== "none");
      const halves = inFlow.filter((k) => !k.classList.contains("deal-wide") && !k.classList.contains("chip-row"));
      for (const k of kids) k.classList.toggle("solo", grid && halves.length === 1 && halves[0] === k);
      for (const k of kids) {
        if (!grid) { k.style.gridRowEnd = ""; continue; }
        const cs = getComputedStyle(k);
        const h = k.getBoundingClientRect().height + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
        const span = `span ${Math.max(1, Math.ceil(h / ROW))}`;
        if (k.style.gridRowEnd !== span) k.style.gridRowEnd = span;
      }
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(fit); };
    const ro = new ResizeObserver(kick);
    const watch = () => { ro.disconnect(); ro.observe(el); for (const k of el.children) ro.observe(k); kick(); };
    const mo = new MutationObserver(watch);
    mo.observe(el, { childList: true });
    watch();
    return () => { ro.disconnect(); mo.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, [el]);
  return setEl;
}
