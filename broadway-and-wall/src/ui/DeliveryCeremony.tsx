import { useEffect } from "react";
import { useStore } from "@/state/store";
import { usd, sf } from "@/ui/format";

/**
 * Non-blocking delivery moment — fly to the building, stamp the deed toast.
 * Does not stop Advance; click dismisses.
 */
export default function DeliveryCeremony() {
  const ceremony = useStore((s) => s.deliveryCeremony);
  const dismiss = useStore((s) => s.dismissDeliveryCeremony);
  const focus = useStore((s) => s.focus);

  useEffect(() => {
    if (!ceremony) return;
    focus(ceremony.bbl, true);
    const t = setTimeout(() => dismiss(), 5200);
    return () => clearTimeout(t);
  }, [ceremony, focus, dismiss]);

  if (!ceremony) return null;

  return (
    <div
      className="delivery-ceremony"
      role="status"
      onClick={() => dismiss()}
    >
      <div className="delivery-stamp">
        <div className="delivery-kicker">{ceremony.rival ? "Delivered · the street" : "Delivered · your tower"}</div>
        <div className="delivery-title">{ceremony.address}</div>
        <div className="delivery-meta mono">
          {ceremony.use} · {sf(ceremony.sf)}
          {ceremony.value ? ` · ${usd(ceremony.value)}` : ""}
        </div>
        <div className="hint">Click to dismiss</div>
      </div>
    </div>
  );
}
