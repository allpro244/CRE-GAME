// Ground-up development and adaptive reuse desks.
// The Build desk itself is ui/next/BuildDesk.tsx (five choices and a verdict);
// this file routes a lot to it (or to the land desk, or to adaptive reuse) and
// gives the map card its one-line answer. Every scheme is read by
// ui/next/scheme.ts deskScheme, so the card, the desk and the footer agree.
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/state/store";
import { useHeldGame } from "@/ui/heldGame";
import type { GameState } from "@/engine/types";
import type { ParcelTable } from "@/data/types";
import LandDesk from "@/ui/panels/LandDesk";
import { resolveRec, DEV_MARGIN } from "@/engine/value";
import { heldByRaises } from "@/engine/raise";
import { adaptiveReuseEligibility, planAdaptiveReuse, reuseZoneBar, devFundingNeed, groundbreakPurse } from "@/engine/dev";
import { usd, sf } from "@/ui/format";
import { useLabel, Row, LocSplitHint, Verdict } from "@/ui/panels/shared";
import { BuildDesk, schemeName } from "@/ui/next/BuildDesk";
import { deskScheme } from "@/ui/next/scheme";

// What a plan short of its hurdle is still worth over its cost. The required
// yield carries the merchant builder's margin, so value / basis is
// hurdle × (1 + DEV_MARGIN) — the same capitalisation the mark uses.
const shortNote = (h: number) => h * (1 + DEV_MARGIN) >= 1
  ? ` Finished, it would still be worth ${((h * (1 + DEV_MARGIN) - 1) * 100).toFixed(0)}% more than it cost — thinner than the ${(DEV_MARGIN * 100).toFixed(0)}% a merchant builder needs.`
  : " Finished, it would be worth less than it cost.";

export function ReuseSection({ bbl }: { bbl: string }) {
  const game = useHeldGame(bbl);
  const parcels = useStore((s) => s.parcels)!;
  const rec = resolveRec(parcels, game, bbl);
  const saved = game.holdings[bbl]?.devDraft?.reuseTarget;
  const [target, setTarget] = useState<"multifamily" | "mixed">(saved ?? "multifamily");
  const dirty = useRef(!!saved);
  useEffect(() => {
    if (!dirty.current) return;
    useStore.getState().setDevDraft(bbl, { reuseTarget: target });
  }, [bbl, target]);
  const pick = (v: "multifamily" | "mixed") => { dirty.current = true; setTarget(v); };
  if (!rec) return null;
  const eligibility = adaptiveReuseEligibility(game, parcels, bbl);
  const mixed = target === "mixed"
    ? { multifamily: 0.70, office: 0.20, retail: 0.10 }
    : undefined;
  const reuseBar = eligibility.ok ? reuseZoneBar(game, parcels, bbl, target, mixed) : null;
  const plan = eligibility.ok && !reuseBar ? planAdaptiveReuse(game, parcels, bbl, target, mixed) : null;
  const equity = (plan?.equity ?? 0) + (plan?.pointsCost ?? 0);
  // the engine's own test: equity, points and the change-order margin
  // ...from the purse that owns the deed, less cash held for other open raises.
  const reusePurse = groundbreakPurse(game, parcels, bbl);
  const reuseHave = reusePurse.closed ? 0 : Math.max(0, reusePurse.total - (reusePurse.fund ? 0 : heldByRaises(game, bbl)));
  const short = plan ? Math.max(0, devFundingNeed(plan).whole - reuseHave) : 0;
  return (
    <div className="deal">
      <div className="deal-head">Adaptive reuse</div>
      <div className="hint">
        Keep the shell and convert the interior. The old building comes out of its space market when work starts;
        the new housing arrives only at delivery. Opportunity cost includes the income building you give up.
      </div>
      <div className="btn-row">
        <button className={"btn" + (target === "multifamily" ? " btn-on" : "")}
          onClick={() => pick("multifamily")}>Apartments</button>
        <button className={"btn" + (target === "mixed" ? " btn-on" : "")}
          onClick={() => pick("mixed")}>Mixed · 70% housing</button>
      </div>
      {!eligibility.ok ? (
        <div className="hint alarm">{eligibility.why}</div>
      ) : reuseBar ? (
        <div className="hint alarm">{reuseBar} A conversion is a change of use, and the new use has to be one the district hosts.</div>
      ) : plan ? (
        <>
          <div className="grid">
            <Row k="Existing shell" v={`${sf(rec.bldgArea)} · ${rec.floors} floors · ${useLabel(rec)}`} />
            <Row k="After conversion" v={`${sf(plan.sf)} · ${target}`} strong />
            <Row k="Conversion budget" v={usd(plan.costTotal)} />
            <Row k="Opportunity cost in basis" v={usd(plan.landBasis)} />
            <Row k="Equity required" v={usd(equity)} strong bad={short > 0} title={plan ? `Plus a ${usd(devFundingNeed(plan).margin)} overrun cushion (6% of cost) you must be able to fund` : undefined} />
            <Row k="Delivery" v={`${plan.months} months`} />
            <Row k="Yield / hurdle" v={`${plan.yieldOnCost.toFixed(2)}% / ${plan.requiredYield.toFixed(2)}%`}
              strong bad={plan.hurdleRatio < 1} />
          </div>
          <LocSplitHint need={equity} game={game} parcels={parcels} />
          <button className="btn btn-buy"
            disabled={plan.hurdleRatio < 1 || short > 0}
            onClick={() => useStore.getState().convertUse(bbl, target, mixed)}>
            Convert to {target === "multifamily" ? "apartments" : "mixed use"} · {usd(equity)}
          </button>
        </>
      ) : (
        <div className="hint">This shell cannot carry the target programme.</div>
      )}
    </div>
  );
}

// FARMLAND HAS NO ENVELOPE. An agricultural tract (zone AG, FAR 0) is not a
// building site: the minimum-coverage floor used to draw a 447,000 sf plate on
// seventeen acres of corn. Its path is the Land development card — rezone, plat.
export function DevelopSection({ bbl }: { bbl: string }) {
  const game = useHeldGame(bbl);
  const parcels = useStore((s) => s.parcels)!;
  const rec = resolveRec(parcels, game, bbl) ?? parcels[bbl];
  // ...its desk is the land development desk: lay out the subdivision, entitle it, build its streets
  if (rec && rec.ag && rec.tract) return <LandDesk bbl={bbl} />;
  if (rec && (rec.ag || rec.zoneDist === "AG")) {
    return (
      <div className="deal">
        <div className="deal-head">Develop this lot</div>
        <div className="hint">Zoned AG · no building envelope. Rezone and plat it on the Overview tab (Land development).</div>
      </div>
    );
  }
  return <DevelopSectionLive bbl={bbl} />;
}

function DevelopSectionLive({ bbl }: { bbl: string }) {
  return <BuildDesk bbl={bbl} commit />;
}

/**
 * THE SCHEME ON THE DESK, read exactly as the desk reads it (deskScheme). The
 * map card and the building file's footer both ask this, so neither can offer
 * a different building from the one the desk is set to.
 */
export function heldScheme(game: GameState, parcels: ParcelTable, bbl: string) {
  return deskScheme(game, parcels, bbl);
}

/** THE BUILD DESK, FROM THE MAP CARD: the answer and a door. */
export function DevelopGlance({ bbl }: { bbl: string }) {
  const game = useHeldGame(bbl);
  const parcels = useStore((s) => s.parcels)!;
  const d = deskScheme(game, parcels, bbl);
  const plan = d.plan;
  const open = () => useStore.getState().openProperty(bbl, "build");
  const closeCheque = d.need.dayOne;
  return (
    <div className="deal">
      <div className="deal-head">
        Develop this lot
        {game.holdings[bbl]?.devDraft && <span className="dim"> · scheme held</span>}
      </div>
      {plan ? (
        <Verdict
          label={`Yield on cost · ${schemeName(d)} · ${sf(plan.sf)}`}
          value={`${plan.yieldOnCost.toFixed(2)}%`}
          tone={plan.hurdleRatio >= 1.08 ? "good" : plan.hurdleRatio >= 1 ? "warn" : "bad"}
          note={plan.hurdleRatio >= 1
            ? `Pencils against ${plan.requiredYield.toFixed(2)}% required. ${usd(closeCheque)} at groundbreak, ${usd(plan.equity + plan.pointsCost + d.siteDebt)} all in, ${plan.months} months.`
            : `Does not pencil — ${plan.requiredYield.toFixed(2)}% is required on cost.${shortNote(plan.hurdleRatio)}`}
        />
      ) : (
        <div className="hint">{d.bar ?? `No scheme prices on this lot — ${sf(d.rec.lotArea)} of land.`}</div>
      )}
      <div className="btn-row">
        <button className="btn btn-sm" onClick={open}>Open the Build desk →</button>
      </div>
    </div>
  );
}
