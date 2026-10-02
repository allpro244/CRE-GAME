import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/state/store";
import { cycleDigest } from "@/engine/cycleDigest";

const LS_KEY = "bw-digest-collapsed";

const CLS_LABEL: Record<string, string> = {
  office: "Office", retail: "Retail", multifamily: "Multifamily", industrial: "Industrial", mixed: "Mixed-use",
};
/** A real minus, and a plus, on a change. */
const signed = (n: number) => (n > 0 ? "+" : n < 0 ? "\u2212" : "") + Math.abs(n);

/**
 * Collapsible monthly cycle readout — phase, rates, caps, balloons.
 * Veterans can leave it collapsed; it remembers across sessions.
 */
export default function CycleDigest() {
  const game = useStore((s) => s.game);
  const prevEcon = useStore((s) => s.prevForDigest);
  // FOLDED UNTIL ASKED. The phase and the rate are on the top bar now, so the
  // folded line is enough at a glance; the class table is one click away and
  // the fold is remembered either way.
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(LS_KEY) !== "0"; } catch { return true; }
  });

  const dig = useMemo(() => {
    if (!game || game.gameOver) return null;
    return cycleDigest(game, prevEcon);
  }, [game, prevEcon]);

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, collapsed ? "1" : "0"); } catch { /* */ }
  }, [collapsed]);

  if (!dig) return null;

  const rateBit = dig.dRateBp === null ? ""
    : dig.dRateBp === 0 ? " · flat"
    : dig.dRateBp > 0 ? ` · +${dig.dRateBp} bp`
    : ` · ${dig.dRateBp} bp`;

  return (
    <div className={"cycle-digest" + (collapsed ? " cycle-digest-collapsed" : "")}>
      <button
        type="button"
        className="cycle-digest-head"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
      >
        <span className="map-hud-kicker">Cycle · {dig.label}</span>
        <span className="cycle-digest-summary">
          {dig.phase}{dig.rumored ? ` ⚠→ ${dig.rumored}` : ""} · {dig.ratePct.toFixed(2)}%{rateBit}
        </span>
        <span className="cycle-digest-chev">{collapsed ? "▸" : "▾"}</span>
      </button>
      {!collapsed && (
        <div className="cycle-digest-body">
          {/* A four-row table, not two run-on lines of "off 7.74% (-102bp) · ret
              7.04%…" — class names spelled out, one column per measure. */}
          <table className="cycle-digest-table">
            <thead>
              <tr><th /><th>Cap rate</th><th>Vacancy</th></tr>
            </thead>
            <tbody>
              {dig.caps.map((c) => {
                const v = dig.vac.find((x) => x.cls === c.cls);
                return (
                  <tr key={c.cls}>
                    <td>{CLS_LABEL[c.cls] ?? c.cls}</td>
                    <td className="mono">
                      {c.pct.toFixed(2)}%
                      {c.dBp ? <span className={"cycle-d" + (c.dBp > 0 ? " up" : " down")}> {signed(c.dBp)} bp</span> : null}
                    </td>
                    <td className="mono">
                      {v ? `${v.pct.toFixed(1)}%` : "—"}
                      {v && v.dPp != null && v.dPp !== 0 ? <span className={"cycle-d" + (v.dPp > 0 ? " up" : " down")}> {signed(v.dPp)} pp</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="hint">
            Your book · {dig.balloons12} balloon{dig.balloons12 === 1 ? "" : "s"} in 12 mo
            {dig.floatingShare > 0 ? ` · ${(dig.floatingShare * 100).toFixed(0)}% floating` : ""}
            {" · "}{dig.underConstruction} crane{dig.underConstruction === 1 ? "" : "s"} citywide
            {game ? ` · ${Math.max(0, game.totalLots - game.builtAtStart - Object.keys(game.built).length)} vacant lots` : ""}
          </div>
        </div>
      )}
    </div>
  );
}
