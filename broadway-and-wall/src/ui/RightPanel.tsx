// The game's chrome: a parcel card docked to the map, and full-page views
// for Portfolio / Deals / Market — big rooms, not side-panel squints.
import { useEffect, useState } from "react";
import { useStore } from "@/state/store";
import { CLASS_COLOR, CLASS_LABEL } from "@/data/types";
import { monthLabel, CREDIT_LABEL } from "@/engine/types";
import {
  assetValue, initialCondition, holdingValue, marketRentPsfYr, managedRentPsfYr,
  occupancy, noiYr, holdingNOIYr, renovationCost, resolveRec, appraise, propertyTaxYr,
} from "@/engine/value";
import { planDevelopment, PROGRAMS, programCost } from "@/engine/dev";
import type { BuiltClass } from "@/engine/types";
import { buyQuote, assemblagePressure, saleTaxQuote } from "@/engine/actions";
import { isCommercial, vacantSf, walt, loiSigningCost, notReadySf } from "@/engine/leasing";
import { dscr, ltv, rateCapCost } from "@/engine/debt";
import { usd, sf, pct } from "./format";

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
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPage("none"); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPage]);
  if (!game) return null;
  return (
    <>
      <ParcelPanel />
      {page !== "none" && (
        <div className="page-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setPage("none"); }}>
          <div className="page">
            <div className="page-head">
              <div className="page-title">
                {page === "portfolio" ? "Portfolio" : page === "deals" ? "The Deals Desk" : "The Market"}
              </div>
              <button className="panel-close" onClick={() => setPage("none")}>×</button>
            </div>
            {page === "portfolio" && <PortfolioPage />}
            {page === "deals" && <DealsPage />}
            {page === "market" && <MarketPage />}
          </div>
        </div>
      )}
      {game.gameOver && (
        <div className="page-backdrop">
          <div className="page gameover-page">
            <div className="page-title">{game.gameOver.complete ? "A Century of Ashport" : "The run is over."}</div>
            <p>{game.gameOver.cause}</p>
            <button className="btn btn-buy" onClick={() => useStore.getState().newRun()}>Start a new run</button>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- parcel card
function ParcelPanel() {
  const parcels = useStore((s) => s.parcels);
  const adjacency = useStore((s) => s.adjacency);
  const selectedBBL = useStore((s) => s.selectedBBL);
  const select = useStore((s) => s.select);
  const game = useStore((s) => s.game)!;
  const { renovate, approach, refi } = useStore.getState();

  if (!selectedBBL || !parcels) return null;
  const rec = resolveRec(parcels, game, selectedBBL);
  if (!rec) return null;
  const dev = game.developments[selectedBBL];
  const neighbors = adjacency?.[selectedBBL] ?? [];
  const holding = game.holdings[selectedBBL];
  const listing = game.listings.find((l) => l.bbl === selectedBBL);
  const appr = game.approaches[selectedBBL];
  const cond = holding?.condition ?? initialCondition(rec);
  const value = holding ? holdingValue(rec, game.econ, holding) : assetValue(rec, game.econ, cond);
  const builtFar = rec.lotArea > 0 ? rec.bldgArea / rec.lotArea : 0;
  const farMax = Math.max(rec.farMaxComm, rec.farMaxRes);
  const isBuilt = rec.class !== "land" && rec.bldgArea > 0;
  const renovating = holding?.renovatingUntilM !== undefined && game.month < (holding.renovatingUntilM ?? 0);
  const commercial = isCommercial(rec);
  const leasedSf = holding && commercial ? holding.tenants.reduce((s2, t) => s2 + t.sf, 0) : 0;
  const d = holding ? dscr(rec, game, holding) : null;
  const l = holding ? ltv(rec, game, holding) : null;

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <div className="panel-address">{rec.address}</div>
          <div className="panel-bbl mono">Parcel {rec.bbl}</div>
        </div>
        <button className="panel-close" onClick={() => select(null)} aria-label="Close">×</button>
      </div>

      <div className="chip-row">
        <span className="chip" style={{ background: CLASS_COLOR[rec.class] }}>{CLASS_LABEL[rec.class]}</span>
        <span className="chip chip-zone mono">{rec.zoneDist}</span>
        {holding && <span className="chip chip-owned">OWNED</span>}
        {dev && <span className="chip chip-reno">UNDER CONSTRUCTION</span>}
        {listing && !holding && <span className="chip chip-listed">FOR SALE</span>}
        {holding?.sale && <span className="chip chip-listed">LISTED · {usd(holding.sale.ask)}</span>}
        {renovating && <span className="chip chip-reno">RENOVATING</span>}
        {holding?.loan?.sweep && <span className="chip chip-sweep">CASH SWEEP</span>}
      </div>

      <div className="grid">
        <Row k="Appraisal" v={band(selectedBBL, value)} strong />
        {isBuilt && <Row k="Market rent" v={"$" + marketRentPsfYr(rec, game.econ, cond).toFixed(0) + " /sf/yr"} />}
        {isBuilt && !holding && <Row k="Occupancy (mkt)" v={(occupancy(rec, game.econ) * 100).toFixed(0) + "%"} />}
        {holding && commercial && <Row k="Occupancy" v={rec.bldgArea ? ((leasedSf / rec.bldgArea) * 100).toFixed(0) + "%" : "—"} />}
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
            <Row k="Coupon" v={pct(holding.loan.ratePct) + (holding.loan.product === "float" ? " (floating)" : " (fixed)")} />
            {game.month < holding.loan.ioUntilM && <Row k="Interest-only" v={"until " + monthLabel(holding.loan.ioUntilM)} />}
            <Row k="Payment / mo" v={usd(holding.loan.monthlyPmt)} />
            <Row k="Balloon" v={monthLabel(holding.loan.maturityM)} />
            {d !== null && <Row k="DSCR" v={d.toFixed(2) + " (min " + holding.loan.minDSCR.toFixed(2) + ")"} bad={d < holding.loan.minDSCR} />}
            {l !== null && <Row k="LTV" v={(l * 100).toFixed(0) + "% (max " + (holding.loan.maxLTV * 100).toFixed(0) + "%)"} bad={l > holding.loan.maxLTV} />}
            {holding.loan.cap && <Row k="Rate cap" v={`index ≤ ${holding.loan.cap.strike.toFixed(2)}% until ${monthLabel(holding.loan.cap.expiresM)}`} />}
          </div>
          <div className="btn-row">
            <button className="btn" onClick={() => refi(selectedBBL, "fixed")}>Refi fixed</button>
            <button className="btn" onClick={() => refi(selectedBBL, "float")}>Refi float</button>
            {holding.loan.product === "float" && !holding.loan.cap && (
              <button
                className="btn"
                title={`Index capped at ${(game.econ.indexRate + 0.5).toFixed(2)}% for 3 years — floating stops hurting past the strike`}
                onClick={() => useStore.getState().rateCap(selectedBBL)}
              >
                Buy rate cap · {usd(rateCapCost(holding.loan))}
              </button>
            )}
          </div>
        </div>
      )}

      {listing && !holding && (
        <div className="deal">
          <div className="deal-head">On the market</div>
          <div className="grid">
            <Row k="Ask" v={usd(listing.ask)} strong />
            <Row k="vs. appraisal" v={((listing.ask / apMid(selectedBBL, value) - 1) * 100).toFixed(1) + "%"} />
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
                <Row k="Good until" v={monthLabel(appr.q + 12)} />
              </div>
              <BuyButtons bbl={selectedBBL} price={appr.ask} off />
            </>
          ) : appr && appr.refused ? (
            <div className="hint">The owner turned you away in {monthLabel(appr.q)}. Try again after {monthLabel(appr.q + 12)}.</div>
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
                className={"btn" + ((holding.stance ?? 0) === v ? " btn-buy" : "")}
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
                className={"btn" + (holding.broker ? " btn-buy" : "")}
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
  return (
    <div className="deal">
      <div className="deal-head">Sell</div>
      <div className="hint">Name your ask and let the market answer. Appraisal: {band(bbl, value)}.</div>
      <div className="btn-row">
        <input
          className="ask-input mono"
          placeholder={`${(apMid(bbl, value) / 1e6).toFixed(2)}`}
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
        />
        <span className="dim" style={{ alignSelf: "center", fontSize: 12 }}>$M</span>
        <button
          className="btn btn-buy"
          onClick={() => listSale(bbl, (parseFloat(ask) || apMid(bbl, value) / 1e6) * 1e6)}
        >
          List for sale
        </button>
      </div>
    </div>
  );
}

function BuyButtons({ bbl, price, off }: { bbl: string; price: number; off: boolean }) {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const { buy, buyOff } = useStore.getState();
  const act = off ? buyOff : buy;
  const fixed = buyQuote(game, parcels, bbl, price, "fixed");
  const float = buyQuote(game, parcels, bbl, price, "float");
  return (
    <div className="btn-row">
      <button className="btn btn-buy" onClick={() => act(bbl, "cash")}>All-cash · {usd(price * 1.02)}</button>
      {fixed.principal > 0 && (
        <button className="btn btn-buy" onClick={() => act(bbl, "fixed")} title={`$${(fixed.principal / 1e6).toFixed(1)}M at ${fixed.ratePct}% fixed, 10-yr balloon`}>
          Fixed · eq {usd(fixed.equity)}
        </button>
      )}
      {float.principal > 0 && (
        <button className="btn btn-buy" onClick={() => act(bbl, "float")} title={`$${(float.principal / 1e6).toFixed(1)}M floating at ${float.ratePct}%, 3-yr IO, 7-yr balloon`}>
          Float IO · eq {usd(float.equity)}
        </button>
      )}
    </div>
  );
}

function DevelopSection({ bbl }: { bbl: string }) {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const [use, setUse] = useState<BuiltClass>("multifamily");
  const [farFrac, setFarFrac] = useState(0.75);
  const [preLease, setPreLease] = useState(false);
  const canPreLease = use === "office" || use === "retail" || use === "mixed";
  const plan = planDevelopment(game, parcels, bbl, use, farFrac, preLease && canPreLease);
  const USES: BuiltClass[] = ["office", "multifamily", "mixed", "retail", "industrial"];
  return (
    <div className="deal">
      <div className="deal-head">Develop this lot</div>
      <div className="btn-row">
        {USES.map((u) => (
          <button key={u} className={"btn" + (use === u ? " btn-buy" : "")} onClick={() => setUse(u)}>{CLASS_LABEL[u]}</button>
        ))}
      </div>
      <div className="btn-row">
        {[0.5, 0.75, 1].map((f) => (
          <button key={f} className={"btn" + (farFrac === f ? " btn-buy" : "")} onClick={() => setFarFrac(f)}>
            {Math.round(f * 100)}% FAR
          </button>
        ))}
      </div>
      {canPreLease && (
        <div className="btn-row">
          <button
            className={"btn" + (preLease ? " btn-buy" : "")}
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
            <Row k="Building" v={`${(plan.sf / 1000).toFixed(0)}k sf · ${plan.floors} fl`} />
            <Row k="All-in cost" v={usd(plan.costTotal)} />
            <Row
              k={`Constr. loan (${Math.round((plan.loanAmount / Math.max(1, plan.costTotal)) * 100)}%)`}
              v={plan.loanAmount > 0 ? usd(plan.loanAmount) + " @ " + pct(plan.ratePct) : "none — all equity"}
            />
            <Row k="Your equity" v={usd(plan.equity)} strong />
            <Row k="Schedule" v={plan.months + " months"} />
            {plan.preLease && <Row k="Pre-leased" v={`${Math.round((plan.sf * 0.35) / 100) * 100 / 1000}k sf anchor at delivery`} />}
          </div>
          {plan.lenderNote && <div className="hint">{plan.lenderNote}</div>}
          <div className="btn-row">
            <button className="btn btn-buy" onClick={() => useStore.getState().develop(bbl, use, farFrac, preLease && canPreLease)}>
              Break ground · {usd(plan.equity)}
            </button>
          </div>
        </>
      ) : (
        <div className="hint">Zoning won't allow {CLASS_LABEL[use]} here{use === "multifamily" ? " (no residential FAR)" : ""}.</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- full pages
function PortfolioPage() {
  const parcels = useStore((s) => s.parcels)!;
  const game = useStore((s) => s.game)!;
  const select = useStore((s) => s.select);
  const setPage = useStore((s) => s.setPage);
  const holdings = Object.values(game.holdings);
  const go = (bbl: string) => { setPage("none"); select(bbl); };
  if (!holdings.length && !Object.keys(game.developments).length) {
    return <div className="hint">You own nothing yet. The Market page has the tape; the map has everything else.</div>;
  }
  let totV = 0, totD = 0, totCF = 0;
  const rows = holdings.map((h) => {
    const rec = resolveRec(parcels, game, h.bbl);
    const v = rec ? holdingValue(rec, game.econ, h) : 0;
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
          <tr><th>Property</th><th>Class</th><th>Occ</th><th>NOI / yr</th><th>Value</th><th>Debt</th><th>Equity</th><th>CF / mo</th><th>Status</th></tr>
        </thead>
        <tbody>
          {rows.map(({ h, rec, v, cf, occ }) => (
            <tr key={h.bbl} onClick={() => go(h.bbl)}>
              <td>{rec?.address ?? h.bbl}</td>
              <td>{rec ? CLASS_LABEL[rec.class] : "—"}</td>
              <td className="mono">{rec?.class === "land" ? "—" : (occ * 100).toFixed(0) + "%"}</td>
              <td className="mono">{rec ? usd(holdingNOIYr(rec, game.econ, h, game.month)) : "—"}</td>
              <td className="mono">{usd(v)}</td>
              <td className="mono">{usd(h.loan?.balance ?? 0)}</td>
              <td className="mono">{usd(v - (h.loan?.balance ?? 0))}</td>
              <td className={"mono" + (cf < 0 ? " v-bad" : "")}>{usd(cf)}</td>
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
              <td className="mono">—</td>
              <td className="mono">—</td>
              <td className="mono">{usd(dv.costTotal)}</td>
              <td className="mono">{usd(dv.loanBalance)}</td>
              <td className="mono">{usd(dv.costTotal - dv.loanBalance)}</td>
              <td className="mono v-bad">{usd(-(dv.loanBalance * dv.ratePct) / 100 / 12)}</td>
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
      </div>

      <div className="deals-grid">
        <section>
          <div className="page-section">On the market · {game.listings.length}</div>
          <table className="tbl">
            <thead><tr><th>Property</th><th>Class</th><th>Building</th><th>Ask</th><th>vs. appraisal</th></tr></thead>
            <tbody>
              {[...game.listings].sort((a, b) => a.ask - b.ask).map((li) => {
                const rec = resolveRec(parcels, game, li.bbl);
                if (!rec) return null;
                const v = apMid(li.bbl, assetValue(rec, game.econ, initialCondition(rec)));
                return (
                  <tr key={li.bbl} onClick={() => go(li.bbl)}>
                    <td>{rec.address}</td>
                    <td>{CLASS_LABEL[rec.class]}</td>
                    <td className="mono">{rec.bldgArea ? (rec.bldgArea / 1000).toFixed(0) + "k sf" : (rec.lotArea / 1000).toFixed(0) + "k sf lot"}</td>
                    <td className="mono">{usd(li.ask)}</td>
                    <td className={"mono" + (li.ask < v ? "" : " dim")}>{((li.ask / v - 1) * 100).toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section>
          <div className="page-section">The tape</div>
          <div className="news">
            {game.news.slice(0, 24).map((n, i) => (
              <div key={i} className={"news-item news-" + n.kind}>
                <span className="news-q mono">{monthLabel(n.q)}</span> {n.text}
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
