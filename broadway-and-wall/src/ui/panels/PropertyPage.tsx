import { useEffect, useState } from "react";
import { returnsToDate } from "@/engine/standing";
import { useStore } from "@/state/store";
import { monthLabel } from "@/engine/types";
import { initialCondition, marketAppraisal, ownedHoldingNoiYr, resolveRec, rollQualitySpread, operatingStatement, remainingAbatement, inPlace } from "@/engine/value";
import { farMaxFor, maxBuildable, replacementCost } from "@/engine/dev";
import { dscr } from "@/engine/debt";
import "@/ui/cleanup-building.css";
import { demandNow } from "@/engine/demand";
import { walt, unitStatus } from "@/engine/leasing";
import { taxAppealQuote } from "@/engine/tax";
import { describePropertyEvent, propertyTimeline } from "@/engine/history";
import { usd, sf, pctSigned } from "@/ui/format";
import { syndicateView } from "@/engine/syndicate";
import { ParcelPanel } from "@/ui/panels/ParcelDesk";
import { AssetHistory, WorkoutDesk } from "@/ui/panels/PropertyDesks";
import { WhyButton } from "@/ui/WhyChain";
import { capWhy, valueLead } from "@/ui/whyLinks";
import { dominantUse } from "@/engine/mix";
import { useLabel, band, PropTab, Big, Row, occRead, occLabel, occTitle, ShortBy } from "@/ui/panels/shared";

/**
 * WHAT CAN ACTUALLY STAND ON THE LOT. Zoning's envelope is lot x FAR, but a
 * small lot runs out of height long before it runs out of FAR: a 3,189 sf
 * corner zoned to 29.5 read "94,076 sf · up to 12 floors" — a 7,800 sf plate on
 * a 3,200 sf lot. `maxBuildable` is the planner's own arithmetic at the widest
 * footprint the Build desk allows, so this line is a building you can draw.
 */
function buildableLine(rec: Parameters<typeof maxBuildable>[0]): string {
  const b = maxBuildable(rec);
  const env = rec.lotArea * farMaxFor(rec);
  return b.gsf < env * 0.98
    ? `${sf(b.gsf)} · ${b.floors} floors · lot-limited (envelope ${sf(env)})`
    : `${sf(b.gsf)} · up to ${b.floors} floors`;
}

export function PropertyPage() {
  const parcels = useStore((s) => s.parcels)!;
  const game = useStore((s) => s.game)!;
  const adjacency = useStore((s) => s.adjacency);
  // A folded lot reads as its site wherever the selection came from (back/forward, a stale link).
  const bbl = useStore((s) => (s.selectedBBL ? s.game?.merged?.[s.selectedBBL] ?? s.selectedBBL : s.selectedBBL));
  const [tab, setTab] = useState<PropTab>("summary");
  const fundingDue = !!bbl && !game.holdings[bbl] && !!game.talks?.[bbl]?.agreed;
  // The desk the map card asked for by name ("Open the Build desk"), read once.
  const askedTab = useStore((s) => s.propertyTab);
  // A different building is a different file. Opening one and landing on the
  // last building's mortgage tab is how you misread a balance. The exception
  // is a signed purchase contract: opening it from Deals should show the
  // financing choices immediately, not hide them behind an Overview tab.
  useEffect(() => {
    const holding = bbl ? game.holdings[bbl] : undefined;
    if (bbl && holding?.devDraft && !game.developments[bbl]) setTab("build");
    else setTab(fundingDue ? "deal" : "summary");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bbl, fundingDue]);
  // The asked-for desk wins over the default above (declared after it, so it
  // runs after it on the same mount), and is consumed once. Clearing it must
  // not re-run the default — that is why this is its own effect.
  useEffect(() => {
    if (!askedTab) return;
    setTab(askedTab);
    useStore.setState({ propertyTab: null });
  }, [askedTab]);
  if (!bbl) return <div className="hint">Nothing selected.</div>;
  const rec = resolveRec(parcels, game, bbl);
  if (!rec) return <div className="hint">Unknown parcel.</div>;
  const h = game.holdings[bbl];
  const cond = h?.condition ?? initialCondition(rec);
  // ONE APPRAISAL. The header read `assetValue` — the class model — for a
  // building you did not own, while the card below read the disclosed roll
  // and the lender's own appraisal agreed with the card; a listed retail
  // building showed $4.22-4.76M up here and $3.77-4.25M underneath, and the
  // lender came back at $3.92M. `marketAppraisal` is the disclosed roll when
  // there is one, the owned mark when it is yours, the leased fee when it is
  // ground-leased — the same number every desk and every lender prices.
  const value = marketAppraisal(game, rec, bbl, cond);
  // A ground-leased fee can resolve as a standing tower (the lessee's). That
  // is not a building YOU operate — Rent roll / Operations stay off, and the
  // headline NOI is the ground coupon, not a vacant shell.
  const leasedFee = !!h?.groundLeased;
  const built = rec.class !== "land" && rec.bldgArea > 0 && !leasedFee;
  // IN PLACE OR NOTHING. The unowned branch here quoted `noiYr` — which is the
  // class model AND is before property tax, so an unowned building's headline
  // NOI was overstated twice over against the owned one right beside it. One
  // accessor, both cases, and the tax comes off exactly once.
  const ipHdr = inPlace(rec, game, bbl, value);
  const occ = built ? ipHdr.occ : 0;
  const noi = leasedFee && h
    ? ownedHoldingNoiYr(game, parcels, h)
    : (built ? ipHdr.noi : 0);
  const dsYr = (h?.loan?.monthlyPmt ?? 0) * 12;
  const dev = game.developments[bbl];
  const taxAppeal = h ? taxAppealQuote(game, parcels, bbl) : null;
  const appealTab: PropTab = built ? "ops" : "summary";
  const timeline = propertyTimeline(game, bbl);
  // WHICH DESKS THIS BUILDING HAS. A tab that would open on an empty page is
  // worse than no tab: it teaches the player that the page lies about where
  // things are. Assembly is the awkward one — the Land desk hides itself when
  // there is no adjoining deed of yours, so the tab has to ask the same
  // question the desk does.
  const ownsNeighbour = (adjacency?.[bbl] ?? []).some((n) => game.holdings[n]);
  const TABS: { key: PropTab; label: string; show: boolean }[] = [
    { key: "summary", label: "Overview", show: true },
    { key: "leasing", label: "Rent roll", show: !!h && built },
    { key: "money", label: "Money", show: !!h && (built || leasedFee || !!h.loan) },
    { key: "ops", label: "Operations", show: !!h && built },
    { key: "deal", label: h ? "Sell" : "Acquire", show: true },
    { key: "build", label: built ? "Convert / Build" : "Build",
      show: !!h && (leasedFee || rec.class === "land" || !!dev || ownsNeighbour
        || (!h.groundLeased && rec.class !== "multifamily")) },
    { key: "history", label: "Deed history", show: timeline.length > 0 },
  ];
  const shown = TABS.filter((t) => t.show);
  // A tab can disappear under you — you sell the neighbouring lot and Build
  // goes with it. Fall back rather than render a page with nothing on it.
  const active = shown.some((t) => t.key === tab) ? tab : "summary";
  return (
    <div className="prop-page">
      {/* SIX TILES, THEN ONE LINE (UI clean-up, 2026-11). The header was twelve
          tiles and a facts column, 560px before any tab; the secondary reads are
          the same numbers, smaller, each with its tooltip. */}
      <div className="stat-strip">
        <Big label="Appraisal" value={band(bbl, value)}
          why={built ? <WhyButton id={capWhy(game, dominantUse(rec))} lead={valueLead(game, dominantUse(rec), value, noi)} /> : undefined} />
        <Big
          label={leasedFee ? "Ground rent / yr" : "NOI / yr"}
          value={(built || leasedFee) ? usd(noi) : "—"}
          bad={noi < 0}
        />
        {leasedFee ? (
          <Big label="Your role" value="leased fee" />
        ) : (
          // ONE BASIS, THE ONE EVERY OTHER SCREEN USES: lettable feet.
          (() => {
            const r = ipHdr.h ? occRead(rec, ipHdr.h) : null;
            const v = r ? r.lettableOcc : occ;
            return <Big label="Occupancy" value={!built ? "—" : r ? occLabel(r) : (v * 100).toFixed(0) + "%"} bad={built && v < 0.75} title={r ? occTitle(r) : undefined} />;
          })()
        )}
        {h && <Big label="Cash flow / yr" value={usd(noi - dsYr)} bad={noi - dsYr < 0} />}
        {h && (h.loan || h.mezz) && (
          <Big label="Debt" value={usd((h.loan?.balance ?? 0) + (h.mezz?.balance ?? 0))}
            title={`Debt service ${usd(dsYr)} / yr${h.mezz ? ` · mezz ${usd(h.mezz.balance)}` : ""}`} />
        )}
        {h && h.loan && (() => {
          const d = dscr(rec, game, h);
          return <Big label="DSCR" value={d === null ? "—" : `${d.toFixed(2)}×`} bad={d !== null && d < (h.loan.minDSCR ?? 1.2)}
            title={`NOI / debt service${h.loan.minDSCR ? ` · covenant ${h.loan.minDSCR.toFixed(2)}×` : ""}`} />;
        })()}
        {h && !h.loan && !h.mezz && (() => {
          const syn = syndicateView(game, parcels, bbl);
          if (syn) return <Big label="Sponsor equity" value={usd(syn.yours)} title={`Total ${usd(syn.equity)} · LPs ${usd(syn.theirs)}`} />;
          return <Big label={h.jv ? `Equity · yours ${Math.round((1 - h.jv.share) * 100)}%` : "Equity"} value={usd(value * (1 - (h.jv?.share ?? 0)))} />;
        })()}
        {!h && built && (() => {
          const rc = replacementCost(rec as never, game.econ);
          return rc ? <Big label="Value / replacement" title="Appraisal / replacement cost. Above 1× invites new supply." value={`${(value / rc).toFixed(2)}×`} bad={value / rc > 1.25} /> : null;
        })()}
      </div>
      <div className="prop-head">
        <div className="prop-facts">
          {(() => {
            const f: { k: string; v: string; title?: string; bad?: boolean }[] = [];
            if (built) f.push({ k: "", v: `${sf(rec.bldgArea)} · ${rec.floors} fl · ${rec.yearBuilt}` });
            f.push({ k: "Lot", v: sf(rec.lotArea) });
            f.push({ k: "FAR", v: `${(rec.bldgArea / Math.max(1, rec.lotArea)).toFixed(1)} / ${farMaxFor(rec).toFixed(1)}`, title: `Built / envelope · buildable at max: ${buildableLine(rec)}` });
            f.push({ k: "Demand", v: String(Math.round(demandNow(game, rec))) });
            if (built && h) {
              const u = unitStatus(rec, h, game.month);
              f.push({ k: "Spaces", v: `${u.leased} / ${u.total}`, bad: u.leased < u.total * 0.6 });
              if (h.tenants.length > 0) f.push({ k: "WALT", v: `${walt(h, game.month).toFixed(1)} y`, bad: walt(h, game.month) < 3 });
              const os = operatingStatement(rec, game.econ, h, game.month);
              f.push({ k: "Leakage", v: `${(os.leakage * 100).toFixed(0)}%`, title: "Opex and tax not recovered from tenants.", bad: os.leakage > 0.45 });
              const rq = rollQualitySpread(rec, h, game.month, game.econ);
              f.push({ k: "Roll", v: `${rq >= 0 ? "+" : ""}${(rq * 100).toFixed(0)} bps`, title: "Cap rate spread from term, credit and vacancy. Positive = price discount.", bad: rq > 0.15 });
              if (remainingAbatement(h, game.month) > 0) f.push({ k: "Free rent owed", v: usd(-remainingAbatement(h, game.month)), bad: true, title: "Concessions granted and not yet burned off; a buyer credits this off the price." });
              const rc = replacementCost(rec as never, game.econ);
              if (rc) f.push({ k: "V / RC", v: `${(value / rc).toFixed(2)}×`, title: "Appraisal / replacement cost. Above 1× invites new supply.", bad: value / rc > 1.25 });
            }
            if (h && (h.loan || h.mezz)) {
              const syn = syndicateView(game, parcels, bbl);
              if (syn) f.push({ k: "Sponsor equity", v: usd(syn.yours), title: `Total ${usd(syn.equity)} · LPs ${usd(syn.theirs)}` });
              else f.push({ k: h.jv ? `Equity ${Math.round((1 - h.jv.share) * 100)}%` : "Equity", v: usd((value - (h.loan?.balance ?? 0) - (h.mezz?.balance ?? 0)) * (1 - (h.jv?.share ?? 0))) });
            }
            if (h) {
              const r = returnsToDate(game, parcels).find((x) => x.bbl === bbl);
              if (r) f.push({ k: "Return", v: `${r.multiple.toFixed(2)}×${r.irr !== null ? ` · ${pctSigned(r.irr)}` : ""}`, title: "Pre-tax: (distributions + marked equity) / equity invested; IRR.", bad: r.multiple < 1 });
            }
            if (leasedFee && rec.bldgArea > 0 && game.groundLeases?.[bbl]) {
              f.push({ k: "Lessee", v: `${game.groundLeases[bbl].tenant} · ${game.groundLeases[bbl].floors ?? rec.floors} fl · ${sf(rec.bldgArea)}` });
            }
            return f.map((x, i) => (
              <span key={i} className="prop-fact" title={x.title}>
                {x.k && <span className="prop-fact-k">{x.k}</span>}
                <span className={"mono" + (x.bad ? " neg" : "")}>{x.v}</span>
              </span>
            ));
          })()}
        </div>
        <div className="btn-row">
          {!h && game.listings.some((l) => l.bbl === bbl) && (
            // under contract or mid-talks it is no longer an offer to make
            <button className="btn btn-buy" onClick={() => setTab("deal")}
              title="Ask, in-place NOI, offer, funding">
              {game.talks?.[bbl]?.agreed ? "Fund the closing ▸" : game.talks?.[bbl] ? "Negotiation ▸" : "Make an offer ▸"}
            </button>
          )}
          {!h && (
            <button className={"btn" + (game.watch?.includes(bbl) ? " btn-on" : "")}
              onClick={() => useStore.getState().toggleWatch(bbl)}
              title="Alert when listed; news filed under Your book.">
              {game.watch?.includes(bbl) ? "★ Watching" : "☆ Watch"}
            </button>
          )}
          {h && (
            <button className="btn btn-sell" onClick={() => setTab("deal")}
              title={h.sale ? "Listing and bids" : "List off-market or marketed"}>
              {h.sale ? "◆ Listed · view bids" : "Sell"}
            </button>
          )}
          <button className="btn" onClick={() => useStore.getState().focus(bbl, true)}
            title={`Show on map · parcel ${rec.bbl} · ${useLabel(rec)} · ${rec.zoneDist}`}>
            ⌖ Map
          </button>
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
      {/* THE TAX APPEAL IS AN OPPORTUNITY, NOT AN EMERGENCY. It sat above the
          tab bar with the default desk, so every tab of a freshly bought
          building opened on a five-row appeal quote. Taxes are an operating
          line; it lives on Operations (Overview for a lot with no building). */}
      {active === appealTab && (h?.taxAppeal ? (
        <div className="page-section">
          <div className="page-section-head">Assessment under appeal</div>
          <div className="grid">
            <Row k="Tax roll" v={usd(h.taxAppeal.assessedAtFile)} />
            <Row k="Filed value" v={usd(h.taxAppeal.target)} strong />
            <Row k="Decision" v={monthLabel(h.taxAppeal.decideM)} />
            <Row k="Odds as filed" v={`${(h.taxAppeal.odds * 100).toFixed(0)}%`} />
          </div>
        </div>
      ) : taxAppeal ? (
        <div className="page-section">
          <div className="page-section-head">Property-tax appeal</div>
          <div className="grid">
            <Row k="Tax assessment" v={usd(taxAppeal.assessed)} bad />
            <Row k="Market value" v={usd(taxAppeal.target)} strong />
            <Row k="Potential annual saving" v={usd(taxAppeal.annualSavings)} />
            <Row k="Appraisal + counsel" v={usd(taxAppeal.fee)} />
            <Row k="Decision" v={`${taxAppeal.months} mo · ${(taxAppeal.odds * 100).toFixed(0)}%`} />
          </div>
          <button className="btn" style={{ marginTop: 8 }} disabled={game.cash < taxAppeal.fee}
            title={game.cash < taxAppeal.fee ? `Fee ${usd(taxAppeal.fee)} · cash ${usd(game.cash)}` : undefined}
            onClick={() => useStore.getState().appealTax(bbl)}>
            Appeal the assessment · {usd(taxAppeal.fee)}
          </button>
          <ShortBy need={taxAppeal.fee} have={game.cash} cash />
          <div className="hint">
            Fee non-refundable. If denied: assessment unchanged, 3-yr wait to refile.
          </div>
        </div>
      ) : null)}
      {active === "history" && (
        <div className="page-section">
          <div className="page-section-head">Property history</div>
          <div className="mini-list">
            {timeline.map((event, i) => {
              const row = describePropertyEvent(event);
              return (
                <div className="mini-row" key={`${event.m}:${event.kind}:${i}`}>
                  <span>
                    <strong>{row.title}</strong>
                    <span className="dim"> · {row.detail}</span>
                  </span>
                  <span className="mono dim">{row.when}</span>
                </div>
              );
            })}
          </div>
          <div className="hint">
            Record stays with the property across owners.
          </div>
        </div>
      )}
      {active === "build" && dev && (
        <div className="page-section">
          <div className="page-section-head">{dev.mode === "reuse" ? "Conversion under way" : "Under construction"}</div>
          <div className="grid">
            <Row k="Program" v={`${sf(dev.sf)} of ${dev.use} · ${dev.floors} floors`} strong />
            {dev.bts && (
              <Row k="Build-to-suit"
                v={`${dev.bts.name} · ${sf(dev.bts.sf)} @ $${dev.bts.rentPsf.toFixed(2)}/sf · ${Math.round(dev.bts.termM / 12)} yrs`}
                strong />
            )}
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
              k="All-in cost to date"
              v={`${usd(dev.costTotal + (dev.landBasis ?? 0) + dev.interestReserve)} · $${((dev.costTotal + (dev.landBasis ?? 0) + dev.interestReserve) / Math.max(1, dev.sf)).toFixed(0)}/sf`}
              strong
              title="Land + hard/soft cost incl. change orders + interest reserve."
            />
            {/* Financed with the job, spent on tenants rather than steel, and
                paid across as cash the day the building opens. */}
            {(dev.leaseUpReserve ?? 0) > 0 && (
              <Row k="Lease-up reserve" v={`${usd(dev.leaseUpReserve!)} · released at delivery`} />
            )}
            <Row k="Delivers" v={monthLabel(dev.deliverM)} />
            {/* STILL TO FUND. The one number a developer mid-build checks every
                month, and it was nowhere on this screen. */}
            <Row
              k="Equity funded"
              v={`${usd(dev.equitySpent)} of ${usd(dev.equityBudget)}`}
            />
            <Row
              k="Equity remaining"
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
