import { useStore } from "@/state/store";
import type { Tab } from "@/state/store";
import { CLASS_COLOR, CLASS_LABEL } from "@/data/types";
import { quarterLabel, CREDIT_LABEL } from "@/engine/types";
import { assetValue, initialCondition, holdingValue, marketRentPsfYr, occupancy, noiYr, holdingNOIYr, renovationCost } from "@/engine/value";
import { buyQuote, assemblagePressure } from "@/engine/actions";
import { isCommercial, vacantSf, walt, loiSigningCost } from "@/engine/leasing";
import { dscr, ltv } from "@/engine/debt";
import { usd, sf, pct } from "./format";

const TABS: { id: Tab; label: string }[] = [
  { id: "parcel", label: "Parcel" },
  { id: "portfolio", label: "Portfolio" },
  { id: "deals", label: "Deals" },
  { id: "market", label: "Market" },
];

export default function RightPanel() {
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const game = useStore((s) => s.game);
  if (!game) return null;
  const dealsCount = game.lois.length;

  return (
    <div className="panel">
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={"tab" + (tab === t.id ? " tab-on" : "")} onClick={() => setTab(t.id)}>
            {t.label}{t.id === "deals" && dealsCount > 0 ? ` · ${dealsCount}` : ""}
          </button>
        ))}
      </div>
      {tab === "parcel" && <ParcelTab />}
      {tab === "portfolio" && <PortfolioTab />}
      {tab === "deals" && <DealsTab />}
      {tab === "market" && <MarketTab />}
      {game.gameOver && (
        <div className="gameover">
          <div className="gameover-head">The run is over.</div>
          <div>{game.gameOver.cause}</div>
          <button className="btn btn-buy" onClick={() => useStore.getState().newRun()}>Start a new run</button>
        </div>
      )}
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

function ParcelTab() {
  const parcels = useStore((s) => s.parcels);
  const adjacency = useStore((s) => s.adjacency);
  const selectedBBL = useStore((s) => s.selectedBBL);
  const select = useStore((s) => s.select);
  const game = useStore((s) => s.game)!;
  const { sell, renovate, approach, refi } = useStore.getState();

  if (!selectedBBL || !parcels) return <div className="hint">Click a lot on the map — every parcel in Ashport has a record.</div>;
  const rec = parcels[selectedBBL];
  if (!rec) return null;
  const neighbors = adjacency?.[selectedBBL] ?? [];
  const holding = game.holdings[selectedBBL];
  const listing = game.listings.find((l) => l.bbl === selectedBBL);
  const appr = game.approaches[selectedBBL];
  const cond = holding?.condition ?? initialCondition(rec);
  const value = holding ? holdingValue(rec, game.econ, holding) : assetValue(rec, game.econ, cond);
  const builtFar = rec.lotArea > 0 ? rec.bldgArea / rec.lotArea : 0;
  const farMax = Math.max(rec.farMaxComm, rec.farMaxRes);
  const isBuilt = rec.class !== "land" && rec.bldgArea > 0;
  const renovating = holding?.renovatingUntilQ !== undefined && game.quarter < (holding.renovatingUntilQ ?? 0);
  const commercial = isCommercial(rec);
  const leasedSf = holding && commercial ? holding.tenants.reduce((s2, t) => s2 + t.sf, 0) : 0;
  const d = holding ? dscr(rec, game, holding) : null;
  const l = holding ? ltv(rec, game, holding) : null;

  return (
    <div>
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
        {listing && !holding && <span className="chip chip-listed">FOR SALE</span>}
        {renovating && <span className="chip chip-reno">RENOVATING</span>}
        {holding?.loan?.sweep && <span className="chip chip-sweep">CASH SWEEP</span>}
      </div>

      <div className="grid">
        <Row k="Appraisal" v={usd(value)} strong />
        {isBuilt && <Row k="Market rent" v={"$" + marketRentPsfYr(rec, game.econ, cond).toFixed(0) + " /sf/yr"} />}
        {isBuilt && !holding && <Row k="Occupancy (mkt)" v={(occupancy(rec, game.econ) * 100).toFixed(0) + "%"} />}
        {holding && commercial && <Row k="Occupancy" v={rec.bldgArea ? ((leasedSf / rec.bldgArea) * 100).toFixed(0) + "%" : "—"} />}
        {holding && rec.class === "multifamily" && <Row k="Occupancy" v={((holding.occ ?? 0) * 100).toFixed(0) + "%"} />}
        {holding && commercial && <Row k="WALT" v={walt(holding, game.quarter).toFixed(1) + " yrs"} />}
        {isBuilt && <Row k="NOI / yr" v={usd(holding ? holdingNOIYr(rec, game.econ, holding, game.quarter) : noiYr(rec, game.econ, cond))} />}
        <Row k="Lot area" v={sf(rec.lotArea)} />
        {isBuilt && <Row k="Building" v={sf(rec.bldgArea) + ` · ${rec.floors} fl · ${rec.yearBuilt}`} />}
        <Row k="FAR built / max" v={`${builtFar.toFixed(1)} / ${farMax.toFixed(1)}`} />
        <Row k="Demand" v={String(rec.demandScore) + " / 100"} />
      </div>

      {/* rent roll */}
      {holding && commercial && holding.tenants.length > 0 && (
        <div className="deal">
          <div className="deal-head">Rent roll · {sf(leasedSf)} of {sf(rec.bldgArea)}</div>
          <div className="roll">
            {holding.tenants.map((t, i) => (
              <div key={i} className="roll-row">
                <span className="roll-name">{t.name} <span className="roll-credit mono">{CREDIT_LABEL[t.credit]}</span></span>
                <span className="roll-meta mono">
                  {(t.sf / 1000).toFixed(1)}k sf · ${t.rentPsf.toFixed(0)} {t.net ? "NNN" : "G"} · exp {quarterLabel(t.endQ)}
                </span>
              </div>
            ))}
            {vacantSf(rec, holding) > 500 && (
              <div className="roll-row roll-vacant">
                <span className="roll-name">Vacant</span>
                <span className="roll-meta mono">{(vacantSf(rec, holding) / 1000).toFixed(1)}k sf</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* debt desk */}
      {holding?.loan && (
        <div className="deal">
          <div className="deal-head">Debt</div>
          <div className="grid">
            <Row k="Balance" v={usd(holding.loan.balance)} strong />
            <Row k="Coupon" v={pct(holding.loan.ratePct) + (holding.loan.product === "float" ? " (floating)" : " (fixed)")} />
            {game.quarter < holding.loan.ioUntilQ && <Row k="Interest-only" v={"until " + quarterLabel(holding.loan.ioUntilQ)} />}
            <Row k="Payment / qtr" v={usd(holding.loan.quarterlyPmt)} />
            <Row k="Balloon" v={quarterLabel(holding.loan.maturityQ)} />
            {d !== null && <Row k="DSCR" v={d.toFixed(2) + " (min " + holding.loan.minDSCR.toFixed(2) + ")"} bad={d < holding.loan.minDSCR} />}
            {l !== null && <Row k="LTV" v={(l * 100).toFixed(0) + "% (max " + (holding.loan.maxLTV * 100).toFixed(0) + "%)"} bad={l > holding.loan.maxLTV} />}
          </div>
          <div className="btn-row">
            <button className="btn" onClick={() => refi(selectedBBL, "fixed")}>Refi fixed</button>
            <button className="btn" onClick={() => refi(selectedBBL, "float")}>Refi float</button>
          </div>
        </div>
      )}

      {/* the deal section */}
      {listing && !holding && (
        <div className="deal">
          <div className="deal-head">On the market</div>
          <div className="grid">
            <Row k="Ask" v={usd(listing.ask)} strong />
            <Row k="vs. appraisal" v={((listing.ask / value - 1) * 100).toFixed(1) + "%"} />
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
                <Row k="vs. appraisal" v={((appr.ask / value - 1) * 100).toFixed(1) + "%"} />
                <Row k="Good until" v={quarterLabel(appr.q + 4)} />
              </div>
              <BuyButtons bbl={selectedBBL} price={appr.ask} off />
            </>
          ) : appr && appr.refused ? (
            <div className="hint">The owner turned you away in {quarterLabel(appr.q)}. Try again after {quarterLabel(appr.q + 4)}.</div>
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

      {holding && (
        <div className="deal">
          <div className="deal-head">Your position · since {quarterLabel(holding.boughtQ)}</div>
          <div className="grid">
            <Row k="Basis" v={usd(holding.costBasis)} />
            <Row k="Equity" v={usd(value - (holding.loan?.balance ?? 0))} strong />
          </div>
          <div className="btn-row">
            {isBuilt && cond !== "good" && !renovating && (
              <button className="btn" onClick={() => renovate(selectedBBL)}>
                Renovate · {usd(renovationCost(rec))}
              </button>
            )}
            <button className="btn btn-sell" onClick={() => sell(selectedBBL)}>Sell · net {usd(value * 0.97 - (holding.loan?.balance ?? 0))}</button>
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

function DealsTab() {
  const parcels = useStore((s) => s.parcels)!;
  const game = useStore((s) => s.game)!;
  const select = useStore((s) => s.select);
  const { respondLoi } = useStore.getState();
  const q = game.quarter;

  const expiring: { bbl: string; name: string; sf: number; endQ: number }[] = [];
  const maturities: { bbl: string; matQ: number; bal: number; sweep: boolean }[] = [];
  for (const h of Object.values(game.holdings)) {
    for (const t of h.tenants) if (t.endQ - q <= 4 && t.endQ > q) expiring.push({ bbl: h.bbl, name: t.name, sf: t.sf, endQ: t.endQ });
    if (h.loan && (h.loan.maturityQ - q <= 8 || h.loan.sweep)) maturities.push({ bbl: h.bbl, matQ: h.loan.maturityQ, bal: h.loan.balance, sweep: h.loan.sweep });
  }

  return (
    <div>
      <div className="neighbors-head">Letters of intent · {game.lois.length}</div>
      {game.lois.length === 0 && <div className="hint">No live negotiations. Vacant space in high-demand buildings draws LOIs each quarter.</div>}
      {game.lois.map((loi) => {
        const rec = parcels[loi.bbl];
        return (
          <div key={loi.id} className="loi">
            <button className="loi-addr" onClick={() => select(loi.bbl)}>{rec?.address ?? loi.bbl}</button>
            <div className="loi-line">
              <b>{loi.name}</b> <span className="mono">{CREDIT_LABEL[loi.credit]}</span> · {loi.sector}
              {loi.kind === "renewal" && <span className="chip chip-renewal">RENEWAL</span>}
            </div>
            <div className="loi-line mono">
              {(loi.sf / 1000).toFixed(1)}k sf · ${loi.rentPsf.toFixed(0)}/sf {loi.net ? "NNN" : "gross"} · {(loi.termQ / 4).toFixed(0)} yrs
              {loi.tiPsf > 0 && ` · TI $${loi.tiPsf}`}{loi.freeQ > 0 && ` · ${loi.freeQ}q free`}
            </div>
            <div className="loi-line mono dim">signing costs {usd(loiSigningCost(loi))} · answer by {quarterLabel(loi.expiresQ)}</div>
            <div className="btn-row">
              <button className="btn btn-buy" onClick={() => respondLoi(loi.id, "accept")}>Accept</button>
              {!loi.countered && <button className="btn" onClick={() => respondLoi(loi.id, "counter")} title="+6% rent, −30% TI — they may walk">Counter</button>}
              <button className="btn" onClick={() => respondLoi(loi.id, "decline")}>Pass</button>
            </div>
          </div>
        );
      })}

      <div className="neighbors">
        <div className="neighbors-head">Rolling in the next year · {expiring.length}</div>
        {expiring.length === 0 && <div className="hint">No near-term expirations.</div>}
        <div className="neighbors-list">
          {expiring.map((e, i) => (
            <button key={i} className="neighbor" onClick={() => select(e.bbl)}>
              <span className="neighbor-addr">{e.name}</span>
              <span className="neighbor-meta mono">{parcels[e.bbl]?.address} · exp {quarterLabel(e.endQ)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="neighbors">
        <div className="neighbors-head">Debt watch · {maturities.length}</div>
        {maturities.length === 0 && <div className="hint">No balloons or breaches on the radar.</div>}
        <div className="neighbors-list">
          {maturities.map((m, i) => (
            <button key={i} className="neighbor" onClick={() => select(m.bbl)}>
              <span className="neighbor-addr">{m.sweep ? "⚠ " : ""}{parcels[m.bbl]?.address}</span>
              <span className="neighbor-meta mono">{usd(m.bal)} · balloon {quarterLabel(m.matQ)}{m.sweep ? " · SWEEP" : ""}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function PortfolioTab() {
  const parcels = useStore((s) => s.parcels)!;
  const game = useStore((s) => s.game)!;
  const select = useStore((s) => s.select);
  const holdings = Object.values(game.holdings);
  if (!holdings.length) return <div className="hint">You own nothing yet. The Market tab has the tape; the map has everything else.</div>;
  let totV = 0, totD = 0, totCF = 0;
  const rows = holdings.map((h) => {
    const rec = parcels[h.bbl];
    const v = rec ? holdingValue(rec, game.econ, h) : 0;
    const cf = rec ? holdingNOIYr(rec, game.econ, h, game.quarter) / 4 - (h.loan?.quarterlyPmt ?? 0) : 0;
    totV += v; totD += h.loan?.balance ?? 0; totCF += cf;
    return { h, rec, v, cf };
  });
  return (
    <div>
      <div className="grid" style={{ marginBottom: 10 }}>
        <Row k="Assets" v={usd(totV)} strong />
        <Row k="Debt" v={usd(totD)} />
        <Row k="Equity" v={usd(totV - totD)} strong />
        <Row k="CF / qtr" v={usd(totCF)} />
      </div>
      <div className="neighbors-list" style={{ maxHeight: "none" }}>
        {rows.map(({ h, rec, v, cf }) => (
          <button key={h.bbl} className="neighbor" onClick={() => select(h.bbl)}>
            <span className="neighbor-addr">{h.loan?.sweep ? "⚠ " : ""}{rec?.address ?? h.bbl}</span>
            <span className="neighbor-meta mono">{usd(v)} · {usd(cf)}/q</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function MarketTab() {
  const parcels = useStore((s) => s.parcels)!;
  const game = useStore((s) => s.game)!;
  const select = useStore((s) => s.select);
  const e = game.econ;
  return (
    <div>
      <div className="grid">
        <Row k="Loan index" v={pct(e.indexRate)} strong />
        <Row k="Phase" v={e.phase + (e.rumoredPhase ? ` (whispers of ${e.rumoredPhase})` : "")} />
        <Row k="Cap · office" v={pct(e.capRate.office)} />
        <Row k="Cap · retail" v={pct(e.capRate.retail)} />
        <Row k="Cap · multifam" v={pct(e.capRate.multifamily)} />
        <Row k="Rent idx · office" v={"$" + e.rentIdx.office.toFixed(0) + " /sf"} />
        <Row k="Land index" v={e.landIdx.toFixed(3)} />
      </div>

      <div className="neighbors">
        <div className="neighbors-head">On the market · {game.listings.length}</div>
        <div className="neighbors-list" style={{ maxHeight: 260 }}>
          {[...game.listings].sort((a, b) => a.ask - b.ask).map((li) => {
            const rec = parcels[li.bbl];
            if (!rec) return null;
            return (
              <button key={li.bbl} className="neighbor" onClick={() => select(li.bbl)}>
                <span className="neighbor-addr">{rec.address}</span>
                <span className="neighbor-meta mono">{usd(li.ask)} · {CLASS_LABEL[rec.class]}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="neighbors">
        <div className="neighbors-head">The tape</div>
        <div className="news">
          {game.news.slice(0, 12).map((n, i) => (
            <div key={i} className={"news-item news-" + n.kind}>
              <span className="news-q mono">{quarterLabel(n.q)}</span> {n.text}
            </div>
          ))}
        </div>
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
