import { memo, useState } from "react";
import Slider from "@/ui/Slider";
import { useStore } from "@/state/store";
import { useHeldGame } from "@/ui/heldGame";
import { CLASS_COLOR, CLASS_LABEL } from "@/data/types";
import { monthLabel, CREDIT_LABEL, OPS_SERVICE, OPS_PLAN, serviceSpec, planSpec, START_YEAR } from "@/engine/types";
import type { Approach, BuiltClass, Contract, DevUse } from "@/engine/types";
import { assetValue, initialCondition, holdingValue, marketRentPsfYr, managedRentPsfYr, holdingNOIYr, renovationCost, resolveRec, propertyTaxYr, useRentPsfYr, operatingStatement, recoveryOf, landValue, inPlace, proFormaNOIYr, disclosureFor, asIfOwned, remainingAbatement, bareLandRec, leasedFeeValue, isVacantLandLoanCollateral } from "@/engine/value";
import { adaptiveReuseEligibility, planAdaptiveReuse, planDevelopment, constructionQuotes, PROGRAMS, programCost, farMaxFor, maxFloorsFor, maxRetailShare, retailWantsMixed, demolitionCost, unitRange, suiteSfForUnits, SUITE_BOUNDS } from "@/engine/dev";
import { buyQuote, assemblagePressure, saleTaxQuote, quietFeeRate, hasOwnedSiteNeighbor, siteDeeds } from "@/engine/actions";
import { sellerOf, sellerProfile, MAX_TALKS, DEPOSIT_PCT } from "@/engine/acquire";
import { isCommercial, vacantSf, walt, notReadySf, unitStatus, unitCount, suiteSf, useSuiteSf, avgUnitSf, buyoutQuote, BUYOUT_PREMIUM, leasableUses, renewalIntent } from "@/engine/leasing";
import { dscr, ltv, rateCapCost, refiQuotes, PRODUCTS, prepayPenalty } from "@/engine/debt";
import { holderOf, holdingsOf, relOf, isCold, standingWith } from "@/engine/owners";
import { lenderBlurb, CONSTRUCTION_LENDER } from "@/engine/lenders";
import { locAvailable } from "@/engine/credit";
import { isMixedUse, mixLabel, mixOf, uses as usesOf, useSf, USE_WORD } from "@/engine/mix";
import { ownerOf, gradeOf } from "@/engine/rivals";
import { taxAppealQuote } from "@/engine/tax";
import { usd, sf, pct } from "@/ui/format";
import { LettingOdds, LeasingDesk, ResidualRead, LandDesk } from "@/ui/panels/PropertyDesks";
import { useLabel, devUseLabel, physicalOcc, goingIn, band, apMid, PropTab, annualPayment, openResearchOn, Neighbourhood, Row } from "@/ui/panels/shared";


function ParcelPanelShell({ embedded = false, tab }: { embedded?: boolean; tab?: PropTab } = {}) {
  // Closed card: do not subscribe to `game` at all — every LOI/cash write used
  // to rebuild this whole file for a panel that was not on screen.
  const selectedBBL = useStore((s) => s.selectedBBL);
  if (!selectedBBL) return null;
  return <ParcelPanelInner embedded={embedded} tab={tab} selectedBBL={selectedBBL} />;
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

  if (!parcels) return null;
  const rec = resolveRec(parcels, game, selectedBBL);
  if (!rec) return null;
  const dev = game.developments[selectedBBL];
  const neighbors = adjacency?.[selectedBBL] ?? [];
  const holding = game.holdings[selectedBBL];
  const listing = game.listings.find((l) => l.bbl === selectedBBL);
  const appr = game.approaches[selectedBBL];
  const cond = holding?.condition ?? initialCondition(rec);
  const glLive = holding ? game.groundLeases?.[selectedBBL] : undefined;
  const value = holding
    ? (holding.groundLeased && glLive
      ? leasedFeeValue(glLive, bareLandRec(parcels, game, selectedBBL) ?? rec, game.econ, game.month,
        glLive.sf ?? game.built?.[selectedBBL]?.bldgArea ?? 0)
      : holdingValue(rec, game.econ, holding, game.month))
    : assetValue(rec, game.econ, cond);
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
  // No tab means the docked card, which shows the whole file as it always has.
  const on = (t: PropTab) => tab === undefined || tab === t;
  // Land desk: property-page Build tab always; docked card only when the lot
  // can assemble / is land / is already folded — not on every leased tower.
  // Ground-leased lots stay on this desk even after the lessee's frame rises.
  const showLandDesk = !!holding && on("build") && (
    tab === "build"
    || rec.class === "land"
    || !!holding.groundLeased
    || !!holding.groundOffer
    || !!game.merged?.[selectedBBL]
    || siteDeeds(game, selectedBBL).length > 1
    || !!(adjacency && hasOwnedSiteNeighbor(game, adjacency, selectedBBL))
  );

  return (
    <div className={embedded ? "panel-embed" : "panel"}>
      {!embedded && (
        <div className="panel-head">
          <div>
            <div className="panel-address">{rec.address}</div>
            <div className="panel-bbl mono">Parcel {rec.bbl}</div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
            <button className="btn-mini" title="Open the property as a full desk" onClick={() => useStore.getState().setPage("property")}>full view</button>
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
          // ...AND MOST OF THE TIME THERE IS A NAME ON IT NOW. The archetype is
          // still what a broker leads with — it is the first thing you learn
          // about how hard the door is — but it belongs to somebody, that
          // somebody owns other buildings, and how you have treated them
          // before is the most important fact in the room. See engine/owners.ts.
          const held = holderOf(game, parcels, selectedBBL);
          const kind = sellerOf(game, parcels, selectedBBL).kind;
          if (!held) return <div className="hint">{sellerProfile(kind).holds}</div>;
          const book = holdingsOf(game, parcels, held.id);
          const rel = relOf(game, held.id);
          const cold = isCold(game, held.id);
          return (
            <div className="hint">
              Owned by <strong>{held.name}</strong>
              {book.length > 1 && <span> — {book.length} buildings in town</span>}.
              <div style={{ marginTop: 3 }}>{held.note}</div>
              <div style={{ marginTop: 3 }} className={cold ? "neg" : (rel.deals ?? 0) > 0 ? "" : "dim"}>
                {standingWith(game, held.id)}
              </div>
              {book.length > 1 && (
                <div className="dim" style={{ marginTop: 3 }}>
                  {book.filter((b) => b !== selectedBBL).slice(0, 4).map((b) => (
                    <span key={b}>
                      <a className="lnk" onClick={(e) => { e.stopPropagation(); useStore.getState().focus(b, true); }}>
                        {parcels[b]?.address ?? b}
                      </a>
                      {" · "}
                    </span>
                  ))}
                  {book.length > 5 ? `and ${book.length - 5} more` : ""}
                </div>
              )}
            </div>
          );
        }
        return (
          <div className="hint" style={{ cursor: "pointer" }}
            title="Open this firm's balance sheet on The street."
            onClick={() => { openResearchOn("street"); useStore.getState().setPage("research"); }}>
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
        {/* ONE LINE PER MARKET, because a building with shops under offices is
            in two of them and the average of the two is a rent nobody signs.
            The blend is the right number for an appraisal and the wrong one
            for a lease — see managedRentPsfYr — and this row was the blend
            with "market rent" written next to it, which is where the sense
            that shops lease miles under the market came from: they were being
            compared against a number that was mostly office. */}
        {isBuilt && (() => {
          const legs = leasableUses(rec);
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
          return <Row k={ip.disclosed ? "Occupancy (in place)" : "Occupancy (mkt est.)"}
            v={(ip.occ * 100).toFixed(0) + "%"} bad={ip.disclosed && ip.occ < 0.75} />;
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
        {holding && commercial && holding.tenants.length > 0 && (
          <Row
            k="On the rent roll"
            v={`${holding.tenants.length} lease${holding.tenants.length === 1 ? "" : "s"} · ${sf(holding.tenants.reduce((a, t) => a + t.sf, 0))}`}
          />
        )}
        {holding && commercial && <Row k="WALT" v={walt(holding, game.month).toFixed(1) + " yrs"} />}
        {/* One building must not quote two different NOIs on one panel. In
            place off the roll — yours, or the one the seller disclosed — and
            struck against the appraisal, which is the only price on offer
            until somebody names one. The stabilised line sits beside it,
            labelled, because the gap between them is the deal. */}
        {isBuilt && (() => {
          const ip = goingIn(game, selectedBBL, value);
          const stab = proFormaNOIYr(rec, game.econ, ip.h?.condition ?? cond, value);
          const os = holding ? operatingStatement(rec, game.econ, holding, game.month) : null;
          const abate = holding ? remainingAbatement(holding, game.month) : 0;
          return (
            <>
              <Row k={ip.disclosed ? "In-place NOI / yr" : "NOI / yr (mkt est.)"} v={usd(ip.noi)} />
              {os && os.freeRent > 0 && (
                <Row
                  k="Scheduled rent (abated)"
                  v={usd(os.baseRent + os.freeRent) + "/yr"}
                  title={`${usd(os.freeRent)}/yr is free rent still burning — occupancy is up; this NOI has not caught it yet`}
                />
              )}
              {abate > 0 && <Row k="Free rent still owed" v={"−" + usd(abate)} bad />}
              {ip.disclosed && stab > ip.noi * 1.02 && (
                <Row k="Stabilised pro-forma" v={usd(stab)} />
              )}
            </>
          );
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
                      {yrsIn >= 5 && <span className="dim"> · since {START_YEAR + Math.floor(t.startM / 12)}</span>}
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
                const ip = goingIn(game, selectedBBL, px);
                const stab = proFormaNOIYr(rec, game.econ, ip.h?.condition ?? cond, px);
                return (
                  <>
                    <Row k={ip.disclosed ? "In-place NOI / yr" : "NOI / yr (mkt est.)"} v={usd(ip.noi)} bad={ip.noi < 0} />
                    <Row k="Going-in cap" v={((ip.noi / Math.max(1, px)) * 100).toFixed(2) + "%"} strong />
                    {/* The seller's other number, and it is labelled as the
                        forecast it is. What you buy is the line above. */}
                    <Row k="Stabilised pro-forma" v={`${usd(stab)} · ${((stab / Math.max(1, px)) * 100).toFixed(2)}%`} />
                    <Row
                      k={ip.disclosed ? "Occupancy (in place)" : "Occupancy (mkt est.)"}
                      v={(ip.occ * 100).toFixed(0) + "%"}
                    />
                    {ip.h && <Row k="In place" v={`${ip.h.tenants.length} lease${ip.h.tenants.length === 1 ? "" : "s"}`} />}
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
                <Row k="Close by" v={monthLabel(offContract.closeByM ?? game.month)} bad />
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
                  : appr.named
                    ? "You can counter it — but they named this figure in answer to your bid, so it is already close to their floor and they know you want the building. A few per cent is a negotiation; fifteen is an insult."
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
                : "None yet — tenants who take delivery risk show up here"}
              strong={(dev.signed?.length ?? 0) > 0}
            />
          </div>
          {(dev.signed?.length ?? 0) > 0 && (
            <div className="mini-list" style={{ marginTop: 8 }}>
              {dev.signed!.map((sg, i) => (
                <div key={i} className="mini-row" style={{ cursor: "default" }}>
                  <span>{(sg.use || "space")} · {sf(sg.sf)}</span>
                  <span className="mono dim">{((1 - sg.discount) * 100).toFixed(0)}% under market for delivery risk</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {on("build") && holding && !dev && rec.class === "land" && <DevelopSection bbl={selectedBBL} />}
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
            {leasableUses(rec).map((u) => (
              <Row
                key={u}
                k={leasableUses(rec).length > 1 ? `Asking · ${CLASS_LABEL[u] ?? u}` : "Asking rent"}
                v={"$" + managedRentPsfYr(rec, game.econ, holding, u).toFixed(2) + " /sf on new leases"}
              />
            ))}
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

      {/* THE OFFERING MEMORANDUM, ON THE PAGE WHERE YOU DECIDE. It is no use
          for the engine to price the disclosed roll if the player cannot read
          it: what is let, to whom, at what rent, expiring when. Renders on the
          acquire tab for anything the seller has actually shown you — a tape
          listing or an open off-market conversation — and on nothing else. */}
      {on("deal") && !holding && isBuilt && <DisclosedRoll bbl={selectedBBL} />}

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

/** Memo: GamePanels re-renders on every page toggle; the docked card must not. */
export const ParcelPanel = memo(ParcelPanelShell);

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
          Nobody is selling this building and nobody has shown you anything. The occupancy and income
          on this page are the class model's read on a building like this one, not a fact about this
          one. Ring the owner and the paper comes over with the conversation.
        </div>
      </div>
    );
  }
  const li = game.listings.find((l) => l.bbl === bbl);
  const px = li?.ask ?? game.approaches[bbl]?.ask ?? assetValue(rec, game.econ, gradeOf(game, rec));
  const h = asIfOwned(game, bbl, px, d, rec);
  const st = operatingStatement(rec, game.econ, h, game.month);
  const roll = [...(d.roll ?? [])].sort((a, b) => b.sf - a.sf);
  const commSf = Math.round(rec.bldgArea * (1 - (mixOf(rec).multifamily ?? 0)));
  const resSf = Math.round(useSf(rec, "multifamily"));
  const vacant = Math.max(0, commSf - roll.reduce((a, t) => a + t.sf, 0));
  return (
    <div className="deal">
      <div className="deal-head">
        The rent roll, as disclosed · {(physicalOcc(rec as never, h) * 100).toFixed(0)}% let
      </div>
      <div className="hint">
        {li ? "Off the offering memorandum." : "The owner's roll, sent over with the conversation."}{" "}
        This is what the deed conveys — the same leases, the same rents, the same dates.
        Whether any of them renews is not in here, and that is the deal you are being offered.
      </div>
      {roll.length > 0 && (
        <div className="roll">
          {roll.map((t, i) => {
            const yrsLeft = (t.endM - game.month) / 12;
            return (
              <div key={i} className="roll-row">
                <span className="roll-name">
                  {t.name} <span className="roll-credit mono">{CREDIT_LABEL[t.credit]}</span>
                </span>
                <span className="roll-meta mono">
                  {(t.sf / 1000).toFixed(1)}k sf · ${t.rentPsf.toFixed(0)} {recoveryOf(t).toUpperCase()} · exp {monthLabel(t.endM)}
                  {yrsLeft < 2 && <> · <span className="warn">{yrsLeft <= 0 ? "holding over" : `${yrsLeft.toFixed(1)} yrs left`}</span></>}
                </span>
              </div>
            );
          })}
          {vacant > 400 && (
            <div className="roll-row roll-vacant">
              <span className="roll-name">Vacant</span>
              <span className="roll-meta mono">
                {(vacant / 1000).toFixed(1)}k sf · ${useRentPsfYr(rec, game.econ, h.condition, (usesOf(rec).find((u) => u !== "multifamily") ?? "office") as BuiltClass).toFixed(0)}/sf market here
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
        <div className="hint">Not one square foot of it is let. That is the whole of the disclosure.</div>
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
        <Row k="Operating expenses" v={"−" + usd(st.opex)} />
        <Row k="Management" v={"−" + usd(st.mgmt)} />
        <Row k={`Property tax at ${usd(px)}`} v={"−" + usd(st.tax)} />
        <Row k="In-place NOI / yr" v={usd(st.noi)} strong bad={st.noi < 0} />
        <Row k="Going-in cap at that price" v={px > 0 ? ((st.noi / px) * 100).toFixed(2) + "%" : "—"} strong />
      </div>
    </div>
  );
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
  // YOUR OWN ROLL, RE-ASSESSED AT YOUR ASK. This quoted the class model, so a
  // principal pricing their own half-empty building was shown the yield a full
  // one would offer — and every buyer in town was reading the real roll. The
  // number a seller needs is what a buyer will compute: in-place income off
  // the leases actually in place, against a tax bill struck at the new price.
  const saleH = game.holdings[bbl];
  const saleNoi = saleRec && saleRec.class !== "land" && saleRec.bldgArea > 0 && saleH
    ? holdingNOIYr(saleRec, game.econ,
        asIfOwned(game, bbl, price, { roll: saleH.tenants, occ: saleH.occ, cond: saleH.condition }, saleRec),
        game.month)
    : 0;
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
          Sell it quietly · {usd(price)}
          {quietFeeRate(game) <= 0.0001 ? " · no fee" : ` less ${usd(Math.round(price * quietFeeRate(game)))} fee`}
        </button>
      </div>
      <div className="hint">
        The campaign costs {usd(Math.round(price * (0.025 - quietFeeRate(game))))} more and two to four months, and
        ends with every bid on your desk on the same day — plus one go back to the top of the list. That is what
        the extra buys: not a better building, a better-tested price. A quiet sale finds you one buyer at a time,
        whoever happens to ring, and you never learn what the best buyer in the city would have paid.
        {quietFeeRate(game) <= 0.0001
          ? " It costs you nothing in fees today, because enough of the street has traded with you that you can find that buyer yourself."
          : ` The quiet fee is ${(quietFeeRate(game) * 100).toFixed(2)}% and falls toward nothing as more of the named firms in town have actually dealt with you.`}
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
        hint="One shot. Shallow cuts often land, or they come off their number a little. Deep cuts get the phone hung up."
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
            ? `You bid ${live.lastBid ? usd(live.lastBid) : "once"} and never went back.`
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
        They took the call — and they will not put a price on it. <em>"Make me an offer."</em>
        {" "}There is no asking number to display; the only move is yours.
      </div>
      <div className="grid">
        <Row k="Asking price" v="they will not name one" strong />
        <Row k="Appraisal" v={band(bbl, value)} />
        <Row k="They will listen until" v={monthLabel(live.q + 6)} />
        {probes > 0 && (
          <Row
            k="Bids you have made"
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
        No lender, no leverage, no stack — just the number. If they take it, {usd(Math.round(bid * DEPOSIT_PCT))} of
        earnest money goes hard and you get three months to structure the debt and close.
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
export function OfferDesk({ bbl, price }: { bbl: string; price: number }) {
  const game = useHeldGame(bbl);
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
  // THE RESOLVED RECORD. `parcels[bbl]` is the lot as GENERATED — a delivered
  // tower reads as the dirt it used to be, which is the same fault buyQuote
  // fixed on the lender's side and left standing here.
  const rec = resolveRec(parcels, game, bbl);
  const ip = rec ? inPlace(rec, game, bbl, offerPrice) : null;
  const noi = ip?.noi ?? 0;
  const goingInPct = offerPrice > 0 && noi > 0 ? (noi / offerPrice) * 100 : null;
  const stab = rec ? proFormaNOIYr(rec, game.econ, ip?.h?.condition ?? initialCondition(rec), offerPrice) : 0;
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
      {goingInPct !== null && (
        <div className="grid">
          <Row k={ip?.disclosed ? "In-place NOI / yr, after taxes" : "NOI / yr (mkt est.)"} v={usd(noi)} />
          <Row k="Going-in cap at your number" v={`${goingInPct.toFixed(2)}%`} strong />
          {/* Stabilised beside it and never instead of it. If this line is far
              above the one at the top, you are buying a leasing job. */}
          <Row k="Stabilised pro-forma" v={`${usd(stab)} · ${offerPrice > 0 ? ((stab / offerPrice) * 100).toFixed(2) : "—"}%`} />
          {ip?.disclosed && <Row k="Occupancy (in place)" v={`${(ip.occ * 100).toFixed(0)}%`} bad={ip.occ < 0.75} />}
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
  const [product, setProduct] = useState<string>(isLand ? "land" : "savings");
  const [lev, setLev] = useState(1);
  // Thesis → Structure → Commit: one job per stage so the close cheque is not
  // competing with product chips and the underwriting grid on the same scroll.
  const [stage, setStage] = useState<"thesis" | "structure" | "commit">("thesis");
  const offerPrice = Math.round(price);
  const max = buyQuote(game, parcels, bbl, offerPrice, product, 1);
  const principal = Math.round(max.principal * lev);
  const equity = offerPrice - principal + Math.round(offerPrice * 0.02);
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
  const noi = ip?.noi ?? 0;
  const stab = rec ? proFormaNOIYr(rec, game.econ, ip?.h?.condition ?? initialCondition(rec), offerPrice) : 0;
  // ACTUAL first-year debt service — amortizing payment for amortizing paper,
  // coupon-only for IO periods — not the IO approximation for everything.
  const prodDef = PRODUCTS.find((pp) => pp.id === product);
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
          <div className="hint">What you are buying at {usd(offerPrice)} — income first, leverage later.</div>
          <div className="grid">
            {rec && rec.class !== "land" && rec.bldgArea > 0 ? (
              <>
                <Row k={ip?.disclosed ? "In-place NOI / yr" : "NOI / yr (mkt est.)"} v={usd(noi)} bad={noi < 0} />
                {ip?.disclosed && <Row k="Occupancy (in place)" v={`${(ip.occ * 100).toFixed(0)}%`} bad={ip.occ < 0.75} />}
                <Row k="Going-in cap" v={`${goingInPct.toFixed(2)}%`} strong />
                <Row k="Stabilised pro-forma" v={`${usd(stab)} · ${stabPct.toFixed(2)}%`} />
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
          <div className="btn-row" style={{ marginTop: 4 }}>
            {PRODUCTS.filter((p) => !p.mezz && (isLand ? p.id === "land" : p.id !== "land")).map((p) => {
              const pq = buyQuote(game, parcels, bbl, offerPrice, p.id, 1);
              return (
                <button
                  key={p.id}
                  className={"btn" + (product === p.id ? " btn-on" : "")}
                  disabled={pq.principal <= 0}
                  style={pq.principal <= 0 ? { opacity: 0.42, cursor: "not-allowed" } : undefined}
                  title={pq.principal <= 0
                    ? `${p.label} will not lend against this building today — ${p.blurb}`
                    : `${p.blurb}\n${(p.maxLTV * 100).toFixed(0)}% max LTV · ${p.amortYears}-yr amort · ${Math.round(p.termM / 12)}-yr term`}
                  onClick={() => setProduct(p.id)}
                >
                  {p.label}{pq.principal > 0 ? ` · ${pq.ratePct.toFixed(2)}% · ${(p.maxLTV * 100).toFixed(0)}% LTV` : " · won't quote"}
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
          {max.principal <= 0 && (
            <div className="hint">{product === "cash" ? "Buying it outright." : "No lender will size a loan against this income — all cash or nothing."}</div>
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
                <Row k="Coupon" v={`${max.ratePct.toFixed(2)}%${negLev ? " — negative leverage" : ""}`} bad={negLev} />
                {principal > 0 && <Row k="Debt yield" v={`${dy.toFixed(1)}%`} bad={dy < 8} />}
                {principal > 0 && <Row k="Annual debt service" v={`−${usd(annualDs)}${prodDef && prodDef.ioM > 0 ? " (interest-only)" : ` (${prodDef?.amortYears ?? 30}-yr am)`}`} />}
                {prodDef && (
                  <Row
                    k="Terms"
                    v={`${prodDef.ioM ? `${Math.round(prodDef.ioM / 12)}-yr IO, ` : ""}${prodDef.amortYears}-yr amort, `
                      + `${Math.round(prodDef.termM / 12)}-yr term, ${(prodDef.maxLTV * 100).toFixed(0)}% max LTV`}
                  />
                )}
                <Row k="Year-1 cash flow" v={usd(cf)} bad={cf < 0} />
                <Row k="Cash-on-cash" v={`${coc.toFixed(1)}%`} bad={coc < 0} />
              </>
            )}
            <Row k="Equity to close" v={usd(equity)} strong bad={equity > game.cash} />
          </div>
          <div className="btn-row">
            <button type="button" className="btn" onClick={() => setStage("structure")}>◂ Structure</button>
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
          {equity > game.cash && <div className="hint">Short {usd(equity - game.cash)} — the line of credit is on Capital → Debt.</div>}
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
export function ListSection({ bbl, appraisal, onDone }: { bbl: string; appraisal: number; onDone: () => void }) {
  const game = useHeldGame(bbl);
  const listSale = useStore((s) => s.listSale);
  const [ask, setAsk] = useState(Math.round(appraisal * 1.02));
  const quiet = quietFeeRate(game);
  const over = appraisal > 0 ? ask / appraisal - 1 : 0;
  const leasedFee = !!game.groundLeases?.[bbl];
  return (
    <div style={{ padding: "8px 2px" }}>
      {leasedFee && (
        <div className="hint" style={{ marginBottom: 8 }}>
          This is the leased fee — the coupon and the reversion, not free-and-clear dirt. Buyers underwrite it as a
          bond, and the ground lease goes with the deed.
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
          ? "Well over the appraisal. It can sit there a long time, and a listing that goes stale is read as a building nobody wanted."
          : over < -0.06
            ? "Under appraisal. It will go quickly, and every buyer in town will know why."
            : "About where the market is."}
      />
      <div className="btn-row" style={{ marginTop: 6 }}>
        <button className="btn btn-buy" onClick={() => { listSale(bbl, ask, "marketed"); onDone(); }}>
          Run a process · less {usd(Math.round(ask * 0.025))} fee
        </button>
        <button className="btn" onClick={() => { listSale(bbl, ask); onDone(); }}>
          Sell it quietly · {quiet <= 0.0001 ? "no fee" : `less ${usd(Math.round(ask * quiet))} fee`}
        </button>
      </div>
      <div className="hint">
        {quiet <= 0.0001
          ? "Your name is worth the brokerage on this one: enough of the street has traded with you that you can sell it off-market yourself, and there is nobody in the room to pay."
          : `A quiet sale costs ${(quiet * 100).toFixed(2)}% today. That falls as more of the named firms in town have actually traded with you — a building sold off-market is sold to somebody who already knew you had it — and it goes straight back up if the street decides you are a lowballer.`}
      </div>
    </div>
  );
}

export function RefiSection({ bbl }: { bbl: string }) {
  const game = useHeldGame(bbl);
  const parcels = useStore((s) => s.parcels)!;
  const { refi } = useStore.getState();
  const holding = game.holdings[bbl];
  // A leased fee with a ground rent is income paper, not vacant dirt — open
  // on an income desk even when the resolved class is still "land".
  const refiRec = resolveRec(parcels, game, bbl);
  const vacantDirt = !!holding && !!refiRec && isVacantLandLoanCollateral(game, holding, refiRec);
  const [product, setProduct] = useState<string>(vacantDirt ? "land" : "savings");
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
  // WHICH DESK YOU ARE ACTUALLY LOOKING AT.
  //
  // `product` opened at "savings" whether or not the savings bank quoted this
  // building, and every highlight on the screen was drawn off `product` while
  // every number was drawn off `quotes[0]`. So on any building the regional
  // did not quote — which since their $2.5M minimum is a great many — nothing
  // was lit up, the table had no selected row, and the panel was reporting one
  // desk's terms with another desk's name nowhere. The selection is whatever
  // quote is being read, and everything on the card keys off that.
  // ...and the fallback is a desk that will actually write, not merely the
  // first one in the list. Falling through to quotes[0] could land the card on
  // a lender quoting nothing, which is the same "describing a desk you are not
  // using" fault one step further along.
  const q = quotes.find((x) => x.id === product)
    ?? quotes.find((x) => x.available && x.maxProceeds > 0)
    ?? quotes[0];
  const picked = q.id;
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
            className={"btn" + (picked === x.id ? " btn-on" : "")}
            disabled={!x.available || x.maxProceeds <= 0}
            style={!x.available || x.maxProceeds <= 0 ? { opacity: 0.42, cursor: "not-allowed" } : undefined}
            title={x.why ?? x.blurb}
            onClick={() => setProduct(x.id)}
          >
            {x.label} · {x.available && x.maxProceeds > 0 ? pct(x.ratePct) : "won't quote"}
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
            <tr><th>Desk</th><th className="num">Rate</th><th className="num">Max LTV</th><th className="num">Most they'll write</th><th className="num">To you</th><th>What stops them</th></tr>
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
                  className={x.id === picked ? "" : "dim"}
                  style={{
                    cursor: x.available && x.maxProceeds > 0 ? "pointer" : "not-allowed",
                    opacity: x.available && x.maxProceeds > 0 ? undefined : 0.5,
                    // The selected desk was distinguished only by NOT being
                    // dimmed, which on a four-row table reads as nothing at
                    // all. This is the row whose terms the rest of the card is
                    // describing, and it says so.
                    background: x.id === picked ? "rgba(120,160,255,0.14)" : undefined,
                    fontWeight: x.id === picked ? 600 : undefined,
                  }}
                  onClick={() => x.available && x.maxProceeds > 0 && setProduct(x.id)}
                >
                  <td>{x.id === picked ? "▸ " : ""}{x.label}</td>
                  <td className="num">{x.available ? pct(x.ratePct) : "—"}</td>
                  <td className="num">{(x.maxLTV * 100).toFixed(0)}%</td>
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
        <Row k="Desk" v={`${q.label} · ${pct(q.ratePct)}`} strong />
        <Row k="Lender's maximum" v={`${usd(q.maxProceeds)} · ${(q.ltvAtMax * 100).toFixed(0)}% LTV against a ${(q.maxLTV * 100).toFixed(0)}% advance rate`} />
        {/* THE THREE NUMBERS THE COVERAGE RATIO IS MADE OF, at the amount the
            dial is actually set to.
            This row printed `dscrAtMax` — the coverage at the LENDER'S maximum
            — and never moved, so a player halving the draw watched the ratio
            they were halving it to fix sit perfectly still. And the two inputs
            were nowhere on the screen at all: a borrower cannot check a
            coverage ratio they cannot see the numerator of. `noiUw` is the
            income the desk sized against, which inside a lease-up is
            stabilised-less-holdback rather than what the building earns today,
            and that distinction belongs in front of the person signing. */}
        <Row
          k="Income underwritten"
          v={q.noiUw > 0 ? `${usd(Math.round(q.noiUw))} NOI a year` : "— no income to lend against"}
        />
        <Row
          k="Debt service"
          v={proceeds > 0 ? `${usd(Math.round(annualDs))} a year on ${usd(proceeds)}` : "—"}
        />
        <Row
          k="Coverage / debt yield"
          v={proceeds > 0 && annualDs > 0 && q.noiUw > 0
            ? `DSCR ${(q.noiUw / annualDs).toFixed(2)} · DY ${((q.noiUw / proceeds) * 100).toFixed(1)}%`
            : "— no income to cover it"}
          bad={proceeds > 0 && annualDs > 0 && q.noiUw > 0 && q.noiUw / annualDs < 1.20}
        />
        <Row k="What caps it" v={q.maxProceeds > 0 ? q.binding : "nothing to lend against"} bad={q.binding === "debt yield" && q.maxProceeds > 0} />
        <Row k="Structure" v={`${q.ioM ? `${Math.round(q.ioM / 12)}-yr IO, ` : ""}${q.amortYears}-yr amort, ${q.termM / 12}-yr term, ${(q.maxLTV * 100).toFixed(0)}% max LTV, ${q.floating ? "floating" : "fixed"}`} />
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
        format={() => `${usd(proceeds)} · ${((proceeds / Math.max(1, value)) * 100).toFixed(0)}% LTV`
          + (proceeds > 0 && annualDs > 0 && q.noiUw > 0 ? ` · DSCR ${(q.noiUw / annualDs).toFixed(2)}` : "")}
        marks={[{ at: 0.5, label: "half" }, { at: 0.8, label: "80%" }, { at: 1, label: "max" }]}
        hint={`${usd(annualDs)} a year of debt service against ${usd(Math.round(q.noiUw))} of NOI. `
          + `${toYou >= 0 ? `Cash out ${usd(toYou)} after the ${usd(fee)} fee.` : `You'd write a cheque for ${usd(-toYou)}.`}`}
      />
      {/* THE WHOLE DEAL AT WHATEVER THE DIAL SAYS, SIDE BY SIDE WITH THE ONE
          YOU HAVE.
          A refinance is not a question about proceeds, it is a question about
          what the building looks like AFTERWARDS — and the panel answered the
          first one on a slider and the second one nowhere. Every number here
          recomputes as the dial moves, and each is paired with what it is
          today, because the only useful form of "your coverage would be 1.34x"
          is "your coverage would be 1.34x, against 1.71x now".
          The cash flow line is the one that decides it. A cash-out refinance
          that leaves the building running at a deficit is a loan you service
          out of your other buildings, and that is the single most common way a
          good portfolio is lost — so it is on the screen in dollars, before
          you sign, with the sign it will actually have. */}
      {(() => {
        const cur = game.holdings[bbl]?.loan;
        const curDs = cur
          ? (game.month < cur.ioUntilM
            ? (cur.balance * cur.ratePct) / 100
            : cur.monthlyPmt * 12)
          : 0;
        const noi = q.noiUw;
        const cfNow = noi - curDs;
        const cfAfter = noi - annualDs;
        const ltvNow = value > 0 && cur ? cur.balance / value : 0;
        const dscrNow = curDs > 0 ? noi / curDs : null;
        const dscrAfter = annualDs > 0 ? noi / annualDs : null;
        const dyAfter = proceeds > 0 ? noi / proceeds : null;
        const cell = (k: string, now: string, after: string, bad?: boolean) => (
          <tr>
            <td>{k}</td>
            <td className="num dim">{now}</td>
            <td className={"num" + (bad ? " neg" : "")}><strong>{after}</strong></td>
          </tr>
        );
        return (
          <div className="scroll-x" style={{ marginTop: 6 }}>
            <table className="tbl">
              <thead>
                <tr><th>At {usd(proceeds)}</th><th className="num">Today</th><th className="num">After</th></tr>
              </thead>
              <tbody>
                {cell("Debt on the building", cur ? usd(cur.balance) : "none", usd(proceeds))}
                {cell("LTV", cur ? `${(ltvNow * 100).toFixed(0)}%` : "0%",
                  `${((proceeds / Math.max(1, value)) * 100).toFixed(0)}%`,
                  proceeds / Math.max(1, value) > 0.75)}
                {cell("Coverage (DSCR)", dscrNow !== null ? `${dscrNow.toFixed(2)}x` : "—",
                  dscrAfter !== null ? `${dscrAfter.toFixed(2)}x` : "—",
                  dscrAfter !== null && dscrAfter < 1.25)}
                {cell("Debt yield", cur && cur.balance > 0 ? `${((noi / cur.balance) * 100).toFixed(1)}%` : "—",
                  dyAfter !== null ? `${(dyAfter * 100).toFixed(1)}%` : "—",
                  dyAfter !== null && dyAfter < 0.08)}
                {cell("Debt service / yr", cur ? `−${usd(Math.round(curDs))}` : "—", `−${usd(Math.round(annualDs))}`)}
                {cell("Cash flow after debt / yr", `${cfNow < 0 ? "−" : ""}${usd(Math.abs(Math.round(cfNow)))}`,
                  `${cfAfter < 0 ? "−" : ""}${usd(Math.abs(Math.round(cfAfter)))}`, cfAfter < 0)}
                {cell("...per month", `${cfNow < 0 ? "−" : ""}${usd(Math.abs(Math.round(cfNow / 12)))}`,
                  `${cfAfter < 0 ? "−" : ""}${usd(Math.abs(Math.round(cfAfter / 12)))}`, cfAfter < 0)}
              </tbody>
            </table>
          </div>
        );
      })()}
      <div className="hint">
        {(() => {
          const noi = q.noiUw;
          const cfAfter = noi - annualDs;
          const dscrAfter = annualDs > 0 ? noi / annualDs : null;
          if (proceeds <= 0) return "Nothing drawn.";
          if (cfAfter < 0) {
            return `At this number the building does not cover its own debt service — ${usd(Math.abs(Math.round(cfAfter / 12)))} a month `
              + `has to come from somewhere else, every month, until something changes. That is a decision, not an accident.`;
          }
          if (dscrAfter !== null && dscrAfter < q.minDSCR) {
            return `Coverage lands at ${dscrAfter.toFixed(2)}x against this desk's ${q.minDSCR.toFixed(2)}x covenant. `
              + `You would be signing a loan that is in breach the day it funds — they sweep the cash flow and start the clock.`;
          }
          if (dscrAfter !== null && dscrAfter < q.minDSCR * 1.15) {
            return `Coverage lands at ${dscrAfter.toFixed(2)}x against a ${q.minDSCR.toFixed(2)}x covenant. That is not much room: `
              + `one tenant leaving takes you through it.`;
          }
          return `Coverage at ${dscrAfter?.toFixed(2)}x with the covenant at ${q.minDSCR.toFixed(2)}x — room to lose a tenant.`;
        })()}
      </div>
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
export type Stack = { retail: number; office: number; multifamily: number };
export function capStack(p: Stack, retailMaxPct: number): Stack {
  if (p.retail <= retailMaxPct) return p;
  const rest = p.office + p.multifamily;
  const office = rest > 0
    ? Math.round((p.office * (100 - retailMaxPct)) / rest)
    : Math.round((100 - retailMaxPct) / 2);
  return { retail: retailMaxPct, office, multifamily: 100 - retailMaxPct - office };
}

export function ReuseSection({ bbl }: { bbl: string }) {
  const game = useHeldGame(bbl);
  const parcels = useStore((s) => s.parcels)!;
  const rec = resolveRec(parcels, game, bbl);
  const [target, setTarget] = useState<"multifamily" | "mixed">("multifamily");
  if (!rec) return null;
  const eligibility = adaptiveReuseEligibility(game, parcels, bbl);
  const mixed = target === "mixed"
    ? { multifamily: 0.70, office: 0.20, retail: 0.10 }
    : undefined;
  const plan = eligibility.ok ? planAdaptiveReuse(game, parcels, bbl, target, mixed) : null;
  const equity = (plan?.equity ?? 0) + (plan?.pointsCost ?? 0);
  return (
    <div className="deal">
      <div className="deal-head">Adaptive reuse</div>
      <div className="hint">
        Keep the shell and convert the interior. The old building comes out of its space market when work starts;
        the new housing arrives only at delivery. Opportunity cost includes the income building you give up.
      </div>
      <div className="btn-row">
        <button className={"btn" + (target === "multifamily" ? " btn-on" : "")}
          onClick={() => setTarget("multifamily")}>Apartments</button>
        <button className={"btn" + (target === "mixed" ? " btn-on" : "")}
          onClick={() => setTarget("mixed")}>Mixed · 70% housing</button>
      </div>
      {!eligibility.ok ? (
        <div className="hint alarm">{eligibility.why}</div>
      ) : plan ? (
        <>
          <div className="grid">
            <Row k="Existing shell" v={`${sf(rec.bldgArea)} · ${rec.floors} floors · ${useLabel(rec)}`} />
            <Row k="After conversion" v={`${sf(plan.sf)} · ${target}`} strong />
            <Row k="Conversion budget" v={usd(plan.costTotal)} />
            <Row k="Opportunity cost in basis" v={usd(plan.landBasis)} />
            <Row k="Equity required" v={usd(equity)} strong bad={equity > game.cash + locAvailable(game, parcels)} />
            <Row k="Delivery" v={`${plan.months} months`} />
            <Row k="Yield / hurdle" v={`${plan.yieldOnCost.toFixed(2)}% / ${plan.requiredYield.toFixed(2)}%`}
              strong bad={plan.hurdleRatio < 1} />
          </div>
          <button className="btn btn-buy"
            disabled={plan.hurdleRatio < 1 || equity > game.cash + locAvailable(game, parcels)}
            onClick={() => useStore.getState().convertUse(bbl, target, mixed)}>
            Convert to {target === "multifamily" ? "apartments" : "mixed use"} · {usd(equity)}
          </button>
        </>
      ) : (
        <div className="hint">This shell cannot carry the target programme.</div>
      )}
    </div>
  );
}

export function DevelopSection({ bbl }: { bbl: string }) {
  const game = useHeldGame(bbl);
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
  const bts = game.btsProspects?.[bbl]?.use === use ? game.btsProspects[bbl] : undefined;
  const planMax = planDevelopment(game, parcels, bbl, use, fl, cov, contract, undefined, { mix: customMix, bts }, bank);
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
    planMax ? planMax.ltcMax * ltcWant : undefined, { mix: customMix, suites: suiteChoice, bts }, bank);
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
      {(use === "office" || use === "retail" || use === "industrial") && (
        <div className="page-section" style={{ marginTop: 8 }}>
          <div className="page-section-head">Delivery strategy</div>
          {bts ? (
            <>
              <div className="grid">
                <Row k="Build-to-suit tenant" v={`${bts.name} · credit ${CREDIT_LABEL[bts.credit]}`} strong />
                <Row k="Commitment" v={`${sf(bts.sf)} · ${(bts.termM / 12).toFixed(0)} years`} />
                <Row k="Rent" v={`$${bts.rentPsf.toFixed(2)}/sf · below market for certainty`} />
                <Row k="Tenant work" v={`$${bts.tiPsf}/sf · ${bts.recovery.toUpperCase()}`} />
              </div>
              <button className="btn" onClick={() => useStore.getState().clearBts(bbl)}>Return to spec</button>
            </>
          ) : (
            <>
              <div className="hint">
                Build on spec for market rent and lease-up risk, or find one credit tenant before groundbreak:
                lower rent and concentration risk in exchange for long term, day-one occupancy and stronger financing.
              </div>
              <button className="btn" onClick={() => useStore.getState().proposeBts(bbl, use, fl, cov)}>
                Find build-to-suit tenant
              </button>
            </>
          )}
        </div>
      )}
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
              v={`${plan.yieldOnCost.toFixed(2)}% vs ${plan.requiredYield.toFixed(2)}% required · `
                + `${plan.exitCap.toFixed(2)}% exit × developer margin · ${(plan.hurdleRatio * 100).toFixed(0)}% of hurdle`}
              strong
              bad={plan.hurdleRatio < 1}
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
              onClick={() => useStore.getState().develop(bbl, use, fl, cov, contract, plan.ltcMax * ltcWant, { mix: customMix, suites: suiteChoice, bts }, plan.lender)}
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
