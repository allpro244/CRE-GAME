import { useState } from "react";
import { useStore } from "@/state/store";
import { OPS_SERVICE, OPS_PLAN } from "@/engine/types";
import { resolveRec } from "@/engine/value";
import { isCommercial } from "@/engine/leasing";
import { AskNudge } from "./AskNudge";

/**
 * THE HOUSE POLICY, AS A BLOCK OF CONTROLS. Labels and choices only; what each
 * one does is on the hover of its label (owner's UI rule: explanations on
 * hover). Set once, it applies to every deed you close from here on and to the
 * book you already own; a building set apart on its own card keeps its
 * override.
 */
export function HousePolicy() {
  const game = useStore((s) => s.game)!;
  const { opsPolicy } = useStore.getState();
  const cur = game.opsPolicy ?? { service: 0 as const, plan: 1 as const, stance: 0 as const };
  const [svc, setSvc] = useState<-1 | 0 | 1>(cur.service);
  const [pln, setPln] = useState<0 | 1 | 2>(cur.plan);
  const [stn, setStn] = useState<number>(cur.stance ?? 0);
  // resolveRec — delivered stock lives on game.built; parcels[].class stays
  // "land" for lots you developed, which made this card undercount the book
  // and disable whole-book exclusives on a developer portfolio.
  const parcels = useStore.getState().parcels;
  const built = Object.values(game.holdings).filter((h) => {
    if (h.groundLeased || game.merged?.[h.bbl]) return false;
    const rec = parcels ? resolveRec(parcels, game, h.bbl) : null;
    return rec && rec.class !== "land" && (rec.bldgArea ?? 0) > 0;
  });
  const off = built.filter((h) => (h.stance ?? 0) !== stn || (h.service ?? 0) !== svc || (h.plan ?? 1) !== pln).length;
  const commercial = built.filter((h) => {
    const rec = parcels ? resolveRec(parcels, game, h.bbl) : null;
    return rec && isCommercial(rec);
  });
  const commercialN = commercial.length;
  const onHouse = commercial.filter((h) => h.broker).length;
  const dirty = svc !== cur.service || pln !== cur.plan || stn !== (cur.stance ?? 0);
  const Seg = <T extends number>(
    { label, value, set, opts, hint }:
    { label: string; value: T; set: (v: T) => void; opts: { k: T; label: string; title: string }[]; hint: string },
  ) => (
    <div className="ops-choice">
      <span className="ops-choice-k has-gloss" title={hint}>{label}</span>
      <span className="seg" role="group" aria-label={label}>
        {opts.map((o) => (
          <button key={String(o.k)} type="button" className={"btn btn-sm" + (value === o.k ? " btn-on" : "")}
            aria-pressed={value === o.k} title={o.title} onClick={() => set(o.k)}>{o.label}</button>
        ))}
      </span>
    </div>
  );
  return (
    <div className="page-section">
      <div className="page-section-head"
        title="Set it once. It applies to every deed you close from here on, and to the book you already own. A building that needs different treatment is still set on its own card, and that override stands.">
        House policy · {built.length} propert{built.length === 1 ? "y" : "ies"}
      </div>
      <div className="ops-choice">
        <span className="ops-choice-k has-gloss"
          title="The ask on new leases, against the market rent, as far over or under as you like. The traffic moves against you harder than the rent moves for you — that is the trade, and it is why pushing rents into a soft market empties a building.">Asking rents</span>
        <AskNudge small label="Asking rents" stance={stn} set={setStn} />
      </div>
      <Seg label="Service" value={svc} set={setSvc}
        opts={OPS_SERVICE.map((o) => ({ k: o.key, label: o.label, title: o.blurb }))}
        hint="Free to change and slow to matter: the saving lands next month and the tenants have not noticed for three years — which is exactly why cutting it is a trap rather than a lever." />
      <Seg label="Capital plan" value={pln} set={setPln}
        opts={OPS_PLAN.map((o) => ({ k: o.key, label: o.label, title: o.blurb }))}
        hint="Deferring is free today and ruinous over a twenty-year hold. It is sometimes right — for a flip, or for a building you are emptying to knock down." />
      <div className="ops-choice">
        <span className="ops-choice-k" />
        <button className="btn btn-sm btn-buy" disabled={!dirty && off === 0}
          title={off === 0
            ? "Every building on the book is running this policy."
            : `${off} of ${built.length} ${off === 1 ? "building is" : "buildings are"} running something else — either an override you set deliberately, or a policy you changed after you bought them.`}
          onClick={() => opsPolicy({ service: svc, plan: pln, stance: stn })}>
          {off > 0 ? `Apply to all ${built.length} · ${off} differ` : "✓ All buildings"}
        </button>
      </div>
      {/* WHO WORKS THE PHONES, ALSO ONCE. An exclusive is a standing decision
          about how the book is run. Flats are skipped rather than refused —
          the engine already says a broker does not work multifamily. */}
      <div className="ops-choice">
        <span className="ops-choice-k has-gloss"
          title="No retainer and nothing while the space sits — they work the phones and are paid 6% of the base rent over the term of everything signed while they hold the file, against the 4% on a new lease and 2% on a renewal your own people cost. They do not negotiate or sign. Cheap to hold, expensive when it works, and the right answer changes with how much of the book is empty.">
          Exclusives
        </span>
        <span className="ops-choice-read mono">{onHouse} / {commercialN}</span>
        <span className="seg">
          <button className="btn btn-sm" disabled={commercialN === 0 || onHouse === commercialN}
            title="Put a listing exclusive on every commercial building"
            onClick={() => useStore.getState().brokerAll(true)}>All</button>
          <button className="btn btn-sm" disabled={onHouse === 0}
            title="End every listing exclusive"
            onClick={() => useStore.getState().brokerAll(false)}>None</button>
        </span>
      </div>
    </div>
  );
}
