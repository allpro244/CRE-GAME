// The game's chrome: a parcel card docked to the map, and full-page views
// for Portfolio / Deals / Market — big rooms, not side-panel squints.
import { useEffect, useMemo, useState, Fragment} from "react";
import { useStore } from "@/state/store";
import { CLASS_COLOR, CLASS_LABEL } from "@/data/types";
import type { ParcelRecord, ParcelTable } from "@/data/types";
import { monthLabel, CREDIT_LABEL, OPS_SERVICE, OPS_PLAN, serviceSpec, planSpec } from "@/engine/types";
import type { Approach, BuiltClass, Contract, DevUse, EconHistoryPoint, GameState, Holding } from "@/engine/types";
import {
  assetValue, initialCondition, holdingValue, monthlyNOI, marketRentPsfYr, managedRentPsfYr,
  occupancy, noiYr, holdingNOIYr, renovationCost, resolveRec, appraise, propertyTaxYr, useRentPsfYr,
  rollQualitySpread, operatingStatement, recoveryOf, noiAfterTaxYr, netWorth, remainingAbatement, landPsfNow, landValue,
  physicalOcc as physicalOccupancy,
} from "@/engine/value";
import { planDevelopment, constructionQuotes, devMix, PROGRAMS, programCost, farMaxFor, maxFloorsFor, maxRetailShare, retailWantsMixed, demolitionCost, unitRange, suiteSfForUnits, SUITE_BOUNDS } from "@/engine/dev";
import { buyQuote, assemblagePressure, saleTaxQuote } from "@/engine/actions";
import { sellerOf, sellerProfile, MAX_TALKS, DEPOSIT_PCT } from "@/engine/acquire";
import { MILESTONES } from "@/engine/sim";
import { genRentRoll, isCommercial, vacantSf, walt, loiSigningCost, exclusiveFeeRate, notReadySf, unitStatus, unitCount, suiteSf, useSuiteSf, avgUnitSf, buyoutQuote, depositsHeld, BUYOUT_PREMIUM } from "@/engine/leasing";
import { dscr, ltv, rateCapCost, refiQuotes, PRODUCTS, prepayPenalty } from "@/engine/debt";
import { lenderHealth, capitalRatio, lenderBlurb, targetCapital, CONSTRUCTION_LENDER } from "@/engine/lenders";
import { noteBid, payoffQuote } from "@/engine/notes";
import { depositFor as auctionDepositFor } from "@/engine/auction";
import { collateralAsIs } from "@/engine/value";
import { firmName, firmShort } from "@/engine/firm";
import { replacementCost, cityValueToReplacement } from "@/engine/dev";
import { workoutMood } from "@/engine/workout";
import { portfolioQuote } from "@/engine/portfolio";
import { locLimit, locRate, locAvailable } from "@/engine/credit";
import { blockReport } from "@/engine/demand";
import { NATURAL_VAC, RENT_BASE, SECTOR_LABEL, CITY_STOCK } from "@/engine/market";
import {
  submarkets, legVacancy, legRent, legDemand, deliverySchedule,
  projectVacancy, marketBalance, monthsOfSupply,
} from "@/engine/space";
import { LineChart, BarChart, Gauge, type BarGroup } from "./Chart";
import { isMixedUse, mixLabel, mixOf, uses as usesOf, useSf, USE_WORD } from "@/engine/mix";

/** What to call a building: its dominant use, or "Mixed-Use" when it has none. */
function useLabel(rec: { class: string; bbl: string; floors: number; unitsRes: number; bldgArea: number; mix?: Record<string, number> }): string {
  if (rec.class === "land") return CLASS_LABEL.land;
  return isMixedUse(rec as never) ? "Mixed-Use" : CLASS_LABEL[dominantOf(rec as never)];
}
function dominantOf(rec: never): "office" | "retail" | "multifamily" | "industrial" {
  return usesOf(rec)[0] ?? "office";
}
const devUseLabel = (u: string) => (u === "mixed" ? "Mixed-Use" : CLASS_LABEL[u as "office"]);

/**
 * Physical occupancy of the WHOLE building. It used to be implemented here;
 * it now lives in value.ts, because the engine records it every quarter and
 * one quantity does not get two implementations. The `never` shim keeps the
 * ~7 existing call sites in this file, which pass `rec as never`, untouched.
 */
function physicalOcc(rec: never, h: { tenants: { sf: number }[]; occ?: number }): number {
  return physicalOccupancy(rec as never as ParcelRecord, h as never as Holding);
}

/**
 * WHAT THE SELLER HAS DISCLOSED, shaped like a holding so every reader that
 * already knows how to price a building you own can price one you are looking
 * at — using the SAME functions and therefore producing the SAME numbers.
 *
 * The owner's complaint, exactly: "the market NOI and occupancy should be the
 * same after you close on the property." They were not. The tape quoted a
 * MARKET occupancy — the model's opinion of how full a building like this one
 * ought to be — and the deed handed over an actual rent roll. Two honest
 * numbers, and the one on screen while you were deciding was the wrong one,
 * which is why a building appeared to lose value the moment it became yours.
 *
 * The roll now travels with the listing (see Listing.roll and refreshListings),
 * so there is a real answer available before the bid. This wraps it in the
 * shape holdingNOIYr and physicalOcc expect, with `assessed` set to the price
 * you would actually pay, because that is what the tax bill would be struck on
 * once you owned it.
 *
 * Returns null when there is nothing disclosed — an off-market lot you cold
 * -called about has no offering memorandum, and finding out what is in the
 * building is exactly the risk you are taking.
 */
function disclosed(game: GameState, bbl: string, price?: number): Holding | null {
  const parcels = useStore.getState().parcels;
  const rec = parcels ? resolveRec(parcels, game, bbl) : null;
  if (!rec || rec.class === "land" || !rec.bldgArea) return null;
  const li = game.listings.find((l) => l.bbl === bbl);
  const px = price ?? li?.ask ?? game.approaches[bbl]?.ask ?? assetValue(rec, game.econ, gradeOf(game, rec));
  const distress = !!li?.distress;
  const cond = li?.cond ?? (distress ? "worn" : gradeOf(game, rec));
  const h = {
    bbl, boughtM: game.month, costBasis: px, assessed: px,
    loan: null, condition: cond, tenants: [] as never[], cfHistory: [],
  } as unknown as Holding;
  // A MARKETED BUILDING'S ROLL WAS WRITTEN THE DAY IT CAME TO MARKET, and that
  // is the roll the deed conveys — so read it rather than writing a fresh one.
  // Regenerating here looked identical and was not: genRentRoll stamps lease
  // start and expiry dates off s.month, so a listing written in month 5 and
  // previewed in month 40 produced a roll with the same tenants on different
  // paper. Measured: 39 of 200 purchases differed on occupancy and 84 on NOI.
  if (li?.roll) {
    h.tenants = li.roll as never;
    if (li.occ !== undefined) h.occ = li.occ;
    return h;
  }
  // Nothing marketed, so this is a door you knocked on. Deterministic per
  // building — see genRentRoll — with settle=false so looking at a building
  // never moves money, drawn from a private stream so looking never re-rolls
  // the world, and identical to what the deed will hand over.
  genRentRoll(game, rec, h, distress, false);
  return h;
}
import { sponsorStanding } from "@/engine/sponsor";
import { marketAppetite, markRival, ownerOf, rivalCondition, gradeOf, assetGrade } from "@/engine/rivals";
import { compFlows, compStats, portfolioIndustries } from "@/engine/comps";
import { INDUSTRY_LABEL, SECTORS } from "@/engine/market";
import { specSuiteQuote, blendExtendQuote, useVacantSf, leasableUses, renewalIntent } from "@/engine/leasing";
import { leasingOdds } from "@/engine/absorption";
import { groundLeaseQuote, mergeCost } from "@/engine/actions";
import { plateEfficiency } from "@/engine/value";
import { varianceQuote } from "@/engine/zoning";
import { usd, sf, pct } from "./format";
import Slider from "./Slider";
import StaffPage from "./StaffPage";

// Appraisals are opinions with a range, not the true number.
function band(bbl: string, value: number): string {
  const a = appraise(bbl, value);
  return `${usd(a.lo)} – ${usd(a.hi)}`;
}
function apMid(bbl: string, value: number): number {
  return appraise(bbl, value).mid;
}

export default function GamePanels() {
  const game = useStore((s) => s.game);
  const page = useStore((s) => s.page);
  const setPage = useStore((s) => s.setPage);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Escape") { setPage("none"); return; }
      const st = useStore.getState();
      if (e.code === "Space") { e.preventDefault(); st.advance(); }
      else if (e.code === "KeyY") st.advanceYear();
      else if (e.code === "KeyN") st.advanceUntil();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPage]);
  if (!game) return null;
  const title = page === "portfolio" ? "Portfolio"
    : page === "deals" ? "The Deals Desk"
    : page === "books" ? "The Books"
    : page === "news" ? "The Tape"
    : page === "leasing" ? "Leasing & Occupancy"
    : page === "property" ? "Property"
    : page === "saves" ? "Saved Games"
    : page === "economy" ? "The Economy"
    : page === "research" ? "Research"
    : page === "notes" ? "The Note Desk"
    : page === "staff" ? "The Desk"
    : page === "settings" ? "Settings"
    : "The Marketplace";
  return (
    <>
      <ParcelPanel />
      {page !== "none" && (
        <div className="page-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setPage("none"); }}>
          <div className="page">
            <div className="page-head">
              <div className="page-title">{title}</div>
              <button className="panel-close" onClick={() => setPage("none")}>×</button>
            </div>
            {page === "portfolio" && <PortfolioPage />}
            {page === "deals" && <DealsPage />}
            {page === "market" && <MarketPage />}
            {page === "research" && <ResearchPage />}
            {page === "notes" && <NotesPage />}
            {page === "economy" && <EconomyPage />}
            {page === "books" && <BooksPage />}
            {page === "news" && <NewsPage />}
            {page === "saves" && <SavesPage />}
            {page === "leasing" && <LeasingPage />}
            {page === "property" && <PropertyPage />}
            {page === "staff" && <StaffPage />}
            {page === "settings" && <SettingsPage />}
          </div>
        </div>
      )}
      <DecisionModal />
      <AuctionModal />
      <DefaultNoticeModal />
      {/* yield to the saves page — this used to paint over it at the same
          z-index, leaving every control on it visible and dead */}
      {game.gameOver && page !== "saves" && <GameOverPage />}
    </>
  );
}

/**
 * THE JULY AUCTION — one card, once a year.
 *
 * The docket goes up when the calendar lands on July and the hammer falls on
 * the next tick, so this modal exists for exactly one month. Everything on it
 * is as-is: no diligence, no financing, ten per cent down the day you
 * register. Passing costs nothing but the bargain — "watch from the back"
 * dismisses it and the sale reports itself through the news like any other
 * thing that happened in this town without you.
 */
/**
 * THE LETTER FROM THE LENDER.
 *
 * A foreclosure in this engine already takes a year and a bit — six months of
 * notice, then a filing, then the next July docket at least eight months out —
 * and none of that reached the player as anything but one line of news in a
 * feed six months earlier. Auto-advance ran straight past it. The owner asked
 * for the notice to be a pop-up, in advance, so there is time to sell instead
 * of watching it go to the steps, and that is exactly how it works in life: the
 * default letter arrives long before the filing, and most of what happens next
 * is decided in that window.
 *
 * It fires ONCE per building per stage. Dismissing it is free — the file is on
 * the property page and in the attention list either way — and the popup
 * opt-out is honoured, because a player who has turned cards off has said what
 * they want.
 */
function DefaultNoticeModal() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels);
  const popupsOff = useStore((s) => s.popupsOff);
  const setPage = useStore((s) => s.setPage);
  const select = useStore((s) => s.select);
  const focus = useStore((s) => s.focus);
  const { serviceWorkout } = useStore.getState();
  const [seen, setSeen] = useState<Record<string, boolean>>({});
  if (!parcels || game.gameOver || popupsOff) return null;
  const open = Object.values(game.workouts ?? {})
    .filter((w) => !seen[`${w.bbl}:${w.stage}`])
    .sort((a, b) => (a.saleM ?? a.decideM) - (b.saleM ?? b.decideM))[0];
  if (!open) return null;
  const rec = resolveRec(parcels, game, open.bbl);
  const h = game.holdings[open.bbl];
  if (!rec || !h?.loan) return null;

  const filed = open.stage === "foreclosure";
  const deadline = open.saleM ?? open.decideM;
  const monthsLeft = Math.max(0, deadline - game.month);
  const value = holdingValue(rec, game.econ, h, game.month);
  const equity = value - open.cure;
  const monthly = Math.round(h.loan.monthlyPmt * 1.15);
  // What the REST of the book throws off, which is the whole question the
  // owner asked: can the other buildings carry this one while you sell it?
  const otherCF = Object.values(game.holdings)
    .filter((x) => x.bbl !== open.bbl)
    .reduce((a, x) => {
      const r = resolveRec(parcels, game, x.bbl);
      return a + (r ? monthlyNOI(r, game.econ, x, game.month) : 0);
    }, 0);
  const dismiss = () => setSeen({ ...seen, [`${open.bbl}:${open.stage}`]: true });

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 660 }}>
        <div className="modal-kicker">{open.lender} · {monthLabel(game.month)}</div>
        <div className="modal-title">
          {filed ? `They have filed on ${rec.address}` : `Notice of default — ${rec.address}`}
        </div>
        <div className="modal-sub">
          {filed
            ? `It is down for the ${monthLabel(deadline)} auction. From here a payment is not a cure — it takes the
               arrears in full, a deed in lieu, or the hammer.`
            : `${open.cause === "balloon" ? "The loan has matured and there is nothing to repay it with."
               : open.cause === "covenant" ? "The building has breached its covenants."
               : "The payments have stopped."} You have ${monthsLeft} month${monthsLeft === 1 ? "" : "s"} before
               ${open.lender} can file. A building takes six to nine months to sell properly, so this is the window.`}
        </div>
        <div className="grid" style={{ marginTop: 10 }}>
          <Row k="What they want" v={usd(open.cure)} strong />
          <Row k="The building is worth" v={usd(value)} />
          <Row k={equity >= 0 ? "Your equity in it" : "It is under water by"} v={usd(Math.abs(equity))} bad={equity < 0} />
          <Row k="Cash on hand" v={usd(game.cash)} bad={game.cash < open.cure} />
          <Row k="The rest of the book earns" v={`${usd(otherCF)} / mo`} />
          <Row k="Keeping this one current costs" v={`${usd(monthly)} / mo at the default rate`}
               bad={monthly > otherCF} />
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          {equity > 0
            ? `There is equity here. Selling it yourself beats the steps by a wide margin — the auction is a legal
               process with a calendar and it gets less than a distress sale does.`
            : `There is no equity left. A deed in lieu hands it back with a smaller mark than a foreclosure and no
               deficiency, which is usually the right answer on paper like this.`}
          {!filed && otherCF > monthly
            ? ` The rest of the book covers the payment ${(otherCF / Math.max(1, monthly)).toFixed(1)} times over —
                you can carry it while you find a buyer.`
            : ""}
        </div>
        <div className="btn-row" style={{ marginTop: 12, flexWrap: "wrap" }}>
          {!filed && !open.servicing && (
            <button className="btn btn-primary" onClick={() => { serviceWorkout(open.bbl, true); dismiss(); }}>
              Keep it current · {usd(monthly)}/mo
            </button>
          )}
          <button className="btn" onClick={() => { select(open.bbl); focus(open.bbl, true); setPage("property"); dismiss(); }}>
            Open the file
          </button>
          <button className="btn" onClick={dismiss}>Not now</button>
        </div>
      </div>
    </div>
  );
}

function AuctionModal() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels);
  const focus = useStore((s) => s.focus);
  const auctionOpen = useStore((s) => s.auctionOpen);
  const popupsOff = useStore((s) => s.popupsOff);
  const setAuctionOpen = useStore((s) => s.setAuctionOpen);
  const { bidAuction } = useStore.getState();
  const [seenM, setSeenM] = useState(-1);
  const [bids, setBids] = useState<Record<string, string>>({});
  const a = game.auction;
  if (!parcels || game.gameOver || !a || game.month >= a.m) return null;
  // A player who has turned the card off still gets the auction — the docket
  // is on Marketplace and the bidding is the same — they just do not get it
  // thrown at them. Opening it from that page sets `auctionOpen`, and that
  // request beats BOTH of the reasons the sheet would otherwise stay shut:
  // having dismissed it once this month, and having turned the card off for
  // good. Asking for something and not getting it is the one outcome an
  // opt-out must never produce.
  if (auctionOpen) { /* they asked for it */ }
  else if (seenM === a.m || game.auctionQuiet || popupsOff) return null;

  const parsed: Record<string, number> = {};
  for (const [id, v] of Object.entries(bids)) {
    const n = Math.round(parseFloat(v) * 1e6);
    if (n > 0) parsed[id] = n;
  }
  const dep = a.lots.reduce((acc, l) => acc + (parsed[l.id] ? auctionDepositFor(l, parsed[l.id]) : 0), 0);
  const kindWord = (k: string) =>
    k === "note" ? "your foreclosure" : k === "yours" ? "YOUR BUILDING" : k === "bank" ? "bank foreclosure" : "receiver's lot";
  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 720 }}>
        <div className="modal-kicker">The county foreclosure auction · {monthLabel(game.month)}</div>
        <div className="modal-title">{a.lots.length} lot{a.lots.length === 1 ? "" : "s"} cross the block</div>
        <div className="modal-sub">
          As-is, where-is. Ten per cent down when you register, the balance at the hammer, no financing and no
          warranty. A lender's debt bids for it without cash — beat the debt and the lender is simply paid off,
          with anything above it going to the borrower who just lost the building.
        </div>
        <table className="tbl" style={{ marginTop: 8 }}>
          <thead>
            <tr><th>Lot</th><th>What it is</th><th className="num">Debt / floor</th><th className="num">Flyer est.</th><th className="num">Your bid ($M)</th></tr>
          </thead>
          <tbody>
            {a.lots.map((l) => (
              <tr key={l.id}>
                <td style={{ cursor: "pointer" }} onClick={() => focus(l.bbl, true)}>{l.address}</td>
                <td className={l.kind === "yours" ? "neg" : "dim"}>
                  {kindWord(l.kind)} · {l.holder}{l.borrower && l.kind !== "yours" ? ` v. ${l.borrower}` : ""}
                </td>
                <td className="num">{usd(l.kind === "receiver" ? l.upset : l.debt)}</td>
                <td className="num">{usd(l.est)}</td>
                <td className="num">
                  {l.kind === "yours"
                    ? <span className="dim" title="You do not bid on your own foreclosure — cure it, hand back the keys, or let the room decide.">—</span>
                    : <input className="mono" style={{ width: 72, textAlign: "right" }} inputMode="decimal"
                        placeholder={l.kind === "note" ? "credit" : (l.upset / 1e6).toFixed(2)}
                        value={bids[l.id] ?? ""}
                        onChange={(e) => setBids({ ...bids, [l.id]: e.target.value })} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="dim" style={{ marginTop: 6 }}>
          {Object.keys(parsed).length
            ? <>Deposits due today: <b className="mono">{usd(dep)}</b> against {usd(game.cash)} of cash.</>
            : a.lots.some((l) => l.kind === "note")
              ? "Your debt already bids on your own lots — enter a number only to protect the building above it."
              : "Enter a number to bid, or watch from the back. Most years, watching is right."}
        </div>
        <div className="modal-actions">
          <button className="btn btn-buy" disabled={!Object.keys(parsed).length || dep > game.cash}
            onClick={() => { bidAuction(parsed); setSeenM(a.m); setAuctionOpen(false); }}>
            Register bids{dep > 0 ? ` · ${usd(dep)} down` : ""}
          </button>
          <button className="btn" onClick={() => { setSeenM(a.m); setAuctionOpen(false); }}>Watch from the back</button>
          {/* THE CARD IS NOT THE AUCTION. Turning this off stops the interruption
              and nothing else — so it has to say, in the same breath, where the
              docket went and how to get the card back. An opt-out that leaves
              the player unable to find the thing again is a trap. */}
          {!game.auctionQuiet && (
            <button
              className="btn"
              title="The docket still runs every July. You just read it on your own time."
              onClick={() => {
                const st = useStore.getState();
                useStore.setState({ game: { ...st.game!, auctionQuiet: true } });
                setSeenM(a.m);
                setAuctionOpen(false);
              }}
            >
              Don't show me this again
            </button>
          )}
        </div>
        <div className="modal-queue">
          The hammer falls at the end of the month. Results come through the news, win or lose.
          {" "}The docket is always on <b>Marketplace</b> while it is live, and the switch for this card sits
          beside it there — so turning it off costs you nothing but the interruption.
        </div>
      </div>
    </div>
  );
}

// Some decisions don't wait their turn. A letter of intent and a live offer
// on your building both take the screen until you answer — they expire, and
// finding out later that one lapsed while you clicked past it is no fun.
function DecisionModal() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels);
  const popupsOff = useStore((s) => s.popupsOff);
  const { respondLoi, acceptOffer, declineOffer, select: goTo, setPage: openPage } = useStore.getState();
  const [deferred, setDeferred] = useState<Set<number>>(new Set());
  // the modal's counter sliders
  const [modalCounter, setModalCounter] = useState(false);
  const [mcRent, setMcRent] = useState(0);
  const [mcTi, setMcTi] = useState(0);
  // parcel ids are strings and do not fit in the numeric defer set; squeezing
  // them in by hashing the last four digits would collide silently
  const [dismissedCalls, setDismissedCalls] = useState<Set<string>>(new Set());
  if (!parcels || game.gameOver) return null;
  // THE MASTER SWITCH (Settings). Every one of these decisions also lives on
  // a page — letters on the Deals desk, offers on the portfolio, calls on the
  // Marketplace — so silencing the cards loses nothing but the interruption,
  // which is the point when you are simulating twenty years at a stretch.
  if (popupsOff) return null;

  const loi = game.agent ? undefined : game.lois.find((l) => !deferred.has(l.id));
  const offerBbl = deferred.has(-1) ? undefined : Object.keys(game.holdings).find((b) => game.holdings[b].sale?.offer);
  // an unsolicited call from a broker is a decision like any other
  const callBbl = Object.entries(game.approaches).find(
    ([b, a]) => a.inbound && !a.refused && a.ask && !dismissedCalls.has(b) && !game.holdings[b],
  )?.[0];
  if (!loi && !offerBbl && !callBbl) return null;

  if (!loi && callBbl) {
    const rec = resolveRec(parcels, game, callBbl);
    const a = game.approaches[callBbl];
    if (rec && a?.ask) {
      const cond = initialCondition(rec);
      const v = assetValue(rec, game.econ, cond);
      const noi = noiAfterTaxYr(rec, game.econ, cond, a.ask);
      const goingIn = a.ask > 0 ? (noi / a.ask) * 100 : 0;
      const over = v > 0 ? (a.ask / v - 1) * 100 : 0;
      return (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-kicker">A broker is on the phone</div>
            <div className="modal-title">{rec.address}</div>
            <div className="modal-sub">
              {useLabel(rec)} · {sf(rec.bldgArea)} · {rec.floors} fl · built {rec.yearBuilt}. Not on the market.
            </div>
            <div className="grid">
              <Row k="Their number" v={usd(a.ask)} strong />
              <Row k="vs appraisal" v={`${over >= 0 ? "+" : ""}${over.toFixed(0)}%`} bad={over > 8} />
              <Row k="NOI / yr" v={usd(noi)} />
              <Row k="Going-in cap" v={`${goingIn.toFixed(2)}%`} bad={goingIn < game.econ.indexRate + 1.6} />
              <Row k="Occupancy (mkt)" v={`${(occupancy(rec, game.econ) * 100).toFixed(0)}%`} />
              <Row k="Demand" v={`${rec.demandScore} / 100`} />
            </div>
            <div className="modal-actions">
              <button className="btn btn-buy" onClick={() => { openPage("none"); goTo(callBbl); setDismissedCalls((d) => new Set(d).add(callBbl)); }}>
                Open the file
              </button>
              <button className="btn" onClick={() => setDismissedCalls((d) => new Set(d).add(callBbl))}>
                Not now
              </button>
              <button
                className="btn"
                title="Brokers stop ringing you entirely. Turn it back on from the Marketplace page."
                onClick={() => {
                  const st = useStore.getState();
                  const g = { ...st.game!, brokersOff: true };
                  useStore.setState({ game: g });
                  setDismissedCalls((d) => new Set(d).add(callBbl));
                }}
              >
                Stop calling me
              </button>
            </div>
            <div className="modal-queue">
              Their client will listen for a few months. It stays on your desk until it lapses.
            </div>
          </div>
        </div>
      );
    }
  }

  if (loi) {
    const rec = resolveRec(parcels, game, loi.bbl);
    const h = game.holdings[loi.bbl];
    if (!rec || !h) return null;
    const market = managedRentPsfYr(rec, game.econ, h);
    const cost = loiSigningCost(loi, exclusiveFeeRate(h));
    const annual = loi.rentPsf * loi.sf;
    const live = game.lois.filter((l) => !deferred.has(l.id));
    const idx = live.findIndex((l) => l.id === loi.id) + 1;
    const short = Math.max(0, Math.ceil((cost - game.cash) / 1000) * 1000);
    const line = locAvailable(game, parcels);
    const fundable = short > 0 && short <= line;
    // No latch here on purpose. Every branch of respondLOI removes the letter
    // from the desk, so a double click is harmless — and a latch that only
    // cleared when the state changed was locking the whole modal any time an
    // action came back with an error instead of a new state.
    const act = (a: "accept" | "counter" | "decline") => respondLoi(loi.id, a, short > 0);
    const prevRent = loi.kind === "renewal" && loi.tenantIdx !== undefined ? h.tenants[loi.tenantIdx]?.rentPsf : undefined;
    const isFinal = loi.stage === "countered";
    return (
      <div className="modal-backdrop">
        <div className="modal">
          <div className="modal-kicker">{loi.kind === "renewal" ? "Renewal on the table" : "Letter of intent"}{isFinal ? " · their final answer" : ""}</div>
          <div className="modal-title">{loi.name}</div>
          <div className="modal-sub">
            {loi.sector} · credit {CREDIT_LABEL[loi.credit]} · wants {sf(loi.sf)} at {rec.address}
          </div>
          <div className="grid">
            {prevRent !== undefined && (
              <Row
                k="They pay today"
                v={`$${prevRent.toFixed(2)}/sf → offering $${loi.rentPsf.toFixed(2)} (${loi.rentPsf >= prevRent ? "+" : ""}${(((loi.rentPsf / prevRent) - 1) * 100).toFixed(1)}%)`}
                strong
                bad={loi.rentPsf < prevRent}
              />
            )}
            <Row k="Rent" v={`$${loi.rentPsf.toFixed(2)}/sf`} strong />
            <Row
              k="Recovery"
              v={(loi.recovery ?? (loi.net ? "nnn" : "gross")) === "nnn" ? "triple net — they pay opex and taxes"
                : (loi.recovery ?? "gross") === "base" ? "base-year stop — you keep today's expense level"
                : "full gross — every expense is yours"}
              bad={(loi.recovery ?? (loi.net ? "nnn" : "gross")) === "gross"}
            />
            <Row k="vs. your asking" v={`${((loi.rentPsf / market - 1) * 100).toFixed(1)}%`} bad={loi.rentPsf < market * 0.9} />
            <Row k="Term" v={`${(loi.termM / 12).toFixed(1)} yrs, to ${monthLabel(game.month + loi.termM)}`} />
            <Row k="Annual rent" v={usd(annual)} />
            <Row k="TI allowance" v={`$${loi.tiPsf}/sf · ${usd(loi.tiPsf * loi.sf)}`} />
            {loi.freeM > 0 && <Row k="Free rent" v={`${loi.freeM} months`} />}
            <Row k="Cash to sign" v={usd(cost)} bad={cost > game.cash} strong />
            {/* The exclusive is the one line item on this letter the player
                signed up for months ago and will have forgotten, and it is the
                only place the game ever says out loud what "the lease" is worth
                — base rent over the whole term, which is what a commission is
                struck on. Depth read rather than clicked. */}
            {h.broker && (
              <Row
                k="Your exclusive"
                v={`6% of ${usd(annual * (loi.termM / 12))} of base rent over the term — ${usd(Math.round(annual * (loi.termM / 12) * 0.06))}, inside the number above`}
              />
            )}
            <Row k="Answer by" v={monthLabel(loi.expiresM)} />
          </div>
          <div className="modal-actions">
            <button
              className="btn btn-buy"
              disabled={short > 0 && !fundable}
              title={short > 0 ? (fundable ? `Draws ${usd(short)} on your line to cover the fit-out` : `You are short ${usd(short)} and the line only has ${usd(line)} left`) : undefined}
              onClick={() => act("accept")}
            >
              {short > 0 && fundable ? `Draw ${usd(short)} and sign` : `Sign the lease · ${usd(cost)}`}
            </button>
            {!isFinal && !loi.countered && (
              <button className="btn" title="Name your own rent and TI." onClick={() => {
                if (!modalCounter) { setMcRent(+(loi.rentPsf * 1.05).toFixed(2)); setMcTi(loi.tiPsf); }
                setModalCounter((v) => !v);
              }}>
                Counter…
              </button>
            )}
            <button className="btn" onClick={() => act("decline")}>Pass</button>
            <button
              className="btn"
              title="Leave it on the desk and get back to it — it stays on the Deals page until it expires."
              onClick={() => setDeferred((d) => new Set(d).add(loi.id))}
            >
              Decide later
            </button>
          </div>
          {modalCounter && !isFinal && !loi.countered && (
            <>
              <Slider
                label="Your rent"
                value={mcRent || loi.rentPsf}
                min={+(loi.rentPsf * 0.9).toFixed(2)}
                max={+(Math.max(loi.rentPsf * 1.3, market * 1.2)).toFixed(2)}
                step={0.25}
                onChange={setMcRent}
                format={(v) => `$${v.toFixed(2)}/sf · ${((v / market - 1) * 100).toFixed(0)}% vs market`}
                marks={[{ at: loi.rentPsf, label: "their offer" }, { at: +market.toFixed(2), label: "market" }]}
                hint={loi.kind === "renewal" ? "Moving is expensive — an incumbent bends further than a prospect." : "They read your number against the market, not against their own opener."}
              />
              {loi.tiPsf > 0 && (
                <Slider
                  label="TI allowance"
                  value={mcTi}
                  min={0}
                  max={loi.tiPsf}
                  step={1}
                  onChange={setMcTi}
                  format={(v) => `$${v}/sf · ${usd(v * loi.sf)}`}
                  marks={[{ at: loi.tiPsf, label: "they asked" }]}
                  hint="Cutting the fit-out money costs you odds."
                />
              )}
              <div className="modal-actions">
                <button className="btn btn-buy" onClick={() => { respondLoi(loi.id, "counter", short > 0, { rentPsf: mcRent || loi.rentPsf, tiPsf: mcTi }); setModalCounter(false); }}>
                  Send the counter · ${(mcRent || loi.rentPsf).toFixed(2)}/sf{loi.tiPsf > 0 ? ` · TI $${mcTi}` : ""}
                </button>
                <button
                  className="btn"
                  title="The number is firm and they know it. Firmer terms convert some hagglers — but nobody counters back a best and final: they sign it or they walk."
                  onClick={() => { respondLoi(loi.id, "counter", short > 0, { rentPsf: mcRent || loi.rentPsf, tiPsf: mcTi, bestFinal: true }); setModalCounter(false); }}
                >
                  Best &amp; final
                </button>
              </div>
            </>
          )}
          <div className="modal-queue">
            {idx} of {live.length} on the desk
            {short > 0 && (fundable
              ? ` · the fit-out is ${usd(short)} more than your cash, so signing draws it on the line`
              : ` · you are ${usd(short)} short and the line has ${usd(line)} left — counter or sell something`)}
          </div>
        </div>
      </div>
    );
  }

  const h = game.holdings[offerBbl!]!;
  const rec = resolveRec(parcels, game, offerBbl!);
  const offer = h.sale!.offer!;
  if (!rec) return null;
  const tq = saleTaxQuote(h, offer.price);
  const value = holdingValue(rec, game.econ, h, game.month);
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-kicker">Offer in hand</div>
        <div className="modal-title">{usd(offer.price)} for {rec.address}</div>
        <div className="modal-sub">Good until {monthLabel(offer.expiresM)}. Your ask is {usd(h.sale!.ask)}.</div>
        <div className="grid">
          <Row k="Offer" v={usd(offer.price)} strong />
          <Row k="vs. your ask" v={`${((offer.price / h.sale!.ask - 1) * 100).toFixed(1)}%`} />
          <Row k="vs. appraisal" v={`${((offer.price / apMid(offerBbl!, value) - 1) * 100).toFixed(1)}%`} />
          <Row k="Loan payoff" v={usd(h.loan?.balance ?? 0)} />
          <Row k="Gain over basis" v={usd(tq.gain)} bad={tq.gain < 0} />
          {tq.tax > 0 && <Row k="Capital-gains tax" v={usd(tq.tax)} bad />}
          <Row k="Net to you" v={usd(tq.net - (h.loan?.balance ?? 0) - tq.tax)} strong />
        </div>
        <div className="modal-actions">
          <button className="btn btn-buy" onClick={() => acceptOffer(offerBbl!)}>
            Accept · net {usd(tq.net - (h.loan?.balance ?? 0) - tq.tax)}
          </button>
          {tq.tax > 0 && !game.exchange && (
            <button className="btn btn-buy" title="Roll the gain into your next purchase within 6 months" onClick={() => acceptOffer(offerBbl!, true)}>
              1031 · defer {usd(tq.tax)}
            </button>
          )}
          <button className="btn" onClick={() => declineOffer(offerBbl!)}>Decline</button>
          <button className="btn" title="Leave it — it stays live until it expires." onClick={() => setDeferred((d) => new Set(d).add(-1))}>
            Decide later
          </button>
        </div>
      </div>
    </div>
  );
}

function GameOverPage() {
  const game = useStore((s) => s.game)!;
  const manifest = useStore((s) => s.manifest);
  const over = game.gameOver!;
  const peak = Math.max(...game.nwHistory);
  const finalNw = game.nwHistory[game.nwHistory.length - 1] ?? 0;
  const realized = game.exits.reduce((a, e) => a + e.gain, 0);
  const miles = Object.keys(game.milestones ?? {}).length;
  return (
    <div className="page-backdrop">
      <div className="page gameover-page">
        <div className="page-title">{over.complete ? `A Century of ${manifest?.city ?? "the Town"}` : "The run is over."}</div>
        <p style={{ maxWidth: 640, margin: "10px auto" }}>{over.cause}</p>
        <NWChart data={game.nwHistory} height={140} />
        <div className="stat-strip" style={{ justifyContent: "center", marginTop: 14 }}>
          <Big label="Final net worth" value={usd(finalNw)} bad={finalNw < 0} />
          <Big label="Peak" value={usd(peak)} />
          <Big label="Realized gains" value={usd(realized)} bad={realized < 0} />
          <Big label="Exits" value={String(game.exits.length)} />
          <Big label="Taxes paid" value={usd(game.taxesPaid ?? 0)} />
          <Big label="Milestones" value={`${miles} / ${MILESTONES.length}`} />
        </div>
        {/* THE RUN IS OVER IS NOT THE SAME AS THE CITY IS OVER.
            The only way out of this screen was "Start a new run", which rerolls
            the seed and deletes the autosave — so the town you had just spent
            forty years in stopped existing at the exact moment you wanted to go
            back three years and do it differently. Worse, the Saves page opened
            correctly UNDERNEATH this card and every button on it was
            unclickable, so it looked like the game had simply eaten your
            saves. */}
        <div className="btn-row" style={{ marginTop: 16, justifyContent: "center" }}>
          <button className="btn" onClick={() => useStore.getState().setPage("saves")}
            title="Go back to an earlier save of this same town">
            ⛁ Load an earlier save
          </button>
          <button className="btn btn-buy" onClick={() => useStore.getState().newRun()}>Start a new run</button>
        </div>
        <div className="hint" style={{ textAlign: "center", marginTop: 10 }}>
          Starting a new run rolls a new town. An earlier save of THIS town rebuilds it exactly as it was.
        </div>
      </div>
    </div>
  );
}

// The net-worth line, drawn plainly: a century in one stroke.
function NWChart({ data, height = 120 }: { data: number[]; height?: number }) {
  if (!data || data.length < 2) return null;
  const W = 720, H = height, PAD = 6;
  const step = Math.max(1, Math.floor(data.length / 360));
  const pts: number[] = [];
  for (let i = 0; i < data.length; i += step) pts.push(data[i]);
  if (pts[pts.length - 1] !== data[data.length - 1]) pts.push(data[data.length - 1]);
  const lo = Math.min(0, ...pts), hi = Math.max(1, ...pts);
  const x = (i: number) => PAD + (i / (pts.length - 1)) * (W - 2 * PAD);
  const y = (v: number) => H - PAD - ((v - lo) / (hi - lo)) * (H - 2 * PAD);
  const line = pts.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const zero = y(0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="nw-chart" role="img" aria-label="Net worth over time">
      <polygon points={`${x(0)},${zero} ${line} ${x(pts.length - 1)},${zero}`} className="nw-fill" />
      {lo < 0 && <line x1={PAD} x2={W - PAD} y1={zero} y2={zero} className="nw-zero" />}
      <polyline points={line} className="nw-line" fill="none" />
    </svg>
  );
}

// ---------------------------------------------------------------- parcel card
/**
 * THE DESKS A BUILDING HAS. The property page grew until it was one scroll of
 * eleven unrelated cards — a rent roll, a mortgage, a wrecking bill and a bid
 * list, all in a column. These are the same cards, sorted by which question
 * you opened the page to ask. The docked panel passes no tab and still gets
 * the lot, because there you are glancing rather than working.
 */
type PropTab = "summary" | "leasing" | "money" | "ops" | "deal" | "build";

function ParcelPanel({ embedded = false, tab }: { embedded?: boolean; tab?: PropTab } = {}) {
  const parcels = useStore((s) => s.parcels);
  const adjacency = useStore((s) => s.adjacency);
  const selectedBBL = useStore((s) => s.selectedBBL);
  const select = useStore((s) => s.select);
  const game = useStore((s) => s.game)!;
  const { renovate, approach } = useStore.getState();
  // Which parcel has a demolition order waiting for a signature. Keyed by BBL
  // rather than a bare boolean so selecting a different building simply
  // dismisses the question instead of asking it about the wrong address.
  const [razeAsk, setRazeAsk] = useState<string | null>(null);

  if (!selectedBBL || !parcels) return null;
  const rec = resolveRec(parcels, game, selectedBBL);
  if (!rec) return null;
  const dev = game.developments[selectedBBL];
  const neighbors = adjacency?.[selectedBBL] ?? [];
  const holding = game.holdings[selectedBBL];
  const listing = game.listings.find((l) => l.bbl === selectedBBL);
  const appr = game.approaches[selectedBBL];
  const cond = holding?.condition ?? initialCondition(rec);
  const value = holding ? holdingValue(rec, game.econ, holding, game.month) : assetValue(rec, game.econ, cond);
  const builtFar = rec.lotArea > 0 ? rec.bldgArea / rec.lotArea : 0;
  const farMax = Math.max(rec.farMaxComm, rec.farMaxRes);
  const isBuilt = rec.class !== "land" && rec.bldgArea > 0;
  const renovating = holding?.renovatingUntilM !== undefined && game.month < (holding.renovatingUntilM ?? 0);
  const commercial = isCommercial(rec);
  const leasedSf = holding && commercial ? holding.tenants.reduce((s2, t) => s2 + t.sf, 0) : 0;
  const d = holding ? dscr(rec, game, holding) : null;
  const l = holding ? ltv(rec, game, holding) : null;
  // No tab means the docked card, which shows the whole file as it always has.
  const on = (t: PropTab) => tab === undefined || tab === t;

  return (
    <div className={embedded ? "panel-embed" : "panel"}>
      {!embedded && (
        <div className="panel-head">
          <div>
            <div className="panel-address">{rec.address}</div>
            <div className="panel-bbl mono">Parcel {rec.bbl}</div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
            <button className="btn-mini" title="Open the full property page" onClick={() => useStore.getState().setPage("property")}>full view</button>
            <button className="panel-close" onClick={() => select(null)} aria-label="Close">×</button>
          </div>
        </div>
      )}

      {on("summary") && <div className="chip-row">
        <span className="chip" style={{ background: CLASS_COLOR[rec.class] }}>{useLabel(rec)}</span>
        <span className="chip chip-zone mono">{rec.zoneDist}</span>
        {holding && <span className="chip chip-owned">OWNED</span>}
        {dev && <span className="chip chip-reno">UNDER CONSTRUCTION</span>}
        {listing && !holding && <span className="chip chip-listed">FOR SALE</span>}
        {listing?.distress && !holding && <span className="chip chip-distress">MOTIVATED SELLER</span>}
        {holding?.sale && <span className="chip chip-listed">LISTED · {usd(holding.sale.ask)}</span>}
        {renovating && <span className="chip chip-reno">RENOVATING</span>}
        {holding?.loan?.sweep && <span className="chip chip-sweep">CASH SWEEP</span>}
        {game.landmarks?.[selectedBBL] !== undefined && <span className="chip chip-reno">LANDMARKED</span>}
      </div>}

      {/* WHO OWNS IT. Every building in this city has an owner and for most of
          them that owner is a named firm with a balance sheet you can read —
          and there was nowhere on the record that said so. Knowing that the
          corner you want belongs to the shop that is three points over its
          covenant is the difference between a cold call and a bid. */}
      {on("summary") && (() => {
        if (holding) return null;
        const own = ownerOf(game, selectedBBL);
        // AND WHEN THERE IS NO NAME ON IT. Most of this city belongs to nobody
        // you can look up, and the record answered that with silence — which is
        // not what a broker would tell you. He would tell you it is an estate,
        // or a family that has had it since the war, or a fund three states
        // away, because the building itself says so: its age, its size, its lot
        // and the block it stands on. That is also the first thing you learn
        // about how hard the door is to open, which is why it belongs up here
        // beside the address and not inside a negotiation you have not opened.
        if (!own) {
          const kind = sellerOf(game, parcels, selectedBBL).kind;
          return <div className="hint">{sellerProfile(kind).holds}</div>;
        }
        return (
          <div className="hint" style={{ cursor: "pointer" }}
            onClick={() => { useStore.getState().setPage("research"); }}>
            Owned by <strong>{own.name}</strong>
            {own.failedM !== undefined
              ? " — in receivership. The book is being sold down."
              : (own.stressMs ?? 0) > 0
                ? " — and they are selling under pressure."
                : `. ${own.bbls.length} building${own.bbls.length === 1 ? "" : "s"} in town.`}
          </div>
        );
      })()}

      {on("summary") && <div className="grid">
        <Row k="Appraisal" v={band(selectedBBL, value)} strong />
        {isBuilt && <Row k="Market rent" v={"$" + marketRentPsfYr(rec, game.econ, cond).toFixed(0) + " /sf/yr"} />}
        {/* DISCLOSED, not estimated, whenever the seller has shown a roll. The
            label drops "(mkt)" with it, because it is no longer an opinion. */}
        {isBuilt && !holding && (() => {
          const d = disclosed(game, selectedBBL);
          return d
            ? <Row k="Occupancy" v={(physicalOcc(rec as never, d) * 100).toFixed(0) + "%"} bad={physicalOcc(rec as never, d) < 0.75} />
            : <Row k="Occupancy (mkt)" v={(occupancy(rec, game.econ) * 100).toFixed(0) + "%"} />;
        })()}
        {isBuilt && !holding && (
          isMixedUse(rec)
            ? <Row k="Leasable spaces" v={usesOf(rec).map((u) => `${Math.max(1, Math.round(useSf(rec, u) / useSuiteSf(rec, u)))} ${USE_WORD[u]}`).join(" · ")} />
            : <Row k="Leasable spaces" v={`${unitCount(rec)} · ${sf(Math.round(suiteSf(rec)))} each`} />
        )}
        {holding && rec.bldgArea > 0 && <Row k="Occupancy" v={(physicalOcc(rec as never, holding) * 100).toFixed(0) + "%"} />}
        {holding && rec.bldgArea > 0 && unitStatus(rec, holding, game.month).byUse.map((u) => (
          <Row
            key={u.use}
            k={u.use === "multifamily" ? "Apartments let" : `${USE_WORD[u.use][0].toUpperCase()}${USE_WORD[u.use].slice(1)} spaces let`}
            /* Flats quote the average of the leg, not the demise: the leg is
               divided into a whole number of apartments and they occupy all of
               it, so a 1,412 sf residential leg is two flats of 706 and saying
               "900 each" describes 1,800 feet the building does not have.
               Commercial keeps the demise, because there the remnant under the
               floor genuinely is not a suite — see toSuites. */
            v={`${u.leased} of ${u.total} · ${sf(u.use === "multifamily" ? avgUnitSf(rec) : u.sfPer)} each`}
            bad={u.leased < u.total * 0.6}
          />
        ))}
        {holding && commercial && <Row k="WALT" v={walt(holding, game.month).toFixed(1) + " yrs"} />}
        {/* One building must not quote two different NOIs on one panel. Owned
            assets already net out the tax bill; an unowned one is estimated
            against its own appraisal, which is the only price on offer until
            somebody names one. */}
        {isBuilt && (() => {
          const d = holding ?? disclosed(game, selectedBBL);
          return <Row k="NOI / yr" v={usd(d
            ? holdingNOIYr(rec, game.econ, d, game.month)
            : noiAfterTaxYr(rec, game.econ, cond, value))} />;
        })()}
        {holding && isBuilt && <Row k="Property tax / yr" v={usd(propertyTaxYr(rec, holding)) + (commercial ? " (your share)" : "")} />}
        <Row k="Lot area" v={sf(rec.lotArea)} />
        {isBuilt && <Row k="Building" v={sf(rec.bldgArea) + ` · ${rec.floors} fl · ${rec.yearBuilt}`} />}
        {isBuilt && isMixedUse(rec) && <Row k="The stack" v={mixLabel(rec)} />}
        <Row k="FAR built / max" v={`${builtFar.toFixed(1)} / ${farMax.toFixed(1)}`} />
        <Row k="Demand" v={String(Math.round(rec.demandScore)) + " / 100"} />
      </div>}

      {/* the builder's read on vacant dirt, owned or not — see ResidualRead */}
      {on("summary") && rec.class === "land" && rec.bldgArea === 0 && !dev && <ResidualRead bbl={selectedBBL} />}

      {/* SOMEBODY ELSE'S CRANE. A job on this site that is not yours — named or
          anonymous — is the most important thing on the parcel, because it is
          the space that will be competing with yours the year it opens. */}
      {on("summary") && !dev && (() => {
        const j = (game.cityJobs ?? []).find((x) => x.bbl === selectedBBL);
        if (!j) return null;
        const firm = game.rivals?.find((r) => r.id === j.firmId);
        const pct = Math.min(100, Math.max(0, ((game.month - j.startM) / Math.max(1, j.deliverM - j.startM)) * 100));
        return (
          <div className="deal">
            <div className="deal-head">
              {j.orphaned ? "A stalled building" : firm ? `${firm.name} is building here` : "Under construction"}
            </div>
            <div className="grid">
              <Row k="Programme" v={`${sf(j.sf)} of ${j.use} · ${j.floors} floors`} strong />
              <Row k="Progress" v={`${pct.toFixed(0)}%`} />
              <Row k={j.orphaned ? "Status" : "Delivers"}
                v={j.orphaned ? "The sponsor is gone — the receiver holds it" : monthLabel(j.deliverM)}
                bad={j.orphaned} />
              {j.firmId && !j.orphaned && j.cost !== undefined && <Row k="Their budget" v={usd(j.cost)} />}
            </div>
            {j.orphaned && (
              <div className="hint">
                Buy the site and the frame comes with it — you take over the job where they left it,
                and you pay only for what is left to build.
              </div>
            )}
          </div>
        );
      })()}

      {on("summary") && <Neighbourhood bbl={rec.bbl} block={rec.block} />}

      {on("leasing") && holding && commercial && holding.tenants.length > 0 && (
        <div className="deal">
          <div className="deal-head">Rent roll · {sf(leasedSf)} of {sf(Math.round(rec.bldgArea * (1 - (mixOf(rec).multifamily ?? 0))))} commercial</div>
          <div className="roll">
            {/* Grouped by market, because that is how it is managed. The shops
                at grade renew against retail comps and the floors above against
                office comps; one undifferentiated list hid which half of the
                building was in trouble. */}
            {usesOf(rec).filter((u) => u !== "multifamily").flatMap((u) => {
              const inUse = holding.tenants.map((t, i) => ({ t, i })).filter((x) => (x.t.use ?? rec.class) === u);
              if (!inUse.length && useSf(rec, u) < 400) return [];
              return [
                <div key={`h-${u}`} className="roll-row roll-group">
                  <span className="roll-name">{USE_WORD[u]} · {sf(Math.round(useSf(rec, u)))}</span>
                  {/* The market for THIS corner, not the citywide index — a shop
                      on a prime block does not rent at the city average, and
                      quoting one beside the other made every in-place rent look
                      like a windfall. */}
                  <span className="roll-meta mono">${useRentPsfYr(rec, game.econ, holding.condition, u).toFixed(0)}/sf market here</span>
                </div>,
                ...inUse.map(({ t, i }) => {
                  const near = t.endM - game.month <= 24;
                  const ri = near ? renewalIntent(game, rec, holding, t) : null;
                  const fit = (t.staff ?? 1) > 1.30 ? "growing" : (t.staff ?? 1) < 0.78 ? "shrinking" : null;
                  // TENURE ON THE ROW. The roll knows exactly how long every
                  // tenant has been here and never said so — and "since 2004"
                  // is what turns a row into a relationship.
                  const yrsIn = Math.floor((game.month - t.startM) / 12);
                  const strained = t.strainedM !== undefined && game.month - t.strainedM < 24;
                  return (
                  <div key={i} className="roll-row">
                    <span className="roll-name">{t.name} <span className="roll-credit mono">{CREDIT_LABEL[t.credit]}</span>
                      {yrsIn >= 5 && <span className="dim"> · since {2000 + Math.floor(t.startM / 12)}</span>}
                    </span>
                    <span className="roll-meta mono">
                      {(t.sf / 1000).toFixed(1)}k sf · ${t.rentPsf.toFixed(0)} {t.net ? "NNN" : "G"} · exp {monthLabel(t.endM)}
                      {fit && <> · {fit}</>}
                      {strained && <> · <span className="warn">strained</span></>}
                      {ri && <> · <span className={ri.p < 0.5 ? "warn" : ""}>{Math.round(ri.p * 100)}% renews</span> — {ri.why[0]}</>}
                    </span>
                  </div>
                  );
                }),
              ];
            })}
            {(mixOf(rec).multifamily ?? 0) > 0 && (
              <div className="roll-row roll-group">
                <span className="roll-name">apartments · {sf(Math.round(useSf(rec, "multifamily")))}</span>
                <span className="roll-meta mono">
                  {((holding.occ ?? 0) * 100).toFixed(0)}% let · ${useRentPsfYr(rec, game.econ, holding.condition, "multifamily").toFixed(0)}/sf market here
                </span>
              </div>
            )}
            {notReadySf(holding, game.month) > 0 && (
              <div className="roll-row roll-vacant">
                <span className="roll-name">In make-ready</span>
                <span className="roll-meta mono">
                  {(notReadySf(holding, game.month) / 1000).toFixed(1)}k sf · showable {monthLabel(Math.max(...(holding.makeReady ?? []).map((m) => m.readyM)))}
                </span>
              </div>
            )}
            {vacantSf(rec, holding) - notReadySf(holding, game.month) > 500 && (
              <div className="roll-row roll-vacant">
                <span className="roll-name">Vacant</span>
                <span className="roll-meta mono">{((vacantSf(rec, holding) - notReadySf(holding, game.month)) / 1000).toFixed(1)}k sf</span>
              </div>
            )}
          </div>
        </div>
      )}

      {on("leasing") && holding && isBuilt && !renovating && <LettingOdds bbl={selectedBBL} />}

      {/* THE MONTHLY STATEMENT. Every income number on this panel was an
          annual headline, and the arithmetic between the rent and the cheque
          was nowhere: scheduled rent plus recoveries is revenue, less the
          expense stack is NOI, less the mortgage is what actually lands in
          the account each month. Built from the same lines the appraisal
          runs (operatingStatement), divided by twelve, so this block and the
          NOI quoted above can never disagree on one building. */}
      {on("money") && holding && isBuilt && !renovating && (() => {
        const os = operatingStatement(rec, game.econ, holding, game.month);
        const apt = rec.class === "multifamily";
        const pmt = holding.loan?.monthlyPmt ?? 0;
        const cfMo = os.noi / 12 - pmt;
        const mo = (n: number) => usd(Math.round(n / 12));
        return (
          <div className="deal">
            <div className="deal-head">Cash statement · monthly</div>
            <div className="grid">
              <Row k={apt ? "Rent collections" : "Scheduled rent"} v={mo(os.baseRent + os.freeRent)} />
              {os.freeRent > 0 && <Row k="Free rent burning off" v={"−" + mo(os.freeRent)} bad />}
              {!apt && <Row k="Expense recoveries" v={mo(os.recoveredOpex + os.recoveredTax)} />}
              <Row k="Revenue" v={mo(os.egi)} strong />
              <Row k="Operating expenses" v={"−" + mo(os.opex)} />
              {/* TWO LINES, NOT ONE. Apartments used to show a single 7% line
                  doing two jobs. The fee goes to whoever runs the building;
                  the reserve is capital for carpets, appliances and roofs.
                  Different money, different people, different reasons. */}
              <Row k="Management fee" v={"−" + mo(os.mgmt)} />
              {apt && os.reserve !== undefined && (
                <Row k="Replacement reserve" v={"−" + mo(os.reserve)} />
              )}
              <Row k="Property tax" v={"−" + mo(os.tax)} />
              <Row k="NOI / mo" v={mo(os.noi)} strong bad={os.noi < 0} />
              {pmt > 0 && <Row k="Debt service / mo" v={"−" + usd(Math.round(pmt))} />}
              <Row k="Cash flow / mo" v={usd(Math.round(cfMo))} strong bad={cfMo < 0} />
            </div>
          </div>
        );
      })()}

      {on("money") && holding?.loan && (
        <div className="deal">
          <div className="deal-head">Debt</div>
          <div className="grid">
            <Row k="Balance" v={usd(holding.loan.balance)} strong />
            <Row k="Coupon" v={pct(holding.loan.ratePct) + ((holding.loan.floating ?? holding.loan.product === "float") ? " (floating)" : " (fixed)")} />
            {game.month < holding.loan.ioUntilM && <Row k="Interest-only" v={"until " + monthLabel(holding.loan.ioUntilM)} />}
            <Row k="Debt service / yr" v={usd(holding.loan.monthlyPmt * 12)} strong />
            <Row k="Balloon" v={monthLabel(holding.loan.maturityM)} />
            {d !== null && <Row k="DSCR" v={d.toFixed(2) + " (min " + holding.loan.minDSCR.toFixed(2) + ")"} bad={d < holding.loan.minDSCR} />}
            {l !== null && <Row k="LTV" v={(l * 100).toFixed(0) + "% (max " + (holding.loan.maxLTV * 100).toFixed(0) + "%)"} bad={l > holding.loan.maxLTV} />}
            {holding.loan.cap && <Row k="Rate cap" v={`base rate ≤ ${holding.loan.cap.strike.toFixed(2)}% until ${monthLabel(holding.loan.cap.expiresM)}`} />}
          </div>
          <div className="btn-row">
            {(holding.loan.floating ?? holding.loan.product === "float") && !holding.loan.cap && (
              <button
                className="btn"
                title={`Base rate capped at ${(game.econ.indexRate + 0.5).toFixed(2)}% for 3 years`}
                onClick={() => useStore.getState().rateCap(selectedBBL)}
              >
                Buy rate cap · {usd(rateCapCost(holding.loan))}
              </button>
            )}
          </div>
          <RefiSection bbl={selectedBBL} />
        </div>
      )}

      {on("deal") && listing && !holding && (() => {
        const t0 = game.talks?.[selectedBBL];
        const contract = t0?.agreed ? t0 : null;
        return (
          <div className="deal">
            <div className="deal-head">{contract ? "Under contract" : "On the market"}</div>
            <div className="grid">
              {contract
                ? <Row k="Agreed price" v={usd(contract.agreedPrice ?? contract.theirPrice)} strong />
                : <Row k="Ask" v={usd(listing.ask)} strong />}
              {contract && <Row k="Must fund by" v={monthLabel(contract.closeByM ?? game.month + 3)} bad />}
              {contract && <Row k="Deposit posted" v={usd(contract.deposit ?? 0)} />}
              {/* THE NUMBERS YOU BID ON ARE THE NUMBERS YOU CLOSE ON. Priced
                  off the disclosed rent roll where there is one, so the cap
                  rate on this card is the cap rate you actually buy at rather
                  than the one a building of this type ought to trade at. */}
              {isBuilt && (() => {
                const px = contract?.agreedPrice ?? listing.ask;
                const d = disclosed(game, selectedBBL, px);
                const n = d ? holdingNOIYr(rec, game.econ, d, game.month)
                            : noiAfterTaxYr(rec, game.econ, cond, px);
                return (
                  <>
                    <Row k="NOI / yr" v={usd(n)} bad={n < 0} />
                    <Row k="Cap rate" v={((n / Math.max(1, px)) * 100).toFixed(2) + "%"} strong />
                    <Row
                      k={d ? "Occupancy" : "Occupancy (mkt)"}
                      v={((d ? physicalOcc(rec as never, d) : occupancy(rec, game.econ)) * 100).toFixed(0) + "%"}
                    />
                    {d && <Row k="In place" v={`${d.tenants.length} lease${d.tenants.length === 1 ? "" : "s"}`} />}
                  </>
                );
              })()}
              {!isBuilt && <Row k="Land" v={"$" + ((contract?.agreedPrice ?? listing.ask) / rec.lotArea).toFixed(0) + " /sf of lot"} />}
            </div>
            {/* TWO ACTS, and never both at once. Before a handshake there is
                only a price; after one there is only the money. */}
            {contract ? (
              <>
                <div className="hint">{contract.note}</div>
                <BuyButtons bbl={selectedBBL} price={contract.agreedPrice ?? contract.theirPrice} off={false} />
              </>
            ) : (
              <OfferDesk bbl={selectedBBL} price={listing.ask} />
            )}
          </div>
        );
      })()}

      {on("deal") && !listing && !holding && (
        <div className="deal">
          <div className="deal-head">Off-market</div>
          {appr && !appr.refused && appr.ask ? (
            <>
              {/* A NUMBER THAT ARRIVED THE HARD WAY READS DIFFERENTLY.
                  `mode` says how the conversation opened and never changes, so
                  `mode === "offer"` with an ask present can only mean one
                  thing: they deflected, you bid at them, and the bid drew the
                  figure out. That is worth saying, because the ask below it
                  has the knowledge that you want the building priced into it —
                  and because the counter button is gone and the player is owed
                  a reason why (bidBlind spends the counter on the bid). */}
              {appr.mode === "offer" && (
                <div className="hint">
                  They would not name a price until you bid.
                  {appr.lastBid ? ` Your ${usd(appr.lastBid)} got this out of them` : " This came back"} —
                  and it is a number quoted to somebody they now know wants it.
                </div>
              )}
              <div className="grid">
                <Row k="Owner's ask" v={usd(appr.ask)} strong />
                <Row k="vs. appraisal" v={((appr.ask / apMid(selectedBBL, value) - 1) * 100).toFixed(1) + "%"} />
                <Row k="Good until" v={monthLabel(appr.q + 6)} />
              </div>
              {/* Off-market has always been two acts: they name a number, you
                  counter it once, and only then is there a price to fund. The
                  finance block goes underneath the price conversation, not
                  above it. */}
              {!appr.countered && <OffMarketCounter bbl={selectedBBL} ask={appr.ask} />}
              <div className="hint" style={{ marginTop: 6 }}>
                {appr.countered
                  ? `Their number is ${usd(appr.ask)} and that is where it stays. Fund it or leave it.`
                  : "Counter once if you want to, then place the debt against whatever number you end up with."}
              </div>
              <BuyButtons bbl={selectedBBL} price={appr.ask} off closeLabel={`Buy at ${usd(appr.ask)}`} />
            </>
          ) : appr && !appr.refused ? (
            /* THE THIRD STATE, WHICH THIS PANEL DID NOT HAVE.
               An approach that is neither refused nor carrying an ask is the
               "make me an offer" conversation, and it fell through to the
               else-arm below — the one that says "Not listed, but everything
               has a price" and offers an Approach button whose only possible
               answer is "You already have them. They are waiting on YOUR
               number, not another call." A live negotiation rendered as though
               it had never happened. */
            <BlindBidDesk bbl={selectedBBL} appr={appr} value={value} />
          ) : appr && appr.refused ? (
            /* THE DATE PASSES AND THE PHONE STILL WORKS.
               This branch printed "try again after March" and then rendered no
               button at all — the only Approach button lived in the else-arm,
               which needs the approach record GONE, and the record does not
               expire for a year. So the six-month cooling-off period was, in
               practice, twelve months of a dead screen. The engine was right
               the whole time; the panel simply never offered the call. */
            <>
              <div className="hint">
                The owner turned you away in {monthLabel(appr.q)}.
                {game.month < appr.q + 6
                  ? ` They will not take another call until ${monthLabel(appr.q + 6)}.`
                  : " Enough time has passed that it is worth another call."}
              </div>
              <div className="btn-row">
                <button
                  className="btn"
                  disabled={game.month < appr.q + 6}
                  title={game.month < appr.q + 6
                    ? `Too soon — ${appr.q + 6 - game.month} month${appr.q + 6 - game.month === 1 ? "" : "s"} to go`
                    : "Ring them again. They may have changed their mind; they may not."}
                  onClick={() => approach(selectedBBL)}
                >
                  Approach the owner again
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="hint">
                Not listed — but everything has a price.
                {adjacency && assemblagePressure(game, adjacency, selectedBBL) > 0.3 &&
                  " You own neighbors: expect holdout pricing."}
              </div>
              <div className="btn-row">
                <button className="btn" onClick={() => approach(selectedBBL)}>Approach the owner</button>
              </div>
            </>
          )}
        </div>
      )}

      {on("build") && holding && dev && (
        <div className="deal">
          <div className="deal-head">Construction</div>
          <div className="grid">
            <Row k="Program" v={`${(dev.sf / 1000).toFixed(0)}k sf ${dev.use} · ${dev.floors} fl`} />
            <Row k="Budget" v={usd(dev.costTotal)} />
            <Row k="Constr. loan" v={usd(dev.loanBalance) + " @ " + pct(dev.ratePct)} />
            <Row k="Delivers" v={monthLabel(dev.deliverM)} strong />
          </div>
        </div>
      )}

      {on("build") && holding && !dev && rec.class === "land" && <DevelopSection bbl={selectedBBL} />}

      {/* THE LAND DESK BELONGS IN THE PANEL YOU ACTUALLY USE.
          Assembly has been reported broken twice, and the engine was never the
          problem: assembleLots merges two adjacent deeds for $105k headless and
          through the store, and the adjacency graph is clean — 2,543 edges,
          symmetric, matched to the drawn geometry. It was unreachable. LandDesk
          holds the whole assemble flow — the neighbour picker, the site-after-
          merger arithmetic, the plate-efficiency gain, the reasons a given
          neighbour is blocked — and it was rendered ONLY inside PropertyPage,
          the full-page view. Most play goes through this docked panel, which
          showed you the lot, told you nothing, and offered no way to fold it in.
          It renders itself to nothing when there is no adjacent deed you own,
          so it costs nothing on the parcels where it does not apply. */}
      {on("build") && holding && <LandDesk bbl={selectedBBL} />}

      {on("leasing") && holding && isBuilt && !renovating && <LeasingDesk bbl={selectedBBL} />}

      {/* VACANT POSSESSION, IN ONE PLACE. Stopping the letting, buying the roll
          out and taking the building down are three steps of one decision, and
          they were spread across two cards on opposite ends of the page — the
          buyout inside the leasing desk, the wrecking bill at the bottom of
          Management. Nobody empties a building for fun; they empty it because
          they intend to knock it down, so the wrecker's number belongs beside
          the tenants' number. */}
      {on("ops") && holding && isBuilt && !renovating && (
        <VacantPossession bbl={selectedBBL} onRaze={() => setRazeAsk(selectedBBL)} />
      )}

      {on("ops") && holding && isBuilt && !renovating && (
        <div className="deal">
          <div className="deal-head">Management</div>
          <div className="grid">
            <Row k="Asking rent" v={"$" + managedRentPsfYr(rec, game.econ, holding).toFixed(0) + " /sf on new leases"} />
          </div>
          <div className="btn-row">
            {([-1, 0, 1] as const).map((v) => (
              <button
                key={v}
                className={"btn" + ((holding.stance ?? 0) === v ? " btn-on" : "")}
                title={v === 1 ? "+8% asking rents, fewer LOIs" : v === -1 ? "−8% rents, faster lease-up" : "market rents"}
                onClick={() => useStore.getState().stance(selectedBBL, v)}
              >
                {v === 1 ? "Push rents" : v === -1 ? "Fill space" : "Market"}
              </button>
            ))}
          </div>
          <div className="grid">
            <Row k="Service" v={`${serviceSpec(holding.service).label} · tenants read it as ${Math.round(100 * (holding.svcIdx ?? 0.55))} of 100`} />
            <Row k="Capital plan" v={`${planSpec(holding.plan).label} · condition ${Math.round(100 * (holding.condIdx ?? 0.6))} of 100`} />
          </div>
          <div className="btn-row">
            {OPS_SERVICE.map((o) => (
              <button
                key={o.key}
                className={"btn" + ((holding.service ?? 0) === o.key ? " btn-on" : "")}
                title={o.blurb + " — three years to matter, three years to undo"}
                onClick={() => useStore.getState().ops(selectedBBL, { service: o.key })}
              >{o.label}</button>
            ))}
          </div>
          <div className="btn-row">
            {OPS_PLAN.map((o) => (
              <button
                key={o.key}
                className={"btn" + ((holding.plan ?? 1) === o.key ? " btn-on" : "")}
                title={o.blurb}
                onClick={() => useStore.getState().ops(selectedBBL, { plan: o.key })}
              >{o.label}</button>
            ))}
          </div>
          <div className="btn-row">
            {PROGRAMS.map((p) => {
              const done = holding.programsDone?.[p.id] !== undefined;
              const running = holding.program?.id === p.id;
              const cost = programCost(rec, game, p);
              return (
                <button
                  key={p.id}
                  className="btn"
                  disabled={done || !!holding.program}
                  title={`${p.blurb} · ${p.months} months`}
                  onClick={() => useStore.getState().program(selectedBBL, p.id)}
                >
                  {done ? "✓ " : running ? "⏳ " : ""}{p.label} · {usd(cost)}
                </button>
              );
            })}
          </div>
          {commercial && vacantSf(rec, holding) > 500 && (
            <div className="btn-row">
              <button
                className={"btn" + (holding.broker ? " btn-on" : "")}
                title="A leasing exclusive: ~45% more tenant traffic while the space is vacant, and no retainer at all while it sits. The house is paid a commission instead — 6% of the base rent over the full term of every lease signed while they hold the file, due at the signing, in place of the 4% on a new lease and 2% on a renewal your own people cost. Cheap to hold, expensive when it works."
                onClick={() => useStore.getState().broker(selectedBBL, !holding.broker)}
              >
                {holding.broker
                  ? "✓ Broker engaged — 6% of everything they sign"
                  : "Hire leasing broker · no retainer, 6% of the lease at signing"}
              </button>
            </div>
          )}
          {isBuilt && cond !== "good" && (
            <div className="btn-row">
              <button className="btn" onClick={() => renovate(selectedBBL)}>
                Gut renovation · {usd(renovationCost(rec, game.econ))} · {6} mo
              </button>
            </div>
          )}
        </div>
      )}

      {/* The demolition question, asked in the house's own voice. window.confirm
          painted it as a browser popup captioned "localhost:8080" — and a browser
          that suppresses dialogs makes confirm() return false silently, which
          reads as a dead button. This card also says what the click is actually
          weighing: the wrecking bill against what the cleared dirt is worth. */}
      {razeAsk === selectedBBL && (() => {
        const demoCost = demolitionCost(rec, game);
        const dirt = landValue(rec, game.econ);
        return (
          <div className="modal-backdrop">
            <div className="modal">
              <div className="modal-kicker">Demolition order</div>
              <div className="modal-title">{rec.address}</div>
              <div className="modal-sub">
                {useLabel(rec)} · {sf(rec.bldgArea)} · {rec.floors} fl · built {rec.yearBuilt}.
                The site goes back to vacant land — the building, and every lease in it, does not come back.
              </div>
              <div className="grid">
                <Row k="Demolition cost" v={usd(demoCost)} bad={demoCost > game.cash} strong />
                <Row k="Cleared site is worth" v={usd(dirt)} />
                {farMax > 0 && <Row k="Buildable envelope" v={`${sf(Math.round(rec.lotArea * farMax))} at ${farMax.toFixed(1)} FAR`} />}
                <Row k="Cash on hand" v={usd(game.cash)} bad={demoCost > game.cash} />
              </div>
              <div className="modal-actions">
                <button
                  className="btn btn-sell"
                  disabled={demoCost > game.cash}
                  title={demoCost > game.cash ? "The wreckers want cash you don't have." : undefined}
                  onClick={() => { setRazeAsk(null); useStore.getState().raze(selectedBBL); }}
                >
                  Take it down · {usd(demoCost)}
                </button>
                <button className="btn" onClick={() => setRazeAsk(null)}>Leave it</button>
              </div>
              <div className="modal-queue">Wreckers work fast — the lot is clean dirt the same month.</div>
            </div>
          </div>
        );
      })()}

      {on("deal") && holding && <SaleSection bbl={selectedBBL} value={value} />}

      {on("summary") && holding && (
        <div className="deal">
          <div className="deal-head">Your position · since {monthLabel(holding.boughtM)}</div>
          <div className="grid">
            <Row k="Basis" v={usd(holding.costBasis)} />
            {(holding.deprTaken ?? 0) > 0 && <Row k="Depreciation taken" v={"−" + usd(holding.deprTaken!)} />}
            <Row k="Assessed (tax)" v={usd(holding.assessed ?? holding.costBasis)} />
            <Row k="Equity" v={usd(value - (holding.loan?.balance ?? 0))} strong />
          </div>
        </div>
      )}

      {on("summary") && <div className="neighbors">
        <div className="neighbors-head">Adjoining lots · {neighbors.length}</div>
        <div className="neighbors-list">
          {neighbors.map((n) => {
            const nr = parcels[n];
            return (
              <button key={n} className="neighbor" onClick={() => select(n)}>
                <span className="neighbor-addr">{game.holdings[n] ? "◆ " : ""}{nr?.address ?? n}</span>
                <span className="neighbor-meta mono">
                  {nr ? `${nr.lotArea.toLocaleString()} sf · ${useLabel(nr)}` : ""}
                </span>
              </button>
            );
          })}
          {neighbors.length === 0 && <div className="neighbor-none">No shared lot lines on record.</div>}
        </div>
      </div>}
    </div>
  );
}

/**
 * EMPTYING A BUILDING. Lifted out of the leasing desk so the three moves sit
 * together and in the order you make them: stop signing, pay the sitting
 * tenants to go, take it down. The wrecker's number is on the same row as the
 * tenants' number because the sum of the two is the real cost of the dirt —
 * which is exactly why the site under a well-let building is worth less than
 * the site under a half-empty one.
 */
function VacantPossession({ bbl, onRaze }: { bbl: string; onRaze: () => void }) {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const h = game.holdings[bbl];
  const rec = h ? resolveRec(parcels, game, bbl) : null;
  if (!h || !rec) return null;

  const bq = buyoutQuote(game, bbl);
  const occupied = (bq?.tenants ?? 0) > 0 || (h.occ ?? 0) > 0.02;
  const resSf = useSf(rec as never, "multifamily") * (h.occ ?? 0);
  const resCost = Math.round(resSf * useRentPsfYr(rec, game.econ, h.condition, "multifamily") * BUYOUT_PREMIUM);
  const clearCost = (bq?.cost ?? 0) + resCost;
  const demoCost = demolitionCost(rec, game);
  // The engine's own bar for a wrecking permit. Named on the button rather
  // than discovered by clicking it — see raze in actions.ts.
  const occNow = physicalOcc(rec as never, h);
  const canRaze = occNow < 0.20;

  return (
    <div className="deal">
      <div className="deal-head">Emptying the building</div>
      <div className="grid">
        <Row k="Letting" v={h.leasingHold ? "STOPPED — nobody new, nobody renewed" : "Open — new tenants and renewals"} bad={h.leasingHold} />
        <Row k="Occupied" v={(occNow * 100).toFixed(0) + "%"} />
        {occupied && <Row k="In place" v={`${bq?.tenants ?? 0} lease${(bq?.tenants ?? 0) === 1 ? "" : "s"}${resSf > 900 ? ` · ${sf(Math.round(resSf))} of let flats` : ""}`} />}
        {occupied && h.tenants.length > 0 && (
          <Row k="Longest lease runs to" v={monthLabel(Math.max(...h.tenants.map((t) => t.endM)))} />
        )}
        {occupied && <Row k="Cost to buy them all out" v={usd(clearCost)} strong />}
        <Row k="Demolition" v={usd(demoCost)} />
        {occupied && <Row k="Vacant dirt costs you" v={usd(clearCost + demoCost)} strong bad={clearCost + demoCost > game.cash} />}
      </div>
      <div className="btn-row">
        <button className={"btn" + (h.leasingHold ? " btn-on" : "")}
          onClick={() => useStore.getState().holdLeasing(bbl, !h.leasingHold)}
          title={h.leasingHold
            ? "Start letting again — new prospects and renewals resume next month"
            : "Sign nobody new and renew nobody. The roll runs off and the income with it."}>
          {h.leasingHold ? "Resume letting" : "Stop letting"}
        </button>
        {occupied && clearCost > 0 && (
          <button className="btn btn-sell" disabled={clearCost > game.cash}
            onClick={() => useStore.getState().buyOutLeases(bbl)}
            title={`Every remaining month of every contract, plus ${((BUYOUT_PREMIUM - 1) * 100).toFixed(0)}% for making them move`}>
            Buy out every lease · {usd(clearCost)}
          </button>
        )}
        <button
          className="btn btn-sell"
          disabled={!canRaze}
          title={canRaze
            ? "Clear the site back to dirt so you can rebuild to the full envelope."
            : `The building is ${(occNow * 100).toFixed(0)}% let. Nobody signs a wrecking permit over sitting tenants — it has to be under 20%.`}
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
      {clearCost > game.cash && occupied && (
        <div className="hint">Short {usd(clearCost - game.cash)} of what it takes to clear it.</div>
      )}
    </div>
  );
}

function SaleSection({ bbl, value }: { bbl: string; value: number }) {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const { listSale, delistSale, acceptOffer, declineOffer, counterSale, runBestAndFinal, takeBid } = useStore.getState();
  const holding = game.holdings[bbl]!;
  const [ask, setAsk] = useState<string>("");
  const [counter, setCounter] = useState(0);
  // which bidder you are going back to privately, and at what number
  const [counterOn, setCounterOn] = useState<number | null>(null);
  const [counterPx, setCounterPx] = useState(0);
  const sale = holding.sale;
  const exchangeBusy = !!game.exchange;
  if (sale) {
    const tq = sale.offer ? saleTaxQuote(holding, sale.offer.price) : null;
    return (
      <div className="deal">
        <div className="deal-head">For sale · listed {monthLabel(sale.listedM)}</div>
        <div className="grid">
          <Row k={sale.mode === "marketed" ? "Whisper price" : "Your ask"} v={usd(sale.ask)} strong />
          <Row k="vs. appraisal" v={((sale.ask / apMid(bbl, value) - 1) * 100).toFixed(1) + "%"} />
          <Row k="Process" v={sale.mode === "marketed" ? "Marketed campaign · 2.5% fee" : "Quiet listing · 1.5% fee"} />
          {sale.callM !== undefined && <Row k="Offers due" v={monthLabel(sale.callM)} strong />}
        </div>
        {/* THE BID LIST. Everybody who turned up, at once. The spread across
            it is the information: tight means the market agrees with you and
            there is nothing more to get; wide means the top bidder wants it
            much more than the rest, which is exactly when going back to them
            is worth the risk of losing them. */}
        {sale.bids?.length ? (
          <>
            <div className="page-section" style={{ marginTop: 2 }}>
              Bids · {sale.bids.filter((b) => !b.dropped).length} live{(sale.round ?? 0) > 0 ? " · best and final done" : ""}
            </div>
            <table className="tbl">
              <thead>
                <tr><th>Bidder</th><th className="num">Price</th><th className="num">vs appraisal</th><th>Read</th><th /></tr>
              </thead>
              <tbody>
                {sale.bids.map((b, i) => (
                  <tr key={b.name + i} className={b.dropped ? "dim" : ""}>
                    <td>{b.name}</td>
                    <td className="num">{usd(b.price)}</td>
                    <td className="num">{((b.price / apMid(bbl, value) - 1) * 100).toFixed(0)}%</td>
                    <td className="dim">{b.dropped ? "Walked at best and final." : b.note}</td>
                    <td>
                      {!b.dropped && (
                        <div className="btn-row" style={{ gap: 4, margin: 0 }}>
                          <button className="btn-mini" onClick={() => takeBid(bbl, i)}>take it</button>
                          {/* GOING BACK TO ONE BIDDER. Best-and-final puts the
                              whole list back in the room; this is the other
                              move — the private call to the one number you
                              would take five per cent more of. One per bid. */}
                          {!b.countered && (
                            <button className={"btn-mini" + (counterOn === i ? " on" : "")}
                              title={`Go back to ${b.name} alone with a number of your own`}
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
            {counterOn !== null && sale.bids?.[counterOn] && !sale.bids[counterOn].dropped && (
              <div className="page-section" style={{ marginTop: 6 }}>
                <Slider
                  label={`Back to ${sale.bids![counterOn].name} at`}
                  value={counterPx}
                  min={sale.bids![counterOn].price}
                  max={Math.round(sale.bids![counterOn].price * 1.25)}
                  step={25_000}
                  onChange={setCounterPx}
                  format={(v: number) => `${usd(v)} · +${((v / sale.bids![counterOn!].price - 1) * 100).toFixed(1)}%`}
                  hint={counterPx > sale.bids![counterOn].price * 1.12
                    ? "That is a long way past their number. A bidder who has already shown you their best walks at this."
                    : counterPx > sale.bids![counterOn].price * 1.05
                      ? "A real ask. They will think about it, and some of them will not come back."
                      : "Close enough to their number that they will probably just pay it."}
                />
                <div className="btn-row">
                  <button className="btn" onClick={() => { useStore.getState().counterBid(bbl, counterOn!, counterPx); setCounterOn(null); }}>
                    Send it — {usd(counterPx)}
                  </button>
                  <button className="btn" onClick={() => setCounterOn(null)}>Leave it</button>
                </div>
              </div>
            )}
            <div className="hint">
              Taking a bid is not a closing. The weaker the covenant behind a number, the likelier they come back
              with a reason it should be lower once they have been through the building.
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
                ? <>{sale.offer.from ?? "The buyer"} has <b>retraded</b> you — {sale.offer.retrade}. They are at <b className="mono">{usd(sale.offer.price)}</b> now, good until {monthLabel(sale.offer.expiresM)}.</>
                : <>Offer on the table{sale.offer.from ? ` from ${sale.offer.from}` : ""}: <b className="mono">{usd(sale.offer.price)}</b> — good until {monthLabel(sale.offer.expiresM)}.</>}
              {tq.tax > 0 && <> Gain of {usd(tq.gain)} over depreciated basis owes <b className="mono">{usd(tq.tax)}</b> in tax.</>}
            </div>
            {/* WHAT THEY ARE ACTUALLY BUYING. A price is a price; the cap rate
                they are getting and the occupancy they are getting it on are
                the two numbers that say whether the offer is generous or
                whether they have spotted something you have not. */}
            {(() => {
              const orec = resolveRec(parcels, game, bbl);
              if (!orec || orec.class === "land" || !orec.bldgArea) return null;
              const noi = holdingNOIYr(orec, game.econ, holding, game.month);
              const cap = sale.offer!.price > 0 ? (noi / sale.offer!.price) * 100 : 0;
              const mkt = game.econ.capRate[orec.class as BuiltClass] ?? cap;
              const occ = physicalOcc(orec as never, holding);
              const u = unitStatus(orec, holding, game.month);
              return (
                <div className="grid">
                  <Row k="Cap rate they are buying at" v={`${cap.toFixed(2)}%`} strong bad={cap > mkt + 0.4} />
                  <Row
                    k="Against the market"
                    v={`${mkt.toFixed(2)}% for ${useLabel(orec)} — ${cap < mkt - 0.25 ? "they are paying up" : cap > mkt + 0.25 ? "that is a discount to the market" : "about where the market is"}`}
                  />
                  <Row k="NOI they are underwriting" v={usd(noi)} />
                  <Row k="Occupancy today" v={`${(occ * 100).toFixed(0)}% · ${u.leased} of ${u.total} spaces`} bad={occ < 0.75} />
                  <Row k="Against your ask" v={`${((sale.offer!.price / sale.ask - 1) * 100).toFixed(1)}%`} bad={sale.offer!.price < sale.ask * 0.92} />
                </div>
              );
            })()}
            <div className="btn-row">
              <button className="btn btn-buy" onClick={() => acceptOffer(bbl)}>
                Accept · net {usd(tq.net - (holding.loan?.balance ?? 0) - tq.tax)}
              </button>
              {tq.tax > 0 && !exchangeBusy && (
                <button
                  className="btn btn-buy"
                  title={`Roll the gain into your next purchase: defer ${usd(tq.tax)} of tax, but you must buy for ≥ 80% of this price within 6 months`}
                  onClick={() => acceptOffer(bbl, true)}
                >
                  1031 · defer {usd(tq.tax)}
                </button>
              )}
              <button className="btn" onClick={() => declineOffer(bbl)}>Decline</button>
            </div>
            {/* COUNTERING. Declining a bid you would have taken five per cent
                higher just throws the buyer away; every seller alive picks up
                the phone instead. One round — grinding is not a mechanic. */}
            {!sale.offer.countered && (
              <>
                <Slider
                  label="Counter"
                  value={counter || Math.round(sale.offer.price * 1.06)}
                  min={sale.offer.price + 1000}
                  max={Math.round(Math.max(sale.ask, sale.offer.price * 1.3))}
                  step={Math.max(1000, Math.round(sale.offer.price / 400))}
                  onChange={setCounter}
                  format={(v) => `${usd(v)} · +${(((v / sale.offer!.price) - 1) * 100).toFixed(1)}% on their bid`}
                  marks={[
                    { at: Math.round(sale.offer.price * 1.03), label: "+3%" },
                    { at: Math.round(sale.offer.price * 1.08), label: "+8%" },
                    { at: sale.ask, label: "ask" },
                  ]}
                  hint="Inside what the building is worth to them and they take it. A little over and they split it. Well over and they walk — and an unsolicited buyer takes the whole approach with them."
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
              ? `The book is out. Nothing happens until offers are due in ${monthLabel(sale.callM)} — that is the point of a date.`
              : "No offers yet. Overpriced listings sit; the market talks back slowly."}
          </div>
        )}
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
              ? `Cutting ${usd(sale.ask - want)} off. A price cut brings the phone back — it also tells every bidder you are motivated.`
              : want > sale.ask
                ? `Asking ${usd(want - sale.ask)} more than you were. Raising an ask mid-campaign loses the buyers who were nearly there.`
                : "The number you are asking today.";
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
  const saleClass = (saleRec && saleRec.class !== "land" ? saleRec.class : "office") as BuiltClass;
  const saleNoi = saleRec && saleRec.class !== "land" && saleRec.bldgArea > 0
    ? noiAfterTaxYr(saleRec, game.econ, initialCondition(saleRec), price) : 0;
  const askCap = saleNoi > 0 && price > 0 ? (saleNoi / price) * 100 : null;
  return (
    <div className="deal">
      <div className="deal-head">Sell</div>
      <div className="hint">Price it and let the market answer. Appraisal: {band(bbl, value)}.</div>
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
        hint={price < mid * 0.95 ? "Priced to move — expect offers within months."
          : price > mid * 1.12 ? "Above the market. It may sit a long time."
          : "About right; offers should come."}
      />
      {/* WHAT YOU ARE ACTUALLY ASKING. A price is a number; a cap rate is the
          number every buyer on the other side will convert it to before they
          answer the phone, and it is the one that says whether the ask is
          serious. */}
      {askCap !== null && (
        <div className="hint">
          At {usd(price)} you are asking a <b className="mono">{askCap.toFixed(2)}%</b> cap on
          {" "}{usd(saleNoi)} of NOI — the market is paying about {game.econ.capRate[saleClass].toFixed(2)}% for this class today.
          {askCap < game.econ.capRate[saleClass] - 0.4
            ? " You are asking a premium to the market; it will take a buyer who wants this building specifically."
            : askCap > game.econ.capRate[saleClass] + 0.4
              ? " That is a discount to the market — it should go quickly."
              : " That is where the market is."}
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
      <div className="btn-row">
        <button className="btn btn-buy" onClick={() => listSale(bbl, price, "marketed")}>
          Run a process · {usd(price)} less {usd(Math.round(price * 0.025))} fee
        </button>
        <button className="btn" onClick={() => listSale(bbl, price)}>
          Sell it quietly · {usd(price)} less {usd(Math.round(price * 0.015))} fee
        </button>
      </div>
      <div className="hint">
        The campaign costs {usd(Math.round(price * 0.01))} more and two to four months, and ends with every bid on
        your desk on the same day — plus one go back to the top of the list. That is what the extra point buys:
        not a better building, a better-tested price. A quiet sale saves the fee and finds you one buyer at a
        time, whoever happens to ring, and you never learn what the best buyer in the city would have paid.
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
function annualPayment(principal: number, ratePct: number, years: number): number {
  const r = ratePct / 100 / 12;
  const n = years * 12;
  if (r <= 0) return principal / years;
  return (principal * r) / (1 - Math.pow(1 + r, -n)) * 12;
}

// Counter an off-market ask at YOUR number. One shot; the deeper the cut,
// the likelier they hang up instead of grumbling.
function OffMarketCounter({ bbl, ask }: { bbl: string; ask: number }) {
  const [frac, setFrac] = useState(0.88);
  const px = Math.round(ask * frac);
  return (
    <>
      <Slider
        label="Counter their number"
        value={frac}
        min={0.7}
        max={0.98}
        step={0.01}
        onChange={setFrac}
        format={() => `${usd(px)} · ${((frac - 1) * 100).toFixed(0)}%`}
        marks={[{ at: 0.88, label: "−12%" }, { at: 0.95, label: "−5%" }]}
        hint="One shot. A shallow cut usually lands; a deep one gets the phone hung up on you."
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
function BlindBidDesk({ bbl, appr, value }: { bbl: string; appr: Approach; value: number }) {
  const game = useStore((s) => s.game)!;
  const ap = apMid(bbl, value);
  const [mult, setMult] = useState(1);
  // Round to the thousand the way approachOwner rounds its own number, so the
  // bid the player sees is the bid the engine books.
  const bid = Math.max(1000, Math.round((ap * mult) / 1000) * 1000);
  const probes = appr.probes ?? 0;
  // buyOffMarket kills a blind conversation at q+6 with "that has gone cold";
  // approachOwner reopens the phone at q+6 as well, so the two meet exactly.
  const cold = game.month > appr.q + 6;
  if (cold) {
    return (
      <>
        {/* Which sentence is true depends on whether the player ever bid. It
            says "you never put one in" only when probes is 0 — the record
            knows, and a panel that told a player who bid four times that they
            never bid would be reading the wrong field out loud. */}
        <div className="hint">
          {probes > 0
            ? `You bid ${appr.lastBid ? usd(appr.lastBid) : "once"} and never went back.`
            : "They asked you for a number and you never put one in."}
          {" "}That conversation is cold — six months is as long as anybody holds a door open for a buyer
          who is thinking about it.
        </div>
        <div className="btn-row">
          <button className="btn" onClick={() => useStore.getState().approach(bbl)}>Ring them again</button>
        </div>
      </>
    );
  }
  return (
    <>
      <div className="hint">
        They took the call and would not put a price on it. <em>"Make me an offer."</em>
      </div>
      <div className="grid">
        <Row k="Their ask" v="none — they refused to name one" strong />
        <Row k="Appraisal" v={band(bbl, value)} />
        <Row k="They will listen until" v={monthLabel(appr.q + 6)} />
        {probes > 0 && (
          <Row
            k="Bids you have made"
            v={`${probes}${appr.lastBid ? ` · last ${usd(appr.lastBid)}` : ""}`}
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
        hint="Nothing on this screen knows what they want. The dial is measured against the appraisal because that is the only number anybody in this conversation has."
      />
      {/* WHAT EACH OUTCOME MEANS, because a blind bid has four of them and
          three look like failure. Written from bidBlind's branches, in the
          order they are checked, and deliberately without odds attached: the
          player is not entitled to the shape of the distribution either. */}
      <div className="hint">
        Over their number and it is done <strong>at yours</strong> — and nobody will ever tell you that you
        were twenty points high. Close under it and they may finally name a figure, which costs you the fact
        that they now know you want it. Well under and you get a no with nothing attached. Insulting and the
        conversation ends.
      </div>
      {probes >= 2 && (
        <div className="hint">
          {probes} bids in. Their patience is finite and this panel does not know how much of it is left —
          by the third number you have stopped being a buyer and started being a process.
        </div>
      )}
      <BuyButtons bbl={bbl} price={bid} off bid={bid} closeLabel={`Bid ${usd(bid)}`} />
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
function OfferDesk({ bbl, price }: { bbl: string; price: number }) {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  // The dial runs on a fraction of the ask, not on dollars: a dollar-valued
  // range with a rounded step can leave the top end unreachable, which meant
  // you could not simply pay the asking price.
  const [bidFrac, setBidFrac] = useState(0.94);
  // BEST AND FINAL is an instrument, not a bluff. Certainty of a done deal is
  // worth about three and a half per cent to a seller who has been retraded
  // before — and every seller has been — so a credible final closes under
  // their floor. The price of the instrument: a no ends it, for both sides,
  // and it is only credible while the street still believes your finals.
  const [isFinal, setIsFinal] = useState(false);
  const offerPrice = Math.round(price * Math.min(1, bidFrac));
  const seller = sellerOf(game, parcels, bbl);
  const talks = game.talks?.[bbl] ?? null;
  // Everything else you have on the table. Not a blocker any more — a list,
  // because knowing what else you are committed to is exactly what you need
  // when you decide how hard to push on this one.
  const others = Object.values(game.talks ?? {}).filter((t) => t.bbl !== bbl);
  const atLimit = !talks && others.length >= MAX_TALKS;
  const rec = parcels[bbl];
  const noi = rec ? noiAfterTaxYr(rec, game.econ, initialCondition(rec), offerPrice) : 0;
  const goingIn = offerPrice > 0 && noi > 0 ? (noi / offerPrice) * 100 : null;
  return (
    <>
      <Slider
        label="Your offer"
        value={bidFrac}
        min={0.6}
        max={1}
        step={0.005}
        onChange={setBidFrac}
        format={() => `${usd(offerPrice)}${bidFrac < 1 ? ` · ${((bidFrac - 1) * 100).toFixed(1)}%` : " · full ask"}`}
        marks={[{ at: 0.85, label: "−15%" }, { at: 0.95, label: "−5%" }, { at: 1, label: "ask" }]}
        hint={talks
          ? (offerPrice >= talks.theirPrice
            ? `You are at or above their ${usd(talks.theirPrice)} — send it and you are under contract.`
            : `They are at ${usd(talks.theirPrice)}, ${usd(talks.theirPrice - offerPrice)} above you${talks.final ? ". This is their last word." : `. Round ${talks.round} of ${talks.maxRounds}.`}`)
          : "Open with a number. They will take it, come back with one of their own, or tell you where they are."}
      />
      {/* What the number MEANS, before anybody talks about debt. A going-in cap
          is the only thing you need to know to decide whether a price is a
          price — the capital stack changes what you earn on it, not whether it
          is worth owning. */}
      {goingIn !== null && (
        <div className="grid">
          <Row k="NOI / yr, after taxes" v={usd(noi)} />
          <Row k="Going-in cap at your number" v={`${goingIn.toFixed(2)}%`} strong />
          <Row k="What the market pays" v={`${game.econ.capRate[(rec!.class !== "land" ? rec!.class : "office") as BuiltClass].toFixed(2)}% for this class`} />
        </div>
      )}
      <div className="hint" style={{ marginTop: 6 }}>
        Across the table: <strong>{seller.name}</strong>. {sellerProfile(seller.kind).blurb}
      </div>
      {talks && (
        <>
          <div className="grid" style={{ marginTop: 6 }}>
            <Row k="They want" v={usd(talks.theirPrice)} strong />
            <Row k="You offered" v={usd(talks.yourPrice)} />
            <Row k="Apart" v={usd(Math.max(0, talks.theirPrice - talks.yourPrice))}
              bad={talks.theirPrice - talks.yourPrice > talks.yourPrice * 0.08} />
            <Row k="Rounds" v={talks.final ? "their final word" : `${talks.round} of ${talks.maxRounds}`} bad={talks.final} />
          </div>
          <div className="hint">{talks.note}</div>
        </>
      )}
      {others.length > 0 && (
        <div className="hint">
          Also on the table: {others.map((t) => `${parcels[t.bbl]?.address ?? t.bbl} at ${usd(t.agreedPrice ?? t.theirPrice)}${t.agreed ? " (under contract)" : ""}`).join(" · ")}.
          {atLimit && " That is as many as you can hold — close one or walk away before opening another."}
        </div>
      )}
      <label className="hint" style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
        <input type="checkbox" checked={isFinal} onChange={(e) => setIsFinal(e.target.checked)} />
        Best and final — they answer once, and a no ends it for both sides
      </label>
      <div className="btn-row">
        <button
          className="btn btn-buy"
          disabled={atLimit || (!!talks && talks.final && offerPrice < talks.theirPrice)}
          onClick={() => { useStore.getState().offer(bbl, offerPrice, isFinal); setIsFinal(false); }}
        >
          {talks ? `Counter at ${usd(offerPrice)}` : `Offer ${usd(offerPrice)}`}{isFinal ? " — final" : ""}
        </button>
        {talks && (
          <>
            <button className="btn btn-buy" onClick={() => useStore.getState().acceptCounter(bbl)}
              title={`Take their number and go under contract. ${usd(Math.round(talks.theirPrice * DEPOSIT_PCT))} of earnest money goes hard today; the rest is due in three months.`}>
              Take {usd(talks.theirPrice)}
            </button>
            <button className="btn" onClick={() => useStore.getState().walkAway(bbl)}>Walk away</button>
          </>
        )}
      </div>
      {talks?.final && offerPrice < talks.theirPrice && (
        <div className="hint">They have stopped moving. Take {usd(talks.theirPrice)} or walk.</div>
      )}
      <div className="hint dim">
        Agreeing a price puts you under contract and {usd(Math.round(offerPrice * DEPOSIT_PCT))} of earnest money
        goes hard the same day. The lender, the leverage and the cheque come after that, and you get three months
        to arrange them — miss it and the deposit is theirs.
      </div>
    </>
  );
}

/**
 * THE MONEY. Only ever shown against a price that is already agreed.
 */
function BuyButtons({ bbl, price, off, closeLabel, bid }: {
  bbl: string; price: number; off: boolean; closeLabel?: string;
  /** A blind bid, which is a price nobody has agreed to yet. Passed through to
   *  buyOffMarket so bidBlind sees a number; omitted on the named-ask path,
   *  where the engine funds `approaches[bbl].ask` and there is nothing to
   *  invent. */
  bid?: number;
}) {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const { buyOff } = useStore.getState();
  const isLand = parcels[bbl]?.class === "land";
  const [product, setProduct] = useState<string>(isLand ? "land" : "savings");
  const [lev, setLev] = useState(1);
  const offerPrice = Math.round(price);
  const max = buyQuote(game, parcels, bbl, offerPrice, product, 1);
  const principal = Math.round(max.principal * lev);
  const equity = offerPrice - principal + Math.round(offerPrice * 0.02);
  const rec = parcels[bbl];
  const noi = rec ? noiAfterTaxYr(rec, game.econ, initialCondition(rec), offerPrice) : 0;
  // ACTUAL first-year debt service — amortizing payment for amortizing paper,
  // coupon-only for IO periods — not the IO approximation for everything.
  const prodDef = PRODUCTS.find((pp) => pp.id === product);
  const annualDs = principal > 0
    ? (prodDef && prodDef.ioM > 0
      ? principal * (max.ratePct / 100)
      : annualPayment(principal, max.ratePct, prodDef?.amortYears ?? 30))
    : 0;
  const dscrNow = annualDs > 0 ? noi / annualDs : null;
  return (
    <>
      <div className="btn-row" style={{ marginTop: 8 }}>
        {/* dirt has its own desk; income paper won't look at a vacant lot.
            Every card quotes its rate LIVE — the coupon belongs on the term
            sheet, not two clicks behind it. */}
        {PRODUCTS.filter((p) => !p.mezz && (isLand ? p.id === "land" : p.id !== "land")).map((p) => {
          const pq = buyQuote(game, parcels, bbl, offerPrice, p.id, 1);
          return (
            <button key={p.id} className={"btn" + (product === p.id ? " btn-on" : "")} title={p.blurb} onClick={() => setProduct(p.id)}>
              {p.label}{pq.principal > 0 ? ` · ${pq.ratePct.toFixed(2)}%` : " · won't quote"}
            </button>
          );
        })}
        <button className={"btn" + (product === "cash" ? " btn-on" : "")} title="No debt at all." onClick={() => setProduct("cash")}>
          All cash
        </button>
      </div>
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
      {/* WHY THE LOAN IS THE SIZE IT IS.
          A desk sizes on three tests and takes the smallest: the advance rate,
          the coverage ratio, and the debt yield. Which one bound was computed
          and never shown, so a lender with a 72% advance rate quoting 47%
          looked arbitrary instead of arithmetical — and the answer changes
          with the index, which is exactly the thing worth understanding. */}
      {max.principal > 0 && (
        <div className="hint">
          {max.bind === "appraisal"
            ? `The lender underwrote ${usd(max.uwBasis ?? 0)}, not your ${usd(offerPrice)} — they ordered their own appraisal and it came back at ${usd(max.appraised ?? 0)}. `
              + `They advance against the LESSER of that and what you agreed to pay, so the ${usd(max.overpay ?? 0)} above it is entirely yours. `
              + `Their collateral is the building, not your enthusiasm for it.`
            : max.bind === "ltv"
            ? `Sized at this lender's ${(max.ltvCap * 100).toFixed(0)}% advance rate — the ceiling, and the income clears it comfortably.`
            : max.bind === "dscr"
              ? `Their advance rate is ${(max.ltvCap * 100).toFixed(0)}%, but you are getting ${((max.principal / Math.max(1, offerPrice)) * 100).toFixed(0)}% — COVERAGE is binding, not leverage. `
                + `At a ${max.ratePct}% coupon the income only services ${(max.principal / Math.max(1, offerPrice) * 100).toFixed(0)}% of the price at ${max.uwDscr.toFixed(2)}x. `
                + `That is what a high index does: the cap rate you buy at has to carry the coupon you borrow at, and when it cannot, the loan shrinks.`
              : max.bind === "dy"
                ? `Their advance rate is ${(max.ltvCap * 100).toFixed(0)}%, but the DEBT YIELD test is binding — the income is too thin against the loan for this desk, regardless of what the building is worth.`
                : `Their advance rate is ${(max.ltvCap * 100).toFixed(0)}%, cut back by the credit window and your own record. Leverage comes back when money does.`}
        </div>
      )}
      {max.principal > 0 ? (
        <div style={{ display: "none" }} />
      ) : (
        <div className="hint">{product === "cash" ? "Buying it outright." : "No lender will size a loan against this income — all cash or nothing."}</div>
      )}
      {/* The underwriting, before you commit. Going-in cap is what you are
          paying for the income; debt yield is what the lender thinks of it;
          cash-on-cash is what actually lands in your account in year one. A
          deal where the going-in cap sits below the coupon is negative
          leverage — it can still be right, but only if you are buying the
          upside, and you should have to see that you are. */}
      <div className="grid">
        {rec && rec.class !== "land" && rec.bldgArea > 0 && (() => {
          const goingIn = offerPrice > 0 ? (noi / offerPrice) * 100 : 0;
          const dy = principal > 0 ? (noi / principal) * 100 : 0;
          const cf = noi - annualDs;
          const coc = equity > 0 ? (cf / equity) * 100 : 0;
          const negLev = principal > 0 && goingIn < max.ratePct;
          return (
            <>
              <Row k="Going-in cap" v={`${goingIn.toFixed(2)}%`} bad={negLev} />
              <Row k="Coupon" v={`${max.ratePct.toFixed(2)}%${negLev ? " — negative leverage" : ""}`} bad={negLev} />
              {principal > 0 && <Row k="Debt yield" v={`${dy.toFixed(1)}%`} bad={dy < 8} />}
              {principal > 0 && <Row k="Annual debt service" v={`−${usd(annualDs)}${prodDef && prodDef.ioM > 0 ? " (interest-only)" : ` (${prodDef?.amortYears ?? 30}-yr am)`}`} />}
              <Row k="Year-1 cash flow" v={usd(cf)} bad={cf < 0} />
              <Row k="Cash-on-cash" v={`${coc.toFixed(1)}%`} bad={coc < 0} />
            </>
          );
        })()}
        <Row k="Equity to close" v={usd(equity)} strong bad={equity > game.cash} />
      </div>
      <div className="btn-row">
        <button
          className="btn btn-buy"
          disabled={equity > game.cash}
          onClick={() => {
            const prod = principal <= 0 ? "cash" : product;
            const l = principal <= 0 ? 1 : lev;
            if (off) buyOff(bbl, prod as never, l, bid);
            else useStore.getState().closeDeal(bbl, prod, l);
          }}
        >
          {closeLabel ?? `Close at ${usd(offerPrice)}`} · eq {usd(equity)}
        </button>
        {!off && (
          <button className="btn" onClick={() => useStore.getState().walkAway(bbl)}
            title="Tear up the contract. The building goes back on the market and the seller keeps the deposit.">
            Tear it up
          </button>
        )}
      </div>
      {equity > game.cash && <div className="hint">Short {usd(equity - game.cash)} — the line of credit is on the Books page.</div>}
    </>
  );
}

// Refinancing is a market, not a button: two products, what each will
// actually advance today, and a dial for how much of it you take.
function RefiSection({ bbl }: { bbl: string }) {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const { refi } = useStore.getState();
  const isLand = resolveRec(parcels, game, bbl)?.class === "land";
  const [product, setProduct] = useState<string>(isLand ? "land" : "savings");
  const [lev, setLev] = useState(1);
  const { quotes, value, payoff } = refiQuotes(game, parcels, bbl);
  const cur = game.holdings[bbl]?.loan;
  const existing = cur ? prepayPenalty(cur, game.month) : 0;
  if (!quotes.length) {
    return (
      <div className="refi">
        <div className="deal-head">Refinance</div>
        <div className="hint">
          No desk will quote against this today. Appraised at {usd(value)}{payoff > 0 ? `, ${usd(payoff)} outstanding` : ""} —
          the income is not there, or the credit window is shut.
        </div>
      </div>
    );
  }
  const q = quotes.find((x) => x.id === product) ?? quotes[0];
  const proceeds = Math.round(q.maxProceeds * lev);
  const fee = Math.round(Math.max(proceeds, payoff) * 0.01) + Math.round(proceeds * q.points) + existing;
  const toYou = proceeds - payoff - fee;
  // real annuity, not "coupon times 1.28" — the old shortcut overstated a
  // 30-yr amort by a full point of proceeds at today's rates
  const annualDs = q.ioM > 0 ? (proceeds * q.ratePct) / 100 : annualPayment(proceeds, q.ratePct, q.amortYears);
  return (
    <div className="refi">
      <div className="deal-head">Refinance</div>
      <div className="hint">Appraised at {usd(value)}; {usd(payoff)} to pay off.</div>
      {existing > 0 && (
        <div className="hint">
          {existing > 0
            ? `Breaking the loan you have costs ${usd(existing)} in ${game.holdings[bbl]?.loan?.prepay === "yieldmaint" ? "yield maintenance" : "prepayment penalty"}.`
            : ""}
        </div>
      )}
      <div className="btn-row">
        {quotes.map((x) => (
          <button
            key={x.id}
            className={"btn" + (product === x.id ? " btn-on" : "")}
            disabled={!x.available}
            title={x.why ?? x.blurb}
            onClick={() => setProduct(x.id)}
          >
            {x.label} · {pct(x.ratePct)}
          </button>
        ))}
      </div>
      <div className="hint">{q.why ?? q.blurb}</div>

      {/* EVERY DESK AT ONCE, AND WHAT STOPPED EACH ONE.
          The complaint that started this was a $700M building with $130M of
          debt where every refinance option asked for money instead of giving
          it. The capital was there the whole time — the reason was not. Four
          desks quoted small for FOUR DIFFERENT reasons (a hold size, a minimum
          check, a shut securitisation window, a sponsor mark), and all four
          presented identically as "pay money in", so the screen read as one
          wall instead of four different ones with four different ways round.
          Reading them one at a time by clicking each button is not a market;
          this is the market. Sorted by what actually reaches your account. */}
      <div className="page-section" style={{ marginTop: 8 }}>The market for this building</div>
      <div className="scroll-x">
        <table className="tbl">
          <thead>
            <tr><th>Desk</th><th className="num">Rate</th><th className="num">Most they'll write</th><th className="num">To you</th><th>What stops them</th></tr>
          </thead>
          <tbody>
            {[...quotes]
              .map((x) => {
                const px = Math.round(x.maxProceeds);
                const f = Math.round(Math.max(px, payoff) * 0.01) + Math.round(px * x.points) + existing;
                return { x, px, net: px - payoff - f };
              })
              .sort((a, b) => b.net - a.net)
              .map(({ x, px, net }) => (
                <tr
                  key={x.id}
                  className={x.id === product ? "" : "dim"}
                  style={{ cursor: x.available ? "pointer" : "default" }}
                  onClick={() => x.available && setProduct(x.id)}
                >
                  <td>{x.label}</td>
                  <td className="num">{x.available ? pct(x.ratePct) : "—"}</td>
                  <td className="num">{px > 0 ? usd(px) : "—"}</td>
                  <td className="num" style={{ color: net > 0 ? undefined : "#a8402e" }}>
                    {px > 0 ? (net >= 0 ? usd(net) : "−" + usd(-net)) : "—"}
                  </td>
                  {/* The reason, in the lender's own words when there is one,
                      and otherwise the test that actually bound. Never blank —
                      a quote with no reason is the same defect as a dead
                      button, which is what this whole card is fixing. */}
                  <td className="dim">{x.why ?? (px > 0 ? x.binding : "nothing to lend against")}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <div className="grid">
        <Row k="Lender's maximum" v={`${usd(q.maxProceeds)} · ${(q.ltvAtMax * 100).toFixed(0)}% LTV`} />
        {/* A vacant site has no income, so a coverage ratio computed against it
            is not a small number — it is nonsense, and it was being printed
            six digits wide in front of the player. */}
        <Row
          k="Coverage / debt yield"
          v={q.maxProceeds > 0 && Number.isFinite(q.dscrAtMax) && q.dscrAtMax > 0
            ? `DSCR ${q.dscrAtMax.toFixed(2)} · DY ${(q.debtYieldAtMax * 100).toFixed(1)}%`
            : "— no income to cover it"}
        />
        <Row k="What caps it" v={q.maxProceeds > 0 ? q.binding : "nothing to lend against"} bad={q.binding === "debt yield" && q.maxProceeds > 0} />
        <Row k="Structure" v={`${q.ioM ? `${Math.round(q.ioM / 12)}-yr IO, ` : ""}${q.amortYears}-yr amort, ${q.termM / 12}-yr term, ${q.floating ? "floating" : "fixed"}`} />
        <Row k="Origination" v={`${(q.points * 100).toFixed(1)} pts · ${usd(Math.round(proceeds * q.points))}`} />
        <Row
          k="Prepayment"
          v={q.prepay === "open" ? "open — leave any time"
            : q.prepay === "stepdown" ? `step-down, ${q.prepayM / 12} yrs (5% falling to 1%)`
            : `yield maintenance, ${q.prepayM / 12} yrs`}
          bad={q.prepay === "yieldmaint"}
        />
        <Row k="Recourse" v={q.recourse ? "yes — you sign personally" : "non-recourse"} bad={q.recourse} />
        {q.kicker !== undefined && <Row k="Lender's share of gain" v={`${(q.kicker * 100).toFixed(0)}% on sale`} bad />}
      </div>
      <Slider
        label="Take"
        value={lev}
        min={0}
        max={1}
        step={0.02}
        onChange={setLev}
        format={() => `${usd(proceeds)} · ${((proceeds / Math.max(1, value)) * 100).toFixed(0)}% LTV`}
        marks={[{ at: 0.5, label: "half" }, { at: 0.8, label: "80%" }, { at: 1, label: "max" }]}
        hint={`${usd(annualDs)} a year of debt service. ${toYou >= 0 ? `Cash out ${usd(toYou)} after the ${usd(fee)} fee.` : `You'd write a cheque for ${usd(-toYou)}.`}`}
      />
      <div className="btn-row">
        <button className="btn btn-buy" disabled={proceeds < 100_000} onClick={() => refi(bbl, product, lev)}>
          {toYou >= 0 ? `Refinance · take ${usd(toYou)}` : `Refinance · pay in ${usd(-toYou)}`}
        </button>
      </div>
    </div>
  );
}

/**
 * WHAT THE STACK BECOMES when the shops run into the two-storey cap.
 *
 * The planner has always done this to the programme: retail past two floor
 * plates goes to the uses that can carry height, because a developer who
 * cannot put shops on the ninth floor puts offices there — they do not shrink
 * the building. The dial did not know that, and the gap between the two was
 * the bug. Measured on the lot that produced the complaint, 4,218 sf at 22.5
 * FAR: twenty-five storeys with the shops dial at 95% read 88,730 sf of
 * retail off the slider, and the job it described broke ground as 7,472 sf of
 * shops under an office tower. The overflow now lands where the planner puts
 * it, in front of the player, while there is still a decision to take.
 */
type Stack = { retail: number; office: number; multifamily: number };
function capStack(p: Stack, retailMaxPct: number): Stack {
  if (p.retail <= retailMaxPct) return p;
  const rest = p.office + p.multifamily;
  const office = rest > 0
    ? Math.round((p.office * (100 - retailMaxPct)) / rest)
    : Math.round((100 - retailMaxPct) / 2);
  return { retail: retailMaxPct, office, multifamily: 100 - retailMaxPct - office };
}

function DevelopSection({ bbl }: { bbl: string }) {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  // The LIVE record: an upzoning, a variance you won, or lots you folded
  // together all change the envelope, and planning against the static table
  // meant none of them bought you anything at this desk.
  const rec = resolveRec(parcels, game, bbl) ?? parcels[bbl];
  const [use, setUse] = useState<DevUse>("office");
  const [cov, setCov] = useState(0.6);
  const [floors, setFloors] = useState(8);
  const [contract, setContract] = useState<Contract>("gmp");
  const [ltcWant, setLtcWant] = useState(1);   // share of the lender's max you take
  const [bank, setBank] = useState<string>(CONSTRUCTION_LENDER);   // who writes the construction loan
  // THE STACK IS YOURS TO CHOOSE. "Mixed-use" was one canonical 15/45/40
  // building, which is a preset rather than a programme — how much retail the
  // frontage carries and whether the middle is offices or flats is the biggest
  // decision on the site, and it drives cost, exit cap and lender appetite.
  const [split, setSplit] = useState<{ retail: number; office: number; multifamily: number }>(
    { retail: 15, office: 45, multifamily: 40 },
  );
  // ...and so is how it is cut up. `null` means the class default.
  const [units, setUnits] = useState<Partial<Record<BuiltClass, number>>>({});
  const maxFl = maxFloorsFor(rec, cov, use);
  const fl = Math.min(floors, maxFl);
  // SHOPS DO NOT STACK, AND THE DIAL NOW SAYS SO. Two floor plates is the
  // whole retail allowance, so the ceiling on the shops dial falls as the
  // storeys rise — a quarter of an eight storey building, eight per cent of a
  // twenty-five storey one — and the stack the planner reads is the stack on
  // the screen. The dial used to run to 100% at any height and report the
  // whole building as shops; the planner redistributed it regardless, so the
  // design the player was reading was one no job could ever be.
  const retailPctMax = Math.max(0, Math.floor(maxRetailShare(fl) * 100));
  const stack = capStack(split, retailPctMax);
  const customMix = use === "mixed"
    ? { retail: stack.retail / 100, office: stack.office / 100, multifamily: stack.multifamily / 100 }
    : undefined;
  const planMax = planDevelopment(game, parcels, bbl, use, fl, cov, contract, undefined, { mix: customMix }, bank);
  // Turn the chosen unit counts into sf-per-space, against the programme that
  // is actually going to be built.
  const suiteChoice: Partial<Record<BuiltClass, number>> = {};
  if (planMax) {
    for (const u of Object.keys(planMax.mix) as BuiltClass[]) {
      const n = units[u];
      if (!n) continue;
      suiteChoice[u] = suiteSfForUnits(planMax.sf * (planMax.mix[u] ?? 0), u, n);
    }
  }
  const plan = planDevelopment(game, parcels, bbl, use, fl, cov, contract,
    planMax ? planMax.ltcMax * ltcWant : undefined, { mix: customMix, suites: suiteChoice }, bank);
  // ONE NUMBER, WHEREVER IT IS ASKED FOR. The equity figure on the dials and
  // the equity figure on the groundbreak button are the same decision — what
  // this design costs you in your own money, all in — and two call sites that
  // happen to read the same field are one edit away from disagreeing, which
  // is exactly what this card was accused of. Every equity read below goes
  // through these two: the whole cheque, and whether you can write it.
  const equityRequired = (plan?.equity ?? 0) + (plan?.pointsCost ?? 0);   // origination is cash at close, so it belongs on the cheque
  const canFund = equityRequired <= game.cash + locAvailable(game, parcels);
  const USES: DevUse[] = ["office", "multifamily", "mixed", "retail", "industrial"];
  return (
    <div className="deal">
      <div className="deal-head">Develop this lot</div>
      <div className="hint">
        {sf(rec.lotArea)} of land · envelope {farMaxFor(rec).toFixed(1)} FAR · anything may be built here.
      </div>
      <div className="btn-row">
        {USES.map((u) => (
          <button key={u} className={"btn" + (use === u ? " btn-on" : "")} onClick={() => setUse(u)}>{devUseLabel(u)}</button>
        ))}
      </div>
      {/* THE CHEQUE, WHERE THE DIALS ARE. The all-in equity lived at the bottom
          of the card, under the cost stack — so you moved the storeys slider
          blind and scrolled down to learn what the design you just made costs.
          The number a designer is actually trading against belongs on the dial. */}
      {plan && (
        <div className="grid" style={{ margin: "4px 0 2px" }}>
          <Row
            k="Equity required"
            v={`${usd(equityRequired)} of ${usd(plan.basisTotal)} all in · $${(plan.basisTotal / Math.max(1, plan.sf)).toFixed(0)}/sf`}
            strong
            bad={!canFund}
            title="All in is land, construction, contingency, the lease-up and interest reserves and the origination fee. The dirt is already paid for, so it is not part of the equity you still have to write — but it is part of what this building has cost you when it opens."
          />
        </div>
      )}
      <Slider
        label="Stories"
        value={fl}
        min={1}
        max={maxFl}
        step={1}
        onChange={setFloors}
        format={(v) => `${v} ${v === 1 ? "floor" : "floors"}`}
        marks={[{ at: Math.max(1, Math.round(maxFl * 0.25)), label: "low" }, { at: Math.max(1, Math.round(maxFl * 0.6)), label: "mid" }, { at: maxFl, label: `max ${maxFl}` }]}
        hint={use === "retail"
          // Shops do not stack: the second floor already trades at a discount
          // to the first and above that nobody goes. The tall version of this
          // building is a mixed one with the shops at grade.
          ? `Shops are two storeys. The second floor already rents at a discount to the first and there is no third — what you want on a site this size is ${retailWantsMixed(rec, cov) ? "the mixed-use programme, which puts shops at grade under offices and flats" : "exactly this"}.`
          : plan
            ? `${sf(plan.sf)} of building at ${plan.far} FAR (envelope ${plan.farMax.toFixed(1)}). The cap is zoning AND engineering — a tower needs a real floor plate (4,000+ sf for a core, ~15:1 slenderness at the limit), so a small plate tops out low no matter what the FAR allows.`
            : undefined}
      />
      <Slider
        label="Footprint"
        value={cov}
        min={0.08}
        max={0.9}
        step={0.01}
        onChange={(v) => { setCov(v); setFloors((f) => Math.min(f, maxFloorsFor(rec, v, use))); }}
        format={(v) => `${Math.round(v * 100)}% of the lot · ${sf(rec.lotArea * v)} plate`}
        marks={[{ at: 0.15, label: "corner" }, { at: 0.35, label: "tower" }, { at: 0.6, label: "block" }, { at: 0.85, label: "podium" }]}
        hint={`A slim tower goes higher on the same envelope; a fat podium runs out of FAR sooner (max ${maxFl} floors at this footprint). On a big site you can put up something small and keep the rest of the land.`}
      />
      {/* THE STACK. Three dials that always add to a hundred, because a
          building is all of itself. Shops want the frontage and cost the most
          per foot; flats are cheapest to build and hardest to make pencil;
          offices are the swing. */}
      {use === "mixed" && (
        <>
          <div className="page-section" style={{ marginTop: 6 }}>What goes where</div>
          {(["retail", "office", "multifamily"] as const).map((u) => (
            <Slider
              key={u}
              label={USE_WORD[u]}
              value={stack[u]}
              min={0}
              max={u === "retail" ? retailPctMax : 100}
              step={u === "retail" && retailPctMax < 20 ? 1 : 5}
              onChange={(v) => setSplit(() => {
                // The other two absorb the difference in the ratio they already
                // sit in, so moving one dial never silently rewrites both.
                // They move from the stack on the screen rather than the one
                // in state, because the two differ whenever the retail cap is
                // biting and it is the screen the player is arguing with.
                const others = (["retail", "office", "multifamily"] as const).filter((k) => k !== u);
                const restNow = others.reduce((a, k) => a + stack[k], 0);
                const rest = 100 - v;
                const next = { ...stack, [u]: v } as Stack;
                for (const k of others) next[k] = restNow > 0 ? Math.round((stack[k] / restNow) * rest) : Math.round(rest / 2);
                next[others[1]] = Math.max(0, 100 - v - next[others[0]]);
                return next;
              })}
              format={(v) => `${v}%${planMax ? ` · ${sf(Math.round(planMax.sf * (planMax.mix[u] ?? 0)))}` : ""}`}
              marks={u === "retail"
                ? [{ at: retailPctMax, label: `max ${retailPctMax}%` }]
                : [{ at: 15, label: "" }, { at: 50, label: "half" }]}
              hint={u === "retail"
                ? `Shops at grade and one above it — past the second floor nobody comes, so two floor plates is the whole allowance, which on ${fl} ${fl === 1 ? "storey" : "storeys"} is ${retailPctMax}% of the building and no more. Take the storeys down if you want a shop building; leave them up and the offices and flats take the height.`
                : u === "office" ? "The swing leg: the highest rent of the three and the one that empties first in a downturn."
                : "Flats are the cheapest to build and the thinnest margin. They also let in every market, which is the point of putting them in the stack."}
            />
          ))}
          <div className="hint">
            {stack.retail + stack.office + stack.multifamily !== 100
              ? "The stack has to add to 100%."
              : `Shops ${stack.retail}% · offices ${stack.office}% · flats ${stack.multifamily}%. Anything under 3% is dropped — that is a lobby, not a use.`}
          </div>
        </>
      )}
      {/* HOW MANY SPACES. A programming decision with physical bounds: you
          cannot put ten shops in three thousand feet, and a single "unit" the
          size of a tower is a headquarters, not a building. */}
      {planMax && (
        <>
          <div className="page-section" style={{ marginTop: 6 }}>How it is cut up</div>
          {(Object.keys(planMax.mix) as BuiltClass[]).filter((u) => (planMax.mix[u] ?? 0) > 0.02).map((u) => {
            const legSf = planMax.sf * (planMax.mix[u] ?? 0);
            const r = unitRange(legSf, u);
            const n = units[u] ?? r.typical;
            const per = suiteSfForUnits(legSf, u, n);
            return (
              <Slider
                key={u}
                label={`${USE_WORD[u]} spaces · ${sf(Math.round(legSf))}`}
                value={Math.max(r.min, Math.min(r.max, n))}
                min={r.min}
                max={r.max}
                step={1}
                onChange={(v) => setUnits((p) => ({ ...p, [u]: v }))}
                format={(v) => `${v} ${v === 1 ? "space" : "spaces"} · ${sf(per)} each`}
                marks={[{ at: r.typical, label: "typical" }, { at: r.max, label: `max ${r.max}` }]}
                hint={per <= SUITE_BOUNDS[u].min * 1.15
                  ? `${sf(SUITE_BOUNDS[u].min)} is the floor for ${USE_WORD[u].toLowerCase()} — below that it is not a space, it is a cupboard.`
                  : per >= SUITE_BOUNDS[u].max * 0.85
                    ? "Spaces this big mean one tenant, or none. Single-tenant buildings are a real product and a slow let."
                    : "Small spaces lease faster and cost far more to fit out and to run. Big ones sit empty longer and almost never turn."}
              />
            );
          })}
        </>
      )}
      <div className="btn-row">
        {/* The contract is the developer's real hedge and nobody ever shows it
            to you. In a boom the guaranteed price is the cheapest money on the
            board; in a flat market it is four points of nothing. */}
        <button
          className={"btn" + (contract === "gmp" ? " btn-on" : "")}
          title="Guaranteed maximum price: +4% on hard cost, and the contractor carries escalation and most change orders."
          onClick={() => setContract("gmp")}
        >
          Guaranteed max price
        </button>
        <button
          className={"btn" + (contract === "costplus" ? " btn-on" : "")}
          title="Cost-plus: cheaper today, but the unspent budget moves with the market and every change order is yours."
          onClick={() => setContract("costplus")}
        >
          Cost-plus
        </button>
      </div>
      {/* THE DESKS. One row of small cards where the facility used to be
          dictated: the same balance sheets the perm quotes read, quoting
          construction. A desk that is impaired, in receivership, or past its
          hold size says so instead of quoting. */}
      {plan && (
        <div className="btn-row" style={{ marginTop: 6 }}>
          {constructionQuotes(game, plan.mix, plan.costTotal).map((q) => (
            <button
              key={q.lender}
              className={"btn" + (plan.lender === q.lender ? " btn-on" : "")}
              disabled={!q.open}
              title={q.why ?? lenderBlurb(q.lender)}
              onClick={() => setBank(q.lender)}
            >
              {q.lender.split(" ")[0]} · {q.open ? `${pct(q.ratePct)} · ${Math.round(q.ltcMax * 100)}% LTC · ${(q.points * 100).toFixed(1)} pts` : "not quoting"}
            </button>
          ))}
        </div>
      )}
      {plan && plan.ltcMax > 0 && (
        <Slider
          label="Construction leverage"
          value={ltcWant}
          min={0}
          max={1}
          step={0.05}
          onChange={setLtcWant}
          format={() => plan.commitment > 0
            ? `${Math.round(plan.ltc * 100)}% of cost · ${usd(plan.commitment)}`
            : "all equity"}
          marks={[{ at: 0, label: "all equity" }, { at: 0.7, label: "" }, { at: 1, label: `max ${Math.round((plan.ltcMax) * 100)}%` }]}
          hint={`The lender will go to ${Math.round(plan.ltcMax * 100)}% of cost on this deal. Take less and the equity cheque grows but the takeout loan you inherit at delivery shrinks — an empty building with a small loan survives a slow lease-up; one with a big loan doesn't.`}
        />
      )}
      {plan ? (
        <>
          <div className="grid" style={{ marginTop: 8 }}>
            <Row k="Building" v={`${sf(plan.sf)} · ${plan.floors} fl · ${(plan.floors * 3.4).toFixed(0)} m tall`} strong />
            <Row k="FAR used" v={`${plan.far} of ${plan.farMax.toFixed(1)}`} />
            <Row k="Hard cost" v={`${usd(plan.hardCost)} · $${(plan.hardCost / Math.max(1, plan.sf)).toFixed(0)}/sf`} />
            <Row k="Soft cost" v={usd(plan.softCost)} />
            {plan.demo > 0 && <Row k="Demolition" v={usd(plan.demo)} />}
            <Row k="Contingency" v={`${usd(plan.contingency)} · yours if unspent`} />
            <Row k="Lease-up reserve" v={`${usd(plan.leaseUp)} · fit-out, commissions and carry until it is full`} />
            {/* THE ROW LABELLED "ALL IN" WAS NOT ALL IN.
                It showed costTotal — hard, soft, demolition, contingency and
                the lease-up reserve — which leaves out the two largest things
                a developer's all-in number exists to include: the dirt, and
                the cost of financing it. The yield on cost three rows down was
                already dividing by basisTotal, which has both. So the panel
                was showing one number called "all in" and computing the
                headline metric off a different, bigger one, and a player
                checking the arithmetic could not make them meet. */}
            <Row k="Cost to build" v={`${usd(plan.costTotal)} · $${(plan.costTotal / Math.max(1, plan.sf)).toFixed(0)}/sf`} />
            <Row
              k={`Construction loan (${Math.round(plan.ltc * 100)}% of cost)`}
              v={plan.commitment > 0 ? `${usd(plan.commitment)} @ ${pct(plan.ratePct)} · ${plan.lender} · ${(plan.points * 100).toFixed(1)} pts (${usd(plan.pointsCost)}) at close` : "none — nobody will fund it"}
              bad={plan.commitment === 0 && plan.ltcMax > 0 && ltcWant > 0}
            />
            <Row k="Interest reserve" v={plan.interestReserve > 0 ? `${usd(plan.interestReserve)} — the lender carries it, not you` : "—"} />
            {/* The dirt is sunk — you already wrote that cheque — but it is the
                first and least recoverable dollar in the deal and it is why a
                corner that rents for twice as much does not build for twice
                the profit. It belongs in the denominator, so it belongs on the
                page. */}
            <Row k="Land in the basis" v={`${usd(plan.landBasis)} · $${(plan.landBasis / Math.max(1, plan.sf)).toFixed(0)}/sf of building`} />
            <Row
              k="ALL IN"
              v={`${usd(plan.basisTotal)} · $${(plan.basisTotal / Math.max(1, plan.sf)).toFixed(0)}/sf`}
              strong
              title={"Land, construction, contingency, the lease-up reserve, the interest reserve and the origination fee — everything that has to be spent before this building is worth what it is worth. "
                + "This is the number the yield on cost below divides by, and the one to hold against what finished buildings on this street actually trade for per square foot: "
                + `build at $${(plan.basisTotal / Math.max(1, plan.sf)).toFixed(0)}/sf into a market that pays less than that and the spread is negative before you start.`}
            />
            {/* The two numbers that decide whether this is a development or a
                donation: what it yields on what it costs, against what the
                market will pay for it when it is finished. */}
            <Row
              k="Yield on cost"
              v={`${plan.yieldOnCost.toFixed(2)}% vs ${plan.exitCap.toFixed(2)}% exit · ${(plan.yieldOnCost - plan.exitCap) >= 0 ? "+" : ""}${((plan.yieldOnCost - plan.exitCap) * 100).toFixed(0)} bps`}
              strong
              bad={plan.yieldOnCost - plan.exitCap < 0.75}
            />
            {/* WHAT THIS ACTUALLY COSTS YOU, in the order it leaves your
                account. The total led with "equity at close" and buried the
                total above it, so a job that wanted $9M of equity looked like
                a $5M decision and then quietly drew the other $4M over two
                years. The whole cheque goes first now. */}
            <Row k="EQUITY REQUIRED, ALL IN" v={usd(equityRequired)} strong bad={!canFund} />
            <Row k="— of that, at close" v={`${usd(plan.equityAtClose)} — the bank funds nothing until yours is in`} />
            <Row
              k="— of that, drawn as it rises"
              v={`${usd(plan.equity - plan.equityAtClose)} over about ${plan.months} months, before the loan funds a dollar`}
              bad={plan.equity - plan.equityAtClose > game.cash - plan.equityAtClose}
            />
            <Row
              k="Change-order margin"
              v={`${usd(plan.contingency)} of contingency${plan.contract === "gmp" ? ", and the GC carries most of what is past it" : " — past it, every dollar is yours under cost-plus"}`}
              bad={plan.contract === "costplus"}
            />
            <Row k="Schedule" v={plan.months + " months, built on spec"} />
          </div>
          {plan.lenderNote && <div className="hint">{plan.lenderNote}</div>}
          <div className="hint">
            <b>{usd(plan.equityAtClose)}</b> leaves your account the day you break ground and{" "}
            <b>{usd(plan.equity - plan.equityAtClose)}</b> more is drawn out of it as the building rises — equity funds
            first and in full, and the construction loan does not advance a dollar until it is spent. Budget for the
            whole {usd(equityRequired)}, not the first cheque.
          </div>
          <div className="btn-row">
            <button
              className="btn btn-buy"
              disabled={plan.equityAtClose + plan.pointsCost > game.cash || !canFund}
              onClick={() => useStore.getState().develop(bbl, use, fl, cov, contract, plan.ltcMax * ltcWant, { mix: customMix, suites: suiteChoice }, plan.lender)}
              title={`${usd(plan.equityAtClose)} leaves your account today and ${usd(plan.equity - plan.equityAtClose)} more is drawn as the building rises.`}
            >
              Break ground · {usd(equityRequired)} of equity required
            </button>
          </div>
        </>
      ) : (
        <div className="hint">Too small to build — add floors or cover more of the lot.</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- full pages
// A property deserves a room, not a column. Same content as the docked card,
// laid out three-wide so the rent roll and the debt sit side by side.
function PropertyPage() {
  const parcels = useStore((s) => s.parcels)!;
  const game = useStore((s) => s.game)!;
  const adjacency = useStore((s) => s.adjacency);
  const bbl = useStore((s) => s.selectedBBL);
  const [tab, setTab] = useState<PropTab>("summary");
  // A different building is a different file. Opening one and landing on the
  // last building's mortgage tab is how you misread a balance.
  useEffect(() => { setTab("summary"); }, [bbl]);
  if (!bbl) return <div className="hint">Nothing selected.</div>;
  const rec = resolveRec(parcels, game, bbl);
  if (!rec) return <div className="hint">Unknown parcel.</div>;
  const h = game.holdings[bbl];
  const cond = h?.condition ?? initialCondition(rec);
  const value = h ? holdingValue(rec, game.econ, h, game.month) : assetValue(rec, game.econ, cond);
  const built = rec.class !== "land" && rec.bldgArea > 0;
  const occ = h ? physicalOcc(rec as never, h) : occupancy(rec, game.econ);
  const noi = built ? (h ? holdingNOIYr(rec, game.econ, h, game.month) : noiYr(rec, game.econ, cond)) : 0;
  const dsYr = (h?.loan?.monthlyPmt ?? 0) * 12;
  const dev = game.developments[bbl];
  // WHICH DESKS THIS BUILDING HAS. A tab that would open on an empty page is
  // worse than no tab: it teaches the player that the page lies about where
  // things are. Assembly is the awkward one — the Land desk hides itself when
  // there is no adjoining deed of yours, so the tab has to ask the same
  // question the desk does.
  const ownsNeighbour = (adjacency?.[bbl] ?? []).some((n) => game.holdings[n]);
  const TABS: { key: PropTab; label: string; show: boolean }[] = [
    { key: "summary", label: "Overview", show: true },
    { key: "leasing", label: "Rent roll", show: !!h && built },
    { key: "money", label: "Money", show: !!h && (built || !!h.loan) },
    { key: "ops", label: "Operations", show: !!h && built },
    { key: "deal", label: h ? "Sell" : "Acquire", show: true },
    { key: "build", label: "Build", show: !!h && (rec.class === "land" || !!dev || ownsNeighbour) },
  ];
  const shown = TABS.filter((t) => t.show);
  // A tab can disappear under you — you sell the neighbouring lot and Build
  // goes with it. Fall back rather than render a page with nothing on it.
  const active = shown.some((t) => t.key === tab) ? tab : "summary";
  return (
    <div>
      <div className="stat-strip">
        <Big label="Appraisal" value={band(bbl, value)} />
        <Big label="NOI / yr" value={built ? usd(noi) : "—"} bad={noi < 0} />
        <Big label="Debt service / yr" value={dsYr ? "−" + usd(dsYr) : "—"} />
        <Big label="Cash flow / yr" value={usd(noi - dsYr)} bad={noi - dsYr < 0} />
        <Big label="Occupancy" value={built ? (occ * 100).toFixed(0) + "%" : "—"} bad={built && occ < 0.75} />
        {built && h && (() => {
          const u = unitStatus(rec, h, game.month);
          return <Big label="Spaces leased" value={`${u.leased} / ${u.total}`} bad={u.leased < u.total * 0.6} />;
        })()}
        {built && h && h.tenants.length > 0 && (
          <Big label="WALT" value={`${walt(h, game.month).toFixed(1)} yrs`} bad={walt(h, game.month) < 3} />
        )}
        {built && h && (
          <Big
            label="Expense leakage"
            value={`${(operatingStatement(rec, game.econ, h, game.month).leakage * 100).toFixed(0)}%`}
            bad={operatingStatement(rec, game.econ, h, game.month).leakage > 0.45}
          />
        )}
        {built && h && (
          <Big
            label="Roll quality"
            value={`${rollQualitySpread(rec, h, game.month, game.econ) >= 0 ? "+" : ""}${(rollQualitySpread(rec, h, game.month, game.econ) * 100).toFixed(0)} bps`}
            bad={rollQualitySpread(rec, h, game.month, game.econ) > 0.15}
          />
        )}
        {/* Concessions already granted and not yet burned off. A buyer credits
            this off the price at closing, so it moves the appraisal directly —
            and there was nowhere to see it. */}
        {built && h && remainingAbatement(h, game.month) > 0 && (
          <Big label="Free rent owed" value={"−" + usd(remainingAbatement(h, game.month))} bad />
        )}
        {/* THE SANITY CHECK EVERY DEVELOPER RUNS AND THIS GAME COULD NOT.
            Above replacement cost, somebody will build a competitor across the
            street. Below it, nobody can — and you are buying bricks for less
            than the bricks cost. */}
        {built && (() => {
          const rc = replacementCost(rec as never, game.econ);
          if (!rc) return null;
          const x = value / rc;
          return (
            <Big
              label="Value vs cost to build"
              value={`${x.toFixed(2)}×`}
              bad={x > 1.25}
            />
          );
        })()}
        <Big label="Equity" value={h ? usd(value - (h.loan?.balance ?? 0)) : "—"} />
      </div>
      <div className="prop-head">
        <div>
          <div className="page-title" style={{ fontSize: 22 }}>{rec.address}</div>
          <div className="panel-bbl mono">Parcel {rec.bbl} · {useLabel(rec)} · {rec.zoneDist}</div>
          {/* Every building in this game is somewhere. Closing the page and
              putting the camera on it is one click, not a hunt.
              AND SELLING IS THE OTHER ONE. The exit used to be the ninth card
              down a page that is mostly operating detail — which is the wrong
              way round, because the decision to sell is the one you open this
              page having already half made. */}
          <div className="btn-row" style={{ marginTop: 6 }}>
            {h && (
              <button className="btn btn-sell" onClick={() => setTab("deal")}
                title={h.sale ? "Your listing, the bids and the offers" : "Take it to market — quietly or as a campaign"}>
                {h.sale ? "◆ On the market — open the file" : "Sell this building"}
              </button>
            )}
            <button className="btn" onClick={() => useStore.getState().focus(bbl, true)}
              title="Close this page and fly the map to the building">
              ⌖ Go to property
            </button>
          </div>
        </div>
        <div className="grid" style={{ minWidth: 320 }}>
          {built && <Row k="Building" v={`${sf(rec.bldgArea)} · ${rec.floors} floors`} strong />}
          <Row k="Land" v={sf(rec.lotArea)} />
          <Row k="FAR built / envelope" v={`${(rec.bldgArea / Math.max(1, rec.lotArea)).toFixed(1)} / ${farMaxFor(rec).toFixed(1)}`} />
          <Row k="Buildable at max" v={`${sf(rec.lotArea * farMaxFor(rec))} · up to ${maxFloorsFor(rec, 0.6)} floors`} />
          {built && <Row k="Built" v={String(rec.yearBuilt)} />}
          <Row k="Demand" v={rec.demandScore + " / 100"} />
        </div>
      </div>
      {/* A default is not a tab. It is the only thing on the page that matters
          while it is running, so it stays above the tab bar on every one. */}
      <WorkoutDesk bbl={bbl} />

      <div className="prop-tabs">
        {shown.map((t) => (
          <button
            key={t.key}
            className={"prop-tab" + (active === t.key ? " on" : "")}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {active === "money" && <AssetHistory bbl={bbl} />}
      {active === "build" && <LandDesk bbl={bbl} />}
      {active === "build" && dev && (
        <div className="page-section">
          <div className="page-section-head">Under construction</div>
          <div className="grid">
            <Row k="Program" v={`${sf(dev.sf)} of ${dev.use} · ${dev.floors} floors`} strong />
            {/* THE BUDGET MOVES, AND SO DOES THE NUMBER THAT MATTERS.
                A job under way is not the job that was approved: change orders
                and cost-plus escalation grow costTotal every month it runs.
                Showing the budget alone made that invisible — the all-in per
                foot is the number a developer watches drift, because it is the
                one that decides whether the building is still worth finishing.
                Land is included for the same reason it is in the plan: it is
                in the basis the yield was underwritten against. */}
            <Row k="Budget" v={usd(dev.costTotal)} />
            <Row
              k="All in so far"
              v={`${usd(dev.costTotal + (dev.landBasis ?? 0) + dev.interestReserve)} · $${((dev.costTotal + (dev.landBasis ?? 0) + dev.interestReserve) / Math.max(1, dev.sf)).toFixed(0)}/sf`}
              strong
              title="Land, construction as it stands today including every change order booked so far, and the interest reserve. Compare it to what finished buildings on this street trade for per square foot — if the budget has drifted past that, the building is worth less than it costs to finish."
            />
            {/* Financed with the job, spent on tenants rather than steel, and
                paid across as cash the day the building opens. */}
            {(dev.leaseUpReserve ?? 0) > 0 && (
              <Row k="Lease-up reserve" v={`${usd(dev.leaseUpReserve!)} — released at delivery`} />
            )}
            <Row k="Delivers" v={monthLabel(dev.deliverM)} />
            {/* STILL TO FUND. The one number a developer mid-build checks every
                month, and it was nowhere on this screen. */}
            <Row
              k="Equity you have put in"
              v={`${usd(dev.equitySpent)} of ${usd(dev.equityBudget)}`}
            />
            <Row
              k="Still to come out of your account"
              v={usd(Math.max(0, dev.equityBudget - dev.equitySpent))}
              strong
              bad={dev.equityBudget - dev.equitySpent > game.cash}
            />
            {dev.costTotal > 0 && dev.contingencyUsed > 0 && (
              <Row k="Contingency used" v={`${usd(dev.contingencyUsed)} of ${usd(dev.contingency)}`} bad={dev.contingencyUsed > dev.contingency * 0.7} />
            )}
          </div>
        </div>
      )}
      <div className="prop-cols">
        <ParcelPanel embedded tab={active} />
      </div>
    </div>
  );
}

/**
 * THE ASSET'S OWN TRACK RECORD.
 *
 * Three lines, three scales, one column: what share of it is let, what the let
 * space is paying per foot, and what the whole thing nets. Read together they
 * are the only diagnosis this game could not give you — because a falling NOI
 * has three completely different causes and the panel showed you a single
 * number that could not tell them apart. Occupancy down with rent flat is a
 * leasing problem. Rent down with occupancy flat is a market you cannot fix.
 * Both flat with NOI falling is the expense stack, and that one is yours.
 *
 * Recorded quarterly by the engine from the same operating statement the
 * appraisal runs — see Holding.hist. Nothing here is recomputed, so the chart
 * and the cash statement can never disagree about a month that has happened.
 */
function AssetHistory({ bbl }: { bbl: string }) {
  const game = useStore((s) => s.game)!;
  const h = game.holdings[bbl];
  const rows = h?.hist ?? [];
  if (!h) return null;
  if (rows.length < 2) {
    return (
      <div className="deal">
        <div className="deal-head">Track record</div>
        <div className="hint">
          Held since {monthLabel(h.boughtM)}. The record is stamped every quarter — there is not
          enough of it yet to draw.
        </div>
      </div>
    );
  }
  const occ = rows.map((r) => r[1] / 10);          // per cent
  const rent = rows.map((r) => r[2] / 100);        // $/sf/yr
  const noi = rows.map((r) => r[3]);               // $/yr
  const xs: [string, string] = [monthLabel(rows[0][0]), monthLabel(rows[rows.length - 1][0])];
  // What it has actually done, in one line, so the charts have a conclusion
  // and not just a shape.
  const dOcc = occ[occ.length - 1] - occ[0];
  const dRent = rent[0] > 0 ? (rent[rent.length - 1] / rent[0] - 1) * 100 : 0;
  const yrs = Math.max(0.25, (rows[rows.length - 1][0] - rows[0][0]) / 12);
  return (
    <div className="deal">
      <div className="deal-head">Track record · {yrs.toFixed(1)} years on the books</div>
      <div className="grid">
        <Row k="Occupancy" v={`${occ[occ.length - 1].toFixed(0)}% · ${dOcc >= 0 ? "+" : ""}${dOcc.toFixed(0)}pp since you bought it`} bad={dOcc < -5} />
        <Row k="In-place rent" v={`$${rent[rent.length - 1].toFixed(2)}/sf · ${dRent >= 0 ? "+" : ""}${dRent.toFixed(0)}% · ${(Math.pow(1 + dRent / 100, 1 / yrs) - 1 >= 0 ? "+" : "")}${((Math.pow(1 + dRent / 100, 1 / yrs) - 1) * 100).toFixed(1)}%/yr`} />
        <Row k="NOI" v={`${usd(noi[noi.length - 1])}/yr`} bad={noi[noi.length - 1] < 0} strong />
      </div>
      <div className="chart-stack">
        <div className="chart-cap">Occupancy · % of the building let</div>
        <LineChart
          series={[{ label: "Occupied", color: "#5aa9e6", pts: occ }]}
          xLabels={xs} height={104} yFmt={(v) => v.toFixed(0) + "%"}
        />
        <div className="chart-cap">In-place rent · $/sf/yr on let space</div>
        <LineChart
          series={[{ label: "In place", color: "#e0a34a", pts: rent }]}
          xLabels={xs} height={104} yFmt={(v) => "$" + v.toFixed(0)}
        />
        <div className="chart-cap">Net operating income · $/yr</div>
        <LineChart
          series={[{ label: "NOI", color: "#6fcf97", pts: noi }]}
          xLabels={xs} height={104} zeroBase
        />
      </div>
    </div>
  );
}



/**
 * THE LAND DESK.
 *
 * Dirt used to cost 1.2% a year and do nothing else, which makes a land bank a
 * parking meter rather than a position. Two things you can do with a lot you
 * are not building on yet, and both of them are decisions:
 *
 *   • Fold the neighbours in. Assemblage pressure has been making every
 *     approach on this block dearer since the first one; this is what those
 *     premiums were for — one site, one envelope, one building.
 *   • Ground-lease it. A coupon on the land with no operating risk at all, and
 *     the certain knowledge that you will sit out every cycle in between.
 */
/**
 * THE LEASING DESK.
 *
 * Leasing was the shallowest thing on the screen: one letter of intent a month
 * with accept, counter or pass, and no way to do anything about it in between.
 * These are the two decisions a landlord actually makes about empty space and
 * about space that is about to be empty.
 */
/**
 * THE WORKOUT DESK.
 *
 * A default used to be a single line of news: the balloon came due, you had no
 * cash, the building was sold at a distress price in the same tick, and a
 * black mark went on the record. That is the last page of a foreclosure. What
 * actually happens is fourteen months of decisions with a lender who has
 * problems of their own — and this is that table.
 *
 * Nothing here is advice with a right answer. Curing is expensive and always
 * available if you have the money. Forbearance is buying time at their price,
 * and whether it is even offered depends on THEIR capital ratio, which you can
 * read on Research. A deed in lieu settles the debt in full and is usually the
 * right move, and it still costs you a building and a piece of your record.
 * Doing nothing is also a choice, and it is the most expensive one.
 */
function WorkoutDesk({ bbl }: { bbl: string }) {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const { cureDefault, askForbearance, handBackKeys } = useStore.getState();
  const w = game.workouts?.[bbl];
  const h = game.holdings[bbl];
  if (!w || !h?.loan) return null;
  const rec = resolveRec(parcels, game, bbl);
  if (!rec) return null;
  const mood = workoutMood(game, w.lender);
  const value = holdingValue(rec, game.econ, h, game.month);
  const bal = h.loan.balance;
  const monthsLeft = Math.max(0, w.decideM - game.month);
  const fee = Math.round(bal * mood.feePct);
  const paydown = Math.round(bal * mood.paydownPct);
  const equity = value - bal;
  const filed = w.stage === "foreclosure";
  return (
    <div className="page-section">
      <div className="page-section-head neg">
        {filed ? "Foreclosure filed" : w.stage === "forbearance" ? "Forbearance — extended paper" : "In default"}
        {" · "}{w.lender}
      </div>
      <div className="hint">
        {w.cause === "balloon"
          ? "The loan matured and there was no refinancing and no cash to close the gap."
          : w.cause === "covenant"
            ? "The covenant is broken and the cure period has not fixed it."
            : "The payments stopped."}{" "}
        {filed
          ? `They have filed. The auction is set for ${monthLabel(w.decideM)} — ${monthsLeft} month${monthsLeft === 1 ? "" : "s"} from now — and an auction fetches less than a distress sale does, because everybody bidding knows the seller has no choice at all.`
          : `You have until ${monthLabel(w.decideM)}, ${monthsLeft} month${monthsLeft === 1 ? "" : "s"}, before they file.`}
      </div>
      <div className="grid" style={{ marginBottom: 10 }}>
        <Row k="Balance owed" v={usd(bal)} strong />
        <Row k="What the building is worth" v={usd(value)} />
        <Row k="Equity behind it" v={usd(equity)} bad={equity < 0} strong={equity > 0} />
        <Row k="Paper" v={h.loan.recourse ? "recourse — a shortfall follows you" : "non-recourse — the keys are the answer"}
          bad={h.loan.recourse} />
        <Row k="To cure it outright" v={usd(w.cure)} bad={game.cash < w.cure} />
      </div>
      <div className="hint" style={{ marginBottom: 8 }}>{mood.why}</div>
      <div className="btn-row">
        <button className="btn" disabled={game.cash < w.cure} onClick={() => cureDefault(bbl)}
          title={game.cash < w.cure ? `You are ${usd(w.cure - game.cash)} short` : "Pay it and the file closes"}>
          Cure — {usd(w.cure)}
        </button>
        {!filed && w.asks < 1 && (
          <button className="btn" onClick={() => askForbearance(bbl)}
            title={mood.willExtend
              ? `${(mood.feePct * 100).toFixed(0)}% fee and a ${(mood.paydownPct * 100).toFixed(0)}% paydown — ${usd(fee + paydown)} — for 18 to 30 months, at ${(h.loan.ratePct + mood.bumpPct).toFixed(2)}% with cash flow swept`
              : "They can be asked. On this balance sheet they will almost certainly say no."}>
            Ask them to extend{mood.willExtend ? ` — ${usd(fee + paydown)}` : ""}
          </button>
        )}
        <button className="btn btn-danger" onClick={() => handBackKeys(bbl)}
          title="Deed in lieu: the debt is settled in full, there is no deficiency even on recourse paper, and it is a smaller mark than an auction">
          Hand back the deed
        </button>
      </div>
      <div className="hint" style={{ marginTop: 8 }}>
        {equity > bal * 0.12
          ? "There is real equity here. Curing it or selling it into the open market beats handing it over — a deed in lieu gives away everything above the debt."
          : h.loan.recourse
            ? "You signed for this one. At auction the shortfall comes out of your account; a deed in lieu settles the debt in full and there is no deficiency. That difference is the whole reason to walk into their office rather than wait."
            : "The paper is non-recourse and the debt is above the value. Handing it back costs you the building and nothing else, and it is a smaller mark than letting them take it."}
      </div>
    </div>
  );
}

/**
 * WHY THIS BUILDING IS OR IS NOT LETTING.
 *
 * A building that will not lease for reasons the owner cannot read is not
 * difficulty, it is a bug nobody can report. So the arithmetic that decides a
 * letter of intent is put on the screen in the terms a leasing agent would use
 * it in: how much space you are marketing, how much else the tenant could take
 * instead, what the city is actually looking for this month, and what share of
 * that your building can expect to win. Underneath it, every reason this
 * building beats or loses to the one across the street, named and multiplied
 * out.
 *
 * It is a readout, not a chore. There is nothing to press here — the moves it
 * argues for are the ones already on the Management block above: an exclusive,
 * a capital programme, pre-built suites, or coming off your asking rent.
 */
function LettingOdds({ bbl }: { bbl: string }) {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const h = game.holdings[bbl];
  const rec = h ? resolveRec(parcels, game, bbl) : null;
  if (!h || !rec || h.leasingHold) return null;
  const legs = leasableUses(rec)
    .map((u) => leasingOdds(game, parcels, rec, h, u))
    .filter((o): o is NonNullable<typeof o> => !!o && o.availSf > 1500);
  if (!legs.length) return null;
  return (
    <div className="deal">
      <div className="deal-head">Letting — where you stand in the market</div>
      {legs.map((o) => (
        <div key={o.use}>
          {legs.length > 1 && (
            <div className="page-section" style={{ marginTop: 2 }}>{SECTOR_LABEL[o.use]}</div>
          )}
          <div className="grid">
            <Row k="You are marketing" v={`${sf(Math.round(o.availSf))} · reads as ${sf(Math.round(o.marketedSf))} of usable space`} />
            <Row
              k="Vacancy · city / your corner"
              v={`${(o.cityVac * 100).toFixed(1)}% / ${(o.localVac * 100).toFixed(1)}%`}
              bad={o.localVac > o.cityVac * 1.12}
            />
            <Row k="Competing supply" v={`${sf(Math.round(o.competingSf))} available or coming back`} />
            <Row k="The city is looking for" v={`${sf(Math.round(o.requirementSf))} this month`} />
            <Row k="Your share of it" v={`${(o.shareOfMarket * 100).toFixed(2)}% · about ${sf(Math.round(o.captureSf))} a month`} />
            <Row
              k="Your ask vs the market"
              v={`${o.askPsf.toFixed(2)} vs ${o.marketPsf.toFixed(2)}`}
              bad={o.askPsf > o.marketPsf * 1.04}
            />
            <Row
              k="To 85% let at this pace"
              v={o.monthsToLet === null ? "it does not get there" : o.monthsToLet <= 0 ? "already there" : `${o.monthsToLet} months`}
              strong
              bad={o.monthsToLet === null || o.monthsToLet > 48}
            />
          </div>
          <div className="roll">
            {o.factors.map((f) => (
              <div className="roll-row" key={f.label}>
                <span className="roll-name">
                  {f.label} · <span className="dim">{f.detail}</span>
                </span>
                <span className="roll-meta mono">×{f.mult.toFixed(2)}</span>
              </div>
            ))}
            <div className="roll-row roll-group">
              <span className="roll-name">This building against an ordinary one</span>
              <span className="roll-meta mono">×{o.weight.toFixed(2)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function LeasingDesk({ bbl }: { bbl: string }) {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const { prebuild, extendLease } = useStore.getState();
  const [size, setSize] = useState(0);
  const h = game.holdings[bbl];
  const rec = h ? resolveRec(parcels, game, bbl) : null;
  if (!h || !rec) return null;

  const spec = h.specSuites;
  // the use with the most open space is the one worth pre-building
  const legs = leasableUses(rec)
    .map((u) => ({ u, free: useVacantSf(rec, h, u, game.month) }))
    .filter((x) => x.free > 900)
    .sort((a, b) => b.free - a.free);
  const leg = legs[0];
  const want = size || (leg ? Math.round(Math.min(leg.free, leg.free * 0.5)) : 0);
  const q = leg ? specSuiteQuote(game, rec, h, leg.u, want) : null;

  // sitting tenants worth going to early
  const extends_ = h.tenants
    .map((_, i) => blendExtendQuote(game, rec, h, i))
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => (b.current - b.market) - (a.current - a.market));

  // Emptying the building moved to VacantPossession, next to the wrecking
  // bill, which is the only reason anybody empties one.
  if (!spec && !q && !extends_.length) return null;
  return (
    <div className="deal">
      <div className="deal-head">Leasing desk</div>

      {spec && (
        <div className="grid">
          <Row k="Pre-built space" v={`${sf(spec.sf)} of ${USE_WORD[spec.use]}`} strong />
          <Row k={game.month >= spec.readyM ? "Status" : "Ready"}
            v={game.month >= spec.readyM ? "Turnkey and being toured" : monthLabel(spec.readyM)} />
        </div>
      )}

      {!spec && q && leg && (
        <>
          <div className="page-section" style={{ marginTop: 2 }}>Pre-build the space</div>
          <div className="slider">
            <div className="slider-head">
              <span className="slider-label">{USE_WORD[leg.u]} to fit out · of {sf(Math.round(leg.free))} open</span>
              <span className="slider-value">{sf(q.sf)}</span>
            </div>
            <input type="range" min={800} max={Math.round(leg.free)} step={100} value={want}
              style={{ ["--fill" as string]: `${((want - 800) / Math.max(1, leg.free - 800)) * 100}%` }}
              onChange={(e) => setSize(Number(e.target.value))} />
          </div>
          <div className="grid">
            <Row k="Cost now" v={usd(q.cost)} strong />
            <Row k="Ready" v={monthLabel(q.readyM)} />
          </div>
          <div className="hint">
            Turnkey suites tour nearly twice as often, ask about 5% more rent, and need almost no fit-out allowance —
            because you have already paid it. If the space sits anyway, so does the money.
          </div>
          <button className="btn" onClick={() => prebuild(bbl, leg.u, q.sf)}>
            Pre-build {sf(q.sf)} for {usd(q.cost)}
          </button>
        </>
      )}

      {extends_.length > 0 && (
        <>
          <div className="page-section" style={{ marginTop: 10 }}>Go to a tenant early</div>
          <table className="tbl">
            <thead>
              <tr><th>Tenant</th><th className="num">Rent now</th><th className="num">Market</th><th className="num">They&apos;ll take</th><th className="num">Adds</th><th /></tr>
            </thead>
            <tbody>
              {extends_.slice(0, 5).map((e) => (
                <tr key={e.idx}>
                  <td>{e.name}</td>
                  <td className="num">${e.current.toFixed(0)}</td>
                  <td className="num">${e.market.toFixed(0)}</td>
                  <td className={"num" + (e.newRent < e.current ? " neg" : "")}>${e.newRent.toFixed(0)}</td>
                  <td className="num">{(e.addM / 12).toFixed(0)} yrs</td>
                  <td><button className="btn-mini" onClick={() => extendLease(bbl, e.idx)}>extend</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="hint">
            Blend and extend: give up rent today, take term for it. Cheap WALT if the market is about to soften,
            and a discount you did not need to give if it is not.
          </div>
        </>
      )}
    </div>
  );
}

/**
 * WHAT THE DIRT IS ACTUALLY WORTH (ECONOMY.md: land value is a residual).
 * The index prices the map; this prices THIS lot the way a builder would —
 * best scheme the envelope allows, today's rents against today's costs, and
 * the dirt is what is left over. When nothing is left over, that is said
 * too, because "nothing pencils" is the single most load-bearing fact about
 * a land market. Shown on any vacant lot, owned or not — the read matters
 * most BEFORE the money moves.
 */
function ResidualRead({ bbl }: { bbl: string }) {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const rec = resolveRec(parcels, game, bbl);
  if (!rec || !rec.lotArea) return null;
  const farMax = farMaxFor(rec);
  const CAND: { u: DevUse; label: string }[] = [
    { u: "office", label: "office" }, { u: "multifamily", label: "flats" },
    { u: "mixed", label: "mixed use" }, { u: "retail", label: "shops" },
    { u: "industrial", label: "industrial" },
  ];
  // A builder does not hand the whole surplus to the land — the job has to
  // pay them too. The trade's rule of thumb is a required profit of ~18% of
  // gross development value; what is left AFTER that margin is what a bidder
  // can rationally pay for the dirt. Omit it and the line reads as free money.
  const PROFIT = 0.18;
  let best: { label: string; valPsf: number; costPsf: number; resid: number } | null = null;
  for (const c of CAND) {
    const fl = Math.max(2, Math.round(farMax / 0.6));
    const p = planDevelopment(game, parcels, bbl, c.u, fl, 0.6);
    if (!p || p.sf < 2000) continue;
    const noi = (p.yieldOnCost / 100) * p.basisTotal;
    const val = noi / Math.max(0.02, p.exitCap / 100);
    // COST OF THE BUILDING, WITHOUT THE DIRT — which is basisTotal less the
    // land, NOT costTotal less the land. costTotal never contained land in the
    // first place, so subtracting it took the site out of a number it was
    // never in and understated the build by the whole land basis. On an
    // expensive corner it went NEGATIVE: this panel was reading "$-427/sf
    // all-in to build" on a lot with $8.95M of dirt under it, which is how it
    // was found. And because the residual is value less the build, every
    // vacant lot in the game was quoting a residual to the dirt overstated by
    // exactly what the dirt already cost — the one number on this card a
    // player prices land from.
    const buildAllIn = p.basisTotal - p.landBasis;
    const resid = val * (1 - PROFIT) - buildAllIn;
    const cand = { label: c.label, valPsf: val / p.sf, costPsf: buildAllIn / p.sf, resid };
    if (!best || cand.resid > best.resid) best = cand;
  }
  if (!best) return null;
  return best.resid > 0
    ? <div className="grid">
        <Row k="What pencils" v={`${best.label} — worth $${best.valPsf.toFixed(0)}/sf built against $${best.costPsf.toFixed(0)}/sf all-in to build`} strong />
        <Row k="Residual to the dirt" v={`${usd(Math.round(best.resid))} · ${usd(Math.round(best.resid / Math.max(1, rec.lotArea)))}/sf of land, after the builder's margin`} />
      </div>
    : <div className="hint">
        Nothing pencils here — the best scheme ({best.label}) is worth ${best.valPsf.toFixed(0)}/sf finished
        against ${best.costPsf.toFixed(0)}/sf to build it, and a builder has to be paid to take the risk.
        At today's rents and costs this dirt only has option value: you are buying the next cycle, not this one.
      </div>;
}

function LandDesk({ bbl }: { bbl: string }) {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const adjacency = useStore((s) => s.adjacency);
  const { assemble, groundLease, pullGroundOffer, applyVariance } = useStore.getState();
  const [picked, setPicked] = useState<string[]>([]);
  const [years, setYears] = useState(60);
  const h = game.holdings[bbl];
  const rec = h ? resolveRec(parcels, game, bbl) : null;
  if (!h || !rec) return null;

  const gl = game.groundLeases?.[bbl];
  if (gl) {
    const yrsLeft = Math.max(0, (gl.endM - game.month) / 12);
    return (
      <div className="deal">
        <div className="deal-head">Ground-leased</div>
        <div className="grid">
          <Row k="Lessee" v={gl.tenant} />
          <Row k="Ground rent" v={`${usd(gl.rentYr)} / yr`} strong />
          <Row k="Next review" v={`${monthLabel(gl.lastStepM + gl.stepEveryM)} · +${gl.stepPct}%`} />
          <Row k="Reverts" v={`${monthLabel(gl.endM)} · ${yrsLeft.toFixed(0)} years to run`} />
        </div>
        <div className="hint">
          No tenants, no roof, no vacancy — and no building on it until the term is up. Whatever they put up
          reverts to you with the land.
        </div>
      </div>
    );
  }

  // an assembled parent: say what it now is
  const children = Object.entries(game.merged ?? {}).filter(([, p]) => p === bbl).map(([c]) => c);
  const isChild = game.merged?.[bbl];
  if (isChild) {
    const parent = resolveRec(parcels, game, isChild);
    return (
      <div className="deal">
        <div className="deal-head">Part of an assemblage</div>
        <div className="hint">
          This deed has been folded into {parent?.address ?? isChild}. Its land, its envelope and its value all sit
          with the site now — build there, not here.
        </div>
      </div>
    );
  }

  const vacant = rec.class === "land" && rec.bldgArea === 0;
  const landmarked = game.landmarks?.[bbl] !== undefined;
  const vq = landmarked ? null : varianceQuote(game, parcels, bbl);
  const app = game.varianceApp?.bbl === bbl ? game.varianceApp : null;

  // THE PLANNING BOARD. Available on anything you own, built or not — the
  // envelope is worth asking about whether or not there is already something
  // standing on it, and on an assembled site it is the entire point.
  const planning = (
    <>
      {landmarked && (
        <div className="hint">
          Landmarked. The envelope is frozen at what is already standing, nobody knocks it down, and it lets about
          7% over the market for the rest of its life. That premium is the whole of what you get for the site.
        </div>
      )}
      {app && (
        <div className="grid">
          <Row k="Before the board" v={`${app.grant.toFixed(1)} FAR · they sit ${monthLabel(app.decideM)}`} strong />
          <Row k="Odds as filed" v={`${(app.odds * 100).toFixed(0)}%`} />
        </div>
      )}
      {/* WHAT THE BOARD SAID. A hearing is a year and several hundred thousand
          dollars, and the answer used to be one line of news that scrolled
          away in a quarter. It sits on the site for a decade now — which is
          also how long a refusal really hangs over a property. */}
      {(() => {
        const v = game.varianceLog?.[bbl];
        if (!v || game.month - v.m > 120) return null;
        const yrs = (game.month - v.m) / 12;
        return (
          <div className="grid">
            <Row
              k={v.granted ? "◆ Variance GRANTED" : "◇ Variance REFUSED"}
              v={`${v.far.toFixed(1)} FAR asked · ${monthLabel(v.m)}${yrs >= 1 ? ` · ${yrs.toFixed(0)} yr${yrs >= 2 ? "s" : ""} ago` : ""}`}
              strong
              bad={!v.granted}
            />
            <Row
              k="What it cost to find out"
              v={`${usd(v.cost)} in fees${v.granted ? "" : " — spent either way"}`}
            />
          </div>
        );
      })()}
      {!app && vq && (
        <>
          <div className="grid">
            <Row k="District envelope" v={`${Math.max(rec.farMaxComm, rec.farMaxRes).toFixed(1)} FAR${game.zoneAdj?.[rec.district] ? ` · rezoned to ${((game.zoneAdj[rec.district]) * 100).toFixed(0)}%` : ""}`} />
            {(game.variance?.[bbl] ?? 0) > 0 && <Row k="Variance already won" v={`+${game.variance![bbl].toFixed(1)} FAR`} />}
            <Row k="Ask the board for" v={`+${vq.grant.toFixed(1)} FAR`} strong />
            <Row k="Fees" v={usd(vq.cost)} />
            <Row k="They decide in" v={`${vq.months} months · ${(vq.odds * 100).toFixed(0)}% say yes`} bad={vq.odds < 0.3} />
          </div>
          <button className="btn" onClick={() => applyVariance(bbl)}>File for a variance · {usd(vq.cost)}</button>
          <div className="hint">
            Lawyers, an architect and a year of hearings, spent whether they say yes or not. On a site you have just
            assembled this is the other half of the trade — the lots are worth putting together because of what you
            are allowed to build on them.
          </div>
        </>
      )}
    </>
  );

  // NEIGHBOURS YOU ALREADY OWN.
  //
  // This used to require the lot AND every neighbour to be vacant, and the
  // whole desk only rendered on vacant ground — so two adjacent lots you had
  // spent years buying could not be put together if either one had so much as
  // a shed on it, and you were never told why. Assembling is a deed exercise,
  // not a demolition one: fold them together first, knock down what is standing
  // when you are ready to build. What you cannot fold in is a lot that is
  // mid-construction, ground-leased to somebody else, already part of another
  // assemblage, or listed for sale.
  // Every adjacent deed you own, with the reason it cannot be folded in yet —
  // an empty panel taught nobody anything.
  const adjacentMine = (adjacency?.[bbl] ?? [])
    .filter((n) => game.holdings[n])
    .map((n) => {
      const r = resolveRec(parcels, game, n);
      const why = !r ? "unknown parcel"
        : game.merged?.[n] ? "already part of another assemblage"
        : game.developments[n] ? "under construction"
        : game.groundLeases?.[n] ? "ground-leased to somebody else"
        : game.holdings[n].sale ? "on the market — pull the listing"
        : game.landmarks?.[n] !== undefined ? "landmarked"
        : r.class !== "land" || r.bldgArea > 0 ? `${useLabel(r)} standing — clear it first`
        : null;
      return { bbl: n, rec: r, why };
    });
  const nbrs = adjacentMine.filter((x) => !x.why).map((x) => x.bbl);
  const blocked = adjacentMine.filter((x) => x.why);

  if (!vacant && !adjacentMine.length) {
    return app || vq || landmarked
      ? <div className="deal"><div className="deal-head">The planning board</div>{planning}</div>
      : null;
  }

  // ON OFFER is a state of the lot, like LISTED. The quote is re-run at
  // today's land value because the offer is an intention, not a price lock —
  // the panel shows what a lessee arriving THIS month would actually sign.
  const offer = h.groundOffer;
  const oq = offer && vacant ? groundLeaseQuote(game, parcels, bbl, offer.years) : null;
  const q = vacant && !offer ? groundLeaseQuote(game, parcels, bbl, years) : null;
  const cost = mergeCost(game, picked.length + 1);
  const addedArea = picked.reduce((a, b) => a + (parcels[b]?.lotArea ?? 0), 0);
  const farMax = Math.max(rec.farMaxComm, rec.farMaxRes);

  return (
    <div className="deal">
      <div className="deal-head">The land desk</div>
      {planning}
      {vacant && <ResidualRead bbl={bbl} />}
      {!vacant && adjacentMine.length > 0 && (
        <div className="hint">
          You own {adjacentMine.length} deed{adjacentMine.length === 1 ? "" : "s"} next to this one. A site has to be
          clear before the deeds can be folded together — the land moves into one parcel and there is nowhere left
          for a building to stand on the others.
        </div>
      )}
      {children.length > 0 && (
        <div className="hint">
          Assembled site — {children.length + 1} deeds, {sf(rec.lotArea)} of land, {sf(Math.round(rec.lotArea * farMax))} buildable.
        </div>
      )}
      {adjacentMine.length > 0 && (
        <>
          <div className="page-section" style={{ marginTop: 2 }}>Fold in the neighbours</div>
          <div className="mini-list">
            {nbrs.map((n) => {
              const r = resolveRec(parcels, game, n);
              const on = picked.includes(n);
              return (
                <button key={n} className={"neighbor" + (on ? " neighbor-on" : "")}
                  onClick={() => setPicked(on ? picked.filter((x) => x !== n) : [...picked, n])}>
                  <span className="neighbor-addr">{on ? "✓ " : ""}{r?.address ?? n}</span>
                  <span className="neighbor-meta">
                    {sf(r?.lotArea ?? 0)} of land
                    {r && r.class !== "land" && r.bldgArea > 0 ? ` · ${useLabel(r)} standing` : " · vacant"}
                  </span>
                </button>
              );
            })}
            {/* WHY THE OTHERS ARE NOT ON THE LIST. */}
            {blocked.map((x) => (
              <div key={x.bbl} className="neighbor" style={{ opacity: 0.55, cursor: "default" }}>
                <span className="neighbor-addr">{x.rec?.address ?? x.bbl}</span>
                <span className="neighbor-meta">{x.why}</span>
              </div>
            ))}
          </div>
          {picked.length > 0 && (
            <>
              <div className="grid">
                <Row k="Site after merger" v={`${sf(rec.lotArea + addedArea)} · ${sf(Math.round((rec.lotArea + addedArea) * farMax))} buildable`} strong />
                <Row k="Was" v={`${sf(rec.lotArea)} · ${sf(Math.round(rec.lotArea * farMax))} buildable`} />
                {/* THE REASON TO MERGE, IN TWO NUMBERS. A site is not just the
                    sum of its deeds any more: one core serving a bigger plate
                    returns rentable feet the small lots were losing, and the
                    dirt itself reprices as a development site. Show both, so
                    the button is a decision and not an act of faith. */}
                {(() => {
                  const before = plateEfficiency(rec.lotArea * 0.62);
                  const after = plateEfficiency((rec.lotArea + addedArea) * 0.62);
                  const gain = (after / before - 1) * 100;
                  return gain > 0.5
                    ? <Row k="Plate efficiency" v={`+${gain.toFixed(1)}% rentable on the same gross — one core, bigger floors`} />
                    : null;
                })()}
                {(() => {
                  const mergedRec = { ...rec, lotArea: rec.lotArea + addedArea };
                  const now = landPsfNow(rec, game.econ);
                  const then = landPsfNow(mergedRec, game.econ);
                  const d = (then / Math.max(1, now) - 1) * 100;
                  return Math.abs(d) > 0.5
                    ? <Row k="The dirt reprices" v={`${d > 0 ? "+" : ""}${d.toFixed(1)}% $/sf across the whole site`} />
                    : null;
                })()}
                <Row k="Survey, title and lawyers" v={usd(cost)} />
              </div>
              <button className="btn" onClick={() => { assemble([bbl, ...picked]); setPicked([]); }}>
                Assemble {picked.length + 1} lots · {sf(rec.lotArea + addedArea)}
              </button>
            </>
          )}
        </>
      )}
      {offer && (
        <>
          <div className="page-section" style={{ marginTop: 10 }}>Offered for ground lease</div>
          <div className="grid">
            <Row k="On the book since" v={`${monthLabel(offer.sinceM)}${game.month - offer.sinceM > 0 ? ` · ${game.month - offer.sinceM} month${game.month - offer.sinceM === 1 ? "" : "s"} waiting` : ""}`} />
            <Row k="Terms as of today" v={oq ? `${usd(oq.rentYr)} / yr · ${offer.years} years · +${oq.stepPct}% every ten` : "—"} strong />
          </div>
          <div className="hint">
            Ground lessees are scarce — nobody plans a hospital or a hotel around your corner on your schedule.
            One turns up when the corner's demand and the building climate say so: months on prime dirt in a
            building year, years out on the fringe. The deal signs at the terms quoted the month they arrive.
          </div>
          <button className="btn" onClick={() => pullGroundOffer(bbl)}>Pull the offer</button>
        </>
      )}
      {q && (
        <>
          <div className="page-section" style={{ marginTop: 10 }}>Or ground-lease it</div>
          <div className="slider">
            <div className="slider-head">
              <span className="slider-label">Term</span>
              <span className="slider-value">{years} years</span>
            </div>
            <input type="range" min={30} max={99} step={1} value={years}
              style={{ ["--fill" as string]: `${((years - 30) / 69) * 100}%` }}
              onChange={(e) => setYears(Number(e.target.value))} />
          </div>
          <div className="grid">
            <Row k="Ground rent" v={`${usd(q.rentYr)} / yr · ${q.capPct}% of land value`} strong />
            <Row k="Reviews" v={`+${q.stepPct}% every ten years`} />
            <Row k="Land back" v={monthLabel(game.month + years * 12)} />
          </div>
          <div className="hint">
            No tenants and no operating risk, and you do not build on this corner again for {years} years — including
            the one cycle where you would have wanted to. Offering is a listing, not a closing: the lessee turns up
            when one wants this corner, and the dirt costs carry while you wait.
          </div>
          <button className="btn" onClick={() => groundLease(bbl, years)}>Offer a {years}-year ground lease</button>
        </>
      )}
    </div>
  );
}

function PortfolioPage() {
  const parcels = useStore((s) => s.parcels)!;
  const game = useStore((s) => s.game)!;
  const select = useStore((s) => s.select);
  const setPage = useStore((s) => s.setPage);
  const holdings = Object.values(game.holdings);
  const { listSale, delistSale, focus } = useStore.getState();
  // Opening the record and finding the building are the same action now: the
  // panel changes AND the camera moves, so the thing you are reading about is
  // behind the page you are reading. A book of addresses was not a place.
  const go = (bbl: string) => { select(bbl); focus(bbl); setPage("property"); };
  // Which row has its refinancing panel open. Repricing a loan is a portfolio
  // decision — you do it while looking at the maturity wall, not after opening
  // one building's record and scrolling past its rent roll.
  const [refiRow, setRefiRow] = useState<string | null>(null);
  // Sort the book by value or by income. "By income" is the top-earners view:
  // the fifty best income producers, ranked — the question every owner asks
  // of a big book is "what is actually carrying this firm."
  const [sortBy, setSortBy] = useState<"value" | "income">("value");
  // THE BUNDLE. Ticking buildings here is how you assemble a portfolio trade;
  // see engine/portfolio.ts for why the sum of the parts is not the price.
  const [bundling, setBundling] = useState(false);
  const [bundle, setBundle] = useState<string[]>([]);
  if (!holdings.length && !Object.keys(game.developments).length) {
    return <div className="hint">You own nothing yet. The Marketplace page has the tape; the map has everything else.</div>;
  }
  let totV = 0, totD = 0, totCF = 0;
  const rows = holdings.map((h) => {
    const rec = resolveRec(parcels, game, h.bbl);
    const v = rec ? holdingValue(rec, game.econ, h, game.month) : 0;
    // A LET GROUND LEASE IS A POSITION. The engine wires the ground rent to
    // cash separately (tickGroundLeases) precisely so the lot itself carries
    // nothing — and that correctness left the leased fee printing zero income
    // in this book, indistinguishable from dead dirt and sliced out of the
    // top-earners view entirely. The coupon belongs on the row: it is the
    // whole reason the position exists.
    const glRentYr = game.groundLeases?.[h.bbl]?.rentYr ?? 0;
    const noi = (rec ? holdingNOIYr(rec, game.econ, h, game.month) : 0) + glRentYr;
    const cf = noi / 12 - (h.loan?.monthlyPmt ?? 0);
    const occ = rec ? physicalOcc(rec as never, h) : 0;
    totV += v; totD += h.loan?.balance ?? 0; totCF += cf;
    return { h, rec, v, noi, cf, occ };
  }).sort((a, b) => (sortBy === "income" ? b.noi - a.noi : b.v - a.v));
  const shown = sortBy === "income" ? rows.slice(0, 50) : rows;

  // ---- exposure ------------------------------------------------------------
  // Concentration and the maturity wall are what actually end firms, and both
  // were invisible. All of this is already in the state; none of it was ever
  // added up. A portfolio where one tenant is a fifth of the income, or where
  // half the debt matures inside three years, is a different business from one
  // where neither is true — even if the cash flow statements look identical.
  const exposure = (() => {
    const byTenant = new Map<string, number>();
    const bySector = new Map<string, number>();
    let roll = 0, floatDebt = 0, wamNum = 0, debtTot = 0, rollNext24 = 0, leasedSf = 0;
    let matWall = 0;   // debt maturing within 36 months
    for (const { h, rec } of rows) {
      if (!rec) continue;
      for (const t of h.tenants) {
        const annual = t.rentPsf * t.sf;
        roll += annual;
        leasedSf += t.sf;
        byTenant.set(t.name, (byTenant.get(t.name) ?? 0) + annual);
        bySector.set(t.sector, (bySector.get(t.sector) ?? 0) + annual);
        if (t.endM - game.month <= 24) rollNext24 += annual;
      }
      const l = h.loan;
      if (!l) continue;
      debtTot += l.balance;
      if (l.floating ?? l.product === "float") floatDebt += l.balance;
      wamNum += l.balance * Math.max(0, (l.maturityM - game.month) / 12);
      if (l.maturityM - game.month <= 36) matWall += l.balance;
    }
    const topTenant = [...byTenant.entries()].sort((a, b) => b[1] - a[1])[0];
    const topSector = [...bySector.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      roll, leasedSf,
      topTenant: topTenant ? { name: topTenant[0], share: roll > 0 ? topTenant[1] / roll : 0 } : null,
      topSector: topSector ? { name: topSector[0], share: roll > 0 ? topSector[1] / roll : 0 } : null,
      rollShare: roll > 0 ? rollNext24 / roll : 0,
      floatShare: debtTot > 0 ? floatDebt / debtTot : 0,
      wam: debtTot > 0 ? wamNum / debtTot : 0,
      wallShare: debtTot > 0 ? matWall / debtTot : 0,
      matWall,
    };
  })();

  return (
    <div>
      <div className="stat-strip">
        {/* FIRST, NOT LAST. This sat rightmost, after "Buildings", in the same
            20px mono as every other stat — the only number in the game that can
            end the run, weighted identically to a count of how many things you
            own. */}
        {Object.keys(game.workouts ?? {}).length > 0 && (
          <Big label="In default" value={String(Object.keys(game.workouts ?? {}).length)} bad />
        )}
        <Big label="Assets" value={usd(totV)} />
        <Big label="Debt" value={usd(totD)} />
        <Big label="Equity" value={usd(totV - totD)} />
        <Big label="Cash flow / mo" value={usd(totCF)} bad={totCF < 0} />
        {(() => {
          const cost = rows.reduce((a, r) => a + r.h.costBasis, 0);
          const g = totV - cost;
          return <Big label="Unrealised gain" value={`${g >= 0 ? "+" : "−"}${usd(Math.abs(g))} · ${cost > 0 ? ((g / cost) * 100).toFixed(0) : "0"}%`} bad={g < 0} />;
        })()}
        <Big label="Buildings" value={String(holdings.length)} />
        {/* THE ONE THING YOU CANNOT AFFORD TO MISS. */}

      </div>
      {Object.values(game.workouts ?? {}).length > 0 && (
        <div className="alarm" style={{ marginTop: 10 }}>
          {Object.values(game.workouts!).map((w) => {
            const r = resolveRec(parcels, game, w.bbl);
            return (
              <div key={w.bbl} className="neg" style={{ cursor: "pointer" }} onClick={() => go(w.bbl)}>
                {(() => {
                  const q = payoffQuote(game, parcels, w.bbl);
                  if (!q?.open) return null;
                  return (
                    <div style={{ marginBottom: 4 }}>
                      <button className="btn-mini" disabled={game.cash < q.px}
                        title={q.why}
                        onClick={(e) => { e.stopPropagation(); useStore.getState().payOffAtDiscount(w.bbl); }}>
                        pay it off at {usd(q.px)} of {usd(q.bal)}
                      </button>
                    </div>
                  );
                })()}
                ⚠ {r?.address ?? w.bbl} — {w.lender} {w.stage === "foreclosure"
                  ? `has filed. Auction ${monthLabel(w.decideM)}.`
                  : w.stage === "forbearance"
                    ? `extended it to ${monthLabel(w.decideM)}.`
                    : `opened a file. They can file from ${monthLabel(w.decideM)}.`} Curing it takes {usd(w.cure)}.
              </div>
            );
          })}
        </div>
      )}
      {exposure.roll > 0 && (
        <>
          <div className="page-section">Exposure</div>
          <div className="grid">
            {exposure.topTenant && (
              <Row
                k="Largest tenant"
                v={`${exposure.topTenant.name} · ${(exposure.topTenant.share * 100).toFixed(0)}% of the roll`}
                bad={exposure.topTenant.share > 0.2}
              />
            )}
            {exposure.topSector && (
              <Row
                k="Largest sector"
                v={`${exposure.topSector.name} · ${(exposure.topSector.share * 100).toFixed(0)}% of the roll`}
                bad={exposure.topSector.share > 0.4}
              />
            )}
            <Row
              k="Rolling within 2 yrs"
              v={`${(exposure.rollShare * 100).toFixed(0)}% of the roll`}
              bad={exposure.rollShare > 0.3}
            />
            <Row
              k="Floating-rate debt"
              v={`${(exposure.floatShare * 100).toFixed(0)}% of the balance`}
              bad={exposure.floatShare > 0.5}
            />
            <Row k="Weighted avg maturity" v={`${exposure.wam.toFixed(1)} yrs`} bad={exposure.wam < 3} />
            <Row
              k="Maturing within 3 yrs"
              v={`${usd(exposure.matWall)} · ${(exposure.wallShare * 100).toFixed(0)}% of the debt`}
              bad={exposure.wallShare > 0.4}
            />
          </div>
        </>
      )}
      <PortfolioSaleDesk bundle={bundle} clear={() => { setBundle([]); setBundling(false); }} />
      <div className="btn-row" style={{ marginTop: 10 }}>
        <button className={"btn" + (sortBy === "value" ? " btn-on" : "")} onClick={() => setSortBy("value")}>By value</button>
        <button className={"btn" + (sortBy === "income" ? " btn-on" : "")} onClick={() => setSortBy("income")}
          title="The top 50 income producers, ranked by NOI.">Top earners</button>
        {!game.portfolioSale && holdings.length >= 2 && (
          <button className={"btn" + (bundling ? " btn-on" : "")}
            onClick={() => { setBundling(!bundling); if (bundling) setBundle([]); }}
            title="Tick two or more buildings and take them to market as one trade">
            {bundling ? `Bundling · ${bundle.length} picked` : "Sell several at once"}
          </button>
        )}
        {bundling && bundle.length > 0 && (
          <button className="btn" onClick={() => setBundle([])}>Clear picks</button>
        )}
        {bundling && (
          <button className="btn" onClick={() => setBundle(rows.filter((r) => !r.h.sale).map((r) => r.h.bbl))}>
            Pick everything
          </button>
        )}
      </div>
      <table className="tbl">
        <thead>
          <tr>
            {bundling && <th></th>}
            {sortBy === "income" && <th className="num">#</th>}
            {/* Square feet is the denominator of every number to the right of
                it — NOI, value and debt are all quoted per foot in this
                business, and the book listed none of them against an area. */}
            <th>Property</th><th>Class</th><th className="num">Building sf</th><th className="num">Spaces</th><th className="num">Occ</th><th className="num" title="Average contract rent across the rent roll, per square foot per year">Rent $/sf</th><th className="num">NOI / yr</th>
            <th className="num">Value</th><th className="num" title="What you paid, including closing costs">Cost</th>
            <th className="num" title="Appraisal against cost basis — unrealised, before tax and before the cost of selling">Gain</th>
            <th className="num">Debt</th><th className="num">Equity</th>
            <th className="num">Debt svc / mo</th><th className="num">CF / mo</th><th>Status</th><th></th>
          </tr>
        </thead>
        <tbody>
          {shown.map(({ h, rec, v, noi, cf, occ }, i) => {
            const wk = game.workouts?.[h.bbl];
            // a crane on your own dirt is a status, not a secret
            const dv = game.developments[h.bbl];
            return (
            <Fragment key={h.bbl}>
            <tr onClick={() => go(h.bbl)}>
              {bundling && (
                <td onClick={(ev) => {
                  ev.stopPropagation();
                  setBundle(bundle.includes(h.bbl) ? bundle.filter((x) => x !== h.bbl) : [...bundle, h.bbl]);
                }} style={{ cursor: "pointer", userSelect: "none" }}
                  title={h.sale ? "Already listed on its own — delist it first" : "Add to the bundle"}>
                  {bundle.includes(h.bbl) ? "☑" : h.sale ? "·" : "☐"}
                </td>
              )}
              {sortBy === "income" && <td className="num dim">{i + 1}</td>}
              <td>{rec?.address ?? h.bbl}</td>
              <td>{rec ? useLabel(rec) : "—"}</td>
              <td className="num" title={rec && rec.bldgArea ? `${usd(v / rec.bldgArea)}/sf of value · ${usd(noi / rec.bldgArea)}/sf of NOI` : "vacant land"}>
                {rec && rec.bldgArea ? sf(rec.bldgArea) : "—"}
                {/* THE SIZE OF THE PRODUCT, under the size of the building. A
                    hundred thousand feet cut into 450-foot studios and the same
                    hundred thousand cut into 1,800-foot family flats are two
                    different businesses at identical area — different rents,
                    different tenants, different turnover — and on anything you
                    programmed yourself it is a decision you made and can read
                    back. It hangs under the area instead of taking a column of
                    its own because half the book has no flats in it at all. */}
                {rec && avgUnitSf(rec) > 0 && (
                  <div className="dim" style={{ fontSize: 11 }}>{sf(avgUnitSf(rec))}/flat</div>
                )}
              </td>
              <td className="num">{rec && rec.bldgArea ? (() => { const u = unitStatus(rec, h, game.month); return `${u.leased} / ${u.total}`; })() : "—"}</td>
              <td className="num">{rec?.class === "land" ? "—" : (occ * 100).toFixed(0) + "%"}</td>
              {/* WHAT THE ROLL ACTUALLY COLLECTS, per foot. The rent every
                  decision in the game is denominated in, and the book quoted
                  NOI and value per foot but never the rent underneath them. */}
              {(() => {
                const leased = h.tenants.reduce((a, t) => a + t.sf, 0);
                const roll = h.tenants.reduce((a, t) => a + t.rentPsf * t.sf, 0);
                if (!rec || rec.class === "land") return <td className="num">—</td>;
                if (leased > 0) {
                  const mkt = managedRentPsfYr(rec, game.econ, h);
                  return (
                    <td className="num" title={`Market is about $${mkt.toFixed(2)}/sf for this building today`}>
                      ${(roll / leased).toFixed(2)}
                      <span className={"dim" + ((roll / leased) < mkt * 0.92 ? " neg" : "")}>
                        {" "}({(roll / leased) >= mkt ? "+" : ""}{(((roll / leased) / Math.max(1, mkt) - 1) * 100).toFixed(0)}%)
                      </span>
                    </td>
                  );
                }
                // flats have no named roll: quote what the building achieves
                return <td className="num dim">${managedRentPsfYr(rec, game.econ, h).toFixed(2)}</td>;
              })()}
              <td className="num">{usd(noi)}</td>
              <td className="num">{usd(v)}</td>
              {/* WHAT IT HAS DONE FOR YOU. Appraisal against what you actually
                  paid — the number every owner carries in their head and the
                  one this book never showed. Unrealised, before tax and before
                  the cost of getting out, which is why it is not net worth. */}
              <td className="num dim">{usd(h.costBasis)}</td>
              {(() => {
                const g = v - h.costBasis;
                const pctG = h.costBasis > 0 ? (g / h.costBasis) * 100 : 0;
                return (
                  <td className={"num" + (g < 0 ? " neg" : "")} title={`${(g / Math.max(1, (game.month - h.boughtM) / 12) / Math.max(1, h.costBasis) * 100).toFixed(1)}% a year over ${((game.month - h.boughtM) / 12).toFixed(1)} years`}>
                    {g >= 0 ? "+" : "−"}{usd(Math.abs(g))} · {g >= 0 ? "+" : ""}{pctG.toFixed(0)}%
                  </td>
                );
              })()}
              <td className="num">{usd(h.loan?.balance ?? 0)}</td>
              <td className="num">{usd(v - (h.loan?.balance ?? 0))}</td>
              {/* A LEADING MINUS THAT WRAPS IS A BARE DASH. In a 62px column
                  `"−" + usd(...)` breaks after the sign, so a real payment
                  rendered as a dash over a number — visually identical to the
                  "—" that means no debt at all. Parenthesised the way an
                  accountant writes a negative, which cannot wrap apart. */}
              <td className="num nowrap">{h.loan ? `(${usd(h.loan.monthlyPmt)})` : "—"}</td>
              <td className={"num" + (cf < 0 ? " neg" : "")}>{usd(cf)}</td>
              {/* A BUILDING IN DEFAULT WAS INVISIBLE FROM HERE. The workout desk
                  lives on the property record, so the only way to find out a
                  lender had filed was to open that one building. On a
                  thirty-building book that is not a warning, it is a scavenger
                  hunt with a foreclosure at the end of it. */}
              <td className={wk ? "neg" : "dim"}>
                {[wk ? (wk.stage === "foreclosure" ? "⚠ FORECLOSURE" : wk.stage === "forbearance" ? "⚠ EXTENDED" : "⚠ DEFAULT") : null,
                  dv ? "UNDER CONSTRUCTION" : null,
                  h.loan?.sweep ? "SWEEP" : null, h.sale ? "LISTED" : null,
                  h.renovatingUntilM !== undefined && game.month < h.renovatingUntilM ? "RENO" : null,
                  h.program ? "CAPEX" : null,
                  game.groundLeases?.[h.bbl] ? "GROUND-LEASED" : h.groundOffer ? "GL OFFERED" : null].filter(Boolean).join(" · ")}
                {(() => {
                  const g = game.groundLeases?.[h.bbl];
                  return g ? <div className="mono" style={{ fontSize: 11 }}>{g.tenant} · reverts {monthLabel(g.endM)}</div> : null;
                })()}
                {wk && <div className="mono" style={{ fontSize: 11 }}>
                  {wk.stage === "foreclosure" ? "auction" : "they file"} {monthLabel(wk.decideM)}
                </div>}
                {dv && <div className="mono" style={{ fontSize: 11 }}>
                  {(dv.sf / 1000).toFixed(0)}k sf · delivers {monthLabel(dv.deliverM)}
                </div>}
              </td>
              <td>
                {/* list it from the row — no need to open the record */}
                <div className="btn-row" style={{ gap: 4, margin: 0 }}>
                  {h.sale ? (
                    <button className="btn btn-sm" onClick={(ev) => { ev.stopPropagation(); delistSale(h.bbl); }}
                      title={`Listed at ${usd(h.sale.ask)} — pull it off the market`}>
                      Delist
                    </button>
                  ) : (
                    <button className="btn btn-sm" onClick={(ev) => { ev.stopPropagation(); listSale(h.bbl, Math.round(v * 1.02)); }}
                      title={`List at ${usd(Math.round(v * 1.02))} — appraisal plus a touch. Open the record to name your own number.`}>
                      List
                    </button>
                  )}
                  <button
                    className={"btn btn-sm" + (refiRow === h.bbl ? " btn-on" : "")}
                    onClick={(ev) => { ev.stopPropagation(); setRefiRow(refiRow === h.bbl ? null : h.bbl); }}
                    title={h.loan
                      ? `${usd(h.loan.balance)} at ${h.loan.ratePct.toFixed(2)}%, balloons ${monthLabel(h.loan.maturityM)} — see what the desks will do today`
                      : "Unlevered. See what a lender will advance against it."}
                  >
                    Refi
                  </button>
                </div>
              </td>
            </tr>
            {refiRow === h.bbl && (
              <tr>
                <td colSpan={sortBy === "income" ? 17 : 16} style={{ background: "rgba(43,37,26,0.035)" }}>
                  <RefiSection bbl={h.bbl} />
                </td>
              </tr>
            )}
            </Fragment>
            );
          })}
          {Object.values(game.developments).map((dv) => (
            /* SIXTEEN CELLS, NOT FIFTEEN. This row was one short of the header
               and every value from the seventh column rightwards sat under the
               wrong heading — a job's construction loan balance was printing
               under "Gain". A misaligned number is worse than a missing one. */
            <tr key={dv.bbl} onClick={() => go(dv.bbl)}>
              {bundling && <td className="dim">·</td>}
              {sortBy === "income" && <td className="num dim">—</td>}
              <td>{parcels[dv.bbl]?.address ?? dv.bbl}</td>
              <td>{devUseLabel(dv.use)}</td>
              <td className="num dim">{sf(dv.sf)}</td>
              <td className="num dim">—</td>
              <td className="num dim">—</td>
              <td className="num dim">—</td>
              <td className="num dim">—</td>
              <td className="num dim">—</td>
              <td className="num" title="The budget as it stands, escalation included">{usd(dv.costTotal)}</td>
              <td className="num dim">—</td>
              <td className="num">{usd(dv.loanBalance)}</td>
              <td className="num" title="What you have actually put in so far">{usd(dv.equitySpent)}</td>
              <td className="num neg" title="Construction interest accruing into the loan, not paid in cash">
                {usd(-(dv.loanBalance * dv.ratePct) / 100 / 12)}
              </td>
              <td className="num dim">—</td>
              <td className="dim">BUILDING · delivers {monthLabel(dv.deliverM)}</td>
              <td></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One letter of intent, as a negotiation instead of a coin-flip button.
 *
 * A renewal shows the spread against what the tenant pays TODAY — that delta
 * is the entire conversation in a real renewal. The counter is two sliders,
 * rent and TI, because that is what you actually trade: the tenant reads your
 * number against the market, not against their own opener, and they answer
 * once — take it, walk, or one final counter-back.
 */
/**
 * THE PORTFOLIO DESK.
 *
 * Two questions, and the whole feature is the gap between their answers: what
 * are these buildings worth, and what will somebody pay for all of them at
 * once? The breakdown below is not decoration — every line in it is a term the
 * engine actually applied, so a seventeen-point discount is legible before you
 * commit to it rather than a surprise at the closing table.
 *
 * The reason to do this anyway is the thing the numbers cannot show you: a
 * half-empty office in a soft market has no bid AT ALL on its own. Bundled
 * with three stabilised apartment blocks it trades on the same day they do.
 * You are paying the spread to make an unsellable building sellable, and
 * whether that is worth it depends entirely on what else you want to do with
 * the next three years.
 */
function PortfolioSaleDesk({ bundle, clear }: { bundle: string[]; clear: () => void }) {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const { sellPortfolio, repricePortfolioSale, counterPortfolioBid, acceptPortfolio, pullPortfolio } =
    useStore.getState();
  const live = game.portfolioSale;
  const [askPct, setAskPct] = useState(100);
  const [counter, setCounter] = useState(0);

  // ---- a process already running -------------------------------------------
  if (live) {
    const q = portfolioQuote(game, parcels, live.bbls);
    const bid = live.bids?.[0];
    const age = game.month - live.listedM;
    return (
      <div className="page-section">
        <div className="page-section-head">
          {live.unsolicited ? "An unsolicited approach" : "Portfolio in the market"} · {live.bbls.length} buildings
        </div>
        <div className="grid">
          <Row k="Asking" v={usd(live.ask)} strong />
          <Row k="Sum of the individual marks" v={usd(q.sumOfParts)} />
          <Row k="What a bundle is indicated at" v={`${usd(q.indicative)} · ${(q.spreadPct * 100).toFixed(1)}%`}
            bad={q.spreadPct < -0.06} />
          <Row k="On the market" v={`${age} month${age === 1 ? "" : "s"}`} bad={age > 6} />
          <Row k="Indications in hand" v={String(live.bids?.length ?? 0)} />
        </div>
        <div className="mini-list" style={{ marginTop: 8 }}>
          {live.bbls.map((b) => {
            const rec = resolveRec(parcels, game, b);
            return (
              <div key={b} className="mini-row" style={{ cursor: "pointer" }}
                onClick={() => useStore.getState().focus(b, true)}>
                <span>{rec?.address ?? b}</span>
                <span className="mono dim">{rec ? useLabel(rec) : ""}</span>
              </div>
            );
          })}
        </div>
        {bid ? (
          <>
            <div className="hint" style={{ marginTop: 10 }}>
              <strong>{bid.name}</strong> is at {usd(bid.price)} — {((1 - bid.price / Math.max(1, q.sumOfParts)) * 100).toFixed(1)}%
              inside the sum of the parts, good until {monthLabel(bid.expiresM)}.
              {bid.countered && " You have already been back to them once."}
            </div>
            <div className="btn-row">
              <button className="btn btn-buy" onClick={() => acceptPortfolio(false)}>
                Close it — {usd(bid.price)}
              </button>
              <button className="btn" onClick={() => acceptPortfolio(true)}
                title="Roll the whole gain into a 1031 and redeploy inside six months, or the tax comes due">
                Close into a 1031
              </button>
              {!bid.countered && (
                <>
                  <Slider min={bid.price} max={Math.round(bid.price * 1.18)} step={100_000}
                    value={counter || Math.round(bid.price * 1.05)} onChange={setCounter}
                    label="Counter at" format={(v: number) => usd(v)} />
                  <button className="btn" onClick={() => counterPortfolioBid(counter || Math.round(bid.price * 1.05))}>
                    Counter
                  </button>
                </>
              )}
              <button className="btn" onClick={() => { pullPortfolio(); clear(); }}>Pull it</button>
            </div>
            <div className="hint">
              An institution has a committee number. You can push them a few points and no further, and pushing
              hard on a bundle is how the whole thing goes away — there is another portfolio next quarter and
              they know it.
            </div>
          </>
        ) : (
          <>
            <div className="hint" style={{ marginTop: 10 }}>
              No indications yet. {age > 5
                ? "Six months of silence on a portfolio is the market pricing the weakest building in it. Cut the number or take them out and sell them one at a time."
                : "Institutional buyers underwrite a bundle for a quarter before they call."}
            </div>
            <div className="btn-row">
              <Slider min={Math.round(q.indicative * 0.8)} max={Math.round(q.sumOfParts * 1.05)} step={250_000}
                value={live.ask} onChange={(v: number) => repricePortfolioSale(v)} label="Ask" format={(v: number) => usd(v)} />
              <button className="btn" onClick={() => { pullPortfolio(); clear(); }}>Pull it</button>
            </div>
          </>
        )}
      </div>
    );
  }

  // ---- assembling one ------------------------------------------------------
  if (bundle.length < 1) return null;
  const q = portfolioQuote(game, parcels, bundle);
  const ask = Math.round(q.indicative * (askPct / 100));
  return (
    <div className="page-section">
      <div className="page-section-head">Sell {bundle.length} buildings as one trade</div>
      {bundle.length < 2 ? (
        <div className="hint">Tick one more. A portfolio is two buildings or more — one building is a listing.</div>
      ) : (
        <>
          <div className="grid">
            <Row k="Sum of the individual marks" v={usd(q.sumOfParts)} strong />
            {q.why.map((w, i) => (
              <Row key={i} k={w.label} v={`${w.pct >= 0 ? "+" : ""}${(w.pct * 100).toFixed(1)}%`} bad={w.pct < 0} />
            ))}
            <Row k="What a bundle is worth" v={`${usd(q.indicative)} · ${(q.spreadPct * 100).toFixed(1)}% against the parts`}
              strong bad={q.spreadPct < 0} />
            <Row k="Buyers who can fund it" v={String(q.depth)} bad={q.depth <= 1} />
          </div>
          <div className="hint">
            {q.spreadPct < -0.10
              ? "That is a serious discount, and it is being driven by the buildings at the bottom of this list. Take them out and the blend improves — but those are the ones with no bid of their own, which is the entire reason to bundle."
              : q.spreadPct < -0.03
                ? "A few points inside the parts, which is what a clean portfolio costs. You are buying a single closing and a clean exit with it."
                : "A tight, coherent bundle. Institutions pay up for exactly this and there is very little discount in it."}
          </div>
          <Slider min={80} max={112} step={1} value={askPct} onChange={setAskPct}
            label="Ask, against the indicative" format={(v: number) => `${v}% · ${usd(Math.round(q.indicative * (v / 100)))}`} />
          <div className="hint">
            Ask over the indicative and you may get nothing for nine months; ask under it and you will have
            indications inside a quarter. Nine months is the whole run — after that every buyer in town has seen
            it and passed, and that is a fact about your portfolio that does not go away.
          </div>
          <div className="btn-row">
            <button className="btn btn-buy" onClick={() => { sellPortfolio(bundle, ask); clear(); }}>
              Take it to market at {usd(ask)}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function LoiCard({ loi, go }: { loi: import("@/engine/types").LOI; go: (bbl: string) => void }) {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const { respondLoi } = useStore.getState();
  const rec = parcels[loi.bbl];
  const [countering, setCountering] = useState(false);
  const [cRent, setCRent] = useState(+(loi.rentPsf * 1.05).toFixed(2));
  const [cTi, setCTi] = useState(loi.tiPsf);
  const h = game.holdings[loi.bbl];
  const liveRec = rec ? resolveRec(parcels, game, loi.bbl) : null;
  const market = liveRec && h ? managedRentPsfYr(liveRec, game.econ, h, loi.use) : loi.rentPsf;
  const prevRent = loi.kind === "renewal" && loi.tenantIdx !== undefined ? h?.tenants[loi.tenantIdx]?.rentPsf : undefined;
  const final = loi.stage === "countered";
  // WHO ELSE IS CHASING THIS SPACE. The entire point of a tour is that you can
  // only have one of them, so the card has to say so before you press Accept.
  const rivalsOnTour = loi.tourId === undefined ? 0
    : game.lois.filter((l) => l.tourId === loi.tourId && l.id !== loi.id).length;
  return (
    <div className="loi">
      <button className="loi-addr" onClick={() => go(loi.bbl)}>{rec?.address ?? loi.bbl}</button>
      <div className="loi-line">
        <b>{loi.name}</b> <span className="mono">{CREDIT_LABEL[loi.credit]}</span> · {loi.sector}
        {loi.kind === "renewal" && <span className="chip chip-renewal">RENEWAL</span>}
        {rivalsOnTour > 0 && <span className="chip" title="Competing for the same square feet — you can take only one, and countering one makes the others impatient.">{rivalsOnTour + 1} FOR THE SAME SPACE</span>}
        {final && <span className="chip">FINAL</span>}
      </div>
      <div className="loi-line mono">
        {(loi.sf / 1000).toFixed(1)}k sf · ${loi.rentPsf.toFixed(2)}/sf {loi.net ? "NNN" : "gross"} · {(loi.termM / 12).toFixed(0)} yrs
        {loi.tiPsf > 0 && ` · TI $${loi.tiPsf}`}{loi.freeM > 0 && ` · ${loi.freeM}mo free`}
      </div>
      {prevRent !== undefined && (
        <div className="loi-line mono" style={{ color: loi.rentPsf >= prevRent ? "#3a7d46" : "#a8402e" }}>
          paying ${prevRent.toFixed(2)} today → offering ${loi.rentPsf.toFixed(2)}
          {" "}({loi.rentPsf >= prevRent ? "+" : ""}{(((loi.rentPsf / prevRent) - 1) * 100).toFixed(1)}%)
        </div>
      )}
      {/* THE CONVERSATION, on the card. When they come back at you the card
          used to silently overwrite the terms with the new ones, so there was
          no way to see what your counter had actually achieved. */}
      {final && loi.askedRentPsf !== undefined && (
        <div className="loi-line mono" style={{ color: "#7a5c1e" }}>
          you asked ${loi.askedRentPsf.toFixed(2)}
          {loi.askedTiPsf !== undefined && loi.openRentPsf !== undefined ? ` (they opened at $${loi.openRentPsf.toFixed(2)})` : ""}
          {" "}→ their final ${(loi.counterRentPsf ?? loi.rentPsf).toFixed(2)}/sf
          {loi.counterTiPsf !== undefined ? ` · TI $${loi.counterTiPsf}` : ""}
        </div>
      )}
      <div className="loi-line mono dim">
        market ~${market.toFixed(2)}/sf · signing costs {usd(loiSigningCost(loi, exclusiveFeeRate(h)))}{h?.broker ? " incl. the 6% exclusive" : ""} · answer by {monthLabel(loi.expiresM)}
      </div>
      {countering && !final && !loi.countered && (
        <>
          <Slider
            label="Your rent"
            value={cRent}
            min={+(loi.rentPsf * 0.9).toFixed(2)}
            max={+(Math.max(loi.rentPsf * 1.3, market * 1.2)).toFixed(2)}
            step={0.25}
            onChange={setCRent}
            format={(v) => `$${v.toFixed(2)}/sf · ${((v / market - 1) * 100).toFixed(0)}% vs market`}
            marks={[{ at: loi.rentPsf, label: "their offer" }, { at: +market.toFixed(2), label: "market" }]}
            hint={cRent > market * 1.08 ? "Past market they walk fast — the space is only worth what the market says." : "Incumbents bend a little; new tenants don't."}
          />
          {loi.tiPsf > 0 && (
            <Slider
              label="TI allowance"
              value={cTi}
              min={0}
              max={loi.tiPsf}
              step={1}
              onChange={setCTi}
              format={(v) => `$${v}/sf · ${usd(v * loi.sf)}`}
              marks={[{ at: loi.tiPsf, label: "they asked" }, { at: Math.round(loi.tiPsf / 2), label: "half" }]}
              hint="Cutting their fit-out money costs you odds — it is real dollars to them."
            />
          )}
        </>
      )}
      <div className="btn-row">
        <button className="btn btn-buy" onClick={() => respondLoi(loi.id, "accept", true)}>
          {final ? "Take their final" : "Accept"}
        </button>
        {!loi.countered && !final && !countering && (
          <button className="btn" onClick={() => setCountering(true)}>Counter…</button>
        )}
        {countering && !final && !loi.countered && (
          <>
            <button className="btn" onClick={() => { respondLoi(loi.id, "counter", true, { rentPsf: cRent, tiPsf: cTi }); setCountering(false); }}>
              Send · ${cRent.toFixed(2)}/sf{loi.tiPsf > 0 ? ` · TI $${cTi}` : ""}
            </button>
            <button className="btn" title="Sign it or walk — nobody counters back a best and final." onClick={() => { respondLoi(loi.id, "counter", true, { rentPsf: cRent, tiPsf: cTi, bestFinal: true }); setCountering(false); }}>
              Best &amp; final
            </button>
          </>
        )}
        <button className="btn" onClick={() => respondLoi(loi.id, "decline")}>Pass</button>
      </div>
    </div>
  );
}

/**
 * AN OFFER ON ONE OF YOURS, answerable in full from the deals screen.
 *
 * Accept and Decline were the only two moves here, which meant a bid you would
 * have taken five per cent higher had to be thrown away or chased down into
 * the building's own record. Every seller alive picks up the phone instead —
 * once. That third button is the whole of selling well.
 */
function SaleOfferCard({ bbl, ask, go }: { bbl: string; ask: number; go: (bbl: string) => void }) {
  const game = useStore((s) => s.game)!;
  const { acceptOffer, declineOffer, counterSale } = useStore.getState();
  const [counter, setCounter] = useState(0);
  const h = game.holdings[bbl];
  const offer = h?.sale?.offer;
  const suggested = offer ? Math.round(offer.price * 1.06) : 0;
  return (
    <div className="loi">
      <button className="loi-addr" onClick={() => go(bbl)}>{useStore.getState().parcels?.[bbl]?.address ?? bbl}</button>
      <div className="loi-line mono">
        ask {usd(ask)}{h?.sale?.mode === "marketed" ? " · marketed campaign" : ""}
        {/* THE NUMBER EVERY BUYER CONVERTS YOUR ASK INTO before they answer the
            phone. It was on the property card and not here, which is the one
            screen you actually work your sales from. */}
        {(() => {
          const st = useStore.getState();
          const rec = st.parcels ? resolveRec(st.parcels, game, bbl) : null;
          if (!rec || !h || rec.class === "land" || !rec.bldgArea || ask <= 0) return null;
          const noi = holdingNOIYr(rec, game.econ, h, game.month);
          if (noi <= 0) return null;
          const cap = (noi / ask) * 100;
          const mkt = game.econ.capRate[(rec.class as BuiltClass)] ?? cap;
          return (
            <> · asking a <b>{cap.toFixed(2)}%</b> cap
              <span className={cap < mkt - 0.4 ? " neg" : ""}> (market {mkt.toFixed(2)}%)</span>
            </>
          );
        })()}
      </div>
      {offer ? (
        <>
          <div className="loi-line mono">
            {offer.retrade ? <b className="neg">retraded — </b> : null}
            <b>{usd(offer.price)}</b> offered{offer.from ? ` by ${offer.from}` : ""} · good until {monthLabel(offer.expiresM)}
            {" "}· {((offer.price / Math.max(1, ask) - 1) * 100).toFixed(1)}% against your ask
          </div>
          <div className="btn-row">
            <button className="btn btn-buy" onClick={() => acceptOffer(bbl)}>Accept {usd(offer.price)}</button>
            <button className="btn" onClick={() => declineOffer(bbl)}>Decline</button>
          </div>
          {!offer.countered && (
            <>
              <Slider
                label="Counter"
                value={counter || suggested}
                min={offer.price + 1000}
                max={Math.round(Math.max(ask, offer.price * 1.3))}
                step={Math.max(1000, Math.round(offer.price / 400))}
                onChange={setCounter}
                format={(v) => `${usd(v)} · +${(((v / offer.price) - 1) * 100).toFixed(1)}% on their bid`}
                marks={[
                  { at: Math.round(offer.price * 1.03), label: "+3%" },
                  { at: Math.round(offer.price * 1.08), label: "+8%" },
                  { at: ask, label: "ask" },
                ]}
                hint="Inside what the building is worth to them and they take it. A little over and they split it. Well over and they walk — and an unsolicited buyer takes the whole approach with them."
              />
              <div className="btn-row">
                <button className="btn" onClick={() => counterSale(bbl, counter || suggested)}>
                  Counter at {usd(counter || suggested)}
                </button>
              </div>
            </>
          )}
          {offer.countered && <div className="loi-line dim">You have been back to them once. This number is the number.</div>}
        </>
      ) : (
        <div className="loi-line dim">
          {h?.sale?.callM !== undefined
            ? `Book is out — offers due ${monthLabel(h.sale.callM)}.`
            : "no offers yet"}
        </div>
      )}
    </div>
  );
}

function DealsPage() {
  const parcels = useStore((s) => s.parcels)!;
  const game = useStore((s) => s.game)!;
  const focus = useStore((s) => s.focus);
  const q = game.month;
  const go = (bbl: string) => focus(bbl, true);

  const expiring: { bbl: string; name: string; sf: number; endM: number }[] = [];
  const maturities: { bbl: string; matM: number; bal: number; sweep: boolean }[] = [];
  const sales: { bbl: string; ask: number; offer?: { price: number; expiresM: number } }[] = [];
  const calls = Object.entries(game.approaches)
    .filter(([bbl, a]) => !a.refused && a.ask && !game.holdings[bbl])
    .map(([bbl, a]) => ({ bbl, ask: a.ask!, inbound: !!a.inbound, lapseM: a.q + 12 }))
    .sort((a, b) => a.lapseM - b.lapseM);
  for (const h of Object.values(game.holdings)) {
    for (const t of h.tenants) if (t.endM - q <= 12 && t.endM > q) expiring.push({ bbl: h.bbl, name: t.name, sf: t.sf, endM: t.endM });
    if (h.loan && (h.loan.maturityM - q <= 24 || h.loan.sweep)) maturities.push({ bbl: h.bbl, matM: h.loan.maturityM, bal: h.loan.balance, sweep: h.loan.sweep });
    if (h.sale) sales.push({ bbl: h.bbl, ask: h.sale.ask, offer: h.sale.offer });
  }

  return (
    <div>
      {game.exchange && (
        <div className="hint exchange-clock">
          ⏱ 1031 clock: buy for ≥ {usd(game.exchange.minPrice * 0.8)} by {monthLabel(game.exchange.deadlineM)} or {usd(game.exchange.deferredTax)} of deferred tax comes due.
        </div>
      )}
      <div className="deals-grid">

      <section>
        {/* EVERYTHING ON THE TABLE, contracts first — because a contract has
            a clock on it and a conversation does not. This used to be able to
            show exactly one row, since the game could only hold one. */}
        {(() => {
          const live = Object.values(game.talks ?? {})
            .sort((a, b) => (b.agreed ? 1 : 0) - (a.agreed ? 1 : 0) || (a.closeByM ?? 1e9) - (b.closeByM ?? 1e9));
          const committed = live.reduce((a, t) => a + (t.agreed ? (t.agreedPrice ?? t.theirPrice) : 0), 0);
          return (
            <>
              <div className="page-section">On the table · {live.length} of {MAX_TALKS}</div>
              {live.length === 0 && (
                <div className="hint">Nothing on the table. Open a negotiation from any listing — you can run {MAX_TALKS} at once.</div>
              )}
              {live.map((t) => (
                <div key={t.bbl} className="hint" style={{ cursor: "pointer" }} onClick={() => go(t.bbl)}>
                  <strong>{parcels[t.bbl]?.address ?? t.bbl}</strong>
                  {t.agreed ? (
                    <> — agreed at <b className="mono">{usd(t.agreedPrice ?? t.theirPrice)}</b> with {t.sellerName},{" "}
                      {usd(t.deposit ?? 0)} down. Fund it by <b>{monthLabel(t.closeByM ?? game.month)}</b> or the deposit is theirs.</>
                  ) : (
                    <> — {t.sellerName} is at <b className="mono">{usd(t.theirPrice)}</b>, you are at {usd(t.yourPrice)}.{" "}
                      {t.final ? "Their final word." : `Round ${t.round} of ${t.maxRounds}.`}</>
                  )}
                </div>
              ))}
              {committed > 0 && (
                <div className={"hint" + (committed > game.cash * 4 ? " alarm" : "")}>
                  {usd(committed)} of price agreed and not yet funded, against {usd(game.cash)} of cash.
                  {committed > game.cash * 4 && " You have signed more than you can plausibly fund. One of these is going to cost you its deposit."}
                </div>
              )}
            </>
          );
        })()}
        {/* TENANTS ASKING. Mid-lease relief letters — deliberately cards on
            this desk and never pop-ups: with thirty tenants a modal per ask
            would be a fire alarm every quarter. Both buttons are the whole
            decision; the letter lapses in three months and a lapse is a no. */}
        {!!game.asks?.length && (
          <>
            <div className="page-section">Tenants asking · {game.asks.length}</div>
            <div className="mini-list">
              {game.asks.map((a) => {
                const rec = resolveRec(parcels, game, a.bbl);
                const monthsLeft = a.expiresM - game.month;
                const yrsIn = Math.floor((game.month - a.tenantStartM) / 12);
                return (
                  <div key={a.id} className="deal" style={{ marginBottom: 8 }}>
                    <div className="deal-head">
                      {a.name}{yrsIn >= 8 ? ` · ${yrsIn} years in the building` : ""} · {rec?.address ?? a.bbl}
                    </div>
                    <div className="grid">
                      <Row k="Their ask" v={`$${a.askPsf.toFixed(0)}/sf, down from $${a.currentPsf.toFixed(0)} · adds ${Math.round(a.addM / 12)} yrs of term`} strong />
                      <Row k="Rent forgone" v={`~${usd(Math.round((a.currentPsf - a.askPsf) * a.sf))} / yr on ${sf(a.sf)}`} />
                      <Row k="If you decline" v="the paper stands — and a tenant running lean fails at three times the rate" />
                      <Row k="On the desk" v={`${monthsLeft} month${monthsLeft === 1 ? "" : "s"} — a lapse is a no`} bad={monthsLeft <= 1} />
                    </div>
                    <div className="modal-actions">
                      <button className="btn btn-buy" onClick={() => useStore.getState().answerAsk(a.id, "grant")}>Grant relief</button>
                      <button className="btn" onClick={() => useStore.getState().answerAsk(a.id, "decline")}>Hold the paper</button>
                      <button className="btn" onClick={() => go(a.bbl)}>The building</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
        <div className="page-section">Letters of intent · {game.lois.length}</div>
        {game.lois.length === 0 && <div className="hint">No live negotiations. Vacant space in high-demand buildings draws tenants.</div>}
        <div className="loi-grid">
          {[...game.lois]
            .sort((a, b) => (a.tourId ?? -a.id) - (b.tourId ?? -b.id) || a.id - b.id)
            .map((loi) => <LoiCard key={loi.id} loi={loi} go={go} />)}
        </div>
        {/* HOW THEY ANSWERED. A counter used to resolve into a toast that was
            gone in three seconds and a card that vanished off the grid — so the
            most consequential leasing decision in the game left no account of
            itself. What you asked, what they did, and what it was worth. */}
        {!!game.leaseReplies?.length && (
          <>
            <div className="page-section" style={{ marginTop: 18 }}>Their answer · last {game.leaseReplies.length}</div>
            <div className="mini-list">
              {game.leaseReplies.map((r, i) => {
                const delta = (r.theirRentPsf - r.askedRentPsf) * r.sf;
                return (
                  <button key={i} className="neighbor" onClick={() => go(r.bbl)}>
                    <span className="neighbor-addr">
                      {r.outcome === "took" ? "✓ " : r.outcome === "walked" ? "✕ " : "↩ "}
                      {r.name}
                      <span className="dim"> · {r.address}</span>
                    </span>
                    <span className="neighbor-meta mono">
                      {r.outcome === "took"
                        ? `took your $${r.askedRentPsf.toFixed(2)}/sf — ${usd(r.askedRentPsf * r.sf)} a year on ${sf(r.sf)}`
                        : r.outcome === "walked"
                          ? `walked. You asked $${r.askedRentPsf.toFixed(2)} into a $${r.marketPsf.toFixed(2)} market — ${sf(r.sf)} still empty`
                          : `came back at $${r.theirRentPsf.toFixed(2)} against your $${r.askedRentPsf.toFixed(2)} · ${delta >= 0 ? "+" : "−"}${usd(Math.abs(delta))} a year`}
                      {" · "}{monthLabel(r.m)}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </section>

      <section>
        {/* An off-market approach that you set aside has to be findable, or
            "Not now" is the same as "never" — and a call the broker made on
            your behalf is a live deal whether or not you looked at it today. */}
        <div className="page-section">Off-market · {calls.length}</div>
        {calls.length === 0 && <div className="hint">No live approaches. Brokers call when you own enough for them to care.</div>}
        <div className="mini-list">
          {calls.map((c) => (
            <button key={c.bbl} className="neighbor" onClick={() => go(c.bbl)}>
              <span className="neighbor-addr">{c.inbound ? "☎ " : ""}{parcels[c.bbl]?.address ?? c.bbl}</span>
              <span className="neighbor-meta">
                {usd(c.ask)} · lapses {monthLabel(c.lapseM)}
              </span>
            </button>
          ))}
        </div>

        <div className="page-section" style={{ marginTop: 18 }}>Sales in progress · {sales.length}</div>
        {sales.length === 0 && <div className="hint">Nothing listed. Sell from any owned building's card.</div>}
        {sales.map((sl) => <SaleOfferCard key={sl.bbl} bbl={sl.bbl} ask={sl.ask} go={go} />)}

        <div className="page-section" style={{ marginTop: 18 }}>Rolling within a year · {expiring.length}</div>
        <div className="mini-list">
          {expiring.map((e, i) => (
            <button key={i} className="neighbor" onClick={() => go(e.bbl)}>
              <span className="neighbor-addr">{e.name}</span>
              <span className="neighbor-meta mono">{parcels[e.bbl]?.address} · exp {monthLabel(e.endM)}</span>
            </button>
          ))}
          {expiring.length === 0 && <div className="hint">No near-term expirations.</div>}
        </div>

        <div className="page-section" style={{ marginTop: 18 }}>Debt watch · {maturities.length}</div>
        <div className="mini-list">
          {maturities.map((m, i) => (
            <button key={i} className="neighbor" onClick={() => go(m.bbl)}>
              <span className="neighbor-addr">{m.sweep ? "⚠ " : ""}{parcels[m.bbl]?.address}</span>
              <span className="neighbor-meta mono">{usd(m.bal)} · balloon {monthLabel(m.matM)}{m.sweep ? " · SWEEP" : ""}</span>
            </button>
          ))}
          {maturities.length === 0 && <div className="hint">No balloons or breaches on the radar.</div>}
        </div>
      </section>
      </div>
    </div>
  );
}

// The credit window, in words rather than an index nobody can calibrate.
function creditWord(ci: number): string {
  return ci >= 1.08 ? "loose" : ci >= 0.92 ? "open" : ci >= 0.78 ? "selective" : ci >= 0.62 ? "tight" : "shut";
}

/**
 * THE CITY, SIX CHARTS WIDE — the "general" card's detail view.
 *
 * The stat strips print today's numbers; these are the six city series with
 * their history attached, one per cell, because the level of a demand series
 * is nearly meaningless without the path it took to get there.
 * Wages and output are REAL — already deflated by the price level in the
 * sixth chart — so a flat real wage across a decade of inflation is a city
 * treading water, not one getting richer.
 *
 * `spanYrs` is how much of the record the page's window switch has selected.
 * The heading used to say "the last twenty years" in fixed text, which stopped
 * being true the moment that switch existed.
 */
/**
 * DEFLATE. THE ENGINE KEEPS NOMINAL SERIES AND THIS PAGE WAS PLOTTING THEM RAW.
 *
 * `wageIdx` is nominal — `market.ts` says so in capitals ("WAGES ARE NOMINAL AND
 * THEY TRACK PRICES") and builds it out of `inflExp/12 + productivity/12`.
 * `outputIdx` is `jobs x wageIdx`, so it is nominal city product. Both were
 * drawn here under titles that said "real" and notes that said "inflation is
 * already taken out", and the division was simply never done.
 *
 * That is the third kind of fake number — one quantity with two answers — and
 * it is also the whole of the complaint that the wage chart "looks like a
 * straight line up that never comes down". A NOMINAL wage index cannot come
 * down: downward nominal rigidity is modelled on purpose (market.ts, the
 * wageDebt block), and measured over six seeds x 50 years it fell in 0.00% of
 * twelve-month windows, worst -0.01%. The real wage, the same runs, fell in
 * 15.87% of them, worst -3.64% — about one year in six, against US real average
 * hourly earnings falling roughly one year in five and -2.8% in 2022 alone.
 * Trend real growth is 0.87%/yr (range 0.50-1.09 across seeds), which is the
 * 1.1% productivity centre less labour hoarding and the wage debt worked off
 * after freezes.
 *
 * So the series the player was told they were looking at existed all along.
 */
const real = (nom: number | undefined, cpi: number | undefined) => (nom ?? 1) / (cpi || 1);

function CityEconCharts({ tail, spanYrs }: { tail: EconHistoryPoint[]; spanYrs: number }) {
  if (tail.length < 2) return <div className="hint">Not enough history yet — advance a few quarters.</div>;
  const x: [string, string] = [monthLabel(tail[0].q), monthLabel(tail[tail.length - 1].q)];
  const kFmt = (v: number) => `${v.toFixed(0)}k`;
  const idxFmt = (v: number) => v.toFixed(2);
  return (
    <>
      <div className="page-section">The city — the last {spanYrs} year{spanYrs === 1 ? "" : "s"}</div>
      <div className="hint">
        The demand behind every lease in the four markets above. Rents are downstream of jobs, and jobs are
        downstream of whether anybody wants to be here — none of these series reads as a level without the
        path it took.
      </div>
      <div className="chart-grid">
        <div className="chart-cell">
          <div className="chart-title">Population</div>
          <LineChart height={108} series={[{ label: "population", color: "#7a5c1e", pts: tail.map((h) => (h.population ?? 0) / 1000) }]} yFmt={kFmt} xLabels={x} />
          <div className="chart-note">
            Souls in the city. It follows jobs slowly, because people move for work and move back reluctantly —
            a downturn shows here a year after it shows in the chart to the right.
          </div>
        </div>
        <div className="chart-cell">
          <div className="chart-title">Jobs</div>
          <LineChart height={108} series={[{ label: "jobs", color: "#2f6f7a", pts: tail.map((h) => (h.jobs ?? 0) / 1000) }]} yFmt={kFmt} xLabels={x} />
          <div className="chart-note">
            Filled positions — the line every lease is downstream of. Occupancy chases the space these jobs
            want, with a lag, which is why rents turn before employment does.
          </div>
        </div>
        <div className="chart-cell">
          <div className="chart-title">Unemployment</div>
          <LineChart height={108} series={[{ label: "unemployment", color: "#a8402e", pts: tail.map((h) => (h.unemployment ?? 0) * 100) }]} yFmt={(v) => `${v.toFixed(1)}%`} xLabels={x} />
          <div className="chart-note">
            Of the labour force. The LAST thing to turn in a downturn — by the time this reads badly the rents
            already have, and by the time it recovers the cheap buildings are gone.
          </div>
        </div>
        <div className="chart-cell">
          <div className="chart-title">Real wage — index, 1.00 = year 2000</div>
          {/* THE REAL WAGE GETS THIS AXIS TO ITSELF. Drawing the nominal index
              beside it was the obvious way to show the contrast and it does not
              work: nominal reaches 4.5x over a campaign against real's 1.35x, so
              the shared scale flattens the series that matters into a rule along
              the bottom — which is the very "straight line" complaint this chart
              exists to answer. The nominal figure is a Row on the Economy page
              instead, where a number does the job a squashed line cannot. */}
          <LineChart height={108} series={[{ label: "real wage", color: "#3a7d46", pts: tail.map((h) => real(h.wageIdx, h.cpi)) }]} yFmt={idxFmt} xLabels={x} />
          <div className="chart-note">
            What a paycheque buys, with inflation actually taken out. It gives ground about one year in six —
            firms freeze pay rather than cut it, so the cutting is done by the price-level chart below instead.
            Dear money raises this line and cheap money erodes it, both with a lag of a year or two. Retail and
            apartment rents lean on it hardest.
          </div>
        </div>
        <div className="chart-cell">
          <div className="chart-title">Real output — index, 1.00 = year 2000</div>
          <LineChart height={108} series={[{ label: "real output", color: "#3d6f9e", pts: tail.map((h) => real(h.outputIdx, h.cpi)) }]} yFmt={idxFmt} xLabels={x} />
          <div className="chart-note">
            Jobs times productivity, in real terms — the city's whole product on one line. When it grows faster
            than the standing stock of space, somebody has to build; when it does not, somebody already did.
          </div>
        </div>
        <div className="chart-cell">
          <div className="chart-title">Price level — nominal, 1.00 = year 2000</div>
          <LineChart height={108} series={[{ label: "price level", color: "#8a5620", pts: tail.map((h) => h.cpi ?? 1) }]} yFmt={idxFmt} xLabels={x} />
          <div className="chart-note">
            Cumulative inflation — the one NOMINAL series here, and the deflator behind the two real ones.
            Every dollar elsewhere on this page is quoted in the money this chart is quietly shrinking.
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * THE ECONOMY, WHOLE.
 *
 * Everything outside your buildings, on one page, arranged the way a market
 * report is: the cycle at the top, then — for each asset class — the four
 * questions that decide whether to buy, hold, or build.
 *
 *   How tight is it?      vacancy against its natural rate
 *   Which way is it going? rents and vacancy over the last twenty years, or
 *                          over the whole run — one switch, every chart
 *   What is coming?        the construction pipeline, by the year it lands
 *   Where does it end up?  vacancy projected forward if nobody else starts
 *
 * And below that, the same question asked of each NEIGHBOURHOOD, because
 * "office vacancy is 12%" is not a decision and "the Exchange is at 6% and
 * Millside is at 21%" is.
 */
function EconomyPage() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const bbls = useStore((s) => s.bbls);
  const e = game.econ;
  const hist = e.history ?? [];
  // A fifth stance joins the four classes: "general" swaps the class detail
  // for the city itself — the six series every rent in the game is downstream
  // of. It lands first because the class cards only make sense against it.
  const [sel, setSel] = useState<BuiltClass | "general">("general");
  // Every per-class computation below still wants a concrete class, and the
  // cheapest way to keep "general" from breaking marketBalance(e, focus) and
  // its neighbours is to let them run against office while the general grid
  // is up — nothing they produce is rendered then.
  const focus: BuiltClass = sel === "general" ? "office" : sel;
  const CLASSES: BuiltClass[] = ["office", "retail", "multifamily", "industrial"];
  const COLOR: Record<BuiltClass, string> = {
    office: "#3d6f9e", retail: "#a8562e", multifamily: "#4a7d5a", industrial: "#7a6a45",
  };

  const bal = marketBalance(e, focus);
  const vacNow = e.cityVac?.[focus] ?? NATURAL_VAC[focus];
  const stock = e.stock?.[focus] ?? CITY_STOCK[focus];
  const mos = monthsOfSupply(e, focus);
  const sched = deliverySchedule(e, game.month, 4)[focus];
  const proj = projectVacancy(e, focus, game.month, 36);
  const subs = submarkets(game, parcels, bbls);
  // The map's fly-to action, under a name that does not collide with the
  // class this page is focused on.
  const flyTo = useStore((s) => s.focus);

  // THE JOBS BEHIND THE PIPELINE. The cohort queue the delivery chart reads
  // is fed from the city's and the rivals' construction sites — s.cityJobs,
  // pushed the month the hole is dug — so walking that same list names the
  // buildings, and the rows reconcile to the cohort sf due in the window
  // exactly. Your own developments never enter the queue (they land as stock
  // on delivery), but they are coming supply all the same, so they belong
  // here too. A mixed-use job contributes only its share of the focused
  // class; an orphaned frame stays listed — its space is still in the queue —
  // flagged as stalled.
  const pipeJobs = (() => {
    const rows: { bbl: string; who: string; sf: number; floors: number; deliverM: number; stalled?: boolean; mixed?: boolean }[] = [];
    for (const j of game.cityJobs ?? []) {
      if (j.deliverM - game.month >= 24) continue;
      const csf = Math.round(j.sf * (devMix(j.use as DevUse)[focus] ?? 0));
      if (csf <= 0) continue;
      rows.push({
        bbl: j.bbl,
        who: j.firmId ? (game.rivals.find((r) => r.id === j.firmId)?.name ?? "A rival") : "The city",
        sf: csf, floors: j.floors, deliverM: j.deliverM, stalled: j.orphaned, mixed: j.use === "mixed",
      });
    }
    for (const d of Object.values(game.developments)) {
      if (d.deliverM - game.month >= 24) continue;
      const csf = Math.round(d.sf * (d.mix[focus] ?? 0));
      if (csf <= 0) continue;
      rows.push({ bbl: d.bbl, who: "You", sf: csf, floors: d.floors, deliverM: d.deliverM, mixed: d.use === "mixed" });
    }
    return rows.sort((a, b) => b.sf - a.sf);
  })();
  const pipeJobsSf = pipeJobs.reduce((a, r) => a + r.sf, 0);

  // HOW MUCH OF THE RECORD THIS PAGE IS LOOKING AT.
  //
  // Twenty years was the only window there was, and twenty years is one and a
  // half cycles — long enough to see the last glut and too short to see
  // whether it was the biggest one. The owner asked for the whole run on the
  // vacancy chart.
  //
  // The switch drives EVERY chart on the page that reads `tail`, not just
  // vacancy, and that is deliberate: rent/cap, absorbed/delivered, the
  // concession gap and the six city series are all fed by this one array and
  // all sit inside one scroll. Moving one of them to a fifty-year axis while
  // its neighbour stays on a twenty-year one invites reading a level off one
  // chart and a date off the other, which is the specific mistake the page
  // exists to prevent. `flowYears` is untouched — it is explicitly the last
  // eight years of annual bars and slices `hist` itself.
  //
  // "All" really is all: recordHistory stamps one point a month and trims at
  // 1260 (105 years), so nothing a run of this game can produce hits the cap.
  const SPAN_M = 240;
  const [span, setSpan] = useState<"20y" | "all">("20y");
  const tail = span === "all" ? hist : hist.slice(-SPAN_M);
  // Every x-axis on the page was computed as `game.month - <some length>`,
  // which was right only while the window was exactly 240 long. The first
  // point carries its own month; use it, and the labels follow the switch.
  const xFrom = `${2000 + Math.floor((tail[0]?.q ?? game.month) / 12)}`;
  const xTo = `${2000 + Math.floor(game.month / 12)}`;
  const spanYrs = Math.max(1, Math.round(((tail[tail.length - 1]?.q ?? game.month) - (tail[0]?.q ?? game.month)) / 12));
  const vacSeries = tail.map((h) => (h.vac?.[focus] ?? NATURAL_VAC[focus]) * 100);
  const rentSeries = tail.map((h) => h.rent?.[focus] ?? e.rentIdx[focus]);
  // pre-v30 history has no effective series; fall back to asking so the two
  // lines simply overlap until the concession machinery has lived a month
  const effSeries = tail.map((h) => h.effRent?.[focus] ?? h.rent?.[focus] ?? e.rentIdx[focus]);
  const capSeries = tail.map((h) => h.cap?.[focus] ?? e.capRate[focus]);
  // the past twenty years of vacancy, then the next three of projection, on
  // one axis — the join is where the pipeline takes over from the record
  const vacWithProj = [...vacSeries, ...proj.map((v) => v * 100)];

  // annual flows: completions against net absorption, last eight years
  const flowYears: BarGroup[] = (() => {
    const byYear = new Map<number, { abs: number; comp: number }>();
    for (const h of hist) {
      const yr = Math.floor(h.q / 12);
      const cur = byYear.get(yr) ?? { abs: 0, comp: 0 };
      cur.abs += h.abs?.[focus] ?? 0;
      cur.comp += h.comp?.[focus] ?? 0;
      byYear.set(yr, cur);
    }
    return [...byYear.entries()].slice(-8).map(([yr, v]) => ({
      label: String((2000 + yr) % 100).padStart(2, "0"),
      bars: [{ v: v.abs, color: "#4a7d5a" }, { v: -v.comp, color: "#a8562e" }],
    }));
  })();

  const pipeGroups: BarGroup[] = sched.map((sf, i) => ({
    label: i === 0 ? "next 12m" : `yr ${i + 1}`,
    bars: [{ v: sf, color: COLOR[focus] }],
  }));

  const phaseBlurb = {
    expansion: "Tenants expand, capital chases, rents push. Enjoy it — peaks are born here.",
    peak: "Priced to perfection. Every deal works on paper and none has margin for the turn.",
    recession: "Tenants retrench and lenders retreat. Cheap buildings and expensive money.",
    recovery: "The bleeding has stopped. Concessions burn off before face rents move.",
  }[e.phase];

  const pctFmt = (v: number) => `${v.toFixed(1)}%`;
  // square feet at whatever magnitude the data actually is — a 40,000 sf
  // pipeline printed as "0.0M" four times is not a chart, it is a blank
  const sfFmt = (v: number) => {
    const a = Math.abs(v);
    return a >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : a >= 1e4 ? `${Math.round(v / 1e3)}k` : a >= 1 ? `${Math.round(v / 100) / 10}k` : "0";
  };

  return (
    <div>
      <div className="stat-strip">
        <Big label="Cycle" value={e.phase} />
        <Big label="Base rate" value={pct(e.indexRate)}
          title="Every loan in town prices off this benchmark: your floating coupons reprice to it monthly, a new quote is this rate plus the lender's spread, and cap rates lean on it — so it moves building values too." />
        {/* The era the index is moving inside. A cycle takes rates a point or
            two either way; the era decides whether that is 3% or 13%, and it
            changes on a scale of decades — which is what makes a loan you
            struck twenty years ago a different animal at maturity. */}
        {e.rateRegime !== undefined && (
          <Big label="Long-run rate" value={pct(e.rateRegime)}
            title="The level the base rate is being pulled toward — the cheap-money or dear-money era the cycle rides on top of. It re-aims every 12–25 years, which is why a loan struck today can mature in a very different rate world."
            bad={e.rateRegime > 9} />
        )}
        <Big label="Credit window" value={`${Math.round(e.creditIdx * 100)}%`} bad={e.creditIdx < 0.7} />
        <Big label="Employment" value={(e.employIdx * 100).toFixed(0)} />
        <Big label="Build costs" value={(e.costIdx * 100).toFixed(0)} />
        <Big label="Land index" value={(e.landIdx * 100).toFixed(0)} />
      </div>
      <div className="hint">{phaseBlurb}{e.rumoredPhase ? ` Word on the street: ${e.rumoredPhase} is coming.` : ""}</div>

      {/* THE RATE, WITH ITS HISTORY. Asked for twice. The series was already
          being written — every EconHistoryPoint carries indexRate, and
          recordHistory has been stamping one a month since month zero — and
          nothing had ever drawn it. A single number tells you what money costs
          today; the line tells you whether you are early or late, which is the
          whole fix-or-float decision and most of the refinancing one.
          The long-run rate is drawn alongside because the gap between them is
          the thing to read: the cycle moves the index a point or two, the era
          decides whether it is orbiting 3% or 13%. */}
      {hist.length > 8 && (
        <div className="page-section" style={{ marginTop: 12 }}>
          <div className="page-section-head">What money has cost</div>
          <LineChart
            height={132}
            series={[
              { label: "Base rate %", color: "#8a4b2a", pts: hist.map((p) => p.indexRate) },
              ...(hist.some((p) => p.rateRegime !== undefined)
                ? [{ label: "Long-run rate %", color: "#8b8370", dashed: true,
                     pts: hist.map((p) => p.rateRegime ?? p.indexRate) }]
                : []),
            ]}
            yFmt={(v) => v.toFixed(1) + "%"}
            xLabels={[monthLabel(hist[0].q), monthLabel(hist[hist.length - 1].q)]}
          />
          <div className="hint">
            Every loan in town prices off the solid line. Where it sits against the dashed one is
            whether today is a cheap-money year inside a dear-money era, or the other way round —
            and that is the difference between fixing and floating.
          </div>
        </div>
      )}

      {/* ---- the four markets, at a glance ---- */}
      <div className="page-section">The space market</div>
      <div className="mkt-cards">
        {/* The pseudo-card. No gauge, because the city has no natural rate to
            sit against — its numbers are the level everything else is read
            off. Clicking it swaps the class detail below for six city charts. */}
        <button
          className={"mkt-card" + (sel === "general" ? " mkt-card-on" : "")}
          onClick={() => setSel("general")}
        >
          <div className="mkt-card-head">
            <span className="mkt-card-name">The city</span>
            <span className="mono">{((e.population ?? 0) / 1000).toFixed(0)}k</span>
          </div>
          <div className="mkt-card-state">the demand under all four</div>
          <div className="mkt-card-sub mono">
            {((e.jobs ?? 0) / 1000).toFixed(0)}k jobs · {((e.unemployment ?? 0) * 100).toFixed(1)}% out of work
          </div>
        </button>
        {CLASSES.map((k) => {
          const b = marketBalance(e, k);
          const v = e.cityVac?.[k] ?? NATURAL_VAC[k];
          // The stock has always been the denominator under the pipeline
          // percentage on this card and the card never printed it, which made
          // the four classes unreadable against each other: a 6% pipeline on
          // 40M sf of office and the same 6% on 4M sf of industrial are not
          // the same fact about the city.
          const stockSf = e.stock?.[k] ?? CITY_STOCK[k];
          const pipe = (e.pipeline?.[k] ?? 0) / stockSf;
          return (
            <button
              key={k}
              className={"mkt-card" + (sel === k ? " mkt-card-on" : "")}
              onClick={() => setSel(k)}
            >
              <div className="mkt-card-head">
                <span className="mkt-card-name">{SECTOR_LABEL[k]}</span>
                <span className="mono">{(v * 100).toFixed(1)}%</span>
              </div>
              <Gauge value={v} natural={NATURAL_VAC[k]} lo={0} hi={0.28} fmt={(x) => `${(x * 100).toFixed(1)}%`} />
              <div className="mkt-card-state">{b.state}</div>
              {/* Each class runs its own cycle now, and which part of it you
                  are standing in is the single most useful thing on this card:
                  the same vacancy means opposite things on the way up and on
                  the way down. */}
              {e.sectorPhase?.[k] && e.sectorPhase[k] !== "steady" && (
                <div className={"mkt-card-sub" + (e.sectorPhase[k] === "bust" ? " neg" : "")}>
                  sector {e.sectorPhase[k]} · {Math.max(1, Math.round((e.sectorPhaseM?.[k] ?? 0)))} mo left
                </div>
              )}
              <div className="mkt-card-sub mono">
                ${e.rentIdx[k].toFixed(0)}/sf · {e.capRate[k].toFixed(2)}% cap · {sfFmt(stockSf)} sf · pipeline {(pipe * 100).toFixed(1)}%
              </div>
            </button>
          );
        })}
      </div>

      {/* THE WINDOW SWITCH, and it only exists when it can do something.
          Below month 240 the whole record IS the last twenty years, and a
          control that redraws the identical chart is worse than no control —
          it teaches the player that the button does nothing. */}
      {hist.length > SPAN_M && (
        <div className="btn-row" style={{ marginTop: 10, alignItems: "baseline" }}>
          <span className="hint" style={{ marginRight: 4 }}>Every chart below shows</span>
          <button className={"btn" + (span === "20y" ? " btn-on" : "")} onClick={() => setSpan("20y")}
            title="The last twenty years — about one and a half cycles.">
            the last 20 years
          </button>
          <button className={"btn" + (span === "all" ? " btn-on" : "")} onClick={() => setSpan("all")}
            title="Every month since the game began.">
            all {Math.round((hist.length - 1) / 12)} years
          </button>
        </div>
      )}

      {/* ---- the general view: the city's six series, or one class in depth ---- */}
      {sel === "general" && <CityEconCharts tail={tail} spanYrs={spanYrs} />}
      {sel !== "general" && <>
      <div className="page-section">{SECTOR_LABEL[focus]} — {bal.state}</div>
      <div className="hint">{bal.note}</div>
      <div className="grid" style={{ marginTop: 6 }}>
        <Row k="Inventory" v={`${(stock / 1e6).toFixed(1)}M sf standing`} />
        <Row k="Vacant space" v={`${((stock * vacNow) / 1e6).toFixed(2)}M sf · ${(vacNow * 100).toFixed(1)}% against a ${(NATURAL_VAC[focus] * 100).toFixed(1)}% natural rate`} bad={bal.gap > 0.025} strong />
        <Row k="Under construction" v={`${((e.pipeline?.[focus] ?? 0) / 1e6).toFixed(2)}M sf · ${(((e.pipeline?.[focus] ?? 0) / stock) * 100).toFixed(1)}% of stock`} bad={(e.pipeline?.[focus] ?? 0) / stock > 0.05} />
        <Row k="Net absorption (12m)" v={`${(e.absorb12?.[focus] ?? 0) >= 0 ? "+" : ""}${((e.absorb12?.[focus] ?? 0) / 1e6).toFixed(2)}M sf`} bad={(e.absorb12?.[focus] ?? 0) < 0} />
        <Row k="Completions (12m)" v={`${((e.completions12?.[focus] ?? 0) / 1e6).toFixed(2)}M sf`} />
        <Row
          k="Months of supply"
          v={mos === null
            ? "— tenants are handing space back; the vacancy is still growing"
            : `${mos.toFixed(0)} months to clear the vacancy and the pipeline`}
          bad={mos === null || mos > 60}
        />
        {/* "93% off its long-run base" reads as a discount when the rent is
            nearly double it. Say which way it has gone. */}
        <Row k="Rent" v={(() => {
          const d = ((e.rentIdx[focus] / RENT_BASE[focus]) - 1) * 100;
          return `$${e.rentIdx[focus].toFixed(2)}/sf · ${Math.abs(d).toFixed(0)}% ${d >= 0 ? "above" : "below"} its long-run base`;
        })()} />
        {/* The concession dial, read out loud. Face rates are sticky by design
            (ECONOMY.md §2c) — this row is where the market tells the truth
            before asking admits it. */}
        {(() => {
          const c = e.concIdx?.[focus] ?? 0;
          const off = c * 14;
          return <Row k="Concessions"
            v={c < 0.05 ? "none to speak of — space lets at the quoted rate"
              : `deals striking ~${off.toFixed(0)}% under asking in free rent and work${c > 0.7 ? " — landlords are capitulating" : ""}`}
            bad={c > 0.7} />;
        })()}
      </div>

      <div className="chart-grid">
        <div className="chart-cell">
          <div className="chart-title">Vacancy — {spanYrs} year{spanYrs === 1 ? "" : "s"} back, three forward</div>
          {/* The projection is appended to whatever history is selected, and
              `split` is where the record stops — so it stays the length of
              vacSeries and the dotted join lands on the right month in both
              windows. The left x-label is the first point's own month rather
              than `game.month - 240`, which only agreed with the data while
              the window was exactly 240 long. */}
          <LineChart
            series={[{ label: "vacancy", color: COLOR[focus], pts: vacWithProj }]}
            bands={[{ at: NATURAL_VAC[focus] * 100, label: "natural rate" }]}
            yFmt={pctFmt}
            split={vacSeries.length}
            xLabels={[xFrom, `${2000 + Math.floor((game.month + 36) / 12)}`]}
          />
          <div className="chart-note">
            Left of the dotted line is what happened. Right of it is where vacancy goes if NOBODY starts another
            building — pipeline delivering into today's pace of absorption. Anything above the natural rate is
            space the market has to eat before rents move.
          </div>
        </div>
        <div className="chart-cell">
          <div className="chart-title">What is coming, and when</div>
          {sched.some((v) => v > 0)
            ? <BarChart groups={pipeGroups} yFmt={sfFmt} />
            : <div className="hint" style={{ padding: "26px 0" }}>Nothing is under construction. At these rents against these build costs, no {SECTOR_LABEL[focus].toLowerCase()} scheme pencils — which is how the next shortage begins.</div>}
          <div className="chart-note">
            Square feet already under construction, by the year they deliver. Nothing here can be cancelled — the
            decision to start was taken in a market that no longer exists.
          </div>
          {/* THE CRANES BEHIND THE BARS. "400k sf is coming" is a different
              fact when one tower is most of it than when twenty infills are —
              one delivery date to watch against twenty you can ignore. These
              are the largest jobs feeding the bars, named: the city's, the
              rivals', and yours. Click one and the map takes you there. */}
          {pipeJobs.length > 0 && (
            <>
              <div className="hint" style={{ marginTop: 8 }}>
                {pipeJobs.length} building{pipeJobs.length === 1 ? "" : "s"} · {sfFmt(pipeJobsSf)} sf of{" "}
                {SECTOR_LABEL[focus].toLowerCase()} due within 24 months
              </div>
              <div className="mini-list">
                {pipeJobs.slice(0, 5).map((j) => (
                  <button key={j.bbl} className="neighbor" onClick={() => flyTo(j.bbl, true)}>
                    <span className="neighbor-addr">{j.stalled ? "⚠ " : ""}{parcels[j.bbl]?.address ?? j.bbl}</span>
                    <span className="neighbor-meta mono">
                      {j.who} · {sfFmt(j.sf)} sf{j.mixed ? " of a mixed job" : ""} · {j.floors} fl ·{" "}
                      {j.stalled ? "stalled — the sponsor is gone" : `due ${monthLabel(j.deliverM)}`}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="chart-cell">
          <div className="chart-title">Absorption vs completions, per year</div>
          <BarChart groups={flowYears} yFmt={sfFmt} />
          <div className="chart-note">
            Green up is space tenants took. Orange down is space the market delivered. When orange outruns green,
            vacancy rises no matter what anybody says about demand.
          </div>
        </div>
        <div className="chart-cell">
          <div className="chart-title">Asking rent, effective rent, and cap rate</div>
          <LineChart series={[
            { label: "asking", color: COLOR[focus], pts: rentSeries },
            { label: "effective", color: "#7d8a96", pts: effSeries, dashed: true },
          ]} yFmt={(v) => `$${v.toFixed(0)}`} height={92}
            xLabels={[xFrom, xTo]} />
          <LineChart series={[{ label: "cap", color: "#8a5620", pts: capSeries, dashed: true }]} yFmt={pctFmt} height={92}
            xLabels={[xFrom, xTo]} />
          <div className="chart-note">
            Asking is the face rate landlords quote; effective is what deals actually strike after free rent and
            work — the gap between the two lines is the concessions market saying what asking will not admit.
            Cap rate below: what the market pays for the earning. None of the three move together, and the gaps
            are most of what makes or loses money here.
          </div>
        </div>
        <div className="chart-cell">
          {/* TWO CHARTS, TWO CAPTIONS.
              This cell had one title and one note covering both, and the note
              gave the bottom chart a single compressed sentence. The owner
              screenshotted the cell asking what it was — and what they had
              screenshotted was the CONCESSION GAP, the line that sits at 14%,
              collapses to nothing for twenty years and climbs back. Nothing on
              the page said what a concession gap is. Each chart now carries its
              own heading and its own note, directly above and below itself. */}
          <div className="chart-title">Demand met vs supply built</div>
          {(() => {
            // The annual bars in the cell to the left show the FLOWS; this
            // pair shows the stocks. Running totals of the same abs/comp
            // series — when the delivered line pulls away from the absorbed
            // line, the widening wedge between them is the vacancy the market
            // has to eat, and you can see which blade of the scissors cut.
            let a = 0, c = 0;
            const absCum: number[] = [], compCum: number[] = [];
            for (const h of tail) {
              a += h.abs?.[focus] ?? 0; c += h.comp?.[focus] ?? 0;
              absCum.push(a); compCum.push(c);
            }
            // The effective-vs-asking gap as ONE line, in per cent off asking.
            // The cell above charts the same pair, but the gap is the signal
            // and reading it off the distance between two lines hides its shape.
            const gap = tail.map((h) => {
              const ask = h.rent?.[focus] ?? 0;
              return ask > 0 ? Math.max(0, 1 - (h.effRent?.[focus] ?? ask) / ask) * 100 : 0;
            });
            const xl: [string, string] = [xFrom, xTo];
            return (<>
              <LineChart height={92} series={[
                { label: "absorbed", color: "#4a7d5a", pts: absCum },
                { label: "delivered", color: "#a8562e", pts: compCum, dashed: true },
              ]} yFmt={sfFmt} zeroBase xLabels={xl} />
              <div className="chart-note">
                Both lines start at zero at the left edge: every square foot tenants have taken since then
                (solid) against every square foot finished and handed over (dashed). The dashed one only
                climbs — a building, once delivered, stays delivered. The solid one can fall, and does,
                because net absorption goes negative in a downturn when tenants hand back more space than
                they take. What matters is the distance BETWEEN them. Dashed above solid means the city
                built more than it let, and that gap is standing empty space somebody has to absorb before
                rents can move. Solid above dashed is the opposite — demand arrived and nobody built for it,
                which is how a shortage, and the rent spike that follows one, is made.
              </div>
              <div className="chart-title" style={{ marginTop: 12 }}>The concession gap</div>
              <LineChart height={92} series={[{ label: "concession gap", color: "#7d8a96", pts: gap }]}
                yFmt={pctFmt} zeroBase xLabels={xl} />
              {/* WHAT THE OWNER WAS LOOKING AT. This is the line that sits flat
                  at 14, falls to nothing, and climbs back — and until now the
                  page assumed the reader already knew what a concession is. */}
              <div className="chart-note">
                A landlord advertises a face rent — the number in the brochure. What a lease actually strikes
                at is that number minus everything thrown in to get it signed: months of free rent at the
                start, and the landlord's cash for fitting the space out. This line is the difference, as a
                percentage off the advertised rent.
              </div>
              <div className="chart-note">
                At <strong>0%</strong> nobody is discounting. Space lets at the quoted rate, the tenant pays
                every month of the term, and asking rent means what it says. That is a landlord's market.
                At <strong>14%</strong> — as wide as this market goes — the brochure is fiction: a year free
                on a ten-year deal with the landlord buying the carpet, and a building whose asking rent has
                not moved is earning a seventh less than it claims. That is a tenant's market.
              </div>
              <div className="chart-note">
                It turns before asking rent does, in both directions, and that is not a quirk of the chart.
                Free rent is reversible and a cut to the face rate is not — the quoted number is what the
                building is valued and financed off, so a landlord will give away a year before touching it,
                and will claw the giveaway back long before daring to raise the quote. So this line moves
                within months of the market turning while asking sits still for half a year or more. Watch
                this one; the rent chart is the confirmation, not the signal.
              </div>
            </>);
          })()}
        </div>
      </div>

      {/* ---- submarkets ---- */}
      <div className="page-section">Submarkets — {SECTOR_LABEL[focus]} by neighbourhood</div>
      <div className="hint">
        Computed from the actual standing stock, lot by lot, with the same occupancy and rent model the engine
        prices off — so this table and your rent roll can never disagree.
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>Neighbourhood</th><th className="num">Inventory</th><th className="num">Vacancy</th>
            <th className="num">vs city</th><th className="num">Avg rent</th><th className="num">Demand</th>
            <th className="num">Vacant lots</th><th>Read</th>
          </tr>
        </thead>
        <tbody>
          {subs.map((m) => {
            const leg = m.legs[focus];
            if (leg.sf < 20000) return null;
            const v = legVacancy(leg);
            const d = v - vacNow;
            return (
              <tr key={m.district} style={{ cursor: "default" }}>
                <td>{m.district}</td>
                <td className="num">{(leg.sf / 1e6).toFixed(2)}M sf</td>
                <td className={"num" + (v > NATURAL_VAC[focus] + 0.03 ? " neg" : "")}>{(v * 100).toFixed(1)}%</td>
                <td className="num dim">{d >= 0 ? "+" : ""}{(d * 100).toFixed(1)} pts</td>
                <td className="num">${legRent(leg).toFixed(2)}</td>
                <td className="num">{legDemand(leg).toFixed(0)}</td>
                <td className="num">{m.vacantLots}</td>
                <td className="dim">
                  {v < NATURAL_VAC[focus] - 0.02 ? "tight — push rents here"
                    : v > NATURAL_VAC[focus] + 0.04 ? "soft — buy cheap, do not build"
                    : "balanced"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </>}

      <div className="page-section">How this works</div>
      <div className="hint">
        Employment decides how much space the city's tenants want; occupancy chases that target slowly, because
        firms sign leases slowly on the way up and shed space slowly on the way down. Deliveries add stock.
        Rents move on the GAP between vacancy and its natural rate, not on the calendar — so a boom ends when
        supply catches demand and not a month before. Starts respond to the spread between rents and construction
        cost, and to vacancy, because nobody breaks ground into a glut. Your own deliveries count as supply: build
        enough of one class and you will move its vacancy against yourself.
      </div>
    </div>
  );
}

/**
 * RESEARCH — what the market is doing, as opposed to what is for sale.
 *
 * These two things were one page and they are not one job. Deciding whether to
 * buy a specific building is a different activity from forming a view on where
 * office cap rates are going, which trades are hiring, what has actually
 * traded, and which of the other firms is levering into the top. Every real
 * shop separates them and so does this now: the tape lives on Marketplace,
 * and everything you would read BEFORE looking at the tape lives here.
 */

/**
 * THE MARKETPLACE — the tape, and only the tape.
 *
 * What is actually for sale, priced against what it earns and what it is
 * worth. Everything you would read to form a view BEFORE working this list —
 * where cap rates are, which trades are hiring, what has traded, who is
 * buying — is on Research, because reading the market and shopping it are two
 * different jobs and squeezing both onto one page made neither of them good.
 */
/**
 * EVERY BUILDING IN TOWN, AS A TABLE YOU CAN WORK.
 *
 * The street answers "who owns what", firm by firm; this answers "what exists"
 * — the whole standing stock, sortable on any column, filterable by class,
 * searchable by address. It is the screen a buyer's analyst actually keeps open: sort by
 * $/sf of value against demand and the mispriced corners fall out the bottom.
 * Occupancy and value here are the same models the engine prices with, so
 * this table cannot disagree with a deal card.
 */
function BuildingDatabase() {
  const parcels = useStore((s) => s.parcels)!;
  const game = useStore((s) => s.game)!;
  const focus = useStore((s) => s.focus);
  const [sortK, setSortK] = useState<string>("sf");
  const [dir, setDir] = useState<-1 | 1>(-1);
  const [cls, setCls] = useState<string>("all");
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const out: { bbl: string; addr: string; cls: string; sf: number; fl: number; yr: number;
                 owner: string; occ: number; rent: number; noi: number; dmd: number; val: number; psf: number }[] = [];
    for (const bbl in parcels) {
      const rec = resolveRec(parcels, game, bbl);
      if (!rec || rec.class === "land" || !rec.bldgArea) continue;
      const h = game.holdings[bbl];
      const own = h ? "You" : (ownerOf(game, bbl)?.name ?? "private");
      // Your own buildings price on the condition you have actually let them
      // drift to; everyone else's on the street's grade, as before.
      const cond = h?.condition ?? gradeOf(game, rec);
      const val = assetValue(rec, game.econ, cond);
      // In-place rent where a roll exists — your own commercial leases,
      // weighted by the square feet each one covers — and the market's
      // estimate for the rest of town, which is the same model the engine
      // signs leases at. A mixed-use roll reads its commercial paper only;
      // the flats have no individual leases to read.
      const rollSf = h ? h.tenants.reduce((a, t) => a + t.sf, 0) : 0;
      const rent = h && rollSf > 0
        ? h.tenants.reduce((a, t) => a + t.rentPsf * t.sf, 0) / rollSf
        : marketRentPsfYr(rec, game.econ, cond);
      // NOI from the actual roll on owned buildings; for everyone else's the
      // market model, net of the tax bill a buyer would carry at this value —
      // the same number the tape and the deal card quote.
      const noi = h ? holdingNOIYr(rec, game.econ, h, game.month) : noiAfterTaxYr(rec, game.econ, cond, val);
      out.push({
        bbl, addr: rec.address, cls: rec.class, sf: rec.bldgArea, fl: rec.floors,
        yr: rec.yearBuilt, owner: own,
        occ: h ? physicalOcc(rec as never, h) : occupancy(rec, game.econ),
        rent, noi,
        dmd: Math.round(rec.demandScore + (game.blockD?.[rec.block] ?? 0)),
        val, psf: val / Math.max(1, rec.bldgArea),
      });
    }
    return out;
  }, [parcels, game]);
  const shown = useMemo(() => {
    let r = rows;
    if (cls !== "all") r = r.filter((x: (typeof rows)[number]) => x.cls === cls);
    if (q.trim()) { const t = q.trim().toLowerCase(); r = r.filter((x: (typeof rows)[number]) => x.addr.toLowerCase().includes(t) || x.owner.toLowerCase().includes(t)); }
    const k = sortK as keyof (typeof rows)[number];
    return [...r].sort((a, b) => {
      const av = a[k], bv = b[k];
      return (typeof av === "string" ? (av as string).localeCompare(bv as string) : (av as number) - (bv as number)) * dir;
    });
  }, [rows, sortK, dir, cls, q]);
  const H = ({ k, label, num }: { k: string; label: string; num?: boolean }) => (
    <th className={num ? "num" : undefined} style={{ cursor: "pointer", whiteSpace: "nowrap" }}
        onClick={() => { if (sortK === k) setDir((d) => (d === 1 ? -1 : 1)); else { setSortK(k); setDir(-1); } }}>
      {label}{sortK === k ? (dir === -1 ? " ▾" : " ▴") : ""}
    </th>
  );
  const CAP = 250;
  return (
    <div>
      <div className="btn-row" style={{ marginBottom: 6 }}>
        {["all", "office", "retail", "multifamily", "industrial"].map((c) => (
          <button key={c} className={"btn" + (cls === c ? " btn-on" : "")} onClick={() => setCls(c)}>
            {c === "all" ? `All · ${rows.length}` : c}
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="address or owner…"
          style={{ flex: 1, minWidth: 120, background: "transparent", border: "1px solid rgba(120,100,70,0.35)",
                   borderRadius: 4, padding: "4px 8px", font: "inherit", color: "inherit" }}
        />
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <H k="addr" label="Address" />
            <H k="cls" label="Class" />
            <H k="sf" label="SF" num />
            <H k="fl" label="Fl" num />
            <H k="yr" label="Built" num />
            <H k="occ" label="Occ" num />
            <H k="rent" label="Rent $/sf" num />
            <H k="noi" label="NOI / yr" num />
            <H k="dmd" label="Demand" num />
            <H k="val" label="Value" num />
            <H k="psf" label="$/sf" num />
            <H k="owner" label="Owner" />
          </tr>
        </thead>
        <tbody>
          {shown.slice(0, CAP).map((r: (typeof rows)[number]) => (
            <tr key={r.bbl} onClick={() => focus(r.bbl, true)} style={{ cursor: "pointer" }}>
              <td>{r.addr}</td>
              <td className="dim">{r.cls}</td>
              <td className="num">{Math.round(r.sf).toLocaleString()}</td>
              <td className="num">{r.fl}</td>
              <td className="num">{r.yr || "—"}</td>
              <td className="num">{(r.occ * 100).toFixed(0)}%</td>
              <td className="num">${r.rent.toFixed(0)}</td>
              <td className={"num" + (r.noi < 0 ? " neg" : "")}>{usd(r.noi)}</td>
              <td className="num">{r.dmd}</td>
              <td className="num">{usd(r.val)}</td>
              <td className="num">${r.psf.toFixed(0)}</td>
              <td className={r.owner === "You" ? undefined : "dim"}>{r.owner}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {shown.length > CAP && (
        <div className="hint">Showing {CAP} of {shown.length.toLocaleString()} — narrow it with the class buttons or the search box.</div>
      )}
    </div>
  );
}

function MarketPage() {
  const parcels = useStore((s) => s.parcels)!;
  const game = useStore((s) => s.game)!;
  const focus = useStore((s) => s.focus);
  const go = (bbl: string) => focus(bbl, true);
  // YOUR OWN SIGN IN THE WINDOW. A building you have listed is for sale in the
  // same town, on the same tape, and leaving it off meant the one screen that
  // answers "what is on the market" was answering it incompletely — and you
  // could not see your own ask sitting next to the competition's.
  const mine = Object.values(game.holdings)
    .filter((h) => h.sale)
    .map((h) => ({ bbl: h.bbl, ask: h.sale!.ask, mine: true as const, distress: false, sale: h.sale! }));
  const live = game.listings.length + mine.length;
  const distress = game.listings.filter((l) => l.distress).length;
  const frames = game.listings.filter((l) => l.halfBuilt).length;
  return (
    <div>
      <div className="stat-strip">
        <Big label="On the market" value={String(live)} />
        <Big label="Motivated sellers" value={String(distress)} bad={distress > 0} />
        <Big label="Half-built frames" value={String(frames)} />
        <Big label="Money in the room" value={
          marketAppetite(game) < 0.6 ? "gone" : marketAppetite(game) < 0.9 ? "thin"
            : marketAppetite(game) > 1.15 ? "everywhere" : "normal"} />
        <button
          className={"btn" + (game.brokersOff ? "" : " btn-on")}
          style={{ alignSelf: "center" }}
          title={game.brokersOff
            ? "Brokers are not calling you. Click to let them ring again."
            : "Brokers ring you with off-market deals now and then. Click to stop the calls entirely."}
          onClick={() => {
            const st = useStore.getState();
            useStore.setState({ game: { ...st.game!, brokersOff: !st.game!.brokersOff } });
          }}
        >
          {game.brokersOff ? "Brokers: off" : "Brokers: on"}
        </button>
        <button
          className={"btn" + (game.auctionQuiet ? "" : " btn-on")}
          style={{ alignSelf: "center" }}
          title={game.auctionQuiet
            ? "The July docket runs without interrupting you. Click to have the card come up again."
            : "The July docket comes up as a card when it is published. Click to read it here instead."}
          onClick={() => {
            const st = useStore.getState();
            useStore.setState({ game: { ...st.game!, auctionQuiet: !st.game!.auctionQuiet } });
          }}
        >
          {game.auctionQuiet ? "Auction card: off" : "Auction card: on"}
        </button>
      </div>
      <div className="hint">
        Everything for sale in town. A motivated seller is priced under appraisal and will not last; a half-built
        frame comes with somebody else's job attached, and you finish it. What the market is DOING — cap rates,
        the trades, comparable sales, who has been buying — is on Research.
      </div>
      {/* THE DOCKET, WHEREVER THE CARD SETTING STANDS. Foreclosure lots are the
          one thing on the tape nobody chose to sell, and they are gone in a
          month — so they live at the TOP of the page while they are live, and
          the button opens the same bidding sheet the card shows. */}
      {game.auction && game.month < game.auction.m && (
        <div className="deal" style={{ marginBottom: 10 }}>
          <div className="deal-head">
            The county foreclosure docket · {game.auction.lots.length} lot{game.auction.lots.length === 1 ? "" : "s"} · the hammer falls {monthLabel(game.auction.m)}
          </div>
          <div className="hint">
            As-is, ten per cent down the day you register, no financing and no warranty. Nobody on this list
            chose to sell.
          </div>
          <button className="btn btn-buy" onClick={() => useStore.getState().setAuctionOpen(true)}>
            Open the docket
          </button>
        </div>
      )}
      <div className="deals-grid">
        <section style={{ gridColumn: "1 / -1" }}>
          <div className="page-section">On the market · {live}{mine.length ? ` · ${mine.length} of them yours` : ""}</div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Property</th><th>Class</th><th className="num">Building</th><th className="num">Ask</th>
                <th className="num">$/sf</th><th className="num">NOI / yr</th><th className="num">Cap rate</th>
                <th className="num">Occupancy</th><th className="num">vs appraisal</th>
              </tr>
            </thead>
            <tbody>
              {/* Sorted the way a buyer reads a tape: income first, best going-in
                  yield at the top, then the dirt by price per foot. Sorting the
                  whole thing by asking price buried every building that made
                  money under fourteen rows of vacant lots. */}
              {[...game.listings, ...mine].map((li) => {
                const rec = resolveRec(parcels, game, li.bbl);
                const built = !!rec && rec.class !== "land" && rec.bldgArea > 0;
                const cap = built && li.ask > 0
                  ? noiAfterTaxYr(rec!, game.econ, initialCondition(rec!), li.ask) / li.ask : -1;
                const psf = rec ? li.ask / Math.max(1, built ? rec.bldgArea : rec.lotArea) : Infinity;
                return { li, built, cap, psf };
              }).sort((a, b) => (a.built === b.built
                ? (a.built ? b.cap - a.cap : a.psf - b.psf)
                : (a.built ? -1 : 1))).map(({ li }) => {
                const rec = resolveRec(parcels, game, li.bbl);
                if (!rec) return null;
                const cond = initialCondition(rec);
                const built = rec.class !== "land" && rec.bldgArea > 0;
                const noi = built ? noiAfterTaxYr(rec, game.econ, cond, li.ask) : 0;
                const goingIn = built && li.ask > 0 ? (noi / li.ask) * 100 : 0;
                const yours = "mine" in li;
                const h = yours ? game.holdings[li.bbl] : null;
                return (
                  <tr key={li.bbl} onClick={() => go(li.bbl)} className={yours ? "row-mine" : undefined}>
                    <td>
                      {li.distress && <span className="chip chip-distress" style={{ marginRight: 6 }}>HOT</span>}
                      {yours && <span className="chip" style={{ marginRight: 6 }}>YOURS</span>}
                      {rec.address}
                      {yours && h?.sale?.offer && (
                        <span className="dim mono"> · {usd(h.sale.offer.price)} offered</span>
                      )}
                      {yours && h?.sale && !h.sale.offer && <span className="dim"> · no offers yet</span>}
                    </td>
                    <td>{useLabel(rec)}</td>
                    <td className="num">{built ? sf(rec.bldgArea) : sf(rec.lotArea) + " lot"}</td>
                    <td className="num">{usd(li.ask)}</td>
                    <td className="num">{built ? "$" + Math.round(li.ask / Math.max(1, rec.bldgArea)) : "$" + Math.round(li.ask / Math.max(1, rec.lotArea))}</td>
                    <td className="num">{built ? usd(noi) : "—"}</td>
                    <td className="num">{built ? goingIn.toFixed(2) + "%" : "—"}</td>
                    {/* NOT THE BUILDING'S OCCUPANCY — THE CITY'S.
                        occupancy(rec, econ) is the citywide model for this class,
                        so every office on the tape read 83-99% let on the same
                        afternoon the Economy page said office vacancy was 19.2%.
                        And it sat in a column that LOOKS exactly like the
                        Portfolio's Occ, which is the real thing. A number that
                        cannot be true, styled as though it were measured, is
                        worse than no number.
                        You have not seen inside a building you do not own. What
                        the tape can honestly tell you is what the class is
                        running at, and it says so. */}
                    <td className="num dim" title="The class average — you have not seen this building's rent roll. Buy it and you will.">
                      {built ? "~" + (occupancy(rec, game.econ) * 100).toFixed(0) + "%" : "—"}
                    </td>
                    {(() => {
                      // A seller under no pressure holds last year's number. The gap
                      // between an ask and an honest appraisal is the whole read on
                      // whether a tape is worth working.
                      const v = assetValue(rec, game.econ, cond);
                      const d = v > 0 ? li.ask / v - 1 : 0;
                      return <td className={"num" + (d > 0.08 ? " neg" : "")}>{(d * 100).toFixed(0)}%</td>;
                    })()}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

/**
 * WHAT THE DIRT HAS DONE, and what the city underneath it has done.
 *
 * Land is the only asset in this game you can hold without operating, and it
 * was the one thing with no chart: the index moved every month, it drove every
 * appraisal and every development pro forma, and the only way to read it was
 * to click a lot and squint at a number. A land cycle is slower and larger
 * than a rent cycle — it is the one that makes and unmakes fortunes — and it
 * deserves the same graph the sectors get.
 *
 * Beneath it, the economy the property market sits on. Rents are downstream of
 * jobs and jobs are downstream of whether anybody wants to live here, and none
 * of that was visible either.
 */
function LandValueChart() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const h = game.econ.history ?? [];
  if (h.length < 4) return <div className="hint">Not enough history yet — advance a few years.</div>;
  const e = game.econ;

  // Today's land price per foot across the city, and at the best ground in it —
  // the spread between them is what "location" is worth in dollars.
  const psf = Object.keys(parcels).map((b) => {
    const rec = resolveRec(parcels, game, b);
    return rec && rec.lotArea > 0 ? { psf: landPsfNow(rec, e), d: rec.demandScore } : null;
  }).filter(Boolean) as { psf: number; d: number }[];
  psf.sort((a, b) => a.psf - b.psf);
  const q = (f: number) => psf.length ? psf[Math.min(psf.length - 1, Math.floor(psf.length * f))].psf : 0;
  const prime = psf.filter((x) => x.d >= 80);
  const primeAvg = prime.length ? prime.reduce((a, x) => a + x.psf, 0) / prime.length : 0;
  const fringe = psf.filter((x) => x.d <= 25);
  const fringeAvg = fringe.length ? fringe.reduce((a, x) => a + x.psf, 0) / fringe.length : 0;

  const yrs = (n: number) => h.length > n ? h[h.length - 1].landIdx / h[h.length - 1 - n].landIdx - 1 : 0;

  return (
    <>
      <div className="page-section">Land</div>
      <div className="hint">
        The only thing here you can own without operating it, and the slowest, largest cycle in the game.
        Every appraisal and every development budget is a function of this line.
      </div>
      <LineChart
        height={150}
        series={[{ label: "Land index", color: "#b08d3f", pts: h.map((p) => p.landIdx) }]}
        yFmt={(v) => v.toFixed(2)}
        xLabels={[monthLabel(h[0].q), monthLabel(h[h.length - 1].q)]}
      />
      <div className="grid">
        <Row k="Land index" v={e.landIdx.toFixed(2)} strong />
        <Row k="Over the last year" v={`${yrs(12) >= 0 ? "+" : ""}${(yrs(12) * 100).toFixed(1)}%`} bad={yrs(12) < 0} />
        <Row k="Over the last five" v={`${yrs(60) >= 0 ? "+" : ""}${(yrs(60) * 100).toFixed(1)}%`} bad={yrs(60) < 0} />
        <Row k="Over the last twenty" v={`${yrs(240) >= 0 ? "+" : ""}${(yrs(240) * 100).toFixed(1)}%`} bad={yrs(240) < 0} />
        <Row k="Cheapest quarter of the city" v={`$${q(0.25).toFixed(0)} /sf of lot`} />
        <Row k="Median lot" v={`$${q(0.5).toFixed(0)} /sf of lot`} strong />
        <Row k="Dearest tenth" v={`$${q(0.9).toFixed(0)} /sf of lot`} />
        <Row
          k="Prime against fringe"
          v={fringeAvg > 0 ? `${(primeAvg / fringeAvg).toFixed(1)}x — $${primeAvg.toFixed(0)} against $${fringeAvg.toFixed(0)}` : "—"}
        />
      </div>

      <div className="page-section" style={{ marginTop: 14 }}>The city</div>
      <div className="hint">
        Rents are downstream of jobs, and jobs are downstream of whether anybody wants to be here.
        Unemployment lags the property cycle by a year or more — by the time it reads badly the rents
        already have.
      </div>
      <LineChart
        height={140}
        series={[
          { label: "Jobs (000s)", color: "#2f6f7a", pts: h.map((p) => (p.jobs ?? 0) / 1000) },
          { label: "Population (000s)", color: "#7a5c1e", pts: h.map((p) => (p.population ?? 0) / 1000) },
        ]}
        yFmt={(v) => v.toFixed(0) + "k"}
        xLabels={[monthLabel(h[0].q), monthLabel(h[h.length - 1].q)]}
      />
      <LineChart
        height={130}
        series={[
          { label: "Unemployment %", color: "#a8402e", pts: h.map((p) => (p.unemployment ?? 0) * 100) },
          { label: "Real wage (index x10)", color: "#3a7d46", pts: h.map((p) => real(p.wageIdx, p.cpi) * 10) },
        ]}
        yFmt={(v) => v.toFixed(1)}
        xLabels={[monthLabel(h[0].q), monthLabel(h[h.length - 1].q)]}
      />
      <div className="grid">
        <Row k="Population" v={(e.population ?? 0).toLocaleString()} strong />
        <Row k="Jobs" v={(e.jobs ?? 0).toLocaleString()} />
        <Row k="Unemployment" v={`${((e.unemployment ?? 0) * 100).toFixed(1)}%`} bad={(e.unemployment ?? 0) > 0.085} />
        <Row k="Real wage" v={`${((real(e.wageIdx, e.cpi) - 1) * 100).toFixed(0)}% against the year 2000`} />
        <Row k="Nominal wage" v={`${(((e.wageIdx ?? 1) - 1) * 100).toFixed(0)}% against the year 2000`} />
        <Row k="Real output" v={`${((real(e.outputIdx, e.cpi) - 1) * 100).toFixed(0)}% against the year 2000`} />
        <Row k="Price level" v={`${(((e.cpi ?? 1) - 1) * 100).toFixed(0)}% of cumulative inflation`} />
        {(() => {
          const n = h.length;
          const jobsYr = n > 12 && h[n - 13].jobs ? (h[n - 1].jobs! / h[n - 13].jobs! - 1) * 100 : 0;
          return <Row k="Jobs added this year" v={`${jobsYr >= 0 ? "+" : ""}${jobsYr.toFixed(1)}%`} bad={jobsYr < 0} strong />;
        })()}
      </div>
    </>
  );
}

// (The collapsible Fold component lived here. Research moved to sub-tabs —
// one section on screen at a time instead of a scroll of drawers — and no
// other page used it.)
function ResearchPage() {
  const parcels = useStore((s) => s.parcels)!;
  const game = useStore((s) => s.game)!;
  const e = game.econ;
  void parcels;
  // SUB-TABS, NOT A SCROLL. Research had eight collapsible sections stacked in
  // one column, and finding the banks meant scrolling past everything above
  // them. Each section is a tab now; one is on screen at a time.
  // The register came out of this list because The street already answers who
  // owns what — firm by firm, every deed, inside the firm's own balance sheet
  // — and two lists of the same deeds is one list the player has to choose
  // between. "Stock" became "Properties" because the word meant the standing
  // building stock and reads as equities; the `stock` key is left alone
  // because nothing persists it and renaming it would only give one tab two
  // names in one file.
  const [rtab, setRtab] = useState<string>("sectors");
  const RTABS: [string, string][] = [["sectors", "Sectors"], ["trades", "Trades"], ["banks", "Banks"],
    ["land", "Land"], ["street", "The street"], ["stock", "Properties"], ["comps", "Prints"]];
  return (
    <div>
      <div className="stat-strip">
        <Big label="Base rate" value={pct(e.indexRate)}
          title="Every loan in town prices off this benchmark: floating coupons reprice to it monthly, and new quotes are struck at this rate plus the lender's spread." />
        <Big label="Phase" value={e.phase + (e.rumoredPhase ? " ⚠" : "")} />
        <Big label="Cap · office" value={pct(e.capRate.office)} />
        <Big label="Cap · multifam" value={pct(e.capRate.multifamily)} />
        <Big label="Office rent" value={"$" + e.rentIdx.office.toFixed(0)} />
        <Big label="Land index" value={e.landIdx.toFixed(2)} />
        <Big label="Cost index" value={e.costIdx.toFixed(2)} />
        <Big label="Credit" value={creditWord(e.creditIdx ?? 1)} bad={(e.creditIdx ?? 1) < 0.72} />
        <Big label="Employment" value={((e.employIdx ?? 1) * 100).toFixed(0)} />
        <Big
          label="Value vs replacement"
          value={`${cityValueToReplacement(game).toFixed(2)}×`}
          bad={cityValueToReplacement(game) < 0.95}
        />
      </div>
      {/* THE HINGE OF THE WHOLE DEVELOPMENT CYCLE, and it was nowhere. */}
      {(() => {
        const x = cityValueToReplacement(game);
        return (
          <div className="hint" style={{ marginTop: 6 }}>
            Finished buildings trade at <strong>{x.toFixed(2)}×</strong> what it costs to put them up.{" "}
            {x > 1.15
              ? "Above replacement cost, and comfortably — every developer in this city can see it, which is exactly how the next glut gets started. Build now and you will be delivering into their supply."
              : x > 1.0
                ? "Just above replacement cost. Building pencils, barely, and it does not pencil for anyone careless."
                : x > 0.85
                  ? "Below replacement cost. Nobody is starting anything, and the pipeline is emptying out — which is what eventually fixes a soft market. Buying is cheaper than building."
                  : "Far below replacement cost. Construction has stopped. Every building in this town is worth less than the bricks in it, and that is the best moment there is to be a buyer rather than a builder."}
          </div>
        );
      })()}

      <div className="btn-row" style={{ margin: "10px 0 6px", flexWrap: "wrap" }}>
        {RTABS.map(([id, label]) => (
          <button key={id} className={"btn" + (rtab === id ? " btn-on" : "")} onClick={() => setRtab(id)}>{label}</button>
        ))}
      </div>
      <div className="deals-grid">
        <div style={{ gridColumn: "1 / -1" }}>
        {rtab === "sectors" && (<div>
          <div className="hint">
            Classes do not move together. Momentum is where the sector is heading; demand is what the
            city's tenants actually did with their feet over the last twelve months, net of everything they
            handed back; the pipeline is what everyone <em>else</em> is building, and it lands on the rent
            about three years from now. A sector taking space in while nothing is under construction is
            where rent gets made — and a sector giving space back while the cranes are still up is the
            other half of that sentence.
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Sector</th><th className="num">Rent $/sf</th><th className="num">Cap rate</th>
                <th className="num">Momentum</th><th className="num">Demand · 12m</th><th className="num">Under construction</th>
                <th className="num">Delivering</th><th>Read</th>
              </tr>
            </thead>
            <tbody>
              {(["office", "retail", "multifamily", "industrial"] as const).map((k) => {
                const mom = e.sectorMom?.[k] ?? 0;
                const pipe = e.pipeline?.[k] ?? 0;
                const press = e.supplyPress?.[k] ?? 0;
                // WHAT THE TENANTS DID, as against what the market feels like.
                // Momentum is sentiment and it prices; this is the net
                // absorption the space market actually recorded over the last
                // twelve months — feet taken up less feet handed back — carried
                // against the standing stock, so a shed market and an office
                // market can be read on one scale. Measured across 2,400 months
                // of four seeds it runs from about −3% to +4% of stock with a
                // median near +0.5%, and it is negative 36% of the time, which
                // is the honest shape of a demand series: it spends real
                // stretches going backwards while the rent index is still
                // drifting up, and that gap is the trade.
                const abs12 = e.absorb12?.[k] ?? 0;
                const stk = e.stock?.[k] ?? 0;
                const dmd = stk > 0 ? abs12 / stk : 0;
                const dmdPct = +(dmd * 100).toFixed(1);
                const read = mom > 0.004 && press < 0.00035 ? "landlord's market"
                  : mom < -0.004 ? "tenants have the whip"
                  : press > 0.0006 ? "oversupplied — new stock coming"
                  : "balanced";
                return (
                  <tr key={k}>
                    <td>{CLASS_LABEL[k]}</td>
                    <td className="num">${e.rentIdx[k].toFixed(0)}</td>
                    <td className="num">{pct(e.capRate[k])}</td>
                    <td className={"num" + (mom < -0.002 ? " neg" : "")}>{(mom * 100).toFixed(2)}</td>
                    <td className={"num" + (dmd < -0.002 ? " neg" : "")}
                      title={abs12 >= 0
                        ? `${sf(Math.round(abs12))} taken up net over the last twelve months, against ${sf(Math.round(stk))} standing`
                        : `${sf(Math.round(-abs12))} handed back net over the last twelve months, against ${sf(Math.round(stk))} standing`}>
                      {(dmdPct > 0 ? "+" : "") + dmdPct.toFixed(1)}%
                    </td>
                    <td className="num">{sf(Math.round(pipe))}</td>
                    <td className="num">{sf(Math.round(pipe / 30))}</td>
                    <td className="dim">{read}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>)}
        {/* THE TRADES. A separate cycle from the four asset classes above and
            the reason two identical office buildings are different assets: one
            let to insurers, one let to startups. */}
        {rtab === "trades" && (<div>
          <div className="hint">
            Industries run their own cycles, on their own volatility, independent of the property market that houses
            them. Office can be a landlord's market while finance is shedding staff — and the building let to five
            startups empties while the one across the street let to insurers does not.
          </div>
          <table className="tbl">
            <thead>
              <tr><th>Trade</th><th>Cycle</th><th className="num">Momentum</th><th className="num">Your exposure</th><th>Read</th></tr>
            </thead>
            <tbody>
              {(() => {
                const mine = portfolioIndustries(game);
                const byMe = new Map(mine.rows.map((r) => [r.sector, r.share]));
                return SECTORS.map((k) => {
                  const mom = game.econ.industryMom?.[k] ?? 0;
                  const ph = game.econ.industryPhase?.[k] ?? "steady";
                  const mySh = byMe.get(k) ?? 0;
                  return (
                    <tr key={k}>
                      <td>{INDUSTRY_LABEL[k]}</td>
                      <td className={ph === "bust" ? "neg" : "dim"}>
                        {ph === "boom" ? "hiring hard" : ph === "bust" ? "contracting" : "steady"}
                      </td>
                      <td className={"num" + (mom < -0.004 ? " neg" : "")}>{(mom * 100).toFixed(2)}</td>
                      <td className={"num" + (mySh > 0.4 ? " neg" : "")}>{mySh > 0 ? `${(mySh * 100).toFixed(0)}%` : "—"}</td>
                      <td className="dim">
                        {ph === "bust" && mySh > 0.25 ? "You are heavily exposed to a trade that is contracting."
                          : ph === "bust" ? "Anyone let to them is about to have a bad two years."
                          : ph === "boom" ? "They are expanding and they will pay to stay."
                          : "Nothing happening either way."}
                      </td>
                    </tr>
                  );
                });
              })()}
            </tbody>
          </table>
        </div>)}
        {rtab === "banks" && (<div>
          <TheBanks />
        </div>)}
        {rtab === "land" && (<div>
          <LandValueChart />
        </div>)}
        {rtab === "street" && (<div>
          <TheStreet />
        </div>)}
        {rtab === "stock" && (<div>
          <BuildingDatabase />
        </div>)}
        {/* THE PRINTS GO LAST. They are the reference you scroll to, not the
            thing you open the page for — sectors and land first, the record of
            what has actually traded underneath it. */}
        {rtab === "comps" && (<div>
          <CompsSheet />
        </div>)}
        </div>
      </div>
    </div>
  );
}

/**
 * THE BANKS — a balance sheet for every desk that quotes you.
 *
 * "Credit: tight" was a word derived from an index, and an index is weather:
 * it happens to you, you cannot see inside it, and there is nothing to do
 * about it but wait. The five lenders now carry real books — capital, loans
 * outstanding, what has stopped paying — and the appetite column below is
 * literally the multiplier applied to your next advance rate. A regional
 * whose delinquency has doubled and whose capital ratio is drifting toward its
 * floor will be rationing next quarter and shut the one after. That is a
 * decision you can act on a year early: refinance out of them while they will
 * still write it, or be the last borrower they say no to.
 */
/**
 * THE FULL STATEMENT — every loan this desk holds against a deed in town.
 *
 * The old book showed only YOUR paper, which answered "which of my balloons
 * is stranded at an impaired desk" and nothing else. The mortgage record in
 * engine/ledger.ts now carries the street's loans too, so a statement can
 * print what a statement prints: every loan against the property it is
 * written on — borrower, balance, coupon, maturity, LTV the day it was
 * written against LTV today, and whether it is paying. Your rows sit on top,
 * because the first question is still your own.
 */
type StatementRow = {
  bbl: string; borrower: string; yours: boolean; dev: boolean;
  klass: string; district: string;
  balance: number; rate: number; matM: number;
  origLtv: number | null; curLtv: number | null;
  status: string; bad: boolean;
};

function bankStatement(game: GameState, parcels: ParcelTable, lenderName: string): StatementRow[] {
  const rows: StatementRow[] = [];
  for (const h of Object.values(game.holdings)) {
    if (!h.loan) continue;
    const holder = h.loan.holder ?? PRODUCTS.find((p) => p.id === h.loan!.product)?.lender;
    if (holder !== lenderName) continue;
    const rec = resolveRec(parcels, game, h.bbl);
    if (!rec) continue;
    const v = holdingValue(rec, game.econ, h, game.month);
    const w = game.workouts?.[h.bbl];
    rows.push({
      bbl: h.bbl, borrower: firmShort(game), yours: true, dev: false,
      klass: rec.class, district: rec.district ?? "—",
      balance: h.loan.balance, rate: h.loan.ratePct, matM: h.loan.maturityM,
      origLtv: h.loan.origValue ? h.loan.principal / h.loan.origValue : null,
      curLtv: v > 0 ? h.loan.balance / v : null,
      status: w ? "workout" : h.loan.sweep ? "swept" : game.month >= h.loan.maturityM ? "due" : "current",
      bad: !!w || !!h.loan.sweep,
    });
  }
  for (const x of Object.values(game.cityLoans ?? {})) {
    if (x.lender !== lenderName) continue;
    const rec = resolveRec(parcels, game, x.bbl);
    if (!rec) continue;
    const r = game.rivals?.find((z) => z.id === x.obligorId);
    const v = r ? assetValue(rec, game.econ, assetGrade(r, rec)) : 0;
    rows.push({
      bbl: x.bbl, borrower: r?.name ?? "—", yours: false, dev: false,
      klass: x.klass, district: rec.district ?? "—",
      balance: x.balance, rate: x.ratePct, matM: x.maturityM,
      origLtv: x.origValue > 0 ? x.balance / x.origValue : null,
      curLtv: v > 0 ? x.balance / v : null,
      status: x.status, bad: x.status !== "current",
    });
  }
  {
    // Construction paper sits with whichever desk the developer picked at
    // groundbreak; older jobs and takeovers fall back to the regional.
    for (const d of Object.values(game.developments ?? {})) {
      if ((d.lender ?? CONSTRUCTION_LENDER) !== lenderName || d.loanBalance <= 0) continue;
      const rec = resolveRec(parcels, game, d.bbl);
      rows.push({
        bbl: d.bbl, borrower: firmShort(game), yours: true, dev: true,
        klass: "construction", district: rec?.district ?? "—",
        balance: d.loanBalance, rate: d.ratePct ?? 0, matM: d.deliverM ?? game.month,
        origLtv: d.costTotal > 0 ? d.commitment / d.costTotal : null, curLtv: null,
        status: "construction", bad: false,
      });
    }
  }
  return rows.sort((a, b) => (a.yours !== b.yours ? (a.yours ? -1 : 1) : b.balance - a.balance));
}

/** Fifty years of capital ratio against the target, four numbers wide. */
function CapSpark({ hist, target }: { hist?: number[]; target: number }) {
  if (!hist || hist.length < 2) return null;
  const w = 180, hgt = 34;
  const n = hist.length;
  const max = Math.max(target * 1.8, ...hist);
  const pts = hist.map((v, i) => `${((i / (n - 1)) * w).toFixed(1)},${(hgt - Math.min(1, v / max) * hgt).toFixed(1)}`).join(" ");
  const ty = hgt - Math.min(1, target / max) * hgt;
  return (
    <svg width={w} height={hgt} style={{ verticalAlign: "middle", overflow: "visible" }}>
      <line x1={0} y1={ty} x2={w} y2={ty} stroke="rgba(190,130,60,0.55)" strokeDasharray="3 2" />
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={1.2} opacity={0.85} />
    </svg>
  );
}

/**
 * THE NOTE DESK.
 *
 * Everything that decides the price is on this screen: whose loan it is, how
 * levered they are, how much cash they have against the face, how long they
 * have been in trouble, and which desk is selling and why. The player is not
 * being asked to trust a percentage — they are being asked to disagree with
 * one, which is the only way a price can be a decision.
 */
function NotesPage() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const focus = useStore((s) => s.focus);
  const { takeNote, restructureNote, fileNote, offloadNote } = useStore.getState();
  const offers = game.noteOffers ?? [];
  const notes = game.notes ?? [];

  return (
    <div>
      <div className="hint">
        A note is a claim on somebody else's rent, secured by a building you do not own and cannot manage. What
        you are underwriting is not the collateral — it is whether the borrower can make you go away. A performing
        loan on a solvent firm is a bond. A defaulted loan on a half-empty block is a building you have bid on
        privately, in an auction with one bidder, at a price the owner never agreed to. Nothing here is serviced
        by hand: the coupon arrives on its own, every month, and a note asks you for something exactly twice.
      </div>

      <div className="page-section">On the block</div>
      {offers.length === 0 && (
        <div className="hint">
          Nobody is selling paper this month. Desks sell loans when they have stopped paying or when the desk needs
          the capital more than the asset — watch the capital ratios on Research and you will see it coming.
        </div>
      )}
      {offers.map((o) => {
        const r = game.rivals?.find((x) => x.id === o.obligorId);
        const px = Math.round(o.face * o.askPct);
        const rec = resolveRec(parcels, game, o.bbl);
        const ltv = r && (r.aum ?? 0) > 0 ? r.debt / r.aum! : 0;
        return (
          <div key={o.id} className="hint" style={{ marginBottom: 10 }}>
            <div style={{ cursor: "pointer" }} onClick={() => focus(o.bbl, true)}>
              <strong>{o.address}</strong> · {o.perf === "nonperforming"
                ? <span className="neg">not paying</span> : "current"} · {usd(o.face)} of face at{" "}
              <b className="mono">{(100 * o.askPct).toFixed(0)} cents</b> = <b className="mono">{usd(px)}</b>
            </div>
            <div className="dim" style={{ marginTop: 4 }}>{o.why}</div>
            <div style={{ marginTop: 4 }}>
              The borrower is <strong>{o.obligor}</strong>
              {r && <> — {(100 * ltv).toFixed(0)}% levered, {usd(Math.max(0, r.cash))} of cash against {usd(o.face)} owed here
                {(r.stressMs ?? 0) > 0 && <span className="neg">, and {r.stressMs} months into a squeeze</span>}
                {r.occ !== undefined && <>, running their book at {(r.occ * 100).toFixed(0)}% let</>}.</>}
            </div>
            <div style={{ marginTop: 4 }} className={o.cure > 0.4 ? "" : "dim"}>
              The desk puts about <b className="mono">{(100 * o.cure).toFixed(0)}%</b> odds on being repaid.{" "}
              {o.cure > 0.45
                ? "That is a bond with a discount on it — you are underwriting the borrower, not the bricks."
                : o.cure < 0.15
                  ? "They do not expect to see this money. You are buying the building, and the only question is what it is worth when you get it."
                  : "Neither one thing nor the other, which is why it is cheap."}
            </div>
            {rec && (
              <div className="dim" style={{ marginTop: 4 }}>
                Clean, the building appraises at {usd(assetValue(rec, game.econ, "standard"))}. Off a receiver, worn
                and at their occupancy, it marks nearer {usd(collateralAsIs(rec, game.econ, r?.occ ?? 0.5))} — and
                a foreclosure takes nine to seventeen months during which you collect nothing.
              </div>
            )}
            <div className="btn-row" style={{ marginTop: 6 }}>
              <button className="btn" disabled={game.cash < px} onClick={() => takeNote(o.id)}>
                Buy the paper · {usd(px)}
              </button>
              <span className="dim">Offer lapses {monthLabel(o.expiresM)}. Somebody else is looking at it.</span>
            </div>
          </div>
        );
      })}

      <div className="page-section">Your book</div>
      {notes.length === 0 && <div className="hint">You hold no paper.</div>}
      {notes.length > 0 && (
        <table className="tbl">
          <thead>
            <tr>
              <th>Collateral</th><th>Borrower</th><th className="num">Face</th><th className="num">Basis</th>
              <th className="num">Coupon</th><th className="num">Collected</th><th>Standing</th><th></th>
            </tr>
          </thead>
          <tbody>
            {notes.map((n) => {
              const bid = noteBid(game, parcels, n);
              return (
                <tr key={n.id}>
                  <td style={{ cursor: "pointer" }} onClick={() => focus(n.bbl, true)}>{n.address}</td>
                  <td>{n.obligor}</td>
                  <td className="num">{usd(n.face)}</td>
                  <td className="num">{usd(n.basis)}</td>
                  <td className="num">{n.ratePct.toFixed(2)}%</td>
                  <td className="num">{n.collected > 0 ? usd(n.collected) : "—"}</td>
                  <td className={n.perf === "nonperforming" ? "neg" : "dim"}>
                    {n.filedM !== undefined
                      ? `filed — the sale is around ${monthLabel(n.saleM ?? game.month)}`
                      : n.perf === "nonperforming"
                        ? "not paying"
                        : `paying, matures ${monthLabel(n.maturityM)}`}
                  </td>
                  <td>
                    {n.filedM === undefined && (
                      <span className="btn-row">
                        {n.perf === "nonperforming" && n.mods < 1 && (
                          <button className="btn-mini" title="Extend them, cut the coupon, take a five per cent paydown today. Once only."
                            onClick={() => restructureNote(n.id)}>restructure</button>
                        )}
                        {n.perf === "nonperforming" && (
                          <button className="btn-mini" title="Two per cent of face in legal, then nine to seventeen months of nothing, then you own it."
                            onClick={() => fileNote(n.id)}>foreclose</button>
                        )}
                        <button className="btn-mini" disabled={!bid.buyer}
                          title={bid.buyer ? `${bid.buyer} would pay ${usd(bid.px)}` : "No bid this month."}
                          onClick={() => offloadNote(n.id)}>
                          {bid.buyer ? `sell · ${usd(bid.px)}` : "no bid"}
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {(game.rivalNotes?.length ?? 0) > 0 && (
        <>
          <div className="page-section">Paper you passed on</div>
          {game.rivalNotes!.map((rn) => (
            <div key={rn.bbl} className="hint" style={{ cursor: "pointer" }} onClick={() => focus(rn.bbl, true)}>
              {resolveRec(parcels, game, rn.bbl)?.address ?? rn.bbl} — {rn.firm} holds the mortgage. They take the
              deed around {monthLabel(rn.takeM)} unless the owner finds {usd(rn.face)}.
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function TheBanks() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const focus = useStore((s) => s.focus);
  const lenders = game.lenders ?? [];
  const [open, setOpen] = useState<string | null>(null);
  if (!lenders.length) return null;
  const yoursTotal = lenders.reduce((a, l) => a + l.yours, 0);
  return (
    <>
      <div className="page-section">The banks</div>
      <div className="hint">
        Every desk on this street has its own balance sheet, and when it goes wrong it goes wrong at a name, not
        at the market. Capital ratio is what they have behind the book; appetite is what is left of their advance
        rate. Below about 0.12 they stop quoting entirely — and unlike the cycle, you can watch this coming.
        {" "}<b>Click a bank to open its statement</b> — every loan on that desk, yours and the street's,
        property by property, with the funding margin and the capital history behind it.
      </div>
      {/* EVERY DESK ON ONE AXIS. The sparkline inside a statement answers
          "how is this desk"; opened one at a time it cannot answer "WHICH
          desk", which is the question refinancing actually asks. Each line is
          capital ratio over the desk's OWN target — the kinds run wildly
          different books (a conduit holds 4%, an insurer 18%), so the raw
          ratios share no scale but the multiples do. 1.0× is managed to plan;
          the examiners' patience runs out around 0.22× of target. */}
      {(() => {
        const withHist = lenders.filter((l) => (l.capHist?.length ?? 0) > 1);
        if (withHist.length < 2) return null;
        const C = ["#3d6f9e", "#a8562e", "#4a7d5a", "#7a6a45", "#8a5620", "#2f6f7a"];
        // capHist is sampled in lockstep, but a desk refounded by a receiver
        // starts its history short — right-align on the shortest so every
        // point in a vertical slice is the same quarter.
        const m = Math.min(...withHist.map((l) => l.capHist!.length));
        return (
          <>
            <LineChart height={140}
              series={withHist.map((l, i) => ({
                label: l.name, color: C[i % C.length],
                pts: l.capHist!.slice(-m).map((v) => v / targetCapital(l.name)),
              }))}
              bands={[{ at: 1, label: "own target", color: "#8b8370" }, { at: 0.22, label: "seized" }]}
              yFmt={(v) => `${v.toFixed(1)}×`}
              xLabels={[`${Math.round(m / 4)} yrs ago`, "now"]}
            />
            <div className="hint">
              {withHist.map((l, i) => (
                <span key={l.id} style={{ marginRight: 14, whiteSpace: "nowrap" }}>
                  <span style={{ display: "inline-block", width: 12, height: 3, background: C[i % C.length], verticalAlign: "middle", marginRight: 5 }} />
                  {l.name}
                </span>
              ))}
              — quarterly, as a multiple of each desk's own capital target. A line walking down toward the
              seizure band is the most readable warning in the game: refinance away from that desk while it
              still quotes.
            </div>
          </>
        );
      })()}
      <table className="tbl">
        <thead>
          <tr>
            <th>Lender</th><th>Funded by</th><th className="num">Book</th><th className="num">Capital</th>
            <th className="num">Cap ratio</th><th className="num">Delinquent</th><th className="num">Charge-offs yr</th>
            <th className="num">Appetite</th><th className="num">Your debt</th><th>Standing</th>
          </tr>
        </thead>
        <tbody>
          {lenders.map((l) => {
            const h = lenderHealth(l);
            const cr = capitalRatio(l);
            const conc = l.book > 0 ? l.yours / l.book : 0;
            return (
              <Fragment key={l.id}>
                <tr onClick={() => setOpen(open === l.id ? null : l.id)} style={{ cursor: "pointer" }}>
                  <td>{open === l.id ? "▾ " : "▸ "}{l.name}</td>
                  <td className="dim">
                    {l.kind === "bank" ? "deposits" : l.kind === "life" ? "insurance float"
                      : l.kind === "conduit" ? "selling the paper on" : "committed capital"}
                  </td>
                  <td className="num">{usd(l.book)}</td>
                  <td className={"num" + (l.capital <= 0 ? " neg" : "")}>{usd(l.capital)}</td>
                  <td className={"num" + (h.bad ? " neg" : "")}>{(cr * 100).toFixed(1)}%</td>
                  <td className={"num" + (l.delinquent > 0.045 ? " neg" : "")}>{(l.delinquent * 100).toFixed(2)}%</td>
                  <td className="num">{l.chargeOffsYr > 0 ? usd(l.chargeOffsYr) : "—"}</td>
                  <td className={"num" + (l.appetite < 0.5 ? " neg" : "")}>
                    {l.failedM !== undefined ? "—" : l.appetite.toFixed(2)}
                  </td>
                  <td className="num">{l.yours > 0 ? usd(l.yours) : "—"}</td>
                  <td className={h.bad ? "neg" : "dim"}>{h.word}</td>
                </tr>
                {open === l.id && (
                  <tr>
                    <td colSpan={10} className="dim" style={{ paddingBottom: 12 }}>
                      <div style={{ marginBottom: 6 }}>{lenderBlurb(l.name)}</div>
                      <div>
                        Net income this year {usd(l.netIncomeYr)} · losses since inception {usd(l.chargeOffsTotal)}
                        {l.yours > 0 && <> · you are {(conc * 100).toFixed(2)}% of their book</>}
                        {conc > 0.06 && <span className="neg"> — big enough that your problems are theirs</span>}
                      </div>
                      <div style={{ marginTop: 6 }}>
                        {l.failedM !== undefined
                          ? "In receivership. Loans they wrote still have to be repaid; nothing new is being written, ever."
                          : l.appetite < 0.12
                            ? "Not quoting. Nothing you bring them gets underwritten until the capital comes back."
                            : l.appetite < 0.6
                              ? `Rationing — the advance rate on anything they write is about ${(100 * Math.min(1.02, 0.55 + 0.45 * l.appetite)).toFixed(0)}% of their stated sheet, and the coupon carries about ${(Math.max(0, 1 - l.appetite) * 80).toFixed(0)}bps of extra spread.`
                              : "Writing at their stated terms."}
                      </div>
                      {(() => {
                        const book = bankStatement(game, parcels, l.name);
                        const cityTotal = book.reduce((a, r) => a + r.balance, 0);
                        const target = targetCapital(l.name);
                        const nim = (l.bookYield ?? 0) - Math.max(0, l.fundCost ?? 0);
                        const byClass: Record<string, number> = {};
                        const byDistrict: Record<string, number> = {};
                        for (const r of book) {
                          byClass[r.klass] = (byClass[r.klass] ?? 0) + r.balance;
                          byDistrict[r.district] = (byDistrict[r.district] ?? 0) + r.balance;
                        }
                        const classCap = l.kind === "bank" ? 0.45 : l.kind === "life" ? 0.55 : l.kind === "conduit" ? 0.65 : 1;
                        const shares = Object.entries(byClass).sort((a, b) => b[1] - a[1]);
                        const districts = Object.entries(byDistrict).sort((a, b) => b[1] - a[1]).slice(0, 3);
                        const full = cityTotal > 40_000_000 ? shares.filter(([, v]) => classCap < 1 && v / cityTotal > classCap) : [];
                        const stranded = book.filter((r) => r.yours && h.bad && r.matM - game.month <= 60);
                        return (
                          <div style={{ marginTop: 10, paddingLeft: 12, borderLeft: "2px solid rgba(120,100,70,0.28)" }}>
                            {l.bookYield !== undefined && l.fundCost !== undefined && l.failedM === undefined && (
                              <div style={{ marginBottom: 6 }}>
                                The book earns <b className="mono">{l.bookYield.toFixed(2)}%</b> against funding at{" "}
                                <b className="mono">{Math.max(0, l.fundCost).toFixed(2)}%</b> — a{" "}
                                <b className={"mono" + (nim < 1.5 ? " neg" : "")}>{nim.toFixed(2)}pt</b> margin.{" "}
                                {nim < 1.5
                                  ? <span className="neg">The funding has repriced and the book has not. This is how a lender dies without writing a single bad loan — the advance rates go first.</span>
                                  : nim < 2.5
                                    ? "Compressed — loans written in a cheaper era against money priced in this one. They ration before it heals."
                                    : "A healthy spread; the desk earns its way out of ordinary losses."}
                                {(l.divYr ?? 0) > 0 && <span className="dim"> Paid {usd(l.divYr!)} out to the owners this year — capital above the buffer does not sit.</span>}
                              </div>
                            )}
                            {(l.capHist?.length ?? 0) > 1 && (
                              <div style={{ marginBottom: 6 }}>
                                <CapSpark hist={l.capHist} target={target} />
                                <span className="dim" style={{ marginLeft: 8 }}>
                                  capital ratio, quarterly · the dashed line is their {(target * 100).toFixed(1)}% target — a desk
                                  walking toward it is a desk to refinance away from
                                </span>
                              </div>
                            )}
                            {cityTotal > 0 && (
                              <div style={{ marginBottom: 6 }}>
                                <span className="dim">In this town: </span>
                                {shares.map(([k, v]) => `${k} ${(100 * v / cityTotal).toFixed(0)}%`).join(" · ")}
                                {districts.length > 1 && <span className="dim"> — by district {districts.map(([k, v]) => `${k} ${(100 * v / cityTotal).toFixed(0)}%`).join(", ")}</span>}
                                {full.length > 0 && (
                                  <span className="neg"> — full on {full.map(([k]) => k).join(" and ")} against their {(classCap * 100).toFixed(0)}% limit; new paper in that class is cut, whoever brings it</span>
                                )}
                              </div>
                            )}
                            {book.length > 0 && (
                              <>
                                <div style={{ margin: "8px 0 4px", letterSpacing: "0.04em", textTransform: "uppercase", fontSize: "0.82em" }}>
                                  The loan book — {book.length} loan{book.length === 1 ? "" : "s"} against deeds in this town, {usd(cityTotal)}
                                </div>
                                <table className="tbl">
                                  <thead>
                                    <tr>
                                      <th>Property</th><th>Borrower</th><th className="num">Balance</th><th className="num">Rate</th>
                                      <th className="num">Maturity</th><th className="num">LTV then → now</th><th>Standing</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {book.map((r) => {
                                      const yrs = (r.matM - game.month) / 12;
                                      return (
                                        <tr key={r.bbl} onClick={(e) => { e.stopPropagation(); focus(r.bbl, true); }}
                                          style={{ cursor: "pointer", ...(r.yours ? { background: "rgba(120,100,70,0.10)" } : {}) }}>
                                          <td>{resolveRec(parcels, game, r.bbl)?.address ?? r.bbl}{r.dev && <span className="dim"> · under construction</span>}</td>
                                          <td className={r.yours ? "" : "dim"}>{r.borrower}</td>
                                          <td className="num">{usd(r.balance)}</td>
                                          <td className="num">{r.rate > 0 ? r.rate.toFixed(2) + "%" : "—"}</td>
                                          <td className={"num" + (yrs <= 2 && !r.dev && r.yours ? " neg" : "")}>{monthLabel(r.matM)}</td>
                                          <td className="num">
                                            {r.origLtv !== null ? `${(100 * r.origLtv).toFixed(0)}%` : "—"}
                                            {" → "}
                                            {r.curLtv !== null
                                              ? <span className={r.curLtv > 1 ? "neg" : undefined}>{(100 * r.curLtv).toFixed(0)}%</span>
                                              : "—"}
                                          </td>
                                          <td className={r.bad ? "neg" : "dim"}>
                                            {r.dev ? "takeout at delivery"
                                              : r.status === "current" && yrs <= 2 ? `${Math.max(0, yrs).toFixed(1)} yrs`
                                                : r.status}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </>
                            )}
                            {l.book > cityTotal && (
                              <div className="dim" style={{ marginTop: 4 }}>
                                Plus {usd(l.book - cityTotal)} lent outside this town. The examiners see that book; you cannot —
                                the delinquency figure above is the only window into it.
                              </div>
                            )}
                            {stranded.length > 0 && (
                              <div className="alarm" style={{ marginTop: 6 }}>
                                {stranded.length === 1 ? "One balloon" : `${stranded.length} balloons`} of yours inside five years
                                at a desk that is {h.word}. A maturity here is a maturity that may not get refinanced —
                                move it while somebody else is still quoting.
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {yoursTotal > 0 && (
        <div className="hint">
          You owe {usd(yoursTotal)} across these desks. Where it sits matters as much as what it costs: a
          maturity at an impaired lender is a maturity that does not get refinanced.
        </div>
      )}
    </>
  );
}

// What the lending market remembers about you. Only shown once there is
// something to remember — a clean sponsor does not need to be told they are
// clean, and an empty panel is noise.
function SponsorRecord() {
  const game = useStore((s) => s.game)!;
  const st = sponsorStanding(game);
  const events = (game.sponsor?.events ?? []).filter((e) => game.month - e.m < 120);
  if (!events.length) return null;
  return (
    <div className="deal">
      <div className="deal-head">Your record with the desks · {st.label}</div>
      <div className="roll">
        {events.slice().reverse().map((e, i) => (
          <div key={i} className="roll-row">
            <span className="roll-name">
              {e.kind === "deficiency" ? "Deficiency paid" : e.kind === "seized" ? "Seized by creditors" : "Sold under pressure"} · {e.address}
            </span>
            <span className="roll-meta mono">
              {monthLabel(e.m)}{e.amount > 0 ? ` · $${(e.amount / 1e6).toFixed(2)}M hole` : ""} · ages off {monthLabel(e.m + 120)}
            </span>
          </div>
        ))}
      </div>
      <div className="deal-note">
        {st.institutional
          ? `Priced in: about +${st.spreadAdd.toFixed(2)}% on the coupon and ${(st.advanceCut * 100).toFixed(0)}% off the advance rate, on every loan you write until it ages off.`
          : `Agency and insurance money is closed to you. Bridge and mezzanine desks will still quote — at about +${st.spreadAdd.toFixed(2)}% and ${(st.advanceCut * 100).toFixed(0)}% less proceeds.`}
      </div>
    </div>
  );
}

// THE STREET. Who else is buying, what they own, and how much rope they have
// left. This is not decoration: the appetite number at the top is the same one
// that decides whether your lowball gets refused, and a firm sliding toward
// its covenants is a firm whose buildings are about to be cheap.
/**
 * WHAT HAS ACTUALLY TRADED.
 *
 * Everything else on this page is the engine telling you what it thinks. This
 * is the only panel in the game built entirely out of things that happened:
 * closed sales, the price paid, the cap rate that price implies, and the names
 * on both sides. Forming a view out of prints rather than out of a stat block
 * is most of the job, and there was no way to do it.
 */
function CompsSheet() {
  const game = useStore((s) => s.game)!;
  const select = useStore((s) => s.select);
  const setPage = useStore((s) => s.setPage);
  const [win, setWin] = useState(60);
  const comps = game.comps ?? [];
  if (comps.length < 3) {
    return (
      <>
        <div className="page-section">Comparable sales</div>
        <div className="hint">Nothing has changed hands yet that is worth calling a comp. Come back once the market has printed a few.</div>
      </>
    );
  }
  const recent = [...comps].reverse().filter((c) => c.m >= game.month - win).slice(0, 40);
  const flows = compFlows(game, win).slice(0, 8);
  return (
    <>
      <div className="page-section">
        Comparable sales · {recent.length} in the last {win / 12} years
      </div>
      <div className="hint">
        Closed prices, not appraisals. The cap rate is the going-in yield on what the buyer actually paid — when it
        drifts down across a class, the market is repricing and your own book is worth more than the tape says.
      </div>
      <div className="btn-row" style={{ marginBottom: 8 }}>
        {[36, 60, 120, 300].map((w) => (
          <button key={w} className={"btn-mini" + (win === w ? " on" : "")} onClick={() => setWin(w)}>
            {w / 12} yr
          </button>
        ))}
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>Class</th><th className="num">Trades</th><th className="num">Median cap</th>
            <th className="num">Median $/sf</th><th className="num">Volume</th><th className="num">Distressed</th>
          </tr>
        </thead>
        <tbody>
          {(["office", "retail", "multifamily", "industrial", "land"] as const).map((k) => {
            const st = compStats(game, k, win);
            return (
              <tr key={k}>
                <td>{k === "land" ? "Land" : CLASS_LABEL[k]}</td>
                {st ? (
                  <>
                    <td className="num">{st.n}</td>
                    <td className="num">{k === "land" ? "—" : `${st.medCap.toFixed(2)}%`}</td>
                    <td className="num">${st.medPsf.toFixed(0)}{k === "land" ? " lot" : ""}</td>
                    <td className="num">{usd(st.volume)}</td>
                    <td className={"num" + (st.distressShare > 0.3 ? " neg" : "")}>{(st.distressShare * 100).toFixed(0)}%</td>
                  </>
                ) : (
                  <td colSpan={5} className="dim">too few prints to call it a market</td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* THE TAPE'S YARDSTICK. The table above says where the median print
          cleared; this says where the market's own asking yields have been for
          twenty years, class by class — a print is only rich or cheap AGAINST
          this line, and until now holding the line in your head meant flipping
          back to the Economy page between rows. */}
      {(() => {
        const hist = (game.econ.history ?? []).slice(-240);
        if (hist.length < 2) return null;
        const KL = ["office", "retail", "multifamily", "industrial"] as const;
        const C: Record<(typeof KL)[number], string> = { office: "#3d6f9e", retail: "#a8562e", multifamily: "#4a7d5a", industrial: "#7a6a45" };
        return (
          <>
            <div className="page-section" style={{ marginTop: 14 }}>Cap rates — twenty years, by class</div>
            <LineChart height={132}
              series={KL.map((k) => ({ label: CLASS_LABEL[k], color: C[k], pts: hist.map((h) => h.cap?.[k] ?? game.econ.capRate[k]) }))}
              yFmt={(v) => `${v.toFixed(1)}%`}
              xLabels={[monthLabel(hist[0].q), monthLabel(hist[hist.length - 1].q)]}
            />
            <div className="hint">
              {KL.map((k) => (
                <span key={k} style={{ marginRight: 14, whiteSpace: "nowrap" }}>
                  <span style={{ display: "inline-block", width: 12, height: 3, background: C[k], verticalAlign: "middle", marginRight: 5 }} />
                  {CLASS_LABEL[k]}
                </span>
              ))}
              — a print well above its line bought a problem or a bargain; below it, somebody paid up. When a
              whole line drifts down, the market is repricing and your own book is worth more than the tape
              says yet.
            </div>
          </>
        );
      })()}

      {/* WHO IS DOING WHAT. A shop that has bought nine buildings in eighteen
          months is levering into the top, and you can watch them do it. */}
      {flows.length > 0 && (
        <>
          <div className="page-section" style={{ marginTop: 14 }}>Who has been active</div>
          <table className="tbl">
            <thead>
              <tr><th>Firm</th><th className="num">Bought</th><th className="num">Sold</th><th className="num">Net</th><th>Read</th></tr>
            </thead>
            <tbody>
              {flows.map((f) => (
                <tr key={f.name} className={f.name === firmShort(game) ? "row-me" : ""}>
                  <td>{f.name}</td>
                  <td className="num">{f.boughtN ? `${f.boughtN} · ${usd(f.bought)}` : "—"}</td>
                  <td className="num">{f.soldN ? `${f.soldN} · ${usd(f.sold)}` : "—"}</td>
                  <td className={"num" + (f.net < 0 ? " neg" : "")}>{f.net >= 0 ? "+" : "−"}{usd(Math.abs(f.net))}</td>
                  <td className="dim">
                    {f.boughtN >= 4 && f.net > 0 ? "Buying hard. They are the bid you are up against."
                      : f.soldN >= 3 && f.net < 0 ? "Getting out. Ask why before you buy what they are selling."
                      : f.net > 0 ? "Net buyer" : f.net < 0 ? "Net seller" : "Even"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <div className="page-section" style={{ marginTop: 14 }}>Recent prints</div>
      <div style={{ overflowX: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Closed</th><th>Property</th><th>Class</th><th className="num">Price</th>
              <th className="num">$/sf</th><th className="num">Cap</th><th>Buyer</th><th>Seller</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((c, i) => (
              <tr key={c.bbl + c.m + i} className={c.distress ? "dim" : ""}
                style={{ cursor: "pointer" }}
                onClick={() => { setPage("none"); select(c.bbl); }}>
                <td className="mono">{monthLabel(c.m)}</td>
                <td>{c.address}{c.distress ? " · distressed" : ""}</td>
                <td className="dim">{CLASS_LABEL[c.cls as keyof typeof CLASS_LABEL] ?? c.cls}</td>
                <td className="num">{usd(c.price)}</td>
                <td className="num">{c.sf > 0 ? `$${c.psf.toFixed(0)}` : `$${c.psf.toFixed(0)} land`}</td>
                <td className="num">{c.capRate > 0 ? `${c.capRate.toFixed(2)}%` : "—"}</td>
                <td className={c.buyer === firmShort(game) ? "" : "dim"}>{c.buyer}</td>
                <td className={c.seller === firmShort(game) ? "" : "dim"}>{c.seller}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function TheStreet() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const focus = useStore((s) => s.focus);
  const [open, setOpen] = useState<string | null>(null);
  const rivals = game.rivals ?? [];
  if (!rivals.length) return null;
  const appetite = marketAppetite(game);
  const playerEquity = (() => {
    let v = game.cash;
    for (const h of Object.values(game.holdings)) {
      const rec = resolveRec(parcels, game, h.bbl);
      if (rec) v += holdingValue(rec, game.econ, h, game.month) - (h.loan?.balance ?? 0);
    }
    return v;
  })();
  const marked = rivals.map((r) => ({ r, m: markRival(game, parcels, r) }))
    .sort((a, b) => (a.r.failedM !== undefined ? 1 : 0) - (b.r.failedM !== undefined ? 1 : 0) || b.m.aum - a.m.aum);
  return (
    <>
      <div className="page-section">
        The street · competing money {appetite < 0.6 ? "has left the room" : appetite < 0.9 ? "is thin" : appetite > 1.15 ? "is everywhere" : "is normal"}
      </div>
      <div className="hint">
        These firms bid on the same tape you do, with their own money — a firm without the equity does not
        close, and one already at its covenant cannot borrow to. When their dry powder is high your lowballs
        get refused; when their leverage runs past their covenants they sell into whatever bid exists, and
        that bid is you. Click any firm for its balance sheet and what it owns.
      </div>
      {/* THE LEAGUE TABLE. They started where you started — five to eighteen
          million and a hundred years — so the only honest way to read your own
          number is against theirs. */}
      <div className="grid" style={{ marginBottom: 10 }}>
        {(() => {
          const board = [
            { name: firmName(game), eq: playerEquity, me: true },
            ...marked.filter((x) => x.r.failedM === undefined)
              .map((x) => ({ name: x.r.name, eq: x.m.aum - x.r.debt + x.r.cash, me: false })),
          ].sort((a, b) => b.eq - a.eq);
          const rank = board.findIndex((b) => b.me) + 1;
          return (
            <>
              <Row k="Your place on the street" v={`${rank} of ${board.length} by equity`} strong bad={rank > board.length / 2} />
              <Row k="The biggest book in town" v={`${board[0].name} · ${usd(board[0].eq)}`} />
            </>
          );
        })()}
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>Firm</th><th>Style</th><th className="num">Buildings</th><th className="num">Gross assets</th>
            <th className="num">Leverage</th><th className="num">Dry powder</th><th>Read</th>
          </tr>
        </thead>
        <tbody>
          {marked.map(({ r, m }) => {
            const dead = r.failedM !== undefined;
            const stress = (r.stressMs ?? 0) > 0;
            const isOpen = open === r.id;
            return (
              <Fragment key={r.id}>
              <tr className={dead ? "dim" : ""} style={{ cursor: "pointer" }}
                onClick={() => setOpen(isOpen ? null : r.id)}>
                <td>{isOpen ? "▾ " : "▸ "}{r.name}</td>
                <td className="dim">{STYLE_WORD[r.style]}</td>
                <td className="num">{dead ? (r.bbls.length ? `${r.bbls.length} in workout` : "—") : r.bbls.length}</td>
                <td className="num">{dead ? "—" : usd(m.aum)}</td>
                {/* debt against no assets is not a ratio, it is a hole */}
                <td className={"num" + (!dead && m.ltv > 0.8 ? " neg" : "")}>
                  {dead ? "—" : m.aum <= 0 ? (r.debt > 0 ? "no assets" : "—") : `${(m.ltv * 100).toFixed(0)}%`}
                </td>
                <td className="num">{dead ? "—" : usd(Math.max(0, r.cash))}</td>
                <td className="dim">
                  {dead ? (r.bbls.length
                    ? `Failed ${monthLabel(r.failedM!)} — the receiver is still selling`
                    : `Gone, ${monthLabel(r.failedM!)}`)
                    : m.aum <= 0 && r.debt > 0 ? "Sold everything and still owes money — they are finished"
                    : stress ? "Selling under pressure — their tape is your opportunity"
                    : m.ltv > 0.75 ? "Levered up. One bad cycle from being a seller"
                    : r.cash > m.aum * 0.06 ? "Sitting on cash. They will outbid you"
                    : "Fully invested"}
                </td>
              </tr>
              {isOpen && (
                <tr>
                  <td colSpan={7} style={{ background: "rgba(43,37,26,0.035)" }}>
                    {/* THE BALANCE SHEET, the same one you are judged on. Gross
                        assets less debt is their equity; NOI over assets is what
                        the book yields; distributions are what they have already
                        taken off the table, which is why a firm with modest
                        equity is not necessarily a firm that did badly. */}
                    <div className="grid" style={{ margin: "8px 0" }}>
                      <Row k="Gross assets" v={usd(m.aum)} />
                      <Row k="Debt" v={usd(r.debt)} bad={m.ltv > 0.8} />
                      <Row k="Equity in property" v={usd(m.aum - r.debt)} bad={m.aum - r.debt < 0} />
                      <Row k="Cash" v={usd(r.cash)} bad={r.cash < 0} />
                      {/* the number the league table ranks on, and the same one
                          your own Books page calls net worth */}
                      <Row k="Net worth" v={usd(m.aum - r.debt + r.cash)} strong bad={m.aum - r.debt + r.cash < 0} />
                      <Row k="Leverage" v={`${(m.ltv * 100).toFixed(0)}% LTV · they stop at ${(STYLE_MAX[r.style] * 100).toFixed(0)}%`} bad={m.ltv > STYLE_MAX[r.style]} />
                      <Row k="NOI / yr" v={usd(m.noiYr)} />
                      <Row k="Yield on assets" v={m.aum > 0 ? `${((m.noiYr / m.aum) * 100).toFixed(2)}%` : "—"} />
                      {/* THE PART OF A COMPETITOR YOU COULD NEVER SEE. Their
                          buildings fill and empty and wear out like yours do,
                          and a firm running 74% full with a deferred capital
                          plan is a seller waiting for a reason. */}
                      {r.occ !== undefined && (
                        <Row k="Portfolio occupancy" v={`${(r.occ * 100).toFixed(0)}%`} bad={r.occ < 0.8} />
                      )}
                      <Row k="Condition of the book"
                        v={`${CONDITION_WORD[rivalCondition(r)]} · ${usd(r.capexYr ?? 0)} of capital spent this year`}
                        bad={(r.condIdx ?? 1) < 0.55} />
                      {game.street?.[r.id] && (
                        <Row k="Between you"
                          v={[
                            game.street[r.id].deals ? `${game.street[r.id].deals} deal${game.street[r.id].deals === 1 ? "" : "s"}` : null,
                            game.street[r.id].beats ? `outbid you ${game.street[r.id].beats}×` : null,
                            game.street[r.id].insults ? `${game.street[r.id].insults} conversation${game.street[r.id].insults === 1 ? "" : "s"} you ended badly` : null,
                          ].filter(Boolean).join(" · ") || "nothing yet"}
                          bad={(game.street[r.id].insults ?? 0) > 0} />
                      )}
                      <Row k="Debt service / yr" v={`−${usd((r.debt * (game.econ.indexRate + 1.9)) / 100 + r.debt / 30)}`} />
                      {/* realised, and no longer on this balance sheet — which
                          is why modest equity is not the same as a bad century */}
                      <Row k="Taken out to date" v={usd(r.distributed ?? 0)} />
                      <Row k="Founded" v={r.bornM > 0 ? monthLabel(r.bornM) : "before you arrived"} />
                    </div>
                    {/* WHAT THEY HAVE IN THE GROUND. A firm's live jobs are the
                        part of its balance sheet that is pure risk: money spent,
                        debt drawn, nothing earning. It is also the space that is
                        coming for your tenants in two years. */}
                    {(() => {
                      const jobs = (game.cityJobs ?? []).filter((j) => j.firmId === r.id);
                      if (!jobs.length) return null;
                      return (
                        <>
                          <div className="page-section" style={{ marginTop: 4 }}>
                            Under construction · {jobs.length}
                          </div>
                          <div className="mini-list">
                            {jobs.map((j) => {
                              const rec = resolveRec(parcels, game, j.bbl);
                              const pct = Math.min(100, Math.max(0, ((game.month - j.startM) / Math.max(1, j.deliverM - j.startM)) * 100));
                              return (
                                <button key={j.bbl} className="neighbor"
                                  onClick={(ev) => { ev.stopPropagation(); focus(j.bbl, true); }}>
                                  <span className="neighbor-addr">{rec?.address ?? j.bbl}</span>
                                  <span className="neighbor-meta">
                                    {sf(j.sf)} {j.use} · {j.floors} fl · {pct.toFixed(0)}% ·{" "}
                                    {j.orphaned ? "stalled — the sponsor is gone" : `due ${monthLabel(j.deliverM)}`}
                                    {j.debt ? ` · ${usd(j.debt)} drawn` : ""}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </>
                      );
                    })()}
                    <div className="page-section" style={{ marginTop: 4 }}>
                      What they own · {r.bbls.length}
                    </div>
                    {r.bbls.length === 0 && <div className="hint">Nothing. All cash, looking.</div>}
                    {/* EVERY DEED, not the first sixty. A truncated list of a
                        competitor's holdings is worse than none: it looks
                        complete and it is not, and you cannot see what somebody
                        is quietly assembling from a page that stops early.
                        Sorted by value, because that is how a book is read. */}
                    <div className="mini-list">
                      {r.bbls.map((b) => {
                        const rec = resolveRec(parcels, game, b);
                        if (!rec) return null;
                        return { b, rec, v: assetValue(rec, game.econ, initialCondition(rec)) };
                      }).filter(Boolean).sort((a, b2) => b2!.v - a!.v).map((row) => (
                        <button key={row!.b} className="neighbor"
                          onClick={(ev) => { ev.stopPropagation(); focus(row!.b, true); }}>
                          <span className="neighbor-addr">{row!.rec.address}</span>
                          <span className="neighbor-meta">
                            {row!.rec.class === "land" ? "vacant land" : `${useLabel(row!.rec)} · ${sf(row!.rec.bldgArea)}`} · {usd(row!.v)}
                          </span>
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

// where each style stops borrowing — mirrored from the engine so the sheet can
// say what their own covenant is, not just where they are against it
const STYLE_MAX: Record<string, number> = {
  family: 0.50, core: 0.65, opportunistic: 0.88, developer: 0.78,
  merchant: 0.80, pe: 0.75, reit: 0.58, vulture: 0.60,
  owneruser: 0.55, foreign: 0.35, slumlord: 0.72,
};

const CONDITION_WORD: Record<string, string> = {
  good: "well kept", standard: "adequate", worn: "run down", obsolete: "finished",
};

// What the street calls each kind of shop. The point of the phrasing is that
// it tells you what they WANT, because that is what decides whether they are
// your competition on this building or your buyer for it next year.
const STYLE_WORD: Record<string, string> = {
  family: "old money",
  core: "institutional",
  opportunistic: "opportunistic",
  developer: "developer",
  merchant: "merchant builder",
  pe: "private equity · IRR clock",
  reit: "listed REIT",
  vulture: "distressed specialist",
  owneruser: "owner-occupier",
  foreign: "offshore capital",
  slumlord: "milking the stock",
};


// The revolving line: up to 35% of net worth at prime + 400bps, and the
// advance rate moves with the credit cycle — the label used to promise a
// fixed 35% while the engine was quietly cutting it in a crunch. It draws
// before a shortfall becomes insolvency, and idle cash sweeps against it.
function CreditLine() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const { drawCredit, repayCredit } = useStore.getState();
  const limit = locLimit(game, parcels);
  const nw = netWorth(game, parcels);
  const balance = game.loc?.balance ?? 0;
  const avail = Math.max(0, limit - balance);
  const rate = locRate(game);
  const [amt, setAmt] = useState(0);
  const room = Math.max(avail, balance);
  return (
    <div className="page-section">
      <div className="page-section-head">Line of credit</div>
      <div className="stat-strip">
        {(() => {
          const adv = nw > 0 ? limit / nw : 0.35;
          return (
            <Big
              label={`Limit · ${(adv * 100).toFixed(0)}% of net worth`}
              value={usd(limit)}
              bad={adv < 0.3}
            />
          );
        })()}
        <Big label="Drawn" value={usd(balance)} bad={balance > limit * 0.8} />
        <Big label="Available" value={usd(avail)} />
        <Big label="Rate · index + 400" value={pct(rate)} />
        <Big label="Interest paid" value={usd(game.loc?.interestPaid ?? 0)} />
      </div>
      <SponsorRecord />
      {room > 0 ? (
        <>
          <Slider
            label="Amount"
            value={Math.min(amt, room)}
            min={0}
            max={Math.max(1, room)}
            step={Math.max(10_000, Math.round(room / 200))}
            onChange={setAmt}
            format={(v) => usd(v)}
            marks={[
              { at: Math.round(room * 0.25), label: "¼" },
              { at: Math.round(room * 0.5), label: "½" },
              { at: room, label: "all" },
            ]}
            hint={`Costs ${usd((Math.min(amt, room) * rate) / 100 / 12)} a month in interest while it's out.`}
          />
          <div className="btn-row">
            <button className="btn btn-buy" disabled={amt <= 0 || amt > avail} onClick={() => drawCredit(amt)}>
              Draw {usd(Math.min(amt, avail))}
            </button>
            <button className="btn" disabled={balance <= 0 || amt <= 0} onClick={() => repayCredit(amt)}>
              Repay {usd(Math.min(amt, balance))}
            </button>
          </div>
        </>
      ) : (
        <div className="hint">Build some net worth and the bank will open a line against it.</div>
      )}
      <div className="hint">
        The line covers a shortfall automatically before it can sink the run, and idle cash above $250K pays it back down.
      </div>
    </div>
  );
}

/**
 * The saves page. The slot manager used to live at the bottom of the Books
 * page, below the ledger and the milestone list, which is why nobody knew the
 * game could be saved at all. Loading a game is not an accounting task.
 */
/**
 * SETTINGS. The first thing in here exists because of a sentence from the
 * owner: "sometimes I want to simulate the game" — twenty years of Advance
 * with nothing taking the screen hostage. Every pop-up decision also lives on
 * a page, so the master switch costs nothing but the interruptions. The other
 * rows are the switches that already existed, gathered where a person would
 * look for them.
 */
function SettingsPage() {
  const game = useStore((s) => s.game)!;
  const popupsOff = useStore((s) => s.popupsOff);
  const setPopupsOff = useStore((s) => s.setPopupsOff);
  const flip = (patch: Partial<GameState>) => {
    const st = useStore.getState();
    useStore.setState({ game: { ...st.game!, ...patch } });
  };
  const Toggle = ({ on, set, label, detail }: { on: boolean; set: (v: boolean) => void; label: string; detail: string }) => (
    <div className="deal" style={{ marginBottom: 8 }}>
      <div className="modal-actions" style={{ alignItems: "center", gap: 12 }}>
        <button className={"btn" + (on ? " btn-buy" : "")} style={{ minWidth: 64 }} onClick={() => set(!on)}>
          {on ? "On" : "Off"}
        </button>
        <div>
          <div style={{ fontWeight: 600 }}>{label}</div>
          <div className="hint" style={{ margin: 0 }}>{detail}</div>
        </div>
      </div>
    </div>
  );
  return (
    <div>
      <div className="page-section">Interruptions</div>
      <Toggle
        on={!popupsOff}
        set={(v) => setPopupsOff(!v)}
        label="Pop-up cards"
        detail="Letters of intent, offers on your buildings, broker calls and the auction card take the screen when they arrive. Off, they wait quietly where they live — letters and tenant asks on the Deals desk, offers on the Portfolio, off-market calls and the docket on Marketplace — and nothing is lost but the interruption. Turn this off to simulate long stretches."
      />
      <Toggle
        on={!game.brokersOff}
        set={(v) => flip({ brokersOff: !v })}
        label="Brokers ring you"
        detail="Off-market deals arrive by phone a few times a year once the street knows your name. Off, the phones stay silent entirely — nothing arrives, on any page."
      />
      <Toggle
        on={!game.auctionQuiet}
        set={(v) => flip({ auctionQuiet: !v })}
        label="The July auction card"
        detail="The county docket comes up as a card when it is published each July. Off, the auction still runs on the same day with the same lots — you read it on Marketplace instead."
      />
      <div className="hint">
        Pop-up cards is a preference of this browser and applies to every campaign. The broker and auction
        switches are decisions of this firm and travel with the save.
      </div>
    </div>
  );
}

function SavesPage() {
  const devGrant = useStore((s) => s.devGrant);
  const game = useStore((s) => s.game);
  return (
    <div>
      <SaveSlots />
      <div className="page-section" style={{ marginTop: 22 }}>
        <div className="page-section-head">Testing</div>
        <div className="hint">
          Not part of the game. It books nothing and proves nothing — it just puts money on the
          table so you can try things without playing your way to them first.
        </div>
        <div className="btn-row" style={{ marginTop: 8 }}>
          <button className="btn btn-buy" onClick={devGrant}>+ $100M testing capital</button>
          {game && <span className="hint" style={{ margin: "auto 0" }}>cash today: {usd(game.cash)}</span>}
        </div>
      </div>
    </div>
  );
}

// Named saves alongside the autosave, so a run can be branched or rolled back.
function SaveSlots() {
  const slots = useStore((s) => s.slots);
  const { saveTo, loadFrom, dropSave, refreshSlots } = useStore.getState();
  const [name, setName] = useState("");
  // The named save with a deletion pending — window.confirm here had the same
  // browser-chrome problem as demolition, and the same silent-false failure.
  const [killSlot, setKillSlot] = useState<string | null>(null);
  useEffect(() => { void refreshSlots(); }, [refreshSlots]);
  return (
    <div className="page-section">
      <div className="page-section-head">Saved games</div>
      <div className="hint">The game autosaves every month. These are named copies you can come back to.</div>
      <div className="btn-row" style={{ marginTop: 8 }}>
        <input
          className="ask-input mono"
          style={{ width: 200 }}
          placeholder="name this save"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn btn-buy" disabled={!name.trim()} onClick={() => { void saveTo(name.trim()); setName(""); }}>
          Save
        </button>
      </div>
      <div style={{ marginTop: 10 }}>
        {slots.map((m) => (
          <div key={m.slot} className="slot-row">
            <div>
              <div className="slot-name">{m.slot}</div>
              <div className="slot-meta mono">{monthLabel(m.month)} · {usd(m.cash)} cash · saved {new Date(m.savedAt).toLocaleDateString()}</div>
            </div>
            <div className="btn-row" style={{ margin: 0 }}>
              <button className="btn btn-buy" onClick={() => void loadFrom(m.slot)}>Load</button>
              <button className="btn btn-sell" onClick={() => setKillSlot(m.slot)}>Delete</button>
            </div>
          </div>
        ))}
        {!slots.length && <div className="hint">No named saves yet.</div>}
        {(() => {
          const doomed = killSlot === null ? undefined : slots.find((s2) => s2.slot === killSlot);
          if (!doomed) return null;
          return (
            <div className="modal-backdrop">
              <div className="modal">
                <div className="modal-kicker">Delete a saved game</div>
                <div className="modal-title">{doomed.slot}</div>
                <div className="modal-sub">
                  {monthLabel(doomed.month)} · {usd(doomed.cash)} cash · saved {new Date(doomed.savedAt).toLocaleDateString()}.
                  Gone is gone — there is no bin to fish it back out of.
                </div>
                <div className="modal-actions">
                  <button className="btn btn-sell" onClick={() => { setKillSlot(null); void dropSave(doomed.slot); }}>Delete it</button>
                  <button className="btn" onClick={() => setKillSlot(null)}>Keep it</button>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// Everything about who is paying you rent, in one room: occupancy by
// building, the whole rent roll, what rolls when, and the agent switch.
function LeasingPage() {
  const parcels = useStore((s) => s.parcels)!;
  const game = useStore((s) => s.game)!;
  const select = useStore((s) => s.select);
  const setPage = useStore((s) => s.setPage);
  const { setAgent, broker } = useStore.getState();
  const go = (bbl: string) => { setPage("none"); select(bbl); };
  const q = game.month;

  const rows = Object.values(game.holdings).flatMap((h) => {
    const rec = resolveRec(parcels, game, h.bbl);
    if (!rec || rec.class === "land" || !rec.bldgArea) return [];
    const commercial = isCommercial(rec);
    // Both halves of a stacked building count: the shops under lease and the
    // flats above that are occupied.
    const resSf = useSf(rec, "multifamily");
    const leased = h.tenants.reduce((a, t) => a + t.sf, 0) + Math.round((h.occ ?? 0) * resSf);
    const notReady = notReadySf(h, q);
    const occ = physicalOcc(rec as never, h);
    const rentRoll = h.tenants.reduce((a, t) => a + t.rentPsf * t.sf, 0)
      + resSf * useRentPsfYr(rec, game.econ, h.condition, "multifamily") * (h.occ ?? 0);
    const rolling = commercial ? h.tenants.filter((t) => t.endM - q <= 12).reduce((a, t) => a + t.sf, 0) : 0;
    return [{ h, rec, commercial, leased, notReady, occ, rentRoll, rolling }];
  });

  const ind = portfolioIndustries(game);

  if (!rows.length) {
    return (
      <div>
        <AgentBar />
        <div className="hint">No buildings yet — occupancy starts when you own something with tenants in it.</div>
      </div>
    );
  }
  const totSf = rows.reduce((a, r) => a + r.rec.bldgArea, 0);
  const totLeased = rows.reduce((a, r) => a + r.leased, 0);
  const totRoll = rows.reduce((a, r) => a + r.rentRoll, 0);
  const totRolling = rows.reduce((a, r) => a + r.rolling, 0);

  function AgentBar() {
    return (
      <div className="agent-bar">
        <div>
          <div className="agent-title">{game.agent ? "Your leasing agent has the book." : "You are handling leasing yourself."}</div>
          <div className="agent-sub">
            {game.agent
              ? "Every LOI that clears the market gets signed for you, at 6% of lease value instead of the 4%/2% you'd pay on your own. Lowballs still get passed."
              : "You'll be asked to sign, counter, or pass on every letter of intent. Hand it over and the decisions stop coming to you."}
          </div>
        </div>
        <button className={"btn" + (game.agent ? "" : " btn-on")} onClick={() => setAgent(!game.agent)}>
          {game.agent ? "Take leasing back" : "Hire the agent · 6%"}
        </button>
      </div>
    );
  }

  return (
    <div>
      <AgentBar />
      <div className="stat-strip">
        <Big label="Portfolio occupancy" value={totSf ? ((100 * totLeased) / totSf).toFixed(1) + "%" : "—"} bad={totSf > 0 && totLeased / totSf < 0.8} />
        <Big label="Leased" value={sf(totLeased) + " of " + sf(totSf)} />
        <Big label="Rent roll / yr" value={usd(totRoll)} />
        <Big label="Rolling in 12 mo" value={sf(totRolling)} bad={totRolling > totLeased * 0.25} />
        <Big label="Open LOIs" value={String(game.lois.length)} />
      </div>

      {/* WHAT YOUR RENT ROLL DOES FOR A LIVING.
          You can own twelve diversified buildings and still be sixty per cent
          finance — and when finance turns you find that out all at once, in
          every building, in the same eighteen months. It is the single most
          important thing a landlord can know about themselves and there was no
          way to see it. */}
      {ind.rows.length > 0 && (
        <div className="page-section">
          <div className="page-section-head">
            Exposure by trade{ind.atRisk > 0.18 ? ` · ${(ind.atRisk * 100).toFixed(0)}% of income in trades that are contracting` : ""}
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Trade</th><th className="num">Share of income</th><th className="num">Income / yr</th>
                <th className="num">Space</th><th className="num">Tenants</th><th>Cycle</th>
              </tr>
            </thead>
            <tbody>
              {ind.rows.map((r) => (
                <tr key={r.sector} className={r.stress > 0.4 ? "dim" : ""}>
                  <td>{INDUSTRY_LABEL[r.sector]}</td>
                  <td className={"num" + (r.share > 0.45 ? " neg" : "")}>{(r.share * 100).toFixed(0)}%</td>
                  <td className="num">{usd(r.income)}</td>
                  <td className="num">{sf(r.sf)}</td>
                  <td className="num">{r.tenants}</td>
                  <td className={r.phase === "bust" ? "neg" : "dim"}>
                    {r.phase === "boom" ? "hiring hard" : r.phase === "bust" ? "contracting" : "steady"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="hint">
            {ind.top && ind.top.share > 0.45
              ? `${(ind.top.share * 100).toFixed(0)}% of your rent comes from ${INDUSTRY_LABEL[ind.top.sector].toLowerCase()}. That is not a rent roll, it is a position in one trade — and both the buyers and the lenders price it that way.`
              : "A rent roll spread across trades survives a bad decade in any one of them. Lenders discount income concentrated in a single industry, and so does anyone buying the building off you."}
          </div>
        </div>
      )}

      <div className="page-section">
        <div className="page-section-head">By building</div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Property</th><th>Class</th><th className="num">Size</th><th className="num">Occupancy</th>
                <th className="num">Rent roll / yr</th><th className="num">Avg rent</th><th className="num">WALT</th>
                <th className="num">Rolling 12mo</th><th>Leasing</th>
              </tr>
            </thead>
            <tbody>
              {rows.sort((a, b) => a.occ - b.occ).map((r) => (
                <tr key={r.h.bbl} onClick={() => go(r.h.bbl)}>
                  <td>{r.rec.address}</td>
                  <td>{useLabel(r.rec)}</td>
                  <td className="num">{sf(r.rec.bldgArea)}</td>
                  <td className={"num" + (r.occ < 0.75 ? " neg" : "")}>{(r.occ * 100).toFixed(0)}%</td>
                  <td className="num">{usd(r.rentRoll)}</td>
                  <td className="num">{r.leased ? "$" + (r.rentRoll / r.leased).toFixed(0) : "—"}</td>
                  <td className="num">{r.commercial ? walt(r.h, q).toFixed(1) + "y" : "—"}</td>
                  <td className={"num" + (r.rolling > r.leased * 0.3 ? " neg" : "")}>{r.rolling ? sf(r.rolling) : "—"}</td>
                  <td className="dim">
                    {[r.h.broker ? "BROKER" : null, r.notReady ? "TURNING" : null,
                      r.h.deliveredM !== undefined && q - r.h.deliveredM <= 30 ? "LEASE-UP" : null]
                      .filter(Boolean).join(" · ")}
                    {r.commercial && !r.h.broker && r.rec.bldgArea - r.leased > 500 && (
                      <button className="btn btn-mini" onClick={(e) => { e.stopPropagation(); broker(r.h.bbl, true); }}>hire</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="page-section">
        <div className="page-section-head">The rent roll</div>
        <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
          <table className="tbl">
            <thead>
              <tr><th>Tenant</th><th>Sector</th><th>Credit</th><th>Property</th><th className="num">Size</th><th className="num">Rent</th><th>Recovery</th><th className="num">Stop $/sf</th><th className="num">vs mkt</th><th className="num">Expires</th></tr>
            </thead>
            <tbody>
              {rows.flatMap((r) => r.h.tenants.map((t, i) => ({ t, r, i })))
                .sort((a, b) => a.t.endM - b.t.endM)
                .map(({ t, r, i }) => (
                  <tr key={r.h.bbl + ":" + i} onClick={() => go(r.h.bbl)}>
                    <td>{t.name}</td>
                    <td className="dim">{t.sector}</td>
                    <td className="mono">{CREDIT_LABEL[t.credit]}</td>
                    <td className="dim">{r.rec.address}</td>
                    <td className="num">{sf(t.sf)}</td>
                    <td className="num">${t.rentPsf.toFixed(2)}</td>
                    <td className="dim">{recoveryOf(t) === "nnn" ? "NNN" : recoveryOf(t) === "base" ? "base yr" : "gross"}</td>
                    <td className="num dim">{recoveryOf(t) === "base" ? `$${(t.baseStopPsf ?? 0).toFixed(2)}` : "—"}</td>
                    {(() => {
                      const mkt = marketRentPsfYr(r.rec, game.econ, r.h.condition);
                      const d = mkt > 0 ? t.rentPsf / mkt - 1 : 0;
                      return <td className={"num" + (d < -0.12 ? " neg" : "")}>{(d * 100).toFixed(0)}%</td>;
                    })()}
                    <td className={"num" + (t.endM - q <= 12 ? " neg" : "")}>{monthLabel(t.endM)}</td>
                  </tr>
                ))}
              {!rows.some((r) => r.h.tenants.length) && (
                <tr><td colSpan={10} className="dim">Nothing under lease yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/**
 * THE TAPE, AS ITS OWN PAGE.
 *
 * Every headline this economy writes was being rendered into a 260px scroll
 * box at the bottom of the Books page, under the ledger and the milestone
 * list — which is the same as not having a news page, and is why the owner
 * asked where it was. Saves was promoted out of that same page for the same
 * reason.
 *
 * The engine keeps the last 120 items (market.ts and sim.ts both trim to it),
 * so this shows all of them rather than a slice, grouped by month so a run of
 * headlines reads as a month rather than as a list, and filterable because in
 * a bad year the warnings are the only ones you want.
 */
const NEWS_KINDS = [
  { k: "all", label: "Everything" },
  { k: "warn", label: "Warnings" },
  { k: "event", label: "Events" },
  { k: "deal", label: "Deals" },
  { k: "info", label: "Notices" },
] as const;

function NewsPage() {
  const game = useStore((s) => s.game)!;
  const [kind, setKind] = useState<string>("all");
  const items = (game.news ?? []).filter((n) => kind === "all" || n.kind === kind);
  const byMonth: { q: number; rows: typeof items }[] = [];
  for (const n of items) {
    const last = byMonth[byMonth.length - 1];
    if (last && last.q === n.q) last.rows.push(n);
    else byMonth.push({ q: n.q, rows: [n] });
  }
  const counts: Record<string, number> = { all: (game.news ?? []).length };
  for (const n of game.news ?? []) counts[n.kind] = (counts[n.kind] ?? 0) + 1;

  return (
    <div>
      <div className="hint">
        The last {(game.news ?? []).length} items off the wire, newest first. Anything with a ✈ is about a
        specific building — click it and the camera goes there.
      </div>
      <div className="btn-row" style={{ marginBottom: 8, flexWrap: "wrap" }}>
        {NEWS_KINDS.map((t) => (
          <button
            key={t.k}
            className={"lens-btn" + (kind === t.k ? " lens-on" : "")}
            onClick={() => setKind(t.k)}
          >
            {t.label}{counts[t.k] ? ` · ${counts[t.k]}` : ""}
          </button>
        ))}
      </div>
      {!items.length && <div className="hint">Nothing under that heading yet.</div>}
      {byMonth.map((g) => (
        <div key={g.q} className="page-section" style={{ marginTop: 6 }}>
          <div className="page-section-head">{monthLabel(g.q)}</div>
          <div className="news">
            {g.rows.map((n, i) => (
              <div
                key={i}
                className={"news-item news-" + n.kind + (n.bbl ? " news-clickable" : "")}
                onClick={n.bbl ? () => { useStore.getState().focus(n.bbl!, true); } : undefined}
              >
                {n.text}{n.bbl ? " ✈" : ""}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function BooksPage() {
  const game = useStore((s) => s.game)!;
  const focus = useStore((s) => s.focus);
  const nw = game.nwHistory[game.nwHistory.length - 1] ?? 0;
  const realized = game.exits.reduce((a, e) => a + e.gain, 0);
  const years = [...(game.books ?? [])].reverse().slice(0, 15);
  const exits = [...(game.exits ?? [])].reverse().slice(0, 12);
  const achieved = MILESTONES.filter((m) => game.milestones?.[m.id] !== undefined);
  const pending = MILESTONES.filter((m) => game.milestones?.[m.id] === undefined);
  return (
    <div>
      <div className="stat-strip">
        <Big label="Net worth" value={usd(nw)} bad={nw < 0} />
        <Big label="Cash" value={usd(game.cash)} bad={game.cash < 0} />
        {/* NOT YOURS. Deposits arrive as cash at signing and look exactly like
            equity until the tenant leaves and takes them back. Net worth above
            is quoted net of this; the cash figure beside it is not. */}
        {depositsHeld(game) > 0 && (
          <Big label="Deposits held" value={"−" + usd(depositsHeld(game))} />
        )}
        <Big label="Realized gains" value={usd(realized)} bad={realized < 0} />
        <Big label="Taxes paid, lifetime" value={usd(game.taxesPaid ?? 0)} />
        <Big label="Exits" value={String(game.exits.length)} />
      </div>
      <NWChart data={game.nwHistory} />
      <CreditLine />
      {/* THE WAY IN TO THE PAYROLL. Firm overhead is a line on the statement
          below and, since the desk exists, half of it is people with names,
          salaries and a notice period. The books are where you find out what
          the office costs; this is where you find out who is in it. */}
      <div className="btn-row">
        <button className="btn" onClick={() => useStore.getState().setPage("staff")}
          title="Property management and leasing — capacity, the shortlist, and what the slip is costing you">
          The desk · {(game.staff ?? []).length} on the payroll →
        </button>
      </div>
      <IncomeStatement />
      <div className="page-section">
        <div className="page-section-head">The ledger, by year — every line, side by side</div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Year</th><th className="num">NOI</th><th className="num">Bank interest</th><th className="num">Debt svc</th><th className="num">Leasing</th>
                <th className="num">Capex</th><th className="num">G&amp;A</th><th className="num">Development</th><th className="num">Taxes</th>
                <th className="num">Acquisitions</th><th className="num">Dispositions</th><th className="num">Net</th>
              </tr>
            </thead>
            <tbody>
              {years.map((b) => {
                const net = b.noi + (b.interest ?? 0) - b.debtSvc - b.leasing - b.capex - (b.ga ?? 0) - b.dev - b.taxes - b.bought + b.sold;
                return (
                  <tr key={b.yr} style={{ cursor: "default" }}>
                    <td className="mono">{2000 + b.yr}</td>
                    <td className="num">{usd(b.noi)}</td>
                    {/* Booked apart from NOI on purpose: 1% on a bank balance is
                        not property income, and folding it in overstated the
                        yield on every building you own. */}
                    <td className="num dim" title="1.0% a year on positive cash balances">{b.interest ? usd(b.interest) : "—"}</td>
                    <td className="num">{b.debtSvc ? "−" + usd(b.debtSvc) : "—"}</td>
                    <td className="num">{b.leasing ? "−" + usd(b.leasing) : "—"}</td>
                    <td className="num">{b.capex ? "−" + usd(b.capex) : "—"}</td>
                    <td className="num">{b.ga ? "−" + usd(b.ga) : "—"}</td>
                    <td className="num">{b.dev ? "−" + usd(b.dev) : "—"}</td>
                    <td className="num">{b.taxes ? "−" + usd(b.taxes) : "—"}</td>
                    <td className="num">{b.bought ? "−" + usd(b.bought) : "—"}</td>
                    <td className="num">{b.sold ? usd(b.sold) : "—"}</td>
                    <td className={"num" + (net < 0 ? " neg" : "")}>{usd(net)}</td>
                  </tr>
                );
              })}
              {!years.length && <tr><td colSpan={12} className="dim">Nothing on the books yet — advance a month.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <div className="page-section">
        <div className="page-section-head">The tape</div>
        <div className="news" style={{ maxHeight: 260, overflowY: "auto" }}>
          {game.news.slice(0, 60).map((n, i) => (
            // A story about a place can put the camera on the place: a record
            // groundbreaking is only worth reading if you can go look at it.
            <div
              key={i}
              className={"news-item news-" + n.kind}
              style={n.bbl ? { cursor: "pointer" } : undefined}
              title={n.bbl ? "Fly to it" : undefined}
              onClick={n.bbl ? () => focus(n.bbl!, true) : undefined}
            >
              <span className="news-q mono">{monthLabel(n.q)}</span> {n.text}{n.bbl ? " ✈" : ""}
            </div>
          ))}
        </div>
      </div>
      <div className="deals-grid">
        <section className="page-section">
          <div className="page-section-head">Dispositions</div>
          <div className="mini-list">
            {exits.map((e, i) => (
              <div key={i} className="mini-row" style={{ cursor: "default" }}>
                <span>{e.forced ? "⚠ " : ""}{e.address}</span>
                <span className="mono">
                  {usd(e.price)} · {e.gain >= 0 ? "+" : "−"}{usd(Math.abs(e.gain))} · held {((e.soldM - e.boughtM) / 12).toFixed(1)} yrs
                </span>
              </div>
            ))}
            {!exits.length && <div className="hint">No sales yet. The first exit is the education.</div>}
          </div>
        </section>
        <section className="page-section">
          <div className="page-section-head">Milestones · {achieved.length} of {MILESTONES.length}</div>
          <div className="mini-list">
            {achieved.map((m) => (
              <div key={m.id} className="mini-row" style={{ cursor: "default" }}>
                <span>◆ {m.label}</span>
                <span className="mono">{monthLabel(game.milestones[m.id])}</span>
              </div>
            ))}
            {pending.slice(0, 4).map((m) => (
              <div key={m.id} className="mini-row mini-dim" style={{ cursor: "default" }}>
                <span>◇ {m.label}</span>
                <span className="mono dim">—</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * THE INCOME STATEMENT.
 *
 * The ledger below this is a fine spreadsheet and a bad statement: twelve
 * columns wide, operating flows sitting next to investing flows, no subtotals,
 * and no way to answer the two questions anybody actually asks — did the
 * BUILDINGS make money this year, and did the FIRM?
 *
 * Those are different questions and the difference is the entire craft. A
 * portfolio can throw off eleven million of property cash flow and still burn
 * cash, because development ate fourteen. A year that looks catastrophic on
 * the bottom line can be the best year you have had, because the money went
 * into the ground and comes back as a building. So this reads down, the way a
 * statement reads, with the subtotals that separate the two.
 */
function IncomeStatement() {
  const game = useStore((s) => s.game)!;
  const books = game.books ?? [];
  const [yr, setYr] = useState<number | null>(null);
  if (!books.length) return null;
  const cur = books.find((b) => b.yr === yr) ?? books[books.length - 1];
  const prior = books.find((b) => b.yr === cur.yr - 1);
  const partial = cur.yr === Math.floor(game.month / 12) && game.month % 12 !== 0;
  const monthsIn = partial ? game.month % 12 : 12;

  const opCf = (b: typeof cur) => b.noi - b.leasing - b.capex - b.ga;
  const afterDebt = (b: typeof cur) => opCf(b) - b.debtSvc + (b.interest ?? 0);
  const investing = (b: typeof cur) => b.sold - b.bought - b.dev;
  const bottom = (b: typeof cur) => afterDebt(b) + investing(b) - b.taxes;

  const L = ({ k, v, sub, strong, rule, note }: {
    k: string; v: number; sub?: boolean; strong?: boolean; rule?: boolean; note?: string;
  }) => (
    <tr className={rule ? "is-rule" : undefined}>
      <td style={{ paddingLeft: sub ? 22 : 0, fontWeight: strong ? 600 : undefined }}>
        {k}{note && <span className="dim" style={{ fontWeight: 400 }}> · {note}</span>}
      </td>
      <td className={"num" + (v < 0 ? " neg" : "") + (strong ? " is-strong" : "")}>
        {v === 0 ? "—" : (v < 0 ? "(" : "") + usd(Math.abs(v)) + (v < 0 ? ")" : "")}
      </td>
      <td className="num dim">
        {prior ? (() => {
          const pv = ({
            "Net operating income": prior.noi, "Leasing costs": -prior.leasing,
            "Capital expenditure": -prior.capex, "Firm overhead": -prior.ga,
            "Property cash flow": opCf(prior), "Debt service": -prior.debtSvc,
            "Interest on cash": prior.interest ?? 0, "Cash flow after debt": afterDebt(prior),
            "Development": -prior.dev, "Acquisitions": -prior.bought,
            "Disposition proceeds": prior.sold, "Taxes": -prior.taxes,
            "Change in cash": bottom(prior),
          } as Record<string, number>)[k];
          if (pv === undefined) return "";
          if (pv === 0) return v === 0 ? "" : "new";
          const d = (v - pv) / Math.abs(pv);
          return (d >= 0 ? "+" : "") + (d * 100).toFixed(0) + "%";
        })() : ""}
      </td>
    </tr>
  );

  return (
    <div className="page-section">
      <div className="page-section-head">
        Income statement · {2000 + cur.yr}{partial && ` · ${monthsIn} month${monthsIn === 1 ? "" : "s"} in, not a full year`}
      </div>
      <div className="hint">
        The buildings and the firm are two different businesses. Everything above <em>property cash flow</em> is
        what the portfolio produced; everything below it is what you did with the money. A year with a terrible
        bottom line and a strong property line is a year you spent building — which is the good kind of terrible.
      </div>
      <div className="btn-row">
        {books.slice(-8).map((b) => (
          <button key={b.yr} className={"btn btn-sm" + (b.yr === cur.yr ? " btn-on" : "")} onClick={() => setYr(b.yr)}>
            {2000 + b.yr}
          </button>
        ))}
      </div>
      <table className="tbl tbl-stmt">
        <thead>
          <tr><th>{2000 + cur.yr}</th><th className="num">Amount</th><th className="num">vs {prior ? 1999 + cur.yr : "—"}</th></tr>
        </thead>
        <tbody>
          <L k="Net operating income" v={cur.noi} note="rent collected, less operating costs and property tax" />
          <L k="Leasing costs" v={-cur.leasing} sub note="fit-out and commissions" />
          <L k="Capital expenditure" v={-cur.capex} sub note="roofs, systems, make-ready" />
          <L k="Firm overhead" v={-cur.ga} sub note="asset management, accounting, legal" />
          <L k="Property cash flow" v={opCf(cur)} strong rule />
          <L k="Debt service" v={-cur.debtSvc} sub note="interest, amortisation, fees" />
          <L k="Interest on cash" v={cur.interest ?? 0} sub note="1.0% on idle balances" />
          <L k="Cash flow after debt" v={afterDebt(cur)} strong rule />
          <L k="Development" v={-cur.dev} sub note="equity into the ground, construction carry, overruns" />
          <L k="Acquisitions" v={-cur.bought} sub note="equity out the door at closing" />
          <L k="Disposition proceeds" v={cur.sold} sub note="net of loan payoff and penalties" />
          <L k="Taxes" v={-cur.taxes} sub note="income and capital gains" />
          <L k="Change in cash" v={bottom(cur)} strong rule />
        </tbody>
      </table>
      <div className="hint">
        {(() => {
          const p = opCf(cur), a = afterDebt(cur), b = bottom(cur);
          const cover = cur.debtSvc > 0 ? (cur.noi / cur.debtSvc) : null;
          const parts: string[] = [];
          if (p <= 0) parts.push("The portfolio did not cover its own operating costs this year — before a dollar of debt service. That is an occupancy problem or an expense problem, and neither is fixed by borrowing.");
          else if (a < 0 && p > 0) parts.push("The buildings made money and the debt took more than they made. Every month of this comes out of cash or out of the line.");
          else if (a > 0) parts.push(`The portfolio covered its debt with ${usd(a)} to spare.`);
          if (cover !== null) parts.push(`Portfolio coverage ran ${cover.toFixed(2)}× — NOI over debt service, across everything you own.`);
          if (cur.dev > 0 && b < 0 && a > 0) parts.push(`Cash fell because ${usd(cur.dev)} went into construction. That is not a loss; it is a building that is not finished.`);
          if (cur.taxes > 0 && cur.sold > 0) parts.push(`${usd(cur.taxes)} of tax against ${usd(cur.sold)} of disposals — the price of selling rather than exchanging.`);
          return parts.join(" ");
        })()}
      </div>
    </div>
  );
}

function Big({ label, value, bad, title }: { label: string; value: string; bad?: boolean; title?: string }) {
  return (
    <div className="big-stat" title={title}>
      <div className="big-label">{label}</div>
      <div className={"big-value mono" + (bad ? " v-bad" : "")}>{value}</div>
    </div>
  );
}

// Why a corner is getting better, in the terms a principal actually thinks in:
// how many people work here, how many live here, how much of it is open to the
// street — and which of the three is missing. The demand number on the card is
// downstream of exactly these; nothing here is decoration.
// The engine probes the block with a test floorplate of each use and reports
// which one moves it most, so the copy says exactly that — a marginal claim,
// not an assertion about what the block does or doesn't have.
const WANTS_LABEL: Record<string, string> = {
  office: "Per square foot, offices would lift this block further than any other use.",
  industrial: "Per square foot, industrial would lift this block further than any other use.",
  multifamily: "Per square foot, housing would lift this block further than any other use.",
  retail: "Per square foot, retail would lift this block further than any other use.",
  mixed: "Per square foot, mixed use would lift this block further than any other use.",
};
function Neighbourhood({ bbl, block }: { bbl: string; block: string }) {
  const game = useStore((s) => s.game);
  const parcels = useStore((s) => s.parcels);
  if (!game || !parcels) return null;
  const r = blockReport(game, parcels, block);
  if (!r) return null;
  const n = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v));
  const moved = Math.abs(r.drift) >= 0.5;
  return (
    <div className="deal" key={bbl}>
      <div className="deal-head">The neighbourhood · within a five-minute walk</div>
      <div className="grid">
        <Row k="Jobs" v={n(r.jobs)} />
        <Row k="Residents" v={n(r.residents)} />
        <Row k="Storefront" v={sf(r.amenitySf)} />
        <Row
          k="Since 2000"
          v={moved ? `${r.drift > 0 ? "+" : ""}${r.drift.toFixed(0)} demand` : "unchanged"}
          strong={r.drift > 0.5}
          bad={r.drift < -0.5}
        />
        <Row
          k="Hiring"
          v={Math.abs(r.hiring) < 0.5 ? "in line with the city" : `${r.hiring > 0 ? "+" : ""}${r.hiring.toFixed(0)} demand`}
          strong={r.hiring > 0.5}
          bad={r.hiring < -0.5}
        />
        <Row k="The work here" v={r.trades.map((t) => `${Math.round(t.share * 100)}% ${t.label.toLowerCase()}`).join(", ")} />
        {r.line ? (
          <Row
            k="Transit"
            v={r.line.monthsOut > 0
              ? `${r.line.name} station, ${Math.max(1, Math.round(r.line.monthsOut / 12))} yrs out`
              : `${r.line.name} station, open`}
            strong
          />
        ) : null}
      </div>
      <div className="deal-note">
        {r.balanced
          ? "Jobs, housing and street life are in balance here — every added foot compounds."
          : WANTS_LABEL[r.wants]}
      </div>
    </div>
  );
}

function Row({ k, v, strong, bad, title }: { k: string; v: string; strong?: boolean; bad?: boolean; title?: string }) {
  return (
    <>
      <div className="k" title={title}>{k}</div>
      <div className={"v mono" + (strong ? " v-strong" : "") + (bad ? " v-bad" : "")} title={title}>{v}</div>
    </>
  );
}
