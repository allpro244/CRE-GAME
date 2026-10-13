// WHAT YOU KNOW ABOUT A COMPETITOR — COMPETITORS_PLAN.md §2.4.
//
// A firm's sheet is the truth about it. You do not get to see the truth; you
// get a READ: a range for each number, wide when you have never dealt with
// them and narrowing as you trade with them, lose to them, and watch what they
// do on the tape. Their Secrecy keeps it wide for longer. A hidden trait
// (Panic threshold) shows `??` until an event gives it away.
//
// Display only. Nothing in the economy reads a read; nothing here draws on an
// RNG stream (the opening error is hashed), so knowing more about a firm can
// never change what the firm does.
import type { GameState, Rival } from "./types";
import { TRAITS, TRAIT_OF, hash01, type Sheet, type TraitKey } from "./competitorTraits";

export type Band = [number, number];

/** The band you open with: about ±22, off-centre, wider for a secretive firm. */
function openingBand(s: GameState, r: Rival, sheet: Sheet, k: TraitKey): Band {
  const truth = sheet[k];
  const half = 22 + (sheet.secrecy - 50) / 5;                    // 12 .. 32
  const shift = (hash01(`${s.seed}:read:${r.id}:${k}`) * 2 - 1) * half * 0.8;
  const lo = Math.max(1, Math.min(truth, Math.round(truth + shift - half)));
  const hi = Math.min(100, Math.max(truth, Math.round(truth + shift + half)));
  return [lo, hi];
}

/** The read on one trait, or null while a hidden trait is still hidden. */
export function readOf(s: GameState, r: Rival, sheet: Sheet, k: TraitKey): Band | null {
  const stored = s.reads?.[r.id]?.[k];
  if (TRAIT_OF[k].hidden && !stored) return null;
  return stored ?? openingBand(s, r, sheet, k);
}

/**
 * LEARN SOMETHING. Each band closes toward the truth by `k` (0..1) of its
 * remaining width, less for a secretive firm. `reveal` sets a hidden trait's
 * opening band so it starts to show.
 */
export function observe(s: GameState, r: Rival, sheet: Sheet, keys: readonly (TraitKey | null | undefined)[], k: number) {
  const book = ((s.reads ??= {})[r.id] ??= {});
  const damp = 1 - sheet.secrecy / 250;                          // 0.6 .. 1
  for (const key of keys) {
    if (!key) continue;
    const truth = sheet[key];
    const [lo, hi] = book[key] ?? openingBand(s, r, sheet, key);
    const f = Math.max(0, Math.min(1, k * damp));
    book[key] = [Math.round(lo + (truth - lo) * f), Math.round(hi - (hi - truth) * f)];
  }
}

/** A year passes: everything you can see narrows a little. */
export function yearOfWatching(s: GameState, r: Rival, sheet: Sheet) {
  observe(s, r, sheet, TRAITS.filter((t) => !t.hidden || s.reads?.[r.id]?.[t.key]).map((t) => t.key), 0.04);
}

/** "62" when the band is tight, "40–65" when it is not, "??" when hidden. */
export function bandText(b: Band | null): string {
  if (!b) return "??";
  return b[1] - b[0] <= 4 ? String(Math.round((b[0] + b[1]) / 2)) : `${b[0]}–${b[1]}`;
}
