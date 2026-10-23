import { usd } from "@/ui/format";
import { Row } from "@/ui/panels/shared";

/** Second beat before closing — irreversible, so ask once more in-game. */
export function SaleAcceptConfirm({
  address,
  price,
  net,
  exchange,
  contract,
  onConfirm,
  onCancel,
}: {
  address: string;
  price: number;
  net: number;
  exchange?: boolean;
  /** Taking a bid off a list signs a contract; the buyer can still retrade before it closes (actions.ts acceptBid). */
  contract?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="modal-backdrop modal-layer-decision">
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-kicker">Are you sure?</div>
        <div className="modal-title">{contract ? `Sign a contract at ${usd(price)}` : `Close at ${usd(price)}`}</div>
        <div className="modal-sub">
          {contract
            ? <>{address} — the deed goes under contract and closes after the buyer&rsquo;s diligence. A buyer the street does not trust may come back with a lower number before it does.</>
            : <>{address} — this cannot be undone once you confirm.</>}
        </div>
        <div className="grid">
          <Row k="Sale price" v={usd(price)} strong />
          <Row k={contract ? "Net to you if it closes at this price" : "Net to you"} v={usd(net)} strong bad={net < 0} />
        </div>
        <div className="modal-actions">
          <button className="btn btn-buy" onClick={onConfirm}>
            {contract ? "Yes — sign the contract" : exchange ? "Yes — close into a 1031" : "Yes — close the sale"}
          </button>
          <button className="btn" data-esc onClick={onCancel}>Not yet</button>
        </div>
      </div>
    </div>
  );
}
