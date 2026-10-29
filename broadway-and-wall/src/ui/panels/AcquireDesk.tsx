import { FirmLink } from "@/ui/FirmLink";
// Buy, sell, list, ground lease, disclosed roll, vacant possession.
// Extracted from ParcelDesk so the property shell stays readable.
import { consentFor } from "@/engine/vehicles";
import { useState } from "react";
import Slider, { widePriceBounds, counterPriceBounds } from "@/ui/Slider";
import { useStore } from "@/state/store";
import { useHeldGame } from "@/ui/heldGame";
import { monthLabel, CREDIT_LABEL } from "@/engine/types";
import type { Approach, BuiltClass, GroundReview, SaleInstructions } from "@/engine/types";
import {
  assetValue, marketAppraisal, initialCondition, holdingNOIYr, resolveRec, useRentPsfYr, operatingStatement,
  recoveryOf, inPlace, proFormaNOIYr, disclosureFor, asIfOwned, isLeasedFee, ownedContractNoiYr, useRentableSf } from "@/engine/value";
import { demolitionCost } from "@/engine/dev";
import {
  buyQuote, quietFeeRate, saleFeeRate, sellerCashAtClose, saleProceedsToSeller, groundLeaseQuote,
  GROUND_REVIEW_LABEL, GROUND_TERM_MIN, GROUND_TOWER_TERM_MIN,
} from "@/engine/actions";
import { sellerOf, sellerProfile, closingBand, phaseShift, MAX_TALKS, DEPOSIT_PCT } from "@/engine/acquire";
import { ownerAt } from "@/engine/ownership";
import { unitStatus, buyoutQuote, BUYOUT_PREMIUM } from "@/engine/leasing";
import { PRODUCTS, deskAdvice } from "@/engine/debt";
import { stayingPower, lenderByName } from "@/engine/lenders";
import { WhyButton } from "@/ui/WhyChain";
import { loanWhy, loanLead } from "@/ui/whyLinks";
import { coldOnDeed, coldRefuseMsg } from "@/engine/owners";
import { uses as usesOf, useSf } from "@/engine/mix";
import { gradeOf } from "@/engine/rivals";
import { spendable } from "@/engine/credit";
import { Gloss } from "@/ui/Glossary";
import { leasingOdds } from "@/engine/absorption";
import { usd, sf, termLeft, pctSigned } from "@/ui/format";
import { SaleAcceptConfirm } from "@/ui/panels/SaleConfirm";
import { useLabel, physicalOcc, band, apMid, annualPayment, Row, LocSplitHint, Verdict } from "@/ui/panels/shared";
import { BizLink } from "@/ui/BizSheet";

/**
 * EMPTYING A BUILDING. Lifted out of the leasing desk so the three moves sit
 * together and in the order you make them: stop signing, pay the sitting
 * tenants to go, take it down. The wrecker's number is on the same row as the
 * tenants' number because the sum of the two is the real cost of the dirt —
 * which is exactly why the site under a well-let building is worth less than
 * the site under a half-empty one.
 */
export function VacantPossession({ bbl, onRaze }: { bbl: string; onRaze: () => void }) {
  const game = useHeldGame(bbl);
  const parcels = useStore((s) => s.parcels)!;
  const h = game.holdings[bbl];
  const rec = h ? resolveRec(parcels, game, bbl) : null;
  if (!h || !rec) return null;

  const bq = buyoutQuote(game, bbl);
  const occupied = (bq?.tenants ?? 0) > 0 || (h.occ ?? 0) > 0.02;
  const resSf = useSf(rec as never, "multifamily") * (h.occ ?? 0);
  const resCost = Math.round(resSf * useRentPsfYr(rec, game.econ, h.condition, "multifamily", h.condIdx) * BUYOUT_PREMIUM);
  const clearCost = (bq?.cost ?? 0) + resCost;
  const demoCost = demolitionCost(rec, game);
  // The engine's own bar for a wrecking permit. Named on the button rather
  // than discovered by clicking it — see raze in actions.ts.
  const occNow = physicalOcc(rec as never, h);
  const canRaze = occNow < 0.20;
  // the engine pays both from cash and then the line (buyOutTenants, demolish)
  const purse = spendable(game, parcels).total;

  return (
    <div className="deal">
      <div className="deal-head">Vacate</div>
      <div className="grid">
        <Row k="Leasing" v={h.leasingHold ? "STOPPED · no new leases or renewals" : "Open"} bad={h.leasingHold} />
        <Row k="Occupied" v={(occNow * 100).toFixed(0) + "%"} />
        {occupied && <Row k="In place" v={`${bq?.tenants ?? 0} lease${(bq?.tenants ?? 0) === 1 ? "" : "s"}${resSf > 900 ? ` · ${sf(Math.round(resSf))} leased apartments` : ""}`} />}
        {occupied && h.tenants.length > 0 && (
          <Row k="Last lease expiry" v={monthLabel(Math.max(...h.tenants.map((t) => t.endM)))} />
        )}
        {occupied && <Row k="Lease buyout cost" v={usd(clearCost)} strong />}
        <Row k="Demolition" v={usd(demoCost)} />
        {occupied && <Row k="Total to vacant land" v={usd(clearCost + demoCost)} strong bad={clearCost + demoCost > purse} />}
      </div>
      <div className="btn-row">
        <button className={"btn" + (h.leasingHold ? " btn-on" : "")}
          onClick={() => useStore.getState().holdLeasing(bbl, !h.leasingHold)}
          title={h.leasingHold
            ? "Resume new leases and renewals next month"
            : "No new leases or renewals; roll expires."}>
          {h.leasingHold ? "Resume leasing" : "Stop leasing"}
        </button>
        {occupied && clearCost > 0 && (
          <button className="btn btn-sell" disabled={clearCost > purse}
            onClick={() => useStore.getState().buyOutLeases(bbl)}
            title={`Remaining rent on all leases + ${((BUYOUT_PREMIUM - 1) * 100).toFixed(0)}% premium`}>
            Buy out all leases · {usd(clearCost)}
          </button>
        )}
        <button
          className="btn btn-sell"
          disabled={!canRaze}
          title={canRaze
            ? "Clear to vacant land."
            : `${(occNow * 100).toFixed(0)}% occupied; must be under 20% to demolish.`}
          onClick={onRaze}
        >
          Demolish · {usd(demoCost)}
        </button>
      </div>
      {occupied && bq && bq.rows.length > 0 && (
        <table className="tbl">
          <thead><tr><th>Tenant</th><th className="num">Left</th><th className="num">Rent / yr</th><th className="num">Buyout</th></tr></thead>
          <tbody>
            {bq.rows.slice(0, 8).map((r, i) => (
              <tr key={i} style={{ cursor: "default" }}>
                <td>{r.name}</td>
                <td className="num">{(r.monthsLeft / 12).toFixed(1)} yrs</td>
                <td className="num">{usd(r.annual)}</td>
                <td className="num">{usd(r.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {clearCost > purse && occupied && (
        <div className="hint">Short {usd(clearCost - purse)} (cash + line).</div>
      )}
    </div>
  );
}

/**
 * THE RENT ROLL, BEFORE YOU BID.
 *
 * "There will be no hidden or guessing work in the noi or occupancy when
 * buying a property. You need to know exactly what you are buying." The engine
 * prices the disclosed roll now; this is the roll itself, on the page where
 * the decision is taken — every lease, the tenant, the square feet, the
 * contract rent, the recovery structure and the expiry date, plus what is
 * vacant. It is the same object the deed conveys (Listing.roll, Approach.roll),
 * so nothing here can disagree with what you own tomorrow morning.
 *
 * THE BOUNDARY IS DELIBERATE. Everything on this card is the PRESENT and it is
 * exact. Whether any of these tenants renews when their date comes, what the
 * vacant feet re-let for, and where the market goes are not on it and must not
 * be — that risk is the business, and it is the only thing you are actually
 * being asked to have a view about.
 */
export function DisclosedRoll({ bbl }: { bbl: string }) {
  const game = useHeldGame(bbl);
  const parcels = useStore((s) => s.parcels)!;
  const rec = resolveRec(parcels, game, bbl);
  if (!rec || rec.class === "land" || !rec.bldgArea) return null;
  const d = disclosureFor(game, bbl);
  if (!d) {
    return (
      <div className="deal">
        <div className="deal-head">No rent roll</div>
        <div className="hint">
          Not disclosed. Occupancy and income shown are market estimates. Approach the owner for the rent roll.
        </div>
      </div>
    );
  }
  const li = game.listings.find((l) => l.bbl === bbl);
  // Once a price is agreed the statement is struck at THAT price — it read
  // the ask, so the going-in cap under the contract and the one in the
  // statement beside it disagreed on the same screen.
  const agreedPx = game.talks?.[bbl]?.agreed ? game.talks[bbl].agreedPrice : undefined;
  const px = agreedPx ?? li?.ask ?? game.approaches[bbl]?.ask ?? marketAppraisal(game, rec, bbl, gradeOf(game, rec));
  const h = asIfOwned(game, bbl, px, d, rec);
  // what the assessor's roll says today, before the sale resets it to the price
  const standingAssessed = assetValue(rec, game.econ, d.cond ?? gradeOf(game, rec), d.condIdx);
  const st = operatingStatement(rec, game.econ, h, game.month);
  const roll = [...(d.roll ?? [])].sort((a, b) => b.sf - a.sf);
  // RENTABLE FEET, AS THE ROLL IS. `genRentRoll` demises the rentable leg, so
  // vacancy counted off GROSS feet printed the core as empty space: a retail
  // building 88% let showed 3,439 sf "vacant at market" where 1,562 sf was.
  const commSf = Math.round(usesOf(rec).filter((u) => u !== "multifamily").reduce((a, u) => a + useRentableSf(rec, u), 0));
  const resSf = Math.round(useRentableSf(rec, "multifamily"));
  const vacant = Math.max(0, commSf - roll.reduce((a, t) => a + t.sf, 0));
  return (
    <div className="deal">
      <div className="deal-head">
        Disclosed rent roll · {(physicalOcc(rec as never, h) * 100).toFixed(0)}% leased
      </div>
      <div className="hint">
        {li ? "Source: offering memorandum." : "Source: owner."} Conveys with the deed. Renewals not guaranteed.
      </div>
      {roll.length > 0 && (
        <div className="roll">
          {roll.map((t, i) => {
            const moLeft = t.endM - game.month;
            return (
              <div key={i} className="roll-row">
                <span className="roll-name">
                  <BizLink t={t} /> <span className="roll-credit mono">{CREDIT_LABEL[t.credit]}</span>
                </span>
                <span className="roll-meta mono">
                  {sf(t.sf)} · ${t.rentPsf.toFixed(0)} {recoveryOf(t).toUpperCase()} · exp {monthLabel(t.endM)}
                  {moLeft < 24 && <> · <span className="warn">{termLeft(t.endM, game.month)}</span></>}
                </span>
              </div>
            );
          })}
          {vacant > 400 && (
            <div className="roll-row roll-vacant">
              <span className="roll-name">Vacant</span>
              <span className="roll-meta mono">
                {sf(vacant)} · ${useRentPsfYr(rec, game.econ, h.condition, (usesOf(rec).find((u) => u !== "multifamily") ?? "office") as BuiltClass).toFixed(0)}/sf market here
              </span>
            </div>
          )}
          {resSf > 0 && (
            <div className="roll-row roll-group">
              <span className="roll-name">apartments · {sf(resSf)}</span>
              <span className="roll-meta mono">{((d.occ ?? 0) * 100).toFixed(0)}% let</span>
            </div>
          )}
        </div>
      )}
      {roll.length === 0 && resSf === 0 && (
        <div className="hint">0% leased.</div>
      )}
      {/* THE TRAILING TWELVE, LINE BY LINE. Same statement the engine runs on a
          building you own — see operatingStatement — so the income you are
          shown before the closing and the income you are shown after it are
          one function, not two that agree. Property tax is struck at the price
          on the table, because a sale reassesses. */}
      <div className="grid" style={{ marginTop: 8 }}>
        <Row k="Base rent" v={usd(st.baseRent)} />
        {st.recoveredOpex + st.recoveredTax > 0 && <Row k="Recoveries" v={usd(st.recoveredOpex + st.recoveredTax)} />}
        <Row k="Effective gross income" v={usd(st.egi)} />
        <Row k="Operating expenses" v={usd(-st.opex)} />
        <Row k="Management" v={usd(-st.mgmt)} />
        <Row k={`Property tax at ${usd(px)}`} v={usd(-st.tax)} />
        <Row k="In-place NOI / yr" v={usd(st.noi)} strong bad={st.noi < 0} />
        <Row k="Going-in cap" v={px > 0 ? ((st.noi / px) * 100).toFixed(2) + "%" : "—"} strong />
      </div>
      {/* a sentence, so it reads as one — in the value column it wrapped
          into four lines of monospace beside a single figure */}
      {Math.abs(px - standingAssessed) > px * 0.05 && (
        <div className="hint dim">Assessment resets from {usd(standingAssessed)} to sale price.</div>
      )}
    </div>
  );
}

/** "$4.2M", "4200000", "4,200,000" → dollars; blank → undefined; junk → NaN. */
function parseDollars(txt: string): number | undefined {
  const t = txt.trim().replace(/[$,\s]/g, "");
  if (!t) return undefined;
  const m = /^(\d+(?:\.\d+)?)([kKmM])?$/.exec(t);
  if (!m) return NaN;
  const mult = m[2] ? (m[2].toLowerCase() === "m" ? 1e6 : 1e3) : 1;
  return Math.round(parseFloat(m[1]) * mult);
}

function instructionsFrom(accept: string, decline: string): { ins: SaleInstructions | null; bad: boolean } {
  const a = parseDollars(accept);
  const d = parseDollars(decline);
  const bad = Number.isNaN(a) || Number.isNaN(d) || (a !== undefined && d !== undefined && d > a);
  if (a === undefined && d === undefined) return { ins: null, bad };
  return { ins: { ...(a !== undefined ? { acceptAtOrAbove: a } : {}), ...(d !== undefined ? { declineBelow: d } : {}) }, bad };
}

/**
 * STANDING INSTRUCTIONS. The two numbers a seller gives the broker so every
 * call does not come to them. Blank means "ring me".
 */
function InstructionFields({ accept, decline, setAccept, setDecline }: {
  accept: string; decline: string; setAccept: (v: string) => void; setDecline: (v: string) => void;
}) {
  return (
    <>
      <div className="btn-row" style={{ alignItems: "center", flexWrap: "wrap" }}>
        <span className="dim">Auto-accept at or above $</span>
        <input className="mono" style={{ width: 120 }} inputMode="numeric" placeholder="optional"
          value={accept} onChange={(e) => setAccept(e.target.value)} />
      </div>
      <div className="btn-row" style={{ alignItems: "center", flexWrap: "wrap" }}>
        <span className="dim">Auto-decline below $</span>
        <input className="mono" style={{ width: 120 }} inputMode="numeric" placeholder="optional"
          value={decline} onChange={(e) => setDecline(e.target.value)} />
      </div>
      <div className="hint">
        Broker applies these on arrival. Auto-accepts close as ordinary sales (no 1031) unless short after tax and payoff. Offers between, and marketed bid lists, come to you. Blank = review all.
      </div>
    </>
  );
}

export function describeInstructions(ins: SaleInstructions | undefined): string | null {
  if (!ins) return null;
  const parts: string[] = [];
  if (ins.acceptAtOrAbove !== undefined) parts.push(`take ≥ ${usd(ins.acceptAtOrAbove)}`);
  if (ins.declineBelow !== undefined) parts.push(`pass < ${usd(ins.declineBelow)}`);
  return parts.length ? parts.join(" · ") : null;
}

export function SaleSection({ bbl, value }: { bbl: string; value: number }) {
  const game = useHeldGame(bbl);
  const parcels = useStore((s) => s.parcels)!;
  const { listSale, delistSale, acceptOffer, declineOffer, counterSale, runBestAndFinal, takeBid } = useStore.getState();
  const holding = game.holdings[bbl]!;
  const [ask, setAsk] = useState<string>("");
  const [counter, setCounter] = useState(0);
  // which bidder you are going back to privately, and at what number
  const [counterOn, setCounterOn] = useState<number | null>(null);
  const [counterPx, setCounterPx] = useState(0);
  const [acceptConfirm, setAcceptConfirm] = useState<null | { exchange?: boolean; bidIndex?: number }>(null);
  // standing instructions to the broker — prefilled empty
  const [insAccept, setInsAccept] = useState("");
  const [insDecline, setInsDecline] = useState("");
  const sale = holding.sale;
  const exchangeBusy = !!game.exchange;
  if (sale) {
    // Same waterfall the close runs — stack, kicker, break fee, release, investors, tax.
    const tq = sale.offer && parcels ? saleProceedsToSeller(game, parcels, holding, sale.offer.price) : null;
    const closeNet = (px: number, ex = false) => (parcels ? sellerCashAtClose(game, parcels, holding, px, ex) : 0);
    const counterBounds = sale.offer
      ? (() => {
          const b = counterPriceBounds(sale.offer.price, apMid(bbl, value));
          return { ...b, min: Math.max(b.min, sale.offer!.price + b.step) };
        })()
      : null;
    const bidCounterBounds = (i: number) => {
      const p = sale.bids![i].price;
      const b = counterPriceBounds(p, apMid(bbl, value));
      return { ...b, min: Math.max(b.min, p + b.step) };
    };
    return (
      <div className="deal">
        {acceptConfirm && (() => {
          const px = acceptConfirm.bidIndex !== undefined
            ? sale.bids![acceptConfirm.bidIndex].price
            : sale.offer!.price;
          return (
            <SaleAcceptConfirm
              address={parcels[bbl]?.address ?? bbl}
              price={px}
              net={closeNet(px, !!acceptConfirm.exchange)}
              exchange={acceptConfirm.exchange}
              contract={acceptConfirm.bidIndex !== undefined}
              onCancel={() => setAcceptConfirm(null)}
              onConfirm={() => {
                if (acceptConfirm.bidIndex !== undefined) takeBid(bbl, acceptConfirm.bidIndex, sale.bids?.[acceptConfirm.bidIndex]?.name);
                else acceptOffer(bbl, acceptConfirm.exchange);
                setAcceptConfirm(null);
              }}
            />
          );
        })()}
        <div className="deal-head">For sale · listed {monthLabel(sale.listedM)}</div>
        <div className="grid">
          <Row k={sale.mode === "marketed" ? "Whisper price" : "Your ask"} v={usd(sale.ask)} strong />
          <Row k="vs. appraisal" v={pctSigned(sale.ask / apMid(bbl, value) - 1)} />
          <Row k="Process" v={`${sale.mode === "marketed" ? "Marketed campaign" : "Quiet listing"} · ${(saleFeeRate(holding, game) * 100).toFixed(2).replace(/\.?0+$/, "")}% fee`} />
          {sale.callM !== undefined && <Row k="Offers due" v={monthLabel(sale.callM)} strong />}
          {describeInstructions(sale.instructions) && (
            <Row k="Broker's instructions" v={describeInstructions(sale.instructions)!} />
          )}
        </div>
        {/* THE BID LIST. Everybody who turned up, at once. The spread across
            it is the information: tight means the market agrees with you and
            there is nothing more to get; wide means the top bidder wants it
            much more than the rest, which is exactly when going back to them
            is worth the risk of losing them. */}
        {sale.bids?.length ? (
          <>
            <div className="page-section" style={{ marginTop: 2 }}>
              Bids · {sale.bids.filter((b) => !b.dropped).length} live{(sale.round ?? 0) > 0 ? " · best and final complete" : ""}
            </div>
            <table className="tbl">
              <thead>
                <tr><th>Bidder</th><th className="num">Price</th><th className="num">vs appraisal</th><th>Read</th><th /></tr>
              </thead>
              <tbody>
                {sale.bids.map((b, i) => (
                  <tr key={b.name + i} className={b.dropped ? "dim" : ""}>
                    <td><FirmLink name={b.name} id={b.firmId} /></td>
                    <td className="num">{usd(b.price)}</td>
                    <td className="num">{((b.price / apMid(bbl, value) - 1) * 100).toFixed(0)}%</td>
                    <td className="dim">{b.dropped ? "Dropped at best and final" : b.note}</td>
                    <td>
                      {!b.dropped && (
                        <div className="btn-row" style={{ gap: 4, margin: 0 }}>
                          <button className="btn-mini" onClick={() => setAcceptConfirm({ bidIndex: i })}>take it</button>
                          {/* GOING BACK TO ONE BIDDER. Best-and-final puts the
                              whole list back in the room; this is the other
                              move — the private call to the one number you
                              would take five per cent more of. One per bid. */}
                          {!b.countered && (
                            <button className={"btn-mini" + (counterOn === i ? " on" : "")}
                              title={`Private counter to ${b.name}`}
                              onClick={() => { setCounterOn(counterOn === i ? null : i); setCounterPx(Math.round(b.price * 1.06)); }}>
                              counter
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* NAME YOUR OWN NUMBER. This was a hardcoded "counter +6%" button,
                which is not a negotiation — it is a single scripted move. The
                engine has always taken an arbitrary price; only the UI was
                deciding for you. How hard you push is the entire decision:
                every point you ask for is a point of risk that the one bidder
                who was there walks and the process is over. */}
            {counterOn !== null && sale.bids?.[counterOn] && !sale.bids[counterOn].dropped && (() => {
              const bb = bidCounterBounds(counterOn);
              return (
              <div className="page-section" style={{ marginTop: 6 }}>
                <Slider
                  label={`Counter ${sale.bids![counterOn].name}`}
                  value={counterPx}
                  min={bb.min}
                  max={bb.max}
                  step={bb.step}
                  typedMin={bb.typedMin}
                  typedMax={bb.typedMax}
                  editable="price"
                  onChange={setCounterPx}
                  format={(v: number) => usd(v)}
                  hint={`Above ${usd(sale.bids![counterOn!].price)}. Higher counters risk the bidder walking.`}
                />
                <div className="btn-row">
                  <button className="btn" onClick={() => { useStore.getState().counterBid(bbl, counterOn!, counterPx); setCounterOn(null); }}>
                    Send · {usd(counterPx)}
                  </button>
                  <button className="btn" onClick={() => setCounterOn(null)}>Cancel</button>
                </div>
              </div>
              );
            })()}
            <div className="hint">
              Accepted bids can be retraded in diligence; weaker buyer credit, higher risk.
            </div>
            {(sale.round ?? 0) === 0 && sale.bids.filter((b) => !b.dropped).length > 1 && (
              <div className="btn-row">
                <button className="btn" onClick={() => runBestAndFinal(bbl)}>
                  Best and final to the top {Math.min(3, sale.bids.filter((b) => !b.dropped).length)}
                </button>
              </div>
            )}
          </>
        ) : null}
        {sale.offer && tq ? (
          <>
            <div className="hint">
              {sale.offer.retrade
                ? <><b>Retrade</b>{sale.offer.from ? <> · <FirmLink name={sale.offer.from} id={sale.offer.firmId} /></> : ""} · {sale.offer.retrade} · now <b className="mono">{usd(sale.offer.price)}</b> · expires {monthLabel(sale.offer.expiresM)}.</>
                : sale.offer.contract && !sale.offer.held
                  ? <>Under contract{sale.offer.from ? <> · <FirmLink name={sale.offer.from} id={sale.offer.firmId} /></> : ""} · <b className="mono">{usd(sale.offer.price)}</b> · auto-closes {monthLabel(sale.offer.expiresM)}.</>
                  : <>Offer{sale.offer.from ? <> · <FirmLink name={sale.offer.from} id={sale.offer.firmId} /></> : ""} · <b className="mono">{usd(sale.offer.price)}</b> · expires {monthLabel(sale.offer.expiresM)}.</>}
              {tq.tax > 0 && <> Gain {usd(tq.gain)} over depreciated basis · tax <b className="mono">{usd(tq.tax)}</b>.</>}
            </div>
            {/* WHAT THEY ARE ACTUALLY BUYING. A price is a price; the cap rate
                they are getting and the occupancy they are getting it on are
                the two numbers that say whether the offer is generous or
                whether they have spotted something you have not. */}
            {(() => {
              const orec = resolveRec(parcels, game, bbl);
              if (!orec || orec.class === "land" || !orec.bldgArea) return null;
              // THE CAP THEY ARE BUYING AT, computed the way they compute it:
              // your roll, re-assessed at THEIR price, because a sale
              // reassesses. Struck against your old basis this quoted a
              // different number from the one on the other side of the table.
              const noi = holdingNOIYr(orec, game.econ,
                asIfOwned(game, bbl, sale.offer!.price, { roll: holding.tenants, occ: holding.occ, cond: holding.condition }, orec),
                game.month);
              const cap = sale.offer!.price > 0 ? (noi / sale.offer!.price) * 100 : 0;
              const mkt = game.econ.capRate[orec.class as BuiltClass] ?? cap;
              const occ = physicalOcc(orec as never, holding);
              const u = unitStatus(orec, holding, game.month);
              return (
                <div className="grid">
                  <Row k="Buyer cap rate" v={`${cap.toFixed(2)}%`} strong bad={cap > mkt + 0.4} />
                  <Row
                    k="Market cap rate"
                    v={`${mkt.toFixed(2)}% ${useLabel(orec)} · ${cap < mkt - 0.25 ? "premium" : cap > mkt + 0.25 ? "discount" : "at market"}`}
                  />
                  <Row k="Underwritten NOI" v={usd(noi)} />
                  <Row k="Occupancy" v={`${(occ * 100).toFixed(0)}% · ${u.leased} of ${u.total} spaces`} bad={occ < 0.75} />
                  <Row k="vs. ask" v={`${((sale.offer!.price / sale.ask - 1) * 100).toFixed(1)}%`} bad={sale.offer!.price < sale.ask * 0.92} />
                </div>
              );
            })()}
            <div className="btn-row">
              <button className="btn btn-buy" onClick={() => setAcceptConfirm({})}>
                {sale.offer.contract && !sale.offer.held ? "Close now" : "Accept"} · net {usd(closeNet(sale.offer.price))}
              </button>
              {tq.tax > 0 && !exchangeBusy && !consentFor(game, holding, "exchange") && (
                <button
                  className="btn btn-buy"
                  title={`Defer ${usd(tq.tax)} tax. Must buy ≥ 80% of price within 6 mo.`}
                  onClick={() => setAcceptConfirm({ exchange: true })}
                >
                  1031 · defer {usd(tq.tax)}
                </button>
              )}
              {!(sale.offer.contract && !sale.offer.held) && <button className="btn" onClick={() => declineOffer(bbl)}>Decline</button>}
            </div>
            {!sale.offer.countered && !(sale.offer.contract && !sale.offer.held) && counterBounds && (
              <>
                <Slider
                  label="Counter"
                  value={counter || Math.round(sale.offer.price * 1.06)}
                  min={counterBounds.min}
                  max={counterBounds.max}
                  step={counterBounds.step}
                  typedMin={counterBounds.typedMin}
                  typedMax={counterBounds.typedMax}
                  editable="price"
                  onChange={setCounter}
                  format={(v) => usd(v)}
                  marks={[
                    { at: Math.round(sale.offer.price * 1.03), label: "+3%" },
                    { at: Math.round(sale.offer.price * 1.08), label: "+8%" },
                    { at: sale.ask, label: "ask" },
                  ]}
                  hint="Above their bid. Far over appraisal risks a walk."
                />
                <div className="btn-row">
                  <button className="btn" onClick={() => counterSale(bbl, counter || Math.round(sale.offer!.price * 1.06))}>
                    Counter at {usd(counter || Math.round(sale.offer.price * 1.06))}
                  </button>
                </div>
              </>
            )}
          </>
        ) : (
          <div className="hint">
            {sale.callM !== undefined
              ? `Offers due ${monthLabel(sale.callM)}.`
              : "No offers yet."}
          </div>
        )}
        {!sale.unsolicited && (() => {
          const { ins, bad } = instructionsFrom(insAccept, insDecline);
          return (
            <>
              <div className="page-section" style={{ marginTop: 2 }}>Standing instructions</div>
              <InstructionFields accept={insAccept} decline={insDecline} setAccept={setInsAccept} setDecline={setInsDecline} />
              <div className="btn-row">
                <button className="btn" disabled={bad || !ins}
                  onClick={() => { useStore.getState().setSaleInstructions(bbl, ins); setInsAccept(""); setInsDecline(""); }}>
                  Set instructions
                </button>
                {sale.instructions && (
                  <button className="btn" onClick={() => useStore.getState().setSaleInstructions(bbl, null)}>
                    Withdraw instructions
                  </button>
                )}
              </div>
            </>
          );
        })()}
        {/* MOVE THE PRICE WITHOUT PULLING THE SIGN DOWN.
            Changing an ask used to mean delisting and relisting, which throws
            away the campaign, the bid list and the time the building has been
            on the market. Every seller alive just tells the broker a new
            number. Cutting it is free; raising it past where you started reads
            as a seller who does not know what they have, and the market
            treats a repriced listing as a fresher one either way. */}
        <Slider
          label="Reprice"
          value={ask ? Number(ask) : sale.ask}
          min={Math.round(apMid(bbl, value) * 0.65)}
          max={Math.round(apMid(bbl, value) * 1.45)}
          step={Math.max(1000, Math.round(apMid(bbl, value) / 400))}
          onChange={(v) => setAsk(String(v))}
          format={(v) => `${usd(v)} · ${((v / apMid(bbl, value) - 1) * 100).toFixed(0)}% vs appraisal`}
          marks={[{ at: sale.ask, label: "now" }, { at: Math.round(apMid(bbl, value)), label: "fair" }]}
          hint={(() => {
            const want = ask ? Number(ask) : sale.ask;
            return want < sale.ask
              ? `−${usd(sale.ask - want)}. Cuts draw offers; signal motivation.`
              : want > sale.ask
                ? `+${usd(want - sale.ask)}. Raising mid-campaign loses buyers.`
                : "Current ask.";
          })()}
        />
        <div className="btn-row">
          <button
            className="btn"
            disabled={!ask || Number(ask) === sale.ask}
            onClick={() => useStore.getState().reprice(bbl, Number(ask))}
          >
            Reprice to {usd(ask ? Number(ask) : sale.ask)}
          </button>
          <button className="btn btn-sell" onClick={() => delistSale(bbl)}>Delist</button>
        </div>
      </div>
    );
  }
  const mid = apMid(bbl, value);
  const askNum = parseFloat(ask);
  const price = Number.isFinite(askNum) ? askNum : mid;
  // What the ask means as a yield — the number the buyer converts it to.
  const saleRec = resolveRec(parcels, game, bbl);
  const saleH = game.holdings[bbl];
  // A leased fee is a coupon bond — yield off ground rent, not vacant-shell NOI.
  const fee = !!saleH && isLeasedFee(saleH);
  const saleClass = (fee
    ? "office"
    : (saleRec && saleRec.class !== "land" ? saleRec.class : "office")) as BuiltClass;
  // YOUR OWN ROLL, RE-ASSESSED AT YOUR ASK. This quoted the class model, so a
  // principal pricing their own half-empty building was shown the yield a full
  // one would offer — and every buyer in town was reading the real roll. The
  // number a seller needs is what a buyer will compute: in-place income off
  // the leases actually in place, against a tax bill struck at the new price.
  const saleNoi = fee && saleH
    ? ownedContractNoiYr(game, parcels, saleH)
    : saleRec && saleRec.class !== "land" && saleRec.bldgArea > 0 && saleH
      ? holdingNOIYr(saleRec, game.econ,
          asIfOwned(game, bbl, price, { roll: saleH.tenants, occ: saleH.occ, cond: saleH.condition }, saleRec),
          game.month)
      : 0;
  const askCap = saleNoi > 0 && price > 0 ? (saleNoi / price) * 100 : null;
  return (
    <div className="deal">
      <div className="deal-head">Sell</div>
      <div className="hint">Appraisal: {band(bbl, value)}.</div>
      <Slider
        label="Your ask"
        value={price}
        min={Math.round(mid * 0.7)}
        max={Math.round(mid * 1.4)}
        step={Math.max(1000, Math.round(mid / 400))}
        onChange={(v) => setAsk(String(v))}
        format={(v) => `${usd(v)} · ${((v / mid - 1) * 100).toFixed(0)}% vs appraisal`}
        marks={[
          { at: Math.round(mid * 0.92), label: "quick" },
          { at: Math.round(mid), label: "fair" },
          { at: Math.round(mid * 1.15), label: "reach" },
        ]}
        hint={price < mid * 0.95 ? "Below market: fast sale."
          : price > mid * 1.12 ? "Above market: slow sale."
          : "At market."}
      />
      {/* WHAT YOU ARE ACTUALLY ASKING. A price is a number; a cap rate is the
          number every buyer on the other side will convert it to before they
          answer the phone, and it is the one that says whether the ask is
          serious. */}
      {askCap !== null && (
        <div className="hint">
          Ask cap <b className="mono">{askCap.toFixed(2)}%</b> on {usd(saleNoi)} {fee ? "ground rent" : "NOI"}
          {fee
            ? " (leased fee, priced as bond + reversion)."
            : ` · market ${game.econ.capRate[saleClass].toFixed(2)}%.`}
          {!fee && (askCap < game.econ.capRate[saleClass] - 0.4
            ? " Premium to market."
            : askCap > game.econ.capRate[saleClass] + 0.4
              ? " Discount to market."
              : " At market.")}
        </div>
      )}
      {/* TWO WAYS TO SELL, and they are genuinely different trades. A sign on
          the door is cheap and finds you one buyer at a time, so you never
          learn what the best buyer in the city would have paid. A run process
          costs a point more and three months, and puts every one of them in
          the same room on the same day. In a thin market the campaign finds
          nobody and you have paid for the privilege. */}
      {/* THE OWNER ASKED WHETHER THE QUIET LISTING SHOULD EXIST AT ALL. It
          should: selling off-market is a real and common way to trade a
          building, and the trade the engine models is the right one — you pay
          a point less in fees and you give up price discovery. What was wrong
          was that the choice was described in a paragraph instead of priced.
          A decision with two numbers on it is a decision; a decision with an
          adjective on it is a paragraph. Both buttons now carry the fee in
          dollars, and the ask is on both of them. */}
      <InstructionFields accept={insAccept} decline={insDecline} setAccept={setInsAccept} setDecline={setInsDecline} />
      <div className="btn-row">
        <button className="btn btn-buy" disabled={instructionsFrom(insAccept, insDecline).bad}
          onClick={() => listSale(bbl, price, "marketed", instructionsFrom(insAccept, insDecline).ins ?? undefined)}>
          Marketed sale · {usd(price)} less {usd(Math.round(price * 0.025))} fee
        </button>
        <button className="btn" disabled={instructionsFrom(insAccept, insDecline).bad}
          onClick={() => listSale(bbl, price, "quiet", instructionsFrom(insAccept, insDecline).ins ?? undefined)}>
          Off-market sale · {usd(price)}
          {quietFeeRate(game) <= 0.0001 ? " · no fee" : ` less ${usd(Math.round(price * quietFeeRate(game)))} fee`}
        </button>
      </div>
      <div className="hint">
        Marketed: +{usd(Math.round(price * (0.025 - quietFeeRate(game))))}, 2-4 mo, all bids on one date, one best-and-final round.
        Off-market: one buyer at a time, no price discovery.
        {quietFeeRate(game) <= 0.0001
          ? " Off-market fee: none (relationships)."
          : ` Off-market fee ${(quietFeeRate(game) * 100).toFixed(2)}%; falls with more firms traded.`}
      </div>
    </div>
  );
}

// Leverage is a dial, not three buttons: slide from all-cash to whatever the
// lender will actually fund, and watch the equity cheque and the coverage
// move together.

// Standard mortgage annuity, annualised — what an amortizing loan actually
// costs per year, as opposed to coupon-times-balance, which flattered every
// quote by the principal component.

export function OffMarketCounter({ bbl, ask }: { bbl: string; ask: number }) {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const [frac, setFrac] = useState(0.88);
  const px = Math.round(ask * frac);
  return (
    <>
      <Slider
        label="Counter"
        value={frac}
        min={0.7}
        max={0.98}
        step={0.01}
        onChange={setFrac}
        format={() => `${usd(px)} · ${((frac - 1) * 100).toFixed(0)}%`}
        marks={[{ at: 0.88, label: "−12%" }, { at: 0.95, label: "−5%" }]}
        hint={`One counter. Small cuts usually land; deep cuts end talks. ${(() => { const sk = sellerOf(game, parcels, bbl); const b = closingBand(sk.kind, {}); const lbl = sellerProfile(sk.kind).label; return `${lbl[0].toUpperCase()}${lbl.slice(1)} typically closes at ${(b.lo * 100).toFixed(0)}–${(b.hi * 100).toFixed(0)}% of the ask${phaseShift(game) ? ` (${phaseShift(game) > 0 ? "firmer" : "softer"} in this phase)` : ""}.`; })()}`}
      />
      <div className="btn-row">
        <button className="btn" onClick={() => useStore.getState().counterOff(bbl, px)}>
          Counter · {usd(px)}
        </button>
      </div>
    </>
  );
}

/**
 * "MAKE ME AN OFFER." — the off-market conversation with no number in it.
 *
 * `approachOwner` now has two ways of saying yes. One names a figure and this
 * panel has always drawn it. The other deflects, keeps the figure in the
 * owner's head as `Approach.reserve`, and leaves the player exactly one
 * instrument: a bid.
 *
 * THE ONE RULE HERE IS WHAT IS NOT ON THE SCREEN. types.ts is explicit that no
 * view may render the reserve "as a figure, a bar, a 'you're close' hint, a
 * disabled slider that stops at it, anything" — the refusal to anchor IS the
 * mechanic, and any of those hands the information straight back. So every
 * number below belongs to the player: the appraisal, which they can already
 * read off the summary tab, and their own bids.
 *
 * The dial is a multiple of that appraisal because the appraisal is the only
 * anchor in the room, and its endpoints are the SAME for every parcel in the
 * game — 0.5x to 4x — so where it stops says nothing about where THIS owner
 * is. The top end is a coverage number, not a taste: measured over 2,164 blind
 * conversations across four seeds, reserves run 0.22x to 9.42x appraisal with
 * a median of 1.26x, and a 4x ceiling can reach 97.2% of them (2x reaches only
 * 81.1%, which would have made the dial itself the thing that lost deals). The
 * ones past 4x are owners saying no in numbers, which is what the named-ask
 * path already does out loud at up to 5.86x.
 */
export function BlindBidDesk({ bbl, appr, value }: { bbl: string; appr: Approach; value: number }) {
  const game = useHeldGame(bbl);
  // Live record — the prop can lag a tick behind a bid that just moved probes
  // or drew an ask out; the desk signature now watches those fields, and we
  // read the store copy so the numbers on screen are the ones just written.
  const live = game.approaches[bbl] ?? appr;
  const ap = apMid(bbl, value);
  const [mult, setMult] = useState(1);
  // Round to the thousand the way approachOwner rounds its own number, so the
  // bid the player sees is the bid the engine books.
  const bid = Math.max(1000, Math.round((ap * mult) / 1000) * 1000);
  const probes = live.probes ?? 0;
  // buyOffMarket kills a blind conversation at q+6 with "that has gone cold";
  // approachOwner reopens the phone at q+6 as well, so the two meet exactly.
  const cold = game.month > live.q + 6;
  if (cold) {
    return (
      <>
        {/* Which sentence is true depends on whether the player ever bid. It
            says "you never put one in" only when probes is 0 — the record
            knows, and a panel that told a player who bid four times that they
            never bid would be reading the wrong field out loud. */}
        <div className="hint">
          {probes > 0
            ? `Last bid ${live.lastBid ? usd(live.lastBid) : "—"}.`
            : "No bid made."}
          {" "}Expired after 6 months.
        </div>
        <div className="btn-row">
          <button className="btn" onClick={() => useStore.getState().approach(bbl)}>Approach again</button>
        </div>
      </>
    );
  }
  return (
    <>
      <div className="hint">
        Owner will not name a price. Bid blind.
      </div>
      <div className="grid">
        <Row k="Asking price" v="Not disclosed" strong />
        <Row k="Appraisal" v={band(bbl, value)} />
        <Row k="Open until" v={monthLabel(live.q + 6)} />
        {probes > 0 && (
          <Row
            k="Bids made"
            v={`${probes}${live.lastBid ? ` · last ${usd(live.lastBid)}` : ""}`}
            bad={probes >= 3}
          />
        )}
      </div>
      <Slider
        label="Your bid"
        value={mult}
        min={0.5}
        max={4}
        step={0.05}
        onChange={setMult}
        format={() => `${usd(bid)} · ${mult.toFixed(2)}× appraisal`}
        marks={[{ at: 0.8, label: "0.8×" }, { at: 1, label: "appraisal" }, { at: 1.5, label: "1.5×" }, { at: 2, label: "2×" }]}
        hint="Multiple of appraisal. Seller reserve not shown."
      />
      {/* WHAT EACH OUTCOME MEANS, because a blind bid has four of them and
          three look like failure. Written from bidBlind's branches, in the
          order they are checked, and deliberately without odds attached: the
          player is not entitled to the shape of the distribution either. */}
      <div className="hint">
        Above reserve: deal <strong>at your bid</strong>. Just below: seller may name an ask. Well below: declined. Far below: talks end.
      </div>
      {probes >= 2 && (
        <div className="hint">
          {probes} bids. Seller patience is limited.
        </div>
      )}
      {/* A NUMBER ONLY. Financing used to sit in front of this button — Thesis →
          Structure → Commit before the seller ever saw a figure. Agree a price
          first; if they take it you go under contract and structure the stack then. */}
      <div className="btn-row">
        <button
          className="btn btn-buy"
          onClick={() => useStore.getState().bidBlind(bbl, bid)}
        >
          Bid {usd(bid)}
        </button>
      </div>
      <div className="hint dim">
        Price only. If accepted: {usd(Math.round(bid * DEPOSIT_PCT))} deposit goes hard; 3 mo to finance and close.
      </div>
    </>
  );
}

/**
 * THE OFFER. A price, and nothing else on the screen.
 *
 * This used to be one component with a lender selector, a leverage dial, three
 * coverage tests and a going-in cap table sitting above the button that said
 * "Offer" — so before the player was allowed to name a number they had to make
 * four financing decisions about a building they did not have. Nobody buys
 * anything that way. You agree a price with a person, and then you go and find
 * the money against a deal you actually have.
 *
 * So this is the conversation, whole: their number, your number, how far apart
 * you are, how many rounds are left, and what kind of seller you are reading.
 * The capital stack does not appear until there is something to fund.
 */
export function OfferDesk({ bbl, price, distress, loanBasis }: { bbl: string; price: number; distress?: boolean; loanBasis?: number }) {
  const game = useHeldGame(bbl);
  const parcels = useStore((s) => s.parcels)!;
  const mid = apMid(bbl, price);
  const bounds = widePriceBounds(price, mid);
  const defaultOffer = distress ? 0.88 : 0.94;
  const [offerPrice, setOfferPrice] = useState(Math.round(price * defaultOffer));
  // BEST AND FINAL is an instrument, not a bluff. Certainty of a done deal is
  // worth about three and a half per cent to a seller who has been retraded
  // before — and every seller has been — so a credible final closes under
  // their floor. The price of the instrument: a no ends it, for both sides,
  // and it is only credible while the street still believes your finals.
  const [isFinal, setIsFinal] = useState(false);
  // THE SLIDER FOLLOWS THE CONVERSATION. It kept the opening default after you
  // had offered, so paying ask and hearing a counter left a "Counter at" button
  // BELOW your own last number. Each time a round lands, it starts from what
  // you last said.
  const liveTalks = game.talks?.[bbl] ?? null;
  const talksKey = liveTalks ? `${liveTalks.round}:${liveTalks.yourPrice}` : null;
  const [syncedTalks, setSyncedTalks] = useState<string | null>(null);
  if (liveTalks && talksKey !== syncedTalks) {
    setSyncedTalks(talksKey);
    setOfferPrice(Math.round(liveTalks.yourPrice));
  }
  // THE PERSON, NOT THE LISTING. A cold holder still has a number on the tape
  // — the market can buy it — but the offer controls are a lie if they will
  // not sell to you.
  const cold = coldOnDeed(game, parcels, bbl);
  if (cold) {
    return (
      <div className="hint neg" style={{ marginTop: 6 }}>
        <strong>Not to you.</strong> {coldRefuseMsg(cold)}
        <div className="dim" style={{ marginTop: 4 }}>
          Ask {usd(price)}. Not available to you.
        </div>
      </div>
    );
  }
  const offerPriceRounded = Math.round(offerPrice);
  const seller = sellerOf(game, parcels, bbl);
  const lenderSale = !!distress && !!loanBasis;
  const band = closingBand(seller.kind, { distress: !!distress, lenderSale });
  const talks = game.talks?.[bbl] ?? null;
  // Everything else you have on the table. Not a blocker any more — a list,
  // because knowing what else you are committed to is exactly what you need
  // when you decide how hard to push on this one.
  const others = Object.values(game.talks ?? {}).filter((t) => t.bbl !== bbl);
  const atLimit = !talks && others.length >= MAX_TALKS;
  // THE RESOLVED RECORD. `parcels[bbl]` is the lot as GENERATED — a delivered
  // tower reads as the dirt it used to be, which is the same fault buyQuote
  // fixed on the lender's side and left standing here.
  const rec = resolveRec(parcels, game, bbl);
  const ip = rec ? inPlace(rec, game, bbl, offerPriceRounded) : null;
  const noi = ip?.noi ?? 0;
  const goingInPct = offerPriceRounded > 0 && noi > 0 ? (noi / offerPriceRounded) * 100 : null;
  const stab = rec ? proFormaNOIYr(rec, game.econ, ip?.h?.condition ?? initialCondition(rec), offerPriceRounded) : 0;
  const early = game.listings.find((l) => l.bbl === bbl);
  const earlyLeft = early && early.earlyUntilM !== undefined && game.month < early.earlyUntilM
    ? early.earlyUntilM - game.month : 0;
  const earlyShop = early?.quietFrom ?? (early?.via ? game.brokerRel?.[early.via]?.name : undefined);
  return (
    <>
      {earlyLeft > 0 && (
        <div className="hint" style={{ marginTop: 6 }}>
          <strong>First look.</strong> From {earlyShop ?? "broker"} · exclusive {earlyLeft} mo.
          {early?.quietFrom ? " Seller distressed; public listing after window." : " Lapsing hurts broker relationship."}
        </div>
      )}
      <Slider
        label="Your offer"
        value={offerPriceRounded}
        min={bounds.min}
        max={bounds.max}
        step={bounds.step}
        typedMin={bounds.typedMin}
        typedMax={bounds.typedMax}
        editable="price"
        onChange={setOfferPrice}
        format={(v) => usd(v)}
        marks={[{ at: Math.round(price * 0.85), label: "−15%" }, { at: Math.round(price * 0.95), label: "−5%" }, { at: price, label: "ask" }]}
        hint={talks
          ? (offerPriceRounded >= talks.theirPrice
            ? `At or above seller ${usd(talks.theirPrice)}: goes under contract.`
            : `Seller ${usd(talks.theirPrice)} · gap ${usd(talks.theirPrice - offerPriceRounded)}${talks.final ? " · final" : ` · round ${talks.round}/${talks.maxRounds}`}`)
          : distress
            ? `${((offerPriceRounded / Math.max(1, price) - 1) * 100).toFixed(1)}% vs ask ${usd(price)}.${loanBasis ? ` Loan basis ${usd(loanBasis)}.` : " Motivated seller."} ${sellerProfile(seller.kind).label}: typical close ${Math.round(band.lo * 100)}–${Math.round(band.hi * 100)}% of ask.`
            : `${((offerPriceRounded / Math.max(1, price) - 1) * 100).toFixed(1)}% vs ask ${usd(price)}. ${sellerProfile(seller.kind).label}: typical close ${Math.round(band.lo * 100)}–${Math.round(band.hi * 100)}% of ask.`}
      />
      {/* What the number MEANS, before anybody talks about debt. A going-in cap
          is the only thing you need to know to decide whether a price is a
          price — the capital stack changes what you earn on it, not whether it
          is worth owning. */}
      {goingInPct !== null && (
        <div className="grid">
          <Row k={ip?.disclosed ? "In-place NOI / yr, after taxes" : "NOI / yr (mkt est.)"} v={usd(noi)} />
          <Row k={<><Gloss term="going-in cap">Going-in cap</Gloss></>} v={`${goingInPct.toFixed(2)}%`} strong />
          {/* Stabilised beside it and never instead of it. If this line is far
              above the one at the top, you are buying a leasing job. */}
          <Row k={<Gloss term="stabilised pro-forma">Stabilised pro-forma</Gloss>} v={`${usd(stab)} · ${offerPrice > 0 ? ((stab / offerPrice) * 100).toFixed(2) : "—"}%`} />
          {/* Occupancy is not a function of price — the block above already prints it. */}
          {/* IS THE PRICE A PRICE — the buy side of the line the sell desk has
              always printed. The market's cap for the class is the econ's own
              index, the same one every appraisal reads. */}
          {rec && rec.class !== "land" && (() => {
            const mkt = game.econ.capRate[rec.class as keyof typeof game.econ.capRate];
            if (!(mkt > 0)) return null;
            const d = goingInPct - mkt;
            return (
              <Row k="Market cap rate" v={`${mkt.toFixed(2)}% ${rec.class} · ${d > 0.4 ? "below market price" : d < -0.4 ? "above market price" : "at market"}`} />
            );
          })()}
          {/* CAN YOU CLOSE IT. Earnest money goes hard when the price is
              agreed; a newcomer could agree a price they could not fund. */}
          {(() => {
            const purse = spendable(game, parcels).total;
            const outright = Math.round(offerPriceRounded * 1.02);
            const levered = Math.round(offerPriceRounded * 0.37);
            return (
              <Row k="Cash to close" v={`${usd(outright)} all-cash · ~${usd(levered)} at 65% LTV · available ${usd(purse)}`} bad={purse < levered} />
            );
          })()}
          {/* WHETHER TENANTS WILL COME — the leasing desk's own pace, read on
              the disclosed roll before you own it rather than after. */}
          {ip?.h && rec && rec.class !== "land" && (() => {
            const odds = leasingOdds(game, parcels, rec, ip.h, rec.class as BuiltClass);
            if (!odds || odds.availSf <= 0) return null;
            return (
              <Row k="Leasing outlook" v={`${Math.round(odds.availSf).toLocaleString()} sf vacant · ~${Math.round(odds.loiOdds * 100)}% LOI odds/mo${odds.monthsToLet !== null ? ` · ~${Math.max(1, Math.round(odds.monthsToLet))} mo to 85%` : " · 85% not reached"}`} bad={odds.loiOdds < 0.05} />
            );
          })()}
        </div>
      )}
      {/* ACROSS THE TABLE — and now with their accounts on it. The blurb says
          what kind of counterparty this is, which is what decides how the
          conversation goes; the line under it says what they own, what they
          owe on it and whether the book pays for itself, which is what decides
          whether they need this deal. Both halves used to exist only for the
          dozen firms on the street. */}
      <div className="hint" style={{ marginTop: 6 }}>
        Seller: <strong>{seller.name}</strong>{seller.name.endsWith(".") ? "" : "."} {sellerProfile(seller.kind).blurb}
        {(() => {
          const o = ownerAt(game, parcels, bbl);
          if (!o || o.publicOwner) return null;
          return (
            <div className="dim mono" style={{ marginTop: 3 }}>
              {o.book.length} propert{o.book.length === 1 ? "y" : "ies"} · {usd(o.sheet.assets)} assets ·{" "}
              {o.sheet.debt > 0 ? `${(o.sheet.ltv * 100).toFixed(0)}% LTV` : "no debt"} ·{" "}
              <span className={o.income.net < 0 ? "neg" : ""}>{usd(o.income.net)}/yr after debt service</span>
            </div>
          );
        })()}
      </div>
      {talks && (
        <>
          <div className="grid" style={{ marginTop: 6 }}>
            <Row k="Seller price" v={usd(talks.theirPrice)} strong />
            <Row k="Your offer" v={usd(talks.yourPrice)} />
            <Row k="Gap" v={usd(Math.max(0, talks.theirPrice - talks.yourPrice))}
              bad={talks.theirPrice - talks.yourPrice > talks.yourPrice * 0.08} />
            <Row k="Rounds" v={talks.final ? "Seller final" : `${talks.round} of ${talks.maxRounds}`} bad={talks.final} />
            <Row
              k="Status"
              v={(() => {
                const idleM = Math.max(0, game.month - talks.openedM);
                if (talks.agreed && talks.closeByM !== undefined) {
                  const left = talks.closeByM - game.month;
                  return left <= 0
                    ? "Fund now"
                    : `${left} mo to fund · open ${idleM} mo`;
                }
                if (idleM <= 0) return "Opened this month · reply on Advance";
                if (idleM === 1) return "Open 1 mo · reply on Advance";
                return `Open ${idleM} mo · reply on Advance`;
              })()}
              strong={!!talks.agreed}
              bad={!!talks.agreed && (talks.closeByM ?? game.month) - game.month <= 1}
            />
          </div>
          <div className="hint">{talks.note}</div>
          {distress && !talks.agreed && (
            <div className="hint">
              Seller replies on Advance.
            </div>
          )}
        </>
      )}
      {distress && !talks && (
        <div className="hint" style={{ marginTop: 4 }}>
          Distressed seller. Reply on Advance.
        </div>
      )}
      {others.length > 0 && (
        <div className="hint">
          Other negotiations: {others.map((t) => `${parcels[t.bbl]?.address ?? t.bbl} at ${usd(t.agreedPrice ?? t.theirPrice)}${t.agreed ? " (under contract)" : ""}`).join(" · ")}.
          {atLimit && ` Limit ${MAX_TALKS} reached.`}
        </div>
      )}
      {/* THEIR LAST WORD LEAVES TWO MOVES. Once the seller is final a counter
          can only be at or above their number, which is "Take" spelt longer;
          the greyed button and the best-and-final box beside it read as moves
          you still had. */}
      {!talks?.final && (
        <label className="hint" style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
          <input type="checkbox" checked={isFinal} onChange={(e) => setIsFinal(e.target.checked)} />
          Best and final (rejection ends talks)
        </label>
      )}
      <div className="btn-row">
        {!talks?.final && <button
          className="btn btn-buy"
          disabled={atLimit || (!!talks && talks.final && offerPriceRounded < talks.theirPrice)}
          onClick={() => { useStore.getState().offer(bbl, offerPriceRounded, isFinal); setIsFinal(false); }}
        >
          {talks ? `Counter at ${usd(offerPriceRounded)}` : `Offer ${usd(offerPriceRounded)}`}{isFinal ? " — final" : ""}
        </button>}
        {!talks && (
          <button
            className="btn"
            title="Offer at ask. Seller may still counter."
            onClick={() => useStore.getState().offer(bbl, price, false)}
          >
            Pay ask · {usd(price)}
          </button>
        )}
        {talks && (
          <>
            <button className="btn btn-buy" onClick={() => useStore.getState().acceptCounter(bbl)}
              title={`Under contract. ${usd(Math.round(talks.theirPrice * DEPOSIT_PCT))} deposit hard today; balance due in 3 mo.`}>
              Take {usd(talks.theirPrice)}
            </button>
            <button className="btn" onClick={() => useStore.getState().walkAway(bbl)}>Walk away</button>
          </>
        )}
      </div>
      {talks?.final && (
        <div className="hint">Seller final: {usd(talks.theirPrice)}.</div>
      )}
      <div className="hint dim">
        Agreed price: under contract, {usd(Math.round(offerPriceRounded * DEPOSIT_PCT))} deposit hard. 3 mo to finance and close or forfeit deposit.
      </div>
    </>
  );
}

/**
 * THE MONEY. Only ever shown against a price that is already agreed.
 */
export function BuyButtons({ bbl, price, off, closeLabel, bid }: {
  bbl: string; price: number; off: boolean; closeLabel?: string;
  /** Named off-market ask path only — funds `approaches[bbl].ask` (or this
   *  override). Blind "make me an offer" bids no longer come through here. */
  bid?: number;
}) {
  const game = useHeldGame(bbl);
  const parcels = useStore((s) => s.parcels)!;
  const { buyOff } = useStore.getState();
  const isLand = parcels[bbl]?.class === "land";
  // null until you pick: the desk opens on the cheapest money that will write
  // it. It used to open on the 30-year regional whenever that quoted, under a
  // line of advice naming a cheaper desk — a 9.52% loan pre-selected beneath
  // "Cheapest money that will write it: ... at 9.34% all in".
  const [product, setProduct] = useState<string | null>(null);
  const [lev, setLev] = useState(1);
  // Thesis → Structure → Commit: one job per stage so the close cheque is not
  // competing with product chips and the underwriting grid on the same scroll.
  const [stage, setStage] = useState<"thesis" | "structure" | "commit">("thesis");
  const offerPrice = Math.round(price);
  // Same pattern as RefiSection: default "savings" often won't quote, while
  // another desk will — fall through to a desk that actually writes so Commit
  // does not silently close all-cash against a card full of loan terms.
  // ORDERED BY WHAT THE MONEY COSTS, desks that will write first. The sheet's
  // own order put the debt fund beside the banks as if they were peers.
  // One quote per desk per render: the chooser, the advice line and the pick
  // all read the same desk, and buyQuote walks the whole credit stack each time.
  const qCache = new Map<string, ReturnType<typeof buyQuote>>();
  const quoteOf = (id: string) => {
    let q = qCache.get(id);
    if (!q) { q = buyQuote(game, parcels, bbl, offerPrice, id, 1); qCache.set(id, q); }
    return q;
  };
  const productChoices = PRODUCTS.filter((p) => !p.mezz && (isLand ? p.uwDscr <= 0 : p.uwDscr > 0))
    .map((p) => ({ p, q: quoteOf(p.id) }))
    .sort((a, b) => (b.q.principal > 0 ? 1 : 0) - (a.q.principal > 0 ? 1 : 0) || a.q.allInPct - b.q.allInPct)
    .map((x) => x.p);
  const advice = (() => {
    const rec0 = resolveRec(parcels, game, bbl);
    const occ = rec0 ? inPlace(rec0, game, bbl, offerPrice).occ : 0;
    return deskAdvice(productChoices.map((p) => { const q = quoteOf(p.id); return { id: p.id, label: p.label, lender: p.lender, maxProceeds: q.principal, allInPct: q.allInPct, bridge: p.bridge, available: q.principal > 0 }; }), 0, occ >= 0.85);
  })();
  // NEGATIVE LEVERAGE, SAID BEFORE THE CHOICE RATHER than as a red row on
  // the commit stage after it. When even the cheapest desk that will write
  // costs more than the building yields in place, every borrowed dollar
  // lowers the return on the equity — so a firm that can pay cash opens on
  // cash, with the reason, and can still pick a loan.
  const goingIn = (() => {
    const r0 = resolveRec(parcels, game, bbl);
    return r0 && offerPrice > 0 ? (inPlace(r0, game, bbl, offerPrice).noi / offerPrice) * 100 : 0;
  })();
  const cheapestLoan = productChoices.map((p) => quoteOf(p.id)).filter((q) => q.principal > 0).sort((a, b) => a.allInPct - b.allInPct)[0];
  const allNegLev = !!cheapestLoan && goingIn > 0 && cheapestLoan.allInPct > goingIn;
  const canCash = spendable(game, parcels).total >= Math.round(offerPrice * 1.02);
  const picked = (() => {
    if (product === null) {
      if (allNegLev && canCash) return "cash";
      const first = productChoices.find((p) => quoteOf(p.id).principal > 0);
      return first?.id ?? "cash";
    }
    const direct = quoteOf(product);
    if (product === "cash" || direct.principal > 0) return product;
    const alt = productChoices.find((p) => quoteOf(p.id).principal > 0);
    return alt?.id ?? "cash";
  })();
  const max = quoteOf(picked);
  // under the smallest cheque a desk writes, the dial is all cash — buyQuote says the same
  const principal = Math.round(max.principal * lev) < 100_000 ? 0 : Math.round(max.principal * lev);
  const equity = max.equity > 0 && lev >= 0.999
    ? max.equity
    : offerPrice - principal + Math.round(offerPrice * 0.02)
      + (max.capPremium ? Math.round(max.capPremium * lev) : 0)
      + Math.round((max.pointsFee ?? 0) * lev)
      - (max.deposits ?? 0);
  // THE RESOLVED RECORD, for the same reason buyQuote uses one: the static
  // table is the lot at generation, not what is standing on it today.
  const rec = resolveRec(parcels, game, bbl);
  // IN PLACE, NOT ESTIMATED. This is the screen the deal is decided on —
  // going-in cap, debt yield, year-one cash flow, cash-on-cash — and every one
  // of those numbers was computed off `noiAfterTaxYr`, which cannot see a rent
  // roll. Measured over 3,195 buildings that estimate ran 20 points of
  // occupancy above the real roll, worst on the highest quoted yields, so the
  // cash-on-cash on this panel was a forecast of income the building did not
  // earn. It is the disclosed roll now — the same roll the lender sizes on and
  // the same roll the deed conveys.
  const ip = rec ? inPlace(rec, game, bbl, offerPrice) : null;
  const fromFund = !!(game.fundPay && game.fund && !game.fund.settled
    && game.month <= game.fund.investEndM);
  // The vehicle calls capital as the deal closes (executePurchase): its purse
  // is the cash it holds plus the commitments still to call.
  // Earnest money already posted under contract comes back at the table
  // (acquire.ts closeAgreed), so it counts toward the cheque.
  const postedDeposit = game.talks?.[bbl]?.agreed ? (game.talks[bbl].deposit ?? 0) : 0;
  const closePurse = (fromFund ? (game.fund?.cash ?? 0) + (game.fund?.uncalled ?? 0) : spendable(game, parcels).total) + postedDeposit;
  const noi = ip?.noi ?? 0;
  const stab = rec ? proFormaNOIYr(rec, game.econ, ip?.h?.condition ?? initialCondition(rec), offerPrice) : 0;
  // ACTUAL first-year debt service — amortizing payment for amortizing paper,
  // coupon-only for IO periods — not the IO approximation for everything.
  // Key off `picked` (the desk the numbers describe), not the chip the player
  // last clicked when that chip would not quote.
  const prodDef = PRODUCTS.find((pp) => pp.id === picked);
  const annualDs = principal > 0
    ? (prodDef && prodDef.ioM > 0
      ? principal * (max.ratePct / 100)
      : annualPayment(principal, max.ratePct, prodDef?.amortYears ?? 30))
    : 0;
  const dscrNow = annualDs > 0 ? noi / annualDs : null;
  const goingInPct = offerPrice > 0 ? (noi / offerPrice) * 100 : 0;
  const dy = principal > 0 ? (noi / principal) * 100 : 0;
  const cf = noi - annualDs;
  const coc = equity > 0 ? (cf / equity) * 100 : 0;
  const negLev = principal > 0 && goingInPct < max.ratePct;
  const stabPct = offerPrice > 0 ? (stab / offerPrice) * 100 : 0;
  return (
    <div className="deal-stages">
      <div className="deal-stage-tabs" role="tablist" aria-label="Close the deal">
        {([
          ["thesis", "Thesis"],
          ["structure", "Structure"],
          ["commit", "Commit"],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={stage === id}
            className={"deal-stage-tab" + (stage === id ? " on" : "")}
            onClick={() => setStage(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {stage === "thesis" && (
        <div className="deal-stage" role="tabpanel">
          <div className="hint">Unlevered at {usd(offerPrice)}.</div>
          <div className="grid">
            {rec && rec.class !== "land" && rec.bldgArea > 0 ? (
              <>
                <Row k={ip?.disclosed ? "In-place NOI / yr" : "NOI / yr (mkt est.)"} v={usd(noi)} bad={noi < 0} />
                {ip?.disclosed && <Row k="Occupancy (in place)" v={`${(ip.occ * 100).toFixed(0)}%`} bad={ip.occ < 0.75} />}
                <Row k="Going-in cap" v={`${goingInPct.toFixed(2)}%`} strong />
                <Row k={<Gloss term="stabilised pro-forma">Stabilised pro-forma</Gloss>} v={`${usd(stab)} · ${stabPct.toFixed(2)}%`} />
              </>
            ) : (
              <Row k="Price" v={usd(offerPrice)} strong />
            )}
          </div>
          <div className="btn-row" style={{ marginTop: 10 }}>
            <button type="button" className="btn btn-buy" onClick={() => setStage("structure")}>
              Structure the stack ▸
            </button>
          </div>
        </div>
      )}

      {stage === "structure" && (
        <div className="deal-stage" role="tabpanel">
          {/* one desk per line: as wrapping pills the quotes did not line up
              and All cash landed wherever the last one broke */}
          <div className="btn-row lender-list" style={{ marginTop: 4 }}>
            {productChoices.map((p) => {
              const pq = quoteOf(p.id);
              const desk = lenderByName(game, p.lender);
              const sp = desk ? stayingPower(game, desk) : null;
              return (
                <button
                  key={p.id}
                  className={"btn" + (picked === p.id ? " btn-on" : "")}
                  disabled={pq.principal <= 0}
                  style={pq.principal <= 0 ? { opacity: 0.42, cursor: "not-allowed" } : undefined}
                  title={pq.principal <= 0
                    ? `${p.label}: no quote. ${p.blurb}`
                    : `${p.blurb}\n${(p.maxLTV * 100).toFixed(0)}% max LTV · ${p.amortYears}-yr amort · ${Math.round(p.termM / 12)}-yr term${sp ? `\nStaying power: ${sp.word}. ${sp.why}` : ""}`}
                  onClick={() => setProduct(p.id)}
                >
                  {p.label}{pq.principal > 0 ? ` · ${pq.ratePct.toFixed(2)}% (${pq.allInPct.toFixed(2)}% all in) · ${(pq.ltvCap * 100).toFixed(0)}% sheet` : " · won't quote"}
                  {sp && sp.word !== "solid" && pq.principal > 0 ? <span style={{ marginLeft: 6, color: sp.word === "at risk" ? "#c0563e" : "#b8962e" }}>· {sp.word}</span> : null}
                </button>
              );
            })}
            <button className={"btn" + (picked === "cash" ? " btn-on" : "")} title="No debt" onClick={() => setProduct("cash")}>
              All cash
            </button>
          </div>
          {advice && <div className="hint" style={{ marginTop: 6 }}>{advice}</div>}
          {allNegLev && (
            <div className="hint neg" style={{ marginTop: 4 }}>
              Negative leverage on all lenders: cheapest {cheapestLoan!.allInPct.toFixed(2)}% all-in vs {goingIn.toFixed(2)}% going-in yield.{canCash ? " Defaulted to all cash." : ""}
            </div>
          )}
          {max.principal > 0 ? (
            <Slider
              label="Leverage"
              value={lev}
              min={0}
              max={1}
              step={0.02}
              onChange={setLev}
              format={() => (principal > 0 ? `${usd(principal)} · ${((principal / Math.max(1, offerPrice)) * 100).toFixed(0)}% LTV` : "all cash")}
              marks={[{ at: 0, label: "cash" }, { at: 0.5, label: "half" }, { at: 1, label: "max" }]}
              hint={`${max.ratePct}% coupon${dscrNow ? ` · DSCR ${dscrNow.toFixed(2)}` : ""}`}
            />
          ) : null}
          {max.principal > 0 && (
            <div className="hint">
              {max.bind === "guarantor"
                ? `${max.guarantorWhy ?? "Capped by sponsor balance sheet."} Recourse: guarantor net worth must cover 50% of loan. Non-recourse lenders size on the asset only.`
                : max.bind === "appraisal"
                ? `Lender appraisal ${usd(max.appraised ?? 0)}; sized on ${usd(max.uwBasis ?? 0)} (lesser of appraisal and ${usd(offerPrice)}). `
                  + `${usd(max.overpay ?? 0)} above appraisal is all equity.`
                : max.bind === "ltv"
                ? `LTV-constrained: ${(max.ltvCap * 100).toFixed(0)}% max (${max.sheetWhy ?? "lender terms"}).`
                : max.bind === "dscr"
                  ? `DSCR-constrained: ${((max.principal / Math.max(1, offerPrice)) * 100).toFixed(0)}% LTV vs ${(max.ltvCap * 100).toFixed(0)}% max. `
                    + `${max.ratePct}% coupon at ${max.uwDscr.toFixed(2)}x min DSCR.`
                  : max.bind === "dy"
                    ? `Debt-yield constrained: ${(max.ltvCap * 100).toFixed(0)}% max LTV not reached.`
                    : `${((max.principal / Math.max(1, offerPrice)) * 100).toFixed(0)}% LTV vs ${(max.ltvCap * 100).toFixed(0)}% max (${max.sheetWhy ?? "lender terms"}) · ${max.advanceWhy ?? "reduced by credit conditions and track record"}.`}
            </div>
          )}
          {max.principal <= 0 && (
            <div className="hint">{picked === "cash" ? "All cash."
              : max.bind === "condition" ? "Lender declines on property condition. All cash or another lender."
              : max.bind === "closed" ? "Lender not quoting. All cash or another lender."
              : max.bind === "minloan" ? "Supportable loan below $100K minimum. All cash only."
              : "Income supports no loan. All cash only."}</div>
          )}
          {/* THE ANSWER FOR THE STACK ON THE DIAL: what the money costs all
              in against what the building earns going in. Positive leverage
              or negative, in one line, before the commit stage asks you to
              sign. */}
          {principal > 0 && rec && rec.class !== "land" && rec.bldgArea > 0 && (
            <Verdict
              label={`${productChoices.find((p) => p.id === picked)?.label ?? "Debt"} · ${usd(principal)} · ${((principal / Math.max(1, offerPrice)) * 100).toFixed(0)}% LTV`}
              value={`${max.allInPct.toFixed(2)}% all-in`}
              tone={negLev || cf < 0 ? "bad" : dscrNow !== null && dscrNow < 1.25 ? "warn" : "good"}
              note={(negLev
                ? `Negative leverage vs ${goingInPct.toFixed(2)}% going-in cap.`
                : `Positive leverage vs ${goingInPct.toFixed(2)}% going-in cap.`)
                + (dscrNow !== null ? ` DSCR ${dscrNow.toFixed(2)}x` : "")
                + ` · yr-1 cash-on-cash ${coc.toFixed(1)}% on ${usd(equity)} equity.`}
            />
          )}
          <div className="btn-row" style={{ marginTop: 10 }}>
            <button type="button" className="btn" onClick={() => setStage("thesis")}>◂ Thesis</button>
            <button type="button" className="btn btn-buy" onClick={() => setStage("commit")}>
              Review &amp; commit ▸
            </button>
          </div>
        </div>
      )}

      {stage === "commit" && (
        <div className="deal-stage" role="tabpanel">
          <div className="grid">
            {rec && rec.class !== "land" && rec.bldgArea > 0 && (
              <>
                <Row k="Going-in cap" v={`${goingInPct.toFixed(2)}%`} bad={negLev} />
                <Row k="Coupon" v={`${max.ratePct.toFixed(2)}%${negLev ? " — negative leverage" : ""}`} bad={negLev}
                  why={prodDef && max.principal > 0 ? <WhyButton id={loanWhy(game, prodDef.lender)} lead={loanLead(game, prodDef.lender, max.ratePct)} /> : undefined} />
                {principal > 0 && <Row k={<Gloss term="debt yield">Debt yield</Gloss>} v={`${dy.toFixed(1)}%`} bad={dy < 8} />}
                {principal > 0 && <Row k="Annual debt service" v={`−${usd(annualDs)}${prodDef && prodDef.ioM > 0 ? " (interest-only)" : ` (${prodDef?.amortYears ?? 30}-yr am)`}`} />}
                {prodDef && (
                  <Row
                    k="Terms"
                    v={`${prodDef.ioM ? `${Math.round(prodDef.ioM / 12)}-yr IO, ` : ""}${prodDef.amortYears}-yr amort, `
                      + `${Math.round(prodDef.termM / 12)}-yr term, ${(prodDef.maxLTV * 100).toFixed(0)}% max LTV`}
                  />
                )}
                <Row k="Year-1 cash flow" v={usd(cf)} bad={cf < 0} />
                <Row k={<Gloss term="cash-on-cash">Cash-on-cash</Gloss>} v={`${coc.toFixed(1)}%`} bad={coc < 0} />
              </>
            )}
            <Row k="Equity to close" v={postedDeposit > 0 ? `${usd(equity)} · ${usd(postedDeposit)} already posted` : usd(equity)} strong bad={equity > closePurse} />
          </div>
          {!fromFund && <LocSplitHint need={equity} game={game} parcels={parcels} />}
          <div className="btn-row">
            <button type="button" className="btn" onClick={() => setStage("structure")}>◂ Structure</button>
            <button
              className="btn btn-buy"
              disabled={equity > closePurse}
              onClick={() => {
                const prod = principal <= 0 ? "cash" : picked;
                const l = principal <= 0 ? 1 : lev;
                if (off) buyOff(bbl, prod as never, l, bid);
                else useStore.getState().closeDeal(bbl, prod, l);
              }}
            >
              {closeLabel ?? `Close at ${usd(offerPrice)}`} · {usd(equity)} equity
            </button>
            {!off && (
              <button className="btn" onClick={() => useStore.getState().walkAway(bbl)}
                title="Terminate contract. Seller keeps deposit.">
                Terminate
              </button>
            )}
          </div>
          {equity > closePurse && (
              <div className="hint">
                Short {usd(equity - closePurse)}
                {fromFund
                  ? " · call capital or use firm cash (Capital → Debt)."
                  : " · raise cash or free line capacity."}
              </div>
            )}
        </div>
      )}
    </div>
  );
}

// Refinancing is a market, not a button: two products, what each will
// actually advance today, and a dial for how much of it you take.
/**
 * NAME YOUR ASK FROM THE ROW.
 *
 * The List button on the portfolio listed at appraisal plus two per cent and
 * told you, in a tooltip, to open the record if you wanted your own number.
 * That is the most consequential number in the transaction being chosen for
 * you by a button — and the record it points at has the slider, so the machine
 * to do this properly already existed one screen away.
 *
 * The two fees are on the two buttons, in dollars, for the same reason they are
 * on the record: a decision with two numbers on it is a decision, and a
 * decision with an adjective on it is a paragraph.
 */
/**
 * OFFER A GROUND LEASE FROM THE BOOK — same job as LandDesk's "Or ground-lease
 * it" block, sized for a portfolio expand row so vacant dirt does not force a
 * trip through Property → Build.
 */
export function GroundLeaseSection({ bbl, onDone }: { bbl: string; onDone?: () => void }) {
  const game = useHeldGame(bbl);
  const parcels = useStore((s) => s.parcels)!;
  const { groundLease, pullGroundOffer } = useStore.getState();
  const h = game.holdings[bbl];
  const rec = resolveRec(parcels, game, bbl);
  const [years, setYears] = useState(GROUND_TOWER_TERM_MIN);
  const [review, setReview] = useState<GroundReview>("fixed");
  if (!h || !rec) return null;
  const vacant = rec.class === "land" && (rec.bldgArea ?? 0) === 0
    && !(game.built?.[bbl]?.bldgArea) && !h.groundLeased && !game.groundLeases?.[bbl];
  const offer = h.groundOffer;
  const oq = offer && vacant
    ? groundLeaseQuote(game, parcels, bbl, offer.years, offer.review ?? "fixed") : null;
  const blocked = !vacant
    ? "Vacant land only."
    : h.sale ? "Delist first."
    : game.developments[bbl] ? "Under construction."
    : game.merged?.[bbl] ? "Part of an assemblage; lease the whole site."
    : h.loan ? "Pay off the mortgage first."
    : game.facility?.bbls?.includes(bbl)
      ? "Release from the credit facility first."
      : null;
  const q = vacant && !offer && !blocked
    ? groundLeaseQuote(game, parcels, bbl, years, review) : null;

  if (offer) {
    return (
      <div style={{ padding: "8px 2px" }}>
        <div className="deal-head">Offered for ground lease</div>
        <div className="grid">
          <Row k="Offered since" v={`${monthLabel(offer.sinceM)}${game.month - offer.sinceM > 0 ? ` · ${game.month - offer.sinceM} mo` : ""}`} />
          <Row k="Structure" v={GROUND_REVIEW_LABEL[offer.review ?? "fixed"]} />
          <Row k="Current terms" v={oq
            ? `${usd(oq.rentYr)} / yr · ${offer.years} years · ${oq.reviewNote}`
            : "—"} strong />
          {oq && <Row k="Net cash income" v={`${usd(oq.cashFlow.netRentYr)} / yr`} strong />}
        </div>
        <div className="hint">
          Lessees are scarce. Signs at terms quoted in the month one arrives.
        </div>
        <div className="btn-row" style={{ marginTop: 6 }}>
          <button className="btn" onClick={() => { pullGroundOffer(bbl); onDone?.(); }}>
            Withdraw offer
          </button>
        </div>
      </div>
    );
  }

  if (blocked || !q) {
    return (
      <div style={{ padding: "8px 2px" }}>
        <div className="deal-head">Ground lease</div>
        <div className="hint">{blocked ?? "No lessee demand."}</div>
      </div>
    );
  }

  return (
    <div style={{ padding: "8px 2px" }}>
      <div className="deal-head">Offer a ground lease</div>
      <div className="btn-row" style={{ marginBottom: 8 }}>
        {(["fixed", "cpi", "fmv"] as GroundReview[]).map((r) => (
          <button key={r} className={"btn" + (review === r ? " btn-on" : "")} onClick={() => setReview(r)}>
            {GROUND_REVIEW_LABEL[r]}
          </button>
        ))}
      </div>
      <Slider
        label="Term"
        value={years}
        min={GROUND_TERM_MIN}
        max={99}
        step={1}
        onChange={setYears}
        format={(v) => `${v} years`}
        hint={q.reviewNote}
      />
      <div className="grid">
        <Row k="Gross ground rent" v={`${usd(q.cashFlow.grossRentYr)} / yr · ${q.capPct}% of land value`} />
        <Row k="Owner expenses" v="$0 tax · $0 opex · $0 TI · $0 leasing · lessee pays" />
        <Row k="Net cash income" v={`${usd(q.cashFlow.netRentYr)} / yr`} strong />
        <Row k="At term" v={q.padOnly
          ? "Land reverts; improvements only via leasehold buyout"
          : `Vacant improvement reverts · ${monthLabel(game.month + years * 12)}`} />
      </div>
      <div className="hint">
        Absolute net. {q.termNote} Fixed: faster to place. FMV: lower rent, slower.
      </div>
      <div className="btn-row" style={{ marginTop: 6 }}>
        <button className="btn btn-buy" onClick={() => { groundLease(bbl, years, review); onDone?.(); }}>
          Offer a {years}-year {GROUND_REVIEW_LABEL[review].toLowerCase()} ground lease
        </button>
      </div>
    </div>
  );
}

export function ListSection({ bbl, appraisal, onDone }: { bbl: string; appraisal: number; onDone: () => void }) {
  const game = useHeldGame(bbl);
  const listSale = useStore((s) => s.listSale);
  const [ask, setAsk] = useState(Math.round(appraisal * 1.02));
  const quiet = quietFeeRate(game);
  const over = appraisal > 0 ? ask / appraisal - 1 : 0;
  const leasedFee = !!game.groundLeases?.[bbl];
  const [insAccept, setInsAccept] = useState("");
  const [insDecline, setInsDecline] = useState("");
  const instr = instructionsFrom(insAccept, insDecline);
  return (
    <div style={{ padding: "8px 2px" }}>
      {leasedFee && (
        <div className="hint" style={{ marginBottom: 8 }}>
          Leased fee: ground rent + reversion. Ground lease conveys with the deed.
        </div>
      )}
      <Slider
        label="Your ask"
        value={ask}
        min={Math.round(appraisal * 0.7)}
        max={Math.round(appraisal * 1.6)}
        step={Math.max(1000, Math.round(appraisal / 400 / 1000) * 1000)}
        onChange={setAsk}
        format={(v) => `${usd(v)} · ${over >= 0 ? "+" : ""}${(over * 100).toFixed(0)}% vs appraisal`}
        hint={over > 0.12
          ? "Above appraisal: slow sale; stale listings lose value."
          : over < -0.06
            ? "Below appraisal: fast sale."
            : "At market."}
      />
      <InstructionFields accept={insAccept} decline={insDecline} setAccept={setInsAccept} setDecline={setInsDecline} />
      <div className="btn-row" style={{ marginTop: 6 }}>
        <button className="btn btn-buy" disabled={instr.bad} onClick={() => { listSale(bbl, ask, "marketed", instr.ins ?? undefined); onDone(); }}>
          Marketed sale · less {usd(Math.round(ask * 0.025))} fee
        </button>
        <button className="btn" disabled={instr.bad} onClick={() => { listSale(bbl, ask, "quiet", instr.ins ?? undefined); onDone(); }}>
          Off-market sale · {quiet <= 0.0001 ? "no fee" : `less ${usd(Math.round(ask * quiet))} fee`}
        </button>
      </div>
      <div className="hint">
        {quiet <= 0.0001
          ? "Off-market fee: none (relationships)."
          : `Off-market fee ${(quiet * 100).toFixed(2)}%. Falls with more firms traded; rises with a lowball reputation.`}
      </div>
    </div>
  );
}
