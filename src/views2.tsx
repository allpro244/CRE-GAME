import { useState } from 'react';
import * as E from './engine';
import type { GameState, Listing, Asset, DevChoice, PType, LOI } from './engine';

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

// ---------- Procedural elevation sketch ----------
export function BuildingSketch({ a, w = 300, h = 110 }: {
  a: { type: PType; construction: string; sf: number; units: number; quality: number }; w?: number; h?: number;
}) {
  const g = E.qGrade(a.quality);
  const stroke = 'var(--amber-dim)';
  const fill = 'rgba(217,166,72,0.06)';
  const el: any[] = [];
  const gy = h - 16, gw = w - 36;
  el.push(<line key="g" x1={6} y1={gy} x2={w - 6} y2={gy} stroke="var(--line)" strokeWidth={1.5} />);
  const c = a.construction;
  if (a.type === 'office') {
    const floors = Math.max(2, Math.min(14, Math.round(a.sf / 9000) + (c === 'concrete' ? 3 : 0)));
    const bw = Math.min(gw, 120 + Math.sqrt(a.sf) * 0.5);
    const bh = Math.min(gy - 12, floors * 7 + 8);
    const bx = (w - bw) / 2;
    el.push(<rect key="b" x={bx} y={gy - bh} width={bw} height={bh} fill={fill} stroke={stroke} strokeWidth={1.2} />);
    for (let f = 1; f < Math.min(floors, Math.floor(bh / 7)); f++) {
      el.push(<line key={'f' + f} x1={bx} y1={gy - f * 7 - 4} x2={bx + bw} y2={gy - f * 7 - 4} stroke={stroke} strokeWidth={0.5} opacity={0.6} />);
    }
    if (c === 'concrete') el.push(<rect key="crown" x={bx + bw * 0.3} y={gy - bh - 6} width={bw * 0.4} height={6} fill="none" stroke={stroke} strokeWidth={1} />);
    if (c === 'wood') el.push(<polygon key="roof" points={`${bx - 4},${gy - bh} ${bx + bw + 4},${gy - bh} ${bx + bw / 2},${gy - bh - 12}`} fill="none" stroke={stroke} strokeWidth={1} />);
    for (let vx = 1; vx < 6; vx++) el.push(<line key={'v' + vx} x1={bx + (bw / 6) * vx} y1={gy - bh + 3} x2={bx + (bw / 6) * vx} y2={gy - 2} stroke={stroke} strokeWidth={0.4} opacity={0.45} />);
  } else if (a.type === 'industrial') {
    const bw = Math.min(gw, 140 + Math.sqrt(a.sf) * 0.6);
    const bh = 42;
    const bx = (w - bw) / 2;
    el.push(<rect key="b" x={bx} y={gy - bh} width={bw} height={bh} fill={fill} stroke={stroke} strokeWidth={1.2} />);
    if (c === 'tilt') {
      const n = 6;
      for (let i = 1; i < n; i++) el.push(<line key={'p' + i} x1={bx + (bw / n) * i} y1={gy - bh} x2={bx + (bw / n) * i} y2={gy} stroke={stroke} strokeWidth={0.8} opacity={0.7} />);
      el.push(<rect key="cl" x={bx + bw * 0.06} y={gy - bh - 8} width={bw * 0.22} height={8} fill={fill} stroke={stroke} strokeWidth={1} />);
    } else {
      el.push(<polygon key="roof" points={`${bx},${gy - bh} ${bx + bw},${gy - bh} ${bx + bw / 2},${gy - bh - 10}`} fill="none" stroke={stroke} strokeWidth={1} />);
      const n = c === 'tin' ? 22 : 12;
      for (let i = 1; i < n; i++) el.push(<line key={'r' + i} x1={bx + (bw / n) * i} y1={gy - bh} x2={bx + (bw / n) * i} y2={gy} stroke={stroke} strokeWidth={0.35} opacity={0.5} />);
    }
    const doors = Math.min(5, Math.max(1, Math.round(a.sf / 12000)));
    for (let d = 0; d < doors; d++) {
      el.push(<rect key={'d' + d} x={bx + bw * 0.55 + d * 26} y={gy - 18} width={18} height={18} fill="none" stroke={stroke} strokeWidth={0.9} />);
    }
  } else if (a.type === 'retail') {
    const bw = Math.min(gw, 130 + Math.sqrt(a.sf) * 0.7);
    const bh = c === 'pad' ? 26 : 30;
    const bx = (w - bw) / 2;
    el.push(<rect key="b" x={bx} y={gy - bh} width={bw} height={bh} fill={fill} stroke={stroke} strokeWidth={1.2} />);
    el.push(<rect key="par" x={bx} y={gy - bh - 7} width={bw} height={7} fill="none" stroke={stroke} strokeWidth={1} />);
    const n = c === 'pad' ? 1 : Math.min(a.units, 10);
    for (let i = 0; i < n; i++) {
      const sx = bx + (bw / n) * i;
      el.push(<rect key={'s' + i} x={sx + 3} y={gy - bh + 8} width={bw / n - 6} height={bh - 10} fill="none" stroke={stroke} strokeWidth={0.6} opacity={0.75} />);
      if (i > 0) el.push(<line key={'dv' + i} x1={sx} y1={gy - bh} x2={sx} y2={gy} stroke={stroke} strokeWidth={0.5} opacity={0.5} />);
    }
    if (c === 'center') el.push(<rect key="anchor" x={bx - 14} y={gy - bh - 14} width={26} height={bh + 14} fill={fill} stroke={stroke} strokeWidth={1} />);
    if (c === 'pad') el.push(<circle key="drv" cx={bx + bw + 16} cy={gy - 8} r={7} fill="none" stroke={stroke} strokeWidth={0.7} strokeDasharray="2 2" />);
  } else if (a.type === 'multifamily') {
    const c2 = a.construction;
    if (c2 === 'garden') {
      const n = Math.min(4, Math.max(2, Math.round(a.units / 12)));
      const bw = Math.min(gw / n - 8, 92);
      const totalW = n * (bw + 8) - 8;
      const x0 = (w - totalW) / 2;
      for (let i = 0; i < n; i++) {
        const bx = x0 + i * (bw + 8), bh = 30;
        el.push(<rect key={'g' + i} x={bx} y={gy - bh} width={bw} height={bh} fill={fill} stroke={stroke} strokeWidth={1.1} />);
        el.push(<path key={'r' + i} d={`M${bx - 3} ${gy - bh} L${bx + bw / 2} ${gy - bh - 9} L${bx + bw + 3} ${gy - bh}`} fill="none" stroke={stroke} strokeWidth={1} />);
        for (let wn = 0; wn < 3; wn++) el.push(<rect key={'w' + i + '-' + wn} x={bx + 6 + wn * (bw / 3)} y={gy - bh + 6} width={bw / 4.4} height={7} fill="none" stroke={stroke} strokeWidth={0.5} opacity={0.7} />);
      }
    } else {
      const bw = Math.min(gw, 100 + Math.sqrt(a.sf) * 0.5);
      const bx = (w - bw) / 2;
      const bh = Math.min(gy - 12, c2 === 'tower' ? 30 + Math.round(a.sf / 4200) * 5 : 24 + Math.round(a.sf / 6500) * 5);
      el.push(<rect key="b" x={bx} y={gy - bh} width={bw} height={bh} fill={fill} stroke={stroke} strokeWidth={1.2} />);
      const floors = Math.max(2, Math.floor(bh / 9));
      for (let f = 1; f < floors; f++) {
        el.push(<line key={'f' + f} x1={bx} y1={gy - f * 9} x2={bx + bw} y2={gy - f * 9} stroke={stroke} strokeWidth={0.4} opacity={0.55} />);
        el.push(<rect key={'bal' + f} x={bx - 4} y={gy - f * 9 - 4} width={4} height={4} fill="none" stroke={stroke} strokeWidth={0.5} opacity={0.7} />);
        el.push(<rect key={'bal2' + f} x={bx + bw} y={gy - f * 9 - 4} width={4} height={4} fill="none" stroke={stroke} strokeWidth={0.5} opacity={0.7} />);
      }
      el.push(<rect key="lobby" x={bx + bw * 0.4} y={gy - 9} width={bw * 0.2} height={9} fill="none" stroke={stroke} strokeWidth={0.8} />);
    }
  } else {
    const bw = Math.min(gw, 120 + Math.sqrt(a.sf) * 0.5);
    const bx = (w - bw) / 2;
    const podH = 20, twrH = Math.min(gy - podH - 14, 26 + Math.round(a.sf / 5000) * 5);
    el.push(<rect key="pod" x={bx} y={gy - podH} width={bw} height={podH} fill={fill} stroke={stroke} strokeWidth={1.2} />);
    const nSt = Math.min(6, Math.max(2, Math.round(a.units / 3)));
    for (let i = 1; i < nSt; i++) el.push(<line key={'st' + i} x1={bx + (bw / nSt) * i} y1={gy - podH} x2={bx + (bw / nSt) * i} y2={gy} stroke={stroke} strokeWidth={0.5} opacity={0.6} />);
    el.push(<rect key="twr" x={bx + bw * 0.18} y={gy - podH - twrH} width={bw * 0.64} height={twrH} fill={fill} stroke={stroke} strokeWidth={1.1} />);
    for (let f = 1; f < Math.floor(twrH / 8); f++) el.push(<line key={'tf' + f} x1={bx + bw * 0.18} y1={gy - podH - f * 8} x2={bx + bw * 0.82} y2={gy - podH - f * 8} stroke={stroke} strokeWidth={0.4} opacity={0.55} />);
  }
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', maxWidth: w, display: 'block' }}>
      {el}
      <text x={w - 8} y={12} textAnchor="end" fill="var(--faint)" fontSize={8} fontFamily="var(--mono)">
        {E.constrSpec(a).label.toUpperCase()} · {QorDash(g)} · {(a.sf / 1000).toFixed(0)}K SF{a.units > 1 ? ` · ${a.units} ${a.type === 'multifamily' ? 'APTS' : 'UNITS'}` : ''}
      </text>
    </svg>
  );
}
function QorDash(g: number) { return 'CLASS ' + E.QLABEL[g]; }

// ---------- Rent roll table ----------
export function RentRollTable({ state, tenants, sf, retailOf }: {
  state: GameState; tenants: E.Tenant[]; sf: number;
  retailOf?: { tileI: number; quality: number };
}) {
  if (tenants.length === 0) return <div className="dim" style={{ fontSize: 12, padding: '6px 0' }}>Vacant — no tenants in place.</div>;
  const sorted = [...tenants].sort((a, b) => b.sf - a.sf);
  return (
    <table className="sc">
      <thead><tr><th>Tenant</th><th>SF</th><th>Rate</th><th>Base rent /mo</th>
        {retailOf && <th>Sales /SF <Hint text="Estimated gross sales. Past the breakpoint (market rent ÷ a 9% occupancy-cost norm) you collect 6% of sales as percentage rent. Overage means the trade is outrunning the rents — draw your own conclusion." /></th>}
        {retailOf && <th>Overage /mo</th>}
        <th>Term ends</th><th>Credit <Hint text="A-credit tenants almost never miss rent. C-credit tenants are where vacancies come from — especially in recessions." /></th></tr></thead>
      <tbody>
        {sorted.map(t => {
          const sales = retailOf ? E.tenantSalesPSF(state, retailOf, t) : 0;
          const over = retailOf ? Math.max(0, sales - E.retailBreakpointPSF(state, retailOf.tileI)) * E.PCT_RENT_RATE * t.sf / 12 : 0;
          return (
            <tr key={t.id}>
              <td>{t.name}</td>
              <td className="num">{(t.sf / 1000).toFixed(1)}K <span className="faint">({pct(t.sf / sf)})</span></td>
              <td className="num">${t.rate.toFixed(2)}</td>
              <td className="num">{E.fmtMoney(t.sf * t.rate / 12)}</td>
              {retailOf && <td className="num">${sales.toFixed(0)}</td>}
              {retailOf && <td className={'num ' + (over > 0 ? 'pos' : 'faint')}>{over > 0 ? '+' + E.fmtMoney(over) : '—'}</td>}
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
                    {((l.sf ?? 0) / 1000).toFixed(0)}K SF · {pct(l.occ ?? 0)} leased · {E.QLABEL[E.qGrade(l.quality ?? 50)]}-grade · {l.units} unit{(l.units ?? 1) > 1 ? 's' : ''}
                  </div>
                  <div className="faint" style={{ fontSize: 10.5 }}>
                    {l.agreed ? `Close by ${E.monthName(l.expiresMonth)} or they walk` : `${l.offersLeft} offer${(l.offersLeft ?? 0) === 1 ? '' : 's'} of patience left · gone by ${E.monthName(l.expiresMonth)}`}
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
        Rivals shop this same board; <span style={{ color: '#e08c8c' }}>hot</span> listings won't wait.
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
      return { l, t, land: true, psf: l.price / Math.max(1, (l.acres ?? 0.25) * 43_560), cap: null as number | null, cf: null as number | null, note: `${l.acres} ac · ${E.PLABEL[bestFit.ty]} ${bestFit.f > 1.1 ? 'strong' : bestFit.f > 0.85 ? 'fair' : 'weak'}` };
    }
    const pf = E.proFormaBuilding(state, l);
    const ltv = E.maxLTV(state, l.type);
    const pmt = E.monthlyPayment(l.price * ltv, rate, E.CONFIG.acqAmortYears);
    return { l, t, land: false, psf: (l.price) / Math.max(1, l.sf ?? 1), cap: pf.capNow, cf: pf.noiNow / 12 - pmt, note: `${pct(l.occ ?? 0)} leased · ${E.QLABEL[E.qGrade(l.quality ?? 50)]} · ${l.age} yrs` };
  });
  const dir = sort.asc ? 1 : -1;
  const val = (r: typeof rows[0]): number => {
    if (sort.by === 'price') return r.l.price;
    if (sort.by === 'sf') return r.l.kind === 'land' ? (r.l.acres ?? 0) * 43560 * 0.001 : (r.l.sf ?? 0);
    if (sort.by === 'psf') return r.psf ?? -1;
    if (sort.by === 'cf') return r.cf ?? -1e18;
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
          <th style={{ textAlign: 'left' }}>Type</th><th style={{ textAlign: 'left' }}>Block</th>
          <Th id="price" label="Price" /><Th id="sf" label="SF" /><Th id="psf" label="$/SF" />
          <Th id="cap" label="Cap" /><Th id="cf" label="CF/mo @ max LTV" />
          <th style={{ textAlign: 'left' }}>Notes</th>
        </tr></thead>
        <tbody>
          {rows.map(({ l, t, land, psf, cap, cf, note }) => (
            <tr key={l.id} onClick={() => openDeal(l.id)} style={{ cursor: 'pointer' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--panel2)')}
              onMouseLeave={e => (e.currentTarget.style.background = '')}>
              <td>
                {land ? <span className="chip chip-land">Land</span> : <span className="chip chip-type">{E.PLABEL[l.type!]}</span>}
                {l.distressed && <span className="chip chip-distress" style={{ marginLeft: 4 }}>D</span>}
                {l.hot && <span className="chip chip-hot" style={{ marginLeft: 4 }}>Hot</span>}
              </td>
              <td className="num dim">{blockName(t)} <span className="faint" style={{ fontSize: 9 }}>▸ map</span></td>
              <td className="num">{E.fmtMoney(l.price)}</td>
              <td className="num">{land ? `${l.acres} ac` : `${((l.sf ?? 0) / 1000).toFixed(0)}K`}</td>
              <td className="num">{psf !== null ? '$' + psf.toFixed(0) : '—'}</td>
              <td className={'num ' + (cap !== null && cap > rate ? 'pos' : 'dim')}>{cap !== null ? cap.toFixed(2) + '%' : '—'}</td>
              <td className={'num ' + (cf === null ? 'dim' : cf >= 0 ? 'pos' : 'neg')}>{cf !== null ? E.fmtMoney(cf) : '—'}</td>
              <td className="dim" style={{ textAlign: 'left', fontSize: 11 }}>{note}{l.feasDone ? ' · feas ✓' : ''}{l.declinedYou ? <span className="neg"> · won't deal</span> : ''} <span className="faint">to {E.monthName(l.expiresMonth)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="faint" style={{ fontSize: 10.5, margin: '6px 2px' }}>
        Cap and CF are underwritten on in-place income at the asking price, max leverage. Your offer changes both — that negotiation happens on the map.
      </div>
    </div>
  );
}

// ---------- Deal modal (building / off-market / land) ----------
export function DealModal({ state, listing, setState, close, variant = 'dialog' }: {
  state: GameState; listing: Listing; setState: (s: GameState) => void; close: () => void;
  variant?: 'dialog' | 'drawer';
}) {
  const t = state.tiles[listing.tileI];
  const [err, setErr] = useState<string | null>(null);
  const [downPct, setDownPct] = useState(0.35);
  const [offerAmt, setOfferAmt] = useState(() => listing.kind === 'land' ? 0
    : Math.round(((listing.kind === 'offmarket' && listing.noAsk) ? E.proFormaBuilding(state, { ...listing, price: 1 }).stabValue * 0.8 : listing.price * (listing.kind === 'offmarket' ? 0.9 : 0.94)) / 10000) * 10000);
  const [omMsg, setOmMsg] = useState<string | null>(listing.counterAt ? `They countered at ${E.fmtMoney(listing.counterAt)}. Meet it, beat it, or walk.` : null);
  const [useJV, setUseJV] = useState(false);
  const firstConstr = CONSTR0(listing, state);
  const [dev, setDev] = useState<DevChoice>(() => ({
    type: firstConstr.type, sf: Math.min(10000, E.maxBuildableSF(listing, firstConstr.type) || 10000),
    units: defaultUnits(firstConstr.type, firstConstr.construction, 10000),
    construction: firstConstr.construction,
    contractor: 'standard', contingencyPct: 0.10, expedited: false, downPct: 0.35, fixedRate: false,
    contractType: 'costplus', bonded: false,
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
    const effPrice = listing.agreed ? listing.price : (offerAmt > 0 ? offerAmt : listing.price);
    const capEff = effPrice > 0 ? (pf.noiNow / effPrice) * 100 : 0;
    const loan = effPrice * (1 - downPct);
    const rate = state.econ.rate + E.CONFIG.acqSpread;
    const pmt = E.monthlyPayment(loan, rate, E.CONFIG.acqAmortYears);
    const dscr = loan > 0 ? pf.noiNow / (pmt * 12) : null;
    const ltvMax = E.maxLTV(state, listing.type);
    const cashNeeded = effPrice * downPct + 15000;
    const sketch = { type: listing.type!, construction: listing.construction ?? E.CONSTR[listing.type!][0].id, sf: listing.sf!, units: listing.units ?? 1, quality: listing.quality ?? 50 };
    return (
      <Modal close={close} wide variant={variant}>
        <h2>{E.PLABEL[listing.type!]} — Block {blockName(t)} {listing.kind === 'offmarket' && <span className="chip chip-om" style={{ verticalAlign: 'middle' }}>Off-market</span>}</h2>
        <div className="sub">
          {((listing.sf ?? 0) / 1000).toFixed(0)}K SF on {listing.acres} acres · {listing.units} unit{(listing.units ?? 1) > 1 ? 's' : ''} · {E.QLABEL[E.qGrade(listing.quality ?? 50)]}-grade {E.constrSpec(sketch).label.toLowerCase()} · built {2026 - (listing.age ?? 10)}
          {listing.distressed && <span className="amber"> · distressed — priced to move</span>}
        </div>
        <BuildingSketch a={sketch} w={460} h={110} />
        {(listing as any).rivalBid && (
          <div className="alert-strip red" style={{ marginBottom: 10 }}>
            <span>⚔ <b>{(listing as any).rivalName}</b> bid {E.fmtMoney((listing as any).rivalBid)} on your agreed deal. Match by month's end or lose it.</span>
            <button className="btn btn-sm btn-amber" onClick={() => { const r = E.matchRivalBid(state, listing.id); if (!r.err) setState(r.s); }}>Match {E.fmtMoney((listing as any).rivalBid)}</button>
          </div>
        )}
        {listing.declinedYou && (
          <div className="alert-strip red" style={{ marginBottom: 10 }}>This seller won't deal with you after your last offer. Brokers talk.</div>
        )}
        {!listing.agreed && !listing.declinedYou && (
          <div className="memo" style={{ borderLeftColor: 'var(--amber)' }}>
            <div className="memo-row"><span className="lbl">{listing.kind === 'offmarket' ? (listing.noAsk ? 'Seller named no price — open with a number' : `Seller's ask`) : 'Asking price — or negotiate below it'}</span>
              <b className="num">{listing.kind === 'offmarket' && listing.noAsk ? '—' : E.fmtMoney(listing.price, false)}</b></div>
            {omMsg && <div style={{ fontSize: 12, color: 'var(--amber)', padding: '4px 0' }}>{omMsg}</div>}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
              <input type="number" step={10000} value={offerAmt} onChange={e => setOfferAmt(Number(e.target.value))}
                style={{ flex: 1, background: 'var(--panel3)', border: '1px solid var(--line)', color: 'var(--ink)', padding: '7px 10px', borderRadius: 4, fontFamily: 'var(--mono)', fontSize: 13 }} />
              <button className="btn btn-amber" onClick={() => {
                const r = E.makeOffer(state, listing.id, offerAmt);
                setState(r.s);
                if (r.result === 'accepted') { setOmMsg(null); }
                else if (r.result === 'countered') { setOmMsg(`They countered at ${E.fmtMoney(r.counter!)} — that's their ask now. Meet it, beat it, or walk.`); setOfferAmt(r.counter!); }
                else if (r.result === 'declined') { close(); }
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
          {listing.feasDone ? (<>
            <div className="memo-row"><span className="lbl">Stabilized NOI (at ~{pct(pf.tOcc)}, market rents)</span><span className="num">{E.fmtMoney(pf.noiStab)}/yr</span></div>
            <div className="memo-row"><span className="lbl">Market cap rate for this block/grade</span><span className="num">{pf.cap.toFixed(2)}%</span></div>
            <div className="memo-row"><span className="lbl">Weighted avg lease term</span><span className="num">{pf.walt.toFixed(1)} yrs</span></div>
            {canBuy && <div className="memo-row total"><span className="lbl">Stabilized value estimate</span><span className={'num ' + (pf.upside > 0 ? 'pos' : 'neg')}>{E.fmtMoney(pf.stabValue)} ({pf.upside >= 0 ? '+' : ''}{E.fmtMoney(pf.upside)} vs. price)</span></div>}
          </>) : (
            <div className="memo-row"><span className="lbl">Stabilized value, upside & full rent roll</span>
              <button className="btn btn-sm" onClick={runFeas}>Run feasibility — {E.fmtMoney(E.CONFIG.feasCost)}</button></div>
          )}
        </div>
        {listing.feasDone && (<>
          <h3 style={{ marginTop: 2 }}>{isMF ? 'Unit economics' : 'Rent roll in place'}</h3>
          {isMF ? (
            <div className="dim" style={{ fontSize: 12.5, padding: '4px 0 8px' }}>
              {listing.units} apartments · {Math.round((listing.occ ?? 0) * (listing.units ?? 0))} occupied · avg in-place rent {E.fmtMoney((listing.sf! * E.assetRentPSF(state, { tileI: listing.tileI, type: listing.type!, quality: listing.quality!, units: listing.units ?? 1, construction: listing.construction ?? 'garden' } as any) * (listing.occ ?? 0)) / 12 / Math.max(1, Math.round((listing.occ ?? 0) * (listing.units ?? 1))))}/unit/mo.
              Residential leases turn over fast and re-lease fast — occupancy is the whole game.
            </div>
          ) : <RentRollTable state={state} tenants={listing.tenants ?? []} sf={listing.sf!} retailOf={listing.type === 'retail' ? { tileI: listing.tileI, quality: listing.quality ?? 50 } : undefined} />}
        </>)}
        {canBuy && (<>
          <label className="f" style={{ marginTop: 10 }}>Down payment — {pct(downPct)} ({E.fmtMoney(effPrice * downPct)}) <span className="faint">at your {E.fmtMoney(effPrice)} {listing.agreed ? 'agreed price' : 'offer'}</span>
            <input type="range" min={Math.ceil((1 - ltvMax) * 100)} max={100} value={Math.round(downPct * 100)}
              onChange={e => setDownPct(Number(e.target.value) / 100)} />
          </label>
          <div className="memo" style={{ borderLeftColor: 'var(--blue)' }}>
            <div className="memo-row"><span className="lbl">Loan ({pct(1 - downPct)} LTV, max {pct(ltvMax)}) · {rate.toFixed(2)}% · 30-yr am · 10-yr balloon</span><span className="num">{E.fmtMoney(loan)}</span></div>
            <div className="memo-row"><span className="lbl">Debt service</span><span className="num">{E.fmtMoney(pmt * 12)}/yr <span className="faint">({E.fmtMoney(pmt)}/mo)</span></span></div>
            <div className="memo-row"><span className="lbl">DSCR on in-place income <Hint text="NOI ÷ annual debt service. The bank wants 1.25×+. Distressed and off-market deals can close on bridge terms as low as 0.9×." /></span>
              <span className={'num ' + (dscr === null ? '' : dscr >= 1.25 ? 'pos' : 'neg')}>{dscr === null ? '—' : dscr.toFixed(2) + '×'}</span></div>
            {(() => {
              const eq = effPrice * downPct;
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
            <div className="memo-row total"><span className="lbl">Cash needed (incl. $15K closing)</span>
              <span className={'num ' + (state.cash >= (useJV && E.canJV(state, effPrice * downPct).ok ? Math.round(effPrice * downPct * 0.3) + 15000 : cashNeeded) ? '' : 'neg')}>{E.fmtMoney(useJV && E.canJV(state, effPrice * downPct).ok ? Math.round(effPrice * downPct * 0.3) + 15000 : cashNeeded)}</span></div>
          </div>
          {(listing.type === 'retail' || listing.type === 'industrial') && <div className="faint" style={{ fontSize: 10.5, margin: '-4px 0 8px' }}>NNN leases: tenants reimburse taxes, insurance, and CAM on their occupied share. Vacancy eats those costs raw.</div>}
        </>)}
        {err && <div className="alert-strip red" style={{ marginBottom: 10 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={close}>{canBuy ? 'Pass' : 'Step away'}</button>
          {canBuy && <button className="btn btn-amber" onClick={() => {
            const r = E.buyBuilding(state, listing.id, downPct, useJV);
            if (r.err) setErr(r.err); else { setState(r.s); close(); }
          }}>Buy at {E.fmtMoney(listing.price)}{useJV ? ' (JV)' : ''}{!listing.agreed && effPrice !== listing.price ? ' (ask)' : ''}</button>}
        </div>
      </Modal>
    );
  }

  // ---------- land ----------
  const spec = E.CONSTR[dev.type].find(x => x.id === dev.construction) ?? E.CONSTR[dev.type][0];
  const bMax = Math.min(E.maxBuildableSF(listing, dev.type), E.CONFIG.tiers[state.tier].maxSF, spec.maxSF ?? Infinity);
  const bd = E.devCostBreakdown(state, dev, listing.price);
  const maxLoan = bd.total * (E.CONFIG.constrLTC - (state.econ.crunchMonthsLeft > 0 ? 0.1 : 0));
  const equity = Math.max(bd.total * dev.downPct, bd.total - maxLoan);
  const pf = listing.feasDone ? E.proFormaLand(state, listing, dev) : null;
  const vErr = E.validateDev(state, listing, dev);
  const suitTxt = (ty: PType) => { const f = E.tileDemandFactor(state, t, ty); return f > 1.1 ? 'strong' : f > 0.85 ? 'fair' : 'weak'; };
  const setType = (ty: PType) => {
    const c0 = E.CONSTR[ty][ty === 'industrial' ? 1 : 1] ?? E.CONSTR[ty][0];
    const sf = Math.min(dev.sf, E.maxBuildableSF(listing, ty) || 5000);
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
      {!listing.agreed && !listing.declinedYou && !listing.parentAssetId && (
        <div className="memo" style={{ borderLeftColor: 'var(--amber)' }}>
          <div className="memo-row"><span className="lbl">Asking {E.fmtMoney(listing.price)} — or open with your own number</span></div>
          {omMsg && <div style={{ fontSize: 12, color: 'var(--amber)', padding: '4px 0' }}>{omMsg}</div>}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
            <input type="number" step={10000} value={offerAmt || Math.round(listing.price * 0.94 / 10000) * 10000}
              onChange={e => setOfferAmt(Number(e.target.value))}
              style={{ flex: 1, background: 'var(--panel3)', border: '1px solid var(--line)', color: 'var(--ink)', padding: '7px 10px', borderRadius: 4, fontFamily: 'var(--mono)', fontSize: 13 }} />
            <button className="btn btn-amber" onClick={() => {
              const amt = offerAmt || Math.round(listing.price * 0.94 / 10000) * 10000;
              const r = E.makeOffer(state, listing.id, amt);
              setState(r.s);
              if (r.result === 'countered') { setOmMsg(`They countered at ${E.fmtMoney(r.counter!)} — that's the new ask.`); setOfferAmt(r.counter!); }
              else if (r.result === 'declined') close();
              else if (r.result === 'accepted') setOmMsg(null);
            }}>Make offer</button>
          </div>
          <div className="faint" style={{ fontSize: 10.5, marginTop: 6 }}>{listing.offersLeft ?? 1} offer{(listing.offersLeft ?? 1) === 1 ? '' : 's'} of patience. Landowners bruise like everyone else.</div>
        </div>
      )}
      {listing.agreed && <div className="alert-strip" style={{ marginBottom: 10 }}>Price agreed at {E.fmtMoney(listing.price)} ✓ — close before {E.monthName(listing.expiresMonth)} or they re-list.</div>}
      <div className="dim" style={{ fontSize: 11.5, marginBottom: 10 }}>
        Coverage limits what the dirt can hold: at a {pct(E.FAR[dev.type], 0)} floor-area ratio for {E.PLABEL[dev.type].toLowerCase()}, this parcel supports up to <b className="num" style={{ color: 'var(--ink)' }}>{(E.maxBuildableSF(listing, dev.type) / 1000).toFixed(0)}K SF</b>. Your tier caps projects at {E.CONFIG.tiers[state.tier].maxSF / 1000}K SF.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <label className="f">Product type
          <select value={dev.type} onChange={e => setType(e.target.value as PType)}>
            {E.PTYPES.map(ty => (
              <option key={ty} value={ty} disabled={ty === 'mixed' && state.tier < 1}>
                {E.PLABEL[ty]} — demand {suitTxt(ty)}{ty === 'mixed' && state.tier < 1 ? ' (Tier 2)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="f">Construction
          <select value={dev.construction} onChange={e => setConstr(e.target.value)}>
            {E.CONSTR[dev.type].map(c => (
              <option key={c.id} value={c.id}>{c.label} — ${c.cost}/SF, Class {E.QLABEL[E.qGrade(c.q)]}</option>
            ))}
          </select>
        </label>
        <label className="f">Building size — {(dev.sf / 1000).toFixed(0)}K SF
          <input type="range" min={5000} max={Math.max(5000, bMax)} step={1000} value={Math.min(dev.sf, Math.max(5000, bMax))}
            onChange={e => setDev({ ...dev, sf: Number(e.target.value) })} />
        </label>
        <label className="f">Units / suites — {dev.units} {spec.fixedUnits ? '(single-tenant)' : ''} <Hint text="More, smaller suites rent for marginally more per SF and diversify tenant risk — but cost more to manage, and small suites lease ambiently while big blocks need LOI negotiations." />
          <input type="range" min={spec.fixedUnits ?? spec.minUnits ?? 1} max={spec.fixedUnits ?? Math.max(spec.minUnits ?? 1, Math.floor(dev.sf / (dev.type === 'multifamily' ? 650 : 1200)))} value={dev.units}
            disabled={!!spec.fixedUnits}
            onChange={e => setDev({ ...dev, units: Number(e.target.value) })} />
        </label>
        <label className="f">GC contract <Hint text="Guaranteed Maximum Price: +7% on hard cost, and overruns above contingency are the GC's problem — but unknown site conditions stay yours. Cost-plus: baseline price, every surprise is yours." />
          <select value={dev.contractType} onChange={e => setDev({ ...dev, contractType: e.target.value as any })}>
            <option value="costplus">Cost-plus — baseline, you eat every surprise</option>
            <option value="gmp">Guaranteed Max Price — +7% hard, GC eats overruns</option>
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
        <label className="f">Equity share — {pct(dev.downPct)} (min {pct(1 - E.CONFIG.constrLTC)})
          <input type="range" min={30} max={100} value={Math.round(dev.downPct * 100)}
            onChange={e => setDev({ ...dev, downPct: Number(e.target.value) / 100 })} />
        </label>
      </div>
      <BuildingSketch a={{ type: dev.type, construction: dev.construction, sf: dev.sf, units: dev.units, quality: spec.q }} w={460} h={100} />
      <div className="memo">
        <div className="memo-row"><span className="lbl">Land ({listing.acres} ac)</span><span className="num">{E.fmtMoney(listing.price)}</span></div>
        <div className="memo-row"><span className="lbl">Hard costs — {spec.label.toLowerCase()} @ ${spec.cost}/SF{state.econ.tariffMonthsLeft > 0 ? ' (tariffs +8% ⚠)' : ''}</span><span className="num">{E.fmtMoney(bd.hard)}</span></div>
        <div className="memo-row"><span className="lbl">Soft costs (15%)</span><span className="num">{E.fmtMoney(bd.soft)}</span></div>
        {(bd as any).bond > 0 && <div className="memo-row"><span className="lbl">Performance bond</span><span className="num">{E.fmtMoney((bd as any).bond)}</span></div>}
        <div className="memo-row"><span className="lbl">Contingency</span><span className="num">{E.fmtMoney(bd.cont)}</span></div>
        <div className="memo-row total"><span className="lbl">Total development cost</span><span className="num">{E.fmtMoney(bd.total)}</span></div>
        <div className="memo-row"><span className="lbl">Construction loan (≤{pct(E.CONFIG.constrLTC)} LTC at {(state.econ.rate + E.CONFIG.constrSpread + (dev.fixedRate ? 0.6 : 0)).toFixed(2)}% {dev.fixedRate ? 'FIXED' : 'FLOATING'}, 12-mo IO after delivery)</span><span className="num">{E.fmtMoney(bd.total - equity)}</span></div>
        <div className="memo-row"><span className="lbl">
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={!!dev.fixedRate} onChange={e => setDev({ ...dev, fixedRate: e.target.checked })} />
            Fix the rate (+0.60%) <Hint text="Floating construction debt reprices every month — a rate spike mid-build compounds against you. Fixed costs more on day one and is worth every basis point in the wrong year." />
          </label></span>
          <span className="num dim">{dev.fixedRate ? 'hedged' : 'exposed to the curve'}</span></div>
        <div className="memo-row"><span className="lbl">Interest reserve (loan-funded, sized to a {bd.months}-mo build) <Hint text="Pays the construction interest while you build. Run past schedule and it empties — then debt service comes from your cash, on a building earning nothing." /></span>
          <span className="num">{E.fmtMoney(Math.round((bd.total - equity) * ((state.econ.rate + E.CONFIG.constrSpread + (dev.fixedRate ? 0.6 : 0)) / 100 / 12) * bd.months * 0.6))}</span></div>
        <div className="memo-row"><span className="lbl">Your equity at closing</span><span className={'num ' + (state.cash >= equity ? '' : 'neg')}>{E.fmtMoney(equity)}</span></div>
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
        {!listing.parentAssetId && (
          <button className="btn" title="Close on the dirt and sit on it — no building required"
            onClick={() => {
              const r = E.buyLandHold(state, listing.id);
              if (r.err) setErr(r.err); else { setState(r.s); close(); }
            }}>Buy &amp; hold — {E.fmtMoney(listing.price + 5000)}</button>
        )}
        {E.canJV(state, equity).ok && (
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--dim)' }}>
            <input type="checkbox" checked={useJV} onChange={e => setUseJV(e.target.checked)} />
            JV partner (LP funds 70% of {E.fmtMoney(equity)})
          </label>
        )}
        <button className="btn btn-amber" disabled={!!vErr} onClick={() => {
          const r = E.buyLandAndDevelop(state, listing.id, dev, useJV && E.canJV(state, equity).ok);
          if (r.err) setErr(r.err); else { setState(r.s); close(); }
        }}>Buy land & break ground{useJV && E.canJV(state, equity).ok ? ' (JV)' : ''}</button>
      </div>
    </Modal>
  );
}
function CONSTR0(l: Listing, state: GameState) {
  const t = state.tiles[l.tileI];
  const ty: PType = t.indSuit > 55 ? 'industrial' : 'retail';
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
  if (!a) return null;
  const mkt = E.assetRentPSF(state, a);
  const isFinal = loi.stage === 'countered';
  const theirRate = isFinal ? loi.counterRate! : loi.rate;
  const theirTerm = isFinal ? loi.counterTermY! : loi.termY;
  const [rate, setRate] = useState(() => Math.round((theirRate ?? mkt) * 100) / 100);
  const [termY, setTermY] = useState(theirTerm ?? 5);
  const annual = (r: number) => loi.sf * r;
  const [walked, setWalked] = useState(false);
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
        {(loi.sf / 1000).toFixed(1)}K SF at {a.name} · <span className={'chip credit-' + loi.credit}>{E.CREDIT_LABEL[loi.credit]} credit</span> · expires {E.monthName(loi.expiresM)}
        {loi.kind === 'renewal' && <span className="amber"> · sitting tenant — if this dies, their space goes dark</span>}
      </div>
      <div className="memo">
        {loi.kind !== 'rfp' || isFinal ? (<>
          <div className="memo-row"><span className="lbl">{isFinal ? 'Their FINAL counter' : loi.kind === 'renewal' ? 'They offer to renew at' : 'Their proposed rate'}</span><b className="num">${theirRate?.toFixed(2)}/SF · {theirTerm} yrs</b></div>
          <div className="memo-row"><span className="lbl">That's ~{pct((theirRate ?? mkt) / mkt - 1 + 1e-9, 0).replace('%', '%')} of market (${mkt.toFixed(2)}/SF)</span>
            <span className={'num ' + ((theirRate ?? 0) >= mkt * 0.97 ? 'pos' : 'dim')}>{E.fmtMoney(annual(theirRate ?? mkt))}/yr</span></div>
        </>) : (
          <div className="memo-row"><span className="lbl">They've invited a proposal. Market for this building</span><span className="num">${mkt.toFixed(2)}/SF</span></div>
        )}
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
        {!isFinal && <button className="btn btn-amber" onClick={() => act(loi.kind === 'rfp' ? { type: 'propose', rate, termY } : { type: 'counter', rate, termY })}>
          {loi.kind === 'rfp' ? 'Send proposal' : 'Counter'} at ${rate.toFixed(2)}
        </button>}
      </div>
      )}
    </Modal>
  );
}

// ---------- Portfolio ----------
export function PortfolioView2({ state, setState, onSell, onRefi, onLOI, goDeals, openDeal, onSold, onShowOnMap }: {
  state: GameState; setState: (s: GameState) => void;
  onSell: (id: number) => void; onRefi: (id: number) => void; onLOI: (id: number) => void; goDeals: () => void;
  openDeal: (id: number) => void; onSold: (pm: E.PostMortem) => void; onShowOnMap?: (id: number) => void;
}) {
  if (state.assets.length === 0) {
    return <div className="panel dim" style={{ fontSize: 13.5, lineHeight: 1.6 }}>
      No assets yet. An empty balance sheet is just potential energy — <button className="btn btn-sm btn-amber" onClick={goDeals}>open the deal board</button>
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
            return (
              <div key={h.id} className="memo-row" style={{ borderBottom: '1px solid var(--line2)' }}>
                <span className="lbl">Block {blockName(state.tiles[h.tileI])} · {Math.round(h.cells.length * E.PARCEL_AC * 100) / 100} acres · held {state.month - h.acquiredM} mo</span>
                <span className="num">{E.fmtMoney(val)} <span className={val >= h.basis ? 'pos' : 'neg'}>({val >= h.basis ? '+' : ''}{E.fmtMoney(val - h.basis)})</span></span>
              </div>
            );
          })}
          <div className="faint" style={{ fontSize: 11, marginTop: 6 }}>Dirt pays no rent. It only pays off if the block goes up — or if you build. Manage holdings from the city map.</div>
        </div>
      )}
      {state.assets.map(a => (
        <AssetCard key={a.id} state={state} setState={setState} asset={a}
          onSell={onSell} onRefi={onRefi} onLOI={onLOI} openDeal={openDeal} onSold={onSold} onShowOnMap={onShowOnMap} />
      ))}
    </div>
  );
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
    return { a, uc, val, debt, eq: val - debt - E.lpClaim(state, a), noi, cf: noi - ds, irr: E.assetIRR(state, a) };
  });
  const dir = sort.asc ? 1 : -1;
  const val = (r: typeof rows[0]): number =>
    sort.by === 'occ' ? r.a.occ : sort.by === 'debt' ? r.debt : sort.by === 'eq' ? r.eq
    : sort.by === 'noi' ? r.noi : sort.by === 'cf' ? r.cf : sort.by === 'irr' ? (r.irr ?? -999) : r.val;
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
          <Th id="noi" label="NOI /mo" /><Th id="cf" label="CF /mo" /><Th id="irr" label="IRR" /></tr></thead>
        <tbody>
          {rows.map(({ a, uc, val: v, debt, eq, noi, cf, irr }) => (
            <tr key={a.id} style={{ cursor: onShowOnMap ? 'pointer' : undefined }} onClick={() => onShowOnMap?.(a.id)}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--panel2)')}
              onMouseLeave={e => (e.currentTarget.style.background = '')}>
              <td>{a.name} {uc && <span className="chip chip-land">UC</span>}{a.forSale && <span className="chip chip-agreed">Sale</span>}<span className="faint" style={{ fontSize: 9 }}> ▸ map</span></td>
              <td className="dim">{E.PLABEL[a.type]}</td>
              <td className="num">{uc ? '—' : pct(a.occ)}</td>
              <td className="num">{E.fmtMoney(v)}</td>
              <td className="num">{E.fmtMoney(debt)}</td>
              <td className={'num ' + (eq < 0 ? 'neg' : '')}>{E.fmtMoney(eq)}</td>
              <td className="num">{uc ? '—' : E.fmtMoney(noi)}</td>
              <td className={'num ' + (cf >= 0 ? 'pos' : 'neg')}>{uc ? '—' : E.fmtMoney(cf)}</td>
              <td className={'num ' + (irr === null ? 'dim' : irr >= 0 ? 'pos' : 'neg')}>{irr === null ? '—' : irr.toFixed(1) + '%'}</td>
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
          <span className="chip chip-land">{p.stage === 'permitting' ? 'Permitting' : 'Under construction'}</span>
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
          <BuildingSketch a={a} w={300} h={100} />
        </div>
      </div>
    );
  }
  const val = E.assetValue(state, a);
  const debt = E.assetTotalDebt(state, a);
  const noi = E.assetNOIMonthly(state, a);
  const ds = E.assetDebtService(a);
  const irr = E.assetIRR(state, a);
  const cap = E.capRatePct(state, t, a.type, a.quality);
  const tOcc = E.targetOcc(state, t, a.type);
  const potM = (a.sf * E.assetRentPSF(state, a)) / 12;
  const egiM = E.assetEGIMonthly(state, a);
  const ex = E.expenseBreakdown(state, a, potM, egiM);
  const isMF = E.isAggregate(a.type);
  const offers = state.saleOffers.filter(o => o.assetId === a.id);
  const exAcres = E.excessAcres(a);
  const canPad = Math.max(...E.PTYPES.map(ty => exAcres * 43560 * E.FAR[ty])) >= 5000;
  const inFac = state.facilities.some(f => f.assetIds.includes(a.id));
  return (
    <div className="asset-card">
      <div className="asset-head">
        {nameEl}
        <span className="chip chip-type">{E.PLABEL[a.type]}</span>
        <span className="chip" style={{ border: '1px solid var(--line)', color: 'var(--dim)' }}>{E.QLABEL[E.qGrade(a.quality)]}-grade</span>
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
            <div className="metric"><div className="eyebrow">Value</div><div className="v num">{E.fmtMoney(val)}</div></div>
            <div className="metric"><div className="eyebrow">Debt{inFac ? ' (incl. share)' : ''}</div><div className="v num">{E.fmtMoney(debt)}</div></div>
            <div className="metric"><div className="eyebrow">{a.jv ? 'Your equity' : 'Equity'}</div><div className={'v num ' + (val - debt - E.lpClaim(state, a) < 0 ? 'neg' : '')}>{E.fmtMoney(val - debt - E.lpClaim(state, a))}</div></div>
            <div className="metric"><div className="eyebrow">Rent /mo</div><div className="v num">{E.fmtMoney(egiM)}</div></div>
            <div className="metric"><div className="eyebrow">NOI /mo</div><div className="v num">{E.fmtMoney(noi)}</div></div>
            <div className="metric"><div className="eyebrow">Debt svc /mo</div><div className="v num">{E.fmtMoney(ds)}</div></div>
            <div className="metric"><div className="eyebrow">CF /mo</div><div className={'v num ' + (noi - ds >= 0 ? 'pos' : 'neg')}>{E.fmtMoney(noi - ds)}</div></div>
            <div className="metric"><div className="eyebrow">Cap</div><div className="v num">{cap.toFixed(1)}%</div></div>
            <div className="metric"><div className="eyebrow">IRR <Hint text="Annualized return on your equity, counting every dollar in and out plus today's net sale value." /></div>
              <div className={'v num ' + (irr === null ? '' : irr >= 0 ? 'pos' : 'neg')}>{irr === null ? '—' : irr.toFixed(1) + '%'}</div></div>
          </div>
        </div>
        <BuildingSketch a={a} w={260} h={96} />
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
        <span style={{ flex: 1 }} />
        <button className="btn btn-sm" onClick={() => { const r = E.startRenovation(state, a.id); if (r.err) setErr(r.err); else setState(r.s); }}
          disabled={!!a.renovMonthsLeft}>Renovate ({E.fmtMoney(E.renovCost(state, a))})</button>
        <button className="btn btn-sm" onClick={() => onRefi(a.id)}>Refinance</button>
        {a.occ <= 0.15 && !a.forSale && a.mode !== 'construction' && (
          <button className="btn btn-sm btn-danger" title="Tear it down and keep the dirt"
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
              <RentRollTable state={state} tenants={a.tenants} sf={a.sf} retailOf={a.type === 'retail' ? { tileI: a.tileI, quality: a.quality } : undefined} />
              <div className="faint" style={{ fontSize: 10.5, marginTop: 6 }}>
                Market for this building: ${E.assetRentPSF(state, a).toFixed(2)}/SF · vacant {( (a.sf - E.leasedSF(a)) / 1000).toFixed(1)}K SF
              </div>
            </>)}
          </div>
          <div>
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
  const [counter, setCounter] = useState(() => Math.round(Math.max(offer.amount * 1.05, val * 0.97) / 10000) * 10000);
  const act = (action: any) => {
    const r = E.respondSaleOffer(state, offer.id, action);
    setState(r.s);
    if (r.pm) onSold(r.pm);
  };
  return (
    <div className="memo" style={{ borderLeftColor: 'var(--green)', marginBottom: 8 }}>
      <div className="memo-row">
        <span className="lbl"><b style={{ color: 'var(--ink)' }}>{offer.buyer}</b> offers · {pct(offer.amount / Math.max(1, val))} of your appraisal · expires {E.monthName(offer.expiresM)}{offer.countered ? ' · BEST & FINAL' : ''}</span>
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

// ---------- Refi modal (adjustable) ----------
export function RefiModal({ state, setState, asset, close, variant = 'dialog' }: {
  state: GameState; setState: (s: GameState) => void; asset: Asset; close: () => void; variant?: 'dialog' | 'drawer';
}) {
  const [err, setErr] = useState<string | null>(null);
  const lim = E.refiLimits(state, asset);
  const minAmt = Math.max(lim.payoff, 100000);
  const [amount, setAmount] = useState(() => Math.round(Math.min(lim.maxByLTV, Math.max(minAmt, lim.val * 0.65)) / 10000) * 10000);
  const [amortYears, setAmortYears] = useState(25);
  const q = E.refiQuote(state, asset, { amount, amortYears });
  return (
    <Modal close={close} variant={variant}>
      <h2>Refinance {asset.name}</h2>
      <div className="sub">Choose your proceeds and amortization. The new loan must clear your existing debt; the bank caps you at 70% of value and 1.20× coverage.</div>
      <div className="memo">
        <div className="memo-row"><span className="lbl">Appraised value</span><span className="num">{E.fmtMoney(lim.val, false)}</span></div>
        <div className="memo-row"><span className="lbl">Existing debt to clear</span><span className="num">{E.fmtMoney(lim.payoff)}</span></div>
        <div className="memo-row"><span className="lbl">Rate today (base + {E.CONFIG.refiSpread}%)</span><span className="num">{lim.rate.toFixed(2)}%</span></div>
      </div>
      <label className="f">New loan amount — {E.fmtMoney(amount)} <span className="faint">({pct(amount / Math.max(1, lim.val))} LTV)</span>
        <input type="range" min={minAmt} max={Math.max(minAmt, Math.floor(lim.maxByLTV / 10000) * 10000)} step={10000} value={amount}
          onChange={e => setAmount(Number(e.target.value))} />
      </label>
      <label className="f">Amortization — {amortYears} years <Hint text="Longer amortization = lower payment = better DSCR and cash flow, but slower principal paydown and a bigger balloon in 10 years." />
        <input type="range" min={10} max={E.CONFIG.refiAmortMax} value={amortYears} onChange={e => setAmortYears(Number(e.target.value))} />
      </label>
      <div className="memo" style={{ borderLeftColor: 'var(--blue)' }}>
        <div className="memo-row"><span className="lbl">New debt service ({amortYears}-yr am, 10-yr balloon)</span><span className="num">{E.fmtMoney(q.pmt)}/mo</span></div>
        <div className="memo-row"><span className="lbl">DSCR after refi (needs 1.20×)</span>
          <span className={'num ' + (q.dscr !== null && q.dscr >= 1.2 ? 'pos' : 'neg')}>{q.dscr?.toFixed(2) ?? '—'}×</span></div>
        <div className="memo-row total"><span className="lbl">Cash to you (net of 1% cost)</span><span className={'num ' + (q.proceeds > 0 ? 'pos' : 'neg')}>{E.fmtMoney(q.proceeds)}</span></div>
      </div>
      {err && <div className="alert-strip red" style={{ marginBottom: 10 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn" onClick={close}>Not now</button>
        <button className="btn btn-amber" onClick={() => {
          const r = E.doRefi(state, asset.id, { amount, amortYears });
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
  const rows: { assetId: number; loanId: number; asset: string; kind: string; balance: number; rate: number; amort: number; io: number; pmt: number; mat: number }[] = [];
  for (const a of state.assets) for (const l of a.loans) {
    rows.push({ assetId: a.id, loanId: l.id, asset: a.name, kind: l.kind === 'acq' ? 'Acquisition' : l.kind === 'constr' ? 'Construction' : 'Refinance', balance: l.balance, rate: l.ratePct, amort: l.amortYears, io: l.ioMonthsLeft, pmt: E.loanMonthlyDS(l), mat: l.maturityMonth });
  }
  const elig = state.assets.filter(a => a.mode === 'operating' && a.occ >= 0.75 && !state.facilities.some(f => f.assetIds.includes(a.id)));
  const q = sel.length >= 2 ? E.facilityQuote(state, sel) : null;
  const totalDS = rows.reduce((s, r) => s + r.pmt, 0) + E.totalFacilityDS(state);
  const dscr = E.portfolioDSCR(state);
  return (
    <div>
      <div className="grid3" style={{ marginBottom: 14 }}>
        <div className="panel stat-lg"><div className="eyebrow">Total debt</div><div className="v num">{E.fmtMoney(rows.reduce((s, r) => s + r.balance, 0) + state.facilities.reduce((s, f) => s + f.balance, 0))}</div></div>
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
            <thead><tr><th>Asset</th><th>Type</th><th>Balance</th><th>Rate</th><th>Amort</th><th>IO left <Hint text="Interest-only months remaining. New construction loans run 12 months IO after delivery, then start amortizing." /></th><th>Payment /mo</th><th>Balloon <Hint text="When the loan matures, the remaining balance rolls at whatever rates are then — a rate spike at your balloon is how real developers die." /></th><th>Pay down <Hint text="Prepay principal early: 2% penalty, waived within 12 months of the balloon. Payment stays the same — the term just shortens." /></th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.asset}</td><td className="dim">{r.kind}</td>
                  <td className="num">{E.fmtMoney(r.balance)}</td>
                  <td className="num">{r.rate.toFixed(2)}%</td>
                  <td className="num">{r.amort} yr</td>
                  <td className="num">{r.io > 0 && r.io < 900 ? r.io + ' mo' : r.io >= 900 ? 'capitalizing' : '—'}</td>
                  <td className="num">{r.io >= 900 ? '—' : E.fmtMoney(r.pmt)}</td>
                  <td className="num">{E.monthName(r.mat)}</td>
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
