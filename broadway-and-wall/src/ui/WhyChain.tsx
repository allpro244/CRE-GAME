// "WHY?" ON ANY LINE THAT HAS A CAUSE (ONE_ECONOMY_PLAN §6e). The chain is
// read from the engine's cause ledger (engine/why.ts): what happened, then
// what caused it, back up to five steps. Numbers first, each step a link to
// the place it happened when there is one.
import { useState } from "react";
import { useStore } from "@/state/store";
import { whyChain } from "@/engine/why";
import { monthLabel } from "@/engine/types";
import "./why.css";

/**
 * `lead` is a first line the screen works out itself — how its own number is
 * made from the market's ("value $4.1M = NOI $270k at a 6.6% cap") — over the
 * chain of the market number it rests on.
 */
export function WhyButton({ id, lead }: { id?: number; lead?: string }) {
  const [open, setOpen] = useState(false);
  const game = useStore((s) => s.game);
  if (!id || !game?.why) return null;
  const chain = whyChain(game, id, lead ? 4 : 5);
  if (chain.length < (lead ? 1 : 2)) return null;
  return (
    <span className="why" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="why-btn" aria-expanded={open} onClick={() => setOpen(!open)}>Why?</button>
      {open && (
        <ol className="why-chain">
          {lead && <li className="why-step"><span className="why-text">{lead}</span></li>}
          {chain.map((e, i) => (
            <li key={e.id} className={"why-step" + (e.bbl ? " news-clickable" : "")}
              onClick={e.bbl ? () => useStore.getState().focus(e.bbl!, true) : undefined}>
              {(i > 0 || !!lead) && <span className="why-arrow">←</span>}
              <span className="why-text">{e.t}</span>
              {e.m !== game.month && <span className="why-when"> · {monthLabel(e.m)}</span>}
            </li>
          ))}
        </ol>
      )}
    </span>
  );
}
