import { useMemo, useState } from "react";
import { useStore } from "@/state/store";
import { attentionItems } from "@/engine/sim";

/**
 * AT RISK. A lender filing on a building, a missed payment, a balloon with no
 * takeout, the facility called, the account under water — each of these was a
 * line in the same lane, in the same type, as a broker's call or a quiet
 * letter, and a player lost buildings to notices they had learned to click
 * past. This banner is the one red thing on the screen: it sits above the
 * toast lane for as long as the condition holds, names the building and the
 * countdown (the engine's own label, verbatim), and opens the file on click.
 * It does not stop anything by itself; the critical items stop the clock in
 * every mode (stopRule).
 */
export default function AtRiskBanner() {
  const game = useStore((s) => s.game);
  const parcels = useStore((s) => s.parcels);
  const openAttention = useStore((s) => s.openAttention);
  const [folded, setFolded] = useState(false);
  const items = useMemo(
    () => (game && parcels && !game.spectator && !game.gameOver
      ? attentionItems(game, parcels).filter((a) => a.critical)
      : []),
    [game, parcels],
  );
  if (!items.length) return null;
  const SHOW = 3;
  return (
    <div className="at-risk" role="alert" aria-live="assertive">
      <div className="at-risk-head">
        <span className="at-risk-mark" aria-hidden="true">⚠</span>
        <span>AT RISK — {items.length === 1 ? "one thing you own" : `${items.length} things you own`}</span>
        <button type="button" className="at-risk-fold" onClick={() => setFolded(!folded)}
          aria-expanded={!folded} title={folded ? "Show" : "Fold"}>{folded ? "▾" : "▴"}</button>
      </div>
      {!folded && items.slice(0, SHOW).map((a) => (
        <button type="button" key={a.key} className="at-risk-row" onClick={() => openAttention(a.key)} title="Open the file">
          {a.label} <span className="at-risk-go" aria-hidden="true">Open →</span>
        </button>
      ))}
      {!folded && items.length > SHOW && <div className="at-risk-more">+{items.length - SHOW} more on the docket</div>}
    </div>
  );
}
