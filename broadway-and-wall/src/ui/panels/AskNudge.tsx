import { ASK_STEP, askStanceOfPct, askPctOfStance } from "@/engine/value";

/**
 * THE ASKING RENT, AS FAR OVER OR UNDER THE MARKET AS YOU LIKE. It was three
 * buttons — Fill −8%, Market, Push +8% — and an owner who wanted 3% over, or
 * 20% under to fill a building before a sale, could not say so. Each click
 * moves the ask a point or five either way; Market puts it back. The number
 * shown is the ask against the market rent for the space.
 */
const STEPS = [-5, -1, 1, 5] as const;
export function AskNudge({ stance, set, small, label }: { stance: number; set: (stance: number) => void; small?: boolean; label: string }) {
  const pct = askPctOfStance(stance);
  const btn = "btn" + (small ? " btn-sm" : "");
  const word = pct === 0 ? "Market" : `${pct > 0 ? "+" : "−"}${Math.abs(pct)}%`;
  return (
    <>
      <span className="seg" role="group" aria-label={label}>
        {STEPS.slice(0, 2).map((d) => (
          <button key={d} type="button" className={btn} title={`Ask ${-d}% less: more letters, a faster lease-up`}
            onClick={() => set(askStanceOfPct(pct + d))}>−{-d}%</button>
        ))}
        <button type="button" className={btn + (pct === 0 ? " btn-on" : "")} aria-pressed={pct === 0}
          title="Ask what the market is asking" onClick={() => set(0)}>Market</button>
        {STEPS.slice(2).map((d) => (
          <button key={d} type="button" className={btn} title={`Ask ${d}% more: fewer letters, a slower lease-up`}
            onClick={() => set(askStanceOfPct(pct + d))}>+{d}%</button>
        ))}
      </span>
      <span className={"ask-nudge-v" + (pct > 0 ? " pos" : pct < 0 ? " neg" : "")}
        title={`New leases are asked at ${word === "Market" ? "the market rent" : word + " against the market rent"} (the old Push and Fill were ${Math.round(ASK_STEP * 100)}% either way)`}>
        {word}
      </span>
    </>
  );
}
