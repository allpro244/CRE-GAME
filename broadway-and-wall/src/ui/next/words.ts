/**
 * THE RUNTIME HALF OF THE WORD BUDGET (PLAN R1). Inbox facts and toasts are
 * built from game data, so the lint cannot read them; in a dev build a fact
 * over its budget logs an error naming it. Production builds skip the check.
 */
export function wordCount(s: string): number {
  return s.replace(/[·|/→←—–]/g, " ").trim().split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
}

export function assertWords(s: string, max: number, what = "fact"): string {
  if (import.meta.env?.DEV && wordCount(s) > max) {
    console.error(`[ui-words] ${what} over ${max} words: "${s}"`);
  }
  return s;
}

/** Cut to the first `max` words — used only on engine-written labels with no fact builder. */
export function clipWords(s: string, max: number): string {
  const parts = s.replace(/\s+/g, " ").trim().split(" ");
  return parts.length <= max ? s : parts.slice(0, max).join(" ").replace(/[,;:—–-]+$/, "") + "…";
}
