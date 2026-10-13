import { useStore } from "@/state/store";
import { firmCapital, firmMilestonesHit, nextFirmMilestone } from "@/engine/firmCapital";

/**
 * The firm's standing — institutional record, not XP. Pillars are quantities
 * already earned (lender file, clean exits, vehicle, book). A readout only:
 * nothing in the economy reads it.
 */
export default function FirmStanding() {
  const game = useStore((s) => s.game);
  if (!game) return null;
  const fc = firmCapital(game);
  const hit = firmMilestonesHit(game);
  const next = nextFirmMilestone(game);
  const pct = Math.round(fc.score * 100);
  return (
    <div className="page-section">
      <div className="page-section-head">
        Standing · {fc.label}
        <span className="dim mono" style={{ marginLeft: 8 }}>tier {fc.tier}/5 · {pct}%</span>
      </div>
      <div className="hint">
        What the firm has earned as an institution: lender file, clean exits, vehicle, and book size.
      </div>
      <div className="grid" style={{ margin: "8px 0" }}>
        {fc.pillars.map((p) => (
          <div key={p.id} style={{ display: "contents" }}>
            <div className="k">{p.label}</div>
            {/* left-aligned so the bars line up in one column instead of
                starting wherever each sentence's length pushed them */}
            <div className="v mono" title={p.detail} style={{ textAlign: "left" }}>
              <span style={{
                display: "inline-block", width: 100, height: 6,
                background: "rgba(43,37,26,0.12)", borderRadius: 2, verticalAlign: "middle",
                marginRight: 8,
              }}>
                <span style={{
                  display: "block", height: "100%", width: `${Math.round(p.score * 100)}%`,
                  background: "rgba(43,37,26,0.55)", borderRadius: 2,
                }} />
              </span>
              {p.detail}
            </div>
          </div>
        ))}
      </div>
      <div className="hint">
        Milestones {fc.milestonesHit}/{fc.milestonesTotal}
        {hit.length > 0 ? ` · last: ${hit[hit.length - 1]!.label}` : ""}
        {next ? ` · next open: ${next.label}` : " · every chapter marked"}
      </div>
    </div>
  );
}
