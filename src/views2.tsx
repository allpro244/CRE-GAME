import { useMemo, useState } from 'react';
import * as E from './engine';
import type { GameState, Listing, Asset, DevChoice, PType, LOI } from './engine';
import { Portrait, mapSeed } from './portrait';

// signage feed: the biggest names on the rent roll, street-front uses first
function signTenants(tenants: E.Tenant[] | undefined): { name: string; sf: number }[] | undefined {
  if (!tenants?.length) return undefined;
  return [...tenants]
    .sort((a, b) => (a.use === 'retail' ? -1 : 0) - (b.use === 'retail' ? -1 : 0) || b.sf - a.sf)
    .slice(0, 8).map(t => ({ name: t.name, sf: t.sf }));
}

export const pct = (v: number, d = 0) => (v * 100).toFixed(d) + '%';
export const blockName = (t: { x: number; y: number }) => `${String.fromCharCode(65 + t.x)}-${t.y + 1}`;

export function Modal({ children, close, wide, variant = 'dialog' }: {
  children: any; close: () => void; wide?: boolean; variant?: 'dialog' | 'drawer';
}) {
  const drawer = variant === 'drawer';
  return (
    <div className={'modal-back' + (drawer ? ' drawer' : '') + (drawer && wide ? ' wide' : '')}
      onClick={e => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal" style={!drawer && wide ? { maxWidth: 780 } : undefined}>{children}</div>
    </div>
  );
}
export function Hint({ text }: { text: string }) { return <span className="tooltip-hint" title={text}>ⓘ</span>; }

export function RentRollTable({ state, tenants, sf, retailOf }: {
  state: GameState; tenants: E.Tenant[]; sf: number;
  retailOf?: { tileI: number; quality: number };
}) {
  if (tenants.length === 0) return <div className="dim" style={{ fontSize: 12, padding: '6px 0' }}>Vacant — no tenants in place.</div>;
  const sorted = [...tenants].sort((a, b) => b.sf - a.sf);
  const hasUse = tenants.some(t => t.use);
  const USE_TAG: Record<string, string> = { office: 'OFF', retail: 'RET', multifamily: 'RES', industrial: 'IND', mixed: '' };
  return (
    <table className="sc">
      <thead><tr><th>Tenant</th>{hasUse && <th>Use</th>}<th>SF</th><th>Rate</th><th>Base rent /mo</th>
        {retailOf && <th>Sales /SF <Hint text="Estimated gross sales. Past the breakpoint (market rent ÷ a 9% occupancy-cost norm) you collect 6% of sales as percentage rent. Overage means the trade is outrunning the rents — draw your own conclusion." /></th>}
        {retailOf && <th>Overage /mo</th>}
        <th>Esc</th><th>Term ends</th><th>Credit <Hint text="A-credit tenants almost never miss rent. C-credit tenants are where vacancies come from — especially in recessions." /></th></tr></thead>
      <tbody>
        {sorted.map(t => {
          const sales = retailOf ? E.tenantSalesPSF(state, retailOf, t) : 0;
          const over = retailOf ? Math.max(0, sales - E.retailBreakpointPSF(state, retailOf.tileI)) * E.PCT_RENT_RATE * t.sf / 12 : 0;
          return (
            <tr key={t.id}>
              <td>{t.name}</td>
              {hasUse && <td><span className="faint" style={{ fontSize: 10 }}>{t.use ? USE_TAG[t.use] : '—'}</span></td>}
              <td className="num">{(t.sf / 1000).toFixed(1)}K <span className="faint">({pct(t.sf / sf)})</span></td>
              <td className="num">${t.rate.toFixed(2)}</td>
              <td className="num">{E.fmtMoney(t.sf * t.rate / 12)}</td>
              {retailOf && <td className="num">${sales.toFixed(0)}</td>}
              {retailOf && <td className={'num ' + (over > 0 ? 'pos' : 'faint')}>{over > 0 ? '+' + E.fmtMoney(over) : '—'}</td>}
              <td className="num">{(t.escPct ?? 3).toFixed(1)}%{t.optionRate !== undefined && !t.optionUsed ? <span className="amber" title={`Holds a renewal option: ${t.optionYears ?? 5} yrs at $${t.optionRate.toFixed(2)}/SF — exercised only if the market runs past it`}> ⚙</span> : ''}</td>
              <td className="num">{E.monthName(t.endM)}{t.endM - state.month <= 6 ? <span className="amber"> ⚠</span> : ''}</td>
              <td><span className={'chip credit-' + t.credit}>{E.CREDIT_LABEL[t.credit]}</span></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ---------- Deals view (with off-market) ----------
// ---------- The whole book, one wire ----------
function BulkDealPanel({ state, setState }: { state: GameState; setState: (s: GameState) => void }) {
  const [err, setErr] = useState<string | null>(null);
  const bd = state.bulkDeal;
  if (!bd) return null;
  const held = bd.stockIds.map(id => state.stock.find(b => b.id === id)).filter((b): b is E.StockBuilding => !!b && b.owner === bd.short);
  const totVal = held.reduce((x, b) => x + E.stockValue(state, b), 0);
  const totSF = held.reduce((x, b) => x + b.sf, 0);
  const costs = 25_000 + held.length * 5_000;
  const rate = state.econ.rate + 4.25;
  const bridge = Math.round(bd.price * 0.55);
  return (
    <div className="panel" style={{ marginBottom: 14, borderColor: 'var(--amber)' }}>
      <h3>The {bd.name} book — one wire buys everything</h3>
      <div className="dim" style={{ fontSize: 12, marginBottom: 8 }}>
        The lender's special-situations desk wants ONE closing. {held.length} buildings, {(totSF / 1000).toFixed(0)}K SF,
        marked at {E.fmtMoney(totVal)} — yours for <b style={{ color: 'var(--ink)' }}>{E.fmtMoney(bd.price)}</b> ({Math.round(bd.price / Math.max(1, totVal) * 100)}% of the marks).
        Window closes {E.monthName(bd.expiresM)}; a rival may take it whole. As-is, tenants and problems included.
      </div>
      <table className="sc" style={{ marginBottom: 8 }}>
        <thead><tr><th>Building</th><th>SF</th><th>Occ</th><th>Quality</th><th>Marked at</th></tr></thead>
        <tbody>
          {held.map(b => (
            <tr key={b.id}>
              <td>Block {blockName(state.tiles[b.tileI])} — {E.PLABEL[b.type]}</td>
              <td className="num">{(b.sf / 1000).toFixed(0)}K</td>
              <td className="num">{pct(b.occ)}</td>
              <td className="num">{E.QLABEL[E.qGrade(b.quality)]} · {Math.round(b.quality)}</td>
              <td className="num">{E.fmtMoney(E.stockValue(state, b))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {err && <div className="alert-strip red" style={{ marginBottom: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <button className="btn btn-amber" disabled={state.cash < bd.price + costs}
          onClick={() => { const r = E.acceptBulkDeal(state, false); if (r.err) setErr(r.err); else setState(r.s); }}>
          All cash — {E.fmtMoney(bd.price + costs)}</button>
        <button className="btn btn-amber" disabled={state.cash < bd.price - bridge + costs}
          title={`Ironbridge fronts 55% (${E.fmtMoney(bridge)}) at ${rate.toFixed(1)}%, 24-month interest-only — refinance building by building once they perform`}
          onClick={() => { const r = E.acceptBulkDeal(state, true); if (r.err) setErr(r.err); else setState(r.s); }}>
          Ironbridge bridge — {E.fmtMoney(bd.price - bridge + costs)} cash</button>
      </div>
    </div>
  );
}
// ---------- The courthouse steps ----------
function AuctionPanel({ state, setState }: { state: GameState; setState: (s: GameState) => void }) {
  const [bids, setBids] = useState<Record<number, number>>({});
  const [hard, setHard] = useState<Record<number, boolean>>({});
  const [msg, setMsg] = useState<string | null>(null);
  if (!state.auctions?.length) return null;
  return (
    <div className="panel" style={{ marginBottom: 14, borderColor: 'var(--red)' }}>
      <h3>Foreclosure auction — the courthouse steps</h3>
      <div className="dim" style={{ fontSize: 12, marginBottom: 8 }}>
        As-is, where-is. Cash on the barrel — or Ironbridge hard money at 60% LTV, base +4%, a 24-month clock. Clear the deepest pocket in the room and it's yours on the spot.
      </div>
      {state.auctions.map(au => {
        const b = state.stock.find(x => x.id === au.stockId);
        if (!b) return null;
        const t = state.tiles[au.tileI];
        const val = E.stockValue(state, b);
        const floor = Math.max(au.reserve, Math.round(au.bid * 1.03));
        const myBid = bids[au.id] ?? floor;
        const hm = hard[au.id] ?? false;
        return (
          <div key={au.id} className="memo" style={{ borderLeftColor: 'var(--red)' }}>
            <div className="memo-row"><span className="lbl"><b style={{ color: 'var(--ink)' }}>{(b.sf / 1000).toFixed(0)}K SF {E.PLABEL[b.type]}</b> at block {blockName(t)} · {E.QLABEL[E.qGrade(b.quality)]}-grade · {Math.round(b.occ * 100)}% occupied · {au.source}</span>
              <span className="num dim">appraisal ~{E.fmtMoney(val)}</span></div>
            <div className="memo-row"><span className="lbl">Reserve {E.fmtMoney(au.reserve)} · {au.leader ? <span className="neg">current bid {E.fmtMoney(au.bid)} — {au.leader === 'you' ? 'you lead' : `${au.leader} leads`}</span> : 'no bids yet'} · gavel falls {E.monthName(au.endsM)}</span></div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
              <input type="number" step={25000} value={myBid} onChange={e => setBids({ ...bids, [au.id]: Number(e.target.value) })}
                style={{ width: 130, background: 'var(--panel3)', border: '1px solid var(--line)', color: 'var(--ink)', padding: '5px 8px', borderRadius: 4, fontFamily: 'var(--mono)', fontSize: 12 }} />
              <label style={{ fontSize: 11.5, display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={hm} onChange={e => setHard({ ...hard, [au.id]: e.target.checked })} />
                Hard money (40% down, base +4%)
              </label>
              <span className="faint" style={{ fontSize: 11 }}>settlement {E.fmtMoney(Math.round(myBid * (hm ? 0.4 : 1)) + 12000)} cash today</span>
              <button className="btn btn-amber btn-sm" onClick={() => {
                const r = E.placeAuctionBid(state, au.id, myBid, hm);
                setState(r.s);
                if (r.outcome === 'err') setMsg(r.err ?? null);
                else if (r.outcome === 'outbid') setMsg('The room answered — a paddle went up behind you. Raise or let it go.');
                else setMsg(null);
              }}>Bid {E.fmtMoney(myBid)}</button>
            </div>
          </div>
        );
      })}
      {msg && <div className="alert-strip" style={{ marginTop: 8 }}>{msg}</div>}
    </div>
  );
}

// ---------- Build-to-suit RFPs ----------
function BtsPanel({ state, setState }: { state: GameState; setState: (s: GameState) => void }) {
  const [pick, setPick] = useState<Record<number, number>>({});
  const [err, setErr] = useState<string | null>(null);
  if (!state.btsRfps?.length) return null;
  return (
    <div className="panel" style={{ marginBottom: 14, borderColor: 'var(--blue)' }}>
      <h3>Build-to-suit RFPs — the tenant brings the lease</h3>
      <div className="dim" style={{ fontSize: 12, marginBottom: 8 }}>
        A credit tenant wants a building with its name on it: 15 years NNN, above market, signed on delivery. You need zoned dirt that carries the program — and you need to deliver on time. Rivals are reading the same RFP.
      </div>
      {state.btsRfps.map(r => {
        const elig = E.btsEligibleHoldings(state, r);
        // a remembered pick can go stale (the holding sold or got built on) — fall back
        const sel = elig.some(e2 => e2.h.id === pick[r.id]) ? pick[r.id] : elig[0]?.h.id;
        const leaseYr = Math.round(r.sf * r.rate);
        return (
          <div key={r.id} className="memo" style={{ borderLeftColor: 'var(--blue)' }}>
            <div className="memo-row"><span className="lbl"><b style={{ color: 'var(--ink)' }}>{r.tenant}</b> ({E.CREDIT_LABEL[r.credit]} credit) — {(r.sf / 1000).toFixed(0)}K SF {E.PLABEL[r.type].toLowerCase()}</span>
              <span className="num pos">${r.rate.toFixed(2)}/SF · {E.fmtMoney(leaseYr)}/yr</span></div>
            <div className="memo-row"><span className="lbl">Deliver by <b className="num" style={{ color: 'var(--ink)' }}>{E.monthName(r.deliverBy)}</b> or eat {E.fmtMoney(r.penalty)} + 8% off the rent · respond by {E.monthName(r.respondBy)}</span></div>
            {elig.length === 0 ? (
              <div className="faint" style={{ fontSize: 11.5, marginTop: 4 }}>
                You hold no dirt that carries it — needs land zoned for {E.PLABEL[r.type].toLowerCase()} with ~{Math.ceil(r.sf / (E.FAR[r.type] * 43_560 * E.PARCEL_AC * 2))}+ parcels at typical density. Bank the site, then commit.
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                <select value={sel} onChange={e => setPick({ ...pick, [r.id]: Number(e.target.value) })}
                  style={{ background: 'var(--panel3)', border: '1px solid var(--line)', color: 'var(--ink)', padding: '5px 8px', borderRadius: 4, fontSize: 12 }}>
                  {elig.map(({ h, cells }) => (
                    <option key={h.id} value={h.id}>Block {blockName(state.tiles[h.tileI])} — {Math.round(cells * E.PARCEL_AC * 100) / 100} ac</option>
                  ))}
                </select>
                <button className="btn btn-amber btn-sm" onClick={() => {
                  const rr = E.commitBts(state, r.id, sel!);
                  if (rr.err) setErr(rr.err); else { setState(rr.s); setErr(null); }
                }}>Design &amp; commit</button>
                <span className="faint" style={{ fontSize: 11 }}>GMP, bonded, fixed-rate — the safe sheet. Standard dev equity rules apply.</span>
              </div>
            )}
          </div>
        );
      })}
      {err && <div className="alert-strip red" style={{ marginTop: 8 }}>{err}</div>}
    </div>
  );
}

export function DealsView2({ state, setState, openDeal }: {
  state: GameState; setState: (s: GameState) => void; openDeal: (id: number) => void;
}) {
  const [err, setErr] = useState<string | null>(null);
  const regular = state.listings.filter(l => l.kind !== 'offmarket' && !l.yourSale && !(l as any).omLead).sort((a, b) => a.price - b.price);
  const landLeads = state.listings.filter(l => (l as any).omLead);
  const mine = state.listings.filter(l => l.yourSale);
  const om = state.listings.filter(l => l.kind === 'offmarket');
  const scout = E.canScout(state);
  const cooldownLeft = E.CONFIG.scoutCooldown - (state.month - state.lastScoutMonth);
  return (
    <div>
      <BulkDealPanel state={state} setState={setState} />
      <AuctionPanel state={state} setState={setState} />
      <BtsPanel state={state} setState={setState} />
      <div className="panel" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <h3 style={{ marginBottom: 4 }}>Off-market canvass</h3>
            <div className="dim" style={{ fontSize: 12, lineHeight: 1.55 }}>
              Work your broker network to find owners who'd listen to a number — {E.fmtMoney(E.CONFIG.scoutCost)}, once a quarter.
              Most have delusional expectations. A few are quietly desperate. Lowball too hard and they hang up for good.
            </div>
          </div>
          <button className="btn btn-amber" disabled={!scout.ok}
            onClick={() => { const r = E.doScout(state); setState(r.s); }}>
            {scout.ok ? 'Canvass the market' : cooldownLeft > 0 && state.cash >= E.CONFIG.scoutCost ? `Network resting (${cooldownLeft} mo)` : 'Canvass the market'}
          </button>
        </div>
        {!scout.ok && state.cash < E.CONFIG.scoutCost && <div className="faint" style={{ fontSize: 11, marginTop: 6 }}>{scout.why}</div>}
        {landLeads.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="eyebrow" style={{ marginBottom: 4 }}>Land leads — owners who named a number</div>
            {landLeads.map(l => (
              <button key={l.id} className="inv-row inv-btn" onClick={() => openDeal(l.id)}>
                <span style={{ color: 'var(--amber)' }}>◈</span>
                <span style={{ flex: 1, textAlign: 'left' }}>{l.acres} ac at block {blockName(state.tiles[l.tileI])}
                  {l.agreed ? <span className="pos"> · price agreed</span> : ''}</span>
                <span className="num">{E.fmtMoney(l.price)} <span className="faint">to {E.monthName(l.expiresMonth)}</span></span>
              </button>
            ))}
          </div>
        )}
        {om.length > 0 && (
          <div className="deal-grid" style={{ marginTop: 12 }}>
            {om.map(l => {
              const t = state.tiles[l.tileI];
              return (
                <div key={l.id} className="deal-card" style={{ borderColor: l.agreed ? 'var(--green)' : 'var(--amber-dim)' }} onClick={() => openDeal(l.id)}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span className="chip chip-om">Off-market</span>
                    <span className="chip chip-type">{E.PLABEL[l.type!]}</span>
                    {l.agreed && <span className="chip chip-agreed">Price agreed ✓</span>}
                    <span style={{ flex: 1 }} />
                    <span className="faint" style={{ fontSize: 10.5 }}>Block {blockName(t)}</span>
                  </div>
                  <div className="deal-price num">{l.agreed ? E.fmtMoney(l.price) : l.noAsk ? 'No asking price' : `Asking ${E.fmtMoney(l.price)}`}</div>
                  <div className="dim" style={{ fontSize: 12 }}>
                    {((l.sf ?? 0) / 1000).toFixed(0)}K SF · {pct(l.occ ?? 0)} leased · {E.QLABEL[E.qGrade(l.quality ?? 75)]}-grade · {l.units} unit{(l.units ?? 1) > 1 ? 's' : ''}
                    {!l.noAsk && l.price > 0 ? <span className="num"> · {(E.inPlaceNOIYr(state, l) / l.price * 100).toFixed(1)}% cap at their ask</span> : ''}
                  </div>
                  <div className="faint" style={{ fontSize: 10.5 }}>
                    {l.agreed ? `Close by ${E.monthName(l.expiresMonth)} or they walk` : `Their patience is theirs to know · gone by ${E.monthName(l.expiresMonth)}`}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {mine.length > 0 && (
        <div className="panel" style={{ marginBottom: 14, borderColor: 'var(--amber-dim)' }}>
          <h3>Your listings</h3>
          {mine.map(l => {
            const a = state.assets.find(x => x.forSale?.listingId === l.id);
            const offers = a ? state.saleOffers.filter(o => o.assetId === a.id).length : 0;
            return (
              <div key={l.id} className="dim" style={{ fontSize: 12.5, padding: '4px 0' }}>
                ◆ {a?.name ?? 'Your property'} — asking {E.fmtMoney(l.price)} · on market {state.month - (l.listMonth ?? state.month)} mo ·
                {offers > 0 ? <span className="pos"> {offers} live offer{offers > 1 ? 's' : ''} — respond in Portfolio</span> : ' waiting on the phone'}
              </div>
            );
          })}
        </div>
      )}
      <div className="dim" style={{ fontSize: 12.5, marginBottom: 8 }}>
        {regular.length} public listings — an index, not a workroom. Click a row and the map takes you there.
        Rivals shop this same marketplace; <span style={{ color: '#e08c8c' }}>hot</span> listings won't wait.
      </div>
      {err && <div className="alert-strip red"><span>{err}</span><button className="btn btn-sm" onClick={() => setErr(null)}>✕</button></div>}
      <DealIndex state={state} listings={regular} openDeal={openDeal} />
    </div>
  );
}

// The board as a broker's sheet: every listing, sortable by the numbers that matter,
// each row flying you to the building on the map.
function DealIndex({ state, listings, openDeal }: {
  state: GameState; listings: Listing[]; openDeal: (id: number) => void;
}) {
  const [sort, setSort] = useState<{ by: string; asc: boolean }>({ by: 'cap', asc: false });
  const rate = state.econ.rate + E.CONFIG.acqSpread;
  const rows = listings.map(l => {
    const t = state.tiles[l.tileI];
    if (l.kind === 'land') {
      const bestFit = E.PTYPES.map(ty => ({ ty, f: E.tileDemandFactor(state, t, ty) })).sort((a, b) => b.f - a.f)[0];
      return { l, t, land: true, psf: l.price / Math.max(1, (l.acres ?? 0.25) * 43_560), cap: null as number | null, noi: null as number | null, q: null as number | null, note: `${l.acres} ac · ${E.PLABEL[bestFit.ty]} ${bestFit.f > 1.1 ? 'strong' : bestFit.f > 0.85 ? 'fair' : 'weak'}` };
    }
    const pf = E.proFormaBuilding(state, l);
    return { l, t, land: false, psf: (l.price) / Math.max(1, l.sf ?? 1), cap: pf.capNow, noi: pf.noiNow, q: l.quality ?? null, note: `${pct(l.occ ?? 0)} leased · ${l.age} yrs` };
  });
  const dir = sort.asc ? 1 : -1;
  const val = (r: typeof rows[0]): number => {
    if (sort.by === 'price') return r.l.price;
    if (sort.by === 'sf') return r.l.kind === 'land' ? (r.l.acres ?? 0) * 43560 * 0.001 : (r.l.sf ?? 0);
    if (sort.by === 'psf') return r.psf ?? -1;
    if (sort.by === 'noi') return r.noi ?? -1e18;
    if (sort.by === 'q') return r.q ?? -1;
    return r.cap ?? -1;
  };
  rows.sort((a, b) => (val(a) - val(b)) * dir);
  const Th = ({ id, label, right = true }: { id: string; label: string; right?: boolean }) => (
    <th style={{ cursor: 'pointer', textAlign: right ? 'right' : 'left', userSelect: 'none' }}
      onClick={() => setSort(s => ({ by: id, asc: s.by === id ? !s.asc : false }))}>
      {label}{sort.by === id ? (sort.asc ? ' ▴' : ' ▾') : ''}
    </th>
  );
  return (
    <div className="panel" style={{ padding: '6px 10px' }}>
      <table className="sc">
        <thead><tr>
          <th style={{ textAlign: 'left' }}>Type</th><th style={{ textAlign: 'left' }}>Property</th><th style={{ textAlign: 'left' }}>Block</th>
          <th style={{ textAlign: 'left' }}>Zoned</th>
          <Th id="price" label="Price" /><Th id="sf" label="SF" /><Th id="psf" label="$/SF" />
          <th>Units · leased</th>
          <Th id="q" label="Quality" />
          <Th id="cap" label="Cap" /><Th id="noi" label="NOI /yr" />
          <th style={{ textAlign: 'left' }}>Notes</th>
        </tr></thead>
        <tbody>
          {rows.map(({ l, t, land, psf, cap, noi, q, note }) => (
            <tr key={l.id} onClick={() => openDeal(l.id)} style={{ cursor: 'pointer' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--panel2)')}
              onMouseLeave={e => (e.currentTarget.style.background = '')}>
              <td>
                {land ? <span className="chip chip-land">Land</span> : <span className="chip chip-type">{E.PLABEL[l.type!]}</span>}
                {l.distressed && <span className="chip chip-distress" style={{ marginLeft: 4 }}>D</span>}
                {l.hot && <span className="chip chip-hot" style={{ marginLeft: 4 }}>Hot</span>}
                {l.rivalEye && <span className="chip chip-distress" style={{ marginLeft: 4 }} title={`${state.firms.find(f => f.short === l.rivalEye)?.name ?? 'A rival'} is circling — they close within the month`}>⚔</span>}
              </td>
              <td style={{ textAlign: 'left', fontSize: 11.5 }}>{(() => {
                if (land) return <span className="dim">{(l as any).omLead ? 'Off-market dirt' : 'Listed land'}</span>;
                const stk = l.stockId !== undefined ? state.stock.find(sb => sb.id === l.stockId) : undefined;
                return stk ? E.stockName(state, stk) : <span className="dim">—</span>;
              })()}</td>
              <td className="num dim">{blockName(t)} <span className="faint" style={{ fontSize: 9 }}>▸ map</span></td>
              <td className="num dim">{E.zoneCode(t.zone)}</td>
              <td className="num">{E.fmtMoney(l.price)}</td>
              <td className="num">{land ? `${l.acres} ac` : `${((l.sf ?? 0) / 1000).toFixed(0)}K`}</td>
              <td className="num">{psf !== null ? '$' + psf.toFixed(0) : '—'}</td>
              <td className="num dim">{land ? '—' : `${l.units ?? 1} · ${pct(l.occ ?? 0)}`}</td>
              <td className="num dim">{q !== null ? `${Math.round(q)} · ${E.QLABEL[E.qGrade(q)]}` : '—'}</td>
              <td className={'num ' + (cap !== null && cap > rate ? 'pos' : 'dim')}>{cap !== null ? cap.toFixed(2) + '%' : '—'}</td>
              <td className={'num ' + (noi === null ? 'dim' : noi >= 0 ? 'pos' : 'neg')}>{noi !== null ? E.fmtMoney(noi) : '—'}</td>
              <td className="dim" style={{ textAlign: 'left', fontSize: 11 }}>{note}{l.feasDone ? ' · feas ✓' : ''}{l.declinedYou ? <span className="neg"> · won't deal</span> : ''} <span className="faint">to {E.monthName(l.expiresMonth)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="faint" style={{ fontSize: 10.5, margin: '6px 2px' }}>
        Cap and NOI are underwritten on the in-place rent roll at the asking price. Your offer changes the cap, not the NOI — that negotiation happens on the map.
      </div>
    </div>
  );
}

// ---------- Deal modal (building / off-market / land) ----------
export function DealModal({ state, listing, setState, close, variant = 'dialog', onNotice }: {
  state: GameState; listing: Listing; setState: (s: GameState) => void; close: () => void;
  variant?: 'dialog' | 'drawer';
  onNotice?: (msg: string) => void;
}) {
  const t = state.tiles[listing.tileI];
  const [err, setErr] = useState<string | null>(null);
  const [downPct, setDownPct] = useState(0.35);
  const [lenderPick, setLenderPick] = useState<string | null>(null);
  const [offerAmt, setOfferAmt] = useState(() => listing.kind === 'land' ? 0
    : Math.round(((listing.kind === 'offmarket' && listing.noAsk) ? E.proFormaBuilding(state, { ...listing, price: 1 }).stabValue * 0.8 : listing.price) / 10000) * 10000);
  const [omMsg, setOmMsg] = useState<string | null>(listing.counterAt ? `They countered at ${E.fmtMoney(listing.counterAt)}. Meet it, beat it, or walk.` : null);
  const [omOk, setOmOk] = useState(false);   // green when the seller just said yes
  const [landFin, setLandFin] = useState(false);   // finance the dirt with a land loan
  const [useJV, setUseJV] = useState(false);
  const firstConstr = CONSTR0(listing, state);
  const [dev, setDev] = useState<DevChoice>(() => ({
    type: firstConstr.type, sf: Math.min(10000, E.maxBuildableSF(state, listing, firstConstr.type) || 10000),
    units: defaultUnits(firstConstr.type, firstConstr.construction, 10000),
    construction: firstConstr.construction,
    contractor: 'standard', contingencyPct: 0.10, expedited: false, downPct: 0.35, fixedRate: false,
    contractType: 'costplus', bonded: false, designTier: 'std', recourse: false,
  }));

  const runFeas = () => {
    if (state.cash < E.CONFIG.feasCost) { setErr(`Feasibility costs ${E.fmtMoney(E.CONFIG.feasCost)} — you don't have it.`); return; }
    setState(E.doFeasibility(state, listing.id)); setErr(null);
  };

  if (listing.yourSale) {
    const a = state.assets.find(x => x.forSale?.listingId === listing.id);
    return (
      <Modal close={close} variant={variant}>
        <h2>Your listing — {a?.name ?? 'your property'}</h2>
        <div className="sub">Asking {E.fmtMoney(listing.price)}. Offers arrive over time and land in your Portfolio; the market decides how patient you get to be.</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn" onClick={close}>Close</button></div>
      </Modal>
    );
  }
  if (listing.kind !== 'land') {
    const priced = listing.kind === 'offmarket' && !listing.agreed ? { ...listing, price: Math.max(1, listing.price) } : listing;
    const pf = E.proFormaBuilding(state, priced);
    const canBuy = (listing.kind === 'building' && !listing.declinedYou) || listing.agreed;
    const isMF = listing.type === 'multifamily';
    // the whole memo tracks the number you're actually offering, not the sticker
    // the whole memo — underwriting AND financing — tracks the number you're actually
    // offering; when nothing is agreed the buy button still executes at the ask, and
    // says so, but the term sheets move with your number as you haggle
    const effPrice = listing.agreed ? listing.price : (offerAmt > 0 ? offerAmt : listing.price);
    const capEff = effPrice > 0 ? (pf.noiNow / effPrice) * 100 : 0;
    const txPrice = listing.price;   // what the buy button pays today
    const quotes = E.lenderQuotesFor(state, { price: effPrice, type: listing.type!, quality: listing.quality ?? 75 });
    const bestQuote = quotes.filter(q2 => q2.ok).sort((x, y) => x.ratePct - y.ratePct)[0] ?? null;
    const selQuote = quotes.find(q2 => q2.lenderId === lenderPick && q2.ok) ?? bestQuote;
    const ltvMax = Math.min(E.maxLTV(state, listing.type) + 0.1, selQuote ? selQuote.maxLTV : E.maxLTV(state, listing.type));
    const dpEff = Math.max(downPct, 1 - ltvMax);   // the desk's minimum equity binds the math, not just the slider
    const loan = effPrice * (1 - dpEff);
    const rate = state.econ.rate + E.CONFIG.acqSpread;
    const pmt = E.monthlyPayment(loan, rate, E.CONFIG.acqAmortYears);
    const dscr = loan > 0 ? pf.noiNow / (pmt * 12) : null;
    const cashNeeded = effPrice * dpEff + 15000;
    const jvOk = E.canJV(state, effPrice * dpEff).ok;
    const sketch = { type: listing.type!, construction: listing.construction ?? E.CONSTR[listing.type!][0].id, sf: listing.sf!, units: listing.units ?? 1, quality: listing.quality ?? 75 };
    return (
      <Modal close={close} wide variant={variant}>
        <h2>{(() => {
          const stk = listing.stockId !== undefined ? state.stock.find(sb => sb.id === listing.stockId) : undefined;
          return stk ? E.stockName(state, stk) : `${E.PLABEL[listing.type!]} — Block ${blockName(t)}`;
        })()} {listing.kind === 'offmarket' && <span className="chip chip-om" style={{ verticalAlign: 'middle' }}>Off-market</span>}</h2>
        <div className="sub">
          {((listing.sf ?? 0) / 1000).toFixed(0)}K SF on {listing.acres} acres · {listing.units} unit{(listing.units ?? 1) > 1 ? 's' : ''} · {E.QLABEL[E.qGrade(listing.quality ?? 75)]}-grade {E.constrSpec(sketch).label.toLowerCase()} · built {2026 - (listing.age ?? 10)}
          {listing.distressed && <span className="amber"> · distressed — priced to move</span>}
        </div>
        <Portrait b={{ ...sketch, age: listing.age, occ: listing.occ, seed: mapSeed(state.seed, listing.tileI),
          siteCells: Math.max(1, Math.round((listing.acres ?? E.PARCEL_AC) / E.PARCEL_AC)), tenants: signTenants(listing.tenants) }} w={460} h={200} />
        {listing.type === 'mixed' && (() => {
          const m = listing.mix ?? E.defaultMixSplit(state.seed, listing.stockId ?? listing.id);
          const sfOf = (f: number) => Math.round(listing.sf! * f / 100) * 100;
          return (
            <div className="dim" style={{ fontSize: 12, margin: '2px 0 8px' }}>
              Program: <b className="num" style={{ color: 'var(--ink)' }}>{(sfOf(m.retail) / 1000).toFixed(1)}K SF</b> retail
              · <b className="num" style={{ color: 'var(--ink)' }}>{(sfOf(m.office) / 1000).toFixed(1)}K SF</b> office
              · <b className="num" style={{ color: 'var(--ink)' }}>{(sfOf(m.multifamily) / 1000).toFixed(1)}K SF</b> homes (~{Math.round(sfOf(m.multifamily) / 950)} apartments)
              <Hint text="A mixed building is its components. Each slice earns its own market's rent, leases through its own channel, and counts in its own sector's vacancy." />
            </div>
          );
        })()}
        {(listing as any).rivalBid && (
          <div className="alert-strip red" style={{ marginBottom: 10 }}>
            <span>⚔ <b>{(listing as any).rivalName}</b> bid {E.fmtMoney((listing as any).rivalBid)} on your agreed deal. Match by month's end or lose it.</span>
            <button className="btn btn-sm btn-amber" onClick={() => { const r = E.matchRivalBid(state, listing.id); if (!r.err) setState(r.s); }}>Match {E.fmtMoney((listing as any).rivalBid)}</button>
          </div>
        )}
        {listing.declinedYou && (
          <div className="alert-strip red" style={{ marginBottom: 10 }}>This seller won't deal with you after your last offer. Brokers talk.</div>
        )}
        {listing.rivalEye && !listing.agreed && (
          <div className="alert-strip red" style={{ marginBottom: 10 }}>
            ⚔ <b>{state.firms.find(f => f.short === listing.rivalEye)?.name ?? 'A rival'}</b> is circling this one — they close within the month if you don't.
          </div>
        )}
        {!listing.agreed && !listing.declinedYou && (
          <div className="memo" style={{ borderLeftColor: 'var(--amber)' }}>
            <div className="memo-row"><span className="lbl">{listing.kind === 'offmarket' ? (listing.noAsk ? 'Seller named no price — open with a number' : `Seller's ask`) : 'Asking price — or negotiate below it'}</span>
              <b className="num">{listing.kind === 'offmarket' && listing.noAsk ? '—' : E.fmtMoney(listing.price, false)}</b></div>
            {omMsg && <div style={{ fontSize: 12, color: omOk ? 'var(--green)' : 'var(--amber)', padding: '4px 0', fontWeight: omOk ? 700 : 400 }}>{omMsg}</div>}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
              <button className="btn btn-sm" onClick={() => setOfferAmt(v => Math.max(0, v - 100_000))}>−100K</button>
              <button className="btn btn-sm" onClick={() => setOfferAmt(v => Math.max(0, v - 10_000))}>−10K</button>
              <input type="number" step={10000} value={offerAmt} onChange={e => setOfferAmt(Number(e.target.value))}
                style={{ flex: 1, background: 'var(--panel3)', border: '1px solid var(--line)', color: 'var(--ink)', padding: '7px 10px', borderRadius: 4, fontFamily: 'var(--mono)', fontSize: 13 }} />
              <button className="btn btn-sm" onClick={() => setOfferAmt(v => v + 10_000)}>+10K</button>
              <button className="btn btn-sm" onClick={() => setOfferAmt(v => v + 100_000)}>+100K</button>
              <button className="btn btn-amber" onClick={() => {
                if (offerAmt < 10_000) { setOmOk(false); setOmMsg('Offers start at $10K — the broker won\'t dial for less.'); return; }
                const r = E.makeOffer(state, listing.id, offerAmt);
                setState(r.s);
                if (r.result === 'accepted') { setOmOk(true); setOmMsg(`✓ SELLER AGREED at ${E.fmtMoney(offerAmt)} — paper it before they change their mind.`); }
                else if (r.result === 'countered') { setOmOk(false); setOmMsg(`They countered at ${E.fmtMoney(r.counter!)} — that's their ask now. Meet it, beat it, or walk.`); setOfferAmt(r.counter!); }
                else if (r.result === 'declined') { onNotice?.(r.msg ?? 'The seller declined and ended the conversation.'); close(); }
              }}>Offer {E.fmtMoney(offerAmt)}</button>
            </div>
            <div className="faint" style={{ fontSize: 10.5, marginTop: 6 }}>
              {listing.offersLeft} offer{(listing.offersLeft ?? 0) === 1 ? '' : 's'} before they lose interest. Insult them and they {listing.kind === 'offmarket' ? "hang up for good" : "won't deal with you — and your reputation takes the hit"}.
            </div>
          </div>
        )}
        <div className="memo">
          <div className="memo-row"><span className="lbl">{listing.agreed ? 'Agreed price' : 'Underwriting basis (your offer)'}</span><b className="num">{E.fmtMoney(effPrice, false)}</b></div>
          {!listing.agreed && effPrice !== listing.price && listing.price > 0 && <div className="memo-row"><span className="lbl faint">Their current ask</span><span className="num dim">{E.fmtMoney(listing.price, false)}</span></div>}
          <div className="memo-row"><span className="lbl">In-place NOI (actual rent roll)</span><span className="num">{E.fmtMoney(pf.noiNow)}/yr</span></div>
          {canBuy && <div className="memo-row"><span className="lbl">Going-in cap rate at {listing.agreed ? 'agreed price' : 'your offer'} <Hint text="Year-one NOI from the actual leases divided by what you'd pay. Compare to your borrowing cost." /></span>
            <span className={'num ' + (capEff > rate ? 'pos' : 'neg')}>{capEff.toFixed(2)}%</span></div>}
          {pf.noiNow > pf.noiStab * 1.2 && (
            <div className="alert-strip" style={{ margin: '6px 0', fontSize: 11.5 }}>
              ⚠ OVER-RENTED: the in-place roll runs ~{Math.round((pf.noiNow / Math.max(1, pf.noiStab) - 1) * 100)}% above what this market now supports.
              That fat going-in cap is borrowed from the future — every expiring lease rolls DOWN toward market. Underwrite the stabilized number, not year one.
            </div>
          )}
          {pf.noiStab > pf.noiNow * 1.35 && (listing.occ ?? 0) > 0.6 && (
            <div className="alert-strip" style={{ margin: '6px 0', fontSize: 11.5, borderColor: 'var(--green)' }}>
              Under-rented: leases sit well below today's market — rollover is your friend here, if you can carry it that long.
            </div>
          )}
          {listing.feasDone ? (<>
            <div className="memo-row"><span className="lbl">Stabilized NOI (at ~{pct(pf.tOcc)}, market rents)</span><span className="num">{E.fmtMoney(pf.noiStab)}/yr</span></div>
            <div className="memo-row"><span className="lbl">Market cap rate for this block/grade</span><span className="num">{pf.cap.toFixed(2)}%</span></div>
            <div className="memo-row"><span className="lbl">Weighted avg lease term</span><span className="num">{pf.walt.toFixed(1)} yrs</span></div>
            {canBuy && (() => {
              const half = E.appraisalHalfPts(state, listing.type!, listing.quality ?? 75, pf.tOcc);
              const sLo = pf.stabValue * pf.cap / (pf.cap + half), sHi = pf.stabValue * pf.cap / Math.max(3, pf.cap - half);
              return (
                <div className="memo-row total"><span className="lbl">Stabilized value — a range, not a fact <Hint text="What a room of appraisers would sign once stabilized. Appraisals scatter — the spread is where deals are found and lost. Tightest above 80% leased with fresh comps in an open market." /></span>
                  <span className={'num ' + (pf.upside > 0 ? 'pos' : 'neg')}>{E.fmtMoney(sLo)} – {E.fmtMoney(sHi)} <span className="faint">(mid {pf.upside >= 0 ? '+' : ''}{E.fmtMoney(pf.upside)} vs. price)</span></span></div>
              );
            })()}
          </>) : (
            <div className="memo-row"><span className="lbl">Stabilized value, upside & full rent roll</span>
              <button className="btn btn-sm" onClick={runFeas}>Run feasibility — {E.fmtMoney(E.CONFIG.feasCost)}</button></div>
          )}
        </div>
        {(<>
          <h3 style={{ marginTop: 2 }}>{isMF ? 'Unit economics' : 'Rent roll in place'}</h3>
          {isMF ? (
            <div className="dim" style={{ fontSize: 12.5, padding: '4px 0 8px' }}>
              {listing.units} apartments · {Math.round((listing.occ ?? 0) * (listing.units ?? 0))} occupied · avg in-place rent {E.fmtMoney((listing.sf! * E.assetRentPSF(state, { tileI: listing.tileI, type: listing.type!, quality: listing.quality!, units: listing.units ?? 1, construction: listing.construction ?? 'garden' } as any) * (listing.occ ?? 0)) / 12 / Math.max(1, Math.round((listing.occ ?? 0) * (listing.units ?? 1))))}/unit/mo.
              Residential leases turn over fast and re-lease fast — occupancy is the whole game.
            </div>
          ) : <RentRollTable state={state} tenants={listing.tenants ?? []} sf={listing.sf!} retailOf={listing.type === 'retail' ? { tileI: listing.tileI, quality: listing.quality ?? 75 } : undefined} />}
        </>)}
        {canBuy && (<>
          <label className="f" style={{ marginTop: 10 }}>Down payment — {pct(dpEff)} ({E.fmtMoney(effPrice * dpEff)}) <span className="faint">at {listing.agreed ? `the ${E.fmtMoney(effPrice)} agreed price` : effPrice !== txPrice ? `your ${E.fmtMoney(effPrice)} offer — buying now still pays the ${E.fmtMoney(txPrice)} ask` : `the ${E.fmtMoney(txPrice)} ask`}</span>
            <input type="range" min={Math.ceil((1 - ltvMax) * 100)} max={100} value={Math.round(dpEff * 100)}
              onChange={e => setDownPct(Number(e.target.value) / 100)} />
          </label>
          <div className="memo" style={{ borderLeftColor: 'var(--blue)', opacity: dpEff >= 1 ? 0.55 : 1 }}>
            <div className="eyebrow" style={{ fontSize: 9, margin: '2px 0 4px' }}>{dpEff >= 1 ? 'All cash — no desk involved at closing' : 'Term sheets — you called five desks'}</div>
            {quotes.map(q2 => {
              const ld = E.LENDERS.find(x => x.id === q2.lenderId)!;
              if (!q2.ok) {
                return (
                  <div key={q2.lenderId} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '2px 0', fontSize: 12, opacity: 0.55 }}>
                    <input type="radio" name="acqloan" disabled />
                    <span style={{ minWidth: 128 }}>{ld.short}</span>
                    <span className="faint" style={{ flex: 1, fontSize: 10.5 }}>Passed — {q2.why}</span>
                  </div>
                );
              }
              const svc = q2.ioMonths > 0 ? loan * q2.ratePct / 100 / 12 : E.monthlyPayment(loan, q2.ratePct, q2.amortYears);
              const rel = state.lenderRel?.[q2.lenderId] ?? 20;
              return (
                <label key={q2.lenderId} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '2px 0', cursor: 'pointer', fontSize: 12 }}>
                  <input type="radio" name="acqloan" checked={dpEff < 1 && selQuote?.lenderId === q2.lenderId} disabled={dpEff >= 1} onChange={() => setLenderPick(q2.lenderId)} />
                  <span style={{ minWidth: 128 }}>{ld.short}{rel >= 60 ? ' ★' : ''}</span>
                  <span className="num">{q2.ratePct.toFixed(2)}%</span>
                  <span className="num dim">{q2.amortYears}-yr{q2.ioMonths > 0 ? ` · ${q2.ioMonths}mo IO` : ''} · ≤{Math.round(q2.maxLTV * 100)}%{q2.minDSCR !== undefined ? ` · ${q2.minDSCR.toFixed(2)}× floor` : ''}</span>
                  <span className="num dim">{E.fmtMoney(svc)}/mo</span>
                  <span className="faint" style={{ flex: 1, fontSize: 10.5 }}>{ld.blurb}</span>
                </label>
              );
            })}
            {!selQuote && <div className="alert-strip red" style={{ margin: '6px 0' }}>No desk will touch this one right now — smaller ask, better collateral, or wait out the market.</div>}
            <div className="memo-row" style={{ marginTop: 4 }}><span className="lbl">Loan ({pct(1 - dpEff)} LTV, max {pct(ltvMax)}) · 10-yr balloon</span><span className="num">{E.fmtMoney(loan)}</span></div>
            <div className="memo-row"><span className="lbl">Debt service</span><span className="num">{selQuote ? E.fmtMoney((selQuote.ioMonths > 0 ? loan * selQuote.ratePct / 100 / 12 : E.monthlyPayment(loan, selQuote.ratePct, selQuote.amortYears)) * 12) + '/yr' : '—'}</span></div>
            <div className="memo-row"><span className="lbl">DSCR on in-place income <Hint text="NOI ÷ annual debt service. Every desk has its own floor: the banks want 1.25×, the CMBS desk 1.20×, Colonial 1.35× — and Ironbridge will carry 0.75× coverage, because the price is the point." /></span>
              <span className={'num ' + (dscr === null ? '' : dscr >= (selQuote?.minDSCR ?? 1.25) ? 'pos' : 'neg')}>{dscr === null ? '—' : dscr.toFixed(2) + '×'}{selQuote?.minDSCR !== undefined && dscr !== null ? <span className="faint"> vs {selQuote.minDSCR.toFixed(2)}× floor</span> : ''}</span></div>
            {(() => {
              const eq = effPrice * dpEff;
              const jvc = E.canJV(state, eq);
              return (
                <div className="memo-row"><span className="lbl">
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: jvc.ok ? 'pointer' : 'default', opacity: jvc.ok ? 1 : 0.55 }}>
                    <input type="checkbox" checked={useJV && jvc.ok} disabled={!jvc.ok} onChange={e => setUseJV(e.target.checked)} />
                    Bring in a JV partner <Hint text="An LP funds 70% of the equity for an 8% preferred return. You keep 30% of cash flow plus a 20% promote on their profits at sale. Lose their money and institutional capital stops answering." />
                  </label></span>
                  <span className="num">{jvc.ok ? (useJV ? `Your equity: ${E.fmtMoney(Math.round(eq * 0.3))} · LP wires ${E.fmtMoney(Math.round(eq * 0.7))}` : 'Available') : <span className="faint" style={{ fontSize: 10.5 }}>{jvc.why}</span>}</span></div>
              );
            })()}
            <div className="memo-row total"><span className="lbl">Cash needed (incl. $15K closing){!listing.agreed && effPrice !== txPrice ? <span className="faint"> — at your offer; the ask needs {E.fmtMoney(useJV && jvOk ? Math.round(txPrice * dpEff * 0.3) + 15000 : txPrice * dpEff + 15000)}</span> : ''}</span>
              <span className={'num ' + (state.cash >= (useJV && jvOk ? Math.round(effPrice * dpEff * 0.3) + 15000 : cashNeeded) ? '' : 'neg')}>{E.fmtMoney(useJV && jvOk ? Math.round(effPrice * dpEff * 0.3) + 15000 : cashNeeded)}</span></div>
          </div>
          {(listing.type === 'retail' || listing.type === 'industrial') && <div className="faint" style={{ fontSize: 10.5, margin: '-4px 0 8px' }}>NNN leases: tenants reimburse taxes, insurance, and CAM on their occupied share. Vacancy eats those costs raw.</div>}
        </>)}
        {err && <div className="alert-strip red" style={{ marginBottom: 10 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={close}>{canBuy ? 'Pass' : 'Step away'}</button>
          {canBuy && <button className="btn btn-amber" disabled={dpEff < 1 && !selQuote} onClick={() => {
            const r = E.buyBuilding(state, listing.id, dpEff, useJV && jvOk, 'std', dpEff < 1 ? selQuote?.lenderId : undefined);
            if (r.err) setErr(r.err); else { setState(r.s); close(); }
          }}>Buy at {E.fmtMoney(txPrice)}{useJV && jvOk ? ' (JV)' : ''}{!listing.agreed && effPrice !== txPrice ? ' (ask)' : ''}</button>}
        </div>
      </Modal>
    );
  }

  // ---------- land ----------
  const isBuildFlow = !!(listing.fromLandId || listing.parentAssetId);
  const spec = E.CONSTR[dev.type].find(x => x.id === dev.construction) ?? E.CONSTR[dev.type][0];
  const bMax = Math.min(E.maxBuildableSF(state, listing, dev.type), E.CONFIG.tiers[state.tier].maxSF, spec.maxSF ?? Infinity);
  const bd = E.devCostBreakdown(state, dev, listing.price);
  const maxLoan = bd.total * (E.CONFIG.constrLTC - (state.econ.crunchMonthsLeft > 0 ? 0.1 : 0));
  const equity = Math.max(bd.total * dev.downPct, bd.total - maxLoan);
  const pf = listing.feasDone ? E.proFormaLand(state, listing, dev) : null;
  const vErr = E.validateDev(state, listing, dev);
  const suitTxt = (ty: PType) => { const f = E.tileDemandFactor(state, t, ty); return f > 1.1 ? 'strong' : f > 0.85 ? 'fair' : 'weak'; };
  const setType = (ty: PType) => {
    const c0 = E.CONSTR[ty][ty === 'industrial' ? 1 : 1] ?? E.CONSTR[ty][0];
    const sf = Math.min(dev.sf, E.maxBuildableSF(state, listing, ty) || 5000);
    setDev({ ...dev, type: ty, construction: c0.id, sf: Math.max(5000, sf), units: defaultUnits(ty, c0.id, sf) });
  };
  const setConstr = (cid: string) => {
    const c0 = E.CONSTR[dev.type].find(x => x.id === cid)!;
    let sf = dev.sf; if (c0.maxSF && sf > c0.maxSF) sf = c0.maxSF;
    setDev({ ...dev, construction: cid, sf, units: c0.fixedUnits ?? Math.max(c0.minUnits ?? 1, dev.units) });
  };
  return (
    <Modal close={close} wide variant={variant}>
      <h2>Land — Block {blockName(t)} {(listing as any).omLead && <span className="chip chip-om" style={{ verticalAlign: 'middle' }}>Off-market</span>}</h2>
      <div className="sub">
        {listing.acres} acres · {E.fmtMoney(listing.price)} (${(listing.price / Math.max(1, (listing.acres ?? 1) * 43_560)).toFixed(0)}/SF land) · desirability {t.D.toFixed(0)} · industrial fit {t.indSuit.toFixed(0)}
        {(listing as any).omLead ? ' · this owner wasn\u2019t selling until you called' : ''}
      </div>
      {listing.declinedYou && <div className="alert-strip red" style={{ marginBottom: 10 }}>This landowner won't deal with you after your last offer.</div>}
      {listing.rivalEye && !listing.agreed && (
        <div className="alert-strip red" style={{ marginBottom: 10 }}>
          ⚔ <b>{state.firms.find(f => f.short === listing.rivalEye)?.name ?? 'A rival'}</b> is circling this dirt — they close within the month if you don't.
        </div>
      )}
      {!listing.agreed && !listing.declinedYou && !listing.parentAssetId && (
        <div className="memo" style={{ borderLeftColor: 'var(--amber)' }}>
          <div className="memo-row"><span className="lbl">Asking {E.fmtMoney(listing.price)} — or open with your own number</span></div>
          {omMsg && <div style={{ fontSize: 12, color: 'var(--amber)', padding: '4px 0' }}>{omMsg}</div>}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
            <button className="btn btn-sm" onClick={() => setOfferAmt(v => Math.max(0, (v || listing.price) - 100_000))}>−100K</button>
            <button className="btn btn-sm" onClick={() => setOfferAmt(v => Math.max(0, (v || listing.price) - 10_000))}>−10K</button>
            <input type="number" step={10000} value={offerAmt || listing.price}
              onChange={e => setOfferAmt(Number(e.target.value))}
              style={{ flex: 1, background: 'var(--panel3)', border: '1px solid var(--line)', color: 'var(--ink)', padding: '7px 10px', borderRadius: 4, fontFamily: 'var(--mono)', fontSize: 13 }} />
            <button className="btn btn-sm" onClick={() => setOfferAmt(v => (v || listing.price) + 10_000)}>+10K</button>
            <button className="btn btn-sm" onClick={() => setOfferAmt(v => (v || listing.price) + 100_000)}>+100K</button>
            <button className="btn btn-amber" onClick={() => {
              const amt = Math.max(10_000, offerAmt || Math.round(listing.price * 0.94 / 10000) * 10000);
              const r = E.makeOffer(state, listing.id, amt);
              if (r.result === 'accepted') { setOmOk(true); setOmMsg(`✓ SELLER AGREED at ${E.fmtMoney(amt)} — go close it.`); }
              setState(r.s);
              if (r.result === 'countered') { setOmMsg(`They countered at ${E.fmtMoney(r.counter!)} — that's the new ask.`); setOfferAmt(r.counter!); }
              else if (r.result === 'declined') { onNotice?.(r.msg ?? 'The owner declined and ended the conversation.'); close(); }
              else if (r.result === 'accepted') setOmMsg(null);
            }}>Make offer</button>
          </div>
          <div className="faint" style={{ fontSize: 10.5, marginTop: 6 }}>Landowners bruise like everyone else — how much patience this one has is not printed anywhere.</div>
        </div>
      )}
      {listing.agreed && <div className="alert-strip" style={{ marginBottom: 10, borderColor: 'var(--green)', color: 'var(--green)' }}>✓ SELLER AGREED at {E.fmtMoney(listing.price)} — close before {E.monthName(listing.expiresMonth)} or they re-list.</div>}
      {!isBuildFlow && (() => {
        const uc = listing.underContract;
        const deposit = Math.max(10_000, Math.round(listing.price * 0.03 / 1000) * 1000);
        const studyFee = Math.max(20_000, Math.round(listing.price * 0.01 / 1000) * 1000);
        const act = (r: { s: GameState; err?: string }) => { if (r.err) setErr(r.err); else { setState(r.s); } };
        const terms = E.landLoanTerms(state);
        const finAmt = Math.round(listing.price * terms.maxLTV / 10000) * 10000;
        const finRow = (
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, margin: '6px 0', cursor: 'pointer' }}>
            <input type="checkbox" checked={landFin} onChange={e => setLandFin(e.target.checked)} />
            Land loan — the bank fronts {Math.round(terms.maxLTV * 100)}% ({E.fmtMoney(finAmt)}) at {terms.ratePct.toFixed(2)}%, interest-only, {terms.termMo}-month balloon
            <Hint text="Banks lend on dirt reluctantly: half the price, a hot coupon, and a short fuse. If you haven't built, sold, or repaid when it matures, the extension costs 150bps more. Retiring it is part of your equity check at groundbreaking." />
          </label>
        );
        return (
          <div>
            <div className="dim" style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 10 }}>
              Buying dirt is its own deal. Go under contract to buy a ~90-day window: study the site for {E.fmtMoney(studyFee)},
              then close knowing the truth — or walk and forfeit the deposit. Or close today without the study and own the unknowns.
              What you build here is a separate decision, made later, from your portfolio.
            </div>
            {uc ? (
              <div className="memo" style={{ borderLeftColor: 'var(--amber)' }}>
                <div className="memo-row"><span className="lbl">Under contract since {E.monthName(uc.m)} · deposit paid</span><span className="num">{E.fmtMoney(uc.deposit)}</span></div>
                <div className="memo-row"><span className="lbl">Window closes</span><span className="num amber">{E.monthName(listing.expiresMonth)}</span></div>
                {uc.known ? (
                  <div className="memo-row"><span className="lbl">Study result</span>
                    <span className={'num ' + (uc.known.kind === 'none' ? 'pos' : 'neg')}>
                      {E.SITE_COND_LABEL[uc.known.kind]}{uc.known.kind !== 'none' ? (uc.known.sfLossFrac ? ` · −${Math.round(uc.known.sfLossFrac * 100)}% buildable` : ` · remediation ~${E.fmtMoney(uc.known.cost)}`) : ''}
                    </span></div>
                ) : uc.studyOrdered ? (
                  <div className="memo-row"><span className="lbl">Study underway</span><span className="num dim">results ~{E.monthName(uc.resultM ?? state.month + 1)}</span></div>
                ) : (
                  <div className="memo-row"><span className="lbl">No study ordered yet</span>
                    <button className="btn btn-sm btn-amber" onClick={() => act(E.orderLandStudy(state, listing.id))}>Order study — {E.fmtMoney(studyFee)}</button></div>
                )}
                {err && <div className="alert-strip red" style={{ margin: '8px 0' }}>{err}</div>}
                {finRow}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                  <button className="btn btn-danger" onClick={() => { act(E.walkLandContract(state, listing.id)); close(); }}>Walk — forfeit {E.fmtMoney(uc.deposit + (uc.studyFee ?? 0))}</button>
                  <button className="btn btn-amber" onClick={() => { const r = E.closeLandContract(state, listing.id, landFin ? terms.maxLTV : 0); if (r.err) setErr(r.err); else { setState(r.s); close(); } }}>
                    Close — {E.fmtMoney(Math.max(0, listing.price - uc.deposit - (landFin ? finAmt : 0) + 5000))}{landFin ? ' cash' : ''}</button>
                </div>
              </div>
            ) : (
              <>
                {err && <div className="alert-strip red" style={{ marginBottom: 8 }}>{err}</div>}
                {finRow}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  <button className="btn" onClick={close}>Pass</button>
                  <button className="btn" title="Close today with no study — whatever is under there is yours"
                    onClick={() => { const r = E.buyLandHold(state, listing.id, landFin ? terms.maxLTV : 0); if (r.err) setErr(r.err); else { setState(r.s); close(); } }}>
                    Buy now, no study — {E.fmtMoney(Math.max(0, listing.price - (landFin ? finAmt : 0) + 5000))}{landFin ? ' cash' : ''}</button>
                  <button className="btn btn-amber" title="~3% deposit buys a 90-day window to study before closing"
                    onClick={() => act(E.contractLand(state, listing.id))}>Go under contract — {E.fmtMoney(deposit)} deposit</button>
                </div>
              </>
            )}
          </div>
        );
      })()}
      {isBuildFlow && <>
      {isBuildFlow && bMax < E.MIN_BUILD_SF && (
        <div className="alert-strip red" style={{ marginBottom: 10 }}>
          Zoned density at {E.zoneCode(t.zone)} won't carry any {E.PLABEL[dev.type].toLowerCase()} building on this site — the paper tops out at {(bMax / 1000).toFixed(1)}K SF and nothing under {(E.MIN_BUILD_SF / 1000).toFixed(1)}K SF passes code. Assemble more lots, pick another product, or upzone the block.
        </div>
      )}
      {isBuildFlow && <div className="dim" style={{ fontSize: 11.5, marginBottom: 10 }}>
        Zoned <b style={{ color: 'var(--ink)' }}>{E.zoneCode(t.zone)}</b> ({E.ZONE_LABEL[t.zone.use].toLowerCase()}, {E.zoneTierMult(t.zone.tier)}× density) — permits {E.ZONE_ALLOWS[t.zone.use].map(ty => E.PLABEL[ty].toLowerCase()).join(', ')}.
        At that density a {E.PLABEL[dev.type].toLowerCase()} building here tops out at <b className="num" style={{ color: 'var(--ink)' }}>{(E.maxBuildableSF(state, listing, dev.type) / 1000).toFixed(0)}K SF</b>. Your tier caps projects at {E.CONFIG.tiers[state.tier].maxSF / 1000}K SF.
      </div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <label className="f">Product type
          <select value={dev.type} onChange={e => setType(e.target.value as PType)}>
            {E.PTYPES.map(ty => (
              <option key={ty} value={ty} disabled={(ty === 'mixed' && state.tier < 1) || !E.zoneAllows(t.zone, ty)}>
                {E.PLABEL[ty]} — {!E.zoneAllows(t.zone, ty) ? `not permitted in ${E.zoneCode(t.zone)}` : `demand ${suitTxt(ty)}`}{ty === 'mixed' && state.tier < 1 ? ' (Tier 2)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="f">Construction
          <select value={dev.construction} onChange={e => setConstr(e.target.value)}>
            {E.CONSTR[dev.type].map(c => (
              <option key={c.id} value={c.id} disabled={(c.minCells ?? 1) > E.listingParcels(listing)}>
                {c.label} — ${c.cost}/SF, Class {E.QLABEL[E.qGrade(c.q)]}{(c.minCells ?? 1) > E.listingParcels(listing) ? ` (needs ${(c.minCells ?? 1) * 0.25} ac)` : ''}</option>
            ))}
          </select>
        </label>
        <label className="f">Building size — {(dev.sf / 1000).toFixed(0)}K SF
          <input type="range" min={E.MIN_BUILD_SF} max={Math.max(E.MIN_BUILD_SF, bMax)} step={500} value={Math.min(dev.sf, Math.max(E.MIN_BUILD_SF, bMax))}
            onChange={e => setDev({ ...dev, sf: Number(e.target.value) })} />
        </label>
        {(() => {
          const fp = E.floorplateSF(listing, dev.type);
          const stories = Math.max(1, Math.round(dev.sf / fp));
          const maxStories = Math.max(1, Math.floor(Math.max(E.MIN_BUILD_SF, bMax) / fp));
          const setStories = (n: number) => {
            const st = Math.max(1, Math.min(maxStories, n));
            setDev({ ...dev, sf: Math.max(E.MIN_BUILD_SF, Math.min(Math.max(E.MIN_BUILD_SF, bMax), Math.round(fp * st / 500) * 500)) });
          };
          return (
            <label className="f">Stories — {stories} on a {(fp / 1000).toFixed(1)}K SF floorplate <Hint text={`Typical ${E.PLABEL[dev.type].toLowerCase()} covers ~${Math.round(E.COVERAGE[dev.type] * 100)}% of its site per floor. Stories × floorplate = building SF; zoning caps the total at ${(Math.max(E.MIN_BUILD_SF, bMax) / 1000).toFixed(0)}K SF here (${maxStories} ${maxStories === 1 ? 'story' : 'stories'}).`} />
              <span style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                <button type="button" className="btn btn-sm" onClick={() => setStories(stories - 1)} disabled={stories <= 1}>−</button>
                <span className="num" style={{ minWidth: 90, textAlign: 'center' }}>{stories} {stories === 1 ? 'story' : 'stories'}</span>
                <button type="button" className="btn btn-sm" onClick={() => setStories(stories + 1)} disabled={stories >= maxStories}>+</button>
                <span className="faint" style={{ fontSize: 10.5 }}>max {maxStories} under {E.zoneCode(t.zone)} zoning</span>
              </span>
            </label>
          );
        })()}
        <label className="f">Units / suites — {dev.units} {spec.fixedUnits ? '(single-tenant)' : ''} <Hint text="More, smaller suites rent for marginally more per SF and diversify tenant risk — but cost more to manage, and small suites lease ambiently while big blocks need LOI negotiations." />
          <input type="range" min={spec.fixedUnits ?? spec.minUnits ?? 1} max={spec.fixedUnits ?? Math.max(spec.minUnits ?? 1, Math.floor(dev.sf / (dev.type === 'multifamily' ? 650 : 1200)))} value={dev.units}
            disabled={!!spec.fixedUnits}
            onChange={e => setDev({ ...dev, units: Number(e.target.value) })} />
        </label>
        {dev.type === 'mixed' && (() => {
          const m = dev.mix ?? E.defaultMixSplit(state.seed, listing.tileI);
          const setMix = (patch: Partial<E.MixSplit>) => {
            let retail = Math.min(patch.retail ?? m.retail, 0.35);
            const office = Math.min(patch.office ?? m.office, 0.8 - retail);
            const mf = Math.round((1 - retail - office) * 100) / 100;
            setDev({ ...dev, mix: { retail: Math.round(retail * 100) / 100, office: Math.round(office * 100) / 100, multifamily: mf } });
          };
          return (
            <label className="f" style={{ gridColumn: '1 / -1' }}>
              Program — {Math.round(m.retail * 100)}% retail · {Math.round(m.office * 100)}% office · {Math.round(m.multifamily * 100)}% homes (~{Math.max(0, Math.round(dev.sf * m.multifamily / 950))} apartments)
              <span style={{ display: 'flex', gap: 10, marginTop: 4, alignItems: 'center' }}>
                <span className="faint" style={{ fontSize: 10.5, minWidth: 44 }}>Retail</span>
                <input type="range" min={0} max={35} value={Math.round(m.retail * 100)} onChange={e => setMix({ retail: Number(e.target.value) / 100 })} style={{ flex: 1 }} />
                <span className="faint" style={{ fontSize: 10.5, minWidth: 44 }}>Office</span>
                <input type="range" min={0} max={60} value={Math.round(m.office * 100)} onChange={e => setMix({ office: Number(e.target.value) / 100 })} style={{ flex: 1 }} />
              </span>
              <span className="faint" style={{ fontSize: 10.5 }}>The homes take the rest — at least 20%. Rent blends from the three markets; retail and office suites tour on their own, the apartments fill monthly.</span>
            </label>
          );
        })()}
        <label className="f">GC contract <Hint text="Guaranteed Maximum Price: +7% on hard cost, and overruns above contingency are the GC's problem — but unknown site conditions stay yours. Cost-plus: baseline price, every surprise is yours." />
          <select value={dev.contractType} onChange={e => setDev({ ...dev, contractType: e.target.value as any })}>
            <option value="costplus">Cost-plus — baseline, you eat every surprise</option>
            <option value="gmp">Guaranteed Max Price — +7% hard, GC eats overruns</option>
          </select>
        </label>
        <label className="f">Recourse <Hint text="Sign personally and the bank sharpens its pencil: ~80bps cheaper and 75% LTC instead of 65%. The catch: if the project fails, the deficiency comes out of YOUR cash — non-recourse borrowers can hand back the keys and walk." />
          <select value={dev.recourse ? '1' : '0'} onChange={e => setDev({ ...dev, recourse: e.target.value === '1' })}>
            <option value="0">Non-recourse — base +3.9%, 65% LTC, keys-back protection</option>
            <option value="1">Personal guarantee — base +3.1%, 75% LTC, it follows you</option>
          </select>
        </label>
        <label className="f">Payment &amp; performance bond <Hint text="~1.2% of hard cost. If the GC goes bankrupt mid-job, the surety covers the rebid delta and you lose a month or two. Unbonded, a failed GC means a dark site for months, a rebid at today's prices, and a weathering shell." />
          <select value={dev.bonded ? '1' : '0'} onChange={e => setDev({ ...dev, bonded: e.target.value === '1' })}>
            <option value="0">Unbonded — cheaper, exposed</option>
            <option value="1">Bonded — +1.2% hard, surety-backed</option>
          </select>
        </label>
        <label className="f">Contingency
          <select value={dev.contingencyPct} onChange={e => setDev({ ...dev, contingencyPct: Number(e.target.value) })}>
            <option value={0.05}>5% — brave</option>
            <option value={0.10}>10% — standard</option>
            <option value={0.15}>15% — sleep well</option>
          </select>
        </label>
        <label className="f">Schedule
          <select value={dev.expedited ? '1' : '0'} onChange={e => setDev({ ...dev, expedited: e.target.value === '1' })}>
            <option value="0">Normal — ~{bd.months} mo build</option>
            <option value="1">Expedited — +8% cost, −25% time</option>
          </select>
        </label>
        <label className="f">Design <Hint text="Value-engineered: -6% hard cost, quicker drawings, ~8% rent discount, and it gets repriced HARD in a recession. Signature: +12% hard cost, +4 months of design, 12% rent premium, and it holds its value in a downturn. This bet settles at delivery, not at groundbreaking." />
          <select value={dev.designTier} onChange={e => setDev({ ...dev, designTier: e.target.value as any })}>
            <option value="ve">Value-engineered — cheap, fast, commodity</option>
            <option value="std">Standard — baseline</option>
            <option value="signature">Signature — costly, slow, holds value</option>
          </select>
        </label>
        <label className="f">Equity share — {pct(dev.downPct)} (min {pct(1 - E.CONFIG.constrLTC)})
          <input type="range" min={30} max={100} value={Math.round(dev.downPct * 100)}
            onChange={e => setDev({ ...dev, downPct: Number(e.target.value) / 100 })} />
        </label>
      </div>
      <Portrait b={{ type: dev.type, construction: dev.construction, sf: dev.sf, units: dev.units, quality: spec.q,
        proposed: true, designTier: dev.designTier ?? 'std', seed: mapSeed(state.seed, listing.tileI),
        siteCells: Math.max(1, listing.parcelCells?.length ?? Math.round((listing.acres ?? E.PARCEL_AC) / E.PARCEL_AC)) }} w={460} h={190} />
      <div className="memo">
        <div className="memo-row"><span className="lbl">Land ({listing.acres} ac{listing.fromLandId ? ', already owned — basis carried' : ''})</span><span className="num">{E.fmtMoney(listing.price)}</span></div>
        <div className="memo-row"><span className="lbl">Hard costs — {spec.label.toLowerCase()} @ ${spec.cost}/SF{state.econ.tariffMonthsLeft > 0 ? ' (tariffs +8% ⚠)' : ''}</span><span className="num">{E.fmtMoney(bd.hard)}</span></div>
        <div className="memo-row"><span className="lbl">Soft costs (15%)</span><span className="num">{E.fmtMoney(bd.soft)}</span></div>
        {(bd as any).bond > 0 && <div className="memo-row"><span className="lbl">Performance bond</span><span className="num">{E.fmtMoney((bd as any).bond)}</span></div>}
        <div className="memo-row"><span className="lbl">Contingency</span><span className="num">{E.fmtMoney(bd.cont)}</span></div>
        <div className="memo-row"><span className="lbl">Design fees ({E.DESIGN[dev.designTier ?? 'std'].label.toLowerCase()}, equity-funded)</span><span className="num">{E.fmtMoney((bd as any).designFee)}</span></div>
        <div className="memo-row total"><span className="lbl">Total development cost</span><span className="num">{E.fmtMoney(bd.total + (bd as any).designFee)}</span></div>
        <div className="memo-row"><span className="lbl">Land-close to delivery <Hint text="Diligence (if chosen), then design, then permits, then construction. You are committing to deliver into whatever market exists at the END of this timeline." /></span>
          <span className="num">≈ {(bd as any).designMonths + 2 + bd.months} months</span></div>
        <div className="memo-row"><span className="lbl">Construction loan (≤{pct(dev.recourse ? 0.75 : 0.65)} LTC at {(state.econ.rate + (dev.recourse ? 3.1 : 3.9) + (dev.fixedRate ? 0.6 : 0)).toFixed(2)}% {dev.fixedRate ? 'FIXED' : 'FLOATING'}{dev.recourse ? ' · PG' : ' · non-recourse'}, 12-mo IO after delivery)</span><span className="num">{E.fmtMoney(bd.total - equity)}</span></div>
        <div className="memo-row"><span className="lbl">
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={!!dev.fixedRate} onChange={e => setDev({ ...dev, fixedRate: e.target.checked })} />
            Fix the rate (+0.60%) <Hint text="Floating construction debt reprices every month — a rate spike mid-build compounds against you. Fixed costs more on day one and is worth every basis point in the wrong year." />
          </label></span>
          <span className="num dim">{dev.fixedRate ? 'hedged' : 'exposed to the curve'}</span></div>
        <div className="memo-row"><span className="lbl">Interest reserve (loan-funded, sized to a {bd.months}-mo build) <Hint text="Pays the construction interest while you build. Run past schedule and it empties — then debt service comes from your cash, on a building earning nothing." /></span>
          <span className="num">{E.fmtMoney(Math.round((bd.total - equity) * ((state.econ.rate + (dev.recourse ? 3.1 : 3.9) + (dev.fixedRate ? 0.6 : 0)) / 100 / 12) * bd.months * 0.6))}</span></div>
        {(() => {
          const cr = state.econ.rate + (dev.recourse ? 3.1 : 3.9) + (dev.fixedRate ? 0.6 : 0);
          const loanAmt = bd.total - equity;
          const dsIO = loanAmt * cr / 100 / 12;
          const needed = equity + (bd as any).designFee;
          return (<>
            <div className="memo-row"><span className="lbl">Est. debt service once delivered <Hint text="12 months interest-only after delivery, then it amortizes. During construction the interest reserve carries it." /></span>
              <span className="num">{E.fmtMoney(dsIO)}/mo IO <span className="faint">then {E.fmtMoney(E.monthlyPayment(loanAmt, cr, 25))}/mo</span></span></div>
            <div className="memo-row total"><span className="lbl">Cash required at closing (equity + design fees)</span>
              <span className={'num ' + (state.cash >= needed ? 'pos' : 'neg')}>{E.fmtMoney(needed)}{state.cash < needed ? <span className="faint"> · you have {E.fmtMoney(state.cash)}</span> : ''}</span></div>
          </>);
        })()}
      </div>
      {pf ? (
        <div className="memo" style={{ borderLeftColor: pf.spread > 1 ? 'var(--green)' : 'var(--red)' }}>
          <table className="sc">
            <thead><tr><th>Scenario</th><th>Stabilized NOI</th><th>Yield on cost <Hint text="Stabilized NOI ÷ total cost. Development only makes sense when this beats the market cap rate — that spread IS the developer's profit." /></th></tr></thead>
            <tbody>
              {pf.scenarios.map(sc => (
                <tr key={sc.name}><td>{sc.name}</td><td className="num">{E.fmtMoney(sc.noi)}/yr</td>
                  <td className={'num ' + (sc.yoc > pf.cap ? 'pos' : 'neg')}>{sc.yoc.toFixed(2)}%</td></tr>
              ))}
            </tbody>
          </table>
          <div className="memo-row" style={{ marginTop: 8 }}><span className="lbl">Market cap rate at delivery grade</span><span className="num">{pf.cap.toFixed(2)}%</span></div>
          <div className="memo-row total"><span className="lbl">Base-case profit at stabilization</span>
            <span className={'num ' + (pf.profit > 0 ? 'pos' : 'neg')}>{E.fmtMoney(pf.profit)} ({pf.spread >= 0 ? '+' : ''}{pf.spread.toFixed(1)} pt spread)</span></div>
          {pf.spread < 1 && <div style={{ fontSize: 11.5, color: 'var(--red)', marginTop: 6 }}>
            ⚠ Thin spread. You're taking construction and lease-up risk for a margin the market could erase.
          </div>}
        </div>
      ) : (
        <div style={{ margin: '10px 0' }}>
          <button className="btn" onClick={runFeas}>Run feasibility study — {E.fmtMoney(E.CONFIG.feasCost)} (reveals the pro forma)</button>
        </div>
      )}
      {vErr && <div className="faint" style={{ fontSize: 11.5, color: 'var(--amber)', marginBottom: 8 }}>◈ {vErr}</div>}
      {err && <div className="alert-strip red" style={{ marginBottom: 10 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn" onClick={close}>Pass</button>
        {E.canJV(state, equity).ok && (
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--dim)' }}>
            <input type="checkbox" checked={useJV} onChange={e => setUseJV(e.target.checked)} />
            JV partner (LP funds 70% of {E.fmtMoney(equity)})
          </label>
        )}
        <button className="btn btn-amber" disabled={!!vErr} onClick={() => {
          const r = E.buyLandAndDevelop(state, listing.id, dev, useJV && E.canJV(state, equity).ok);
          if (r.err) setErr(r.err); else { setState(r.s); close(); }
        }}>Break ground{useJV && E.canJV(state, equity).ok ? ' (JV)' : ''}</button>
      </div>
      </>}
    </Modal>
  );
}
function CONSTR0(l: Listing, state: GameState) {
  const t = state.tiles[l.tileI];
  let ty: PType = t.indSuit > 55 ? 'industrial' : 'retail';
  // open the modal on something the zoning actually permits
  if (!E.zoneAllows(t.zone, ty)) ty = E.ZONE_ALLOWS[t.zone.use].find(x => !(x === 'mixed' && state.tier < 1)) ?? E.ZONE_ALLOWS[t.zone.use][0];
  return { type: ty, construction: E.CONSTR[ty][1].id };
}
function defaultUnits(ty: PType, cid: string, sf: number): number {
  const c = E.CONSTR[ty].find(x => x.id === cid);
  if (c?.fixedUnits) return c.fixedUnits;
  const base = ty === 'industrial' ? 1 : ty === 'retail' ? Math.floor(sf / 2500) : ty === 'office' ? Math.floor(sf / 5000) : ty === 'multifamily' ? Math.floor(sf / 900) : Math.floor(sf / 2500);
  return Math.max(c?.minUnits ?? 1, base, 1);
}

// ---------- LOI negotiation modal ----------
export function LOIModal({ state, setState, loi, close, variant = 'dialog' }: {
  state: GameState; setState: (s: GameState) => void; loi: LOI; close: () => void; variant?: 'dialog' | 'drawer';
}) {
  const a = state.assets.find(x => x.id === loi.assetId);
  const [msg, setMsg] = useState<string | null>(null);
  // hooks must run unconditionally — the asset can disappear (sale) while this is mounted.
  // A component tenant in a mixed building negotiates against its own market.
  const mkt = a ? E.loiMarketRate(state, a, loi) : 0;
  const isFinal = loi.stage === 'countered';
  const theirRate = isFinal ? loi.counterRate! : loi.rate;
  const theirTerm = isFinal ? loi.counterTermY! : loi.termY;
  const [rate, setRate] = useState(() => Math.round((theirRate ?? mkt) * 100) / 100);
  const [termY, setTermY] = useState(theirTerm ?? 5);
  const [esc, setEsc] = useState(loi.escPct ?? 2.5);
  const [grantOpt, setGrantOpt] = useState(false);
  const annual = (r: number) => loi.sf * r;
  const [walked, setWalked] = useState(false);
  if (!a) return null;
  const act = (action: E.LOIAction) => {
    const r = E.respondLOI(state, loi.id, action);
    setState(r.s);
    if (r.outcome === 'countered') setMsg('They came back with a final number — reopen the LOI to see it.');
    else if (r.outcome === 'walked') {
      setWalked(true);
      setMsg(loi.kind === 'renewal'
        ? `❌ ${loi.tenant} walked away — they're moving out. The space goes dark and the make-ready bill is yours.`
        : `❌ ${loi.tenant} walked away from the deal. Your terms were more than the space was worth to them.`);
    }
    else close();
  };
  return (
    <Modal close={close} variant={variant}>
      <h2>{loi.kind === 'rfp' ? 'RFP' : loi.kind === 'renewal' ? 'Renewal proposal' : 'Letter of intent'} — {loi.tenant}</h2>
      <div className="sub">
        {(loi.sf / 1000).toFixed(1)}K SF at {a.name}{loi.use ? <span className="faint"> ({E.PLABEL[loi.use].toLowerCase()} floors)</span> : ''} · <span className={'chip credit-' + loi.credit}>{E.CREDIT_LABEL[loi.credit]} credit</span> · expires {E.monthName(loi.expiresM)}
        {loi.kind === 'renewal' && <span className="amber"> · sitting tenant — if this dies, their space goes dark{loi.prevRate !== undefined ? ` · paying $${loi.prevRate.toFixed(2)}/SF today` : ''}</span>}
        <span style={{ display: 'inline-block', marginLeft: 8, padding: '1px 8px', border: '1px solid var(--amber-dim)', borderRadius: 4, color: 'var(--amber)', fontFamily: 'var(--mono)', fontSize: 13 }}>{((loi.sf ?? 0) / 1000).toFixed(1)}K SF wanted</span>
      </div>
      <div className="memo">
        {loi.kind !== 'rfp' || isFinal ? (<>
          <div className="memo-row"><span className="lbl">{isFinal ? 'Their FINAL counter' : loi.kind === 'renewal' ? 'They offer to renew at' : 'Their proposed rate'}</span><b className="num">${theirRate?.toFixed(2)}/SF · {theirTerm} yrs</b></div>
          <div className="memo-row"><span className="lbl">That's ~{pct((theirRate ?? mkt) / mkt - 1 + 1e-9, 0).replace('%', '%')} of market (${mkt.toFixed(2)}/SF)</span>
            <span className={'num ' + ((theirRate ?? 0) >= mkt * 0.97 ? 'pos' : 'dim')}>{E.fmtMoney(annual(theirRate ?? mkt))}/yr</span></div>
        </>) : (
          <div className="memo-row"><span className="lbl">They've invited a proposal. Market for this building</span><span className="num">${mkt.toFixed(2)}/SF</span></div>
        )}
        {(loi.escPct !== undefined || loi.optionAsk) && (
          <div className="memo-row"><span className="lbl">Their structure</span>
            <span className="num">{loi.escPct !== undefined ? `${loi.escPct}% annual bumps` : ''}{loi.escPct !== undefined && loi.optionAsk ? ' · ' : ''}{loi.optionAsk ? <span className="amber">wants a fixed-rate renewal option</span> : ''}</span></div>
        )}
        {((loi.freeMonths ?? 0) > 0 || (loi.tiPsf ?? 0) > 0) && (() => {
          const r0 = theirRate ?? mkt;
          const free = Math.round((loi.freeMonths ?? 0) * loi.sf * r0 / 12);
          const extraTI = Math.round((loi.tiPsf ?? 0) * loi.sf);
          const termMo = (theirTerm ?? 5) * 12;
          const effRate = r0 * (termMo - (loi.freeMonths ?? 0)) / termMo - (loi.tiPsf ?? 0) / (theirTerm ?? 5);
          return (
            <div className="memo-row"><span className="lbl">They also want <Hint text="Accepting their terms pays these concessions at signing. Your counter is rate and term only — stripping the package costs you acceptance odds, and they may walk." /></span>
              <span className="num">{loi.freeMonths ? `${loi.freeMonths} mo free (${E.fmtMoney(free)})` : ''}{loi.freeMonths && loi.tiPsf ? ' + ' : ''}{loi.tiPsf ? `$${loi.tiPsf}/SF TI (${E.fmtMoney(extraTI)})` : ''}
                <span className="faint"> · effective ${effRate.toFixed(2)}/SF</span></span></div>
          );
        })()}
        {(() => {
          const c = E.leaseSigningCosts(state, a.type, loi.sf, isFinal ? (theirRate ?? mkt) : rate, isFinal ? (theirTerm ?? 5) : termY, loi.kind === 'renewal');
          return (c.ti + c.lc) > 0 ? (
            <div className="memo-row"><span className="lbl">Your signing costs <Hint text="Tenant improvements build out their space (added to basis); the leasing commission pays the brokers. Both are cash at signing — a great lease is cash-flow-negative on day one." /></span>
              <span className="num">{E.fmtMoney(c.ti)} TI + {E.fmtMoney(c.lc)} LC = <b>{E.fmtMoney(c.ti + c.lc)}</b></span></div>
          ) : null;
        })()}
        <div className="memo-row"><span className="lbl">Credit risk <Hint text="A: ~0.7%/yr default odds. B: ~2.4%/yr. C: ~7%/yr — and 2.6× worse in recessions." /></span>
          <span className="dim">{loi.credit === 2 ? 'Institutional-grade — sleep well' : loi.credit === 1 ? 'Solid local operator' : 'Thin margins — priced accordingly'}</span></div>
      </div>
      {!isFinal && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <label className="f">{loi.kind === 'rfp' ? 'Your proposed rate' : 'Counter rate'} — ${rate.toFixed(2)}/SF <span className="faint">({pct(rate / mkt, 0)} of mkt)</span>
            <input type="range" min={Math.round(mkt * 0.7 * 100)} max={Math.round(mkt * 1.25 * 100)} value={Math.round(rate * 100)}
              onChange={e => setRate(Number(e.target.value) / 100)} />
          </label>
          <label className="f">Term — {termY} years
            <input type="range" min={3} max={10} value={termY} onChange={e => setTermY(Number(e.target.value))} />
          </label>
          <label className="f">Annual escalations — {esc}% <Hint text="The quiet compounding that pays for buildings. Pushing above what they proposed costs acceptance odds." />
            <input type="range" min={0} max={4} step={0.5} value={esc} onChange={e => setEsc(Number(e.target.value))} />
          </label>
          {loi.optionAsk && (
            <label className="f" style={{ justifyContent: 'center' }}>
              <span style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={grantOpt} onChange={e => setGrantOpt(e.target.checked)} />
                Grant the renewal option <Hint text="A fixed-rate option is a one-way door: they exercise it only when the market has run past the strike. It buys ~9 points of acceptance odds today — and could cost you the upside tomorrow." />
              </span>
            </label>
          )}
        </div>
      )}
      {!isFinal && !walked && <div className="dim" style={{ fontSize: 11.5, marginBottom: 10 }}>
        {rate / mkt > 1.12
          ? <span style={{ color: 'var(--red)' }}>⚠ {pct(rate / mkt, 0)} of market is aggressive — at this level most tenants simply walk.</span>
          : rate / mkt > 1.05
            ? <span className="amber">Above market — doable in a tight market, risky in a soft one.</span>
            : 'Push rate above market and they may walk — how far depends on how tight the market is. Longer terms lock in today\'s rate for better or worse.'}
      </div>}
      {msg && <div className={'alert-strip' + (walked ? ' red' : '')}><span>{msg}</span></div>}
      {walked ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn" onClick={close}>Understood</button></div>
      ) : (
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <button className="btn" onClick={() => act({ type: 'decline' })}>Decline</button>
        {loi.kind === 'loi' || isFinal
          ? <button className="btn" onClick={() => act({ type: 'accept' })}>Accept {isFinal ? 'final ' : ''}terms (${theirRate?.toFixed(2)})</button>
          : null}
        {!isFinal && <button className="btn btn-amber" onClick={() => act(loi.kind === 'rfp' ? { type: 'propose', rate, termY, escPct: esc, grantOption: grantOpt } : { type: 'counter', rate, termY, escPct: esc, grantOption: grantOpt })}>
          {loi.kind === 'rfp' ? 'Send proposal' : 'Counter'} at ${rate.toFixed(2)}
        </button>}
      </div>
      )}
    </Modal>
  );
}

// ---------- Portfolio ----------
export function PortfolioView2({ state, setState, onSell, onRefi, onLOI, goDeals, openDeal, onSold, onShowOnMap, onShowTile }: {
  state: GameState; setState: (s: GameState) => void;
  onSell: (id: number) => void; onRefi: (id: number) => void; onLOI: (id: number) => void; goDeals: () => void;
  openDeal: (id: number) => void; onSold: (pm: E.PostMortem) => void; onShowOnMap?: (id: number) => void;
  onShowTile?: (tileI: number) => void;
}) {
  if (state.assets.length === 0 && state.land.length === 0) {
    return <div className="panel dim" style={{ fontSize: 13.5, lineHeight: 1.6 }}>
      No assets yet. An empty balance sheet is just potential energy — <button className="btn btn-sm btn-amber" onClick={goDeals}>open the marketplace</button>
    </div>;
  }
  return (
    <div>
      <div className="panel" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h3 style={{ marginBottom: 2 }}>Lease negotiations</h3>
          <div className="dim" style={{ fontSize: 11.5 }}>
            {state.autoLease
              ? 'Your agent handles every LOI, RFP, and renewal at standard market terms — nothing brilliant, nothing stupid.'
              : 'Every proposal crosses your desk. Squeeze harder than an agent would — or fumble deals an agent would have signed.'}
          </div>
        </div>
        <div className="seg">
          <button className={!state.autoLease ? 'active' : ''} onClick={() => state.autoLease && setState(E.setAutoLease(state, false))}>Negotiate myself</button>
          <button className={state.autoLease ? 'active' : ''} onClick={() => !state.autoLease && setState(E.setAutoLease(state, true))}>Delegate to agent</button>
        </div>
      </div>
      {state.assets.length >= 2 && <PortfolioLedger state={state} onShowOnMap={onShowOnMap} />}
      {state.land.length > 0 && (
        <div className="panel" style={{ marginBottom: 12 }}>
          <h3>Land bank</h3>
          {state.land.map(h => {
            const val = E.landValue(state, h);
            const dirtOffers = state.saleOffers.filter(o => o.landId === h.id);
            return (
              <div key={h.id} style={{ borderBottom: '1px solid var(--line2)' }}>
                <div className="memo-row" style={{ gap: 8 }}>
                  <span className="lbl" style={{ cursor: onShowTile ? 'pointer' : undefined }}
                    onClick={() => onShowTile?.(h.tileI)}
                    title="Show me on the map">Block {blockName(state.tiles[h.tileI])} · {Math.round(h.cells.length * E.PARCEL_AC * 100) / 100} ac · held {state.month - h.acquiredM} mo · basis {E.fmtMoney(h.basis)} <span className="btn btn-sm" style={{ fontSize: 10, padding: '1px 8px', marginLeft: 4 }}>▸ map</span>
                    {h.forSale && <span className="chip chip-agreed" style={{ marginLeft: 6 }}>Listed · ask {E.fmtMoney(h.forSale.ask)}</span>}</span>
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span className="num">{E.fmtMoney(val)} <span className={val >= h.basis ? 'pos' : 'neg'}>({val >= h.basis ? '+' : ''}{E.fmtMoney(val - h.basis)})</span></span>
                    {h.forSale
                      ? <button className="btn btn-sm" onClick={() => setState(E.delistLand(state, h.id))}>Delist</button>
                      : <button className="btn btn-sm" title="Land sells slowly — list it and field scattered offers as they come" onClick={() => setState(E.listLandForSale(state, h.id).s)}>List for sale</button>}
                    <button className="btn btn-sm btn-amber" onClick={() => {
                      const r = E.developLand(state, h.id);
                      if (r.err) { alert(r.err); return; }
                      setState(r.s);
                      if (r.listingId) openDeal(r.listingId);
                    }}>Build ▸</button>
                  </span>
                </div>
                {dirtOffers.map(o => (
                  <div key={o.id} className="memo-row" style={{ gap: 8, paddingLeft: 12 }}>
                    <span className="lbl"><b style={{ color: 'var(--green)' }}>{o.buyer}</b> offers <b className="num" style={{ color: 'var(--ink)' }}>{E.fmtMoney(o.amount)}</b> ({Math.round(o.amount / Math.max(1, val) * 100)}% of appraisal){o.countered ? ' · best and final' : ''} · expires {E.monthName(o.expiresM)}</span>
                    <span style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-sm btn-amber" onClick={() => setState(E.respondSaleOffer(state, o.id, { type: 'accept' }).s)}>Accept</button>
                      {!o.countered && <button className="btn btn-sm" title={`Counter at your ${E.fmtMoney(h.forSale?.ask ?? val)} ask — they may walk`} onClick={() => setState(E.respondSaleOffer(state, o.id, { type: 'counter', amount: h.forSale?.ask ?? val }).s)}>Counter at ask</button>}
                      <button className="btn btn-sm" onClick={() => setState(E.respondSaleOffer(state, o.id, { type: 'decline' }).s)}>Decline</button>
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
          <div className="faint" style={{ fontSize: 11, marginTop: 6 }}>Dirt pays no rent, and it sells slowly — list it and the offers come scattered, lowball assemblers to deadline-rich 1031 money. Adjoining holdings build together automatically.</div>
        </div>
      )}
      {state.assets.map(a => (
        <AssetCard key={a.id} state={state} setState={setState} asset={a}
          onSell={onSell} onRefi={onRefi} onLOI={onLOI} openDeal={openDeal} onSold={onSold} onShowOnMap={onShowOnMap} />
      ))}
      {(state.dealLog ?? []).length > 0 && (
        <details className="panel" style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', userSelect: 'none' }}><h3 style={{ display: 'inline' }}>Deal history — {state.dealLog!.length} trade{state.dealLog!.length > 1 ? 's' : ''} ▾</h3></summary>
          <table className="sc" style={{ marginTop: 8 }}>
            <thead><tr><th>Date</th><th>Action</th><th>Property</th><th>SF</th><th>Price</th><th>$/SF</th><th>Cap</th><th>Held</th><th>Profit</th></tr></thead>
            <tbody>
              {[...state.dealLog].reverse().slice(0, 120).map((d, i) => (
                <tr key={i}>
                  <td className="num">{E.monthName(d.m)}</td>
                  <td className={d.action === 'sell' || d.action === 'land sell' ? 'pos' : 'dim'}>{d.action}</td>
                  <td style={{ textAlign: 'left' }}>{d.name}</td>
                  <td className="num">{d.type === 'land' ? (d.sf / 43_560).toFixed(2) + ' ac' : (d.sf / 1000).toFixed(0) + 'K'}</td>
                  <td className="num">{E.fmtMoney(d.price)}</td>
                  <td className="num">{d.sf > 0 && d.type !== 'land' ? '$' + (d.price / d.sf).toFixed(0) : d.sf > 0 ? '$' + (d.price / d.sf).toFixed(0) : '—'}</td>
                  <td className="num">{d.capPct != null ? d.capPct.toFixed(2) + '%' : '—'}</td>
                  <td className="num">{d.holdMo != null ? Math.round(d.holdMo / 12 * 10) / 10 + ' yr' : '—'}</td>
                  <td className={'num ' + (d.profit == null ? 'dim' : d.profit >= 0 ? 'pos' : 'neg')}>{d.profit != null ? E.fmtMoney(d.profit) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}

// Average in-place rent: what the roll actually pays today, per leased foot.
function avgRentPSF(state: GameState, a: Asset): number | null {
  if (a.mode === 'construction') return null;
  if (E.isAggregate(a.type)) return a.occ > 0.02 ? E.assetRentPSF(state, a) : null;
  const lsf = E.leasedSF(a);
  return lsf > 0 ? a.tenants.reduce((s2, tn) => s2 + tn.sf * tn.rate, 0) / lsf : null;
}

// The portfolio as a ledger: sortable one-line-per-asset, rows fly to the map.
export function PortfolioLedger({ state, onShowOnMap }: { state: GameState; onShowOnMap?: (id: number) => void }) {
  const [sort, setSort] = useState<{ by: string; asc: boolean }>({ by: 'value', asc: false });
  const rows = state.assets.map(a => {
    const uc = a.mode === 'construction';
    const val = E.assetValue(state, a);
    const debt = E.assetTotalDebt(state, a);
    const noi = uc ? 0 : E.assetNOIMonthly(state, a);
    const ds = uc ? 0 : E.assetDebtService(a);
    return { a, uc, val, debt, eq: val - debt - E.lpClaim(state, a), noi, cf: noi - ds, rent: avgRentPSF(state, a) };
  });
  const dir = sort.asc ? 1 : -1;
  const val = (r: typeof rows[0]): number =>
    sort.by === 'occ' ? r.a.occ : sort.by === 'debt' ? r.debt : sort.by === 'eq' ? r.eq
    : sort.by === 'noi' ? r.noi : sort.by === 'cf' ? r.cf : sort.by === 'rent' ? (r.rent ?? -999) : r.val;
  rows.sort((x, y) => (val(x) - val(y)) * dir);
  const Th = ({ id, label }: { id: string; label: string }) => (
    <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => setSort(s2 => ({ by: id, asc: s2.by === id ? !s2.asc : false }))}>
      {label}{sort.by === id ? (sort.asc ? ' ▴' : ' ▾') : ''}
    </th>
  );
  const tot = rows.reduce((acc, r) => ({ val: acc.val + r.val, debt: acc.debt + r.debt, eq: acc.eq + r.eq, noi: acc.noi + r.noi, cf: acc.cf + r.cf }), { val: 0, debt: 0, eq: 0, noi: 0, cf: 0 });
  return (
    <div className="panel" style={{ marginBottom: 12, padding: '8px 12px' }}>
      <table className="sc">
        <thead><tr><th style={{ textAlign: 'left' }}>Asset</th><th style={{ textAlign: 'left' }}>Type</th>
          <Th id="occ" label="Occ" /><Th id="value" label="Value" /><Th id="debt" label="Debt" /><Th id="eq" label="Equity" />
          <Th id="noi" label="NOI /mo" /><Th id="cf" label="CF /mo" /><Th id="rent" label="Avg rent PSF" /></tr></thead>
        <tbody>
          {rows.map(({ a, uc, val: v, debt, eq, noi, cf, rent }) => (
            <tr key={a.id} style={{ cursor: onShowOnMap ? 'pointer' : undefined }} onClick={() => onShowOnMap?.(a.id)}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--panel2)')}
              onMouseLeave={e => (e.currentTarget.style.background = '')}>
              <td>{a.name} {uc && <span className="chip chip-land">UC</span>}{a.forSale && <span className="chip chip-agreed">Sale</span>}<span className="btn btn-sm" style={{ fontSize: 10, padding: '1px 8px', marginLeft: 4 }}>▸ map</span></td>
              <td className="dim">{E.PLABEL[a.type]}</td>
              <td className="num">{uc ? '—' : pct(a.occ)}</td>
              <td className="num">{E.fmtMoney(v)}</td>
              <td className="num">{E.fmtMoney(debt)}</td>
              <td className={'num ' + (eq < 0 ? 'neg' : '')}>{E.fmtMoney(eq)}</td>
              <td className="num">{uc ? '—' : E.fmtMoney(noi)}</td>
              <td className={'num ' + (cf >= 0 ? 'pos' : 'neg')}>{uc ? '—' : E.fmtMoney(cf)}</td>
              <td className={'num ' + (rent === null ? 'dim' : '')}>{rent === null ? '—' : '$' + rent.toFixed(2)}</td>
            </tr>
          ))}
          <tr style={{ borderTop: '1px solid var(--line)', fontWeight: 700 }}>
            <td>Portfolio</td><td></td><td></td>
            <td className="num">{E.fmtMoney(tot.val)}</td><td className="num">{E.fmtMoney(tot.debt)}</td>
            <td className="num">{E.fmtMoney(tot.eq)}</td><td className="num">{E.fmtMoney(tot.noi)}</td>
            <td className={'num ' + (tot.cf >= 0 ? 'pos' : 'neg')}>{E.fmtMoney(tot.cf)}</td><td></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ---------- Asset card (shared by the Portfolio list and the map's asset drawer) ----------
export function AssetCard({ state, setState, asset: a, onSell, onRefi, onLOI, openDeal, onSold, defaultOpen = false, onShowOnMap }: {
  state: GameState; setState: (s: GameState) => void; asset: Asset;
  onSell: (id: number) => void; onRefi: (id: number) => void; onLOI: (id: number) => void;
  openDeal: (id: number) => void; onSold: (pm: E.PostMortem) => void; defaultOpen?: boolean;
  onShowOnMap?: (id: number) => void;
}) {
  const nameEl = onShowOnMap
    ? <button className="asset-name link-name" title="Show me on the map" onClick={() => onShowOnMap(a.id)}>{a.name}<span className="faint" style={{ fontSize: 10, fontWeight: 400 }}> ▸ map</span></button>
    : <span className="asset-name">{a.name}</span>;
  const [err, setErr] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [progOpen, setProgOpen] = useState(false);
  const t = state.tiles[a.tileI];
  const lois = state.lois.filter(l => l.assetId === a.id);
  if (a.mode === 'construction' && a.project) {
    const p = a.project;
    const prog = p.stage === 'permitting' ? 0 : p.monthsBuilt / Math.max(1, p.monthsBuilt + p.monthsLeft);
    return (
      <div className="asset-card">
        <div className="asset-head">
          {nameEl}
          <span className="chip chip-type">{E.PLABEL[a.type]}</span>
          <span className="chip chip-land">{p.stage === 'diligence' ? 'Under contract — diligence' : p.stage === 'design' ? 'In design' : p.stage === 'permitting' ? 'Permitting' : 'Under construction'}</span>
          <span className="faint" style={{ fontSize: 11 }}>Block {blockName(t)} · {(a.sf / 1000).toFixed(0)}K SF · {a.units} unit{a.units > 1 ? 's' : ''} · {E.constrSpec(a).label}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 12, alignItems: 'center' }}>
          <div style={{ marginTop: 10 }}>
            <div className="progress"><div style={{ width: pct(prog) }} /></div>
            <div className="dim" style={{ fontSize: 11.5, marginTop: 5 }}>
              {p.stage === 'permitting'
                ? `Waiting on permits — ~${p.monthsLeft} mo`
                : `${p.monthsLeft} months to delivery · spent ${E.fmtMoney(p.spent)} of ${E.fmtMoney(a.basis)} · contingency left ${E.fmtMoney(p.contingencyLeft)}`}
            </div>
            <div className="metric-row">
              <div className="metric"><div className="eyebrow">Constr. loan drawn</div><div className="v num">{E.fmtMoney(a.loans[0]?.balance ?? 0)}</div></div>
              <div className="metric"><div className="eyebrow">Rate</div><div className="v num">{(a.loans[0]?.ratePct ?? 0).toFixed(2)}% {a.loans[0]?.floating ? 'FLT' : 'FIXED'}</div></div>
              {(() => {
                const run = E.reserveRunwayMonths(state, a);
                if (run === null) return null;
                const label = run <= 0 ? 'EMPTY — burning cash' : run > 24 ? '24+ mo' : run.toFixed(0) + ' mo';
                return <div className="metric"><div className="eyebrow">Reserve runway <Hint text="Months of construction interest the reserve can still pay at the forward burn rate. At zero, debt service comes out of your cash." /></div>
                  <div className={'v num ' + (run <= 0 ? 'neg' : run <= 3 ? 'amber' : 'pos')}>{label}</div></div>;
              })()}
              <div className="metric"><div className="eyebrow">Target class</div><div className="v num">{E.QLABEL[E.qGrade(a.quality)]}</div></div>
            </div>
          </div>
          {p.stage === 'building'
            ? <Portrait b={{ type: a.type, construction: a.construction, sf: a.sf, units: a.units, quality: a.quality,
                seed: mapSeed(state.seed, a.tileI), siteCells: E.footprintCells(a).length || 1, progress: Math.max(0.05, prog) }} w={300} h={170} />
            : <Portrait b={{ type: a.type, construction: a.construction, sf: a.sf, units: a.units, quality: a.quality,
                seed: mapSeed(state.seed, a.tileI), siteCells: E.footprintCells(a).length || 1, proposed: true, designTier: a.designTier }} w={300} h={170} />}
        </div>
      </div>
    );
  }
  const val = E.assetValue(state, a);
  const debt = E.assetTotalDebt(state, a);
  const noi = E.assetNOIMonthly(state, a);
  const ds = E.assetDebtService(a);
  const tOcc = E.targetOcc(state, t, a.type);
  const potM = (a.sf * E.assetRentPSF(state, a)) / 12;
  const egiM = E.assetEGIMonthly(state, a);
  const ex = E.expenseBreakdown(state, a, potM, egiM);
  const isMF = E.isAggregate(a.type);
  const offers = state.saleOffers.filter(o => o.assetId === a.id);
  const exAcres = E.excessAcres(a);
  const canPad = exAcres > 0.1 && E.spareParcels(state, a) >= 1;
  const inFac = state.facilities.some(f => f.assetIds.includes(a.id));
  return (
    <div className="asset-card">
      <div className="asset-head">
        {nameEl}
        <span className="chip chip-type">{E.PLABEL[a.type]}</span>
        <span className="chip" style={{ border: '1px solid var(--line)', color: 'var(--dim)' }}
          title={`Quality ${Math.round(a.quality)}/150 as built · tenants see ${Math.round(E.apparentQuality(state, a))}/150 with the address factored in. Every point moves rent, demand, credit mix, renewals, and exit cap. Age wears it down; maintenance and capital programs push back. Cap for this structure: ${Math.round(a.qCap)}.`}>
          {E.QLABEL[E.qGrade(a.quality)]}-grade · {Math.round(a.quality)}<span style={{ opacity: 0.6 }}>/150</span></span>
        {a.programActive && <span className="chip chip-land">{E.PROGRAMS.find(p => p.id === a.programActive!.id)?.label ?? 'Program'} · {a.programActive.monthsLeft} mo</span>}
        {a.mode === 'leaseup' && <span className="chip chip-distress">Lease-up</span>}
        {inFac && <span className="chip chip-om">Cross-collateralized</span>}
        {a.renovMonthsLeft ? <span className="chip chip-land">Renovating · {a.renovMonthsLeft} mo</span> : null}
        {a.forSale && <span className="chip chip-agreed">For sale · ask {E.fmtMoney(a.forSale.ask)}</span>}
        {a.jv && <span className="chip chip-om" title={`Partner: ${E.fmtMoney(a.jv.lpContrib)} in · accrued pref ${E.fmtMoney(Math.round(a.jv.accPref))} · you keep 30% of CF + promote`}>JV · your 30%</span>}
        {(a as any).converting && <span className="chip chip-land">Converting to apartments</span>}
        {lois.length > 0 && <button className="chip chip-loi" onClick={() => onLOI(lois[0].id)}>✉ {lois.length} LOI{lois.length > 1 ? 's' : ''} waiting</button>}
        <span className="faint" style={{ fontSize: 11 }}>Block {blockName(t)} · {(a.sf / 1000).toFixed(0)}K SF · {a.units} unit{a.units > 1 ? 's' : ''}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: 12 }}>
        <div>
          <div style={{ marginTop: 8, maxWidth: 400 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }} className="dim">
              <span>Occupancy {pct(a.occ)} · {isMF ? `${Math.round(a.occ * a.units)}/${a.units} units` : `${a.tenants.length} tenant${a.tenants.length === 1 ? '' : 's'}`}</span><span>market supports ~{pct(tOcc)}</span>
            </div>
            <div className="occ-bar"><div className="occ-fill" style={{ width: pct(a.occ), background: a.occ < 0.6 ? 'var(--red)' : a.occ < 0.8 ? 'var(--amber)' : 'var(--green)' }} /></div>
          </div>
          <div className="metric-row">
            {(() => {
              const band = E.appraisalBand(state, a);
              return (
                <div className="metric" title={`Appraisal is an opinion: defensible values run ${E.fmtMoney(band.lo)} – ${E.fmtMoney(band.hi)} (±${band.halfPts.toFixed(2)} cap pts around ${band.capMid.toFixed(2)}%). The band tightens above 80% leased, with fresh comps, in an open market. Your mark is the midpoint; a quick sale prices in the lower half.`}>
                  <div className="eyebrow">Value (opinion)</div><div className="v num">{E.fmtMoney(val)}</div>
                  <div className="faint num" style={{ fontSize: 9.5 }}>{E.fmtMoney(band.lo)}–{E.fmtMoney(band.hi)}</div>
                </div>
              );
            })()}
            <div className="metric"><div className="eyebrow">Debt{inFac ? ' (incl. share)' : ''}</div><div className="v num">{E.fmtMoney(debt)}</div></div>
            {a.loans.length > 0 && <div className="metric"><div className="eyebrow">Loan terms</div><div className="v num" style={{ fontSize: 12 }}>{a.loans[0].ratePct.toFixed(2)}% <span className="faint">· due {E.monthName(a.loans[0].maturityMonth)}</span></div></div>}
            <div className="metric"><div className="eyebrow">{a.jv ? 'Your equity' : 'Equity'}</div><div className={'v num ' + (val - debt - E.lpClaim(state, a) < 0 ? 'neg' : '')}>{E.fmtMoney(val - debt - E.lpClaim(state, a))}</div></div>
            <div className="metric"><div className="eyebrow">Rent /mo</div><div className="v num">{E.fmtMoney(egiM)}</div></div>
            <div className="metric"><div className="eyebrow">NOI /mo</div><div className="v num">{E.fmtMoney(noi)}</div></div>
            <div className="metric"><div className="eyebrow">Debt svc /mo</div><div className="v num">{E.fmtMoney(ds)}</div></div>
            <div className="metric"><div className="eyebrow">CF /mo</div><div className={'v num ' + (noi - ds >= 0 ? 'pos' : 'neg')}>{E.fmtMoney(noi - ds)}</div></div>
            <div className="metric"><div className="eyebrow">Avg rent PSF <Hint text="What the rent roll actually pays today, per leased square foot. Compare against the market rent to see who's carrying whom." /></div>
              <div className="v num">{avgRentPSF(state, a) === null ? '—' : '$' + avgRentPSF(state, a)!.toFixed(2)}</div></div>
          </div>
        </div>
        <Portrait b={{ type: a.type, construction: a.construction, sf: a.sf, units: a.units, quality: a.quality,
          age: a.age, occ: a.occ, seed: mapSeed(state.seed, a.tileI), siteCells: E.footprintCells(a).length || 1,
          tenants: signTenants(a.tenants) }} w={260} h={160} />
      </div>
      {err && <div className="alert-strip red" style={{ marginTop: 10 }}><span>{err}</span><button className="btn btn-sm" onClick={() => setErr(null)}>✕</button></div>}
      <div style={{ display: 'flex', gap: 14, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <div className="eyebrow" style={{ fontSize: 9, marginBottom: 3 }}>Asking rents</div>
          <div className="seg">
            {[[-0.1, '−10%'], [0, 'Market'], [0.1, '+10%']].map(([v, l]) => (
              <button key={String(v)} className={a.rentStance === v ? 'active' : ''}
                onClick={() => setState(E.setRentStance(state, a.id, v as number))}>{l as string}</button>
            ))}
          </div>
        </div>
        <div>
          <div className="eyebrow" style={{ fontSize: 9, marginBottom: 3 }}>Maintenance</div>
          <div className="seg">
            {(['low', 'std', 'high'] as const).map(m => (
              <button key={m} className={a.maint === m ? 'active' : ''} onClick={() => setState(E.setMaint(state, a.id, m))}>{m === 'std' ? 'Standard' : m === 'low' ? 'Low' : 'High'}</button>
            ))}
          </div>
        </div>
        <button className="btn btn-sm" onClick={() => setIsOpen(!isOpen)}>{isOpen ? 'Hide' : 'Rent roll & financials ▾'}</button>
        <button className="btn btn-sm" onClick={() => setProgOpen(!progOpen)}>{progOpen ? 'Hide improvements' : 'Capital improvements ▾'}</button>
        <span style={{ flex: 1 }} />
        <button className="btn btn-sm" onClick={() => onRefi(a.id)}>Refinance</button>
        {a.mode !== 'construction' && (
          <button className="btn btn-sm btn-danger" title={E.canDemolish(state, a).ok ? 'Tear it down and keep the dirt' : E.canDemolish(state, a).why}
            disabled={!E.canDemolish(state, a).ok}
            onClick={() => { const r = E.demolish(state, a.id); if (r.err) setErr(r.err); else setState(r.s); }}>
            Demolish ({E.fmtMoney(E.demolitionCost(state, a))})
          </button>
        )}
        {a.type === 'office' && a.occ <= 0.35 && !a.forSale && (
          <button className="btn btn-sm" title="Gut it and hand it to renters — 12 months, cash up front"
            onClick={() => { const r = E.startConversion(state, a.id); if (r.err) setErr(r.err); else setState(r.s); }}>
            Convert to apartments ({E.fmtMoney(E.conversionCost(state, a))})
          </button>
        )}
        {canPad && !a.forSale && <button className="btn btn-sm" title={`~${exAcres} spare acres on this site`} onClick={() => {
          const r = E.createExcessLandListing(state, a.id);
          if (r.err) setErr(r.err); else { setState(r.s); if (r.listingId) openDeal(r.listingId); }
        }}>Build on spare land ({exAcres} ac)</button>}
        {a.forSale
          ? <button className="btn btn-sm" onClick={() => setState(E.cancelSale(state, a.id))}>Delist</button>
          : <button className="btn btn-sm btn-danger" onClick={() => onSell(a.id)}>List for sale</button>}
      </div>
      {offers.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {offers.map(o => <SaleOfferRow key={o.id} state={state} setState={setState} offer={o} asset={a} onSold={onSold} />)}
        </div>
      )}
      {progOpen && (
        <div className="memo" style={{ borderLeftColor: 'var(--amber-dim)', marginTop: 10 }}>
          <div className="memo-row"><span className="lbl"><b style={{ color: 'var(--ink)' }}>Capital improvements</b> — targeted work, one crew at a time. Each moves quality; some move more.</span></div>
          {E.PROGRAMS.map(p => {
            const done = (a.programs ?? []).includes(p.id);
            const gate = E.canStartProgram(state, a, p);
            const cost = E.programCost(state, a, p);
            if (p.types && !p.types.includes(a.type)) return null;
            return (
              <div key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '5px 0', borderTop: '1px solid var(--line2)' }}>
                <span style={{ minWidth: 230, fontSize: 12, color: done ? 'var(--green)' : 'var(--ink)' }}>{done ? '✓ ' : ''}{p.label}</span>
                <span className="num faint" style={{ fontSize: 11 }}>+{p.q}q{p.capUp ? ` · cap +${p.capUp}` : ''}{p.opexPct ? ` · opex −${Math.round(p.opexPct * 100)}%` : ''}{p.velocity ? ' · leases faster' : ''}{p.creditBump ? ' · draws credit tenants' : ''} · {p.months} mo</span>
                <span className="faint" style={{ flex: 1, fontSize: 11 }}>{p.desc}</span>
                {!done && <button className="btn btn-sm" disabled={!gate.ok} title={gate.why}
                  onClick={() => { const r = E.startProgram(state, a.id, p.id); if (r.err) setErr(r.err); else setState(r.s); }}>
                  {E.fmtMoney(cost)}</button>}
              </div>
            );
          })}
          <div className="faint" style={{ fontSize: 10.5, marginTop: 4 }}>Quality {Math.round(a.quality)}/150 · structural ceiling {Math.round(a.qCap)} — systems work raises the ceiling itself. Wear runs ~{(((0.30 - Math.min(0.16, a.age * 0.008)) * (0.78 + 0.34 * a.occ) * 12)).toFixed(1)} points a year at this age and occupancy{a.maint === 'high' ? ', high maintenance claws back ~2/yr' : a.maint === 'low' ? ', and skimped maintenance gives up ~3 more' : ''}.</div>
        </div>
      )}
      {isOpen && (
        <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 16 }}>
          <div>
            <h3>{isMF ? 'Unit economics' : 'Rent roll'}</h3>
            {isMF ? (
              <div className="dim" style={{ fontSize: 12.5, lineHeight: 1.7 }}>
                {a.units} apartments · <b style={{ color: 'var(--ink)' }} className="num">{Math.round(a.occ * a.units)}</b> occupied<br />
                Avg market rent: <b style={{ color: 'var(--ink)' }} className="num">{E.fmtMoney((a.sf * E.assetRentPSF(state, a) * (1 + a.rentStance)) / 12 / a.units)}</b>/unit/mo<br />
                Collections (EGI): <b style={{ color: 'var(--ink)' }} className="num">{E.fmtMoney(egiM)}</b>/mo<br />
                <span className="faint" style={{ fontSize: 10.5 }}>Renters churn monthly and re-lease fast — no LOIs here, just occupancy, price, and upkeep.</span>
              </div>
            ) : (<>
              {a.type === 'mixed' && (
                <div className="dim" style={{ fontSize: 11.5, marginBottom: 6 }}>
                  {E.mixedComponents(state, a).map(c => (
                    <span key={c.comp} style={{ marginRight: 12 }}>
                      {c.comp === 'multifamily' ? 'Homes' : E.PLABEL[c.comp]}: <b className="num" style={{ color: 'var(--ink)' }}>{(c.leased / 1000).toFixed(1)}K / {(c.sf / 1000).toFixed(1)}K SF</b>
                      <span className="faint"> (${E.componentRentPSF(state, a, c.comp).toFixed(2)} mkt)</span>
                    </span>
                  ))}
                </div>
              )}
              <RentRollTable state={state} tenants={a.tenants} sf={a.sf} retailOf={a.type === 'retail' ? { tileI: a.tileI, quality: a.quality } : undefined} />
              <div className="faint" style={{ fontSize: 10.5, marginTop: 6 }}>
                Market for this building: ${E.assetRentPSF(state, a).toFixed(2)}/SF · vacant {( (a.sf - E.leasedSF(a)) / 1000).toFixed(1)}K SF
              </div>
            </>)}
          </div>
          <div>
            <h3>Debt terms</h3>
            {a.loans.length === 0 ? <div className="dim" style={{ fontSize: 12, marginBottom: 8 }}>Unlevered — all equity.</div> : (
              <table className="sc" style={{ marginBottom: 10 }}>
                <thead><tr><th>Type</th><th>Balance</th><th>Rate</th><th>Amort</th><th>IO left</th><th>Balloon</th><th>DSCR</th></tr></thead>
                <tbody>
                  {a.loans.map(ln => (
                    <tr key={ln.id}>
                      <td className="dim">{ln.kind === 'acq' ? 'Acquisition' : ln.kind === 'constr' ? 'Construction' : 'Refi'}{ln.recourse ? ' · PG' : ''}{ln.floating ? ' · FLT' : ''}</td>
                      <td className="num">{E.fmtMoney(ln.balance)}</td>
                      <td className="num">{ln.ratePct.toFixed(2)}%</td>
                      <td className="num">{ln.amortYears} yr</td>
                      <td className="num">{ln.ioMonthsLeft > 0 && ln.ioMonthsLeft < 900 ? ln.ioMonthsLeft + ' mo' : ln.ioMonthsLeft >= 900 ? 'capitalizing' : '—'}</td>
                      <td className="num">{E.monthName(ln.maturityMonth)}</td>
                      <td className={'num ' + (ds > 0 && noi / ds < 1.2 ? 'neg' : 'pos')}>{ds > 0 ? (noi / ds).toFixed(2) + '×' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <h3>Operating statement /mo</h3>
            <table className="sc">
              <tbody>
                <tr><td>Scheduled rent (EGI){a.type === 'retail' && E.retailOverageMonthly(state, a) > 0 ? <span className="faint" style={{ fontSize: 10 }}> incl. {E.fmtMoney(E.retailOverageMonthly(state, a))} percentage rent</span> : ''}</td><td className="num">{E.fmtMoney(egiM)}</td><td></td></tr>
                {(() => {
                  const gross = ex.lines.filter(x => x.amt > 0).reduce((s2, x) => s2 + x.amt, 0);
                  return ex.lines.map(l2 => (
                    <tr key={l2.label}><td className="dim">{l2.amt < 0 ? '+' : '−'} {l2.label}</td><td className={'num' + (l2.amt < 0 ? ' pos' : '')}>{E.fmtMoney(Math.abs(l2.amt))}</td>
                      <td className="num faint">{gross > 0 && l2.amt > 0 ? pct(l2.amt / gross) : '—'} <span className="faint" style={{ fontSize: 9 }}>{l2.amt > 0 ? 'of opex' : 'recovered'}</span></td></tr>
                  ));
                })()}
                <tr style={{ borderTop: '1px solid var(--line)' }}><td><b>NOI</b></td><td className="num"><b>{E.fmtMoney(noi)}</b></td><td></td></tr>
                <tr><td className="dim">− Debt service</td><td className="num">{E.fmtMoney(ds)}</td><td></td></tr>
                <tr><td><b>Cash flow</b></td><td className={'num ' + (noi - ds >= 0 ? 'pos' : 'neg')}><b>{E.fmtMoney(noi - ds)}</b></td><td></td></tr>
              </tbody>
            </table>
            {a.units === 1 && !isMF && <div className="faint" style={{ fontSize: 10.5, marginTop: 5 }}>Single-tenant NNN: the tenant carries taxes, insurance, and upkeep of the pad.</div>}
            {(a.type === 'retail' || a.type === 'industrial') && a.units > 1 && <div className="faint" style={{ fontSize: 10.5, marginTop: 5 }}>NNN: tenants reimburse taxes, insurance & CAM on occupied space — vacancy pays its own way in full.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Asset drawer (map: click your own building) ----------
export function AssetDrawer({ state, setState, asset, close, onSell, onRefi, onLOI, openDeal, onSold }: {
  state: GameState; setState: (s: GameState) => void; asset: Asset; close: () => void;
  onSell: (id: number) => void; onRefi: (id: number) => void; onLOI: (id: number) => void;
  openDeal: (id: number) => void; onSold: (pm: E.PostMortem) => void;
}) {
  return (
    <Modal close={close} wide variant="drawer">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <h2>{asset.name}</h2>
        <button className="btn btn-sm btn-ghost" onClick={close}>Close ✕</button>
      </div>
      <div className="sub">Your building · Block {blockName(state.tiles[asset.tileI])}</div>
      <AssetCard state={state} setState={setState} asset={asset} defaultOpen
        onSell={onSell} onRefi={onRefi} onLOI={onLOI} openDeal={openDeal} onSold={onSold} />
    </Modal>
  );
}

function SaleOfferRow({ state, setState, offer, asset, onSold }: {
  state: GameState; setState: (s: GameState) => void; offer: E.SaleOffer; asset: Asset; onSold: (pm: E.PostMortem) => void;
}) {
  const val = E.assetValue(state, asset);
  // a listed building's offers read against YOUR ask — you set the number, the market
  // answers it. An unsolicited call has no ask; the appraisal is the only yardstick.
  const yardstick = asset.forSale ? asset.forSale.ask : val;
  const yardLabel = asset.forSale ? 'your ask' : 'appraisal';
  const [counter, setCounter] = useState(() => Math.round(Math.max(offer.amount * 1.05, yardstick * 0.97) / 10000) * 10000);
  const act = (action: any) => {
    const r = E.respondSaleOffer(state, offer.id, action);
    setState(r.s);
    if (r.pm) onSold(r.pm);
  };
  return (
    <div className="memo" style={{ borderLeftColor: 'var(--green)', marginBottom: 8 }}>
      <div className="memo-row">
        <span className="lbl"><b style={{ color: 'var(--ink)' }}>{offer.buyer}</b> {asset.forSale ? 'offers' : 'called unsolicited'} · {pct(offer.amount / Math.max(1, yardstick))} of {yardLabel}{asset.forSale ? <span className="faint"> ({pct(offer.amount / Math.max(1, val))} of appraisal)</span> : ''} · expires {E.monthName(offer.expiresM)}{offer.countered ? ' · BEST & FINAL' : ''}</span>
        <b className="num pos">{E.fmtMoney(offer.amount)}</b>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
        <button className="btn btn-sm btn-amber" onClick={() => act({ type: 'accept' })}>Accept {E.fmtMoney(offer.amount)}</button>
        {!offer.countered && (<>
          <input type="number" step={10000} value={counter} onChange={e => setCounter(Number(e.target.value))}
            style={{ width: 130, background: 'var(--panel3)', border: '1px solid var(--line)', color: 'var(--ink)', padding: '5px 8px', borderRadius: 4, fontFamily: 'var(--mono)', fontSize: 12 }} />
          <button className="btn btn-sm" onClick={() => act({ type: 'counter', amount: counter })}>Counter</button>
        </>)}
        <span style={{ flex: 1 }} />
        <button className="btn btn-sm" onClick={() => act({ type: 'decline' })}>Decline</button>
      </div>
    </div>
  );
}

// ---------- The city registry: every standing building, sortable ----------
// The assessor's database, minus the paperwork. Every property in the city with its
// metrics side by side — sort by anything, filter to a sector or an owner, click
// through to the building itself.
type RegRow = {
  kind: 'stock' | 'asset'; id: number; tileI: number; block: string; type: PType; constr: string; name: string;
  sf: number; built: number; q: number; occ: number; owner: string; rent: number; value: number; cap: number; status: string;
};
const REG_COLS: { k: keyof RegRow; label: string; num?: boolean; fmt?: (r: RegRow) => any }[] = [
  { k: 'name', label: 'Property' },
  { k: 'block', label: 'Block' },
  { k: 'owner', label: 'Owner' },
  { k: 'type', label: 'Type', fmt: r => E.PLABEL[r.type] },
  { k: 'sf', label: 'SF', num: true, fmt: r => (r.sf / 1000).toFixed(0) + 'K' },
  { k: 'built', label: 'Built', num: true },
  { k: 'q', label: 'Quality', num: true, fmt: r => `${E.QLABEL[E.qGrade(r.q)]} · ${r.q}` },
  { k: 'occ', label: 'Occ', num: true, fmt: r => r.status === 'U/C' ? '—' : pct(r.occ) },
  { k: 'rent', label: 'Mkt $/SF', num: true, fmt: r => '$' + r.rent.toFixed(2) },
  { k: 'value', label: 'Est. value', num: true, fmt: r => E.fmtMoney(r.value) },
  { k: 'cap', label: 'Mkt cap', num: true, fmt: r => r.cap.toFixed(2) + '%' },
  { k: 'status', label: 'Status' },
];
export function CityRegistryView({ state, openStock, openAsset }: {
  state: GameState; openStock: (id: number) => void; openAsset: (id: number) => void;
}) {
  const [sortK, setSortK] = useState<keyof RegRow>('value');
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [fType, setFType] = useState<string>('all');
  const [fOwner, setFOwner] = useState<string>('all');
  const rows = useMemo<RegRow[]>(() => {
    const out: RegRow[] = [];
    for (const b of state.stock) {
      const t = state.tiles[b.tileI];
      out.push({
        kind: 'stock', id: b.id, tileI: b.tileI, block: blockName(t), type: b.type, constr: b.construction, name: E.stockName(state, b),
        sf: b.sf, built: 2026 - Math.round(b.age), q: Math.round(b.quality), occ: b.buildLeft ? 0 : b.occ,
        owner: b.owner === 'private' ? 'Private' : b.owner,
        rent: E.assetRentPSF(state, { tileI: b.tileI, type: b.type, quality: b.quality, units: b.units, construction: b.construction, mix: b.mix, id: b.id } as any),
        value: E.stockValue(state, b),
        cap: E.capRatePct(state, t, b.type, b.quality),
        status: b.buildLeft ? 'U/C' : b.listedId !== undefined ? 'For sale' : '',
      });
    }
    for (const a of state.assets) {
      const t = state.tiles[a.tileI];
      out.push({
        kind: 'asset', id: a.id, tileI: a.tileI, block: blockName(t), type: a.type, constr: a.construction, name: a.name,
        sf: a.sf, built: 2026 - Math.round(a.age), q: Math.round(a.quality), occ: a.mode === 'construction' ? 0 : a.occ,
        owner: 'You',
        rent: E.assetRentPSF(state, a),
        value: E.assetValue(state, a),
        cap: E.capRatePct(state, t, a.type, a.quality),
        status: a.mode === 'construction' ? 'U/C' : a.forSale ? 'For sale' : a.mode === 'leaseup' ? 'Lease-up' : '',
      });
    }
    return out;
  }, [state]);
  const owners = useMemo(() => ['all', 'You', 'Private', ...state.firms.map(f => f.short)], [state.firms]);
  const shown = rows
    .filter(r => (fType === 'all' || r.type === fType) && (fOwner === 'all' || r.owner === fOwner))
    .sort((a, b) => {
      const av = a[sortK], bv = b[sortK];
      const c = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return c * sortDir;
    });
  const totSF = shown.reduce((s2, r) => s2 + r.sf, 0);
  const totVal = shown.reduce((s2, r) => s2 + r.value, 0);
  const clickSort = (k: keyof RegRow) => {
    if (k === sortK) setSortDir(d => (d === 1 ? -1 : 1));
    else { setSortK(k); setSortDir(REG_COLS.find(c => c.k === k)?.num ? -1 : 1); }
  };
  return (
    <div>
      <div className="panel">
        <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>City registry — every standing building</h3>
          <select value={fType} onChange={e => setFType(e.target.value)}
            style={{ background: 'var(--panel3)', border: '1px solid var(--line)', color: 'var(--ink)', padding: '4px 8px', borderRadius: 4, fontSize: 12 }}>
            <option value="all">All types</option>
            {E.PTYPES.map(ty => <option key={ty} value={ty}>{E.PLABEL[ty]}</option>)}
          </select>
          <select value={fOwner} onChange={e => setFOwner(e.target.value)}
            style={{ background: 'var(--panel3)', border: '1px solid var(--line)', color: 'var(--ink)', padding: '4px 8px', borderRadius: 4, fontSize: 12 }}>
            {owners.map(o => <option key={o} value={o}>{o === 'all' ? 'All owners' : o}</option>)}
          </select>
          <span className="faint" style={{ fontSize: 11.5 }}>
            {shown.length} buildings · {(totSF / 1e6).toFixed(2)}M SF · {E.fmtMoney(totVal)} of value on these filters
          </span>
        </div>
        <div style={{ maxHeight: '68vh', overflowY: 'auto' }}>
          <table className="sc">
            <thead><tr>
              {REG_COLS.map(c => (
                <th key={c.k} onClick={() => clickSort(c.k)} style={{ cursor: 'pointer', userSelect: 'none' }}
                  title="Click to sort">{c.label}{sortK === c.k ? (sortDir === 1 ? ' ▲' : ' ▼') : ''}</th>
              ))}
            </tr></thead>
            <tbody>
              {shown.map(r => (
                <tr key={r.kind + r.id} onClick={() => r.kind === 'asset' ? openAsset(r.id) : openStock(r.id)}
                  style={{ cursor: 'pointer', color: r.owner === 'You' ? 'var(--amber)' : undefined }}>
                  {REG_COLS.map(c => (
                    <td key={c.k} className={c.num ? 'num' : undefined}
                      style={c.k === 'status' && r.status ? { color: r.status === 'For sale' ? 'var(--green)' : 'var(--amber)' } : undefined}>
                      {c.fmt ? c.fmt(r) : String(r[c.k])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="faint" style={{ fontSize: 10.5, marginTop: 6 }}>
          Values are appraisal-grade estimates at today's cap rates — what a building would fetch is a negotiation, not a lookup. Click any row to open the property.
        </div>
      </div>
    </div>
  );
}

// ---------- Refi modal (adjustable) ----------
export function RefiModal({ state, setState, asset, close, variant = 'dialog' }: {
  state: GameState; setState: (s: GameState) => void; asset: Asset; close: () => void; variant?: 'dialog' | 'drawer';
}) {
  const [err, setErr] = useState<string | null>(null);
  const lim = E.refiLimits(state, asset);
  const minAmt = Math.max(lim.payoff, 100000);
  const [amount, setAmount] = useState(() => Math.round(Math.min(lim.maxByLTV, Math.max(minAmt, lim.val * 0.65)) / 10000) * 10000);
  const [amortYears, setAmortYears] = useState(25);
  const [lenderPick, setLenderPick] = useState<string | null>(null);
  const rQuotes = E.lenderQuotesFor(state, { price: lim.val, type: asset.type, quality: asset.quality });
  const rBest = rQuotes.filter(q2 => q2.ok).sort((x, y) => x.ratePct - y.ratePct)[0] ?? null;
  const rSel = rQuotes.find(q2 => q2.lenderId === lenderPick && q2.ok) ?? rBest;
  const effRate = rSel ? rSel.ratePct : lim.rate;
  const effMax = rSel ? Math.round(lim.val * rSel.maxLTV) : lim.maxByLTV;
  // switching desks can shrink the max below the slider's last position — every number
  // and the actual refi run on the clamped amount, not the stale one
  const effAmount = Math.min(amount, Math.max(minAmt, Math.floor(effMax / 10000) * 10000));
  const effPmt = E.monthlyPayment(effAmount, effRate, amortYears);
  const effDscr = effPmt > 0 ? lim.noiYr / (effPmt * 12) : null;
  const netCash = effAmount - lim.payoff - lim.val * 0.01 - effAmount * E.REFI_FEE_PCT;
  return (
    <Modal close={close} variant={variant}>
      <h2>Refinance {asset.name}</h2>
      <div className="sub">Pick a desk, then your proceeds and amortization. The new loan must clear your existing debt and carry 1.20× coverage.</div>
      <div className="memo">
        <div className="memo-row"><span className="lbl">Bank appraisal <Hint text="The bank hires the conservative appraiser: proceeds size off the LOW end of the defensible range, not your mark. Stabilize past 80% leased and the band — and the loan — tightens up." /></span>
          <span className="num">{E.fmtMoney(lim.val, false)} <span className="faint">(your mark {E.fmtMoney(lim.band?.mid ?? lim.val, false)})</span></span></div>
        <div className="memo-row"><span className="lbl">Existing debt to clear</span><span className="num">{E.fmtMoney(lim.payoff)}</span></div>
      </div>
      <div className="memo" style={{ borderLeftColor: 'var(--blue)' }}>
        <div className="eyebrow" style={{ fontSize: 9, margin: '2px 0 4px' }}>Who's quoting this collateral</div>
        {rQuotes.map(q2 => {
          const ld = E.LENDERS.find(x => x.id === q2.lenderId)!;
          if (!q2.ok) return (
            <div key={q2.lenderId} style={{ display: 'flex', gap: 8, padding: '2px 0', fontSize: 12, opacity: 0.55 }}>
              <input type="radio" name="refilender" disabled /><span style={{ minWidth: 128 }}>{ld.short}</span>
              <span className="faint" style={{ fontSize: 10.5 }}>Passed — {q2.why}</span>
            </div>
          );
          return (
            <label key={q2.lenderId} style={{ display: 'flex', gap: 8, padding: '2px 0', cursor: 'pointer', fontSize: 12 }}>
              <input type="radio" name="refilender" checked={rSel?.lenderId === q2.lenderId} onChange={() => setLenderPick(q2.lenderId)} />
              <span style={{ minWidth: 128 }}>{ld.short}{(state.lenderRel?.[q2.lenderId] ?? 20) >= 60 ? ' ★' : ''}</span>
              <span className="num">{q2.ratePct.toFixed(2)}%</span>
              <span className="num dim">≤{Math.round(q2.maxLTV * 100)}% LTV{q2.ioMonths > 0 ? ` · ${q2.ioMonths}mo IO` : ''}</span>
            </label>
          );
        })}
      </div>
      <label className="f">New loan amount — {E.fmtMoney(effAmount)} <span className="faint">({pct(effAmount / Math.max(1, lim.val))} LTV)</span>
        <input type="range" min={minAmt} max={Math.max(minAmt, Math.floor(effMax / 10000) * 10000)} step={10000} value={effAmount}
          onChange={e => setAmount(Number(e.target.value))} />
      </label>
      <label className="f">Amortization — {amortYears} years <Hint text="Longer amortization = lower payment = better DSCR and cash flow, but slower principal paydown and a bigger balloon in 10 years." />
        <input type="range" min={10} max={E.CONFIG.refiAmortMax} value={amortYears} onChange={e => setAmortYears(Number(e.target.value))} />
      </label>
      <div className="memo" style={{ borderLeftColor: 'var(--blue)' }}>
        <div className="memo-row"><span className="lbl">Rate at {rSel ? E.LENDERS.find(x => x.id === rSel.lenderId)?.short : 'the generic desk'}</span><span className="num">{effRate.toFixed(2)}%</span></div>
        <div className="memo-row"><span className="lbl">New debt service ({amortYears}-yr am, 10-yr balloon)</span><span className="num">{E.fmtMoney(effPmt)}/mo</span></div>
        <div className="memo-row"><span className="lbl">DSCR after refi (needs 1.20×)</span>
          <span className={'num ' + (effDscr !== null && effDscr >= 1.2 ? 'pos' : 'neg')}>{effDscr?.toFixed(2) ?? '—'}×</span></div>
        <div className="memo-row total"><span className="lbl">Cash to you (net of costs & {Math.round(E.REFI_FEE_PCT * 100)}% points)</span><span className={'num ' + (netCash > 0 ? 'pos' : 'neg')}>{E.fmtMoney(netCash)}</span></div>
      </div>
      {err && <div className="alert-strip red" style={{ marginBottom: 10 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn" onClick={close}>Not now</button>
        <button className="btn btn-amber" onClick={() => {
          const r = E.doRefi(state, asset.id, { amount: effAmount, amortYears }, rSel?.lenderId);
          if (r.err) setErr(r.err); else { setState(r.s); close(); }
        }}>Refinance</button>
      </div>
    </Modal>
  );
}

// ---------- Debt tab ----------
export function DebtView({ state, setState }: { state: GameState; setState: (s: GameState) => void }) {
  const [sel, setSel] = useState<number[]>([]);
  const [amt, setAmt] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [payAmt, setPayAmt] = useState<Record<number, number>>({});
  const rows: { assetId: number; loanId: number; asset: string; kind: string; balance: number; rate: number; amort: number; io: number; pmt: number; mat: number; floating?: boolean; capStrike?: number; lenderId?: string; isConstr: boolean }[] = [];
  for (const a of state.assets) for (const l of a.loans) {
    rows.push({ assetId: a.id, loanId: l.id, asset: a.name, kind: l.kind === 'acq' ? 'Acquisition' : l.kind === 'constr' ? 'Construction' : 'Refinance', balance: l.balance, rate: l.ratePct, amort: l.amortYears, io: l.ioMonthsLeft, pmt: E.loanMonthlyDS(l), mat: l.maturityMonth, floating: l.floating, capStrike: l.capStrike, lenderId: l.lenderId, isConstr: l.kind === 'constr' });
  }
  const elig = state.assets.filter(a => a.mode === 'operating' && a.occ >= 0.75 && !state.facilities.some(f => f.assetIds.includes(a.id)));
  const q = sel.length >= 2 ? E.facilityQuote(state, sel) : null;
  const totalDS = rows.reduce((s, r) => s + r.pmt, 0) + E.totalFacilityDS(state);
  const dscr = E.portfolioDSCR(state);
  return (
    <div>
      <div className="grid3" style={{ marginBottom: 14 }}>
        <div className="panel stat-lg"><div className="eyebrow">Total debt</div><div className="v num">{E.fmtMoney(rows.reduce((s, r) => s + r.balance, 0) + state.facilities.reduce((s, f) => s + f.balance, 0) + state.land.reduce((s, h) => s + (h.loan?.balance ?? 0), 0))}</div></div>
        <div className="panel stat-lg"><div className="eyebrow">Debt service /mo</div><div className="v num">{E.fmtMoney(totalDS)}</div></div>
        <div className="panel stat-lg"><div className="eyebrow">Portfolio DSCR</div><div className={'v num ' + (dscr !== null && dscr < 1.2 ? 'neg' : '')}>{dscr === null ? '—' : dscr.toFixed(2) + '×'}</div>
          <div className="faint" style={{ fontSize: 10.5, marginTop: 4 }}>Prime rate today: <b className="num" style={{ color: 'var(--ink)' }}>{E.primeRate(state).toFixed(2)}%</b></div></div>
      </div>
      <div className="panel" style={{ marginBottom: 14 }}>
        <h3>Taxes & structure</h3>
        <div className="metric-row">
          <div className="metric"><div className="eyebrow">YTD taxable income <Hint text="NOI minus loan interest minus depreciation. Depreciation is why real estate people smile in April." /></div>
            <div className={'v num ' + (state.taxYr.noi - state.taxYr.interest - state.taxYr.depr > 0 ? '' : 'pos')}>{E.fmtMoney(Math.round(state.taxYr.noi - state.taxYr.interest - state.taxYr.depr))}</div></div>
          <div className="metric"><div className="eyebrow">YTD depreciation</div><div className="v num">{E.fmtMoney(Math.round(state.taxYr.depr))}</div></div>
          <div className="metric"><div className="eyebrow">Loss carryforwards</div><div className="v num">{E.fmtMoney(Math.round(state.nolCarry))}</div></div>
          <div className="metric"><div className="eyebrow">Tax rates</div><div className="v num" style={{ fontSize: 12 }}>{Math.round(E.TAX.income * 100)}% inc · {Math.round(E.TAX.capGains * 100)}% gains · {Math.round(E.TAX.recapture * 100)}% recapture</div></div>
        </div>
        {state.exchange && (
          <div className="alert-strip" style={{ margin: '8px 0' }}>
            ⏱ <b>1031 in progress:</b> close on a building for ≥ {E.fmtMoney(state.exchange.mustSpend)} by {E.monthName(state.exchange.deadlineM)} or {E.fmtMoney(state.exchange.deferred)} of tax from {state.exchange.fromName} comes due.
          </div>
        )}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          <span className="dim" style={{ fontSize: 12 }}>When selling at a gain:</span>
          <div className="seg">
            <button className={!state.prefer1031 ? 'active' : ''} onClick={() => state.prefer1031 && setState(E.setPrefer1031(state, false))}>Pay tax at closing</button>
            <button className={state.prefer1031 ? 'active' : ''} onClick={() => !state.prefer1031 && setState(E.setPrefer1031(state, true))}>Attempt 1031 exchange</button>
          </div>
          <span className="faint" style={{ fontSize: 11 }}>{state.prefer1031 ? 'Deferral with a 6-month redeploy clock — miss it and the bill lands whole.' : 'Predictable, boring, and paid from proceeds.'}</span>
        </div>
      </div>
      <div className="panel" style={{ marginBottom: 14 }}>
        <h3>The lenders <Hint text="Five desks, five appetites. Performing loans build a relationship; a relationship is worth up to 50bps and a phone call that gets answered in a crunch. Defaults are remembered." /></h3>
        {E.LENDERS.map(ld => {
          const rel = state.lenderRel?.[ld.id] ?? 20;
          const posture = E.lenderPosture(state, ld.id);
          return (
            <div key={ld.id} className="memo-row" style={{ gap: 10, borderBottom: '1px solid var(--line2)', alignItems: 'center' }}>
              <span className="lbl" style={{ minWidth: 210 }}><b style={{ color: 'var(--ink)' }}>{ld.name}</b></span>
              <span className={posture === 'open' ? 'pos' : posture === 'tight' ? 'amber' : 'neg'} style={{ fontSize: 11, minWidth: 52 }}>{posture === 'open' ? 'Open' : posture === 'tight' ? 'Tight' : 'Closed'}</span>
              <span style={{ minWidth: 120 }}>
                <span className="occ-bar" style={{ width: 110, display: 'inline-block' }}><span className="occ-fill" style={{ width: rel + '%', background: rel >= 60 ? 'var(--green)' : rel >= 30 ? 'var(--amber)' : 'var(--red)', display: 'block', height: '100%' }} /></span>
              </span>
              <span className="num dim" style={{ fontSize: 11, minWidth: 60 }}>rel {Math.round(rel)}{rel >= 60 ? ' ★' : ''}</span>
              <span className="faint" style={{ flex: 1, fontSize: 11 }}>{ld.blurb}</span>
            </div>
          );
        })}
      </div>
      {(rows.length > 0 || state.facilities.length > 0) && (
        <div className="panel" style={{ marginBottom: 14 }}>
          <h3>Maturity wall <Hint text="Every balloon, in order. The wall is survivable if you refinance early and fatal if you meet it in a credit crunch." /></h3>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {[...rows.map(r => ({ label: r.asset, bal: r.balance, mat: r.mat })),
              ...state.facilities.map(f => ({ label: 'Facility', bal: f.balance, mat: f.maturityMonth }))]
              .sort((a, b) => a.mat - b.mat).map((m, i) => {
                const left = m.mat - state.month;
                return (
                  <div key={i} className="memo" style={{ margin: 0, padding: '6px 10px', borderLeftColor: left <= 6 ? 'var(--red)' : left <= 12 ? 'var(--amber)' : 'var(--line)' }}>
                    <div className="num" style={{ fontSize: 12.5, fontWeight: 700 }}>{E.fmtMoney(m.bal)}</div>
                    <div className="faint" style={{ fontSize: 10.5 }}>{m.label} · {E.monthName(m.mat)} ({left} mo)</div>
                  </div>
                );
              })}
          </div>
        </div>
      )}
      <div className="panel" style={{ marginBottom: 14 }}>
        <h3>Property-level loans</h3>
        {rows.length === 0 ? <div className="dim" style={{ fontSize: 12.5 }}>No property loans outstanding.</div> : (
          <table className="sc">
            <thead><tr><th>Asset</th><th>Type</th><th>Lender</th><th>Balance</th><th>Rate</th><th>Amort</th><th>IO left <Hint text="Interest-only months remaining. New construction loans run 12 months IO after delivery, then start amortizing." /></th><th>Payment /mo</th><th>Balloon <Hint text="When the loan matures, the remaining balance rolls at whatever rates are then — a rate spike at your balloon is how real developers die." /></th><th>Hedge <Hint text="Swap fixed to floating (35bps cheaper today, you wear the rate risk), fix a floater (+35bps for certainty), or buy a rate cap on floating debt — a premium up front for a ceiling that holds." /></th><th>Pay down <Hint text="Prepay principal early: 2% penalty, waived within 12 months of the balloon. Payment stays the same — the term just shortens." /></th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.asset}</td><td className="dim">{r.kind}</td>
                  <td className="dim" style={{ fontSize: 11 }}>{r.lenderId ? E.LENDERS.find(x => x.id === r.lenderId)?.short : '—'}</td>
                  <td className="num">{E.fmtMoney(r.balance)}</td>
                  <td className="num">{r.rate.toFixed(2)}%{r.floating ? <span className="amber" title="floating"> fl</span> : ''}{r.capStrike ? <span className="pos" title={'capped at ' + r.capStrike.toFixed(2) + '%'}> ⌃{r.capStrike.toFixed(1)}</span> : ''}</td>
                  <td className="num">{r.amort} yr</td>
                  <td className="num">{r.io > 0 && r.io < 900 ? r.io + ' mo' : r.io >= 900 ? 'capitalizing' : '—'}</td>
                  <td className="num">{r.io >= 900 ? '—' : E.fmtMoney(r.pmt)}</td>
                  <td className="num">{E.monthName(r.mat)}</td>
                  <td>
                    {r.isConstr ? <span className="faint" style={{ fontSize: 10 }}>at closing</span> : (
                      <div style={{ display: 'flex', gap: 3 }}>
                        {!r.floating && <button className="btn btn-sm" style={{ fontSize: 10, padding: '2px 6px' }} title="Swap to floating: 35bps inside your coupon today, repriced monthly"
                          onClick={() => { const rr = E.swapToFloating(state, r.assetId, r.loanId); if (rr.err) setErr(rr.err); else setState(rr.s); }}>Float</button>}
                        {r.floating && <button className="btn btn-sm" style={{ fontSize: 10, padding: '2px 6px' }} title="Fix at today's base + spread + 35bps"
                          onClick={() => { const rr = E.fixRate(state, r.assetId, r.loanId); if (rr.err) setErr(rr.err); else setState(rr.s); }}>Fix</button>}
                        {r.floating && !r.capStrike && (() => {
                          const a2 = state.assets.find(x => x.id === r.assetId); const l2 = a2?.loans.find(x => x.id === r.loanId);
                          const cq = l2 ? E.rateCapQuote(state, l2) : null;
                          return cq ? <button className="btn btn-sm" style={{ fontSize: 10, padding: '2px 6px' }} title={`Cap at ${cq.strike.toFixed(2)}% for ${E.fmtMoney(cq.premium)} up front`}
                            onClick={() => { const rr = E.buyRateCap(state, r.assetId, r.loanId); if (rr.err) setErr(rr.err); else setState(rr.s); }}>Cap {E.fmtMoney(cq.premium)}</button> : null;
                        })()}
                      </div>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input type="number" step={10000} placeholder="$" value={payAmt[r.loanId] ?? ''}
                        onChange={e => setPayAmt({ ...payAmt, [r.loanId]: Number(e.target.value) })}
                        style={{ width: 92, background: 'var(--panel3)', border: '1px solid var(--line)', color: 'var(--ink)', padding: '3px 6px', borderRadius: 4, fontFamily: 'var(--mono)', fontSize: 11 }} />
                      <button className="btn btn-sm" disabled={!payAmt[r.loanId]}
                        onClick={() => { const rr = E.payDownLoan(state, r.assetId, r.loanId, payAmt[r.loanId] ?? 0); if (rr.err) setErr(rr.err); else { setState(rr.s); setPayAmt({ ...payAmt, [r.loanId]: 0 }); } }}>Pay</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {state.land.some(h => h.loan) && (
        <div className="panel" style={{ marginBottom: 14 }}>
          <h3>Land loans <Hint text="Interest-only carry on banked dirt. Repaid automatically when the dirt sells or you break ground; a balloon you can't meet extends at +150bps." /></h3>
          <table className="sc">
            <thead><tr><th>Dirt</th><th>Balance</th><th>Rate</th><th>Interest /mo</th><th>Balloon</th><th></th></tr></thead>
            <tbody>
              {state.land.filter(h => h.loan).map(h => (
                <tr key={h.id}>
                  <td>Block {blockName(state.tiles[h.tileI])} — {Math.round(h.cells.length * E.PARCEL_AC * 100) / 100} ac</td>
                  <td className="num">{E.fmtMoney(h.loan!.balance)}</td>
                  <td className="num">{h.loan!.ratePct.toFixed(2)}%</td>
                  <td className="num">{E.fmtMoney(h.loan!.balance * h.loan!.ratePct / 100 / 12)}</td>
                  <td className={'num ' + (h.loan!.maturityMonth - state.month <= 6 ? 'neg' : '')}>{E.monthName(h.loan!.maturityMonth)}</td>
                  <td><button className="btn btn-sm" disabled={state.cash < h.loan!.balance}
                    onClick={() => { const rr = E.repayLandLoan(state, h.id); if (rr.err) setErr(rr.err); else setState(rr.s); }}>Repay</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="panel" style={{ marginBottom: 14 }}>
        <h3>Credit facilities (cross-collateralized)</h3>
        {state.facilities.map(f => (
          <div key={f.id} className="memo" style={{ borderLeftColor: 'var(--blue)' }}>
            <div className="memo-row"><span className="lbl">Pledged: {f.assetIds.map(id => state.assets.find(a => a.id === id)?.name ?? '—').join(' + ')}</span>
              <b className="num">{E.fmtMoney(f.balance)}</b></div>
            <div className="memo-row"><span className="lbl">{f.ratePct.toFixed(2)}% · {f.amortYears}-yr am · balloon {E.monthName(f.maturityMonth)}</span>
              <span className="num">{E.fmtMoney(f.monthlyPmt)}/mo</span></div>
            <div className="faint" style={{ fontSize: 10.5 }}>Selling a pledged asset triggers a release payment of its allocated share + 5%.</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <input type="number" step={10000} placeholder="Pay down $" value={payAmt[f.id] ?? ''}
                onChange={e => setPayAmt({ ...payAmt, [f.id]: Number(e.target.value) })}
                style={{ width: 120, background: 'var(--panel3)', border: '1px solid var(--line)', color: 'var(--ink)', padding: '4px 8px', borderRadius: 4, fontFamily: 'var(--mono)', fontSize: 11 }} />
              <button className="btn btn-sm" disabled={!payAmt[f.id]}
                onClick={() => { const rr = E.payDownFacility(state, f.id, payAmt[f.id] ?? 0); if (rr.err) setErr(rr.err); else { setState(rr.s); setPayAmt({ ...payAmt, [f.id]: 0 }); } }}>Pay</button>
            </div>
          </div>
        ))}
        <div className="dim" style={{ fontSize: 12, lineHeight: 1.55, margin: '8px 0' }}>
          Bundle stabilized assets into one loan: cheaper rate (base + {E.CONFIG.facilitySpread}%), up to 65% of pooled value, 25-yr amortization.
          The trade: every pledged building backs every dollar — one problem becomes everyone's problem.
        </div>
        {elig.length < 2 ? (
          <div className="faint" style={{ fontSize: 11.5 }}>You need at least two operating assets at 75%+ occupancy (not already pledged) to create a facility.</div>
        ) : (<>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            {elig.map(a => (
              <button key={a.id} className={'btn btn-sm' + (sel.includes(a.id) ? ' btn-amber' : '')}
                onClick={() => { const ns = sel.includes(a.id) ? sel.filter(x => x !== a.id) : [...sel, a.id]; setSel(ns); if (ns.length >= 2) { const nq = E.facilityQuote(state, ns); setAmt(Math.round(Math.min(nq.maxLoan, Math.max(nq.payoff, nq.val * 0.55)) / 10000) * 10000); } }}>
                {sel.includes(a.id) ? '✓ ' : ''}{a.name} ({E.fmtMoney(E.assetValue(state, a))})
              </button>
            ))}
          </div>
          {q && (<>
            <div className="memo">
              <div className="memo-row"><span className="lbl">Pooled value</span><span className="num">{E.fmtMoney(q.val)}</span></div>
              <div className="memo-row"><span className="lbl">Existing loans to clear</span><span className="num">{E.fmtMoney(q.payoff)}</span></div>
              <div className="memo-row"><span className="lbl">Max facility (65%)</span><span className="num">{E.fmtMoney(q.maxLoan)}</span></div>
            </div>
            <label className="f">Facility size — {E.fmtMoney(amt)}
              <input type="range" min={Math.max(100000, Math.ceil(q.payoff / 10000) * 10000)} max={Math.max(200000, Math.floor(q.maxLoan / 10000) * 10000)} step={10000} value={amt}
                onChange={e => setAmt(Number(e.target.value))} />
            </label>
            {err && <div className="alert-strip red" style={{ marginBottom: 8 }}>{err}</div>}
            <button className="btn btn-amber" onClick={() => {
              const r = E.createFacility(state, sel, amt);
              if (r.err) setErr(r.err); else { setState(r.s); setSel([]); setErr(null); }
            }}>Close the facility — net {E.fmtMoney(amt - q.payoff - amt * 0.01)} to you</button>
          </>)}
        </>)}
      </div>
    </div>
  );
}

// ---------- The Books: where the cash went ----------
// Every dollar in or out lands in the ledger with a category and a name. The month
// you just lived is the default page; the mystery cash hit is now a line item.
export function BooksView({ state, setState }: { state: GameState; setState: (s: GameState) => void }) {
  // remember the MONTH picked, not an offset — advancing time shouldn't silently
  // slide a historical page to a different month
  const [mSel, setMSel] = useState<number | null>(null);
  const m = Math.max(0, mSel ?? state.month);
  const mOff = state.month - m;
  const setMOff = (off: number) => setMSel(off === 0 ? null : state.month - off);
  const log = state.cfLog ?? [];
  const entries = log.filter(e => e.m === m);
  const sum = (cats: E.CFCat[]) => entries.filter(e => cats.includes(e.cat)).reduce((s2, e) => s2 + e.amt, 0);
  const Section = ({ cats, sign }: { cats: E.CFCat[]; sign?: 'pos' | 'neg' }) => (
    <>
      {cats.map(cat => {
        const lines = entries.filter(e => e.cat === cat);
        if (!lines.length) return null;
        const tot = lines.reduce((s2, e) => s2 + e.amt, 0);
        // roll identical labels together (a big portfolio's rent lines stay readable)
        const byLabel = new Map<string, number>();
        for (const l of lines) byLabel.set(l.label, (byLabel.get(l.label) ?? 0) + l.amt);
        return (
          <details key={cat} style={{ borderBottom: '1px solid var(--line2)' }}>
            <summary style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12.5 }}>
              <span>{E.CF_LABEL[cat]} <span className="faint">({byLabel.size})</span></span>
              <b className={'num ' + (tot >= 0 ? (sign === 'neg' ? '' : 'pos') : 'neg')}>{tot >= 0 ? '+' : ''}{E.fmtMoney(tot)}</b>
            </summary>
            {[...byLabel.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([label, amt], i) => (
              <div key={i} className="memo-row" style={{ paddingLeft: 14, fontSize: 11.5 }}>
                <span className="lbl dim">{label}</span>
                <span className={'num ' + (amt >= 0 ? '' : 'dim')}>{amt >= 0 ? '+' : ''}{E.fmtMoney(amt)}</span>
              </div>
            ))}
          </details>
        );
      })}
    </>
  );
  const noi = sum(['rent', 'opex']);
  const opCF = noi + sum(['debt', 'lease-costs', 'capex', 'ga', 'fees', 'tax', 'jv']);
  const net = opCF + sum(['buy', 'sell', 'dev', 'other']);
  const months = Array.from({ length: Math.min(13, state.month + 1) }, (_, i) => state.month - i);
  const gaMo = E.STAFF.reduce((s2, st) => s2 + (state.staff?.[st.id] ? Math.round(st.salary * state.econ.costIdx) : 0), 0);
  return (
    <div>
      <div className="panel" style={{ marginBottom: 14, borderColor: 'var(--amber-dim)' }}>
        <h3>The team <Hint text="Salaries bill monthly whatever the market is doing — that's what G&A means. Each hire moves a real lever in the engine, not a vibe." /></h3>
        <div className="dim" style={{ fontSize: 12, marginBottom: 8 }}>
          Payroll runs {E.fmtMoney(gaMo)}/mo{gaMo > 0 ? ' — it shows up under G&A in the statement below' : ' — right now it’s just you and the spreadsheet'}.
          {(state.assets?.length ?? 0) > 7 && !state.staff?.pm ? <span className="neg"> You self-manage {state.assets.length} buildings: opex runs 5% heavy until you hire a property manager.</span> : null}
        </div>
        {E.STAFF.map(st => {
          const hired = !!state.staff?.[st.id];
          return (
            <div key={st.id} className="memo-row" style={{ gap: 10, borderBottom: '1px solid var(--line2)', alignItems: 'center', padding: '6px 0' }}>
              <span className="lbl" style={{ minWidth: 190, fontSize: 13 }}><b style={{ color: hired ? 'var(--green)' : 'var(--ink)' }}>{hired ? '✓ ' : ''}{st.title}</b></span>
              <span className="num" style={{ minWidth: 90, color: hired ? 'var(--amber)' : 'var(--dim)' }}>{E.fmtMoney(Math.round(st.salary * state.econ.costIdx))}/mo</span>
              <span className="faint" style={{ flex: 1, fontSize: 11 }}>{st.desc}</span>
              <button className={'btn btn-sm' + (hired ? '' : ' btn-amber')} onClick={() => setState(E.setStaffHired(state, st.id, !hired))}>
                {hired ? 'Let go' : 'Hire'}
              </button>
            </div>
          );
        })}
      </div>
      <div className="panel" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <h3 style={{ flex: 1 }}>Income statement — {E.monthName(m)}{mOff === 0 ? ' (this month so far)' : ''}</h3>
          <select value={mOff} onChange={e => setMOff(Number(e.target.value))}
            style={{ background: 'var(--panel3)', border: '1px solid var(--line)', color: 'var(--ink)', padding: '4px 8px', borderRadius: 4, fontSize: 12 }}>
            {months.map((mm, i) => <option key={mm} value={i}>{E.monthName(mm)}{i === 0 ? ' (current)' : ''}</option>)}
          </select>
        </div>
        {entries.length === 0 ? (
          <div className="dim" style={{ fontSize: 12.5, marginTop: 8 }}>Nothing on the books for {E.monthName(m)}{mOff === 0 ? ' yet — advance the month and the lines appear' : ''}.</div>
        ) : (
          <div style={{ marginTop: 6 }}>
            <div className="eyebrow" style={{ margin: '6px 0 2px' }}>Property operations</div>
            <Section cats={['rent', 'opex']} />
            <div className="memo-row" style={{ fontWeight: 700, fontSize: 12.5 }}><span className="lbl">Net operating income</span><span className={'num ' + (noi >= 0 ? 'pos' : 'neg')}>{noi >= 0 ? '+' : ''}{E.fmtMoney(noi)}</span></div>
            <div className="eyebrow" style={{ margin: '10px 0 2px' }}>Below the line</div>
            <Section cats={['debt', 'lease-costs', 'capex', 'ga', 'fees', 'tax', 'jv']} sign="neg" />
            <div className="memo-row" style={{ fontWeight: 700, fontSize: 12.5 }}><span className="lbl">Operating cash flow</span><span className={'num ' + (opCF >= 0 ? 'pos' : 'neg')}>{opCF >= 0 ? '+' : ''}{E.fmtMoney(opCF)}</span></div>
            <div className="eyebrow" style={{ margin: '10px 0 2px' }}>Capital events</div>
            <Section cats={['buy', 'sell', 'dev', 'other']} />
            <div className="memo-row total" style={{ fontWeight: 700, fontSize: 13 }}><span className="lbl">Net change in cash</span><span className={'num ' + (net >= 0 ? 'pos' : 'neg')}>{net >= 0 ? '+' : ''}{E.fmtMoney(net)}</span></div>
          </div>
        )}
      </div>
      <div className="panel" style={{ marginBottom: 14 }}>
        <h3>Trailing 12 months</h3>
        <table className="sc">
          <thead><tr><th style={{ textAlign: 'left' }}>Month</th><th>NOI</th><th>Operating CF</th><th>Net Δ cash</th></tr></thead>
          <tbody>
            {months.slice(0, 12).map(mm => {
              const es = log.filter(e => e.m === mm);
              const s3 = (cats: E.CFCat[]) => es.filter(e => cats.includes(e.cat)).reduce((s4, e) => s4 + e.amt, 0);
              const noi2 = s3(['rent', 'opex']);
              const op2 = noi2 + s3(['debt', 'lease-costs', 'capex', 'ga', 'fees', 'tax', 'jv']);
              const net2 = op2 + s3(['buy', 'sell', 'dev', 'other']);
              return (
                <tr key={mm} onClick={() => setMOff(state.month - mm)} style={{ cursor: 'pointer' }}>
                  <td style={{ textAlign: 'left' }}>{E.monthName(mm)}</td>
                  <td className="num">{E.fmtMoney(noi2)}</td>
                  <td className={'num ' + (op2 >= 0 ? 'pos' : 'neg')}>{E.fmtMoney(op2)}</td>
                  <td className={'num ' + (net2 >= 0 ? 'pos' : 'neg')}>{E.fmtMoney(net2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="faint" style={{ fontSize: 10.5, marginTop: 6 }}>Click a row to open that month. The books keep 24 months; older lines age out.</div>
      </div>
    </div>
  );
}
