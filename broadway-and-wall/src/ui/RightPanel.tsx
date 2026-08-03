// The game's chrome: a parcel card docked to the map, and full-page views
// for Portfolio / Deals / Market — big rooms, not side-panel squints.
import { useEffect, useState, Fragment} from "react";
import { useStore } from "@/state/store";
import { CLASS_COLOR, CLASS_LABEL } from "@/data/types";
import { monthLabel, CREDIT_LABEL } from "@/engine/types";
import type { BuiltClass, Contract, DevUse } from "@/engine/types";
import {
  assetValue, initialCondition, holdingValue, marketRentPsfYr, managedRentPsfYr,
  occupancy, noiYr, holdingNOIYr, renovationCost, resolveRec, appraise, propertyTaxYr, useRentPsfYr,
  rollQualitySpread, operatingStatement, recoveryOf, noiAfterTaxYr, netWorth, remainingAbatement,
} from "@/engine/value";
import { planDevelopment, PROGRAMS, programCost, farMaxFor, maxFloorsFor, retailWantsMixed, demolitionCost, unitRange, suiteSfForUnits, SUITE_BOUNDS } from "@/engine/dev";
import { buyQuote, assemblagePressure, saleTaxQuote } from "@/engine/actions";
import { sellerOf, sellerProfile } from "@/engine/acquire";
import { MILESTONES } from "@/engine/sim";
import { isCommercial, vacantSf, walt, loiSigningCost, notReadySf, unitStatus, unitCount, suiteSf, useSuiteSf, buyoutQuote, depositsHeld, BUYOUT_PREMIUM } from "@/engine/leasing";
import { dscr, ltv, rateCapCost, refiQuotes, PRODUCTS, prepayPenalty } from "@/engine/debt";
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
 * Physical occupancy of the WHOLE building: commercial square feet under
 * lease plus residential square feet occupied, over the building. Dividing
 * commercial leases by the whole floor area reported a full mixed-use block
 * as 47% let because it counted the flats as empty offices.
 */
function physicalOcc(rec: never, h: { tenants: { sf: number }[]; occ?: number }): number {
  const area = (rec as unknown as { bldgArea: number }).bldgArea;
  if (!area) return 0;
  const comm = h.tenants.reduce((a, t) => a + t.sf, 0);
  const res = useSf(rec, "multifamily") * (h.occ ?? 0);
  return Math.min(1, (comm + res) / area);
}
import { sponsorStanding } from "@/engine/sponsor";
import { marketAppetite, markRival, ownerOf, rivalCondition } from "@/engine/rivals";
import { gpEquity, jvSummary, lpMood, lpTerms, recapQuote } from "@/engine/equity";
import { compFlows, compStats, portfolioIndustries } from "@/engine/comps";
import { insuranceQuote, insuredValue, DEDUCTIBLES } from "@/engine/peril";
import { INDUSTRY_LABEL, SECTORS } from "@/engine/market";
import { specSuiteQuote, blendExtendQuote, useVacantSf, leasableUses } from "@/engine/leasing";
import { groundLeaseQuote, mergeCost } from "@/engine/actions";
import { varianceQuote } from "@/engine/zoning";
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
    : page === "saves" ? "Saved Games"
    : page === "economy" ? "The Economy"
    : page === "research" ? "Research"
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
            {page === "economy" && <EconomyPage />}
            {page === "books" && <BooksPage />}
            {page === "saves" && <SavesPage />}
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
        <span className="chip" style={{ background: CLASS_COLOR[rec.class] }}>{useLabel(rec)}</span>
        <span className="chip chip-zone mono">{rec.zoneDist}</span>
        {holding && <span className="chip chip-owned">OWNED</span>}
        {dev && <span className="chip chip-reno">UNDER CONSTRUCTION</span>}
        {listing && !holding && <span className="chip chip-listed">FOR SALE</span>}
        {listing?.distress && !holding && <span className="chip chip-distress">MOTIVATED SELLER</span>}
        {holding?.sale && <span className="chip chip-listed">LISTED · {usd(holding.sale.ask)}</span>}
        {renovating && <span className="chip chip-reno">RENOVATING</span>}
        {holding?.loan?.sweep && <span className="chip chip-sweep">CASH SWEEP</span>}
        {holding?.damage && <span className="chip chip-distress">{holding.damage.peril.toUpperCase()} DAMAGE</span>}
        {game.landmarks?.[selectedBBL] !== undefined && <span className="chip chip-reno">LANDMARKED</span>}
      </div>

      {/* WHO OWNS IT. Every building in this city has an owner and for most of
          them that owner is a named firm with a balance sheet you can read —
          and there was nowhere on the record that said so. Knowing that the
          corner you want belongs to the shop that is three points over its
          covenant is the difference between a cold call and a bid. */}
      {(() => {
        if (holding) return null;
        const own = ownerOf(game, selectedBBL);
        if (!own) return null;
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

      <div className="grid">
        <Row k="Appraisal" v={band(selectedBBL, value)} strong />
        {isBuilt && <Row k="Market rent" v={"$" + marketRentPsfYr(rec, game.econ, cond).toFixed(0) + " /sf/yr"} />}
        {isBuilt && !holding && <Row k="Occupancy (mkt)" v={(occupancy(rec, game.econ) * 100).toFixed(0) + "%"} />}
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
            v={`${u.leased} of ${u.total} · ${sf(Math.round(u.sfPer))} each`}
            bad={u.leased < u.total * 0.6}
          />
        ))}
        {holding && commercial && <Row k="WALT" v={walt(holding, game.month).toFixed(1) + " yrs"} />}
        {/* One building must not quote two different NOIs on one panel. Owned
            assets already net out the tax bill; an unowned one is estimated
            against its own appraisal, which is the only price on offer until
            somebody names one. */}
        {isBuilt && <Row k="NOI / yr" v={usd(holding ? holdingNOIYr(rec, game.econ, holding, game.month) : noiAfterTaxYr(rec, game.econ, cond, value))} />}
        {holding && isBuilt && <Row k="Property tax / yr" v={usd(propertyTaxYr(rec, holding)) + (commercial ? " (your share)" : "")} />}
        <Row k="Lot area" v={sf(rec.lotArea)} />
        {isBuilt && <Row k="Building" v={sf(rec.bldgArea) + ` · ${rec.floors} fl · ${rec.yearBuilt}`} />}
        {isBuilt && isMixedUse(rec) && <Row k="The stack" v={mixLabel(rec)} />}
        <Row k="FAR built / max" v={`${builtFar.toFixed(1)} / ${farMax.toFixed(1)}`} />
        <Row k="Demand" v={String(Math.round(rec.demandScore)) + " / 100"} />
      </div>

      {/* SOMEBODY ELSE'S CRANE. A job on this site that is not yours — named or
          anonymous — is the most important thing on the parcel, because it is
          the space that will be competing with yours the year it opens. */}
      {!dev && (() => {
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

      <Neighbourhood bbl={rec.bbl} block={rec.block} />

      {holding && commercial && holding.tenants.length > 0 && (
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
                ...inUse.map(({ t, i }) => (
                  <div key={i} className="roll-row">
                    <span className="roll-name">{t.name} <span className="roll-credit mono">{CREDIT_LABEL[t.credit]}</span></span>
                    <span className="roll-meta mono">
                      {(t.sf / 1000).toFixed(1)}k sf · ${t.rentPsf.toFixed(0)} {t.net ? "NNN" : "G"} · exp {monthLabel(t.endM)}
                    </span>
                  </div>
                )),
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

      {listing && !holding && (() => {
        const contract = game.talks?.bbl === selectedBBL && game.talks.agreed ? game.talks : null;
        return (
          <div className="deal">
            <div className="deal-head">{contract ? "Under contract" : "On the market"}</div>
            <div className="grid">
              {contract
                ? <Row k="Agreed price" v={usd(contract.agreedPrice ?? contract.theirPrice)} strong />
                : <Row k="Ask" v={usd(listing.ask)} strong />}
              {contract && <Row k="Must fund by" v={monthLabel(contract.closeByM ?? game.month + 3)} bad />}
              {isBuilt && <Row k="NOI / yr" v={usd(noiAfterTaxYr(rec, game.econ, cond, contract?.agreedPrice ?? listing.ask))} />}
              {isBuilt && <Row k="Cap rate" v={((noiAfterTaxYr(rec, game.econ, cond, contract?.agreedPrice ?? listing.ask) / (contract?.agreedPrice ?? listing.ask)) * 100).toFixed(2) + "%"} strong />}
              {isBuilt && <Row k="Occupancy" v={(occupancy(rec, game.econ) * 100).toFixed(0) + "%"} />}
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

      {holding && isBuilt && !renovating && <LeasingDesk bbl={selectedBBL} />}

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
                  {nr ? `${nr.lotArea.toLocaleString()} sf · ${useLabel(nr)}` : ""}
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
  const parcels = useStore((s) => s.parcels)!;
  const { listSale, delistSale, acceptOffer, declineOffer, counterSale, runBestAndFinal, takeBid } = useStore.getState();
  const holding = game.holdings[bbl]!;
  const [ask, setAsk] = useState<string>("");
  const [counter, setCounter] = useState(0);
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
                        <button className="btn-mini" onClick={() => takeBid(bbl, i)}>take it</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
        <div className="btn-row">
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
      <div className="btn-row">
        <button className="btn btn-buy" onClick={() => listSale(bbl, price, "marketed")}>
          Run a process at {usd(price)}
        </button>
        <button className="btn" onClick={() => listSale(bbl, price)}>Quiet listing</button>
      </div>
      <div className="hint">
        A campaign takes two to four months, costs 2.5% instead of 1.5%, and ends with every bid on your desk at
        once — with the option to go back to the top of the list once. A quiet listing costs less and finds you one
        buyer at a time, whoever happens to ring.
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
  const offerPrice = Math.round(price * Math.min(1, bidFrac));
  const seller = sellerOf(game, parcels, bbl);
  const talks = game.talks?.bbl === bbl ? game.talks : null;
  const otherTalk = game.talks && game.talks.bbl !== bbl ? game.talks : null;
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
      {otherTalk && (
        <div className="hint">
          You are mid-negotiation at {parcels[otherTalk.bbl]?.address ?? otherTalk.bbl}. One at a time — finish it or walk away.
        </div>
      )}
      <div className="btn-row">
        <button
          className="btn btn-buy"
          disabled={!!otherTalk || (!!talks && talks.final && offerPrice < talks.theirPrice)}
          onClick={() => useStore.getState().offer(bbl, offerPrice)}
        >
          {talks ? `Counter at ${usd(offerPrice)}` : `Offer ${usd(offerPrice)}`}
        </button>
        {talks && (
          <>
            <button className="btn btn-buy" onClick={() => useStore.getState().acceptCounter()}
              title="Take their number and go under contract. You still have to fund it.">
              Take {usd(talks.theirPrice)}
            </button>
            <button className="btn" onClick={() => useStore.getState().walkAway()}>Walk away</button>
          </>
        )}
      </div>
      {talks?.final && offerPrice < talks.theirPrice && (
        <div className="hint">They have stopped moving. Take {usd(talks.theirPrice)} or walk.</div>
      )}
      <div className="hint dim">
        Agreeing a price puts you under contract. The lender, the leverage and the cheque come after that,
        and you get three months to arrange them.
      </div>
    </>
  );
}

/**
 * THE MONEY. Only ever shown against a price that is already agreed.
 */
function BuyButtons({ bbl, price, off, closeLabel }: { bbl: string; price: number; off: boolean; closeLabel?: string }) {
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
          {max.bind === "ltv"
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
            if (off) buyOff(bbl, prod as never, l);
            else useStore.getState().closeDeal(prod, l);
          }}
        >
          {closeLabel ?? `Close at ${usd(offerPrice)}`} · eq {usd(equity)}
        </button>
        {!off && (
          <button className="btn" onClick={() => useStore.getState().walkAway()}
            title="Tear up the contract. You lose the building; nothing else has moved.">
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
  const cur = game.holdings[bbl]?.loan;
  const existing = cur ? prepayPenalty(cur, game.month) : 0;
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
  const customMix = use === "mixed"
    ? { retail: split.retail / 100, office: split.office / 100, multifamily: split.multifamily / 100 }
    : undefined;
  const planMax = planDevelopment(game, parcels, bbl, use, fl, cov, contract, undefined, { mix: customMix });
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
    planMax ? planMax.ltcMax * ltcWant : undefined, { mix: customMix, suites: suiteChoice });
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
              value={split[u]}
              min={0}
              max={100}
              step={5}
              onChange={(v) => setSplit((prev) => {
                // The other two absorb the difference in the ratio they already
                // sit in, so moving one dial never silently rewrites both.
                const others = (["retail", "office", "multifamily"] as const).filter((k) => k !== u);
                const restNow = others.reduce((a, k) => a + prev[k], 0);
                const rest = 100 - v;
                const next = { ...prev, [u]: v } as typeof prev;
                for (const k of others) next[k] = restNow > 0 ? Math.round((prev[k] / restNow) * rest) : Math.round(rest / 2);
                next[others[1]] = Math.max(0, 100 - v - next[others[0]]);
                return next;
              })}
              format={(v) => `${v}%${planMax ? ` · ${sf(Math.round(planMax.sf * v / 100))}` : ""}`}
              marks={[{ at: 15, label: "" }, { at: 50, label: "half" }]}
              hint={u === "retail"
                ? "Shops at grade only — past the second floor nobody comes, and retail is the dearest thing per foot in the book."
                : u === "office" ? "The swing leg: the highest rent of the three and the one that empties first in a downturn."
                : "Flats are the cheapest to build and the thinnest margin. They also let in every market, which is the point of putting them in the stack."}
            />
          ))}
          <div className="hint">
            {split.retail + split.office + split.multifamily !== 100
              ? "The stack has to add to 100%."
              : `Shops ${split.retail}% · offices ${split.office}% · flats ${split.multifamily}%. Anything under 3% is dropped — that is a lobby, not a use.`}
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
            <Row k="All in" v={`${usd(plan.costTotal)} · $${(plan.costTotal / Math.max(1, plan.sf)).toFixed(0)}/sf`} strong />
            <Row
              k={`Construction loan (${Math.round(plan.ltc * 100)}% of cost)`}
              v={plan.commitment > 0 ? `${usd(plan.commitment)} @ ${pct(plan.ratePct)}` : "none — nobody will fund it"}
              bad={plan.commitment === 0 && plan.ltcMax > 0 && ltcWant > 0}
            />
            <Row k="Interest reserve" v={plan.interestReserve > 0 ? `${usd(plan.interestReserve)} — the lender carries it, not you` : "—"} />
            {/* The two numbers that decide whether this is a development or a
                donation: what it yields on what it costs, against what the
                market will pay for it when it is finished. */}
            <Row
              k="Yield on cost"
              v={`${plan.yieldOnCost.toFixed(2)}% vs ${plan.exitCap.toFixed(2)}% exit · ${(plan.yieldOnCost - plan.exitCap) >= 0 ? "+" : ""}${((plan.yieldOnCost - plan.exitCap) * 100).toFixed(0)} bps`}
              strong
              bad={plan.yieldOnCost - plan.exitCap < 0.75}
            />
            <Row k="Total equity" v={usd(plan.equity)} />
            <Row k="Equity at close" v={`${usd(plan.equityAtClose)} — the bank funds nothing until yours is in`} strong bad={plan.equityAtClose > game.cash} />
            <Row k="Schedule" v={plan.months + " months, built on spec"} />
          </div>
          {plan.lenderNote && <div className="hint">{plan.lenderNote}</div>}
          <div className="btn-row">
            <button
              className="btn btn-buy"
              disabled={plan.equityAtClose > game.cash || plan.commitment === 0 && plan.equity > game.cash}
              onClick={() => useStore.getState().develop(bbl, use, fl, cov, contract, plan.ltcMax * ltcWant, { mix: customMix, suites: suiteChoice })}
            >
              Break ground · {usd(plan.equityAtClose)}
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
  const occ = h ? physicalOcc(rec as never, h) : occupancy(rec, game.econ);
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
        <Big label="Equity" value={h ? usd(value - (h.loan?.balance ?? 0)) : "—"} />
      </div>
      <div className="prop-head">
        <div>
          <div className="page-title" style={{ fontSize: 22 }}>{rec.address}</div>
          <div className="panel-bbl mono">Parcel {rec.bbl} · {useLabel(rec)} · {rec.zoneDist}</div>
          {/* Every building in this game is somewhere. Closing the page and
              putting the camera on it is one click, not a hunt. */}
          <div className="btn-row" style={{ marginTop: 6 }}>
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
      {/* OUT OF SERVICE. The damaged share earns nothing and still costs money
          to hold, and what it actually cost you after the policy is the only
          number that matters afterwards. */}
      {h?.damage && (
        <div className="deal">
          <div className="deal-head">Damage · {h.damage.peril}</div>
          <div className="grid">
            <Row k="Out of service" v={`${(h.damage.share * 100).toFixed(0)}% of the building`} strong bad />
            <Row k="Back in service" v={monthLabel(h.damage.untilM)} />
            <Row k="What it cost you" v={usd(h.damage.uninsured)} bad />
          </div>
        </div>
      )}
      <EquityDesk bbl={bbl} />
      <LandDesk bbl={bbl} />
      {dev && (
        <div className="page-section">
          <div className="page-section-head">Under construction</div>
          <div className="grid">
            <Row k="Program" v={`${sf(dev.sf)} of ${dev.use} · ${dev.floors} floors`} strong />
            <Row k="Budget" v={usd(dev.costTotal)} />
            {/* Financed with the job, spent on tenants rather than steel, and
                paid across as cash the day the building opens. */}
            {(dev.leaseUpReserve ?? 0) > 0 && (
              <Row k="Lease-up reserve" v={`${usd(dev.leaseUpReserve!)} — released at delivery`} />
            )}
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


/**
 * THE EQUITY DESK.
 *
 * Either there is a partner in this building or there could be. If there is,
 * this is the only place the sponsor can see what they are actually owed —
 * unreturned capital, pref accruing whether the building performs or not, and
 * what the promote is worth if it sold today. If there is not, this is where
 * you find out what the market will give you for a stake, and on what terms,
 * which depends entirely on how the last ones went.
 */
function EquityDesk({ bbl }: { bbl: string }) {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const { raiseEquity } = useStore.getState();
  const h = game.holdings[bbl];
  const [share, setShare] = useState(0.6);
  if (!h) return null;
  const jv = game.jvs?.[bbl];
  const terms = lpTerms(game);

  if (jv) {
    const rec = resolveRec(parcels, game, bbl);
    const equity = rec ? holdingValue(rec, game.econ, h, game.month) - (h.loan?.balance ?? 0) : 0;
    const unreturned = Math.max(0, jv.lpCapital - jv.lpDistributed);
    const mine = gpEquity(game, bbl, equity);
    return (
      <div className="deal">
        <div className="deal-head">Partner in this deal</div>
        <div className="grid">
          <Row k="Their share of the equity" v={`${(jv.lpShare * 100).toFixed(0)}%`} />
          <Row k="Capital in / returned" v={`${usd(jv.lpCapital)} / ${usd(jv.lpDistributed)}`} />
          <Row k="Unreturned capital" v={usd(unreturned)} bad={unreturned > 0} />
          {/* The number that decides whether the promote is worth anything.
              It accrues in a bad year exactly as fast as in a good one. */}
          <Row k={`Preferred owed · ${jv.prefPct.toFixed(1)}%/yr`} v={usd(jv.accruedPref)} bad={jv.accruedPref > jv.lpCapital * 0.15} />
          <Row k="Promote paid to date" v={usd(jv.promoteEarned)} />
          <Row k="Equity in the building" v={usd(equity)} />
          <Row k="Yours if it sold today" v={usd(Math.max(0, mine))} strong bad={mine <= 0} />
        </div>
        <div className="hint">
          {mine <= 0
            ? "There is nothing here for you. Their capital and their pref come off the top and the building is not worth that yet — running it longer is the only way back."
            : `Partnered since ${monthLabel(jv.openedM)}. They are paid before you are, every month, and the pref compounds against the promote until the building clears it.`}
        </div>
      </div>
    );
  }

  const q = recapQuote(game, parcels, bbl, share);
  if (!q) return null;
  return (
    <div className="deal">
      <div className="deal-head">Raise outside equity</div>
      <div className="grid">
        <Row k="Equity in the building" v={usd(q.equity)} />
        <Row k="What the market thinks of you" v={`${terms.rep.toFixed(0)} / 100 · ${lpMood(game)}`} bad={terms.rep < 35} />
        <Row k="Their terms" v={`${q.prefPct.toFixed(1)}% preferred · ${(q.promotePct * 100).toFixed(0)}% promote to you · up to ${(q.maxShare * 100).toFixed(0)}%`} />
      </div>
      {!terms.open ? (
        <div className="hint">Nobody will look at you right now. Return some capital on the deals you have.</div>
      ) : (
        <>
          <div className="slider">
            <div className="slider-head">
              <span className="slider-label">Stake to sell</span>
              <span className="slider-value">{(q.share * 100).toFixed(0)}%</span>
            </div>
            <input type="range" min={5} max={Math.round(q.maxShare * 100)} step={1}
              style={{ ["--fill" as string]: `${((q.share * 100 - 5) / Math.max(1, q.maxShare * 100 - 5)) * 100}%` }}
              value={Math.round(share * 100)} onChange={(e) => setShare(Number(e.target.value) / 100)} />
          </div>
          <div className="grid">
            <Row k="Cheque today" v={usd(q.cheque)} strong />
            <Row k="Pref they accrue in year one" v={usd(Math.round(q.cheque * q.prefPct / 100))} />
          </div>
          <div className="hint">
            You keep control and {((1 - q.share) * 100).toFixed(0)}% of the equity, plus {(q.promotePct * 100).toFixed(0)}% of
            their profit once they have their capital and their preferred return back. If the building does not clear the
            pref, the promote is worth nothing — and the pref accrues either way.
          </div>
          <button className="btn" onClick={() => raiseEquity(bbl, share)}>
            Take {usd(q.cheque)} for {(q.share * 100).toFixed(0)}%
          </button>
        </>
      )}
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

  // Emptying a building is a leasing decision before it is a demolition one.
  const bq = buyoutQuote(game, bbl);
  const occupied = (bq?.tenants ?? 0) > 0 || (h.occ ?? 0) > 0.02;
  const resSf = useSf(rec, "multifamily") * (h.occ ?? 0);
  const resCost = Math.round(resSf * useRentPsfYr(rec, game.econ, h.condition, "multifamily") * BUYOUT_PREMIUM);
  const clearCost = (bq?.cost ?? 0) + resCost;

  if (!spec && !q && !extends_.length && !occupied && !h.leasingHold) return null;
  return (
    <div className="deal">
      <div className="deal-head">Leasing desk</div>

      {/* VACANT POSSESSION. You cannot knock down an occupied building, and you
          cannot wait out a rent roll inside a human lifetime — so there are two
          ways to empty one, and they cost very different things. Stopping the
          letting is free and takes as long as the longest lease. Buying the
          leases out is instant and costs the whole remaining contract plus a
          quarter, which is why the site under a well-let building is worth less
          than the site under a half-empty one. */}
      <div className="page-section" style={{ marginTop: 2 }}>Emptying the building</div>
      <div className="grid">
        <Row k="Letting" v={h.leasingHold ? "STOPPED — nobody new, nobody renewed" : "Open — new tenants and renewals"} bad={h.leasingHold} />
        {occupied && <Row k="In place" v={`${bq?.tenants ?? 0} lease${(bq?.tenants ?? 0) === 1 ? "" : "s"}${resSf > 900 ? ` · ${sf(Math.round(resSf))} of let flats` : ""}`} />}
        {occupied && (
          <Row
            k="Longest lease runs to"
            v={h.tenants.length ? monthLabel(Math.max(...h.tenants.map((t) => t.endM))) : "—"}
          />
        )}
        {occupied && <Row k="Cost to buy them all out" v={usd(clearCost)} strong />}
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

function LandDesk({ bbl }: { bbl: string }) {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const adjacency = useStore((s) => s.adjacency);
  const { assemble, groundLease, applyVariance } = useStore.getState();
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

  const q = vacant ? groundLeaseQuote(game, parcels, bbl, years) : null;
  const cost = mergeCost(game, picked.length + 1);
  const addedArea = picked.reduce((a, b) => a + (parcels[b]?.lotArea ?? 0), 0);
  const farMax = Math.max(rec.farMaxComm, rec.farMaxRes);

  return (
    <div className="deal">
      <div className="deal-head">The land desk</div>
      {planning}
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
                <Row k="Survey, title and lawyers" v={usd(cost)} />
              </div>
              <button className="btn" onClick={() => { assemble([bbl, ...picked]); setPicked([]); }}>
                Assemble {picked.length + 1} lots · {sf(rec.lotArea + addedArea)}
              </button>
            </>
          )}
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
            the one cycle where you would have wanted to.
          </div>
          <button className="btn" onClick={() => groundLease(bbl, years)}>Grant a {years}-year ground lease</button>
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
  if (!holdings.length && !Object.keys(game.developments).length) {
    return <div className="hint">You own nothing yet. The Marketplace page has the tape; the map has everything else.</div>;
  }
  let totV = 0, totD = 0, totCF = 0;
  const rows = holdings.map((h) => {
    const rec = resolveRec(parcels, game, h.bbl);
    const v = rec ? holdingValue(rec, game.econ, h, game.month) : 0;
    const noi = rec ? holdingNOIYr(rec, game.econ, h, game.month) : 0;
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
        <Big label="Assets" value={usd(totV)} />
        <Big label="Debt" value={usd(totD)} />
        <Big label="Equity" value={usd(totV - totD)} />
        <Big label="Cash flow / mo" value={usd(totCF)} bad={totCF < 0} />
        <Big label="Buildings" value={String(holdings.length)} />
      </div>
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
      <div className="btn-row" style={{ marginTop: 10 }}>
        <button className={"btn" + (sortBy === "value" ? " btn-on" : "")} onClick={() => setSortBy("value")}>By value</button>
        <button className={"btn" + (sortBy === "income" ? " btn-on" : "")} onClick={() => setSortBy("income")}
          title="The top 50 income producers, ranked by NOI.">Top earners</button>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            {sortBy === "income" && <th className="num">#</th>}
            {/* Square feet is the denominator of every number to the right of
                it — NOI, value and debt are all quoted per foot in this
                business, and the book listed none of them against an area. */}
            <th>Property</th><th>Class</th><th className="num">Building sf</th><th className="num">Spaces</th><th className="num">Occ</th><th className="num">NOI / yr</th>
            <th className="num">Value</th><th className="num">Debt</th><th className="num">Equity</th>
            <th className="num">Debt svc / mo</th><th className="num">CF / mo</th><th>Status</th><th></th>
          </tr>
        </thead>
        <tbody>
          {shown.map(({ h, rec, v, noi, cf, occ }, i) => (
            <Fragment key={h.bbl}>
            <tr onClick={() => go(h.bbl)}>
              {sortBy === "income" && <td className="num dim">{i + 1}</td>}
              <td>{rec?.address ?? h.bbl}</td>
              <td>{rec ? useLabel(rec) : "—"}</td>
              <td className="num" title={rec && rec.bldgArea ? `${usd(v / rec.bldgArea)}/sf of value · ${usd(noi / rec.bldgArea)}/sf of NOI` : "vacant land"}>
                {rec && rec.bldgArea ? sf(rec.bldgArea) : "—"}
              </td>
              <td className="num">{rec && rec.bldgArea ? (() => { const u = unitStatus(rec, h, game.month); return `${u.leased} / ${u.total}`; })() : "—"}</td>
              <td className="num">{rec?.class === "land" ? "—" : (occ * 100).toFixed(0) + "%"}</td>
              <td className="num">{usd(noi)}</td>
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
                <td colSpan={sortBy === "income" ? 14 : 13} style={{ background: "rgba(43,37,26,0.035)" }}>
                  <RefiSection bbl={h.bbl} />
                </td>
              </tr>
            )}
            </Fragment>
          ))}
          {Object.values(game.developments).map((dv) => (
            <tr key={dv.bbl} onClick={() => go(dv.bbl)}>
              {sortBy === "income" && <td className="num dim">—</td>}
              <td>{parcels[dv.bbl]?.address ?? dv.bbl}</td>
              <td>{devUseLabel(dv.use)}</td>
              <td className="num">—</td>
              <td className="num">—</td>
              <td className="num">—</td>
              <td className="num">{usd(dv.costTotal)}</td>
              <td className="num">{usd(dv.loanBalance)}</td>
              <td className="num">{usd(dv.costTotal - dv.loanBalance)}</td>
              <td className="num">—</td>
              <td className="num neg">{usd(-(dv.loanBalance * dv.ratePct) / 100 / 12)}</td>
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
  return (
    <div className="loi">
      <button className="loi-addr" onClick={() => go(loi.bbl)}>{rec?.address ?? loi.bbl}</button>
      <div className="loi-line">
        <b>{loi.name}</b> <span className="mono">{CREDIT_LABEL[loi.credit]}</span> · {loi.sector}
        {loi.kind === "renewal" && <span className="chip chip-renewal">RENEWAL</span>}
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
        market ~${market.toFixed(2)}/sf · signing costs {usd(loiSigningCost(loi))} · answer by {monthLabel(loi.expiresM)}
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
          <button className="btn" onClick={() => { respondLoi(loi.id, "counter", true, { rentPsf: cRent, tiPsf: cTi }); setCountering(false); }}>
            Send · ${cRent.toFixed(2)}/sf{loi.tiPsf > 0 ? ` · TI $${cTi}` : ""}
          </button>
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
      <div className="loi-line mono">ask {usd(ask)}{h?.sale?.mode === "marketed" ? " · marketed campaign" : ""}</div>
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
        {/* A live negotiation is the one deal on this page you are actively
            in the middle of, so it goes first. */}
        <div className="page-section">{game.talks?.agreed ? "Under contract" : "In negotiation"} · {game.talks ? 1 : 0}</div>
        {game.talks?.agreed ? (
          <div className="hint" style={{ cursor: "pointer" }} onClick={() => go(game.talks!.bbl)}>
            <strong>{parcels[game.talks.bbl]?.address ?? game.talks.bbl}</strong> — agreed at{" "}
            <b className="mono">{usd(game.talks.agreedPrice ?? game.talks.theirPrice)}</b> with {game.talks.sellerName}.{" "}
            Nothing has moved yet: place the debt and fund it by <b>{monthLabel(game.talks.closeByM ?? game.month)}</b> or you lose it.
          </div>
        ) : game.talks ? (
          <div className="hint" style={{ cursor: "pointer" }} onClick={() => go(game.talks!.bbl)}>
            <strong>{parcels[game.talks.bbl]?.address ?? game.talks.bbl}</strong> — {game.talks.sellerName} is at{" "}
            <b className="mono">{usd(game.talks.theirPrice)}</b>, you are at {usd(game.talks.yourPrice)}.{" "}
            {game.talks.final ? "Their final word." : `Round ${game.talks.round} of ${game.talks.maxRounds}.`}
          </div>
        ) : (
          <div className="hint">Nothing on the table. Open a negotiation from any listing — one at a time.</div>
        )}
        <div className="page-section">Letters of intent · {game.lois.length}</div>
        {game.lois.length === 0 && <div className="hint">No live negotiations. Vacant space in high-demand buildings draws tenants.</div>}
        <div className="loi-grid">
          {game.lois.map((loi) => <LoiCard key={loi.id} loi={loi} go={go} />)}
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
 * THE ECONOMY, WHOLE.
 *
 * Everything outside your buildings, on one page, arranged the way a market
 * report is: the cycle at the top, then — for each asset class — the four
 * questions that decide whether to buy, hold, or build.
 *
 *   How tight is it?      vacancy against its natural rate
 *   Which way is it going? rents and vacancy over the last twenty years
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
  const [focus, setFocus] = useState<BuiltClass>("office");
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

  // history, monthly, trimmed to the last twenty years
  const tail = hist.slice(-240);
  const vacSeries = tail.map((h) => (h.vac?.[focus] ?? NATURAL_VAC[focus]) * 100);
  const rentSeries = tail.map((h) => h.rent?.[focus] ?? e.rentIdx[focus]);
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
        <Big label="Loan index" value={pct(e.indexRate)} />
        {/* The era the index is moving inside. A cycle takes rates a point or
            two either way; the era decides whether that is 3% or 13%, and it
            changes on a scale of decades — which is what makes a loan you
            struck twenty years ago a different animal at maturity. */}
        {e.rateRegime !== undefined && (
          <Big label="Rate era" value={pct(e.rateRegime)}
            bad={e.rateRegime > 9} />
        )}
        <Big label="Credit window" value={`${Math.round(e.creditIdx * 100)}%`} bad={e.creditIdx < 0.7} />
        <Big label="Employment" value={(e.employIdx * 100).toFixed(0)} />
        <Big label="Build costs" value={(e.costIdx * 100).toFixed(0)} />
        <Big label="Land index" value={(e.landIdx * 100).toFixed(0)} />
      </div>
      <div className="hint">{phaseBlurb}{e.rumoredPhase ? ` Word on the street: ${e.rumoredPhase} is coming.` : ""}</div>

      {/* ---- the four markets, at a glance ---- */}
      <div className="page-section">The space market</div>
      <div className="mkt-cards">
        {CLASSES.map((k) => {
          const b = marketBalance(e, k);
          const v = e.cityVac?.[k] ?? NATURAL_VAC[k];
          const pipe = (e.pipeline?.[k] ?? 0) / (e.stock?.[k] ?? CITY_STOCK[k]);
          return (
            <button
              key={k}
              className={"mkt-card" + (focus === k ? " mkt-card-on" : "")}
              onClick={() => setFocus(k)}
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
                ${e.rentIdx[k].toFixed(0)}/sf · {e.capRate[k].toFixed(2)}% cap · pipeline {(pipe * 100).toFixed(1)}%
              </div>
            </button>
          );
        })}
      </div>

      {/* ---- the focused class, in depth ---- */}
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
      </div>

      <div className="chart-grid">
        <div className="chart-cell">
          <div className="chart-title">Vacancy — twenty years back, three forward</div>
          <LineChart
            series={[{ label: "vacancy", color: COLOR[focus], pts: vacWithProj }]}
            bands={[{ at: NATURAL_VAC[focus] * 100, label: "natural rate" }]}
            yFmt={pctFmt}
            split={vacSeries.length}
            xLabels={[`${Math.max(2000, 2000 + Math.floor((game.month - 240) / 12))}`, `${2000 + Math.floor((game.month + 36) / 12)}`]}
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
          <div className="chart-title">Rent and cap rate</div>
          <LineChart series={[{ label: "rent", color: COLOR[focus], pts: rentSeries }]} yFmt={(v) => `$${v.toFixed(0)}`} height={92} />
          <LineChart series={[{ label: "cap", color: "#8a5620", pts: capSeries, dashed: true }]} yFmt={pctFmt} height={92} />
          <div className="chart-note">
            Rent is what the space earns; the cap rate is what the market will pay for that earning. They do not
            move together, and the gap between them is most of what makes or loses money here.
          </div>
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
      </div>
      <div className="hint">
        Everything for sale in town. A motivated seller is priced under appraisal and will not last; a half-built
        frame comes with somebody else's job attached, and you finish it. What the market is DOING — cap rates,
        the trades, comparable sales, who has been buying — is on Research.
      </div>
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
                    <td className="num">{built ? (occupancy(rec, game.econ) * 100).toFixed(0) + "%" : "—"}</td>
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

function ResearchPage() {
  const parcels = useStore((s) => s.parcels)!;
  const game = useStore((s) => s.game)!;
  const e = game.econ;
  void parcels;
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
              {(["office", "retail", "multifamily", "industrial"] as const).map((k) => {
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
        {/* THE TRADES. A separate cycle from the four asset classes above and
            the reason two identical office buildings are different assets: one
            let to insurers, one let to startups. */}
        <section style={{ gridColumn: "1 / -1" }}>
          <div className="page-section">The trades</div>
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
        </section>
        <section style={{ gridColumn: "1 / -1" }}>
          <CompsSheet />
        </section>
        <section style={{ gridColumn: "1 / -1" }}>
          <TheStreet />
        </section>
        <section style={{ gridColumn: "1 / -1" }}>
          <OwnershipRegister />
        </section>
      </div>
    </div>
  );
}

/**
 * THE REGISTER — every deed in town that belongs to a named firm.
 *
 * A firm's holdings were readable one firm at a time, folded inside a row you
 * had to know to click, and truncated at sixty. That is not how anybody looks
 * at ownership. The question is usually the other way round — who has this
 * block, who has been buying industrial, which of them owns the six lots
 * around the one I want — and that question needs the whole city in one list
 * you can sort and filter.
 */
function OwnershipRegister() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const focus = useStore((s) => s.focus);
  const setLens = useStore((s) => s.setLens);
  const lens = useStore((s) => s.lens);
  const [firm, setFirm] = useState<string>("all");
  const [sort, setSort] = useState<"value" | "firm" | "district">("value");
  const rivals = game.rivals ?? [];
  if (!rivals.length) return null;

  const rows = rivals.flatMap((r) =>
    r.bbls.map((b) => {
      const rec = resolveRec(parcels, game, b);
      if (!rec) return null;
      return {
        bbl: b, firm: r.name, firmId: r.id, dead: r.failedM !== undefined,
        stressed: (r.stressMs ?? 0) > 0, rec,
        v: assetValue(rec, game.econ, initialCondition(rec)),
      };
    }).filter(Boolean) as {
      bbl: string; firm: string; firmId: string; dead: boolean; stressed: boolean;
      rec: ReturnType<typeof resolveRec> & object; v: number;
    }[],
  );
  const shown = rows
    .filter((x) => firm === "all" || x.firmId === firm)
    .sort((a, b) =>
      sort === "firm" ? a.firm.localeCompare(b.firm) || b.v - a.v
      : sort === "district" ? (a.rec!.district ?? "").localeCompare(b.rec!.district ?? "") || b.v - a.v
      : b.v - a.v);
  const total = shown.reduce((a, x) => a + x.v, 0);

  return (
    <>
      <div className="page-section">
        Who owns what · {rows.length} buildings across {rivals.filter((r) => r.bbls.length).length} firms
      </div>
      <div className="hint">
        Every deed on this street that is not yours. What somebody owns tells you more about them than their
        balance sheet does: a firm with six lots on one block is assembling, and a firm holding nothing but
        industrial in a soft industrial market is about to be a seller.
      </div>
      <div className="btn-row">
        <button className={"btn btn-sm" + (firm === "all" ? " btn-on" : "")} onClick={() => setFirm("all")}>All firms</button>
        {rivals.filter((r) => r.bbls.length).map((r) => (
          <button key={r.id} className={"btn btn-sm" + (firm === r.id ? " btn-on" : "")} onClick={() => setFirm(r.id)}>
            {r.name} · {r.bbls.length}
          </button>
        ))}
      </div>
      <div className="btn-row">
        <button className={"btn btn-sm" + (sort === "value" ? " btn-on" : "")} onClick={() => setSort("value")}>By value</button>
        <button className={"btn btn-sm" + (sort === "firm" ? " btn-on" : "")} onClick={() => setSort("firm")}>By firm</button>
        <button className={"btn btn-sm" + (sort === "district" ? " btn-on" : "")} onClick={() => setSort("district")}>By district</button>
        <button className={"btn btn-sm" + (lens === "owners" ? " btn-on" : "")}
          onClick={() => setLens(lens === "owners" ? "none" : "owners")}
          title="Paint the map by owner — one colour per firm, your own buildings stay gold">
          {lens === "owners" ? "Owners lens on" : "Show on the map"}
        </button>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>Property</th><th>Owner</th><th>District</th><th>Class</th>
            <th className="num">Building sf</th><th className="num">Value</th><th className="num">$/sf</th><th></th>
          </tr>
        </thead>
        <tbody>
          {shown.map((x) => {
            const built = x.rec!.class !== "land" && x.rec!.bldgArea > 0;
            return (
              <tr key={x.bbl} onClick={() => focus(x.bbl, true)}>
                <td>{x.rec!.address}</td>
                <td className={x.dead ? "dim" : ""}>
                  {x.firm}{x.dead ? " · receiver" : x.stressed ? " ⚠" : ""}
                </td>
                <td className="dim">{x.rec!.district}</td>
                <td>{useLabel(x.rec as never)}</td>
                <td className="num">{built ? sf(x.rec!.bldgArea) : sf(x.rec!.lotArea) + " lot"}</td>
                <td className="num">{usd(x.v)}</td>
                <td className="num">${Math.round(x.v / Math.max(1, built ? x.rec!.bldgArea : x.rec!.lotArea))}</td>
                <td><button className="btn-mini" onClick={(ev) => { ev.stopPropagation(); focus(x.bbl, true); }}>go to</button></td>
              </tr>
            );
          })}
          {!shown.length && <tr><td colSpan={8} className="dim">Nothing held.</td></tr>}
        </tbody>
      </table>
      <div className="hint">{shown.length} buildings · {usd(total)} of gross value{firm !== "all" ? " in this firm's book" : " held by the street"}.</div>
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
                <tr key={f.name} className={f.name === "You" ? "row-me" : ""}>
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
                <td className={c.buyer === "You" ? "" : "dim"}>{c.buyer}</td>
                <td className={c.seller === "You" ? "" : "dim"}>{c.seller}</td>
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
            { name: "You", eq: playerEquity, me: true },
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
};

const CONDITION_WORD: Record<string, string> = {
  good: "well kept", standard: "adequate", worn: "run down",
};

const STYLE_WORD: Record<string, string> = {
  family: "old money",
  core: "institutional",
  opportunistic: "opportunistic",
  developer: "developer",
};

/**
 * THE INSURANCE DESK.
 *
 * The only decision in the game that costs you money every single month and
 * pays nothing back for years at a time — and then pays for the whole century
 * in one morning. A low deductible is expensive and quiet; a high one is cheap
 * and occasionally ruinous; declining flood cover on a waterfront book is free
 * money right up until the water comes over the quay.
 */
function InsuranceDesk() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const { bindInsurance } = useStore.getState();
  const pol = game.insurance;
  const [ded, setDed] = useState(pol?.deductiblePct ?? 0.025);
  const [flood, setFlood] = useState(pol?.flood ?? true);
  const iv = insuredValue(game, parcels);
  if (iv <= 0) return null;
  const q = insuranceQuote(game, parcels, ded, flood);
  const changed = !pol || pol.deductiblePct !== ded || pol.flood !== flood;
  const net = pol ? (pol.recoveredTotal ?? 0) - (pol.paidTotal ?? 0) : 0;
  return (
    <div className="page-section">
      <div className="page-section-head">Insurance</div>
      <div className="grid">
        <Row k="Insured value" v={usd(q.insuredValue)} />
        <Row k="On the water" v={`${(q.floodExposure * 100).toFixed(0)}% of the book`} bad={q.floodExposure > 0.3} />
        <Row k="Premium" v={`${usd(q.premiumYr)} / yr`} strong />
        <Row k="Deductible, per building per event" v={usd(Math.round(q.insuredValue * ded))} />
        {q.experience > 1.02 && (
          <Row k="Experience rating" v={`+${((q.experience - 1) * 100).toFixed(0)}% — underwriters remember your claims`} bad />
        )}
        {pol && <Row k="Paid in / recovered" v={`${usd(pol.paidTotal ?? 0)} / ${usd(pol.recoveredTotal ?? 0)}`} />}
        {pol && <Row k="Net, lifetime" v={(net >= 0 ? "+" : "−") + usd(Math.abs(net))} bad={net < 0} />}
      </div>
      <div className="btn-row">
        {DEDUCTIBLES.map((d) => (
          <button key={d} className={"btn" + (ded === d ? " btn-on" : "")} onClick={() => setDed(d)}>
            {(d * 100).toFixed(d < 0.02 ? 1 : 0)}% deductible
          </button>
        ))}
      </div>
      <div className="btn-row">
        <button className={"btn" + (flood ? " btn-on" : "")} onClick={() => setFlood(!flood)}>
          {flood ? "Flood cover: carried" : "Flood cover: declined"}
        </button>
        {changed && (
          <button className="btn btn-buy" onClick={() => bindInsurance(ded, flood)}>
            {pol ? "Rebind" : "Bind"} at {usd(q.premiumYr)} / yr
          </button>
        )}
      </div>
      <div className="hint">
        {!pol
          ? "You are carrying no insurance at all. Every fire, every storm and every flood is yours in full."
          : !flood && q.floodExposure > 0.15
            ? `You have declined flood cover with ${(q.floodExposure * 100).toFixed(0)}% of the book on the water. That saves real money every year and costs all of it in one morning.`
            : "A storm charges the deductible on every building it touches, not once. That is the number that matters, not the premium."}
      </div>
    </div>
  );
}

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
      {/* THE OTHER SIDE OF THE CAPITAL STACK. Debt has had a page since the
          beginning; the equity you raise from other people is the larger and
          more consequential half of it, and it needs the same accounting. */}
      {(() => {
        const j = jvSummary(game);
        const t = lpTerms(game);
        if (!j.count && (game.lpRep ?? 50) === 50) return null;
        return (
          <div className="page-section">
            <div className="page-section-head">Partner capital</div>
            <div className="grid">
              <Row k="Standing with the equity market" v={`${t.rep.toFixed(0)} / 100 · ${lpMood(game)}`} bad={t.rep < 35} />
              <Row k="What you can raise today" v={t.open
                ? `${t.prefPct.toFixed(1)}% pref · ${(t.promotePct * 100).toFixed(0)}% promote · up to ${(t.maxShare * 100).toFixed(0)}% of a deal`
                : "Nothing. Return capital first."} bad={!t.open} />
              <Row k="Partnered deals" v={String(j.count)} />
              <Row k="Capital raised, live" v={usd(j.raised)} />
              <Row k="Unreturned capital" v={usd(j.unreturned)} bad={j.unreturned > 0} />
              <Row k="Preferred accrued and unpaid" v={usd(j.pref)} bad={j.pref > j.raised * 0.12} />
              <Row k="Promote earned, lifetime" v={usd(j.promote)} strong />
            </div>
          </div>
        );
      })()}
      <InsuranceDesk />
      <CreditLine />
      <div className="page-section">
        <div className="page-section-head">The ledger, by year</div>
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
      </div>
      <div className="deal-note">
        {r.balanced
          ? "Jobs, housing and street life are in balance here — every added foot compounds."
          : WANTS_LABEL[r.wants]}
      </div>
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
