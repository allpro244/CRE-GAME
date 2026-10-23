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

/**
 * A TOAST AS A FACT (PLAN R1: at most 8 words, numbers first). The store and
 * the engine write their messages as sentences for the classic shell; the new
 * shell shows each one cut to its fact: the commonest ones rewritten, the rest
 * reduced to the first clause of each " · " part. The full sentence still
 * reaches the news and the classic shell unchanged.
 */
const REWRITES: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^They countered at (\$[\d.,]+[KMB]?)/, (m) => `Counter ${m[1]}`],
  [/^Agreed at (\$[\d.,]+[KMB]?)/, (m) => `Agreed ${m[1]} · fund it`],
  [/^Closed\. The deed is yours/, () => "Closed · deed yours"],
  [/^◆ Delivered — ([^:.]+)(?:: worth ([^ ]+) against ([^ ]+) all-in)?/, (m) => `Delivered · ${m[1]}${m[2] ? ` · ${m[2]} vs ${m[3]}` : ""}`],
  [/^Stopped after (\d+) mo: /, (m) => `Stopped · ${m[1]} mo · `],
  [/^A year passes\./, () => "Year passed"],
  [/^Three quiet years\..*?(?= · |$)/, () => "3 quiet years"],
  [/^Saved to “([^”]+)”/, (m) => `Saved · ${m[1]}`],
  [/^Loaded “([^”]+)”/, (m) => `Loaded · ${m[1]}`],
];

export function toastFact(text: string): string {
  let s = text.trim();
  for (const [re, f] of REWRITES) {
    const m = s.match(re);
    // a function, not a string: "Counter $1.21M" as a replacement string reads "$1" as group one
    if (m) { const out = f(m); s = s.replace(re, () => out); break; }
  }
  const parts = s.split(" · ").map((p) => p
    .split(/ — |\. |; /)[0]
    .replace(/^(The|Your|A|An) /, "")
    .replace(/[.!]$/, "")
    .trim()).filter(Boolean);
  return clipWords(parts.join(" · "), 8);
}

/** Cut to the first `max` words — used only on engine-written labels with no fact builder. */
export function clipWords(s: string, max: number): string {
  const parts = s.replace(/\s+/g, " ").trim().split(" ");
  return parts.length <= max ? s : parts.slice(0, max).join(" ").replace(/[,;:—–-]+$/, "") + "…";
}
