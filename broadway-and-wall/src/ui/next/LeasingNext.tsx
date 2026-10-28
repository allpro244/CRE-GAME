/**
 * LEASING, ITS OWN PLACE (owner: "much easier to digest, negotiate, counter,
 * accept — a smooth leasing system").
 *
 * Offers: every letter on the desk as a card — who, where, the rent against
 * the market, the term and the concessions, what signing costs — with Sign,
 * Counter (the same dials as the pop-up, LoiCounterDraft) and Decline on the
 * card. Expiring: the roll across the book, soonest first. Vacancy: each
 * building's empty space with its leasing plan beside it.
 */
import { useMemo, useState } from "react";
import { useStore } from "@/state/store";
import type { GameState, LOI } from "@/engine/types";
import type { ParcelTable } from "@/data/types";
import { monthLabel, CREDIT_LABEL } from "@/engine/types";
import { initialCondition, marketRentPsfYr, resolveRec } from "@/engine/value";
import { exclusiveFeeRate, loiSigningCash, occupancyRead, vacantSf } from "@/engine/leasing";
import { LoiCounterDraft, loiMarketPsf } from "@/ui/panels/LoiNegotiate";
import { usd } from "@/ui/format";
import { DataTable, Stat, StatStrip, type Col } from "./DataTable";
import { Figure, fmtFig } from "./Figure";
import { LeasingPlan } from "./FileTabs";

const sel = (bbl: string) => useStore.getState().select(bbl);

function OfferCard({ game, parcels, loi }: { game: GameState; parcels: ParcelTable; loi: LOI }) {
  const [countering, setCountering] = useState(false);
  const [said, setSaid] = useState<{ text: string; ok: boolean } | null>(null);
  const rec = resolveRec(parcels, game, loi.bbl);
  const h = game.holdings[loi.bbl];
  const market = loiMarketPsf(game, parcels, loi);
  const fee = h ? exclusiveFeeRate(h) : undefined;
  const cost = loiSigningCash(loi, fee);
  const short = Math.max(0, Math.ceil((cost - game.cash) / 1000) * 1000);
  const vs = market > 0 ? loi.rentPsf / market - 1 : 0;
  const verdict = vs > 0.02 ? "Above market" : vs < -0.05 ? "Below market" : "At market";
  const tone = vs > 0.02 ? "pos" : vs < -0.05 ? "neg" : "";
  const respond = (a: "accept" | "decline") => {
    const r = useStore.getState().respondLoi(loi.id, a, short > 0);
    if (r.msg) setSaid({ text: r.msg, ok: r.ok });
  };
  const years = loi.termM / 12;
  return (
    <div className="ls-card">
      <div className="ls-card-head">
        <div>
          <b>{loi.name}</b> <span className="nx-chip nx-chip-teal">{loi.kind}</span>
          <div className="nx-dim ls-sub">
            <a onClick={() => sel(loi.bbl)}>{rec?.address ?? loi.bbl}</a> · {loi.sector} · {CREDIT_LABEL[loi.credit] ?? loi.credit} credit
          </div>
        </div>
        <span className={"ls-verdict " + tone}>{verdict}</span>
      </div>
      <div className="ls-figs">
        <div><small>Space</small>{Math.round(loi.sf).toLocaleString()} sf</div>
        <div><small>Rent</small>${loi.rentPsf.toFixed(2)}<span className={"ls-vs " + tone}>{fmtFig(vs, "pct")}</span></div>
        <div><small>Market</small>${market.toFixed(2)}</div>
        <div><small>Term</small>{years.toFixed(years % 1 ? 1 : 0)} yr</div>
        <div><small>TI</small>${loi.tiPsf.toFixed(0)}/sf</div>
        <div><small>Free rent</small>{loi.freeM} mo</div>
        <div><small>Rent / yr</small>{usd(loi.rentPsf * loi.sf)}</div>
        <div><small>To sign</small>{usd(cost)}</div>
      </div>
      <div className="ls-bar" title="Their rent against the market rent for this space">
        <i style={{ width: `${Math.max(4, Math.min(100, (loi.rentPsf / Math.max(market, 0.01)) * 66))}%` }} className={tone} />
        <span style={{ left: "66%" }} />
      </div>
      {said ? (
        <div className={"ls-said " + (said.ok ? "pos" : "neg")}>{said.text}</div>
      ) : countering ? (
        <LoiCounterDraft loi={loi} market={market} feeRate={fee} fundShort={short > 0}
          onSend={(c) => { const r = useStore.getState().respondLoi(loi.id, "counter", short > 0, c); if (r.msg) setSaid({ text: r.msg, ok: r.ok }); setCountering(false); }}
          onBack={() => setCountering(false)} />
      ) : (
        <div className="ls-acts">
          <span className="nx-dim mono">answer by {monthLabel(loi.expiresM - 1)}{short > 0 ? ` · draws ${usd(short)} on the line` : ""}</span>
          <button type="button" className="btn" onClick={() => respond("decline")}>Decline</button>
          <button type="button" className="btn" onClick={() => setCountering(true)}>Counter</button>
          <button type="button" className="btn btn-buy" onClick={() => respond("accept")}>Sign</button>
        </div>
      )}
    </div>
  );
}

export function LeasingOffers() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const lois = [...game.lois].filter((l) => !game.holdings[l.bbl]?.groundLeased).sort((a, b) => a.expiresM - b.expiresM);
  const sf = lois.reduce((a, l) => a + l.sf, 0);
  const rent = lois.reduce((a, l) => a + l.sf * l.rentPsf, 0);
  return (
    <div className="nx-place">
      <StatStrip>
        <Stat label="Letters"><Figure value={lois.length} fmt="n" /></Stat>
        <Stat label="Space asked"><Figure value={sf} fmt="n" text={`${Math.round(sf).toLocaleString()} sf`} /></Stat>
        <Stat label="Rent / yr"><Figure value={rent} fmt="usd" /></Stat>
      </StatStrip>
      {lois.length === 0 && <div className="nx-none">No letters on the desk. Tenants write when you have space and the asking rent is right — see Vacancy.</div>}
      <div className="ls-cards">
        {lois.map((l) => <OfferCard key={l.id} game={game} parcels={parcels} loi={l} />)}
      </div>
    </div>
  );
}

interface RollRow { key: string; bbl: string; addr: string; name: string; sf: number; rent: number; mkt: number; endM: number; idx: number }

export function LeasingExpiring() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const rows = useMemo(() => {
    const out: RollRow[] = [];
    for (const h of Object.values(game.holdings)) {
      const rec = resolveRec(parcels, game, h.bbl);
      if (!rec) continue;
      const mkt = marketRentPsfYr(rec, game.econ, h.condition ?? initialCondition(rec));
      h.tenants.forEach((t, i) => {
        if (t.endM - game.month > 36) return;
        out.push({ key: `${h.bbl}:${i}`, bbl: h.bbl, addr: rec.address || h.bbl, name: t.name, sf: t.sf, rent: t.rentPsf, mkt, endM: t.endM, idx: i });
      });
    }
    return out;
  }, [game, parcels]);
  const cols: Col<RollRow>[] = [
    { id: "name", label: "Tenant", get: (r) => r.name, cell: (r) => <span className="nx-strong-cell">{r.name}</span> },
    { id: "addr", label: "Building", get: (r) => r.addr },
    { id: "sf", label: "sf", get: (r) => r.sf, fmt: "n" },
    { id: "rent", label: "$/sf", get: (r) => r.rent, fmt: "psf" },
    { id: "vs", label: "vs mkt", get: (r) => (r.mkt > 0 ? r.rent / r.mkt - 1 : null), fmt: "pct", tone: (r) => (r.rent > r.mkt ? "neg" : "pos") },
    { id: "end", label: "Ends", get: (r) => r.endM, cell: (r) => <span className="mono">{monthLabel(r.endM)}</span>, tone: (r) => (r.endM - game.month <= 12 ? "neg" : undefined) },
    { id: "left", label: "Months", get: (r) => r.endM - game.month, fmt: "n" },
  ];
  const sf12 = rows.filter((r) => r.endM - game.month <= 12).reduce((a, r) => a + r.sf, 0);
  return (
    <div className="nx-place">
      <StatStrip>
        <Stat label="Leases rolling 3y"><Figure value={rows.length} fmt="n" /></Stat>
        <Stat label="sf in 12m"><Figure value={sf12} fmt="n" tone={sf12 > 0 ? "neg" : undefined} /></Stat>
      </StatStrip>
      <DataTable id="leasing-roll" cols={cols} rows={rows} rowKey={(r) => r.key} initialSort={{ col: "end", dir: 1 }} empty="Nothing rolls in the next three years"
        onRow={(r) => sel(r.bbl)}
        actions={(r) => <button type="button" className="btn" onClick={(e) => { e.stopPropagation(); useStore.getState().extendLease(r.bbl, r.idx); }}>Blend &amp; extend</button>} />
    </div>
  );
}

export function LeasingVacancy() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const bldgs = Object.values(game.holdings).flatMap((h) => {
    const rec = resolveRec(parcels, game, h.bbl);
    if (!rec || !rec.bldgArea || h.groundLeased || game.developments[h.bbl]) return [];
    return [{ h, rec, vac: vacantSf(rec, h), occ: occupancyRead(rec, h).lettableOcc, mkt: marketRentPsfYr(rec, game.econ, h.condition ?? initialCondition(rec)) }];
  }).sort((a, b) => b.rec.bldgArea - a.rec.bldgArea);   // biggest building first (owner)
  return (
    <div className="nx-place">
      {bldgs.length === 0 && <div className="nx-none">No leasable buildings yet.</div>}
      {bldgs.map(({ h, rec, vac, occ, mkt }) => (
        <div className="ls-vac" key={h.bbl}>
          <div className="ls-vac-head">
            <a onClick={() => sel(h.bbl)}><b>{rec.address || h.bbl}</b></a>
            <span className="nx-dim">{rec.class}</span>
            <span><small>Occ</small> {fmtFig(occ, "pct")}</span>
            <span><small>Vacant</small> {Math.round(vac).toLocaleString()} sf</span>
            <span><small>Market</small> ${mkt.toFixed(2)}</span>
          </div>
          <LeasingPlan h={h} bbl={h.bbl} />
        </div>
      ))}
    </div>
  );
}
