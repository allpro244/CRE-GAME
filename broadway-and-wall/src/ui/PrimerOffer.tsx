import { useEffect, useState } from "react";
import { useStore } from "@/state/store";

const LS = "bw-primer-offered";

function rememberOffered() {
  try { localStorage.setItem(LS, "1"); } catch { /* */ }
}

/**
 * Optional first-run literacy prompt — never blocks play.
 *
 * This used `.modal-backdrop`, so RightPanel treated it as a desk card and
 * swallowed Space / Y / N ("answer the card before advancing"). A veteran
 * who already knows NOI then could not start the clock without clicking
 * through a literacy quiz. A corner card is the offer; Advance still works.
 */
export default function PrimerOffer() {
  const phase = useStore((s) => s.phase);
  const month = useStore((s) => s.game?.month ?? 0);
  const setPage = useStore((s) => s.setPage);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (phase !== "playing" || month > 0) return;
    try {
      if (localStorage.getItem(LS) === "1") return;
    } catch { /* */ }
    setShow(true);
  }, [phase, month]);

  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      rememberOffered();
      setShow(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show]);

  if (!show) return null;

  const dismiss = (openPrimer: boolean) => {
    rememberOffered();
    setShow(false);
    if (openPrimer) setPage("primer");
  };

  return (
    <div className="primer-offer" role="dialog" aria-modal="false">
      <div className="primer-offer-title">New to the business?</div>
      <div className="hint" style={{ margin: "6px 0 10px" }}>
        Two minutes on NOI, cap rates and appraisals, using today&rsquo;s numbers.
        Skip it — nothing is simplified either way.
      </div>
      <div className="btn-row" style={{ margin: 0 }}>
        <button type="button" className="btn btn-buy" onClick={() => dismiss(true)}>
          Open the Primer
        </button>
        <button type="button" className="btn" onClick={() => dismiss(false)}>
          I know this
        </button>
      </div>
    </div>
  );
}
