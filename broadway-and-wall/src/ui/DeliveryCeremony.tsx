import { useStore } from "@/state/store";
import { usd, sf } from "@/ui/format";

/**
 * Non-blocking delivery moment — offers to fly to the building on the map.
 * Does not stop Advance; dismiss if you are not interested.
 * Every one of your own deliveries queues this; a rival's only when it is in
 * the top 1% of the city by floor area (see deliveryNotice).
 */
export default function DeliveryCeremony() {
  const ceremony = useStore((s) => s.deliveryCeremony);
  const popupsOff = useStore((s) => s.popupsOff);
  const dismiss = useStore((s) => s.dismissDeliveryCeremony);
  const focus = useStore((s) => s.focus);

  if (!ceremony || popupsOff) return null;

  const viewBuilding = () => {
    focus(ceremony.bbl, true);
    dismiss();
  };

  return (
    <div
      className="delivery-ceremony"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delivery-title"
      onClick={() => dismiss()}
    >
      <div className="delivery-stamp" onClick={(e) => e.stopPropagation()}>
        <div className="delivery-kicker">
          {ceremony.rival ? "Delivered · the street" : "Delivered · your tower"}
        </div>
        <div className="delivery-title" id="delivery-title">{ceremony.address}</div>
        <div className="delivery-meta mono">
          {ceremony.use} · {sf(ceremony.sf)}
        </div>
        {/* YOUR OWN DELIVERY, TOLD AS A RESULT. The value is the Portfolio's
            mark, the basis is the all-in the holding now carries — land plus
            the job — and the pace is the leasing desk's. Nothing new. */}
        {!ceremony.rival && ceremony.value !== undefined && ceremony.basis !== undefined && (
          <div className="year-review-grid mono" style={{ marginTop: 12 }}>
            <span>All in</span><span>{usd(ceremony.basis)}</span>
            <span>Worth today</span><span>{usd(ceremony.value)}</span>
            <span>{ceremony.value >= ceremony.basis ? "Value created" : "Under water by"}</span>
            <span className={ceremony.value >= ceremony.basis ? "pos" : "neg"}>
              <strong>{usd(Math.abs(ceremony.value - ceremony.basis))}</strong>
              {ceremony.basis > 0 ? ` · ${(ceremony.value / ceremony.basis).toFixed(2)}× cost` : ""}
            </span>
            {ceremony.letPct !== undefined && (<><span>Let at opening</span><span>{Math.round(ceremony.letPct * 100)}%</span></>)}
            {ceremony.monthsToLet !== undefined && (ceremony.letPct ?? 0) < 0.85 && (
              <><span>To 85% let</span><span>{ceremony.monthsToLet === null ? "not at today's pace" : `~${Math.max(1, Math.round(ceremony.monthsToLet))} mo at today's pace`}</span></>
            )}
          </div>
        )}
        <div className="btn-row" style={{ marginTop: 14, justifyContent: "center", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary" onClick={viewBuilding}>
            View building
          </button>
          {!ceremony.rival && (
            <button type="button" className="btn" onClick={() => { useStore.getState().openProperty(ceremony.bbl, "leasing"); dismiss(); }}>
              Lease it up
            </button>
          )}
          <button type="button" className="btn" onClick={() => dismiss()}>
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
