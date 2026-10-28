// Property panel shell — glance card + tab router for one selected deed.
// Deal desks live in sibling modules so this file stays the wiring, not the warehouse:
//   AcquireDesk   buy / sell / list / ground lease / disclosed roll / vacant possession
//   RefiDesk      permanent debt on a deed
//   DevelopDesk   ground-up + adaptive reuse (Programme · Design · Financing)
import { consentFor } from "@/engine/vehicles";
import { marketAppraisal } from "@/engine/value";
import { memo, useEffect, useRef, useState } from "react";
import { useStore } from "@/state/store";
import { useHeldGame } from "@/ui/heldGame";
import { useMasonry } from "@/ui/useMasonry";
import { CLASS_COLOR, CLASS_LABEL, type ReservedParcel } from "@/data/types";
import { monthLabel, CREDIT_LABEL, START_YEAR } from "@/engine/types";
import { OpsChoices } from "@/ui/panels/OpsChoices";
import type { BuiltClass } from "@/engine/types";
import { initialCondition, recoveryOf, marketRentPsfYr, flatsRollPsf, flatsMarkPsf, renovationCost, resolveRec, propertyTaxYr, useRentPsfYr, operatingStatement, landValue, proFormaNOIYr, remainingAbatement, landRead, rentableSf, rentableRatio, plateOf, useRentableSf } from "@/engine/value";
import { PROGRAMS, programCost, demolitionCost, takeoverEquityNeed } from "@/engine/dev";
import { assemblagePressure, hasOwnedSiteNeighbor, siteDeeds } from "@/engine/actions";
import { currentAskPsfYr } from "@/engine/absorption";
import { isCommercial, vacantSf, useVacantSf, walt, notReadySf, unitStatus, unitCount, suiteSf, avgUnitSf, renewalIntent, minLettableSf, unlettableRemainderSf, planIsLive, autoLeaseRule, autoTiCapToday } from "@/engine/leasing";
import { StackingList } from "@/ui/panels/StackingList";
import { stacksOf } from "@/engine/plates";
import { supportableOcc } from "@/engine/absorption";
import { dscr, ltv, payOffDue, rateCapCost, capStrikeFor, prepayPenalty, equityCureNeed } from "@/engine/debt";
import { fundableNow } from "@/engine/credit";
import { demandNow } from "@/engine/demand";
import { leaseholdQuote, landBuybackCost, LEASEHOLD_STEP } from "@/engine/leasehold";
import { stakeQuote, buyoutCost, JV_SHARES, JV_MINORITY_DISCOUNT } from "@/engine/jv";
import { syndicateView } from "@/engine/syndicate";
import { recapQuote } from "@/engine/recap";
import { isMixedUse, mixLabel, mixOf, uses as usesOf, useSf, USE_WORD, dominantUse } from "@/engine/mix";
import { ownerAt } from "@/engine/ownership";
import { taxAppealQuote } from "@/engine/tax";
import { usd, sf, pct, termLeft, pctSigned } from "@/ui/format";
import { LettingOdds, MinDealSize, LeasingDesk, ResidualRead, LandDesk, AssembleCard } from "@/ui/panels/PropertyDesks";
import { VacantPossession, DisclosedRoll, SaleSection, OffMarketCounter, BlindBidDesk, OfferDesk, BuyButtons } from "@/ui/panels/AcquireDesk";
import { RefiSection, RefiGlance } from "@/ui/panels/RefiDesk";
import { DevelopSection, DevelopGlance, ReuseSection } from "@/ui/panels/DevelopDesk";
import { useLabel, occRead, occLabel, occTitle, goingIn, band, apMid, PropTab, openViewOn, Neighbourhood, Row, STYLE_WORD, ShortBy } from "@/ui/panels/shared";
import { Gloss } from "@/ui/Glossary";
import { entitleQuote, platQuote, PLAT_LOT_SIZES, INDUSTRIAL_LOT_SIZES } from "@/engine/landdev";
import { platHomesView, tractLotQuote, houseValue, sfrRentMo } from "@/engine/homes";
import { tractYield } from "@/engine/platdesign";
import { SplitTab } from "@/ui/next/SplitTab";
import { splittable } from "@/engine/lotsplit";

// Re-exports so Portfolio / Debt / older imports keep a stable path.
export {
  VacantPossession, DisclosedRoll, SaleSection, OffMarketCounter, BlindBidDesk,
  OfferDesk, BuyButtons, GroundLeaseSection, ListSection,
} from "@/ui/panels/AcquireDesk";
export { RefiSection } from "@/ui/panels/RefiDesk";
export { DevelopSection, ReuseSection } from "@/ui/panels/DevelopDesk";

// WHAT EACH KIND OF SHOP WANTS, which is what decides whether they are your
// competition on this building or your buyer for it next year. Lifted out of
// the ownership block above when that block stopped having three branches.
const DOCTRINE: Record<string, string> = {
  family: "Long-term hold. Sells on succession, not market timing.",
  core: "Stabilised assets only. Price-disciplined; exits in a downturn.",
  opportunistic: "Aggressive late-cycle buyer.",
  developer: "Buys land to build. Assembles sites.",
  merchant: "Builds to sell. All assets for sale at a price.",
  pe: "Fund-life driven. Must transact.",
  reit: "Buys when share price is high; stops when it falls.",
  vulture: "Distressed buyer.",
  owneruser: "Owner-occupier. Less price-sensitive.",
  foreign: "Offshore capital. Slow to buy and sell; inactive in a crisis.",
  slumlord: "Minimal capex, maximum extraction.",
};

function ParcelPanelShell({ embedded = false, tab }: { embedded?: boolean; tab?: PropTab } = {}) {
  // Closed card: do not subscribe to `game` at all — every LOI/cash write used
  // to rebuild this whole file for a panel that was not on screen.
  const selectedBBL = useStore((s) => s.selectedBBL);
  // the region's reserved land (a neighbourhood, a farm, the parish) has a card of its own: no desk can trade it
  const reserved = useStore((s) => (s.selectedBBL ? s.city?.reserved?.[s.selectedBBL] : undefined));
  if (!selectedBBL) return null;
  if (reserved) return <ReservedCard rec={reserved} embedded={embedded} />;
  // Keyed on the deed: a new building is a new card. The card kept the last
  // one's scroll offset, so clicking a second building after reading the foot
  // of the first opened it at "Adjoining lots", and per-building drafts (an
  // offer half typed) could carry across.
  return <ParcelPanelInner key={selectedBBL} embedded={embedded} tab={tab} selectedBBL={selectedBBL} />;
}

/**
 * LAND THE MARKET DOES NOT REACH (the region map, Phase 1). A neighbourhood is
 * one parcel for a whole subdivision, a farm tract is farmland, the parish is
 * the parish: the card says what is there, in the generator's own numbers. It
 * carries no price — no mechanism in this engine prices an owner-occupied
 * house or an acre of corn yet, and a number with nothing behind it would be a
 * fake (CLAUDE.md). Homebuilders, land development and the farmland market are
 * later phases.
 */
function ReservedCard({ rec, embedded }: { rec: ReservedParcel; embedded: boolean }) {
  const select = useStore((s) => s.select);
  const acres = rec.acres ?? rec.lotArea / 43560;
  const kind = rec.kind === "neighbourhood" ? "Neighbourhood" : rec.kind === "rural" ? "Rural home" : rec.kind === "civic" ? "Church and school" : rec.kind === "woodlot" ? "Woodlot" : "Farm";
  const era = rec.era === "prewar" ? "pre-war streetcar suburb" : rec.era === "postwar" ? "post-war subdivision" : rec.era === "recent" ? "1980s-and-after subdivision" : null;
  const why = rec.tenure === "homes"
    ? "Owner-occupied homes. Not for sale."
    : rec.tenure === "farm"
      ? "Agricultural land. Not buildable or tradeable."
      : "Parish and school district land. Not for sale.";
  return (
    <div className={embedded ? "panel-embed" : "panel"}>
      {!embedded && (
        <div className="panel-head">
          <div>
            <div className="panel-address">{rec.address}</div>
            <div className="panel-bbl mono">Parcel {rec.bbl}</div>
          </div>
          <button className="panel-close" onClick={() => select(null)} aria-label="Close">×</button>
        </div>
      )}
      <div className="chip-row">
        <span className="chip" style={{ background: CLASS_COLOR[rec.class] }}>{kind}</span>
        <span className="chip chip-zone mono">{rec.zoneDist}</span>
        <span className="chip">NOT ON THE MARKET</span>
      </div>
      <div className="hint" style={{ marginBottom: 8 }}>{why}</div>
      {rec.homes ? <Row k="Homes" v={rec.homes.toLocaleString()} strong /> : null}
      {era && <Row k="Built as" v={`${era}, ${rec.eraYears?.[0] ?? rec.yearBuilt}–${rec.eraYears?.[1] ?? rec.yearBuilt}`} />}
      {rec.yearBuilt > 0 && !era && <Row k="Built" v={String(rec.yearBuilt)} />}
      {rec.avgHouseSf ? <Row k="Average house" v={sf(rec.avgHouseSf)} /> : null}
      {rec.avgLotSf ? <Row k="Average lot" v={sf(rec.avgLotSf)} /> : null}
      {rec.platLots && rec.homes ? <Row k="Platted lots" v={`${rec.platLots.toLocaleString()} (${(rec.platLots - rec.homes).toLocaleString()} not built yet)`} /> : null}
      {rec.leapfrog && <Row k="Leapfrog" v="built beyond unsold farms" />}
      <Row k="Land" v={acres >= 2 ? `${acres.toFixed(acres >= 20 ? 0 : 1)} acres` : sf(rec.lotArea)} />
      {rec.bldgArea > 0 && <Row k="Floor area" v={sf(rec.bldgArea)} />}
      {rec.crop && <Row k="This season" v={rec.crop} />}
      {rec.floodShare ? <Row k="In the floodplain" v={`${Math.round(rec.floodShare * 100)}%`} /> : null}
      {rec.districtName && <Row k="Area" v={rec.districtName} />}
    </div>
  );
}

/**
 * THE LAND DEVELOPER'S DESK (region map, engine/landdev.ts): a farm tract you
 * own — rezone it, then build its streets and cut it into lots. Every number
 * on it is the engine's own quote.
 */
function LandDevCard({ bbl }: { bbl: string }) {
  const game = useStore((s) => s.game);
  const parcels = useStore((s) => s.parcels);
  const fileRezoning = useStore((s) => s.fileRezoning);
  const buildPlat = useStore((s) => s.buildPlat);
  const [lotSf, setLotSf] = useState<number>(7500);
  const rec = parcels?.[bbl];
  if (!game || !parcels || !rec?.ag || !rec.tract) return null;
  const owned = !!game.holdings[bbl];
  const app = game.entitlementApps?.[bbl];
  const rz = game.rezoned?.[bbl];
  const plat = game.plats?.[bbl];
  const acres = rec.lotArea / 43560;
  return (
    <div className="deal" style={{ marginTop: 6 }}>
      <div className="deal-head">Land development</div>
      <div className="hint">
        {rec.ag === "wood" ? "Woodland" : "Farmland"}, {acres.toFixed(0)} acres, {rz ? `rezoned ${rz.zone} (FAR ${rz.far}), farmed until site work` : "agricultural zoning, valued as farm"}.
        {" "}{((rec.buildableSf ?? rec.lotArea) / 43560).toFixed(0)} buildable acres{rec.buildableSf !== undefined && rec.buildableSf < rec.lotArea * 0.95 ? " (rest floodplain or unavailable)" : ""}; {(rec.tract.edgeM / 1000).toFixed(1)} km from town edge.
      </div>
      <LandProForma bbl={bbl} lotSf={rz?.lotSf ?? lotSf} />
      {!owned && <div className="hint">Buy, rezone, subdivide into lots.</div>}
      {owned && !app && !rz && (() => {
        const planned = tractYield(rec, lotSf).n;
        const q = entitleQuote(game, parcels, bbl, lotSf, planned);
        return (
          <>
            <div className="btn-row">
              {PLAT_LOT_SIZES.map((v) => (
                <button key={v} type="button" className={"btn-mini" + (v === lotSf ? " on" : "")} onClick={() => setLotSf(v)}>{v.toLocaleString()} sf lots</button>
              ))}
            </div>
            <div className="btn-row" title="Industrial park lots: warehouse, flex, plant.">
              {INDUSTRIAL_LOT_SIZES.map((v) => (
                <button key={v} type="button" className={"btn-mini" + (v === lotSf ? " on" : "")} onClick={() => setLotSf(v)}>{Math.round(v / 43560)} ac park lots</button>
              ))}
            </div>
            {q ? (
              <>
                <Row k="Lots" v={q.lots.toLocaleString()} />
                <Row k="Rezoning to" v={`${q.zone}, FAR ${q.far}`} />
                <Row k="Entitlement cost" v={usd(q.cost)} />
                <Row k="Decision" v={`${q.months} mo · ${Math.round(q.odds * 100)}% odds`} />
                <button type="button" className="btn btn-sm" onClick={() => fileRezoning(bbl, lotSf)}>Apply for permits · {usd(q.cost)}</button>
              </>
            ) : <div className="hint">Not enough buildable land for this lot size.</div>}
          </>
        );
      })()}
      {app && <Row k="Permits under review" v={`decision ${monthLabel(app.decideM)} · ${app.lots} lots · ${Math.round(app.odds * 100)}% odds`} />}
      {owned && rz && !plat && (() => {
        const lots = tractYield(rec, rz.lotSf).lots;
        const q = platQuote(game, lots, rz.lotSf, parcels, bbl);
        return (
          <>
            <Row k="Rezoned" v={`${rz.zone}, FAR ${rz.far}, ${lots.length} lots of ~${rz.lotSf.toLocaleString()} sf`} />
            <Row k="Site work + impact fees" v={`${usd(q.cost)} · ${usd(q.perLot)} a lot`} />
            <Row k="Built in" v={`${q.months} months`} />
            <button type="button" className="btn btn-sm" onClick={() => buildPlat(bbl)}>Build site work</button>
          </>
        );
      })()}
      {plat && !plat.done && <Row k="Site work" v={`${plat.lots.length} lots, finished ${monthLabel(plat.doneM)}`} />}
      {!plat && (() => {
        // what a finished lot here would fetch from a homebuilder today (engine/homes.ts)
        const lsf = rz?.lotSf ?? lotSf;
        const n = tractYield(rec, lsf).n;
        const t = tractLotQuote(game, parcels, bbl, lsf, n);
        return (
          <>
            <Row k="House · lot residual" v={`${usd(t.quote.price)} · ${usd(t.quote.residual)}`} />
            <Row k="Sell-out" v={`${t.pace.toFixed(1)}/mo · ×${t.disc.toFixed(2)} → ${usd(t.lotValue)} a lot`} />
          </>
        );
      })()}
    </div>
  );
}

/**
 * THE LOT DEVELOPMENT PRO FORMA AND TIMELINE (owner: "a rough basic proforma
 * before you start … how much each stage costs and the estimated timeline",
 * and "how much longer is left for each stage as it progresses"). Three
 * stages — permits (the rezoning), streets and utilities, lot sales — each
 * with its cost or revenue, its length, and once under way a bar and the
 * months left. Every figure is the engine's own quote (landdev.ts entitleQuote
 * / platQuote, homes.ts tractLotQuote / platHomesView); once a stage has
 * started its record's real dates replace the estimate.
 */
function LandProForma({ bbl, lotSf }: { bbl: string; lotSf: number }) {
  const game = useStore((s) => s.game);
  const parcels = useStore((s) => s.parcels);
  const rec = parcels?.[bbl];
  if (!game || !parcels || !rec?.tract) return null;
  const m = game.month;
  const app = game.entitlementApps?.[bbl];
  const rz = game.rezoned?.[bbl];
  const plat = game.plats?.[bbl];
  const yld = tractYield(rec, lotSf);
  const n = plat?.lots.length ?? yld.n;
  if (n <= 0) return null;
  const eq = entitleQuote(game, parcels, bbl, lotSf, yld.n);
  const pq = platQuote(game, yld.lots, lotSf, parcels, bbl);
  const tq = tractLotQuote(game, parcels, bbl, lotSf, n);
  const hv = plat?.done ? platHomesView(game, parcels, bbl) : null;
  const h = game.holdings[bbl];
  const listing = game.listings.find((l) => l.bbl === bbl);
  const land = h?.costBasis ?? listing?.ask ?? null;
  const pace = hv?.pace ?? tq.pace;
  const sellMo = pace > 0 ? Math.ceil(n / pace) : Infinity;
  type St = { k: string; money: number; months: number; start?: number; end?: number; done: boolean; note?: string };
  const stages: St[] = [
    { k: "Permits (rezoning)", money: -(app?.cost ?? eq?.cost ?? 0), months: app ? app.decideM - app.filedM : eq?.months ?? 0,
      start: app?.filedM ?? rz?.m, end: app?.decideM ?? rz?.m, done: !!rz,
      note: rz ? `granted ${monthLabel(rz.m)}` : app ? `${Math.round(app.odds * 100)}% odds` : eq ? `${Math.round(eq.odds * 100)}% odds` : undefined },
    { k: "Streets & utilities", money: -(plat?.cost ?? pq.cost), months: plat ? plat.doneM - plat.startM : pq.months,
      start: plat?.startM, end: plat?.doneM, done: !!plat?.done },
    { k: "Lot sales to builders", money: n * tq.lotValue, months: Number.isFinite(sellMo) ? sellMo : 0,
      start: plat?.done ? plat.doneM : undefined, end: plat?.done && Number.isFinite(sellMo) ? plat.doneM + sellMo : undefined,
      done: !!hv && hv.left === 0, note: hv ? `${n - hv.left} of ${n} sold · ${pace.toFixed(1)}/mo` : `${pace.toFixed(1)}/mo · ${usd(tq.lotValue)} a lot` },
  ];
  const cost = (land ?? 0) - stages[0].money - stages[1].money;
  const rev = stages[2].money;
  const totalMo = stages.reduce((a, x) => a + x.months, 0);
  return (
    <div className="proforma">
      <div className="proforma-head">Pro forma · {n} lots · about {totalMo} months</div>
      <table className="tbl proforma-tbl">
        <tbody>
          {stages.map((x) => {
            const live = x.start !== undefined && !x.done && m >= x.start;
            const span = Math.max(1, x.months);
            const pct = x.done ? 1 : live ? Math.min(1, (m - x.start!) / span) : 0;
            const left = live && x.end !== undefined ? Math.max(0, x.end - m) : null;
            return (
              <tr key={x.k}>
                <td>
                  <div>{x.done ? "✓ " : live ? "▶ " : ""}{x.k}</div>
                  <div className="proforma-bar"><i style={{ width: `${(pct * 100).toFixed(0)}%` }} className={x.done ? "done" : ""} /></div>
                  <div className="dim proforma-note">
                    {x.done ? "done" : live ? `${left} mo left · ends ${monthLabel(x.end!)}` : `${x.months} mo`}{x.note ? ` · ${x.note}` : ""}
                  </div>
                </td>
                <td className={"num mono " + (x.money < 0 ? "neg" : "pos")}>{x.money < 0 ? `−${usd(-x.money)}` : usd(x.money)}</td>
              </tr>
            );
          })}
          {land !== null && <tr><td>Land{h ? " (your basis)" : " (ask)"}</td><td className="num mono neg">−{usd(land)}</td></tr>}
          <tr className="proforma-total"><td>Profit before tax{land === null ? " (ex land)" : ""}</td><td className={"num mono " + (rev - cost >= 0 ? "pos" : "neg")}>{usd(rev - cost)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

/**
 * THE LOTS DESK (region map, engine/homes.ts): one plat, as the homebuilders
 * read it. The house, its cost and the residual left for the lot; what a
 * builder would bid, how fast the plat sells out, who is building; and your
 * lot sales — offers to sign or pass, and listing the plat to the builders.
 */
export function HomesCard({ bbl }: { bbl: string }) {
  const game = useStore((s) => s.game);
  const parcels = useStore((s) => s.parcels);
  const listLots = useStore((s) => s.listLots);
  const delistLots = useStore((s) => s.delistLots);
  const takeLotOffer = useStore((s) => s.takeLotOffer);
  const refuseLotOffer = useStore((s) => s.refuseLotOffer);
  const [mark, setMark] = useState(1);
  const rec = parcels?.[bbl];
  if (!game || !parcels || !rec?.homeLot || !rec.block) return null;
  const parent = rec.block;
  const v = platHomesView(game, parcels, parent);
  if (!v) return null;
  const q = v.quote, b = v.bids;
  const unit = game.homes?.units[bbl];
  const lotSf = q.residualPsf > 0 ? q.residual / q.residualPsf : rec.lotArea;
  const pct1 = (x: number) => `${(x * 100).toFixed(0)}%`;
  const months = Number.isFinite(b.months) ? `${Math.ceil(b.months)} mo` : "never";
  const askT = +(b.takedownPsf * mark).toFixed(2);
  const askB = +(b.bulkPsf * mark).toFixed(2);
  return (
    <div className="deal" style={{ marginTop: 6 }}>
      <div className="deal-head">Lots · {v.lots} on the plat</div>
      {unit && <Row k="This lot" v={unit.closedM !== undefined ? `a family's · sold ${monthLabel(unit.closedM)} · ${usd(unit.price ?? 0)}` : `${unit.by} · ${unit.soldM !== undefined ? "signed" : "for sale"} · done ${monthLabel(unit.doneM)}`} />}
      <Row k="House" v={`${sf(q.sf)} · ${usd(q.price)} · $${(q.price / q.sf).toFixed(0)}/sf`} />
      <Row k="Build · sell · carry · margin" v={`${usd(q.vertical + q.overhead)} · ${usd(q.selling)} · ${usd(q.carry)} · ${usd(q.margin)}`} />
      <Row k="Lot residual" v={`${usd(q.residual)} · ${pct1(q.residual / Math.max(1, q.price))} of price`} strong />
      <Row k="Sells" v={`${v.pace.toFixed(1)} houses/mo · ${v.left} lots left · ×${v.disc.toFixed(2)}`} />
      <Row k="Bid · takedown" v={`$${b.takedownPsf.toFixed(2)}/sf · ${usd(b.takedownPsf * lotSf)} a lot · ~${b.pace.toFixed(1)}/mo · ${months}`} />
      <Row k="Bid · whole plat" v={`$${b.bulkPsf.toFixed(2)}/sf · ${usd(b.bulkPsf * lotSf * Math.max(1, v.free))} for ${v.free}`} />
      <Row k="Mortgage · location" v={`${(((game.econ.indexRate ?? 5.4) / 100 + 0.017) * 100).toFixed(2)}% · ×${v.loc.toFixed(2)}`} />
      <Row k="Yours" v={`${v.mine} lots · ${v.free} free`} />
      {v.builders.map((x) => <Row key={x.name} k={x.name} v={`${x.held} held · ${x.building} bldg · ${x.closed} sold · cash ${usd(x.cash)} · debt ${usd(x.debt)}${x.failed ? " · failed" : ""}`} />)}
      {v.pl && v.pl.lotsSold > 0 && (
        <Row k="Sold to date" v={`${v.pl.lotsSold} lots · ${usd(v.pl.lotRevenue)} · gain ${usd(v.pl.lotProceeds - v.pl.lotBasis)}`} />
      )}
      {v.contract && <Row k="Takedown" v={`${v.contract.builder} · ${v.contract.taken} taken · ${v.contract.left} left · $${v.contract.psf.toFixed(2)}/sf`} />}
      {v.offer && (
        <>
          <Row k="Offer" v={`${v.offer.builder} · ${v.offer.kind === "bulk" ? "all" : "takedown"} ${v.offer.lots} · $${v.offer.psf.toFixed(2)}/sf · to ${monthLabel(v.offer.expiresM)}`} strong />
          <div className="btn-row">
            <button type="button" className="btn btn-sm" onClick={() => takeLotOffer(parent)}>Sign</button>
            <button type="button" className="btn-mini" onClick={() => refuseLotOffer(parent)}>Pass</button>
          </div>
        </>
      )}
      {v.listing && (
        <div className="btn-row">
          <span className="hint">Listed {v.listing.bulk ? "whole" : "takedown"} at ${v.listing.askPsf.toFixed(2)}/sf</span>
          <button type="button" className="btn-mini" onClick={() => delistLots(parent)}>Pull</button>
        </div>
      )}
      {v.free > 0 && !v.listing && b.takedownPsf > 0 && (
        <>
          <div className="btn-row">
            {[0.9, 1, 1.1].map((m) => (
              <button key={m} type="button" className={"btn-mini" + (m === mark ? " on" : "")} onClick={() => setMark(m)}>{m === 1 ? "At bid" : `${m > 1 ? "+" : "−"}${Math.round(Math.abs(m - 1) * 100)}%`}</button>
            ))}
          </div>
          <div className="btn-row">
            {!v.contract && <button type="button" className="btn-mini" onClick={() => listLots(parent, askT, false)}>List takedown ${askT.toFixed(2)}</button>}
            <button type="button" className="btn-mini" onClick={() => listLots(parent, askB, true)}>List whole ${askB.toFixed(2)}</button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * A HOUSE (engine homes.ts): a family's home or a single-family rental, never
 * commercial space. What it is, who has it, what it is worth as a house.
 */
function HouseCard({ bbl, embedded }: { bbl: string; embedded?: boolean }) {
  const game = useStore((s) => s.game);
  const parcels = useStore((s) => s.parcels);
  const select = useStore((s) => s.select);
  const rec = parcels && game ? resolveRec(parcels, game, bbl) : null;
  const u = game?.homes?.units[bbl];
  if (!game || !parcels || !rec || !u) return null;
  const owner = u.closedM === undefined ? `${u.by} (builder)` : u.tenure === "sfr" ? "SFR investor" : "owner-occupier";
  return (
    <div className={embedded ? "panel-embed" : "panel"}>
      {!embedded && (
        <div className="panel-head">
          <div>
            <div className="panel-address">{rec.address}</div>
            <div className="panel-bbl mono">Parcel {rec.bbl}</div>
          </div>
          <button className="panel-close" onClick={() => select(null)} aria-label="Close">×</button>
        </div>
      )}
      <div className="chip-row">
        <span className="chip" style={{ background: CLASS_COLOR.house }}>HOUSE</span>
        <span className="chip chip-zone mono">{rec.zoneDist}</span>
        <span className="chip">NOT ON THE MARKET</span>
      </div>
      <Row k="House" v={`${sf(rec.bldgArea)} · ${rec.floors} fl · ${rec.yearBuilt} · lot ${sf(rec.lotArea)}`} strong />
      <Row k="Owner" v={owner} />
      {u.price ? <Row k="Sold" v={`${usd(u.price)}${u.closedM !== undefined ? ` · ${monthLabel(u.closedM)}` : " · signed"}`} /> : null}
      <Row k="Value" v={usd(houseValue(game, parcels, bbl))} />
      {u.tenure === "sfr" && <Row k="Rent" v={`${usd(sfrRentMo(game))}/mo`} />}
      <HomesCard bbl={bbl} />
    </div>
  );
}

function ParcelPanelInner({
  embedded = false, tab, selectedBBL,
}: { embedded?: boolean; tab?: PropTab; selectedBBL: string }) {
  const parcels = useStore((s) => s.parcels);
  const adjacency = useStore((s) => s.adjacency);
  const select = useStore((s) => s.select);
  const game = useHeldGame(selectedBBL);
  const { renovate, approach } = useStore.getState();
  // Which parcel has a demolition order waiting for a signature. Keyed by BBL
  // rather than a bare boolean so selecting a different building simply
  // dismisses the question instead of asking it about the wrong address.
  const [razeAsk, setRazeAsk] = useState<string | null>(null);
  const masonry = useMasonry();
  // SUMMARY UNTIL ASKED. This flipped to the full offering memorandum —
  // seventy-odd rows — once the campaign passed month 12, on the theory that a
  // veteran wants everything. A veteran who does picks Full OM once and the
  // card remembers; everyone else gets a glance card that fits on the screen.
  const [omFull, setOmFullState] = useState(() => {
    try { return localStorage.getItem("bw:om") === "full"; } catch { return false; }
  });
  const setOmFull = (v: boolean) => {
    setOmFullState(v);
    try { localStorage.setItem("bw:om", v ? "full" : "summary"); } catch { /* storage blocked */ }
  };

  if (!parcels) return null;
  const rec = resolveRec(parcels, game, selectedBBL);
  if (!rec) return null;
  if (rec.class === "house") return <HouseCard bbl={selectedBBL} embedded={embedded} />;
  const dev = game.developments[selectedBBL];
  // AN ASSEMBLED SITE'S NEIGHBOURS ARE THE SITE'S: every lot touching any of
  // its deeds, less the deeds themselves — not the parent lot's old neighbours,
  // which listed the site's own folded lots as "adjoining".
  const neighbors = (() => {
    const deeds = siteDeeds(game, selectedBBL);
    if (deeds.length === 1) return adjacency?.[selectedBBL] ?? [];
    const mine = new Set(deeds);
    return [...new Set(deeds.flatMap((d) => adjacency?.[d] ?? []))].filter((n) => !mine.has(n));
  })();
  const holding = game.holdings[selectedBBL];
  const listing = game.listings.find((l) => l.bbl === selectedBBL);
  const appr = game.approaches[selectedBBL];
  const cond = holding?.condition ?? initialCondition(rec);
  // ONE APPRAISAL — the one the header, the lender and the net worth read.
  // This card used to add a "hedonic location premium" on the land slice that
  // no sale, no lender and no mark ever paid, so it disagreed with the page
  // header above it by the premium on every corner, waterfront and high street
  // lot, and the sale desk below priced your listing against it.
  const value = marketAppraisal(game, rec, selectedBBL, cond);
  const dupe = embedded && !!holding;
  const builtFar = rec.lotArea > 0 ? rec.bldgArea / rec.lotArea : 0;
  const farMax = Math.max(rec.farMaxComm, rec.farMaxRes);
  // A ground lessee's building stands on your deed — it is not yours to let.
  const isBuilt = rec.class !== "land" && rec.bldgArea > 0 && !holding?.groundLeased;
  const renovating = holding?.renovatingUntilM !== undefined && game.month < (holding.renovatingUntilM ?? 0);
  const commercial = isCommercial(rec);
  const leasedSf = holding && commercial ? holding.tenants.reduce((s2, t) => s2 + t.sf, 0) : 0;
  const d = holding ? dscr(rec, game, holding) : null;
  const l = holding ? ltv(rec, game, holding) : null;
  const taxAppeal = holding ? taxAppealQuote(game, parcels, selectedBBL) : null;
  // No tab means the docked card on the map. It used to run every section of
  // the file stacked — 6,000px and four dozen buttons for one owned building,
  // with Summary and Full OM differing by two rows. The card is a glance now:
  // the overview, plus the buy desk when the building is not yours (that is
  // why you clicked it), and a row of doors into the property file's tabs.
  // Full OM brings the whole file back for whoever wants it on the map.
  const on = (t: PropTab) => tab === undefined
    ? (omFull || t === "summary" || (t === "deal" && !holding))
    : tab === t;
  // Land desk: property-page Build tab always; docked card only when the lot
  // can assemble / is land / is already folded — not on every leased tower.
  // Ground-leased lots stay on this desk even after the lessee's frame rises.
  // (owner, Oct 2026: the land desk — FAR to request, the ground lease, assembly — is the
  // property's Overview business, not the Build desk's)
  const showLandDesk = !!holding && on("summary") && (
    tab === "summary"
    || rec.class === "land"
    || !!holding.groundLeased
    || !!holding.groundOffer
    || !!game.merged?.[selectedBBL]
    || siteDeeds(game, selectedBBL).length > 1
    || !!(adjacency && hasOwnedSiteNeighbor(game, adjacency, selectedBBL))
  );

  return (
    <div className={embedded ? "panel-embed" : "panel"} ref={embedded ? masonry : undefined}>
      {!embedded && (
        <div className="panel-head">
          <div>
            <div className="panel-address">{rec.address}</div>
            <div className="panel-bbl mono">Parcel {rec.bbl}</div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
            <button className="btn-mini" title="Open full property page" onClick={() => useStore.getState().setPage("property")}>full view</button>
            <button className="panel-close" onClick={() => select(null)} aria-label="Close">×</button>
          </div>
        </div>
      )}

      {on("summary") && <div className="chip-row">
        {!dupe && <span className="chip" style={{ background: CLASS_COLOR[rec.class] }}>{useLabel(rec)}</span>}
        {!dupe && <span className="chip chip-zone mono">{rec.zoneDist}</span>}
        {holding && !dupe && <span className="chip chip-owned">OWNED</span>}
        {holding?.groundLeased && game.groundLeases?.[selectedBBL] && (game.built?.[selectedBBL]?.bldgArea || game.groundLeases[selectedBBL].builtM !== undefined) && (
          <span className="chip">LESSEE BUILT</span>
        )}
        {dev && <span className="chip chip-reno">UNDER CONSTRUCTION</span>}
        {listing && !holding && <span className="chip chip-listed">FOR SALE</span>}
        {listing?.distress && !holding && <span className="chip chip-distress">MOTIVATED SELLER</span>}
        {holding?.sale && <span className="chip chip-listed">LISTED · {usd(holding.sale.ask)}</span>}
        {renovating && <span className="chip chip-reno">RENOVATING</span>}
        {holding?.loan?.sweep && <span className="chip chip-sweep">CASH SWEEP</span>}
        {game.landmarks?.[selectedBBL] !== undefined && <span className="chip chip-reno">LANDMARKED</span>}
      </div>}
      {on("summary") && rec.ag && <LandDevCard bbl={selectedBBL} />}
      {on("summary") && rec.homeLot && <HomesCard bbl={selectedBBL} />}

      {on("summary") && !embedded && (
        <div className="btn-row" style={{ marginBottom: 8 }}>
          <button
            type="button"
            className={"btn-mini" + (!omFull ? " on" : "")}
            onClick={() => setOmFull(false)}
            title="Price, occupancy, key risk"
          >
            Summary
          </button>
          <button
            type="button"
            className={"btn-mini" + (omFull ? " on" : "")}
            onClick={() => setOmFull(true)}
            title="Full offering memorandum"
          >
            Full OM
          </button>
        </div>
      )}
      {tab === undefined && !embedded && !omFull && holding && (
        <div className="btn-row card-doors" style={{ marginBottom: 10 }}>
          {([
            ["leasing", "Rent roll", isBuilt],
            ["money", "Money", isBuilt || !!holding.loan || !!holding.groundLeased],
            ["ops", "Operations", isBuilt],
            ["deal", "Sell", true],
            ["build", isBuilt ? "Convert / Build" : "Build", true],
          ] as const).filter(([, , show]) => show).map(([t, label]) => (
            <button key={t} type="button" className="btn-mini"
              title={`Open ${label}`}
              onClick={() => useStore.getState().openProperty(selectedBBL, t)}>
              {label} →
            </button>
          ))}
        </div>
      )}

      {on("summary") && holding && !dev && <AssembleCard bbl={selectedBBL} />}
      {(on("summary") || on("build")) && holding && !dev && !parcels?.[selectedBBL]?.tract && <SplitCard key={selectedBBL} bbl={selectedBBL} />}
      {on("summary") && holding && !dev && (() => {
        const read = landRead(rec, game.econ);
        const room = farMax > 0 ? Math.max(0, 1 - builtFar / farMax) : 0;
        const dirt = rec.class === "land" || !rec.bldgArea;
        const vacant = dirt || room >= 0.25;
        if (!vacant || game.landmarks?.[selectedBBL] !== undefined) return null;
        // ON DIRT the builder's residual only has to exist. ON A BUILT LOT it
        // has to beat the building: a rebuild pencils when the dirt, cleared,
        // is worth more to a builder than what stands on it is worth today —
        // the appraisal per foot of lot. The first cut of this card compared
        // the builder's bid to the HOLDER's bid (a bid for the same dirt) and
        // called a 99%-let corner "Redevelopment pencils" on the strength of
        // $238 against $464, neither of which was the building.
        const standingPsf = dirt ? 0 : value / Math.max(1, rec.lotArea);
        const pencils = read.winner === "builder" && read.builder > 0 && (dirt || read.builder > standingPsf);
        // THE MAP CARD IS A GLANCE. Most standing buildings in town leave a
        // quarter of their envelope unused, so "Underbuilt · a rebuild does
        // not pencil" headed nearly every owned building's card — a
        // non-action in the slot where the card's first fact belongs. On the
        // docked card it shows when there is something to do (dirt, or a
        // rebuild that pencils); the full read stays on the property file.
        if (tab === undefined && !dirt && !pencils) return null;
        // A STANDING BUILDING IS NOT DIRT. This card headed every owned
        // building that used under three quarters of its envelope "Dirt —
        // nothing pencils today · Holder bid $0/sf wins the auction — wait for
        // rents, or clear the site" — and with tower-legal envelopes on the
        // core that is most of the buildings in town, fully let ones included.
        // The owner saw it on a five-storey office with two tenants. The
        // question on a built lot is a different one: would a rebuild out-earn
        // what stands, and the answer names both bids so the player can read
        // which side is winning and by how much.
        const head = dirt
          ? (pencils ? "Developable" : "Vacant land · not feasible")
          : (pencils ? `Redevelopment feasible · ${(room * 100).toFixed(0)}% of envelope unused`
            : `Underbuilt · ${(room * 100).toFixed(0)}% of envelope unused`);
        // On a built lot the three bids are for the DIRT, and on most of the
        // city both the builder's and the holder's are zero — a rebuild does
        // not pencil at today's rents or the next peak's, and the land reads
        // on its location alone. Say that, rather than "$0/sf against $0/sf".
        // WHERE THE BUTTON GOES. The property page shows no Build tab on a
        // standing apartment building with no deed of yours next door (there
        // is nothing to convert it to), so "Open the Build desk" landed on
        // Overview and did nothing. The way to a rebuild there is the
        // Operations tab: empty it and clear the site.
        const buildReachable = rec.class !== "multifamily" || !!holding.groundLeased
          || (adjacency?.[selectedBBL] ?? []).some((n) => !!game.holdings[n]);
        const dirtLine = `land $${read.psf.toFixed(0)}/sf`
          + (read.winner === "texture" ? " (location floor)" : ` (${read.winner === "homes" ? "homebuilder" : read.winner === "subdivider" ? "land developer" : read.winner} bid)`);
        const hint = dirt
          ? (pencils
            ? `Residual land value $${read.builder.toFixed(0)}/sf · ${(room * 100).toFixed(0)}% of envelope unused.`
            : `Holder bid $${read.holder.toFixed(0)}/sf sets value.`)
          : (pencils
            ? `Residual $${read.builder.toFixed(0)}/sf of lot vs existing building $${standingPsf.toFixed(0)}/sf of lot.`
            : `Rebuild not feasible`
              + (read.builder > 0
                ? ` · residual $${read.builder.toFixed(0)}/sf of lot vs existing $${standingPsf.toFixed(0)}/sf`
                : ` · no use clears margin at current rents` + (read.holder > 0 ? ` or next peak` : ""))
              + ` · ${dirtLine}.`);
        return (
          <div className="deal" style={{ marginTop: 0, marginBottom: 10 }}>
            <div className="deal-head">{head}</div>
            <div className="hint">{hint}</div>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => useStore.getState().openProperty(selectedBBL, buildReachable ? "build" : "ops")}
            >
              {buildReachable ? "Open the Build desk →" : "Demolish on Operations →"}
            </button>
          </div>
        );
      })()}

      {/* WHO OWNS IT, AND WHAT THEIR ACCOUNTS LOOK LIKE.
          Every deed in this city has an owner and now every one of them has a
          balance sheet you can read. This block used to have three branches: a
          named firm got a doctrine and a link to its books, a named private
          holder got a note and a relationship, and everything else — the dirt,
          and anything the register did not reach — got an ARCHETYPE. "It sits
          in an estate" is a good sentence and it is not an owner: there was
          nobody behind it to look up, nothing they owned elsewhere, and no way
          to find out what they could afford or what they already owed. One
          branch now, because there is one kind of owner. See
          engine/ownership.ts. */}
      {on("summary") && (() => {
        if (holding) return null;
        const o = ownerAt(game, parcels, selectedBBL);
        if (!o) return null;
        if (o.publicOwner) return <div className="hint">{o.note}</div>;
        const others = o.book.filter((b) => b !== selectedBBL);
        return (
          <div className="hint">
            <div style={{ cursor: "pointer" }}
              title="Owner financials"
              onClick={() => {
                openViewOn("players", o.operator ? "street" : "owners");
                // a firm's name opens that firm (owner, Oct 2026), not the list
                if (o.operator) useStore.getState().openFirm(o.id);
                else useStore.getState().setPage("players");
              }}>
              Owned by <strong>{o.name}</strong>
              <span className="dim"> · {o.operator && o.style ? STYLE_WORD[o.style] ?? o.style : o.kind}</span>
              {o.book.length > 1 && <span> · {o.book.length} properties</span>}
              {o.failedM !== undefined
                ? " · In receivership"
                : o.stressed ? " · Distressed seller" : ""}
            </div>
            {/* THE THREE NUMBERS THAT DECIDE HOW THE CONVERSATION GOES: what
                they are worth, how much of it is the bank's, and whether the
                book pays for itself. An owner whose cash flow is negative is
                an owner with a reason to talk, and that was invisible on nine
                buildings in ten. */}
            <div className="dim mono" style={{ marginTop: 3 }}>
              {usd(o.sheet.assets)} assets ·{" "}
              {o.sheet.debt > 0 ? `${usd(o.sheet.debt)} debt · ${(o.sheet.ltv * 100).toFixed(0)}% LTV` : "unlevered"} ·{" "}
              <span className={o.income.net < 0 ? "neg" : ""}>{usd(o.income.net)}/yr after debt service</span>
            </div>
            {(o.note || (o.operator && o.style && DOCTRINE[o.style])) && (
              <div style={{ marginTop: 3 }}>
                {o.operator && o.style ? DOCTRINE[o.style] ?? o.note : o.note}
              </div>
            )}
            <div style={{ marginTop: 3 }} className={o.cold ? "neg" : o.rel.deals > 0 ? "" : "dim"}>
              {o.standing}
            </div>
            {others.length > 0 && (
              <div className="dim" style={{ marginTop: 3 }}>
                {others.slice(0, 4).map((b) => (
                  <span key={b}>
                    <a className="lnk" onClick={(e) => { e.stopPropagation(); useStore.getState().focus(b, true); }}>
                      {parcels[b]?.address ?? b}
                    </a>
                    {" · "}
                  </span>
                ))}
                {others.length > 4 ? `and ${others.length - 4} more` : ""}
              </div>
            )}
          </div>
        );
      })()}

      {/* ONE FACT, ONE PLACE. Inside the property file (embedded, on your own
          building) the stat tiles and the header grid already print the
          appraisal, occupancy, NOI, gross area, FAR and demand; this grid
          printed each of them a second time underneath. `dupe` drops them
          there and only there — the map card has no tiles. */}
      {on("summary") && <div className="grid">
        {!dupe && <Row k="Appraisal" v={band(selectedBBL, value)} strong />}
        {(() => {
          const prem = rec.locPremium ?? 1;
          const tags: string[] = [];
          if (rec.corner) tags.push("corner");
          if ((rec.shoreM ?? 9999) < 300) tags.push("waterfront");
          if ((rec.corridorM ?? 9999) < 90) tags.push("high street");
          if (tags.length === 0 && prem <= 1.001) return null;
          const bump = ((prem - 1) * 100).toFixed(0);
          return (
            <Row
              k="Location"
              v={tags.length
                ? `${tags.join(" · ")}${prem > 1.001 ? ` · +${bump}% on land` : ""}`
                : `+${bump}% on land`}
              strong={prem > 1.08}
            />
          );
        })()}
        {/* ONE LINE PER MARKET, because a building with shops under offices is
            in two of them and the average of the two is a rent nobody signs.
            The blend is the right number for an appraisal and the wrong one
            for a lease — see managedRentPsfYr — and this row was the blend
            with "market rent" written next to it, which is where the sense
            that shops lease miles under the market came from: they were being
            compared against a number that was mostly office. */}
        {/* WHAT YOUR BUILDING ACTUALLY GETS, above what the market would pay.
            Per market, like the rows below it: the area-weighted contract rent
            of the tenants in that part of the building — or, for flats, which
            carry no named leases, what the occupied flats collect (the same
            number the Portfolio book's rent column shows). Compared against
            that market's own rent, so a shop roll is never marked against an
            office number. */}
        {isBuilt && holding && (() => {
          // EVERY USE, FLATS INCLUDED. This read `leasableUses`, which is the
          // uses with named commercial leases and leaves flats out by design,
          // so the flats branch below never ran: a 30-storey apartment tower
          // with one empty shop said "no tenants" over 114 let flats.
          const legs = usesOf(rec);
          const inPlace = (u: BuiltClass): number | null => {
            if (u === "multifamily") {
              // The roll the flats hold (Holding.resRentPsf), at market until one is written.
              return (holding.occ ?? 0) > 0 ? flatsRollPsf(rec, game.econ, holding) : null;
            }
            const ts = holding.tenants.filter((t) => (t.use ?? rec.class) === u);
            const sfLet = ts.reduce((a, t) => a + t.sf, 0);
            if (sfLet > 0) return ts.reduce((a, t) => a + t.rentPsf * t.sf, 0) / sfLet;
            return null;
          };
          const rows = legs.map((u) => ({ u, ip: inPlace(u), mkt: legs.length <= 1 ? marketRentPsfYr(rec, game.econ, cond) : useRentPsfYr(rec, game.econ, cond, u) }));
          if (!rows.some((r) => r.ip !== null)) return <Row k="In-place rent" v="no tenants" />;
          return (
            <>
              {rows.map(({ u, ip, mkt }) => {
                const k = legs.length <= 1 ? "In-place rent" : `In-place rent · ${CLASS_LABEL[u] ?? u}`;
                if (ip === null) return <Row key={u} k={k} v="no tenants" />;
                const d = mkt > 0 ? (ip / mkt - 1) * 100 : 0;
                return (
                  <Row key={u} k={k}
                    v={`$${ip.toFixed(0)} /sf/yr · ${d >= 0 ? "+" : "\u2212"}${Math.abs(d).toFixed(0)}% vs market`}
                    strong={Math.abs(d) >= 10} />
                );
              })}
            </>
          );
        })()}
        {isBuilt && (() => {
          const legs = usesOf(rec);
          if (legs.length <= 1) {
            return <Row k="Market rent" v={"$" + marketRentPsfYr(rec, game.econ, cond).toFixed(0) + " /sf/yr"} />;
          }
          return (
            <>
              {legs.map((u) => (
                <Row
                  key={u}
                  k={`Market rent · ${CLASS_LABEL[u] ?? u}`}
                  v={"$" + useRentPsfYr(rec, game.econ, cond, u).toFixed(0) + " /sf/yr"}
                />
              ))}
              <Row k="Blended" v={"$" + marketRentPsfYr(rec, game.econ, cond).toFixed(0) + " /sf/yr"} />
            </>
          );
        })()}
        {/* DISCLOSED, not estimated, whenever the seller has shown a roll. The
            label drops "(mkt)" with it, because it is no longer an opinion. */}
        {isBuilt && !holding && (() => {
          const ip = goingIn(game, selectedBBL, value);
          // ONE BASIS WITH THE HEADER. The property page's strip reads let
          // over LETTABLE feet ("fully let · 1,209 sf unlettable"); this row
          // read let over rentable and printed 82% under it for the same
          // building. A disclosed roll gets the same read the strip does.
          const r = ip.h ? occRead(rec, ip.h) : null;
          return <Row k={ip.disclosed ? "Occupancy (in place)" : "Occupancy (mkt est.)"}
            v={r ? occLabel(r) : (ip.occ * 100).toFixed(0) + "%"}
            bad={ip.disclosed && (r ? r.lettableOcc : ip.occ) < 0.75}
            title={r ? occTitle(r) : undefined} />;
        })()}
        {/* HOW BIG IT IS — two quantities, because they are two facts.
            #116 put a "Leasable area" row on `bldgArea` and refused a private
            haircut: income was still struck on gross. Income now reads
            `rentableSf`. Quoting gross as leasable would be the lie that row
            was written to prevent. The owned-building remainder (demises too
            small to let) is still a real deduction, on rentable feet. */}
        {isBuilt && rec.bldgArea > 0 && !dupe && (
          <Row
            k="Gross area"
            v={sf(rec.bldgArea) + ` · ${rec.floors} fl · ${rec.yearBuilt}`}
            title="GFA incl. core; basis for zoning and cost."
          />
        )}
        {isBuilt && rec.bldgArea > 0 && (() => {
          const letSf = Math.round(rentableSf(rec));
          const rem = holding ? unlettableRemainderSf(rec, holding) : 0;
          const ratio = rentableRatio(plateOf(rec), rec.floors);
          const split = isMixedUse(rec)
            ? usesOf(rec).map((u) => `${sf(Math.round(useRentableSf(rec, u)))} ${USE_WORD[u]}`).join(" · ")
            : null;
          return (
            <Row
              k="Rentable area"
              v={rem > 0 ? `${sf(letSf - rem)} of ${sf(letSf)}` : `${sf(letSf)} · ${(ratio * 100).toFixed(0)}% of gross`}
              title={split
                ? `${split}${rem > 0 ? ` · ${sf(rem)} unleasable remainder` : ""}`
                : rem > 0
                  ? `${sf(rem)} unleasable remainder`
                  : "BOMA rentable (net of core). Basis for rent, NOI, cap rate."}
            />
          );
        })()}
        {isBuilt && !holding && (() => {
          const stacks = stacksOf(rec);
          if (stacks.length) {
            return (
              <Row
                k="Floorplates"
                v={stacks.map((p) => `${p.floors} × ${sf(Math.round(p.plateSf))} ${USE_WORD[p.use]}`).join(" · ")}
              />
            );
          }
          return isMixedUse(rec)
            ? <Row k="Leasable spaces" v={usesOf(rec).map((u) => `${Math.max(1, Math.round(useSf(rec, u) / suiteSf(rec)))} ${USE_WORD[u]}`).join(" · ")} />
            : <Row k="Leasable spaces" v={`${unitCount(rec)} · ${sf(Math.round(suiteSf(rec)))} each`} />;
        })()}
        {/* The leasing read, and it names the loss factor rather than burying it
            in a percentage. The appraisal's number — feet let over feet built —
            is still what the value and the buyer's quote above are struck on;
            see occRead for why those are two questions and not two answers. */}
        {holding && isBuilt && !dupe && (() => {
          const or = occRead(rec, holding);
          return <Row k="Occupancy" v={occLabel(or)} title={occTitle(or)} />;
        })()}
        {holding && isBuilt && unitStatus(rec, holding, game.month).byUse.map((u) => u.use !== "multifamily" ? (() => {
          // OFFICES AND SHOPS LET BY THE FOOT, NOT BY THE SUITE (owner, Oct
          // 2026). Tenants take whatever size they need, so the row reads feet
          // let of feet rentable and how many tenants hold them.
          const ts = holding.tenants.filter((t) => (t.use ?? dominantUse(rec)) === u.use);
          const let_ = ts.reduce((a, t) => a + t.sf, 0);
          const all = Math.round(useRentableSf(rec, u.use));
          return (
            <Row
              key={u.use}
              k={`${USE_WORD[u.use][0].toUpperCase()}${USE_WORD[u.use].slice(1)} let`}
              v={`${sf(Math.round(let_))} of ${sf(all)} · ${ts.length} tenant${ts.length === 1 ? "" : "s"}`}
              bad={let_ < all * 0.6}
            />
          );
        })() : (
          <Row
            key={u.use}
            k="Apartments let"
            /* Flats quote the average of the leg, not the demise: the leg is
               divided into a whole number of apartments and they occupy all of
               it, so a 1,412 sf residential leg is two flats of 706 and saying
               "900 each" describes 1,800 feet the building does not have.
               Commercial keeps the demise, because there the remnant under the
               floor genuinely is not a suite — see minLettableSf. */
            v={`${u.leased} of ${u.total} · ${sf(u.use === "multifamily" ? avgUnitSf(rec) : u.sfPer)} each`}
            bad={u.leased < u.total * 0.6}
          />
        ))}
        {holding && isBuilt && commercial && holding.tenants.length > 0 && (
          <Row
            k="Rent roll"
            v={`${holding.tenants.length} lease${holding.tenants.length === 1 ? "" : "s"} · ${sf(holding.tenants.reduce((a, t) => a + t.sf, 0))}`}
          />
        )}
        {holding && isBuilt && commercial && (
          <Row k={<Gloss term="WALT">WALT</Gloss>} v={walt(holding, game.month).toFixed(1) + " yrs avg remaining"} />
        )}
        {/* One building must not quote two different NOIs on one panel. In
            place off the roll — yours, or the one the seller disclosed — and
            struck against the appraisal, which is the only price on offer
            until somebody names one. The stabilised line sits beside it,
            labelled, because the gap between them is the deal. */}
        {isBuilt && (() => {
          const ip = goingIn(game, selectedBBL, value);
          const stab = proFormaNOIYr(rec, game.econ, ip.h?.condition ?? cond, value);
          const os = holding && omFull ? operatingStatement(rec, game.econ, holding, game.month) : null;
          const abate = holding && omFull ? remainingAbatement(holding, game.month) : 0;
          return (
            <>
              {!dupe && <Row
                k={ip.disclosed
                  ? <><Gloss term="NOI">In-place NOI</Gloss> / yr</>
                  : <><Gloss term="NOI">NOI</Gloss> / yr (mkt est.)</>}
                v={usd(ip.noi)}
              />}
              {os && os.freeRent > 0 && (
                <Row
                  k="Scheduled rent (abated)"
                  v={usd(os.baseRent + os.freeRent) + "/yr"}
                  title={`${usd(os.freeRent)}/yr free rent; NOI excludes it`}
                />
              )}
              {abate > 0 && <Row k="Free rent owed" v={usd(-abate)} bad />}
              {omFull && ip.disclosed && stab > ip.noi * 1.02 && (
                <Row k="Stabilised pro-forma" v={usd(stab)} />
              )}
            </>
          );
        })()}
        {omFull && holding && isBuilt && <Row k="Property tax / yr" v={usd(propertyTaxYr(rec, holding)) + (commercial ? " (your share)" : "")} />}
        {omFull && <Row k="Lot area" v={sf(rec.lotArea)} />}
        {omFull && isBuilt && isMixedUse(rec) && <Row k="Use mix" v={mixLabel(rec)} />}
        {!dupe && <Row k={<span><Gloss term="FAR">FAR</Gloss> built / max</span>} v={`${builtFar.toFixed(1)} / ${farMax.toFixed(1)}`} />}
        {!dupe && <Row k="Demand" v={String(Math.round(demandNow(game, rec))) + " / 100"} />}
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
        const bld = !firm && j.builderId ? (game.builders ?? []).find((b) => b.id === j.builderId) : undefined;
        const pct = Math.min(100, Math.max(0, ((game.month - j.startM) / Math.max(1, j.deliverM - j.startM)) * 100));
        return (
          <div className="deal">
            <div className="deal-head">
              {j.orphaned ? "Stalled construction" : firm ? `${firm.name} is building here` : bld ? `${bld.name} is building here` : "Under construction"}
            </div>
            <div className="grid">
              <Row k="Programme" v={`${sf(j.sf)} of ${j.use} · ${j.floors} floors`} strong />
              <Row k="Progress" v={`${pct.toFixed(0)}%`} />
              <Row k={j.orphaned ? "Status" : "Delivers"}
                v={j.orphaned ? "In receivership" : monthLabel(j.deliverM)}
                bad={j.orphaned} />
              {j.firmId && !j.orphaned && j.cost !== undefined && <Row k="Budget" v={usd(j.cost)} />}
              {bld && <Row k="Developer" v={`${bld.founder} · since ${monthLabel(bld.bornM)} · ${bld.delivered} delivered`
                + (bld.handedBack ? ` · ${bld.handedBack} returned to lender` : bld.underwater ? ` · ${bld.underwater} opened under cost` : "")}
                bad={bld.handedBack > 0} />}
              {j.merchant?.lender && !j.firmId && <Row k="Construction loan" v={`${j.merchant.lender} · ${Math.round(100 * j.merchant.loan / Math.max(1, j.merchant.basis))}% of cost`} />}
            </div>
            {j.orphaned && (
              <div className="hint">
                Purchase includes the partial build; buyer funds cost to complete.
              </div>
            )}
          </div>
        );
      })()}

      {on("summary") && <Neighbourhood bbl={rec.bbl} block={rec.block} />}

      {on("summary") && holding?.groundLeased && game.groundLeases?.[selectedBBL] && (() => {
        const gl = game.groundLeases[selectedBBL]!;
        const built = game.built?.[selectedBBL];
        const job = (game.cityJobs ?? []).find((j) => j.bbl === selectedBBL && j.groundLease);
        if (!built?.bldgArea && !job && gl.builtM === undefined) return null;
        return (
          <div className="deal">
            <div className="deal-head">Lessee improvement</div>
            <div className="grid">
              <Row k="Tenant" v={gl.tenant} />
              {job && !gl.builtM && (
                <Row k="Under construction" v={`${job.floors} fl · ${job.use} · ${sf(job.sf)} · opens ${monthLabel(job.deliverM)}`} strong />
              )}
              {(built?.bldgArea || gl.builtM !== undefined) && (
                <>
                  <Row k="Standing" v={`${gl.floors ?? built?.floors ?? "?"} fl · ${useLabel(rec)} · ${sf(built?.bldgArea ?? gl.sf ?? 0)}`} strong />
                  {gl.builtM !== undefined && <Row k="Delivered" v={monthLabel(gl.builtM)} />}
                </>
              )}
              <Row k="Ground rent" v={`${usd(gl.rentYr)} / yr`} />
              <Row k="Term ends" v={monthLabel(gl.endM)} />
            </div>
            <div className="hint">Lessee operates and insures the building.</div>
          </div>
        );
      })()}

      {on("leasing") && holding && commercial && (
        <StackingList rec={rec} holding={holding} game={game} canHold={planIsLive(game)} />
      )}
      {on("leasing") && holding && commercial && holding.tenants.length > 0 && (
        <div className="deal">
          <div className="deal-head">Rent roll · {sf(leasedSf)} of {sf(Math.round(usesOf(rec).filter((u) => u !== "multifamily").reduce((a, u) => a + useRentableSf(rec, u), 0)))} rentable commercial</div>
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
                  <span className="roll-name">{USE_WORD[u]} · {sf(Math.round(useRentableSf(rec, u)))} rentable</span>
                  {/* The market for THIS corner, not the citywide index — a shop
                      on a prime block does not rent at the city average, and
                      quoting one beside the other made every in-place rent look
                      like a windfall. */}
                  <span className="roll-meta mono">${useRentPsfYr(rec, game.econ, holding.condition, u, holding.condIdx).toFixed(0)}/sf market here</span>
                </div>,
                ...inUse.map(({ t, i }) => {
                  const near = t.endM - game.month <= 24;
                  const ri = near ? renewalIntent(game, rec, holding, t) : null;
                  // HEADROOM, MEASURED. "growing" was a bare word; the row now
                  // says the numbers the desk acts on. "No room" is the SAME
                  // gate the engine's expansion letter tests (leasing.ts
                  // tickLeasing): room = vacant − what supportableOcc says
                  // this address cannot fill, and a letter only arrives when
                  // room clears the smallest lettable suite. The first cut
                  // asked a different question (full shortfall vacant) and
                  // called moves the engine was still going to letter.
                  const staff = t.staff ?? 1;
                  const outgrown = staff > 1.30;
                  const shrinking = staff < 0.78;
                  const expRoom = Math.max(0,
                    useVacantSf(rec, holding, u, game.month)
                    - (1 - supportableOcc(game.econ, rec, u)) * useSf(rec, u));
                  const noRoom = outgrown && expRoom < minLettableSf(rec, u);
                  // TENURE ON THE ROW. The roll knows exactly how long every
                  // tenant has been here and never said so — and "since 2004"
                  // is what turns a row into a relationship.
                  const yrsIn = Math.floor((game.month - t.startM) / 12);
                  const strained = t.strainedM !== undefined && game.month - t.strainedM < 24;
                  return (
                  <div key={i} className="roll-row">
                    <span className="roll-name">{t.name} <span className="roll-credit mono">{CREDIT_LABEL[t.credit]}</span>
                      {yrsIn >= 5 && <span className="dim"> · since {START_YEAR + Math.floor(t.startM / 12)}</span>}
                    </span>
                    <span className="roll-meta mono">
                      {sf(t.sf)} · ${t.rentPsf.toFixed(0)} {recoveryOf(t) === "gross" ? "G" : recoveryOf(t).toUpperCase()} · exp {monthLabel(t.endM)}
                      {" "}· {termLeft(t.endM, game.month)}
                      {outgrown && (noRoom
                        ? <> · <span className="warn">growing · needs {staff.toFixed(1)}× space · no room, likely to relocate</span></>
                        : <> · growing · needs {staff.toFixed(1)}× space</>)}
                      {shrinking && <> · shrinking · using {staff.toFixed(1)}× leased space</>}
                      {strained && <> · <span className="warn">strained</span></>}
                      {ri && <> · <span className={ri.p < 0.5 ? "warn" : ""}>{Math.round(ri.p * 100)}% renewal odds</span> · {ri.why[0]}</>}
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
                  {((holding.occ ?? 0) * 100).toFixed(0)}% let · ${useRentPsfYr(rec, game.econ, holding.condition, "multifamily", holding.condIdx).toFixed(0)}/sf market here
                </span>
              </div>
            )}
            {notReadySf(holding, game.month) > 0 && (
              <div className="roll-row roll-vacant">
                <span className="roll-name">In make-ready</span>
                <span className="roll-meta mono">
                  {sf(notReadySf(holding, game.month))} · showable {monthLabel(Math.max(...(holding.makeReady ?? []).map((m) => m.readyM)))}
                </span>
              </div>
            )}
            {/* VACANT, AND THE PART OF IT THAT IS NOT SPACE. A leg whose whole
                leftover is under the demise floor cannot be shown to anybody —
                the tour gate and the lettable floor both refuse it — so listing it as
                vacant sends the owner chasing a percentage no letter can fill.
                Same feet the engine offers a sitting neighbour as a must-take. */}
            {(() => {
              const vac = vacantSf(rec, holding) - notReadySf(holding, game.month);
              const dead = unlettableRemainderSf(rec, holding);
              const live = Math.max(0, vac - dead);
              return (
                <>
                  {live > 500 && (
                    <div className="roll-row roll-vacant">
                      <span className="roll-name">Vacant</span>
                      <span className="roll-meta mono">{sf(live)}</span>
                    </div>
                  )}
                  {dead > 0 && (
                    <div className="roll-row roll-vacant">
                      <span className="roll-name">Unlettable remainder</span>
                      <span className="roll-meta mono">
                        {sf(dead)} · below minimum suite; leasable only to adjacent tenant
                      </span>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}

      {on("leasing") && holding && isBuilt && !renovating && <LettingOdds bbl={selectedBBL} />}
      {on("leasing") && holding && isBuilt && !renovating && <MinDealSize bbl={selectedBBL} />}

      {/* THE MONTHLY STATEMENT. Every income number on this panel was an
          annual headline, and the arithmetic between the rent and the cheque
          was nowhere: scheduled rent plus recoveries is revenue, less the
          expense stack is NOI, less the mortgage is what actually lands in
          the account each month. Built from the same lines the appraisal
          runs (operatingStatement), divided by twelve, so this block and the
          NOI quoted above can never disagree on one building. */}
      {on("money") && holding && holding.groundLeased && game.groundLeases?.[selectedBBL] && (() => {
        const gl = game.groundLeases[selectedBBL]!;
        const pmt = holding.loan?.monthlyPmt ?? 0;
        const noiMo = gl.rentYr / 12;
        const cfMo = noiMo - pmt;
        return (
          <div className="deal">
            <div className="deal-head">Cash statement · monthly</div>
            <div className="grid">
              <Row k="Ground rent" v={usd(Math.round(noiMo))} strong />
              <Row k="Property tax / opex" v="$0 · lessee pays" />
              <Row k="NOI / mo" v={usd(Math.round(noiMo))} strong />
              {pmt > 0 && <Row k="Debt service / mo" v={usd(-Math.round(pmt))} />}
              <Row k="Cash flow / mo" v={usd(Math.round(cfMo))} strong bad={cfMo < 0} />
            </div>
          </div>
        );
      })()}

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
              {os.freeRent > 0 && <Row k="Free rent" v={"−" + mo(os.freeRent)} bad />}
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
              {(os.groundRent ?? 0) > 0 && <Row k="Ground rent" v={"−" + mo(os.groundRent)} title={`Paid to ${holding.groundRentOut?.holder ?? "fee owner"} (sale-leaseback)`} />}
              <Row k="NOI / mo" v={mo(os.noi)} strong bad={os.noi < 0} />
              {pmt > 0 && <Row k="Debt service / mo" v={usd(-Math.round(pmt))} />}
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
            {holding.loan.holder && <Row k="Holder" v={holding.loan.holder} />}
            {game.month < holding.loan.ioUntilM && <Row k="Interest-only" v={"until " + monthLabel(holding.loan.ioUntilM)} />}
            <Row k="Debt service / yr" v={usd(holding.loan.monthlyPmt * 12)} strong />
            {(holding.loan.leaseUpRoom ?? 0) > 0 && !holding.fundOwned && (
              <Row
                k="Lease-up reserve"
                v={usd(holding.loan.leaseUpRoom!) + " undrawn · TI, LC, debt service shortfall"}
              />
            )}
            <Row k="Balloon" v={monthLabel(holding.loan.maturityM)} />
            {holding.mezz && holding.mezz.balance > 0 && (
              <Row
                k="Mezz"
                v={`${usd(holding.mezz.balance)} @ ${pct(holding.mezz.ratePct)} · ${holding.mezz.holder ?? "Cordage"} · due ${monthLabel(holding.mezz.maturityM)}`}
                bad
              />
            )}
            {d !== null && <Row k="DSCR" v={d.toFixed(2) + " (min " + holding.loan.minDSCR.toFixed(2) + ")"} bad={d < holding.loan.minDSCR} />}
            {l !== null && <Row k="LTV" v={(l * 100).toFixed(0) + "% (max " + (holding.loan.maxLTV * 100).toFixed(0) + "%)"} bad={l > holding.loan.maxLTV} />}
            {holding.loan.cap && <Row k="Rate cap" v={`base rate ≤ ${holding.loan.cap.strike.toFixed(2)}% until ${monthLabel(holding.loan.cap.expiresM)}`} />}
          </div>
          <div className="btn-row">
            {(() => {
              const due = payOffDue(holding.loan, game.month, game.econ);
              const facPledged = !!game.facility?.bbls?.includes(selectedBBL);
              // A JV partner has consent over the debt (vehicles.ts): the button says so rather than erroring.
              const jvBlock = consentFor(game, holding, "debt");
              const canPay = !facPledged && !jvBlock && fundableNow(game, parcels) >= due.due;
              return (
                <button
                  className="btn btn-buy"
                  disabled={!canPay}
                  title={jvBlock ?? (facPledged
                    ? "Pledged to credit facility; release first."
                    : !canPay
                      ? `Payoff ${usd(due.due)}`
                      : due.penalty > 0
                        ? `${usd(due.balance)} + ${usd(due.penalty)} prepayment penalty`
                        : `Payoff ${usd(due.due)}`)}
                  onClick={() => useStore.getState().payOffLoan(selectedBBL)}
                >
                  Pay off · {usd(due.due)}
                </button>
              );
            })()}
            {(() => {
              // A greyed button with its reason in a tooltip is a question
              // the player has to hover to ask. Say it beside the button.
              const due = payOffDue(holding.loan, game.month, game.econ);
              if (game.facility?.bbls?.includes(selectedBBL)) return <span className="hint">Pledged to credit facility; release first.</span>;
              return <ShortBy need={due.due} have={fundableNow(game, parcels)} />;
            })()}
            {(holding.loan.floating ?? holding.loan.product === "float") && !holding.loan.cap && (
              <button
                className="btn"
                title={`Base rate cap ${capStrikeFor(game, holding.loan).toFixed(2)}% · 3 yrs`}
                onClick={() => useStore.getState().rateCap(selectedBBL)}
              >
                Buy rate cap · {usd(rateCapCost(holding.loan))}
              </button>
            )}
          </div>
          {!game.facility?.bbls?.includes(selectedBBL) && holding.loan.balance > 1000 && (
            <PaydownRow bbl={selectedBBL} />
          )}
          {/* The docked card gets the answer and a door; the desk itself —
              four lenders, a dial and a before/after sheet — is a room's
              worth of reading and opens as one. */}
          {tab === undefined && <RefiGlance bbl={selectedBBL} />}
        </div>
      )}
      {/* The full refinance desk is its own full-width section on the page,
          not the tail of the Debt column — tucked inside Debt it made one
          column 1,400px tall beside a 270px cash statement. */}
      {on("money") && holding?.loan && tab !== undefined && (
        <div className="deal deal-wide"><RefiSection bbl={selectedBBL} /></div>
      )}

      {on("deal") && listing && !holding && (() => {
        const t0 = game.talks?.[selectedBBL];
        const contract = t0?.agreed ? t0 : null;
        return (
          <div className="deal" data-buy-desk>
            <div className="deal-head">{contract ? "Under contract" : "On the market"}</div>
            <div className="grid">
              {contract
                ? <Row k="Agreed price" v={usd(contract.agreedPrice ?? contract.theirPrice)} strong />
                : <>
                    <Row k="Ask" v={usd(listing.ask)} strong />
                    {listing.loanBasis !== undefined && listing.loanBasis > 0 && (
                      <Row k="Loan basis" v={usd(listing.loanBasis)} title="Outstanding debt; ask anchored to it, not appraisal." />
                    )}
                  </>}
              {contract && <Row k="Must fund by" v={monthLabel((contract.closeByM ?? game.month + 3) - 1)} bad />}
              {contract && <Row k="Deposit posted" v={usd(contract.deposit ?? 0)} />}
              {/* THE NUMBERS YOU BID ON ARE THE NUMBERS YOU CLOSE ON. Priced
                  off the disclosed rent roll where there is one, so the cap
                  rate on this card is the cap rate you actually buy at rather
                  than the one a building of this type ought to trade at. */}
              {isBuilt && (() => {
                const px = contract?.agreedPrice ?? listing.ask;
                const ip = goingIn(game, selectedBBL, px);
                const stab = proFormaNOIYr(rec, game.econ, ip.h?.condition ?? cond, px);
                return (
                  <>
                    <Row k={ip.disclosed ? "In-place NOI / yr" : "NOI / yr (mkt est.)"} v={usd(ip.noi)} bad={ip.noi < 0} />
                    <Row
                      k="Going-in cap"
                      v={ip.noi > 0 ? ((ip.noi / Math.max(1, px)) * 100).toFixed(2) + "%" : "— no income"}
                      strong={ip.noi > 0}
                      bad={ip.noi <= 0}
                    />
                    {/* The seller's other number, and it is labelled as the
                        forecast it is. What you buy is the line above. */}
                    <Row k="Stabilised pro-forma" v={`${usd(stab)} · ${((stab / Math.max(1, px)) * 100).toFixed(2)}%`} />
                    {(() => {
                      const r = ip.h ? occRead(rec, ip.h) : null;
                      return (
                        <Row
                          k={ip.disclosed ? "Occupancy (in place)" : "Occupancy (mkt est.)"}
                          v={r ? occLabel(r) : (ip.occ * 100).toFixed(0) + "%"}
                          title={r ? occTitle(r) : undefined}
                        />
                      );
                    })()}
                    {ip.h && <Row k="In place" v={`${ip.h.tenants.length} lease${ip.h.tenants.length === 1 ? "" : "s"}`} />}
                  </>
                );
              })()}
              {!isBuilt && <Row k="Land" v={"$" + ((contract?.agreedPrice ?? listing.ask) / rec.lotArea).toFixed(0) + " /sf of lot"} />}
              {listing.halfBuilt && (() => {
                // A RECEIVER'S SITE WITH A FRAME ON IT IS A JOB, NOT A LOT: the
                // buyer takes the construction on at the closing, and the
                // purchase is refused unless the rest can be funded.
                const hb = listing.halfBuilt;
                const need = takeoverEquityNeed(game, parcels, selectedBBL, hb);
                return (
                  <Row k="Partial construction"
                    v={`${Math.round(hb.progress * 100)}% built · ${hb.floors} fl ${hb.use} · ${usd(need)} equity to complete`}
                    bad strong title="Purchase requires funding cost to complete after price." />
                );
              })()}
            </div>
            {/* TWO ACTS, and never both at once. Before a handshake there is
                only a price; after one there is only the money. */}
            {contract ? (
              <>
                <div className="hint">{contract.note}</div>
                <BuyButtons bbl={selectedBBL} price={contract.agreedPrice ?? contract.theirPrice} off={false} />
              </>
            ) : (
              <OfferDesk bbl={selectedBBL} price={listing.ask} distress={!!listing.distress} loanBasis={listing.loanBasis} />
            )}
          </div>
        );
      })()}

      {on("deal") && !listing && !holding && (() => {
        const offContract = game.talks?.[selectedBBL]?.agreed ? game.talks[selectedBBL] : null;
        return (
        <div className="deal">
          <div className="deal-head">Off-market</div>
          {offContract ? (
            <>
              <div className="hint">{offContract.note}</div>
              <div className="grid">
                <Row k="Agreed price" v={usd(offContract.agreedPrice ?? offContract.theirPrice)} strong />
                <Row k="Close by" v={monthLabel((offContract.closeByM ?? game.month + 1) - 1)} bad />
                <Row k="Earnest money" v={usd(offContract.deposit ?? 0)} />
              </div>
              <BuyButtons
                bbl={selectedBBL}
                price={offContract.agreedPrice ?? offContract.theirPrice}
                off={false}
              />
            </>
          ) : appr && !appr.refused && appr.ask !== undefined ? (
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
                  Ask named after your bid{appr.lastBid ? ` of ${usd(appr.lastBid)}` : ""}.
                </div>
              )}
              <div className="grid">
                <Row k="Owner's ask" v={usd(appr.ask)} strong />
                <Row k="vs. appraisal" v={pctSigned(appr.ask / apMid(selectedBBL, value) - 1)} />
                <Row k="Good until" v={monthLabel(appr.q + 6)} />
              </div>
              {/* Off-market has always been two acts: they name a number, you
                  counter it once, and only then is there a price to fund. The
                  finance block goes underneath the price conversation, not
                  above it. */}
              {!appr.countered && <OffMarketCounter bbl={selectedBBL} ask={appr.ask} />}
              <div className="hint" style={{ marginTop: 6 }}>
                {appr.countered
                  ? `Final ask ${usd(appr.ask)}.`
                  : appr.named
                    ? "Ask near seller's floor. Small counters only."
                    : "One counter allowed."}
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
                Owner declined {monthLabel(appr.q)}.
                {game.month < appr.q + 6
                  ? ` Re-approach from ${monthLabel(appr.q + 6)}.`
                  : " Re-approach available."}
              </div>
              <div className="btn-row">
                <button
                  className="btn"
                  disabled={game.month < appr.q + 6}
                  title={game.month < appr.q + 6
                    ? `${appr.q + 6 - game.month} mo until re-approach`
                    : undefined}
                  onClick={() => approach(selectedBBL)}
                >
                  Approach owner again
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="hint">
                Not listed.
                {adjacency && assemblagePressure(game, adjacency, selectedBBL) > 0.3 &&
                  " Adjacent owned lots: expect holdout pricing."}
              </div>
              <div className="btn-row">
                <button className="btn" onClick={() => approach(selectedBBL)}>Approach the owner</button>
              </div>
            </>
          )}
        </div>
        );
      })()}

      {on("build") && holding && dev && (
        <div className="deal">
          <div className="deal-head">Construction</div>
          <div className="grid">
            <Row k="Program" v={`${(dev.sf / 1000).toFixed(0)}k sf ${dev.use} · ${dev.floors} fl`} />
            <Row k="Budget" v={usd(dev.costTotal)} />
            <Row k="Constr. loan" v={usd(dev.loanBalance) + " @ " + pct(dev.ratePct)} />
            <Row k="Delivers" v={monthLabel(dev.deliverM)} strong />
            <Row
              k="Pre-let"
              v={(dev.signed?.length ?? 0)
                ? `${dev.signed!.length} deal${dev.signed!.length === 1 ? "" : "s"} · ${sf(dev.signed!.reduce((a, x) => a + x.sf, 0))} spoken for`
                : "None"}
              strong={(dev.signed?.length ?? 0) > 0}
            />
          </div>
          {(dev.signed?.length ?? 0) > 0 && (
            <div className="mini-list" style={{ marginTop: 8 }}>
              {dev.signed!.map((sg, i) => (
                <div key={i} className="mini-row" style={{ cursor: "default" }}>
                  <span>{(sg.use || "space")} · {sf(sg.sf)}</span>
                  <span className="mono dim">{((1 - sg.discount) * 100).toFixed(0)}% below market (pre-lease)</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Lessee builds on a live ground lease — do not offer Break ground beside the coupon desk. */}
      {on("build") && holding && !dev && rec.class === "land"
        && !holding.groundLeased && !game.groundLeases?.[selectedBBL]
        && (tab === undefined ? <DevelopGlance bbl={selectedBBL} /> : <DevelopSection bbl={selectedBBL} />)}
      {on("build") && holding && !dev && isBuilt && <ReuseSection bbl={selectedBBL} />}

      {/* THE LAND DESK — assemble contiguous owned lots into one site.
          Own two or more parcels that touch (including through a lot already
          folded in), clear them, and fold the deeds together: one plate, one
          envelope, one address. LandDesk lists every reachable site and why
          a blocked one cannot join yet. */}
      {showLandDesk && <LandDesk bbl={selectedBBL} />}

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
            {/* WHAT A LETTER WILL ACTUALLY BE MEASURED AGAINST. The desk, the
                renewal manager and every arriving prospect price one LEG of
                this building at a time; this row averaged the legs together
                and called the result the asking rent, so on a mixed building
                the number on the screen was one nobody was ever quoted. */}
            {/* Flats too: the asking posture moves what they re-let at
                (flatsMarkPsf), not only the shops' and offices' letters. */}
            {usesOf(rec).map((u) => (
              <Row
                key={u}
                k={usesOf(rec).length > 1 ? `Asking · ${CLASS_LABEL[u] ?? u}` : "Asking rent"}
                v={"$" + (u === "multifamily" ? flatsMarkPsf(rec, game.econ, holding) : currentAskPsfYr(rec, game.econ, holding, u)).toFixed(2)
                  + (u === "multifamily" ? " /sf on turnover" : " /sf new leases")}
              />
            ))}
          </div>
          {/* EACH CHOICE UNDER ITS OWN NAME. The three settings were two
              labels stacked together and then three unlabeled rows of
              buttons, so which three set the service and which the capital
              plan was a guess. Now: a name, a segmented control, its read. */}
          <div className="ops-choice">
            <span className="ops-choice-k">Asking</span>
            <span className="seg" role="group" aria-label="Asking rents">
            {([-1, 0, 1] as const).map((v) => (
              <button
                key={v}
                className={"btn" + ((holding.stance ?? 0) === v ? " btn-on" : "")}
                aria-pressed={(holding.stance ?? 0) === v}
                title={v === 1 ? "+8% asking rents, fewer LOIs" : v === -1 ? "−8% rents, faster lease-up" : "market rents"}
                onClick={() => useStore.getState().stance(selectedBBL, v)}
              >
                {v === 1 ? "Push +8%" : v === -1 ? "Fill −8%" : "Market"}
              </button>
            ))}
            </span>
            <button
              type="button"
              className={"btn" + (holding.autoLease ? " btn-on" : "")}
              onClick={() => useStore.getState().autoLease(selectedBBL, !holding.autoLease)}
              title={holding.autoLease
                ? "Auto-responding to LOIs at the asking setting. Click to disable."
                : "Auto-respond to LOIs at the asking setting. Same commissions."}
            >
              {holding.autoLease ? "Auto-answer ✓" : "Auto-answer"}
            </button>
          </div>
          {holding.autoLease && (
            <>
              <LegacyTiCapRow bbl={selectedBBL} />
              <div className="hint" style={{ fontSize: 11 }}>
                {autoLeaseRule(game, holding)} Concession limit: Leasing page.
              </div>
            </>
          )}
          <OpsChoices bbl={selectedBBL} h={holding} />
          <div className="ops-choice-k" style={{ marginTop: 10 }}>One-off programmes</div>
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
                title="~45% more tours while vacant. No retainer. 6% of term base rent at signing (vs 4% new / 2% renewal in-house)."
                onClick={() => useStore.getState().broker(selectedBBL, !holding.broker)}
              >
                {holding.broker
                  ? "✓ Listing broker · 6%"
                  : "Hire listing broker · 6% at signing"}
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
                Reverts to vacant land. All leases terminate. Irreversible.
              </div>
              <div className="grid">
                <Row k="Demolition cost" v={usd(demoCost)} bad={demoCost > fundableNow(game, parcels)} strong />
                <Row k="Cleared land value" v={usd(dirt)} />
                {farMax > 0 && <Row k="Buildable envelope" v={`${sf(Math.round(rec.lotArea * farMax))} at ${farMax.toFixed(1)} FAR`} />}
                <Row k="Cash and line" v={usd(fundableNow(game, parcels))} bad={demoCost > fundableNow(game, parcels)} />
              </div>
              <div className="modal-actions">
                <button
                  className="btn btn-sell"
                  disabled={demoCost > fundableNow(game, parcels)}
                  title={demoCost > fundableNow(game, parcels) ? "Exceeds cash + line." : undefined}
                  onClick={() => { setRazeAsk(null); useStore.getState().raze(selectedBBL); }}
                >
                  Demolish · {usd(demoCost)}
                </button>
                <button className="btn" data-esc onClick={() => setRazeAsk(null)}>Cancel</button>
                <ShortBy need={demoCost} have={fundableNow(game, parcels)} />
              </div>
              <div className="modal-queue">Site cleared same month.</div>
            </div>
          </div>
        );
      })()}

      {/* THE OFFERING MEMORANDUM, ON THE PAGE WHERE YOU DECIDE. It is no use
          for the engine to price the disclosed roll if the player cannot read
          it: what is let, to whom, at what rent, expiring when. Renders on the
          acquire tab for anything the seller has actually shown you — a tape
          listing or an open off-market conversation — and on nothing else. */}
      {on("deal") && !holding && isBuilt && <DisclosedRoll bbl={selectedBBL} />}

      {on("deal") && holding && <SaleSection bbl={selectedBBL} value={value} />}
      {on("deal") && holding && ((isBuilt && !holding.groundLeased) || !!game.syndications?.[selectedBBL]) && <StakeSection bbl={selectedBBL} />}
      {on("deal") && holding && isBuilt && !holding.groundLeased && <LeaseholdSection bbl={selectedBBL} />}

      {on("summary") && holding && (
        <div className="deal">
          <div className="deal-head">Position · since {monthLabel(holding.boughtM)}</div>
          <div className="grid">
            <Row k="Basis" v={usd(holding.costBasis)} />
            {(holding.deprTaken ?? 0) > 0 && <Row k="Depreciation taken" v={usd(-holding.deprTaken!)} />}
            <Row k="Assessed (tax)" v={usd(holding.assessed ?? holding.costBasis)} />
            <Row k={holding.jv ? `Equity · your ${Math.round((1 - holding.jv.share) * 100)}%` : "Equity"} v={usd((value - (holding.loan?.balance ?? 0) - (holding.mezz?.balance ?? 0)) * (1 - (holding.jv?.share ?? 0)))} strong />
          </div>
        </div>
      )}
      {!embedded && on("summary") && holding && taxAppeal && (
        <div className="deal">
          <div className="deal-head">Assessment watch</div>
          <div className="grid">
            <Row k="Tax roll" v={usd(taxAppeal.assessed)} bad />
            <Row k="Market evidence" v={usd(taxAppeal.target)} />
            <Row k="Potential annual saving" v={usd(taxAppeal.annualSavings)} strong />
          </div>
          <button
            className="btn"
            disabled={game.cash < taxAppeal.fee}
            onClick={() => useStore.getState().appealTax(selectedBBL)}
          >
            Appeal assessment · {usd(taxAppeal.fee)}
          </button>
          <ShortBy need={taxAppeal.fee} have={game.cash} cash />
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
          {neighbors.length === 0 && <div className="neighbor-none">None</div>}
        </div>
      </div>}
      {!embedded && tab === undefined && !holding && listing && (
        <BuyCta bbl={selectedBBL} ask={listing.ask} built={isBuilt} />
      )}
    </div>
  );
}

/**
 * THE VERB STAYS IN REACH.
 *
 * Clicking a building that is for sale is a question about buying it, and the
 * card answered with the owner, the appraisal, the neighbourhood and the jobs
 * within a five-minute walk — the Offer button sat about 1,100px down a
 * 2,400px card, under all of it. This footer pins the ask and the yield to the
 * bottom of the card and takes you to the offer desk; it steps aside once the
 * desk itself is on screen, so the price is never shown twice at once.
 */
function BuyCta({ bbl, ask, built }: { bbl: string; ask: number; built: boolean }) {
  const game = useStore((s) => s.game)!;
  const [hidden, setHidden] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const panel = ref.current?.closest(".panel");
    const desk = panel?.querySelector("[data-buy-desk]");
    if (!panel || !desk) return;
    const io = new IntersectionObserver(([e]) => setHidden(e.isIntersecting), { root: panel, threshold: 0, rootMargin: "0px 0px -40px 0px" });
    io.observe(desk);
    return () => io.disconnect();
  }, [bbl]);
  const t = game.talks?.[bbl];
  const contract = t?.agreed ? t : null;
  const ip = built ? goingIn(game, bbl, contract?.agreedPrice ?? ask) : null;
  const yieldTxt = ip && ip.noi > 0 ? `${((ip.noi / Math.max(1, contract?.agreedPrice ?? ask)) * 100).toFixed(1)}% going-in` : built ? "no in-place income" : "land";
  const go = () => ref.current?.closest(".panel")?.querySelector("[data-buy-desk]")?.scrollIntoView({ behavior: "smooth", block: "start" });
  return (
    <div ref={ref} className={"panel-cta" + (hidden ? " panel-cta-hidden" : "")} aria-hidden={hidden}>
      <div className="panel-cta-txt">
        <span className="panel-cta-price mono">{usd(contract ? (contract.agreedPrice ?? contract.theirPrice) : ask)}</span>
        <span className="panel-cta-sub">{contract ? `under contract · fund by ${monthLabel((contract.closeByM ?? game.month + 3) - 1)}` : `ask · ${yieldTxt}`}</span>
      </div>
      <button type="button" className="btn btn-buy" tabIndex={hidden ? -1 : 0} onClick={go}>
        {contract ? "Fund the close ↓" : t ? "Negotiation ↓" : "Make an offer ↓"}
      </button>
    </div>
  );
}

/** Memo: GamePanels re-renders on every page toggle; the docked card must not. */
export const ParcelPanel = memo(ParcelPanelShell);

/**
 * PAY SOME OF IT DOWN. The amount, what it costs today under the note's own
 * prepayment terms, and what the payment becomes — before the click. When the
 * loan is in breach the preset is the engine's own cure number, the same one
 * the sweep would take out of the building on its own.
 */
function PaydownRow({ bbl }: { bbl: string }) {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const h = game.holdings[bbl];
  const rec = resolveRec(parcels, game, bbl);
  const [txt, setTxt] = useState("");
  if (!h?.loan || !rec) return null;
  const loan = h.loan;
  const bal = Math.round(loan.balance);
  const cure = Math.min(bal - 1, Math.round(equityCureNeed(rec, game, h)));
  const amt = Math.round(Number(txt.replace(/[^0-9.]/g, "")) || 0);
  const valid = amt > 0 && amt < bal;
  const pen = valid ? prepayPenalty({ ...loan, balance: amt }, game.month, game.econ) : 0;
  const tooMuch = valid && amt + pen > game.cash;
  const jvBlock = consentFor(game, game.holdings[bbl], "debt");
  return (
    <div className="btn-row" style={{ alignItems: "center", flexWrap: "wrap" }}>
      <input
        className="mono" style={{ width: 110 }} inputMode="numeric" placeholder="amount"
        value={txt} onChange={(e) => setTxt(e.target.value)}
      />
      {cure > 0 && (
        <button className="btn" title="Paydown to restore covenant compliance" onClick={() => setTxt(String(cure))}>
          Cure · {usd(cure)}
        </button>
      )}
      <button className="btn" onClick={() => setTxt(String(Math.round(bal * 0.1)))}>10%</button>
      <button className="btn" onClick={() => setTxt(String(Math.round(bal * 0.25)))}>25%</button>
      <button
        className="btn btn-buy" disabled={!valid || tooMuch || !!jvBlock}
        title={jvBlock ? jvBlock : !valid ? "Must be below balance; use Pay off for full." : tooMuch ? `Needs ${usd(amt + pen)} cash` : undefined}
        onClick={() => { useStore.getState().paydownLoan(bbl, amt); setTxt(""); }}
      >
        Pay down{valid ? ` · ${usd(amt + pen)}` : ""}
      </button>
      {valid && pen > 0 && <span className="hint">incl. {usd(pen)} prepayment penalty</span>}
    </div>
  );
}

/**
 * SELL THE LAND, KEEP THE BUILDING. The quote before the button: what the dirt
 * sells for, the rent it costs you from here, what reaches you after the
 * mortgage and the tax, and what it does to the building's mark — which falls
 * by the land's price, because the deal is value-neutral before its costs.
 * On a leasehold: the rent in force and what buying the land back costs today.
 */
function LeaseholdSection({ bbl }: { bbl: string }) {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const h = game.holdings[bbl];
  if (!h) return null;
  const g = h.groundRentOut;
  if (g) {
    const cost = landBuybackCost(game, h);
    return (
      <div className="deal">
        <div className="deal-head">Leasehold · fee owner {g.holder}</div>
        <div className="grid">
          <Row k="Ground rent" v={`${usd(g.rentYr)}/yr · +${(g.stepPct * 100).toFixed(0)}% each ${monthLabel(g.lastStepM + 12).split(" ")[0]}`} />
          <Row k="Term" v={`to ${monthLabel(g.endM)}`} />
          <Row k="Land sold for" v={usd(g.price)} />
          <Row k="Buyback cost" v={usd(cost)} title="Ground rent / current yield + transfer and legal." />
        </div>
        <div className="btn-row">
          <button className="btn" disabled={fundableNow(game, parcels) < cost} onClick={() => useStore.getState().buyLandBack(bbl)}>
            Buy back land · {usd(cost)}
          </button>
          <ShortBy need={cost} have={fundableNow(game, parcels)} />
        </div>
      </div>
    );
  }
  const q = leaseholdQuote(game, parcels, bbl);
  return (
    <div className="deal">
      <div className="deal-head">Land sale-leaseback</div>
      <div className="hint">
        99-yr ground lease back to you. Ground rent reduces NOI and escalates annually. No maturity or covenants.
      </div>
      {q.price > 0 && (
        <div className="grid">
          <Row k="Land price" v={usd(q.price)} />
          <Row k="Ground rent" v={`${usd(q.rentYr)}/yr · ${q.yieldPct.toFixed(2)}% · +${(LEASEHOLD_STEP * 100).toFixed(0)}%/yr`} />
          <Row k="Costs" v={usd(-q.costs)} />
          {q.payoff > 0 && <Row k="Mortgage retired" v={usd(-q.payoff)} />}
          {q.tax > 0 && <Row k="Tax on gain" v={usd(-q.tax)} />}
          <Row k="Net proceeds" v={usd(q.toOwner)} strong bad={q.toOwner < 0} />
          <Row k="Building value after" v={`${usd(q.valueAfter)} (was ${usd(q.valueBefore)})`} />
        </div>
      )}
      {!q.ok && q.why && <div className="hint">{q.why}</div>}
      <div className="btn-row">
        <button className="btn" disabled={!q.ok} onClick={() => useStore.getState().sellLandLeaseBack(bbl)}>
          Sell land · {usd(Math.max(0, q.toOwner))} net
        </button>
      </div>
    </div>
  );
}

/**
 * A PARTNER IN THIS BUILDING. Sell a quarter or just under half to a passive
 * investor at a minority discount; they take their share of every cheque and
 * fund their share of every call, and the big decisions wait on them. On a JV
 * deed: who, how much, and what buying them out costs today.
 */
/** A fraction as a whole percent. */
const pc = (x: number) => `${Math.round(x * 100)}%`;

function StakeSection({ bbl }: { bbl: string }) {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const [share, setShare] = useState(JV_SHARES[0]);
  const h = game.holdings[bbl];
  if (!h) return null;
  const syn = syndicateView(game, parcels, bbl);
  if (syn) {
    const pastPref = syn.owedAtPref <= 0;
    const pastHurdle = syn.owedAtHurdle <= 0;
    return (
      <div className="deal">
        <div className="deal-head">Syndicated · {syn.investor} since {monthLabel(syn.formedM)}</div>
        <div className="hint">
          Monthly waterfall: capital + {pc(syn.pref)} pref pari passu, then {pc(syn.promote)} promote above {pc(syn.hurdle)} IRR.
          Shortfalls called at {pc(syn.lpShare)} LP share up to commitment; overruns beyond are yours. Refi allowed; plan, land or title changes blocked.
        </div>
        <div className="grid">
          <Row k="Committed · called" v={`${usd(syn.lpCommit)} · ${usd(syn.lpCalled)}`} />
          <Row k="Distributed to LPs" v={usd(syn.lpDist)} />
          {syn.flags.length > 0 && (
            <Row k="LP report flags" bad
              v={syn.flags.map((f) => ({ late: "behind schedule", over: "over budget", leaseup: "below pro forma income", dist: "no distributions in 12 mo" } as Record<string, string>)[f] ?? f).join(" · ")}
              title="−3 investor record per flag until deal resolves (max −10/deal)." />
          )}
          <Row k="LP capital share" v={pc(syn.capShare)} />
          <Row k="Owed to pref" v={pastPref ? "Pref paid" : usd(syn.owedAtPref)} />
          <Row k={`To ${pc(syn.hurdle)} hurdle`} v={pastHurdle ? "Cleared · promote earned" : usd(syn.owedAtHurdle)} />
          <Row k="Equity · total · GP · LP" v={`${usd(syn.equity)} · ${usd(syn.yours)} · ${usd(syn.theirs)}`} title="Marked equity run through the waterfall today." />
        </div>
        {(() => {
          // REFINANCE THEM OUT AND KEEP IT (recap.ts): their waterfall take on
          // a sale at the appraisal, no broker, plus the band's fairness premium.
          const q = recapQuote(game, parcels, bbl);
          if (!q.ok) return <div className="hint">Buy them out: {q.why}</div>;
          const can = fundableNow(game, parcels) >= q.total;
          return (
            <>
              <div className="grid" style={{ marginTop: 6 }}>
                <Row k="LP buyout" v={`${usd(q.price)}${q.premium ? ` (incl. ${usd(q.premium)} fairness premium)` : ""}${q.transferTax ? ` + ${usd(q.transferTax)} transfer tax` : ""}`}
                  title={`LP waterfall share at ${usd(q.appraisal)} appraisal, no broker. Resale >15% higher within 2 yrs hurts investor record.`} />
              </div>
              <div className="btn-row">
                <button className="btn" disabled={!can} onClick={() => useStore.getState().recapBuyout(bbl)}>Buy them out · {usd(q.total)}</button>
                <ShortBy need={q.total} have={fundableNow(game, parcels)} />
              </div>
            </>
          );
        })()}
      </div>
    );
  }
  if (h.jv) {
    const cost = buyoutCost(game, parcels, h);
    return (
      <div className="deal">
        <div className="deal-head">Partner · {h.jv.partner} owns {Math.round(h.jv.share * 100)}%</div>
        <div className="hint">
          {Math.round(h.jv.share * 100)}% of cash flow, sale proceeds and capital calls. Debt, paydown, renovation, conversion or land sale require buyout.
        </div>
        <div className="grid">
          <Row k="Partner paid" v={`${usd(h.jv.price)} · ${monthLabel(h.jv.sinceM)}`} />
          <Row k="Buyout cost" v={usd(cost)} title="Pro-rata equity (no minority discount) + legal and transfer." />
        </div>
        <div className="btn-row">
          <button className="btn" disabled={fundableNow(game, parcels) < cost} onClick={() => useStore.getState().buyOutPartner(bbl)}>
            Buy them out · {usd(cost)}
          </button>
          <ShortBy need={cost} have={fundableNow(game, parcels)} />
        </div>
      </div>
    );
  }
  const q = stakeQuote(game, parcels, bbl, share);
  return (
    <div className="deal">
      <div className="deal-head">Sell JV stake</div>
      <div className="hint">
        Passive minority stake at {Math.round(JV_MINORITY_DISCOUNT * 100)}% discount to pro-rata equity. Partner shares cash and calls; major decisions need consent.
      </div>
      <div className="btn-row">
        {JV_SHARES.map((sh) => (
          <button key={sh} className={"btn" + (sh === share ? " btn-on" : "")} onClick={() => setShare(sh)}>{Math.round(sh * 100)}%</button>
        ))}
      </div>
      {q.equity > 0 && (
        <div className="grid">
          <Row k="Building equity" v={usd(q.equity)} />
          <Row k={`${Math.round(share * 100)}% stake price`} v={usd(q.price)} />
          {q.tax > 0 && <Row k="Tax on gain" v={usd(-q.tax)} />}
          <Row k="Net proceeds" v={usd(q.toOwner)} strong />
        </div>
      )}
      {!q.ok && q.why && <div className="hint">{q.why}</div>}
      <div className="btn-row">
        <button className="btn" disabled={!q.ok} onClick={() => useStore.getState().sellStake(bbl, share)}>
          Sell {Math.round(share * 100)}% · {usd(Math.max(0, q.toOwner))} net
        </button>
      </div>
    </div>
  );
}

/**
 * A PER-BUILDING FIT-OUT CAP FROM BEFORE THE FIRM-WIDE LIMIT. Saves that set
 * one keep it — it still binds, on top of the team's concession limit — and
 * the row says so and offers to clear it. New buildings never show it: the
 * firm's limit reads the market for each space, which a $/sf-per-lease-year
 * figure typed into each deed could not.
 */
function LegacyTiCapRow({ bbl }: { bbl: string }) {
  const game = useStore((s) => s.game)!;
  const h = game.holdings[bbl];
  const cap = h ? autoTiCapToday(game, h) : undefined;
  if (cap === undefined) return null;
  return (
    <div className="btn-row" style={{ alignItems: "center" }}>
      <span className="hint">Building TI cap ${cap.toFixed(2)}/sf/lease yr (plus firm limit)</span>
      <button className="btn btn-mini" onClick={() => useStore.getState().autoTiCap(bbl, undefined)}>Clear</button>
    </div>
  );
}

/**
 * SPLIT THIS LOT (engine/lotsplit.ts): any deed you own, downtown or not, cut
 * into lots that each meet the code. Folded until asked for; the tool itself
 * is the building file's Split tab (ui/next/SplitTab.tsx).
 */
function SplitCard({ bbl }: { bbl: string }) {
  const game = useStore((s) => s.game);
  const parcels = useStore((s) => s.parcels);
  const [open, setOpen] = useState(false);
  if (!game || !parcels) return null;
  const pending = (game.splits ?? []).some((x) => x.parent === bbl && !x.done && !x.lapsed);
  const deny = pending ? null : splittable(game, parcels, bbl);
  return (
    <div className="deal">
      <div className="deal-head">
        Split the lot <span className="dim">· {pending ? "filed" : deny ? "not now" : "minor 2-4 lots · plat 5+"}</span>
        <button type="button" className="btn-mini" style={{ float: "right" }} onClick={() => setOpen(!open)}>{open ? "Close" : "Split…"}</button>
      </div>
      {!open && deny && <div className="hint">{deny}</div>}
      {open && <SplitTab game={game} parcels={parcels} bbl={bbl} />}
    </div>
  );
}
