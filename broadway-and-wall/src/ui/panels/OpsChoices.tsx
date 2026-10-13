import { useStore } from "@/state/store";
import { OPS_SERVICE, OPS_PLAN, SVC_START } from "@/engine/types";
import type { Holding } from "@/engine/types";
import { buildingScore, buildTier, resolveRec, holdingNOIYr, ownedHoldingValue, condWear, capPlanBillMo } from "@/engine/value";
import { usd } from "@/ui/format";

/** "+$12K/yr" dearer, "−$9K/yr" cheaper — against what the building runs on now. */
function Delta({ d, on }: { d: number; on: boolean }) {
  if (on) return <span className="ops-delta">now</span>;
  if (Math.round(d) === 0) return <span className="ops-delta">same</span>;
  return <span className={"ops-delta " + (d > 0 ? "neg" : "pos")}>{d > 0 ? "+" : "−"}{usd(Math.abs(d))}/yr</span>;
}

/**
 * HOW THE BUILDING IS RUN — the two settings that take years to show, each on
 * its own line: the name, the three choices as one control, and what it reads
 * as today. One component for the property file and the Portfolio row, so
 * the two cannot drift apart again (the row put all six buttons on one line
 * with a "|" between them).
 */
export function OpsChoices({ bbl, h }: { bbl: string; h: Holding }) {
  const ops = useStore((s) => s.ops);
  const parcels = useStore((s) => s.parcels);
  const game = useStore((s) => s.game);
  // THE BUILDING SCORE (BUILD_CLASS_PLAN.md): the building only — location
  // is priced on its own. The letter is a reading of the number.
  const rec = parcels && game ? resolveRec(parcels, game, bbl) : null;
  const sc = rec && rec.bldgArea && game ? buildingScore(rec, h, game) : null;
  // WHAT EACH CHOICE COSTS, against the one in force. Service is read off
  // the engine's own NOI (holdingNOIYr) with only the setting swapped, so
  // tenant recoveries are netted exactly as the statement nets them: the
  // first-year cash difference, before tenants notice (that takes ~3 years).
  // The capital plan is the bill the monthly tick writes (capPlanBillMo) at
  // this building's value and wear.
  const live = !!(rec && rec.class !== "land" && rec.bldgArea > 0 && game && parcels);
  const noiAt = (service: -1 | 0 | 1) => live ? holdingNOIYr(rec!, game!.econ, { ...h, service }, game!.month) : 0;
  const noiNow = live ? noiAt(h.service ?? 0) : 0;
  const gav = live ? ownedHoldingValue(game!, parcels!, h) : 0;
  const wear = live ? condWear(rec!, game!.month) : 0;
  const planYr = (mult: number) => capPlanBillMo(gav, wear, mult) * 12;
  const planNow = planYr(OPS_PLAN[h.plan ?? 1].mult);
  return (
    <>
      <div className="ops-choice">
        <span className="ops-choice-k">Service</span>
        <span className="seg" role="group" aria-label="Service level">
          {OPS_SERVICE.map((o) => (
            <button
              key={o.key}
              type="button"
              className={"btn btn-sm" + ((h.service ?? 0) === o.key ? " btn-on" : "")}
              aria-pressed={(h.service ?? 0) === o.key}
              title={o.blurb + " — three years to matter, three years to undo"
                + (live ? `. Net operating cost ${usd(noiNow - noiAt(o.key))}/yr against today's setting, after tenant recoveries.` : "")}
              onClick={() => ops(bbl, { service: o.key })}
            >{o.label}{live && <Delta d={noiNow - noiAt(o.key)} on={(h.service ?? 0) === o.key} />}</button>
          ))}
        </span>
        <span className="ops-choice-read">tenants read it as {Math.round(100 * (h.svcIdx ?? SVC_START))} of 100</span>
      </div>
      <div className="ops-choice">
        <span className="ops-choice-k">Capital plan</span>
        <span className="seg" role="group" aria-label="Capital plan">
          {OPS_PLAN.map((o) => (
            <button
              key={o.key}
              type="button"
              className={"btn btn-sm" + ((h.plan ?? 1) === o.key ? " btn-on" : "")}
              aria-pressed={(h.plan ?? 1) === o.key}
              title={o.blurb + (live ? `. About ${usd(planYr(o.mult))}/yr into the reserve at this building's value and wear.` : "")}
              onClick={() => ops(bbl, { plan: o.key })}
            >{o.label}{live && <Delta d={planYr(o.mult) - planNow} on={(h.plan ?? 1) === o.key} />}</button>
          ))}
        </span>
        <span className="ops-choice-read">condition {Math.round(100 * (h.condIdx ?? 0.6))} of 100{h.condition ? ` (${h.condition})` : ""}{live && planNow > 0 ? ` · ${usd(planNow)}/yr` : ""}</span>
      </div>
      {sc && rec && (
        <div className="ops-choice">
          <span className="ops-choice-k">Building score</span>
          <span className="ops-choice-read" title="The building only: its bones, its condition, and how new it is against the city's own stock. Location is priced separately.">
            {sc.score} · {sc.grade === "Trophy" ? "Trophy" : `Class ${sc.grade}`} — {buildTier(rec.buildSpec).label} bones {sc.structure}/40 · condition {sc.condition}/35 · against the city's stock {sc.competitiveness}/25
          </span>
        </div>
      )}
    </>
  );
}
