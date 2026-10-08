import { useEffect, useState } from "react";
import { DESKS } from "@/ui/desks";

/**
 * THE KEYS, WRITTEN DOWN. Space, Y, N, M, P and ⌘K all existed and nothing in
 * the game said so — a player found them by accident or not at all. "?" opens
 * this card from anywhere that is not a text box; any key or click closes it.
 */

const TIME: readonly [string, string][] = [
  ["Space", "Play / pause, a month a second"],
  ["G", "Play / pause — a month a second, pausing when something needs you"],
  ["Y", "Up to one year, stopping when a decision arrives"],
  ["N", "Skip to the next decision, up to three years"],
];
const VIEW: readonly [string, string][] = [
  ["⌘K / Ctrl K", "Search every building, desk and firm"],
  ["M", "Map only — hide the desks"],
  ["P", "Photo frame"],
  ["Esc", "Close the card, then the desk, then the selection"],
  ["Alt ←", "Back to where you were"],
  ["?", "This card"],
];

export default function Shortcuts() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      if (open) {
        // Any key closes it, and is swallowed so Space does not also advance.
        e.preventDefault();
        e.stopImmediatePropagation();
        setOpen(false);
        return;
      }
      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);
  if (!open) return null;
  const row = ([k, v]: readonly [string, string]) => (
    <div className="kbd-row" key={k}><kbd>{k}</kbd><span>{v}</span></div>
  );
  return (
    <div className="delivery-ceremony" role="dialog" aria-modal="true" aria-labelledby="kbd-title" onClick={() => setOpen(false)}>
      <div className="delivery-stamp kbd-card" onClick={(e) => e.stopPropagation()}>
        <div className="delivery-kicker">The keys</div>
        <div className="delivery-title" id="kbd-title">Work the desk without the mouse</div>
        <div className="kbd-grid">
          <div>
            <div className="kbd-head">Time</div>
            {TIME.map(row)}
            <div className="kbd-head">View</div>
            {VIEW.map(row)}
          </div>
          <div>
            <div className="kbd-head">Desks</div>
            {DESKS.map((d) => row([d.key, d.tabs.length > 1 ? `${d.label} — ${d.tabs.map((t) => t.label).join(", ")}` : d.label]))}
          </div>
        </div>
        <div className="hint" style={{ textAlign: "center", marginTop: 10 }}>Any key closes this.</div>
      </div>
    </div>
  );
}
