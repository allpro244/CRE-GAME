// The game's chrome: a parcel card docked to the map, and full-page views
// for Portfolio / Deals / Market — big rooms, not side-panel squints.
import { useEffect, useState } from "react";
import { useStore } from "@/state/store";
import { CLASS_COLOR, CLASS_LABEL } from "@/data/types";
import { monthLabel, CREDIT_LABEL } from "@/engine/types";
import {
  assetValue, initialCondition, holdingValue, marketRentPsfYr, managedRentPsfYr,
  occupancy, noiYr, holdingNOIYr, renovationCost, resolveRec, appraise, propertyTaxYr,
  rollQualitySpread, operatingStatement, recoveryOf,
} from "@/engine/value";
import { planDevelopment, PROGRAMS, programCost, farMaxFor, maxFloorsFor, demolitionCost } from "@/engine/dev";
import type { BuiltClass } from "@/engine/types";
import { buyQuote, assemblagePressure, saleTaxQuote, bidOdds } from "@/engine/actions";
import { MILESTONES } from "@/engine/sim";
import { isCommercial, vacantSf, walt, loiSigningCost, notReadySf, unitStatus, unitCount, suiteSf } from "@/engine/leasing";
import { dscr, ltv, rateCapCost, refiQuotes, PRODUCTS, prepayPenalty } from "@/engine/debt";
import { locLimit, locRate, locAvailable } from "@/engine/credit";
import { usd, sf, pct } from "./format";
import Slider from "./Slider";

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
    : page === "leasing" ? "Leasing & Occupancy"
    : page === "property" ? "Property"
    : "The Market";
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
            {page === "books" && <BooksPage />}
            {page === "leasing" && <LeasingPage />}
            {page === "property" && <PropertyPage />}
          </div>
        </div>
      )}
      <DecisionModal />
      {game.gameOver && <GameOverPage />}
    </>
  );
}

// Some decisions don't wait their turn. A letter of intent and a live offer
// on your building both take the screen until you answer — they expire, and
// finding out later that one lapsed while you clicked past it is no fun.
function DecisionModal() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels);
  const { respondLoi, acceptOffer, declineOffer } = useStore.getState();
  const [deferred, setDeferred] = useState<Set<number>>(new Set());
  if (!parcels || game.gameOver) return null;

  const loi = game.agent ? undefined : game.lois.find((l) => !deferred.has(l.id));
  const offerBbl = deferred.has(-1) ? undefined : Object.keys(game.holdings).find((b) => game.holdings[b].sale?.offer);
  if (!loi && !offerBbl) return null;

  if (loi) {
    const rec = resolveRec(parcels, game, loi.bbl);
    const h = game.holdings[loi.bbl];
    if (!rec || !h) return null;
    const market = managedRentPsfYr(rec, game.econ, h);
    const cost = loiSigningCost(loi);
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
    return (
      <div className="modal-backdrop">
        <div className="modal">
          <div className="modal-kicker">{loi.kind === "renewal" ? "Renewal on the table" : "Letter of intent"}</div>
          <div className="modal-title">{loi.name}</div>
          <div className="modal-sub">
            {loi.sector} · credit {CREDIT_LABEL[loi.credit]} · wants {sf(loi.sf)} at {rec.address}
          </div>
          <div className="grid">
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
            <button className="btn" title="+6% rent, −30% TI. They may walk." onClick={() => act("counter")}>
              Counter
            </button>
            <button className="btn" onClick={() => act("decline")}>Pass</button>
            <button
              className="btn"
              title="Leave it on the desk and get back to it — it stays on the Deals page until it expires."
              onClick={() => setDeferred((d) => new Set(d).add(loi.id))}
            >
              Decide later
            </button>
          </div>
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
  const over = game.gameOver!;
  const peak = Math.max(...game.nwHistory);
  const finalNw = game.nwHistory[game.nwHistory.length - 1] ?? 0;
  const realized = game.exits.reduce((a, e) => a + e.gain, 0);
  const miles = Object.keys(game.milestones ?? {}).length;
  return (
    <div className="page-backdrop">
      <div className="page gameover-page">
        <div className="page-title">{over.complete ? "A Century of Ashport" : "The run is over."}</div>
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
        <button className="btn btn-buy" style={{ marginTop: 16 }} onClick={() => useStore.getState().newRun()}>Start a new run</button>
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
function ParcelPanel({ embedded = false }: { embedded?: boolean } = {}) {
  const parcels = useStore((s) => s.parcels);
  const adjacency = useStore((s) => s.adjacency);
  const selectedBBL = useStore((s) => s.selectedBBL);
  const select = useStore((s) => s.select);
  const game = useStore((s) => s.game)!;
  const { renovate, approach } = useStore.getState();

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

      <div className="chip-row">
        <span className="chip" style={{ background: CLASS_COLOR[rec.class] }}>{CLASS_LABEL[rec.class]}</span>
        <span className="chip chip-zone mono">{rec.zoneDist}</span>
        {holding && <span className="chip chip-owned">OWNED</span>}
        {dev && <span className="chip chip-reno">UNDER CONSTRUCTION</span>}
        {listing && !holding && <span className="chip chip-listed">FOR SALE</span>}
        {listing?.distress && !holding && <span className="chip chip-distress">MOTIVATED SELLER</span>}
        {holding?.sale && <span className="chip chip-listed">LISTED · {usd(holding.sale.ask)}</span>}
        {renovating && <span className="chip chip-reno">RENOVATING</span>}
        {holding?.loan?.sweep && <span className="chip chip-sweep">CASH SWEEP</span>}
      </div>

      <div className="grid">
        <Row k="Appraisal" v={band(selectedBBL, value)} strong />
        {isBuilt && <Row k="Market rent" v={"$" + marketRentPsfYr(rec, game.econ, cond).toFixed(0) + " /sf/yr"} />}
        {isBuilt && !holding && <Row k="Occupancy (mkt)" v={(occupancy(rec, game.econ) * 100).toFixed(0) + "%"} />}
        {isBuilt && !holding && <Row k="Leasable spaces" v={`${unitCount(rec)} · ${sf(Math.round(suiteSf(rec)))} each`} />}
        {holding && commercial && <Row k="Occupancy" v={rec.bldgArea ? ((leasedSf / rec.bldgArea) * 100).toFixed(0) + "%" : "—"} />}
        {holding && rec.bldgArea > 0 && (() => {
          const u = unitStatus(rec, holding, game.month);
          return <Row k="Spaces leased" v={`${u.leased} of ${u.total} · ${sf(Math.round(u.sfPer))} each`} bad={u.leased < u.total * 0.6} />;
        })()}
        {holding && rec.class === "multifamily" && <Row k="Occupancy" v={((holding.occ ?? 0) * 100).toFixed(0) + "%"} />}
        {holding && commercial && <Row k="WALT" v={walt(holding, game.month).toFixed(1) + " yrs"} />}
        {isBuilt && <Row k="NOI / yr" v={usd(holding ? holdingNOIYr(rec, game.econ, holding, game.month) : noiYr(rec, game.econ, cond))} />}
        {holding && isBuilt && <Row k="Property tax / yr" v={usd(propertyTaxYr(rec, holding)) + (commercial ? " (your share)" : "")} />}
        <Row k="Lot area" v={sf(rec.lotArea)} />
        {isBuilt && <Row k="Building" v={sf(rec.bldgArea) + ` · ${rec.floors} fl · ${rec.yearBuilt}`} />}
        <Row k="FAR built / max" v={`${builtFar.toFixed(1)} / ${farMax.toFixed(1)}`} />
        <Row k="Demand" v={String(rec.demandScore) + " / 100"} />
      </div>

      {holding && commercial && holding.tenants.length > 0 && (
        <div className="deal">
          <div className="deal-head">Rent roll · {sf(leasedSf)} of {sf(rec.bldgArea)}</div>
          <div className="roll">
            {holding.tenants.map((t, i) => (
              <div key={i} className="roll-row">
                <span className="roll-name">{t.name} <span className="roll-credit mono">{CREDIT_LABEL[t.credit]}</span></span>
                <span className="roll-meta mono">
                  {(t.sf / 1000).toFixed(1)}k sf · ${t.rentPsf.toFixed(0)} {t.net ? "NNN" : "G"} · exp {monthLabel(t.endM)}
                </span>
              </div>
            ))}
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

      {holding?.loan && (
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
            {holding.loan.cap && <Row k="Rate cap" v={`index ≤ ${holding.loan.cap.strike.toFixed(2)}% until ${monthLabel(holding.loan.cap.expiresM)}`} />}
          </div>
          <div className="btn-row">
            {(holding.loan.floating ?? holding.loan.product === "float") && !holding.loan.cap && (
              <button
                className="btn"
                title={`Index capped at ${(game.econ.indexRate + 0.5).toFixed(2)}% for 3 years`}
                onClick={() => useStore.getState().rateCap(selectedBBL)}
              >
                Buy rate cap · {usd(rateCapCost(holding.loan))}
              </button>
            )}
          </div>
          <RefiSection bbl={selectedBBL} />
        </div>
      )}

      {listing && !holding && (
        <div className="deal">
          <div className="deal-head">On the market</div>
          <div className="grid">
            <Row k="Ask" v={usd(listing.ask)} strong />
            {isBuilt && <Row k="NOI / yr" v={usd(noiYr(rec, game.econ, cond))} />}
            {isBuilt && <Row k="Cap rate at ask" v={((noiYr(rec, game.econ, cond) / listing.ask) * 100).toFixed(2) + "%"} strong />}
            {isBuilt && <Row k="Occupancy" v={(occupancy(rec, game.econ) * 100).toFixed(0) + "%"} />}
            {!isBuilt && <Row k="Land" v={"$" + (listing.ask / rec.lotArea).toFixed(0) + " /sf of lot"} />}
          </div>
          <BuyButtons bbl={selectedBBL} price={listing.ask} off={false} />
        </div>
      )}

      {!listing && !holding && (
        <div className="deal">
          <div className="deal-head">Off-market</div>
          {appr && !appr.refused && appr.ask ? (
            <>
              <div className="grid">
                <Row k="Owner's ask" v={usd(appr.ask)} strong />
                <Row k="vs. appraisal" v={((appr.ask / apMid(selectedBBL, value) - 1) * 100).toFixed(1) + "%"} />
                <Row k="Good until" v={monthLabel(appr.q + 6)} />
              </div>
              <BuyButtons bbl={selectedBBL} price={appr.ask} off />
              {!appr.countered && (
                <div className="btn-row">
                  <button
                    className="btn"
                    title="Come back 12% under their number. They take it, hold firm, or hang up — one shot."
                    onClick={() => useStore.getState().counterOff(selectedBBL)}
                  >
                    Counter · {usd(appr.ask * 0.88)}
                  </button>
                </div>
              )}
            </>
          ) : appr && appr.refused ? (
            <div className="hint">The owner turned you away in {monthLabel(appr.q)}. Try again after {monthLabel(appr.q + 6)}.</div>
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

      {holding && dev && (
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

      {holding && !dev && rec.class === "land" && <DevelopSection bbl={selectedBBL} />}

      {holding && isBuilt && !renovating && (
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
                title="A leasing exclusive: ~75% more tenant traffic while space is vacant, for a monthly retainer"
                onClick={() => useStore.getState().broker(selectedBBL, !holding.broker)}
              >
                {holding.broker
                  ? "✓ Broker engaged — dismiss"
                  : `Hire leasing broker · ${usd(Math.max(400, Math.round(vacantSf(rec, holding) * 0.025)))}/mo`}
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
          {isBuilt && (
            <div className="btn-row">
              <button
                className="btn btn-sell"
                title="Clear the site back to dirt so you can rebuild to the full envelope. Needs the building under 20% leased."
                onClick={() => { if (window.confirm(`Demolish ${rec.address}? The site goes back to vacant land.`)) useStore.getState().raze(selectedBBL); }}
              >
                Demolish · {usd(demolitionCost(rec, game))}
              </button>
            </div>
          )}
        </div>
      )}

      {holding && <SaleSection bbl={selectedBBL} value={value} />}

      {holding && (
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

      <div className="neighbors">
        <div className="neighbors-head">Adjoining lots · {neighbors.length}</div>
        <div className="neighbors-list">
          {neighbors.map((n) => {
            const nr = parcels[n];
            return (
              <button key={n} className="neighbor" onClick={() => select(n)}>
                <span className="neighbor-addr">{game.holdings[n] ? "◆ " : ""}{nr?.address ?? n}</span>
                <span className="neighbor-meta mono">
                  {nr ? `${nr.lotArea.toLocaleString()} sf · ${CLASS_LABEL[nr.class]}` : ""}
                </span>
              </button>
            );
          })}
          {neighbors.length === 0 && <div className="neighbor-none">No shared lot lines on record.</div>}
        </div>
      </div>
    </div>
  );
}

function SaleSection({ bbl, value }: { bbl: string; value: number }) {
  const game = useStore((s) => s.game)!;
  const { listSale, delistSale, acceptOffer, declineOffer } = useStore.getState();
  const holding = game.holdings[bbl]!;
  const [ask, setAsk] = useState<string>("");
  const sale = holding.sale;
  const exchangeBusy = !!game.exchange;
  if (sale) {
    const tq = sale.offer ? saleTaxQuote(holding, sale.offer.price) : null;
    return (
      <div className="deal">
        <div className="deal-head">For sale · listed {monthLabel(sale.listedM)}</div>
        <div className="grid">
          <Row k="Your ask" v={usd(sale.ask)} strong />
          <Row k="vs. appraisal" v={((sale.ask / apMid(bbl, value) - 1) * 100).toFixed(1) + "%"} />
        </div>
        {sale.offer && tq ? (
          <>
            <div className="hint">
              Offer on the table: <b className="mono">{usd(sale.offer.price)}</b> — good until {monthLabel(sale.offer.expiresM)}.
              {tq.tax > 0 && <> Gain of {usd(tq.gain)} over depreciated basis owes <b className="mono">{usd(tq.tax)}</b> in tax.</>}
            </div>
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
          </>
        ) : (
          <div className="hint">No offers yet. Overpriced listings sit; the market talks back slowly.</div>
        )}
        <div className="btn-row">
          <button className="btn btn-sell" onClick={() => delistSale(bbl)}>Delist</button>
        </div>
      </div>
    );
  }
  const mid = apMid(bbl, value);
  const askNum = parseFloat(ask);
  const price = Number.isFinite(askNum) ? askNum : mid;
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
      <div className="btn-row">
        <button className="btn btn-buy" onClick={() => listSale(bbl, price)}>List at {usd(price)}</button>
      </div>
    </div>
  );
}

// Leverage is a dial, not three buttons: slide from all-cash to whatever the
// lender will actually fund, and watch the equity cheque and the coverage
// move together.
function BuyButtons({ bbl, price, off }: { bbl: string; price: number; off: boolean }) {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const { buy, buyOff } = useStore.getState();
  const act = off ? buyOff : buy;
  const isLand = parcels[bbl]?.class === "land";
  const [product, setProduct] = useState<string>(isLand ? "land" : "agency");
  const [lev, setLev] = useState(1);
  // The dial runs on a fraction of the ask, not on dollars: a dollar-valued
  // range with a rounded step can leave the top end unreachable, which meant
  // you could not simply pay the asking price.
  const [bidFrac, setBidFrac] = useState(1);
  const offerPrice = Math.round(price * Math.min(1, bidFrac));
  const max = buyQuote(game, parcels, bbl, offerPrice, product, 1);
  const principal = Math.round(max.principal * lev);
  const equity = offerPrice - principal + Math.round(offerPrice * 0.02);
  const rec = parcels[bbl];
  const noi = rec ? noiYr(rec, game.econ, initialCondition(rec)) : 0;
  const annualDs = principal > 0 ? principal * (max.ratePct / 100) : 0;
  const dscrNow = annualDs > 0 ? noi / annualDs : null;
  const listing = game.listings.find((l) => l.bbl === bbl);
  // how likely the seller is to take it, quoted honestly before you spend the try
  const odds = offerPrice >= price ? 1
    : off ? Math.max(0.02, Math.min(0.9, 0.92 - (1 - offerPrice / price) * 11.0 + (game.econ.phase === "recession" ? 0.12 : 0)))
    : bidOdds(game, { ask: price, distress: listing?.distress }, offerPrice);
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
        hint={offerPrice >= price
          ? "At the ask, it's yours."
          : `${Math.round(odds * 100)}% they take it${off ? " — an owner who wasn't selling bends hard" : ""}. Push too far and they walk.`}
      />
      <div className="btn-row" style={{ marginTop: 8 }}>
        {/* dirt has its own desk; income paper won't look at a vacant lot */}
        {PRODUCTS.filter((p) => !p.mezz && (isLand ? p.id === "land" : p.id !== "land")).map((p) => (
          <button key={p.id} className={"btn" + (product === p.id ? " btn-on" : "")} title={p.blurb} onClick={() => setProduct(p.id)}>
            {p.label}
          </button>
        ))}
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
      ) : (
        <div className="hint">{product === "cash" ? "Buying it outright." : "No lender will size a loan against this income — all cash or nothing."}</div>
      )}
      <div className="grid">
        <Row k="Equity to close" v={usd(equity)} strong bad={equity > game.cash} />
      </div>
      <div className="btn-row">
        <button
          className="btn btn-buy"
          disabled={equity > game.cash}
          onClick={() => act(bbl, principal <= 0 ? "cash" : product, principal <= 0 ? undefined : lev, offerPrice)}
        >
          {offerPrice >= price ? "Buy at the ask" : `Offer ${usd(offerPrice)}`} · eq {usd(equity)}
        </button>
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
  const [product, setProduct] = useState<string>("agency");
  const [lev, setLev] = useState(1);
  const { quotes, value, payoff } = refiQuotes(game, parcels, bbl);
  if (!quotes.length) return null;
  const q = quotes.find((x) => x.id === product) ?? quotes[0];
  const cur = game.holdings[bbl]?.loan;
  const existing = cur ? prepayPenalty(cur, game.month) : 0;
  const proceeds = Math.round(q.maxProceeds * lev);
  const fee = Math.round(Math.max(proceeds, payoff) * 0.01) + Math.round(proceeds * q.points) + existing;
  const toYou = proceeds - payoff - fee;
  const annualDs = q.ioM > 0 ? (proceeds * q.ratePct) / 100 : proceeds * (q.ratePct / 100) * 1.28;
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
      <div className="grid">
        <Row k="Lender's maximum" v={`${usd(q.maxProceeds)} · ${(q.ltvAtMax * 100).toFixed(0)}% LTV`} />
        <Row k="Coverage / debt yield" v={`DSCR ${q.dscrAtMax.toFixed(2)} · DY ${(q.debtYieldAtMax * 100).toFixed(1)}%`} />
        <Row k="What caps it" v={q.binding} bad={q.binding === "debt yield"} />
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

function DevelopSection({ bbl }: { bbl: string }) {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const rec = parcels[bbl];
  const [use, setUse] = useState<BuiltClass>("office");
  const [cov, setCov] = useState(0.6);
  const [floors, setFloors] = useState(8);
  const [preLease, setPreLease] = useState(false);
  const canPreLease = use === "office" || use === "retail" || use === "mixed";
  const maxFl = maxFloorsFor(rec, cov);
  const fl = Math.min(floors, maxFl);
  const plan = planDevelopment(game, parcels, bbl, use, fl, cov, preLease && canPreLease);
  const USES: BuiltClass[] = ["office", "multifamily", "mixed", "retail", "industrial"];
  return (
    <div className="deal">
      <div className="deal-head">Develop this lot</div>
      <div className="hint">
        {sf(rec.lotArea)} of land · envelope {farMaxFor(rec).toFixed(1)} FAR · anything may be built here.
      </div>
      <div className="btn-row">
        {USES.map((u) => (
          <button key={u} className={"btn" + (use === u ? " btn-on" : "")} onClick={() => setUse(u)}>{CLASS_LABEL[u]}</button>
        ))}
      </div>
      <Slider
        label="Stories"
        value={fl}
        min={1}
        max={maxFl}
        step={1}
        onChange={setFloors}
        format={(v) => `${v} ${v === 1 ? "floor" : "floors"}`}
        marks={[{ at: Math.max(1, Math.round(maxFl * 0.25)), label: "low" }, { at: Math.max(1, Math.round(maxFl * 0.6)), label: "mid" }, { at: maxFl, label: `max ${maxFl}` }]}
        hint={plan ? `${sf(plan.sf)} of building at ${plan.far} FAR (envelope ${plan.farMax.toFixed(1)})` : undefined}
      />
      <Slider
        label="Footprint"
        value={cov}
        min={0.08}
        max={0.9}
        step={0.01}
        onChange={(v) => { setCov(v); setFloors((f) => Math.min(f, maxFloorsFor(rec, v))); }}
        format={(v) => `${Math.round(v * 100)}% of the lot · ${sf(rec.lotArea * v)} plate`}
        marks={[{ at: 0.15, label: "corner" }, { at: 0.35, label: "tower" }, { at: 0.6, label: "block" }, { at: 0.85, label: "podium" }]}
        hint={`A slim tower goes higher on the same envelope; a fat podium runs out of FAR sooner (max ${maxFl} floors at this footprint). On a big site you can put up something small and keep the rest of the land.`}
      />
      {canPreLease && (
        <div className="btn-row">
          <button
            className={"btn" + (preLease ? " btn-on" : "")}
            title="Land a credit anchor for 35% of the building before ground-break: +3 months, but lenders fund 65% of cost instead of 45%"
            onClick={() => setPreLease(!preLease)}
          >
            {preLease ? "✓ Anchor pre-lease" : "Secure anchor pre-lease first"}
          </button>
        </div>
      )}
      {plan ? (
        <>
          <div className="grid" style={{ marginTop: 8 }}>
            <Row k="Building" v={`${sf(plan.sf)} · ${plan.floors} fl · ${(plan.floors * 3.4).toFixed(0)} m tall`} strong />
            <Row k="FAR used" v={`${plan.far} of ${plan.farMax.toFixed(1)}`} />
            <Row k="All-in cost" v={usd(plan.costTotal)} />
            <Row k="Cost / sf" v={"$" + (plan.costTotal / Math.max(1, plan.sf)).toFixed(0)} />
            <Row
              k={`Constr. loan (${Math.round((plan.loanAmount / Math.max(1, plan.costTotal)) * 100)}%)`}
              v={plan.loanAmount > 0 ? usd(plan.loanAmount) + " @ " + pct(plan.ratePct) : "none — all equity"}
            />
            <Row k="Your equity" v={usd(plan.equity)} strong bad={plan.equity > game.cash} />
            <Row k="Schedule" v={plan.months + " months"} />
            {plan.preLease && <Row k="Pre-leased" v={`${sf(plan.sf * 0.35)} anchor at delivery`} />}
          </div>
          {plan.lenderNote && <div className="hint">{plan.lenderNote}</div>}
          <div className="btn-row">
            <button
              className="btn btn-buy"
              disabled={plan.equity > game.cash}
              onClick={() => useStore.getState().develop(bbl, use, fl, cov, preLease && canPreLease)}
            >
              Break ground · {usd(plan.equity)}
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
  const bbl = useStore((s) => s.selectedBBL);
  if (!bbl) return <div className="hint">Nothing selected.</div>;
  const rec = resolveRec(parcels, game, bbl);
  if (!rec) return <div className="hint">Unknown parcel.</div>;
  const h = game.holdings[bbl];
  const cond = h?.condition ?? initialCondition(rec);
  const value = h ? holdingValue(rec, game.econ, h, game.month) : assetValue(rec, game.econ, cond);
  const built = rec.class !== "land" && rec.bldgArea > 0;
  const commercial = isCommercial(rec);
  const leased = h && commercial ? h.tenants.reduce((a, t) => a + t.sf, 0) : 0;
  const occ = h ? (rec.class === "multifamily" ? (h.occ ?? 0) : rec.bldgArea ? leased / rec.bldgArea : 0) : occupancy(rec, game.econ);
  const noi = built ? (h ? holdingNOIYr(rec, game.econ, h, game.month) : noiYr(rec, game.econ, cond)) : 0;
  const dsYr = (h?.loan?.monthlyPmt ?? 0) * 12;
  const dev = game.developments[bbl];
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
            value={`${rollQualitySpread(rec, h, game.month) >= 0 ? "+" : ""}${(rollQualitySpread(rec, h, game.month) * 100).toFixed(0)} bps`}
            bad={rollQualitySpread(rec, h, game.month) > 0.15}
          />
        )}
        <Big label="Equity" value={h ? usd(value - (h.loan?.balance ?? 0)) : "—"} />
      </div>
      <div className="prop-head">
        <div>
          <div className="page-title" style={{ fontSize: 22 }}>{rec.address}</div>
          <div className="panel-bbl mono">Parcel {rec.bbl} · {CLASS_LABEL[rec.class]} · {rec.zoneDist}</div>
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
      {dev && (
        <div className="page-section">
          <div className="page-section-head">Under construction</div>
          <div className="grid">
            <Row k="Program" v={`${sf(dev.sf)} of ${dev.use} · ${dev.floors} floors`} strong />
            <Row k="Budget" v={usd(dev.costTotal)} />
            <Row k="Delivers" v={monthLabel(dev.deliverM)} />
          </div>
        </div>
      )}
      <div className="prop-cols">
        <ParcelPanel embedded />
      </div>
    </div>
  );
}


function PortfolioPage() {
  const parcels = useStore((s) => s.parcels)!;
  const game = useStore((s) => s.game)!;
  const select = useStore((s) => s.select);
  const setPage = useStore((s) => s.setPage);
  const holdings = Object.values(game.holdings);
  const go = (bbl: string) => { select(bbl); setPage("property"); };
  if (!holdings.length && !Object.keys(game.developments).length) {
    return <div className="hint">You own nothing yet. The Market page has the tape; the map has everything else.</div>;
  }
  let totV = 0, totD = 0, totCF = 0;
  const rows = holdings.map((h) => {
    const rec = resolveRec(parcels, game, h.bbl);
    const v = rec ? holdingValue(rec, game.econ, h, game.month) : 0;
    const cf = rec ? holdingNOIYr(rec, game.econ, h, game.month) / 12 - (h.loan?.monthlyPmt ?? 0) : 0;
    const occ = rec
      ? rec.class === "multifamily" ? (h.occ ?? 0)
        : rec.bldgArea ? h.tenants.reduce((a, t) => a + t.sf, 0) / rec.bldgArea : 0
      : 0;
    totV += v; totD += h.loan?.balance ?? 0; totCF += cf;
    return { h, rec, v, cf, occ };
  }).sort((a, b) => b.v - a.v);
  return (
    <div>
      <div className="stat-strip">
        <Big label="Assets" value={usd(totV)} />
        <Big label="Debt" value={usd(totD)} />
        <Big label="Equity" value={usd(totV - totD)} />
        <Big label="Cash flow / mo" value={usd(totCF)} bad={totCF < 0} />
        <Big label="Buildings" value={String(holdings.length)} />
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>Property</th><th>Class</th><th className="num">Spaces</th><th className="num">Occ</th><th className="num">NOI / yr</th>
            <th className="num">Value</th><th className="num">Debt</th><th className="num">Equity</th>
            <th className="num">Debt svc / mo</th><th className="num">CF / mo</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ h, rec, v, cf, occ }) => (
            <tr key={h.bbl} onClick={() => go(h.bbl)}>
              <td>{rec?.address ?? h.bbl}</td>
              <td>{rec ? CLASS_LABEL[rec.class] : "—"}</td>
              <td className="num">{rec && rec.bldgArea ? (() => { const u = unitStatus(rec, h, game.month); return `${u.leased} / ${u.total}`; })() : "—"}</td>
              <td className="num">{rec?.class === "land" ? "—" : (occ * 100).toFixed(0) + "%"}</td>
              <td className="num">{rec ? usd(holdingNOIYr(rec, game.econ, h, game.month)) : "—"}</td>
              <td className="num">{usd(v)}</td>
              <td className="num">{usd(h.loan?.balance ?? 0)}</td>
              <td className="num">{usd(v - (h.loan?.balance ?? 0))}</td>
              <td className="num">{h.loan ? "−" + usd(h.loan.monthlyPmt) : "—"}</td>
              <td className={"num" + (cf < 0 ? " neg" : "")}>{usd(cf)}</td>
              <td className="dim">
                {[h.loan?.sweep ? "SWEEP" : null, h.sale ? "LISTED" : null,
                  h.renovatingUntilM !== undefined && game.month < h.renovatingUntilM ? "RENO" : null,
                  h.program ? "CAPEX" : null].filter(Boolean).join(" · ")}
              </td>
            </tr>
          ))}
          {Object.values(game.developments).map((dv) => (
            <tr key={dv.bbl} onClick={() => go(dv.bbl)}>
              <td>{parcels[dv.bbl]?.address ?? dv.bbl}</td>
              <td>{CLASS_LABEL[dv.use]}</td>
              <td className="num">—</td>
              <td className="num">—</td>
              <td className="num">—</td>
              <td className="num">{usd(dv.costTotal)}</td>
              <td className="num">{usd(dv.loanBalance)}</td>
              <td className="num">{usd(dv.costTotal - dv.loanBalance)}</td>
              <td className="num">—</td>
              <td className="num neg">{usd(-(dv.loanBalance * dv.ratePct) / 100 / 12)}</td>
              <td className="dim">BUILDING · delivers {monthLabel(dv.deliverM)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DealsPage() {
  const parcels = useStore((s) => s.parcels)!;
  const game = useStore((s) => s.game)!;
  const select = useStore((s) => s.select);
  const setPage = useStore((s) => s.setPage);
  const { respondLoi, acceptOffer, declineOffer } = useStore.getState();
  const q = game.month;
  const go = (bbl: string) => { setPage("none"); select(bbl); };

  const expiring: { bbl: string; name: string; sf: number; endM: number }[] = [];
  const maturities: { bbl: string; matM: number; bal: number; sweep: boolean }[] = [];
  const sales: { bbl: string; ask: number; offer?: { price: number; expiresM: number } }[] = [];
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
        <div className="page-section">Letters of intent · {game.lois.length}</div>
        {game.lois.length === 0 && <div className="hint">No live negotiations. Vacant space in high-demand buildings draws tenants.</div>}
        <div className="loi-grid">
          {game.lois.map((loi) => {
            const rec = parcels[loi.bbl];
            return (
              <div key={loi.id} className="loi">
                <button className="loi-addr" onClick={() => go(loi.bbl)}>{rec?.address ?? loi.bbl}</button>
                <div className="loi-line">
                  <b>{loi.name}</b> <span className="mono">{CREDIT_LABEL[loi.credit]}</span> · {loi.sector}
                  {loi.kind === "renewal" && <span className="chip chip-renewal">RENEWAL</span>}
                </div>
                <div className="loi-line mono">
                  {(loi.sf / 1000).toFixed(1)}k sf · ${loi.rentPsf.toFixed(0)}/sf {loi.net ? "NNN" : "gross"} · {(loi.termM / 12).toFixed(0)} yrs
                  {loi.tiPsf > 0 && ` · TI $${loi.tiPsf}`}{loi.freeM > 0 && ` · ${loi.freeM}mo free`}
                </div>
                <div className="loi-line mono dim">signing costs {usd(loiSigningCost(loi))} · answer by {monthLabel(loi.expiresM)}</div>
                <div className="btn-row">
                  <button className="btn btn-buy" onClick={() => respondLoi(loi.id, "accept")}>Accept</button>
                  {!loi.countered && <button className="btn" onClick={() => respondLoi(loi.id, "counter")} title="+6% rent, −30% TI — they may walk">Counter</button>}
                  <button className="btn" onClick={() => respondLoi(loi.id, "decline")}>Pass</button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <div className="page-section">Sales in progress · {sales.length}</div>
        {sales.length === 0 && <div className="hint">Nothing listed. Sell from any owned building's card.</div>}
        {sales.map((sl) => (
          <div key={sl.bbl} className="loi">
            <button className="loi-addr" onClick={() => go(sl.bbl)}>{parcels[sl.bbl]?.address}</button>
            <div className="loi-line mono">ask {usd(sl.ask)}</div>
            {sl.offer ? (
              <div className="btn-row">
                <span className="loi-line mono"><b>{usd(sl.offer.price)}</b> offered · until {monthLabel(sl.offer.expiresM)}</span>
                <button className="btn btn-buy" onClick={() => acceptOffer(sl.bbl)}>Accept</button>
                <button className="btn" onClick={() => declineOffer(sl.bbl)}>Decline</button>
              </div>
            ) : (
              <div className="loi-line dim">no offers yet</div>
            )}
          </div>
        ))}

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

function MarketPage() {
  const parcels = useStore((s) => s.parcels)!;
  const game = useStore((s) => s.game)!;
  const select = useStore((s) => s.select);
  const setPage = useStore((s) => s.setPage);
  const e = game.econ;
  const go = (bbl: string) => { setPage("none"); select(bbl); };
  return (
    <div>
      <div className="stat-strip">
        <Big label="Loan index" value={pct(e.indexRate)} />
        <Big label="Phase" value={e.phase + (e.rumoredPhase ? " ⚠" : "")} />
        <Big label="Cap · office" value={pct(e.capRate.office)} />
        <Big label="Cap · multifam" value={pct(e.capRate.multifamily)} />
        <Big label="Office rent" value={"$" + e.rentIdx.office.toFixed(0)} />
        <Big label="Land index" value={e.landIdx.toFixed(2)} />
        <Big label="Cost index" value={e.costIdx.toFixed(2)} />
        <Big label="Credit" value={creditWord(e.creditIdx ?? 1)} bad={(e.creditIdx ?? 1) < 0.72} />
        <Big label="Employment" value={((e.employIdx ?? 1) * 100).toFixed(0)} />
      </div>

      <div className="deals-grid">
        <section style={{ gridColumn: "1 / -1" }}>
          <div className="page-section">The sectors</div>
          <div className="hint">
            Classes do not move together. Momentum is where the sector is heading; the pipeline is what
            everyone <em>else</em> is building, and it lands on the rent about three years from now.
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Sector</th><th className="num">Rent $/sf</th><th className="num">Cap rate</th>
                <th className="num">Momentum</th><th className="num">Under construction</th>
                <th className="num">Delivering</th><th>Read</th>
              </tr>
            </thead>
            <tbody>
              {(["office", "retail", "mixed", "multifamily", "industrial"] as const).map((k) => {
                const mom = e.sectorMom?.[k] ?? 0;
                const pipe = e.pipeline?.[k] ?? 0;
                const press = e.supplyPress?.[k] ?? 0;
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
                    <td className="num">{sf(Math.round(pipe))}</td>
                    <td className="num">{sf(Math.round(pipe / 30))}</td>
                    <td className="dim">{read}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
        <section style={{ gridColumn: "1 / -1" }}>
          <div className="page-section">On the market · {game.listings.length}</div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Property</th><th>Class</th><th className="num">Building</th><th className="num">Ask</th>
                <th className="num">NOI / yr</th><th className="num">Cap rate</th><th className="num">Occupancy</th>
              </tr>
            </thead>
            <tbody>
              {[...game.listings].sort((a, b) => a.ask - b.ask).map((li) => {
                const rec = resolveRec(parcels, game, li.bbl);
                if (!rec) return null;
                const cond = initialCondition(rec);
                const built = rec.class !== "land" && rec.bldgArea > 0;
                const noi = built ? noiYr(rec, game.econ, cond) : 0;
                const goingIn = built && li.ask > 0 ? (noi / li.ask) * 100 : 0;
                return (
                  <tr key={li.bbl} onClick={() => go(li.bbl)}>
                    <td>{li.distress && <span className="chip chip-distress" style={{ marginRight: 6 }}>HOT</span>}{rec.address}</td>
                    <td>{CLASS_LABEL[rec.class]}</td>
                    <td className="num">{built ? sf(rec.bldgArea) : sf(rec.lotArea) + " lot"}</td>
                    <td className="num">{usd(li.ask)}</td>
                    <td className="num">{built ? usd(noi) : "—"}</td>
                    <td className="num">{built ? goingIn.toFixed(2) + "%" : "—"}</td>
                    <td className="num">{built ? (occupancy(rec, game.econ) * 100).toFixed(0) + "%" : "—"}</td>
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

// The revolving line: 35% of net worth at prime + 400bps. It draws itself
// before a shortfall becomes insolvency, and idle cash sweeps against it.
function CreditLine() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const { drawCredit, repayCredit } = useStore.getState();
  const limit = locLimit(game, parcels);
  const balance = game.loc?.balance ?? 0;
  const avail = Math.max(0, limit - balance);
  const rate = locRate(game);
  const [amt, setAmt] = useState(0);
  const room = Math.max(avail, balance);
  return (
    <div className="page-section">
      <div className="page-section-head">Line of credit</div>
      <div className="stat-strip">
        <Big label="Limit · 35% of net worth" value={usd(limit)} />
        <Big label="Drawn" value={usd(balance)} bad={balance > limit * 0.8} />
        <Big label="Available" value={usd(avail)} />
        <Big label="Rate · index + 400" value={pct(rate)} />
        <Big label="Interest paid" value={usd(game.loc?.interestPaid ?? 0)} />
      </div>
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

// Named saves alongside the autosave, so a run can be branched or rolled back.
function SaveSlots() {
  const slots = useStore((s) => s.slots);
  const { saveTo, loadFrom, dropSave, refreshSlots } = useStore.getState();
  const [name, setName] = useState("");
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
              <button className="btn btn-sell" onClick={() => { if (window.confirm(`Delete “${m.slot}”?`)) void dropSave(m.slot); }}>Delete</button>
            </div>
          </div>
        ))}
        {!slots.length && <div className="hint">No named saves yet.</div>}
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
    const leased = commercial ? h.tenants.reduce((a, t) => a + t.sf, 0) : Math.round((h.occ ?? 0) * rec.bldgArea);
    const notReady = notReadySf(h, q);
    const occ = rec.bldgArea ? leased / rec.bldgArea : 0;
    const rentRoll = commercial
      ? h.tenants.reduce((a, t) => a + t.rentPsf * t.sf, 0)
      : rec.bldgArea * marketRentPsfYr(rec, game.econ, h.condition) * (h.occ ?? 0);
    const rolling = commercial ? h.tenants.filter((t) => t.endM - q <= 12).reduce((a, t) => a + t.sf, 0) : 0;
    return [{ h, rec, commercial, leased, notReady, occ, rentRoll, rolling }];
  });

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
                  <td>{CLASS_LABEL[r.rec.class]}</td>
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

function BooksPage() {
  const game = useStore((s) => s.game)!;
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
        <Big label="Realized gains" value={usd(realized)} bad={realized < 0} />
        <Big label="Taxes paid, lifetime" value={usd(game.taxesPaid ?? 0)} />
        <Big label="Exits" value={String(game.exits.length)} />
      </div>
      <NWChart data={game.nwHistory} />
      <CreditLine />
      <SaveSlots />
      <div className="page-section">
        <div className="page-section-head">The ledger, by year</div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Year</th><th className="num">NOI</th><th className="num">Debt svc</th><th className="num">Leasing</th>
                <th className="num">Capex</th><th className="num">Development</th><th className="num">Taxes</th>
                <th className="num">Acquisitions</th><th className="num">Dispositions</th><th className="num">Net</th>
              </tr>
            </thead>
            <tbody>
              {years.map((b) => {
                const net = b.noi - b.debtSvc - b.leasing - b.capex - b.dev - b.taxes - b.bought + b.sold;
                return (
                  <tr key={b.yr} style={{ cursor: "default" }}>
                    <td className="mono">{2026 + b.yr}</td>
                    <td className="num">{usd(b.noi)}</td>
                    <td className="num">{b.debtSvc ? "−" + usd(b.debtSvc) : "—"}</td>
                    <td className="num">{b.leasing ? "−" + usd(b.leasing) : "—"}</td>
                    <td className="num">{b.capex ? "−" + usd(b.capex) : "—"}</td>
                    <td className="num">{b.dev ? "−" + usd(b.dev) : "—"}</td>
                    <td className="num">{b.taxes ? "−" + usd(b.taxes) : "—"}</td>
                    <td className="num">{b.bought ? "−" + usd(b.bought) : "—"}</td>
                    <td className="num">{b.sold ? usd(b.sold) : "—"}</td>
                    <td className={"num" + (net < 0 ? " neg" : "")}>{usd(net)}</td>
                  </tr>
                );
              })}
              {!years.length && <tr><td colSpan={10} className="dim">Nothing on the books yet — advance a month.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <div className="page-section">
        <div className="page-section-head">The tape</div>
        <div className="news" style={{ maxHeight: 260, overflowY: "auto" }}>
          {game.news.slice(0, 60).map((n, i) => (
            <div key={i} className={"news-item news-" + n.kind}>
              <span className="news-q mono">{monthLabel(n.q)}</span> {n.text}
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

function Big({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="big-stat">
      <div className="big-label">{label}</div>
      <div className={"big-value mono" + (bad ? " v-bad" : "")}>{value}</div>
    </div>
  );
}

function Row({ k, v, strong, bad }: { k: string; v: string; strong?: boolean; bad?: boolean }) {
  return (
    <>
      <div className="k">{k}</div>
      <div className={"v mono" + (strong ? " v-strong" : "") + (bad ? " v-bad" : "")}>{v}</div>
    </>
  );
}
