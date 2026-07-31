import { useStore } from "@/state/store";
import type { Tab } from "@/state/store";
import { CLASS_COLOR, CLASS_LABEL } from "@/data/types";
import { quarterLabel } from "@/engine/types";
import { assetValue, initialCondition, holdingValue, marketRentPsfYr, occupancy, noiYr, renovationCost, quarterlyNOI } from "@/engine/value";
import { loanQuote, LOAN_LTV } from "@/engine/actions";
import { usd, sf, pct } from "./format";

const TABS: { id: Tab; label: string }[] = [
  { id: "parcel", label: "Parcel" },
  { id: "portfolio", label: "Portfolio" },
  { id: "market", label: "Market" },
];

export default function RightPanel() {
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const game = useStore((s) => s.game);
  if (!game) return null;

  return (
    <div className="panel">
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={"tab" + (tab === t.id ? " tab-on" : "")} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "parcel" && <ParcelTab />}
      {tab === "portfolio" && <PortfolioTab />}
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

function ParcelTab() {
  const parcels = useStore((s) => s.parcels);
  const adjacency = useStore((s) => s.adjacency);
  const selectedBBL = useStore((s) => s.selectedBBL);
  const select = useStore((s) => s.select);
  const game = useStore((s) => s.game)!;
  const { buy, sell, renovate } = useStore.getState();

  if (!selectedBBL || !parcels) return <div className="hint">Click a lot on the map — every parcel on the island has a record.</div>;
  const rec = parcels[selectedBBL];
  if (!rec) return null;
  const neighbors = adjacency?.[selectedBBL] ?? [];
  const holding = game.holdings[selectedBBL];
  const listing = game.listings.find((l) => l.bbl === selectedBBL);
  const cond = holding?.condition ?? initialCondition(rec);
  const value = holding ? holdingValue(rec, game.econ, holding) : assetValue(rec, game.econ, cond);
  const builtFar = rec.lotArea > 0 ? rec.bldgArea / rec.lotArea : 0;
  const farMax = Math.max(rec.farMaxComm, rec.farMaxRes);
  const imp = (field: string) => (rec.imputed.includes(field) ? "*" : "");
  const isBuilt = rec.class !== "land" && rec.bldgArea > 0;
  const renovating = holding?.renovatingUntilQ !== undefined && game.quarter < (holding.renovatingUntilQ ?? 0);

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
      </div>

      <div className="grid">
        <Row k="Appraisal" v={usd(value)} strong />
        {isBuilt && <Row k="Market rent" v={"$" + marketRentPsfYr(rec, game.econ, cond).toFixed(0) + " /sf/yr"} />}
        {isBuilt && <Row k="Occupancy" v={(occupancy(rec, game.econ) * 100).toFixed(0) + "%"} />}
        {isBuilt && <Row k="NOI / yr" v={usd(noiYr(rec, game.econ, cond))} />}
        {isBuilt && <Row k="Condition" v={cond} />}
        <Row k="Land value" v={"$" + Math.round(rec.landPsf * game.econ.landIdx).toLocaleString() + " /sf"} />
        <Row k="Lot area" v={sf(rec.lotArea) + imp("lotArea")} />
        {isBuilt && <Row k="Building" v={sf(rec.bldgArea) + imp("bldgArea") + ` · ${rec.floors} fl`} />}
        {isBuilt && <Row k="Year built" v={String(rec.yearBuilt) + imp("yearBuilt")} />}
        <Row k="FAR built / max" v={`${builtFar.toFixed(1)} / ${farMax.toFixed(1)}`} />
        <Row k="Demand" v={String(rec.demandScore) + " / 100"} />
      </div>

      {/* the deal section */}
      {listing && !holding && (
        <div className="deal">
          <div className="deal-head">On the market</div>
          <div className="grid">
            <Row k="Ask" v={usd(listing.ask)} strong />
            <Row k="vs. appraisal" v={((listing.ask / value - 1) * 100).toFixed(1) + "%"} />
            <Row k="Financed equity" v={usd(listing.ask - loanQuote(game, listing.ask).principal + listing.ask * 0.02)} />
            <Row k="Loan rate" v={pct(loanQuote(game, listing.ask).ratePct)} />
          </div>
          <div className="btn-row">
            <button className="btn btn-buy" onClick={() => buy(selectedBBL, false)}>Buy all-cash</button>
            <button className="btn btn-buy" onClick={() => buy(selectedBBL, true)}>Buy · {Math.round(LOAN_LTV * 100)}% LTV</button>
          </div>
        </div>
      )}

      {holding && (
        <div className="deal">
          <div className="deal-head">Your position · since {quarterLabel(holding.boughtQ)}</div>
          <div className="grid">
            <Row k="Basis" v={usd(holding.costBasis)} />
            <Row k="Debt" v={holding.loan ? `${usd(holding.loan.balance)} @ ${pct(holding.loan.ratePct)}` : "unlevered"} />
            <Row k="CF / qtr" v={usd(quarterlyNOI(rec, game.econ, holding, game.quarter) - (holding.loan?.quarterlyPmt ?? 0))} />
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

      {!listing && !holding && (
        <div className="hint">Not currently for sale. Off-market approaches arrive in a later phase — watch the Market tab for listings.</div>
      )}

      <div className="neighbors">
        <div className="neighbors-head">Adjoining lots · {neighbors.length}</div>
        <div className="neighbors-list">
          {neighbors.map((n) => {
            const nr = parcels[n];
            return (
              <button key={n} className="neighbor" onClick={() => select(n)}>
                <span className="neighbor-addr">{nr?.address ?? n}</span>
                <span className="neighbor-meta mono">
                  {nr ? `${nr.lotArea.toLocaleString()} sf · ${CLASS_LABEL[nr.class]}` : ""}
                </span>
              </button>
            );
          })}
          {neighbors.length === 0 && <div className="neighbor-none">No shared lot lines on record.</div>}
        </div>
      </div>

      {rec.imputed.length > 0 && (
        <div className="footnote">* imputed from building-class medians (missing or absurd in source)</div>
      )}
    </div>
  );
}

function PortfolioTab() {
  const parcels = useStore((s) => s.parcels)!;
  const game = useStore((s) => s.game)!;
  const select = useStore((s) => s.select);
  const holdings = Object.values(game.holdings);
  if (!holdings.length) return <div className="hint">You own nothing yet. The Market tab has the tape.</div>;
  let totV = 0, totD = 0, totCF = 0;
  const rows = holdings.map((h) => {
    const rec = parcels[h.bbl];
    const v = rec ? holdingValue(rec, game.econ, h) : 0;
    const cf = rec ? quarterlyNOI(rec, game.econ, h, game.quarter) - (h.loan?.quarterlyPmt ?? 0) : 0;
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
            <span className="neighbor-addr">{rec?.address ?? h.bbl}</span>
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
          {[...game.listings].sort((a, b) => a.ask - b.ask).map((l) => {
            const rec = parcels[l.bbl];
            if (!rec) return null;
            return (
              <button key={l.bbl} className="neighbor" onClick={() => select(l.bbl)}>
                <span className="neighbor-addr">{rec.address}</span>
                <span className="neighbor-meta mono">{usd(l.ask)} · {CLASS_LABEL[rec.class]}</span>
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

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <>
      <div className="k">{k}</div>
      <div className={"v mono" + (strong ? " v-strong" : "")}>{v}</div>
    </>
  );
}
