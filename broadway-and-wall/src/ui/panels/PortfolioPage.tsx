import { FirmLink } from "@/ui/FirmLink";
import { useState, Fragment } from "react";
import { derive } from "@/ui/derive";
import type { ReactNode } from "react";
import Slider, { counterPriceBounds } from "@/ui/Slider";
import { returnsToDate } from "@/engine/standing";
import { useStore } from "@/state/store";
import { monthLabel, serviceSpec, planSpec, SVC_START } from "@/engine/types";
import { OpsChoices } from "@/ui/panels/OpsChoices";
import type { BuiltClass, GameState } from "@/engine/types";
import { deedMark, deedDebtService } from "@/ui/deedMarks";
import { managedRentPsfYr, resolveRec, isLeasedFee } from "@/engine/value";
import { portfolioPropertyMonthlyCF } from "@/engine/sim";
import { unitStatus, avgUnitSf, portfolioOccupancy } from "@/engine/leasing";
import { payoffQuote } from "@/engine/notes";
import { fundableNow } from "@/engine/credit";
import { payOffDue } from "@/engine/debt";
import { portfolioQuote, portfolioSettlement, onFundBook } from "@/engine/portfolio";
import { taxAppealQuote } from "@/engine/tax";
import type { PortfolioQuote, PortfolioSettlement } from "@/engine/portfolio";
import { FACILITY_MIN_ASSETS } from "@/engine/facility";
import { usd, sf, usdSigned, pctSigned } from "@/ui/format";
import { platHomesView } from "@/engine/homes";
import { ListSection, GroundLeaseSection, describeInstructions } from "@/ui/panels/AcquireDesk";
import { RefiSection } from "@/ui/panels/RefiDesk";
import { AssembleSection, canAssembleFromBook } from "@/ui/panels/PropertyDesks";
import { siteDeeds } from "@/engine/actions";
import { useLabel, devUseLabel, occRead, occLabel, occTitle, Big, Row } from "@/ui/panels/shared";
import { Concentration } from "@/ui/rollups/Concentration";
import { ExitsRecord } from "@/ui/rollups/ExitsRecord";

export function PortfolioPage() {
  const parcels = useStore((s) => s.parcels)!;
  const game = useStore((s) => s.game)!;
  const adjacency = useStore((s) => s.adjacency);
  const select = useStore((s) => s.select);
  const setPage = useStore((s) => s.setPage);
  // Child deeds of an assemblage keep a $0 holding for title — they are not
  // separate assets. Show the site once, under the parent.
  const holdings = Object.values(game.holdings).filter((h) => !game.merged?.[h.bbl]);
  const { delistSale, focus } = useStore.getState();
  // Opening the record and finding the building are the same action now: the
  // panel changes AND the camera moves, so the thing you are reading about is
  // behind the page you are reading. A book of addresses was not a place.
  const go = (bbl: string) => { select(bbl); focus(bbl); setPage("property"); };
  // Which row has its refinancing panel open. Repricing a loan is a portfolio
  // decision — you do it while looking at the maturity wall, not after opening
  // one building's record and scrolling past its rent roll.
  const [refiRow, setRefiRow] = useState<string | null>(null);
  const [opsRow, setOpsRow] = useState<string | null>(null);
  // The ask you are about to name, per row. See ListSection.
  const [listRow, setListRow] = useState<string | null>(null);
  // Vacant dirt: offer a ground lease from the row — same reach as List / Refi.
  const [glRow, setGlRow] = useState<string | null>(null);
  // Fold contiguous vacant lots from the book — same desk as Property → Build,
  // without leaving the portfolio when you notice two addresses that touch.
  const [assembleRow, setAssembleRow] = useState<string | null>(null);
  // Sort the book by value or by income. "By income" is the top-earners view:
  // the fifty best income producers, ranked — the question every owner asks
  // of a big book is "what is actually carrying this firm."
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "v", dir: -1 });
  // THE BUNDLE. Ticking buildings here is how you assemble a portfolio trade;
  // see engine/portfolio.ts for why the sum of the parts is not the price.
  const [bundling, setBundling] = useState(false);
  const [bundle, setBundle] = useState<string[]>([]);
  if (!holdings.length && !Object.keys(game.developments).length) {
    return (
      <div>
        <div className="deal">
          <div className="deal-head">No holdings</div>
          <button className="btn btn-buy" onClick={() => setPage("market")}>Marketplace →</button>
        </div>
        {/* An empty book is not an empty history — a firm that has sold out
            of everything still has its record, and this page is where the
            record lives. */}
        <ExitsRecord />
        <button type="button" className="linkish" onClick={() => setPage("firm")}>Annual record →</button>
      </div>
    );
  }
  // THE BOOK, ONCE PER STATE (ui/derive): every deed marked, its debt walked
  // and its occupancy read — kept across visits and re-sorts in the same month.
  const book = derive(game, "portfolio.rows", () => {
  let totV = 0, totD = 0;
  const rows = holdings.map((h) => {
    const rec = resolveRec(parcels, game, h.bbl);
    const fee = isLeasedFee(h);
    const mark = deedMark(game, parcels, h.bbl);
    const v = rec ? mark.v : 0;
    // Deed NOI — building roll or ground coupon. Same number the header CF
    // annualises (before firm-level construction / facility / revolver).
    const noi = mark.noi;
    // Facility replaces the deed mortgage — allocated share is the lien that
    // still sits on this row once the pool is papered.
    // Mortgage, mezz and this row's share of a pooled facility — the same
    // walk the map's hover card reads (deedDebtService).
    const { debt, dsMo } = deedDebtService(game, parcels, h.bbl);
    const cf = noi / 12 - dsMo;
    // Lessee's tower is not your occupancy — do not paint 0% on a coupon bond.
    //
    // THE SAME OCCUPANCY THE TOP BAR AND LEASING QUOTE. This row divided let
    // feet by ALL rentable feet (`physicalOcc`) while the top bar and every
    // Leasing row divide by LETTABLE feet — rentable less the remainder too
    // small to demise. A building Leasing called "fully let · 1,300 sf
    // unlettable" printed 94% here, and a book the header put at 96% listed
    // rows that never reached it. The owner noticed: "occupancy on the top
    // panel doesn't match the portfolio." One reader, `occupancyRead`, and
    // the same label and tooltip Leasing uses, so the remainder is explained
    // where it is subtracted rather than silently counted as vacancy.
    const or = fee || !rec || rec.class === "land" || !rec.bldgArea ? null : occRead(rec, h);
    const occ = or ? or.lettableOcc : 0;
    totV += v; totD += debt;
    // EVERY COLUMN NEEDS A VALUE TO SORT ON, so the ones that used to be
    // computed inside the cell are computed here instead. That is also why
    // several of them were impossible to sort by: they did not exist until the
    // row was already being drawn.
    const leasedSf = fee ? 0 : h.tenants.reduce((a, t) => a + t.sf, 0);
    const rollYr = fee ? 0 : h.tenants.reduce((a, t) => a + t.rentPsf * t.sf, 0);
    // CONTRACT RENT, OR NOTHING. Vacant commercial used to fall through to
    // `managedRentPsfYr` — the asking number — so a dark office printed
    // $25.45/sf in the rent column with 0/1 spaces and 0% occupancy. That
    // column is "average contract rent across the rent roll". No tenant,
    // no contract, no rent. Occupied flats have no named roll and still
    // collect, so they keep the achieved figure.
    const rentPsf = fee || !rec || rec.class === "land" || (leasedSf <= 0 && occ <= 0)
      ? 0
      : (leasedSf > 0 ? rollYr / leasedSf : managedRentPsfYr(rec, game.econ, h));
    const u = !fee && rec && rec.bldgArea ? unitStatus(rec, h, game.month) : null;
    return {
      h, rec, v, noi, cf, occ, or,
      addr: rec?.address ?? h.bbl,
      cls: fee ? "leased fee" : (rec ? useLabel(rec) : ""),
      area: fee ? 0 : (rec?.bldgArea ?? 0),
      spaces: u ? u.leased : -1,
      rentPsf,
      cost: h.costBasis,
      // WHAT YOU PAID, PER FOOT. Every other price in this business is quoted
      // per square foot — rent, NOI, value, replacement cost — and the one
      // number the book kept in whole dollars was the one you compare all of
      // them against. Land has no building to divide by, and a lot bought for
      // its dirt does not have a basis per foot of anything; it sorts last.
      basisPsf: rec && rec.bldgArea > 0 ? h.costBasis / rec.bldgArea : 0,
      // THE NEIGHBOURHOOD, AS THE MARKET READS IT. The live demand score
      // (0-100) the map, the lot card and every rent and land price read —
      // the generator's score plus whatever the blocks around it have become.
      // Land especially: a lot's whole case is where it is.
      demand: rec ? rec.demandScore : -1,
      demand0: parcels[h.bbl]?.demandScore ?? (rec ? rec.demandScore : -1),
      gain: v - h.costBasis,
      debt,
      equity: v - debt,
      ds: dsMo,
    };
  });
  return { rows, totV, totD };
  }, [parcels]);
  const { totV, totD } = book;
  // sorted below, in place: a copy, so the cached order is never disturbed
  const rows = [...book.rows];
  type PRow = (typeof rows)[number];
  // THE BOOK SORTS BY ITS OWN COLUMNS. It had two buttons — by value, by income
  // — and a top-50 slice on one of them. Anything else you wanted to rank the
  // book by (worst occupancy, biggest gain, heaviest debt service) meant reading
  // sixteen columns by eye.
  const dir = sort.dir;
  const cmp = (a: PRow, b: PRow) => {
    const k = sort.key as keyof PRow;
    const av = a[k], bv = b[k];
    if (typeof av === "string" || typeof bv === "string") {
      return String(av).localeCompare(String(bv)) * dir;
    }
    return ((av as number) - (bv as number)) * dir;
  };
  rows.sort(cmp);
  // A SUBDIVISION IS ONE LINE (owner: platted lots were a holding each): every lot of a
  // plat folds into one neighbourhood row — its lots, how many are still yours, and the
  // sums — and the lot rows themselves leave the book. A click opens the first lot,
  // whose card is the plat's Lots desk.
  const hoods = new Map<string, PRow[]>();
  for (const r of rows) if (r.rec?.homeLot && r.rec.block) hoods.set(r.rec.block, [...(hoods.get(r.rec.block) ?? []), r]);
  const shown = rows.filter((r) => !(r.rec?.homeLot && r.rec.block));
  const totCF = portfolioPropertyMonthlyCF(game, parcels);
  const ranked = sort.key === "noi" && sort.dir === -1;
  // Property … buttons. Extra lead cells when ranking or bundling.
  const bookCols = 10 + (ranked ? 1 : 0) + (bundling ? 1 : 0);
  const schemes = holdings.filter((h) => h.devDraft && !game.developments[h.bbl]);
  const assessmentWatch = holdings.flatMap((h) => {
    const q = taxAppealQuote(game, parcels, h.bbl);
    const rec = resolveRec(parcels, game, h.bbl);
    return q && rec ? [{ bbl: h.bbl, address: rec.address, ...q }] : [];
  }).sort((a, b) => b.annualSavings - a.annualSavings);
  // One header cell, the same idiom the Marketplace tape uses. `desc` is the
  // direction a column WANTS on first click: money and area read biggest-first,
  // an address reads A-Z.
  const H = ({ k, label, num, desc = true, title }: { k: string; label: string; num?: boolean; desc?: boolean; title?: string }) => {
    const on = sort.key === k;
    return (
      <th className={(num ? "num" : "") + " th-sort" + (on ? " th-sort-on" : "")}
        title={title ?? `Sort by ${label}`}
        onClick={() => setSort(on ? { key: k, dir: sort.dir === 1 ? -1 : 1 } : { key: k, dir: desc ? -1 : 1 })}>
        {label}{on ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
      </th>
    );
  };

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

  const showAllOnMap = () => {
    useStore.getState().showBookOnMap();
  };

  return (
    <div>
      <div className="btn-row" style={{ marginBottom: 10 }}>
        <button type="button" className="btn" onClick={showAllOnMap}
          title="Show holdings on the map">
          Show on map →
        </button>
      </div>
      <div className="stat-strip">
        {/* FIRST, NOT LAST. This sat rightmost, after "Buildings", in the same
            20px mono as every other stat — the only number in the game that can
            end the run, weighted identically to a count of how many things you
            own. */}
        {Object.keys(game.workouts ?? {}).length > 0 && (
          <Big label="In default" value={String(Object.keys(game.workouts ?? {}).length)} bad />
        )}
        {/* SIX TILES, NOT TEN. Assets and debt are the two halves of equity
            and ride in its tooltip (debt has a desk of its own); the building
            count and the basis ride with the square feet. */}
        <Big label="Equity" value={usd(totV - totD)} bad={totV - totD < 0}
          title={`${usd(totV)} value − ${usd(totD)} debt`} />
        {/* NOT THE TOP BAR'S NUMBER, SO NOT THE TOP BAR'S NAME. The header's
            CF / yr is the FIRM — after overhead, construction interest, the
            facility and the revolver. This is the buildings alone. Two
            different quantities wearing one label read as one number that
            disagrees with itself. */}
        <Big
          label="Property CF / mo"
          value={usd(totCF)}
          bad={totCF < 0}
          title="NOI incl. ground rent, less mortgages. Excludes overhead, construction interest, facility, revolver."
        />
        {/* HOW BIG YOU ACTUALLY ARE, AND WHAT IT COST YOU A FOOT.
            Dollars of assets is a number about the market as much as about the
            book — the same buildings are worth half as much at the bottom of a
            cycle — and square feet is not. It is the one measure of a portfolio
            that does not move when the cap rate does, which is why every
            operator in this business quotes it first. The basis beside it is
            what you paid across all of it, per foot: the number to hold against
            the rent you collect, what a building is worth today, and what it
            would cost to put one up. Land is excluded from both, because a lot
            has no square footage of building to average. */}
        {(() => {
          const built = rows.filter((r) => r.rec && r.rec.class !== "land" && (r.rec.bldgArea ?? 0) > 0);
          const area = built.reduce((a, r) => a + (r.rec!.bldgArea ?? 0), 0);
          const basis = built.reduce((a, r) => a + r.h.costBasis, 0);
          const val = built.reduce((a, r) => a + r.v, 0);
          return (
            <>
              <Big label={`${holdings.length} building${holdings.length === 1 ? "" : "s"}`} value={area > 0 ? sf(area) : "—"}
                title={`${built.length} building${built.length === 1 ? "" : "s"}${rows.length > built.length ? ` and ${rows.length - built.length} lot${rows.length - built.length === 1 ? "" : "s"}` : ""}${area > 0 ? ` · basis $${(basis / area).toFixed(0)}/sf incl. closing · value $${(val / area).toFixed(0)}/sf` : ""}`} />
            </>
          );
        })()}
        {(() => {
          const cost = rows.reduce((a, r) => a + r.h.costBasis, 0);
          const g = totV - cost;
          return <Big label="Unrealised gain" value={`${usdSigned(g)} · ${cost > 0 ? pctSigned(g / cost, 0) : "0%"}`} bad={g < 0} />;
        })()}
        {/* THE BOOK'S OCCUPANCY, HERE TOO — the same function the top bar and
            Leasing read, so the number at the top of the screen can be
            checked against the rows it is summing without changing pages. */}
        {(() => {
          const po = portfolioOccupancy(game, parcels);
          return (
            <Big label="Occupancy" value={po ? (100 * po.occ).toFixed(1) + "%" : "—"}
              bad={!!po && po.occ < 0.8}
              title={po
                ? `${sf(po.leasedSf)} let of ${sf(po.lettableSf)} lettable`
                : "No operated buildings"} />
          );
        })()}

      </div>
      {Object.values(game.workouts ?? {}).length > 0 && (
        <div className="alarm" style={{ marginTop: 10 }}>
          {Object.values(game.workouts!).map((w) => {
            const r = resolveRec(parcels, game, w.bbl);
            const loan = game.holdings[w.bbl]?.loan;
            const couponOk = !!loan && fundableNow(game, parcels) >= loan.monthlyPmt;
            return (
              <div key={w.bbl} className="neg" style={{ cursor: "pointer" }} onClick={() => go(w.bbl)}>
                {(() => {
                  const q = payoffQuote(game, parcels, w.bbl);
                  if (!q?.open) return null;
                  return (
                    <div style={{ marginBottom: 4 }}>
                      <button className="btn-mini" disabled={fundableNow(game, parcels) < q.px}
                        title={q.why}
                        onClick={(e) => { e.stopPropagation(); useStore.getState().payOffAtDiscount(w.bbl); }}>
                        Pay off {usd(q.px)} of {usd(q.bal)}
                      </button>
                    </div>
                  );
                })()}
                ⚠ {r?.address ?? w.bbl} · {w.lender} · {w.stage === "foreclosure"
                  ? `filed · auction ${monthLabel(w.decideM)}`
                  : w.stage === "forbearance"
                    ? `forbearance to ${monthLabel(w.decideM)}`
                    : couponOk
                      ? `default · coupon current, no filing`
                      : `default · can file ${monthLabel(w.decideM)}`} · cure {usd(w.cure)}
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
                v={`${exposure.topTenant.name} · ${(exposure.topTenant.share * 100).toFixed(0)}% of rent`}
                bad={exposure.topTenant.share > 0.2}
              />
            )}
            {exposure.topSector && (
              <Row
                k="Largest sector"
                v={`${exposure.topSector.name} · ${(exposure.topSector.share * 100).toFixed(0)}% of rent`}
                bad={exposure.topSector.share > 0.4}
              />
            )}
            <Row
              k="Rolling within 2 yrs"
              v={`${(exposure.rollShare * 100).toFixed(0)}% of rent`}
              bad={exposure.rollShare > 0.3}
            />
            <Row
              k="Floating-rate debt"
              v={`${(exposure.floatShare * 100).toFixed(0)}% of debt`}
              bad={exposure.floatShare > 0.5}
            />
            <Row k="Weighted avg maturity" v={`${exposure.wam.toFixed(1)} yrs`} bad={exposure.wam < 3} />
            <Row
              k="Maturing within 3 yrs"
              v={`${usd(exposure.matWall)} · ${(exposure.wallShare * 100).toFixed(0)}% of debt`}
              bad={exposure.wallShare > 0.4}
            />
          </div>
        </>
      )}
      {/* The century view: the exposure grid above gives one line each to the
          wall, the roll and the top exposures; these are the same quantities
          with their shape put back — which YEAR the debt lands, which year
          the leases roll, and where the eggs actually sit. */}
      {/* The year-by-year shape of the two rows above lives on the desk that
          acts on it: the maturity wall on Capital → Debt, the lease rollover on
          Leasing. Returns and concentration sit under the book they describe. */}
      {exposure.roll > 0 && (
        <div className="hint">
          By year:{" "}
          <button type="button" className="linkish" onClick={() => setPage("leasing")}>lease rollover →</button>
          {" · "}
          <button type="button" className="linkish" onClick={() => setPage("debt", "The maturity wall")}>maturities →</button>
        </div>
      )}
      <div className="btn-row" style={{ marginTop: 10 }}>
        {/* Shortcuts, not modes. Every column sorts from its own header now;
            these two are here because they are the two questions asked most. */}
        <button className={"btn" + (sort.key === "v" ? " btn-on" : "")}
          onClick={() => setSort({ key: "v", dir: -1 })}>By value</button>
        <button className={"btn" + (ranked ? " btn-on" : "")}
          onClick={() => setSort({ key: "noi", dir: -1 })}
          title="Sort by NOI, high to low">Top earners</button>
        {/* A DISABLED BUTTON WITH A REASON, NOT A BUTTON THAT VANISHED.
            One process at a time is the right constraint — a seller cannot run
            two — but this used to disappear outright the month an institution
            rang unprompted, so the bundling tool went missing for up to four
            months with nothing on screen to say why or how to get it back. */}
        {holdings.length >= 2 && (() => {
          const busy = game.portfolioSale;
          const who = busy?.bids?.[0]?.name;
          return (
            <button className={"btn" + (bundling ? " btn-on" : "")}
              disabled={!!busy}
              onClick={() => { setBundling(!bundling); if (bundling) setBundle([]); }}
              title={busy
                ? (busy.unsolicited
                  ? `${who ?? "A buyer"} bid on ${busy.bbls.length} buildings · answer it above first`
                  : `${busy.bbls.length} buildings already listed as one trade · close or pull it above first`)
                : "Tick 2+ buildings to sell as one trade"}>
              {bundling ? `Bundling · ${bundle.length} picked` : "Sell several at once"}
            </button>
          );
        })()}
        {bundling && bundle.length > 0 && (
          <button className="btn" onClick={() => setBundle([])}>Clear picks</button>
        )}
        {bundling && (
          /* PICK EVERYTHING MEANS EVERYTHING. It used to skip any deed already
             listed on its own — which `listPortfolio` de-lists for you anyway —
             so the one button for "sell the whole book" quietly left buildings
             behind. The only deeds it cannot take are the ones under a crane,
             which no sale of any kind will convey.
             AND "EVERYTHING" IS ONE BOOK. The fund's deeds are the LPs' and
             cannot share a price with the sponsor's (listPortfolio refuses a
             mix), so this picks your own balance sheet, and the fund's book
             has its own button. */
          <button className="btn"
            onClick={() => setBundle(rows.filter((r) => !game.developments[r.h.bbl] && !onFundBook(game, r.h.bbl)).map((r) => r.h.bbl))}>
            Pick all (own book)
          </button>
        )}
        {bundling && rows.some((r) => onFundBook(game, r.h.bbl)) && (
          <button className="btn"
            onClick={() => setBundle(rows.filter((r) => !game.developments[r.h.bbl] && onFundBook(game, r.h.bbl)).map((r) => r.h.bbl))}
            title="Fund buildings · proceeds to the fund">
            Pick all (fund book)
          </button>
        )}
      </div>
      {/* The desk sits UNDER the controls that feed it. Mounted above them, a
          player ticking their way down a thirty-building book pushed the panel
          holding "Take it to market" off the top of the screen. */}
      <PortfolioSaleDesk bundle={bundle} clear={() => { setBundle([]); setBundling(false); }} />
      {schemes.length > 0 && (
        <div className="deal" style={{ marginTop: 8, marginBottom: 8 }}>
          <div className="deal-head">Scheme in progress · {schemes.length}</div>
          <div className="mini-list">
            {schemes.map((h) => {
              const rec = resolveRec(parcels, game, h.bbl);
              const d = h.devDraft!;
              return (
                <button key={h.bbl} className="neighbor" onClick={() => go(h.bbl)}>
                  <span className="neighbor-addr">{rec?.address ?? h.bbl}</span>
                  <span className="neighbor-meta mono">
                    {d.floors} fl {d.use} · {d.tab} · resume →
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <table className="tbl tbl-book">
        <thead>
          <tr>
            {bundling && <th></th>}
            {ranked && <th className="num">#</th>}
            <H k="addr" label="Property" desc={false} />
            <H k="area" label="sf" num />
            <H k="demand" label="Demand" num title="Location demand, 0-100 · small figure: change since start" />
            <H k="occ" label="Occ" num />
            <H k="rentPsf" label="Rent" num title="Avg contract rent, $/sf/yr" />
            <H k="noi" label="NOI / yr" num />
            <H k="v" label="Value" num title="Appraisal · gain vs cost below" />
            <H k="debt" label="Debt" num title="Liens incl. mezz and facility share · equity and debt service below" />
            <H k="cf" label="CF / mo" num />
            <th></th>
          </tr>
        </thead>
        <tbody>
          {[...hoods].map(([block, lots]) => {
            const sum = (f: (r: PRow) => number) => lots.reduce((a, r) => a + f(r), 0);
            const v = platHomesView(game, parcels, block);
            const name = parcels[block]?.address ?? "Subdivision";
            return (
              <tr key={"hood:" + block} onClick={() => go(lots[0].h.bbl)} className="book-hood">
                {bundling && <td></td>}
                {ranked && <td></td>}
                <td>
                  <div className="book-addr">{name} · neighbourhood</div>
                  <div className="dim mono" style={{ fontSize: 11 }}>
                    {lots.length} lots yours{v ? ` of ${v.lots} · ${v.lots - v.left} sold · ${v.pace.toFixed(1)}/mo` : ""}
                  </div>
                </td>
                <td className="num mono">{sf(sum((r) => r.rec?.lotArea ?? 0))}</td>
                <td className="num mono">{Math.round(sum((r) => r.demand ?? 0) / lots.length)}</td>
                <td className="num mono">—</td>
                <td className="num mono">—</td>
                <td className="num mono">{usd(sum((r) => r.noi))}</td>
                <td className="num mono">{usd(sum((r) => r.v))}</td>
                <td className="num mono">{usd(sum((r) => r.debt))}</td>
                <td className="num mono">{usd(sum((r) => r.cf))}</td>
                <td></td>
              </tr>
            );
          })}
          {shown.map(({ h, rec, v, noi, cf, occ, or, debt, ds, demand, demand0 }, i) => {
            const wk = game.workouts?.[h.bbl];
            // a crane on your own dirt is a status, not a secret
            const dv = game.developments[h.bbl];
            // Vacant fee only — leased fees and improved sites are not this desk.
            const canGround = !!rec
              && rec.class === "land"
              && (rec.bldgArea ?? 0) === 0
              && !(game.built?.[h.bbl]?.bldgArea)
              && !h.groundLeased
              && !game.groundLeases?.[h.bbl]
              && !dv;
            return (
            <Fragment key={h.bbl}>
            <tr onClick={() => go(h.bbl)}>
              {bundling && (
                /* A deed under a crane cannot be conveyed by any route — the
                   job is still drawing its loan and still due to deliver. A
                   deed on its own listing can: the bundle pulls it off the
                   market on the way past, which is what the engine does. */
                (() => {
                  // One book per bundle: a fund deed cannot join a bundle of
                  // the sponsor's, nor the other way round.
                  const fundDeed = onFundBook(game, h.bbl);
                  const otherBook = !bundle.includes(h.bbl) && bundle.length > 0
                    && onFundBook(game, bundle[0]) !== fundDeed;
                  const blocked = !!dv || otherBook;
                  return (
                    <td onClick={(ev) => {
                      ev.stopPropagation();
                      if (blocked) return;
                      setBundle(bundle.includes(h.bbl) ? bundle.filter((x) => x !== h.bbl) : [...bundle, h.bbl]);
                    }} style={{ cursor: blocked ? "default" : "pointer", userSelect: "none" }}
                      title={dv
                        ? "Under construction · cannot be sold"
                        : otherBook
                          ? (fundDeed
                            ? "Fund building · cannot bundle with your own"
                            : "Own building · cannot bundle with the fund's")
                          : h.sale
                            ? "Listed alone · ticking delists it"
                            : fundDeed ? "Add to bundle (fund · proceeds to the fund)" : "Add to bundle"}>
                      {dv || otherBook ? "·" : bundle.includes(h.bbl) ? "☑" : "☐"}{fundDeed ? " F" : ""}
                    </td>
                  );
                })()
              )}
              {ranked && <td className="num dim">{i + 1}</td>}
              <td className="book-prop">
                <div>{rec?.address ?? h.bbl}</div>
                <div className="dim" style={{ fontSize: 11 }}>
                  {rec ? useLabel(rec) : ""}
                  {h.groundLeased || !rec || !rec.bldgArea ? "" : (() => {
                    const u = unitStatus(rec, h, game.month);
                    return ` · ${u.leased}/${u.total} spaces`;
                  })()}
                  {h.devDraft && !dv ? " · scheme" : ""}
                </div>
                {(() => {
                  const bits = [
                    wk ? (wk.stage === "foreclosure" ? "foreclosure"
                      : wk.stage === "forbearance" ? "extended"
                      : (h.loan && fundableNow(game, parcels) >= h.loan.monthlyPmt) ? "default · current"
                      : "default") : null,
                    dv ? "building" : null,
                    h.loan?.sweep ? "sweep" : null,
                    h.sale ? (describeInstructions(h.sale.instructions) ? `listed · ${describeInstructions(h.sale.instructions)}` : "listed") : null,
                    h.renovatingUntilM !== undefined && game.month < h.renovatingUntilM ? "reno" : null,
                    h.program ? "capex" : null,
                    siteDeeds(game, h.bbl).length > 1 ? "assembled" : null,
                    game.btsProspects?.[h.bbl] ? "bts terms" : h.btsOffer ? "bts listed" : null,
                    game.groundLeases?.[h.bbl] ? "ground-leased" : h.groundOffer ? "gl offered" : null,
                  ].filter(Boolean);
                  if (!bits.length && !wk && !dv) return null;
                  return (
                    <div className={wk ? "neg" : "dim"} style={{ fontSize: 11 }}>
                      {bits.join(" · ")}
                      {wk && <span className="mono"> · {wk.stage === "foreclosure"
                        ? `auction ${monthLabel(wk.decideM)}`
                        : (h.loan && fundableNow(game, parcels) >= h.loan.monthlyPmt)
                          ? "coupon current"
                          : `file ${monthLabel(wk.decideM)}`}</span>}
                      {dv && <span className="mono"> · {(dv.sf / 1000).toFixed(0)}k sf {monthLabel(dv.deliverM)}</span>}
                    </div>
                  );
                })()}
              </td>
              <td className="num" title={h.groundLeased
                ? "Lessee improvement · not your sf"
                : rec && rec.bldgArea ? `${usd(v / rec.bldgArea)}/sf of value · ${usd(noi / rec.bldgArea)}/sf of NOI` : "vacant land"}>
                {h.groundLeased || !rec || !rec.bldgArea ? "—" : sf(rec.bldgArea)}
                {!h.groundLeased && rec && avgUnitSf(rec) > 0 && (
                  <div className="dim" style={{ fontSize: 11 }}>{sf(avgUnitSf(rec))}/flat</div>
                )}
              </td>
              <td className="num" title={demand >= 0 ? `Demand ${demand.toFixed(0)} of 100 · ${demand0 >= 0 ? `${demand >= demand0 ? "+" : ""}${(demand - demand0).toFixed(0)} since start` : ""}` : undefined}>
                {demand >= 0 ? demand.toFixed(0) : "—"}
                {demand >= 0 && demand0 >= 0 && Math.round(demand - demand0) !== 0 && (
                  <div className={"dim" + (demand < demand0 ? " neg" : "")} style={{ fontSize: 11 }}>
                    {demand > demand0 ? "+" : "\u2212"}{Math.abs(Math.round(demand - demand0))}
                  </div>
                )}
              </td>
              <td
                className="num book-occ"
                title={dv
                  ? ((dv.signed?.length ?? 0)
                    ? `${dv.signed!.length} construction pre-let${dv.signed!.length === 1 ? "" : "s"} · ${dv.signed!.reduce((a, x) => a + x.sf, 0).toLocaleString()} sf · on the roll at delivery`
                    : "Under construction · no rent roll")
                  : h.groundLeased ? "Ground lease · lessee lets the building"
                    : or ? occTitle(or) : undefined}
              >
                {dv
                  ? ((dv.signed?.length ?? 0) ? `${((dv.signed!.reduce((a, x) => a + x.sf, 0) / Math.max(1, dv.sf)) * 100).toFixed(0)}% pre` : "—")
                  : h.groundLeased || rec?.class === "land" || !or ? "—" : occLabel(or)}
              </td>
              {/* WHAT THE ROLL ACTUALLY COLLECTS, per foot. The rent every
                  decision in the game is denominated in, and the book quoted
                  NOI and value per foot but never the rent underneath them. */}
              {(() => {
                if (h.groundLeased || !rec || rec.class === "land") return <td className="num">—</td>;
                const leased = h.tenants.reduce((a, t) => a + t.sf, 0);
                const roll = h.tenants.reduce((a, t) => a + t.rentPsf * t.sf, 0);
                if (leased > 0) {
                  // THE BENCHMARK HAS TO BE WEIGHTED THE WAY THE ROLL IS.
                  //
                  // The rent on the left is the average across the tenants who
                  // are actually in the building. The market it was compared
                  // against was the area-weighted blend of the building's
                  // markets — weighted by FLOOR AREA, not by who is in it. On
                  // anything mixed those are different numbers about different
                  // buildings: a tower whose shops are full and whose offices
                  // are half empty has a retail-heavy roll being marked
                  // against an office-heavy market, and it prints as a rent
                  // roll 30-40% under market when every lease in it was signed
                  // at the going rate for the space it is in. Same tenants,
                  // same weights, one quantity, one answer.
                  const mkt = h.tenants.reduce(
                    (a, t) => a + t.sf * managedRentPsfYr(rec, game.econ, h, t.use ?? (rec.class as BuiltClass)), 0) / leased;
                  return (
                    <td className="num" title={`Market ~$${mkt.toFixed(2)}/sf for this space`}>
                      ${(roll / leased).toFixed(2)}
                      <span className={"dim" + ((roll / leased) < mkt * 0.92 ? " neg" : "")}>
                        {" "}({(roll / leased) >= mkt ? "+" : ""}{(((roll / leased) / Math.max(1, mkt) - 1) * 100).toFixed(0)}%)
                      </span>
                    </td>
                  );
                }
                // Occupied flats have no named roll: quote what they collect.
                // A vacant building has no contract rent — do not print the ask.
                if (occ > 0) {
                  return <td className="num dim">${managedRentPsfYr(rec, game.econ, h).toFixed(2)}</td>;
                }
                return <td className="num dim">—</td>;
              })()}
              <td className={"num" + (noi < 0 ? " neg" : "")}>{usd(noi)}</td>
              {(() => {
                const g = v - h.costBasis;
                const pctG = h.costBasis > 0 ? (g / h.costBasis) * 100 : 0;
                return (
                  <td className="num" title={`Cost ${usd(h.costBasis)}${!h.groundLeased && rec && rec.bldgArea > 0 ? ` · $${(h.costBasis / rec.bldgArea).toFixed(0)}/sf` : ""} · ${(g / Math.max(1, (game.month - h.boughtM) / 12) / Math.max(1, h.costBasis) * 100).toFixed(1)}%/yr over ${((game.month - h.boughtM) / 12).toFixed(1)} yrs`}>
                    {usd(v)}
                    <div className={"dim" + (g < 0 ? " neg" : "")} style={{ fontSize: 11 }}>
                      {g > 0 ? "+" : ""}{usd(g)} · {pctG >= 0.5 ? "+" : pctG <= -0.5 ? "\u2212" : ""}{Math.abs(pctG).toFixed(0)}%
                    </div>
                  </td>
                );
              })()}
              <td className="num" title={debt > 0 ? `Equity ${usd(v - debt)}` : "Unencumbered"}>
                {debt > 0 ? usd(debt) : "—"}
                {debt > 0 && (
                  <div className="dim" style={{ fontSize: 11 }}>
                    eq {usd(v - debt)} · ds {usd(ds)}/mo
                  </div>
                )}
              </td>
              <td className={"num nowrap" + (cf < 0 ? " neg" : "")}>{usd(cf)}</td>
              <td>
                {/* list / refi / ground-lease from the row — no need to open the record */}
                <div className="btn-row" style={{ gap: 4, margin: 0 }}>
                  {h.sale ? (
                    <button className="btn btn-sm" onClick={(ev) => { ev.stopPropagation(); delistSale(h.bbl); }}
                      title={`Listed at ${usd(h.sale.ask)} · delist`}>
                      Delist
                    </button>
                  ) : (
                    <button className={"btn btn-sm" + (listRow === h.bbl ? " btn-on" : "")}
                      onClick={(ev) => { ev.stopPropagation(); setListRow(listRow === h.bbl ? null : h.bbl); }}
                      title="Set an ask and list">
                      List
                    </button>
                  )}
                  {/* how the building is run: the six choices from the property card */}
                  {!h.groundLeased && (rec?.bldgArea ?? 0) > 0 && (
                    <button
                      className={"btn btn-sm" + (opsRow === h.bbl ? " btn-on" : "")}
                      onClick={(ev) => { ev.stopPropagation(); setOpsRow(opsRow === h.bbl ? null : h.bbl); }}
                      title={`Service ${serviceSpec(h.service).label} (${Math.round(100 * (h.svcIdx ?? SVC_START))}/100) · capital plan ${planSpec(h.plan).label} (condition ${Math.round(100 * (h.condIdx ?? 0.6))}/100)`}
                    >
                      {/* It read "Market · Fund" — two settings, no verb. */}
                      Run {opsRow === h.bbl ? "▴" : "▾"}
                    </button>
                  )}
                  <button
                    className={"btn btn-sm" + (refiRow === h.bbl ? " btn-on" : "")}
                    onClick={(ev) => { ev.stopPropagation(); setRefiRow(refiRow === h.bbl ? null : h.bbl); }}
                    title={h.loan
                      ? `${usd(h.loan.balance)} at ${h.loan.ratePct.toFixed(2)}%, matures ${monthLabel(h.loan.maturityM)} · refi quotes`
                      : "Unlevered · loan quotes"}
                  >
                    Refi
                  </button>
                  {h.loan && !game.facility?.bbls?.includes(h.bbl) && (() => {
                    const due = payOffDue(h.loan, game.month, game.econ);
                    const canPay = fundableNow(game, parcels) >= due.due;
                    return (
                      <button
                        className={"btn btn-sm" + (due.balance < 25_000 ? " btn-buy" : "")}
                        disabled={!canPay}
                        onClick={(ev) => { ev.stopPropagation(); useStore.getState().payOffLoan(h.bbl); }}
                        title={canPay
                          ? `Retire the note for ${usd(due.due)}${due.penalty > 0 ? ` (incl. ${usd(due.penalty)} break)` : ""} · clears the lien`
                          : `Need ${usd(due.due)} to pay this off`}
                      >
                        Pay off
                      </button>
                    );
                  })()}
                  {canGround && (
                    <button
                      className={"btn btn-sm" + (glRow === h.bbl || h.groundOffer ? " btn-on" : "")}
                      onClick={(ev) => { ev.stopPropagation(); setGlRow(glRow === h.bbl ? null : h.bbl); }}
                      title={h.groundOffer
                        ? `Ground lease offered (${h.groundOffer.years} yr) · review or pull`
                        : h.loan || game.facility?.bbls?.includes(h.bbl) || h.sale
                          ? "Pay off the lien first"
                          : "Offer the land on an absolute-net ground lease"}
                    >
                      {h.groundOffer ? "GL" : "Ground"}
                    </button>
                  )}
                  {canAssembleFromBook(game, adjacency, h.bbl) && (
                    <button
                      className={"btn btn-sm" + (assembleRow === h.bbl ? " btn-on" : "")}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setAssembleRow(assembleRow === h.bbl ? null : h.bbl);
                      }}
                      title="Merge with adjacent vacant lots you own"
                    >
                      Assemble
                    </button>
                  )}
                </div>
              </td>
            </tr>
            {opsRow === h.bbl && (
              <tr>
                <td colSpan={bookCols} style={{ background: "rgba(43,37,26,0.035)" }}>
                  <OpsChoices bbl={h.bbl} h={h} />
                </td>
              </tr>
            )}
            {refiRow === h.bbl && (
              <tr>
                <td colSpan={bookCols} style={{ background: "rgba(43,37,26,0.035)" }}>
                  <RefiSection bbl={h.bbl} />
                </td>
              </tr>
            )}
            {listRow === h.bbl && (
              <tr>
                <td colSpan={bookCols} style={{ background: "rgba(43,37,26,0.035)" }}>
                  <ListSection bbl={h.bbl} appraisal={v} onDone={() => setListRow(null)} />
                </td>
              </tr>
            )}
            {glRow === h.bbl && canGround && (
              <tr>
                <td colSpan={bookCols} style={{ background: "rgba(43,37,26,0.035)" }}>
                  <GroundLeaseSection bbl={h.bbl} onDone={() => setGlRow(null)} />
                </td>
              </tr>
            )}
            {assembleRow === h.bbl && (
              <tr>
                <td colSpan={bookCols} style={{ background: "rgba(43,37,26,0.035)" }}>
                  <AssembleSection bbl={h.bbl} onDone={() => setAssembleRow(null)} />
                </td>
              </tr>
            )}
            </Fragment>
            );
          })}
          {Object.values(game.developments).map((dv) => (
            <tr key={dv.bbl} onClick={() => go(dv.bbl)}>
              {bundling && <td className="dim">·</td>}
              {ranked && <td className="num dim">—</td>}
              <td>
                <div>{parcels[dv.bbl]?.address ?? dv.bbl}</div>
                <div className="dim" style={{ fontSize: 11 }}>
                  {devUseLabel(dv.use)} · building · delivers {monthLabel(dv.deliverM)}
                </div>
              </td>
              <td className="num dim">{sf(dv.sf)}</td>
              <td className="num dim">{(() => { const r = resolveRec(parcels, game, dv.bbl); return r ? r.demandScore.toFixed(0) : "—"; })()}</td>
              <td className="num dim">{(dv.signed?.length ?? 0)
                ? `${((dv.signed!.reduce((a, x) => a + x.sf, 0) / Math.max(1, dv.sf)) * 100).toFixed(0)}% pre`
                : "—"}</td>
              <td className="num dim">—</td>
              <td className="num dim">—</td>
              <td className="num" title="Budget incl. escalation">{usd(dv.costTotal)}</td>
              <td className="num" title="Construction loan drawn · interest accrues">
                {usd(dv.loanBalance)}
                <div className="dim" style={{ fontSize: 11 }}>
                  eq {usd(dv.equitySpent)} · {(dv.loanBalance * dv.ratePct) / 100 / 12 > 0
                    ? `int ${usd((dv.loanBalance * dv.ratePct) / 100 / 12)}/mo`
                    : "no draw"}
                </div>
              </td>
              <td className="num dim">—</td>
              <td></td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* TAX APPEALS ARE HOUSEKEEPING, not the headline — and their desk is
          the property-tax desk on Capital → Books, which also tracks the
          appeals already filed. This is the pointer, not a second list. */}
      {assessmentWatch.length > 0 && (
        <div className="hint" style={{ marginTop: 12 }}>
          {assessmentWatch.length} assessment{assessmentWatch.length === 1 ? "" : "s"} appealable
          {" "}· up to {usd(assessmentWatch.reduce((a, w) => a + w.annualSavings, 0))} / yr ·{" "}
          <button type="button" className="linkish" onClick={() => setPage("books", "Property-tax desk")}>property-tax desk →</button>
        </div>
      )}
      <ReturnsToDate />
      <Concentration />
      {/* History reads under the living book: what left, when, and what
          leaving returned. The career strip lives on Firm → The Record. */}
      <ExitsRecord />
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
/**
 * WHAT CAP RATE YOU ARE ASKING, on a bundle.
 *
 * Weighted by income across the whole ticket rather than averaged across the
 * buildings, because yields do not average — see `portfolioQuote.noiYr`. The
 * market line beside it is the sf-weighted blend of the class cap rates the
 * buildings actually sit in, so a book of sheds is not being judged against
 * what offices trade at.
 */
export function PortfolioCap({ q, ask, bbls }: { q: PortfolioQuote; ask: number; bbls: string[] }) {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const cap = q.capAtAsk(ask);
  if (!(cap > 0)) return null;
  let wsum = 0, w = 0;
  for (const b of bbls) {
    const rec = resolveRec(parcels, game, b);
    if (!rec || rec.class === "land" || !rec.bldgArea) continue;
    const c = game.econ.capRate[rec.class as BuiltClass];
    if (!c) continue;
    wsum += c * rec.bldgArea; w += rec.bldgArea;
  }
  const mkt = w > 0 ? wsum / w : cap;
  return (
    <Row k="Cap rate at ask" strong
      v={`${cap.toFixed(2)}%  ·  market ${mkt.toFixed(2)}%`}
      bad={cap < mkt - 0.4} />
  );
}

/**
 * WHICH BUILDINGS ARE BEING BOUGHT, AND WHAT EACH ONE PAYS YOU.
 *
 * A bundle used to be a count — "6 buildings, one ticket" — on both the card
 * that stops the screen and the desk behind it, so the one thing a seller has
 * to know before signing (which deeds leave, and what each returns after its
 * own mortgage, release and tax) could not be read anywhere. Every number here
 * comes off `portfolioSettlement`, which is the schedule the close itself
 * runs: there is no second waterfall on this page.
 */
export function PortfolioLegList({ book, caption }: { book: PortfolioSettlement; caption?: string }) {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  return (
    <div className="mini-list" style={{ marginTop: 8 }}>
      {caption && <div className="hint" style={{ margin: 0 }}>{caption}</div>}
      {book.legs.map((l) => {
        const rec = resolveRec(parcels, game, l.bbl);
        const net = l.toSeller - l.tax;
        return (
          <div key={l.bbl} className="mini-row" style={{ cursor: "pointer" }}
            title={`${usd(l.price)} allocated · ${usd(l.loanPayoff)} of debt off`
              + (l.release > 0 ? ` · ${usd(l.release)} facility release` : "")
              + (l.kick + l.breakFee > 0 ? ` · ${usd(l.kick + l.breakFee)} participation + break fees` : "")
              + (l.tax > 0 ? ` · ${usd(l.tax)} tax` : "")}
            onClick={() => useStore.getState().focus(l.bbl, true)}>
            <span>{l.address}<span className="dim"> · {rec ? useLabel(rec) : l.cls}</span></span>
            <span className="mono dim">
              {usd(l.price)} <span className={net < 0 ? "neg" : ""}>→ {usd(net)} to you</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** The waterfall, once, for every surface that quotes it. */
export function PortfolioProceeds({ book }: { book: PortfolioSettlement }) {
  return (
    <>
      <Row k="Loan + mezz payoff" v={usd(book.loanPayoff)} />
      {book.kick + book.breakFee > 0 && (
        <Row k="Participation + break fees" v={usd(book.kick + book.breakFee)} bad />
      )}
      {book.release > 0 && <Row k="Facility release premium" v={usd(book.release)} bad />}
      {book.facilityDue > 0 && (
        <Row k="Facility repaid in full" v={usd(book.facilityDue)} bad />
      )}
      {book.tax > 0 && <Row k="Capital-gains tax" v={usd(book.tax)} bad />}
      <Row k={book.toFund ? "Net to the fund" : "Net to you"} v={usd(book.netToYou)} strong bad={book.netToYou < 0} />
    </>
  );
}

/**
 * ONE INDICATION, ONE SET OF ANSWERS, WHEREVER YOU ARE STANDING.
 *
 * The same three questions used to be asked on three surfaces — the alert
 * card, the decision card, and this desk — and the decision card's "Counter…"
 * was a navigation to the desk, so answering it meant being asked it again.
 * The card and the desk mount this component instead: one accept, one 1031,
 * one counter, no second confirmation anywhere on the path.
 */
export function PortfolioBidActions({
  bid, sumOfParts, book, onDone, trailing, rowClass = "btn-row",
}: {
  bid: NonNullable<NonNullable<GameState["portfolioSale"]>["bids"]>[number];
  sumOfParts: number;
  book: PortfolioSettlement;
  onDone?: () => void;
  trailing?: ReactNode;
  /** The card wants modal-sized buttons; the desk wants desk-sized ones. */
  rowClass?: string;
}) {
  const { counterPortfolioBid, acceptPortfolio } = useStore.getState();
  const exchangeLive = useStore((s) => !!s.game?.exchange);
  const [countering, setCountering] = useState(false);
  const [counter, setCounter] = useState(0);
  const pb = counterPriceBounds(bid.price, sumOfParts);
  const cb = { ...pb, min: Math.max(pb.min, bid.price + pb.step) };
  // The number on the slider and the number that gets sent are the same
  // number, clamped the same way — a stale draft from a previous indication
  // used to display clamped and send raw.
  const px = Math.min(cb.max, Math.max(cb.min, counter || Math.round(bid.price * 1.05)));
  return (
    <>
      <div className={rowClass}>
        <button className="btn btn-buy" onClick={() => { acceptPortfolio(false); onDone?.(); }}>
          Close it · net {usd(book.netToYou)}{book.toFund ? " to the fund" : ""}
        </button>
        <button className="btn" onClick={() => { acceptPortfolio(true); onDone?.(); }}
          disabled={book.toFund || exchangeLive}
          title={book.toFund
            ? "Fund gain · not eligible for your 1031"
            : exchangeLive ? "A 1031 is already open"
            : "Defer the gain · redeploy within 6 months or tax is due"}>
          Close into a 1031{book.tax > 0 ? ` · defer ${usd(book.tax)}` : ""}
        </button>
        {!bid.countered && (
          <button className={"btn" + (countering ? " btn-on" : "")} onClick={() => setCountering(!countering)}>
            Counter…
          </button>
        )}
        {trailing}
      </div>
      {!bid.countered && countering && (
        <>
          <Slider min={cb.min} max={cb.max} step={cb.step}
            typedMin={cb.typedMin} typedMax={cb.typedMax} editable="price"
            value={px} onChange={setCounter}
            label="Counter at" format={(v: number) => usd(v)}
            hint="Above their bid · too high and they walk" />
          <div className="btn-row">
            <button className="btn" onClick={() => { counterPortfolioBid(px); setCountering(false); }}>
              Put {usd(px)} to {bid.name}
            </button>
          </div>
        </>
      )}
    </>
  );
}

export function PortfolioSaleDesk({ bundle, clear }: { bundle: string[]; clear: () => void }) {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const { sellPortfolio, repricePortfolioSale, pullPortfolio } = useStore.getState();
  const live = game.portfolioSale;
  const [askPct, setAskPct] = useState(100);

  // ---- a process already running -------------------------------------------
  if (live) {
    const q = portfolioQuote(game, parcels, live.bbls);
    const bid = live.bids?.[0];
    const age = game.month - live.listedM;
    // SOMEBODY ELSE'S APPROACH IS NOT YOUR LISTING. It occupies the same slot —
    // one process at a time is right, a seller cannot run two — but every word
    // on this desk has to say whose process it is. Read as a listing it looked
    // like the game had put the player's book on the market unasked.
    const inbound = !!live.unsolicited;
    const onTable = bid?.price ?? live.ask;
    const book = portfolioSettlement(game, parcels, live.bbls, onTable);
    return (
      <div className="page-section">
        <div className="page-section-head">
          {inbound
            ? `Unsolicited bid · ${bid?.name ?? "buyer"} · ${live.bbls.length} buildings`
            : `Portfolio in the market · ${live.bbls.length} buildings`}
        </div>
        <div className="grid">
          {inbound
            ? <Row k="Bid" v={usd(onTable)} strong />
            : <Row k="Asking" v={usd(live.ask)} strong />}
          {/* THE NUMBER THE COMMITTEE ON THE OTHER SIDE IS ACTUALLY LOOKING AT.
              A portfolio is quoted as a yield; the price is what the yield
              implies. This desk showed dollars and a spread against the parts
              and never once said what cap the ask was struck at. */}
          <PortfolioCap q={q} ask={onTable} bbls={live.bbls} />
          <Row k="Sum of marks" v={usd(q.sumOfParts)} />
          <Row k="Bundle indication" v={`${usd(q.indicative)} · ${(q.spreadPct * 100).toFixed(1)}%`}
            bad={q.spreadPct < -0.06} />
          {inbound
            ? bid && <Row k="Expires" v={monthLabel(bid.expiresM)} bad={bid.expiresM - game.month <= 1} />
            : <Row k="On the market" v={`${age} month${age === 1 ? "" : "s"} · stale at 9`} bad={age > 6} />}
          <Row k="Funded buyers" v={String(q.depth)} bad={q.depth <= 1} />
          {!inbound && (
            <Row k="Ask vs indication"
              v={live.ask > q.indicative
                ? `${((live.ask / Math.max(1, q.indicative) - 1) * 100).toFixed(0)}% above`
                : live.ask < q.indicative * 0.98
                  ? `${((1 - live.ask / Math.max(1, q.indicative)) * 100).toFixed(0)}% under`
                  : "at the indication"}
              bad={live.ask > q.indicative * 1.05} />
          )}
          {!inbound && <Row k="Indications in hand" v={String(live.bids?.length ?? 0)} />}
          {bid && <PortfolioProceeds book={book} />}
        </div>
        <PortfolioLegList book={book}
          caption={bid
            ? undefined
            : `Allocation at ask of ${usd(live.ask)}`} />
        {bid ? (
          <>
            <div className="hint" style={{ marginTop: 10 }}>
              <strong><FirmLink name={bid.name} id={bid.firmId} /></strong> · {usd(bid.price)} · {((1 - bid.price / Math.max(1, q.sumOfParts)) * 100).toFixed(1)}%
              under sum of marks · expires {monthLabel(bid.expiresM)}
              {bid.countered && " · already countered"}
            </div>
            <PortfolioBidActions
              key={`${bid.name}:${bid.price}`}
              bid={bid} sumOfParts={q.sumOfParts} book={book}
              onDone={clear}
              trailing={
                <button className="btn" onClick={() => { pullPortfolio(); clear(); }}>
                  {inbound ? "Decline" : "Pull"}
                </button>
              }
            />
          </>
        ) : (
          <>
            <div className="hint" style={{ marginTop: 10 }}>
              {inbound
                ? "Bid lapsed. Nothing listed."
                : "No bids yet."}
              {!inbound && (q.depth <= 0
                ? " No funded buyers for a book this size."
                : live.ask > q.indicative * 1.05
                  ? " Ask above indication · stale at 9 months."
                  : age > 5
                    ? " 6+ months, no bids."
                    : " Bids typically take a quarter.")}
            </div>
            <div className="btn-row">
              {!inbound && (
                <Slider min={Math.round(q.indicative * 0.8)} max={Math.round(q.sumOfParts * 1.05)} step={250_000}
                  value={live.ask} onChange={(v: number) => repricePortfolioSale(v)} label="Ask" format={(v: number) => usd(v)} />
              )}
              <button className="btn" onClick={() => { pullPortfolio(); clear(); }}>
                {inbound ? "Clear" : "Pull"}
              </button>
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
  const preview = portfolioSettlement(game, parcels, bundle, ask);
  return (
    <div className="page-section">
      <div className="page-section-head">Bundle sale · {bundle.length} buildings</div>
      {bundle.length < 2 ? (
        <div className="hint">Pick at least 2 buildings.</div>
      ) : (
        <>
          <div className="grid">
            <Row k="Sum of marks" v={usd(q.sumOfParts)} strong />
            {q.why.map((w, i) => (
              <Row key={i} k={w.label} v={`${w.pct >= 0 ? "+" : ""}${(w.pct * 100).toFixed(1)}%`} bad={w.pct < 0} />
            ))}
            <Row k="Bundle indication" v={`${usd(q.indicative)} · ${(q.spreadPct * 100).toFixed(1)}% vs marks`}
              strong bad={q.spreadPct < 0} />
            <PortfolioCap q={q} ask={ask} bbls={bundle} />
            <Row k="Funded buyers" v={String(q.depth)} bad={q.depth <= 1} />
            {/* WHAT THE CLOSING TAKES, BEFORE YOU COMMIT TO IT. A pledged deed
                used to be refused outright with an instruction the facility
                itself would not let you follow; it settles at the release
                premium instead, and a premium you cannot see coming is a
                punishment rather than a decision. Struck at the indication,
                through the same schedule the close runs. */}
            <Row k="At ask" v={usd(ask)} strong />
            <PortfolioProceeds book={preview} />
          </div>
          <div className="hint">
            {preview.facilityDue > 0
              ? `Pool drops below ${FACILITY_MIN_ASSETS} deeds · facility repaid from proceeds. `
              : preview.release > 0
                ? "Pledged deeds released at allocated share + premium, from proceeds. "
                : ""}
            {q.depth <= 0
              ? "No funded buyers for a bundle this size."
              : q.spreadPct < -0.10
              ? "Deep discount · driven by the weakest buildings."
              : q.spreadPct < -0.03
                ? "Typical bundle discount."
                : "Minimal discount."}
          </div>
          <Slider min={80} max={112} step={1} value={askPct} onChange={setAskPct}
            label="Ask vs indication" format={(v: number) => `${v}% · ${usd(Math.round(q.indicative * (v / 100)))}`} />
          <div className="hint">Listing goes stale at 9 months.</div>
          <div className="btn-row">
            <button
              className="btn btn-buy"
              disabled={q.depth <= 0}
              title={q.depth <= 0 ? "No funded buyers" : undefined}
              onClick={() => {
                sellPortfolio(bundle, ask);
                // The picks survive a refusal. The engine can still say no — a
                // crane on a site, a deed in a workout — and wiping twenty
                // ticks on the way to a red toast means re-ticking nineteen
                // good ones to fix the twentieth.
                if (useStore.getState().game?.portfolioSale) clear();
              }}
            >
              List at {usd(ask)}
            </button>
          </div>
        </>
      )}
    </div>
  );
}


/**
 * WHAT EACH BUILDING HAS EARNED ON YOUR MONEY SO FAR. The exit card reports a
 * levered IRR when a deed sells; this is the same ledger read on the deeds
 * still held, with today's equity at the mark as the terminal value (before
 * selling costs). Under a year held, no IRR — a few months annualise into noise.
 */
function ReturnsToDate() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const rows = derive(game, "portfolio.returnsToDate", () => returnsToDate(game, parcels), [parcels]);
  if (!rows.length) return null;
  const pct = (x: number | null) => (x === null ? "—" : `${x >= 0 ? "" : "−"}${Math.abs(x * 100).toFixed(1)}%`);
  return (
    <div className="page-section">
      <div className="page-section-head">Returns to date · equity, pre-tax</div>
      <table className="tbl">
        <thead>
          <tr><th>Building</th><th className="num">Held</th><th className="num">Equity in</th><th className="num">Cash back</th><th className="num">Equity at mark</th><th className="num">Multiple</th><th className="num">IRR</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.bbl} onClick={() => useStore.getState().openProperty(r.bbl, "summary")}>
              <td>{resolveRec(parcels, game, r.bbl)?.address ?? r.bbl}</td>
              <td className="num">{r.years < 1 ? `${Math.round(r.years * 12)} mo` : `${r.years.toFixed(1)} yr`}</td>
              <td className="num">{usd(r.equityIn)}</td>
              <td className="num">{usd(r.cashBack)}</td>
              <td className={"num" + (r.equityNow < 0 ? " neg" : "")}>{usd(r.equityNow)}</td>
              <td className={"num" + (r.multiple < 1 ? " neg" : "")}>{r.multiple.toFixed(2)}×</td>
              <td className={"num" + ((r.irr ?? 0) < 0 ? " neg" : "")}>{pct(r.irr)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="hint">
        Equity in, cash after debt service, leasing, capex and refi proceeds · terminal equity at mark, no selling costs.
        Excludes pre-ledger, facility-pooled and fund deeds.
      </div>
    </div>
  );
}
