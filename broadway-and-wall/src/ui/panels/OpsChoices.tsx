import { useStore } from "@/state/store";
import { OPS_SERVICE, OPS_PLAN, SVC_START } from "@/engine/types";
import type { Holding } from "@/engine/types";

/**
 * HOW THE BUILDING IS RUN — the two settings that take years to show, each on
 * its own line: the name, the three choices as one control, and what it reads
 * as today. One component for the property file and the Portfolio row, so
 * the two cannot drift apart again (the row put all six buttons on one line
 * with a "|" between them).
 */
export function OpsChoices({ bbl, h }: { bbl: string; h: Holding }) {
  const ops = useStore((s) => s.ops);
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
              title={o.blurb + " — three years to matter, three years to undo"}
              onClick={() => ops(bbl, { service: o.key })}
            >{o.label}</button>
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
              title={o.blurb}
              onClick={() => ops(bbl, { plan: o.key })}
            >{o.label}</button>
          ))}
        </span>
        <span className="ops-choice-read">condition {Math.round(100 * (h.condIdx ?? 0.6))} of 100{h.condition ? ` (${h.condition})` : ""}</span>
      </div>
    </>
  );
}
