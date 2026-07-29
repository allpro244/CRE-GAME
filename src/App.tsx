import { useState, useEffect, useCallback, useRef } from 'react';
import * as E from './engine';
import type { GameState, Asset, PostMortem } from './engine';
import { LineChart, Bars } from './charts';
import { Modal, Hint, DealsView2, DealModal, PortfolioView2, RefiModal, DebtView, LOIModal, AssetDrawer, pct } from './views2';
import { MapView, StockCard, FirmPortfolioModal } from './mapview';

async function storageSet(key: string, val: string) {
  try { await (window as any).storage?.set?.(key, val); return true; } catch { return false; }
}
async function storageGet(key: string): Promise<string | null> {
  try { const r = await (window as any).storage?.get?.(key); return r?.value ?? null; } catch { return null; }
}

type TabId = 'dashboard' | 'map' | 'deals' | 'portfolio' | 'debt' | 'economy';

export default function App() {
  const [screen, setScreen] = useState<'menu' | 'game'>('menu');
  const [state, setState] = useState<GameState | null>(null);
  const [hasSave, setHasSave] = useState(false);
  useEffect(() => { storageGet('groundwork:auto').then(v => setHasSave(!!v && !!E.deserialize(v))); }, []);
  const startNew = (sandbox = false, city: E.CityKind = 'meridian') => { setState(E.newGame(undefined, { sandbox, city })); setScreen('game'); };
  const continueGame = async () => {
    const v = await storageGet('groundwork:auto');
    const s = v ? E.deserialize(v) : null;
    if (s) { setState(s); setScreen('game'); } else startNew(false);
  };
  if (screen === 'menu' || !state) {
    return (
      <div className="menu">
        <h1>GROUNDWORK</h1>
        <div className="tag">Commercial real estate, from the ground up</div>
        <p>
          Meridian City. $600,000 of equity, a bank that returns your calls, and a market that
          doesn't care about your feelings. Buy buildings, chase off-market deals, negotiate every
          lease, structure the debt — and be greedy and fearful at the right times.
        </p>
        <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
          <button className="btn btn-amber" onClick={() => startNew(false)}>New campaign — Meridian</button>
          <button className="btn btn-amber" title="A long island between two rivers: twin cores, a park in the middle, bridges, and a shoreline expressway"
            onClick={() => startNew(false, 'island')}>New Amsterdam</button>
          {hasSave && <button className="btn" onClick={continueGame}>Continue</button>}
          <button className="btn btn-ghost" title="$50,000,000, top tier, clean reputation — for testing"
            onClick={() => startNew(true)}>Sandbox — $50M</button>
        </div>
        <p className="faint" style={{ fontSize: 11.5, marginTop: 18 }}>
          Autosaves every quarter. Values are marked to market monthly — leverage cuts both ways.
        </p>
      </div>
    );
  }
  return <Game state={state} setState={setState} toMenu={() => setScreen('menu')} />;
}

function Game({ state, setState, toMenu }: {
  state: GameState; setState: (s: GameState) => void; toMenu: () => void;
}) {
  const [tab, setTab] = useState<TabId>('dashboard');
  const [selTile, setSelTile] = useState<number | null>(null);
  const [stockCardId, setStockCardId] = useState<number | null>(null);
  const [dealId, setDealId] = useState<number | null>(null);
  const [sellId, setSellId] = useState<number | null>(null);
  const [refiId, setRefiId] = useState<number | null>(null);
  const [loiId, setLoiId] = useState<number | null>(null);
  const [pm, setPm] = useState<PostMortem | null>(null);
  const [saved, setSaved] = useState(false);
  const [firmShort, setFirmShort] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [focusTile, setFocusTile] = useState<number | null>(null);
  const [assetId, setAssetId] = useState<number | null>(null);
  const flyTo = (tileI: number) => { setFocusTile(tileI); setTab('map'); setTimeout(() => setFocusTile(null), 60); };
  const seenLOIs = useRef<Set<number>>(new Set());

  // Detail opened from the map rides in as a slide-over so the city stays put behind it.
  const detailVariant = tab === 'map' ? 'drawer' : 'dialog';
  // The drawer starts below the top bar + nav; that chrome wraps, so measure it.
  const chromeRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = chromeRef.current;
    if (!el) return;
    const apply = () => document.documentElement.style.setProperty('--chrome-h', el.getBoundingClientRect().height + 'px');
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // From an index (deal board, dashboard), fly to the building first — then open it on the map.
  const openDealOnMap = useCallback((id: number, tileI?: number) => {
    const t = tileI ?? state.listings.find(l => l.id === id)?.tileI;
    if (t !== undefined) flyTo(t);
    setDealId(id);
  }, [state.listings]); // eslint-disable-line
  const openAssetOnMap = useCallback((id: number) => {
    const a = state.assets.find(x => x.id === id);
    if (a) flyTo(a.tileI);
    setAssetId(id);
  }, [state.assets]); // eslint-disable-line

  // Letters of intent are money on the table — surface them where they can't be missed
  useEffect(() => {
    const unseen = state.lois.find(l => !seenLOIs.current.has(l.id));
    for (const l of state.lois) seenLOIs.current.add(l.id);
    if (unseen && loiId === null && state.pending.length === 0 && !state.gameOver) {
      setLoiId(unseen.id);
    }
  }, [state.lois]); // eslint-disable-line

  const advance = useCallback((n: number) => {
    let s = state;
    for (let i = 0; i < n; i++) {
      s = E.advanceMonth(s);
      if (s.pending.length > 0 || s.gameOver || s.forcedSaleNotice) break;
    }
    setState(s);
  }, [state, setState]);

  // run the clock until the game needs you: an event, a proposal, or an offer
  const advanceUntil = useCallback(() => {
    let s = state;
    const lois0 = new Set(s.lois.map(l => l.id));
    const offers0 = new Set(s.saleOffers.map(o => o.id));
    for (let i = 0; i < 12; i++) {
      s = E.advanceMonth(s);
      if (s.pending.length > 0 || s.gameOver || s.forcedSaleNotice) break;
      if (!s.autoLease && s.lois.some(l => !lois0.has(l.id))) break;
      if (s.saleOffers.some(o => !offers0.has(o.id))) break;
    }
    setState(s);
  }, [state, setState]);

  useEffect(() => {
    if (state.month > 0 && state.month % 3 === 0) storageSet('groundwork:auto', E.serialize(state));
  }, [state.month]); // eslint-disable-line

  const manualSave = async () => {
    await storageSet('groundwork:auto', E.serialize(state));
    setSaved(true); setTimeout(() => setSaved(false), 1400);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const el = e.target as HTMLElement;
      if (el && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(el.tagName)) return;
      if (document.querySelector('.modal-back')) return;
      if (state.pending.length > 0 || state.gameOver) return;
      e.preventDefault();
      advance(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [advance, state.pending.length, state.gameOver]);

  const nw = E.netWorth(state);
  const dscr = E.portfolioDSCR(state);
  const listing = dealId !== null ? state.listings.find(l => l.id === dealId) ?? null : null;
  const sellAsset = sellId !== null ? state.assets.find(a => a.id === sellId) ?? null : null;
  const refiAsset = refiId !== null ? state.assets.find(a => a.id === refiId) ?? null : null;
  const loi = loiId !== null ? state.lois.find(l => l.id === loiId) ?? null : null;
  const drawerAsset = assetId !== null ? state.assets.find(a => a.id === assetId) ?? null : null;
  const pendingEvt = state.pending[0];
  const pendAsset = pendingEvt ? state.assets.find(a => a.id === pendingEvt.assetId) : undefined;
  const projCount = state.assets.filter(a => a.mode === 'construction').length;

  return (
    <div className="app">
      <div ref={chromeRef} className="chrome">
      <div className="topbar">
        <div className="brand"><b>GROUNDWORK</b><span>Meridian City</span></div>
        <div className="tb-sep" />
        <div className="tb-stat"><span className="eyebrow">Date</span><span className="v num">{E.monthName(state.month)}</span></div>
        <div className="tb-stat"><span className="eyebrow">Cash</span><span className={'v num ' + (state.cash < 0 ? 'neg' : '')}>{E.fmtMoney(state.cash)}</span></div>
        <div className="tb-stat"><span className="eyebrow">Net worth</span><span className="v num">{E.fmtMoney(nw)}</span></div>
        <div className="tb-stat"><span className="eyebrow">CF /mo</span><span className={'v num ' + (state.lastMonthCF >= 0 ? 'pos' : 'neg')}>{E.fmtMoney(state.lastMonthCF)}</span></div>
        <div className="tb-stat"><span className="eyebrow">Prime rate <Hint text="Base rate + 3.0%. Your actual loan spreads price off the base rate; prime is the pulse you watch." /></span><span className="v num">{E.primeRate(state).toFixed(2)}%</span></div>
        <div className="tb-stat"><span className="eyebrow">DSCR</span><span className={'v num ' + (dscr !== null && dscr < 1.2 ? 'neg' : '')}>{dscr === null ? '—' : dscr.toFixed(2) + '×'}</span></div>
        {state.exchange && <div className="tb-stat"><span className="eyebrow">1031 clock</span><span className="v num" style={{ color: 'var(--amber)' }}>{state.exchange.deadlineM - state.month} mo</span></div>}
        {state.sandbox && <div className="phase-chip" style={{ background: '#241d10', color: 'var(--amber)', borderColor: 'var(--amber-dim)' }}>sandbox</div>}
        <div className={'phase-chip phase-' + state.econ.phase}>{state.econ.phase}</div>
        <div style={{ flex: 1 }} />
        <button className="btn btn-amber" onClick={() => advance(1)} disabled={state.pending.length > 0 || state.gameOver}>Advance month ▸</button>
        <button className="btn" onClick={() => advance(6)} disabled={state.pending.length > 0 || state.gameOver}>+6 mo ▸▸</button>
        <button className="btn" title="Advance until an event, proposal, or offer needs your attention (max 12 months)" onClick={advanceUntil} disabled={state.pending.length > 0 || state.gameOver}>Until event ⏭</button>
        <button className="btn btn-ghost" onClick={manualSave}>{saved ? 'Saved ✓' : 'Save'}</button>
        <button className="btn btn-ghost" onClick={() => setSaveOpen(true)}>Slots</button>
        <button className="btn btn-ghost" onClick={async () => { await storageSet('groundwork:auto', E.serialize(state)); toMenu(); }}>Menu</button>
      </div>

      <div className="nav">
        {(['dashboard', 'map', 'deals', 'portfolio', 'debt', 'economy'] as TabId[]).map(t => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t === 'dashboard' ? 'Dashboard' : t === 'map' ? 'City map' : t === 'deals' ? 'Deal board' : t === 'portfolio' ? 'Portfolio' : t === 'debt' ? 'Debt' : 'Economy'}
            {t === 'deals' && state.listings.length > 0 && <span className="badge" style={{ background: 'var(--panel3)', color: 'var(--dim)' }}>{state.listings.length}</span>}
            {t === 'portfolio' && (projCount > 0 || state.lois.length > 0) && <span className="badge">{state.lois.length > 0 ? '✉' + state.lois.length : projCount}</span>}
          </button>
        ))}
      </div>
      </div>

      <div className="main">
        {state.forcedSaleNotice && <div className="alert-strip red"><span>⚠ {state.forcedSaleNotice}</span></div>}
        {tab === 'dashboard' && <Dashboard state={state} goDeals={() => setTab('deals')} openLOI={id => setLoiId(id)} openFirm={s => setFirmShort(s)} flyTo={flyTo} />}
        {tab === 'map' && <MapView state={state} setState={setState} focusTile={focusTile} selTile={selTile} setSelTile={setSelTile}
          advance={advance} advanceUntil={advanceUntil}
          openDeal={id => { setStockCardId(null); setAssetId(null); setDealId(id); }}
          openStock={id => { setAssetId(null); setStockCardId(id); }}
          openAsset={id => { setStockCardId(null); setAssetId(id); }} />}
        {tab === 'deals' && <DealsView2 state={state} setState={setState} openDeal={openDealOnMap} />}
        {tab === 'portfolio' && <PortfolioView2 state={state} setState={setState} onSell={setSellId} onRefi={setRefiId} onLOI={setLoiId} goDeals={() => setTab('deals')}
          openDeal={openDealOnMap} onSold={p => setPm(p)} onShowOnMap={openAssetOnMap} onShowTile={flyTo} />}
        {tab === 'debt' && <DebtView state={state} setState={setState} />}
        {tab === 'economy' && <EconomyView state={state} />}
      </div>

      {stockCardId !== null && <StockCard state={state} setState={setState} stockId={stockCardId} variant={detailVariant}
        close={() => setStockCardId(null)} openDeal={id => { setStockCardId(null); setDealId(id); }} />}

      {drawerAsset && <AssetDrawer state={state} setState={setState} asset={drawerAsset} close={() => setAssetId(null)}
        onSell={setSellId} onRefi={setRefiId} onLOI={setLoiId} openDeal={id => { setAssetId(null); setDealId(id); }} onSold={p => { setAssetId(null); setPm(p); }} />}

      {listing && <DealModal state={state} listing={listing} setState={setState} close={() => setDealId(null)} variant={detailVariant} />}
      {loi && <LOIModal state={state} setState={setState} loi={loi} close={() => setLoiId(null)} variant={detailVariant} />}
      {sellAsset && <SellModal state={state} setState={setState} asset={sellAsset} close={() => setSellId(null)} variant={detailVariant} />}
      {firmShort && <FirmPortfolioModal state={state} short={firmShort} close={() => setFirmShort(null)} openStock={id => { setFirmShort(null); setStockCardId(id); }} />}
      {refiAsset && <RefiModal state={state} setState={setState} asset={refiAsset} close={() => setRefiId(null)} variant={detailVariant} />}
      {pm && <PostMortemModal pm={pm} close={() => setPm(null)} />}
      {pendingEvt && pendAsset && pendingEvt.type === 'constrEvent' && <EventModal state={state} setState={setState} asset={pendAsset} kind={pendingEvt.eventKind} />}
      {pendingEvt && pendAsset && pendingEvt.type === 'assetEvent' && <AssetEventModal state={state} setState={setState} asset={pendAsset} kind={pendingEvt.eventKind} />}
      {saveOpen && <SaveLoadModal state={state} setState={setState} close={() => setSaveOpen(false)} />}
      {state.gameOver && <GameOverModal state={state} restart={() => setState(E.newGame())} />}
    </div>
  );
}

// ---------------- Dashboard ----------------
function Dashboard({ state, goDeals, openLOI, openFirm, flyTo }: { state: GameState; goDeals: () => void; openLOI: (id: number) => void; openFirm: (short: string) => void; flyTo: (tileI: number) => void }) {
  const nw = E.netWorth(state);
  const dscr = E.portfolioDSCR(state);
  const hist = state.nwHistory;
  const cf12 = hist.slice(-12).map(h => h.cf);
  const nextTier = E.CONFIG.tiers[state.tier + 1];
  const totalDebt = state.assets.reduce((s, a) => s + E.assetDebt(a), 0) + state.facilities.reduce((s, f) => s + f.balance, 0);
  const alerts: { red: boolean; text: string }[] = [];
  if (state.econ.crunchMonthsLeft > 0) alerts.push({ red: true, text: `Credit crunch: refinancing frozen and LTVs cut 10 pts for ~${state.econ.crunchMonthsLeft} more months.` });
  if (dscr !== null && dscr < 1.2) alerts.push({ red: true, text: `Portfolio DSCR is ${dscr.toFixed(2)}× — income barely covers debt service. A rent dip could sink you.` });
  if (state.cash < 0) alerts.push({ red: true, text: `Cash is negative. Three consecutive negative months and the bank starts selling your assets for you.` });
  else if (state.lastMonthCF < 0 && state.cash < -state.lastMonthCF * 5) alerts.push({ red: false, text: `Burn warning: at ${E.fmtMoney(state.lastMonthCF)}/mo, your cash lasts ~${Math.floor(state.cash / -state.lastMonthCF)} months.` });
  if (state.econ.tariffMonthsLeft > 0) alerts.push({ red: false, text: `Material tariffs in effect: hard costs +8% for ~${state.econ.tariffMonthsLeft} more months.` });
  for (const a of state.assets) for (const l of a.loans) {
    const left = l.maturityMonth - state.month;
    if (left > 0 && left <= 12 && l.balance > 0) alerts.push({ red: left <= 6, text: `Balloon coming due: ${E.fmtMoney(l.balance)} on ${a.name} matures ${E.monthName(l.maturityMonth)}. Refinance or sell before the market decides for you.` });
  }
  for (const f of state.facilities) {
    const left = f.maturityMonth - state.month;
    if (left > 0 && left <= 12 && f.balance > 0) alerts.push({ red: left <= 6, text: `Credit facility balloon: ${E.fmtMoney(f.balance)} matures ${E.monthName(f.maturityMonth)}.` });
  }
  return (
    <div>
      {alerts.map((a, i) => <div key={i} className={'alert-strip' + (a.red ? ' red' : '')}><span>⚠ {a.text}</span></div>)}
      {state.lois.length > 0 && (
        <div className="alert-strip" style={{ borderColor: 'var(--amber-dim)' }}>
          <span>✉ {state.lois.length} lease negotiation{state.lois.length > 1 ? 's' : ''} waiting — tenants don't wait forever.</span>
          <button className="btn btn-sm btn-amber" onClick={() => openLOI(state.lois[0].id)}>Review</button>
        </div>
      )}
      <div className="grid3" style={{ marginBottom: 14 }}>
        <div className="panel stat-lg"><div className="eyebrow">Net worth</div><div className="v num">{E.fmtMoney(nw)}</div>
          <div className="dim" style={{ fontSize: 11.5, marginTop: 4 }}>{E.CONFIG.tiers[state.tier].name} · Rep {Math.round(state.reputation)}</div>
          {nextTier && <div style={{ marginTop: 8 }}>
            <div className="progress"><div style={{ width: pct(Math.min(1, nw / nextTier.nw)) }} /></div>
            <div className="faint" style={{ fontSize: 10.5, marginTop: 3 }}>Next tier at {E.fmtMoney(nextTier.nw)} — unlocks {nextTier.maxSF / 1000}K SF projects{state.tier === 0 ? ' + mixed-use' : ''}</div>
          </div>}
        </div>
        <div className="panel stat-lg"><div className="eyebrow">Cash</div><div className={'v num ' + (state.cash < 0 ? 'neg' : '')}>{E.fmtMoney(state.cash)}</div>
          <div className="dim" style={{ fontSize: 11.5, marginTop: 4 }}>Last month's cash flow: <span className={'num ' + (state.lastMonthCF >= 0 ? 'pos' : 'neg')}>{E.fmtMoney(state.lastMonthCF)}</span></div>
        </div>
        <div className="panel stat-lg"><div className="eyebrow">Portfolio</div>
          <div className="v num">{state.assets.length} asset{state.assets.length === 1 ? '' : 's'}</div>
          <div className="dim" style={{ fontSize: 11.5, marginTop: 4 }}>
            Debt {E.fmtMoney(totalDebt)} · Realized P&L <span className={'num ' + (state.totalRealizedProfit >= 0 ? 'pos' : 'neg')}>{E.fmtMoney(state.totalRealizedProfit)}</span>
          </div>
        </div>
      </div>
      {state.assets.length === 0 && state.month < 6 && (
        <div className="panel" style={{ marginBottom: 14, borderColor: 'var(--amber-dim)' }}>
          <h3>Getting started</h3>
          <div style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--dim)' }}>
            Open the <b style={{ color: 'var(--ink)' }}>Deal board</b> and hunt for a building whose going-in cap rate
            beats your borrowing cost — industrial is the forgiving place to learn, and distressed listings are cheap
            for reasons you can sometimes fix. Run the $8K feasibility to see the actual rent roll before committing.
            When you're feeling brave, canvass off-market: most sellers are delusional, but the motivated ones are gold.
            <button className="btn btn-sm btn-amber" style={{ marginLeft: 10 }} onClick={goDeals}>Open deal board</button>
          </div>
        </div>
      )}
      <div className="grid2" style={{ marginBottom: 14 }}>
        <div className="panel">
          <h3>Net worth</h3>
          <LineChart series={[{ name: 'NW', color: 'var(--amber)', data: hist.map(h => h.nw / 1e6) }]}
            labels={[E.monthName(hist[0]?.m ?? 0), E.monthName(state.month)]} yFmt={v => '$' + v.toFixed(1) + 'M'} />
        </div>
        <div className="panel">
          <h3>Monthly cash flow — trailing 12</h3>
          <Bars data={cf12} yFmt={v => E.fmtMoney(v)} />
        </div>
      </div>
      <div className="grid2">
        <div className="panel">
          <h3>Market wire</h3>
          <div className="news">
            {state.news.slice(0, 25).map((n, i) => (
              <div key={i} className="news-item" style={n.tileI !== undefined ? { cursor: 'pointer' } : undefined}
                onClick={() => n.tileI !== undefined && flyTo(n.tileI)}
                title={n.tileI !== undefined ? 'Show me on the map' : undefined}>
                <span className="news-m num">{E.monthName(n.m)}</span>
                <span className={'news-tag tag-' + n.kind}>{n.kind}</span>
                <span style={{ color: n.kind === 'rumor' ? 'var(--blue)' : undefined }}>{n.text}
                  {n.tileI !== undefined && <span className="faint" style={{ fontSize: 10 }}> ▸ map</span>}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          <h3>The competition</h3>
          <table className="sc">
            <thead><tr><th>Firm</th><th>Style</th><th>Net worth</th></tr></thead>
            <tbody>
              {[...state.firms.map(f => ({ n: f.name, sh: f.short as string | null, s: f.style === 'core' ? 'Core buyer' : f.style === 'aggressive' ? 'Merchant builder' : f.style === 'industrial' ? 'Industrial' : f.style === 'value-add' ? 'Value-add' : 'Multifamily', v: f.netWorth, dead: !f.alive })),
              { n: 'You', sh: null, s: E.CONFIG.tiers[state.tier].name, v: nw, dead: false }]
                .sort((a, b) => b.v - a.v).map((f, i) => (
                  <tr key={i} style={{ opacity: f.dead ? 0.45 : 1, cursor: f.sh ? 'pointer' : undefined }}
                    onClick={() => f.sh && openFirm(f.sh)} title={f.sh ? 'View holdings' : undefined}>
                    <td style={{ fontWeight: f.n === 'You' ? 700 : 400, color: f.n === 'You' ? 'var(--amber)' : undefined }}>{f.n}{f.dead ? ' †' : ''}{f.sh ? <span className="faint" style={{ fontSize: 9 }}> ▸</span> : ''}</td>
                    <td className="dim">{f.dead ? 'Collapsed' : f.s}</td>
                    <td className="num">{E.fmtMoney(f.v)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <div className="faint" style={{ fontSize: 11, marginTop: 10, lineHeight: 1.5 }}>
            Rivals shop the public board, but off-market leads you canvass are yours alone.
          </div>
        </div>
      </div>
    </div>
  );
}

function AssetEventModal({ state, setState, asset, kind }: {
  state: GameState; setState: (s: GameState) => void; asset: Asset; kind: string;
}) {
  const biggest = [...asset.tenants].sort((a, b) => b.sf - a.sf)[0];
  const roofFull = Math.round(asset.sf * 4.3 * state.econ.costIdx / 1000) * 1000;
  const info: Record<string, { title: string; body: string; a: string; b: string }> = {
    roof: {
      title: 'The roof is done',
      body: `Your engineer's report on ${asset.name} is blunt: the roof membrane and rooftop units are at end of life. Replace the system properly (~${E.fmtMoney(roofFull)}, adds to basis, quality up) — or patch it for ~${E.fmtMoney(Math.round(roofFull * 0.22))} and hope the weather cooperates.`,
      a: `Full replacement — ~${E.fmtMoney(roofFull)}`,
      b: `Patch it — ~${E.fmtMoney(Math.round(roofFull * 0.22))}, quality drops, storms may disagree`,
    },
    reassess: {
      title: 'County reassessment',
      body: `The assessor has repriced ${asset.name} upward — call it the neighborhood's success tax. Accept the higher bill, or spend $25,000 on an appeal with roughly even odds.`,
      a: 'Appeal — $25,000, ~55% to win',
      b: 'Accept the new assessment',
    },
    tiDemand: {
      title: `${biggest?.name ?? 'Your anchor tenant'} wants improvements`,
      body: biggest
        ? `${biggest.name} (${(biggest.sf / 1000).toFixed(1)}K SF) will sign a long extension at a small bump — if you fund a tenant improvement package (~${E.fmtMoney(Math.round(biggest.sf * 12 / 1000) * 1000)}). Refuse, and they start touring the competition.`
        : 'Your anchor tenant wants improvements.',
      a: 'Fund the TI package — long extension, small rate bump',
      b: 'Refuse — save the cash, risk the tenant',
    },
  };
  const d = info[kind] ?? info.roof;
  return (
    <Modal close={() => {}}>
      <h2>⚠ {d.title}</h2>
      <div className="dim" style={{ fontSize: 13, lineHeight: 1.65, margin: '8px 0 14px' }}>{d.body}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button className="btn btn-amber" onClick={() => setState(E.resolveAssetEvent(state, asset.id, 'a'))}>{d.a}</button>
        <button className="btn" onClick={() => setState(E.resolveAssetEvent(state, asset.id, 'b'))}>{d.b}</button>
      </div>
    </Modal>
  );
}

const SLOTS = ['groundwork:slot1', 'groundwork:slot2', 'groundwork:slot3'];
function SaveLoadModal({ state, setState, close }: {
  state: GameState; setState: (s: GameState) => void; close: () => void;
}) {
  const [meta, setMeta] = useState<({ month: number; nw: number } | null | 'loading')[]>(['loading', 'loading', 'loading']);
  const refresh = () => {
    SLOTS.forEach((k, i) => storageGet(k).then(v => {
      const s = v ? E.deserialize(v) : null;
      setMeta(m => { const n = [...m]; n[i] = s ? { month: s.month, nw: E.netWorth(s) } : null; return n; });
    }));
  };
  useEffect(refresh, []);
  return (
    <Modal close={close}>
      <h2>Save slots</h2>
      <div className="memo" style={{ borderLeftColor: state.sandbox ? 'var(--amber)' : 'var(--line)' }}>
        <div className="memo-row">
          <span className="lbl">{state.sandbox ? 'Sandbox campaign — results here don\u2019t mean much.' : 'Testing tools'}</span>
          <button className="btn btn-sm" onClick={() => setState(E.grantSandboxCash(state))}>Wire $50M</button>
        </div>
      </div>
      <div className="sub">Three slots plus the quarterly autosave. Saving overwrites; loading replaces your current campaign immediately.</div>
      {SLOTS.map((k, i) => {
        const m = meta[i];
        return (
          <div key={k} className="memo" style={{ marginBottom: 8 }}>
            <div className="memo-row">
              <span className="lbl"><b style={{ color: 'var(--ink)' }}>Slot {i + 1}</b> — {m === 'loading' ? '…' : m ? `${E.monthName(m.month)} · net worth ${E.fmtMoney(m.nw)}` : 'empty'}</span>
              <span style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-sm btn-amber" onClick={async () => { await storageSet(k, E.serialize(state)); refresh(); }}>Save</button>
                <button className="btn btn-sm" disabled={!m || m === 'loading'} onClick={async () => {
                  const v = await storageGet(k); const s = v ? E.deserialize(v) : null;
                  if (s) { setState(s); close(); }
                }}>Load</button>
              </span>
            </div>
          </div>
        );
      })}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn" onClick={close}>Close</button></div>
    </Modal>
  );
}

// ---------------- Map ----------------
function classStory(state: GameState, ty: import('./engine').PType, vac: number, eq: number, absQ: number, rg12: number, df: number): string {
  const e = state.econ;
  const bits: string[] = [];
  if (ty === 'office' && (e.wfhMonthsLeft ?? 0) > 0) bits.push('The remote-work wave is cutting demand; sublease space shadows every negotiation.');
  if (ty === 'retail' && e.ecomMonthsLeft > 0) bits.push('E-commerce is siphoning foot traffic; only necessity retail is holding rents.');
  if (ty === 'industrial' && e.ecomMonthsLeft > 0) bits.push('The e-commerce squeeze is a gift here — logistics tenants are competing for dock doors.');
  if (vac > eq + 3) bits.push(`At ${vac.toFixed(1)}% vacancy the market is oversupplied — tenants hold the pen, and ${absQ >= 0 ? 'even positive absorption can\'t' : 'negative absorption won\'t'} tighten it soon.`);
  else if (vac < eq - 1.5) bits.push(`${vac.toFixed(1)}% vacancy is genuinely tight — landlords are pushing rate and letting weak credits walk.`);
  else bits.push(`Vacancy near equilibrium (${vac.toFixed(1)}% vs ~${eq}%) — a balanced market where basis and patience decide who wins.`);
  if (absQ > 0) bits.push(`Net absorption ran +${(absQ / 1000).toFixed(0)}K SF last quarter${df > 1.08 ? ', and demand indicators say more is coming' : ''}.`);
  else if (absQ < 0) bits.push(`Occupiers gave back ${(-absQ / 1000).toFixed(0)}K SF last quarter — space is being returned faster than it's leased.`);
  const pipe = E.pipelineSF(state, ty);
  if (pipe > 0) bits.push(`${(pipe / 1000).toFixed(0)}K SF is under construction and will compete for the same tenants on delivery.`);
  if (rg12 > 3.5) bits.push(`Asking rents are up ${rg12.toFixed(1)}% over the year.`);
  else if (rg12 < 0) bits.push(`Asking rents fell ${(-rg12).toFixed(1)}% year-over-year.`);
  return bits.slice(0, 3).join(' ');
}

function EconomyView({ state }: { state: GameState }) {
  const h = state.econHistory;
  const labels = [E.monthName(h[0]?.m ?? 0), E.monthName(state.month)];
  const last = h[h.length - 1];
  const back3 = h[Math.max(0, h.length - 4)];
  const back12 = h[Math.max(0, h.length - 13)];
  const land = state.tiles.filter(t => !t.water);
  const pop = E.cityPopulation(state);
  const popAgo = back12?.pop ?? pop;
  const medianIncome = Math.round(land.reduce((s2, t) => s2 + t.income * t.pop, 0) / Math.max(1, land.reduce((s2, t) => s2 + t.pop, 0)) * 58_400 / 100) * 100;
  const avgAptRent = (() => {
    const mids = land.filter(t => t.pop > 30);
    const r = mids.reduce((s2, t) => s2 + E.marketRentPSF(state, t, 'multifamily'), 0) / Math.max(1, mids.length);
    return Math.round(r * 880 / 12 / 5) * 5;
  })();
  return (
    <div>
      <div className="grid2" style={{ marginBottom: 14 }}>
        <div className="panel">
          <h3>Meridian City — demographics</h3>
          <div className="metric-row">
            <div className="metric"><div className="eyebrow">Population</div><div className="v num">{pop.toLocaleString('en-US')}</div></div>
            <div className="metric"><div className="eyebrow">Growth (12 mo)</div><div className={'v num ' + ((pop - popAgo) >= 0 ? 'pos' : 'neg')}>{popAgo ? ((pop / popAgo - 1) * 100).toFixed(2) : '—'}%</div></div>
            <div className="metric"><div className="eyebrow">Median HH income</div><div className="v num">{E.fmtMoney(medianIncome)}</div></div>
            <div className="metric"><div className="eyebrow">Jobs index</div><div className="v num">{state.econ.empIdx.toFixed(1)}</div></div>
            <div className="metric"><div className="eyebrow">Avg apartment rent</div><div className="v num">{E.fmtMoney(avgAptRent)}/mo</div></div>
            <div className="metric"><div className="eyebrow">Renter households</div><div className="v num">{(38 + (state.econ.rate - 4) * 1.2).toFixed(0)}%</div></div>
          </div>
          <LineChart labels={labels} series={[{ name: 'pop', color: 'var(--green)', data: h.map(x => (x.pop ?? pop) / 1000) }]} yFmt={v => Math.round(v) + 'K'} />
          <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>Population follows employment and confidence — and multifamily demand follows population.</div>
        </div>
        <div className="panel">
          <h3>Construction cost climate</h3>
          <div className="metric-row">
            <div className="metric"><div className="eyebrow">Cost index</div><div className="v num">{((last?.ci ?? 1) * 100).toFixed(1)}</div></div>
            <div className="metric"><div className="eyebrow">Bid climate <Hint text="Contractor pricing has its own cycle on top of inflation: hot markets mean full order books and fat bids; recessions mean hungry GCs sharpening pencils." /></div>
              <div className={'v num ' + ((state.econ.constrCycle ?? 1) > 1.04 ? 'neg' : (state.econ.constrCycle ?? 1) < 0.97 ? 'pos' : '')}>
                {(state.econ.constrCycle ?? 1) > 1.04 ? 'Overheated' : (state.econ.constrCycle ?? 1) < 0.97 ? 'Hungry GCs' : 'Normal'} ({(((state.econ.constrCycle ?? 1) - 1) * 100).toFixed(1)}%)</div></div>
            <div className="metric"><div className="eyebrow">12-mo change</div><div className="v num">{back12?.ci ? (((last?.ci ?? 1) / back12.ci - 1) * 100).toFixed(1) + '%' : '—'}</div></div>
          </div>
          <LineChart labels={labels} series={[{ name: 'ci', color: 'var(--amber)', data: h.map(x => (x.ci ?? 1) * 100) }]} yFmt={v => v.toFixed(0)} />
          <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>Every hard-cost dollar in your pro formas is priced off this line. Recessions are when smart developers buy their bids.</div>
        </div>
      </div>
      <div className="panel" style={{ marginBottom: 14 }}>
        <h3>Market analytics by asset class <Hint text="Vacancy and absorption are measured from the actual standing stock of the city — every building, not a survey." /></h3>
        {E.PTYPES.map(ty => {
          const tot = last?.totSF?.[ty] ?? 0, occ = last?.occSF?.[ty] ?? 0;
          const vac = tot > 0 ? (1 - occ / tot) * 100 : 0;
          const absQ = back3?.occSF ? occ - (back3.occSF[ty] ?? occ) : 0;
          const rg12 = back12?.ri ? ((last?.ri[ty] ?? 1) / (back12.ri[ty] ?? 1) - 1) * 100 : 0;
          const df = land.reduce((s2, t) => s2 + E.tileDemandFactor(state, t, ty), 0) / land.length;
          const eq = ty === 'industrial' ? 6 : ty === 'retail' ? 8.5 : ty === 'multifamily' ? 6.5 : 10.5;
          return (
            <div key={ty} style={{ borderBottom: '1px solid var(--line2)', padding: '10px 0' }}>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'baseline' }}>
                <b style={{ minWidth: 92 }}>{E.PLABEL[ty]}</b>
                <span className="num" style={{ fontSize: 12 }}>Inventory <b>{(tot / 1e6).toFixed(2)}M SF</b></span>
                <span className={'num ' + (vac > eq + 2 ? 'neg' : vac < eq - 1 ? 'pos' : 'dim')} style={{ fontSize: 12 }}>Vacancy <b>{vac.toFixed(1)}%</b></span>
                <span className={'num ' + (absQ >= 0 ? 'pos' : 'neg')} style={{ fontSize: 12 }}>Absorption <b>{absQ >= 0 ? '+' : ''}{(absQ / 1000).toFixed(0)}K SF/qtr</b></span>
                <span className="num dim" style={{ fontSize: 12 }}>Demand idx <b>{df.toFixed(2)}</b></span>
                <span className={'num ' + (rg12 > 0 ? 'pos' : 'neg')} style={{ fontSize: 12 }}>Rent growth <b>{rg12 >= 0 ? '+' : ''}{rg12.toFixed(1)}%/yr</b></span>
                {E.pipelineSF(state, ty) > 0 && <span className="num" style={{ fontSize: 12, color: '#e08c3c' }}>Under construction <b>{(E.pipelineSF(state, ty) / 1000).toFixed(0)}K SF</b></span>}
              </div>
              <div className="dim" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.55 }}>{classStory(state, ty, vac, eq, absQ, rg12, df)}</div>
            </div>
          );
        })}
      </div>
      <div className="panel" style={{ marginBottom: 14 }}>
        <h3>Recent sale comps <Hint text="Every closed trade in Meridian City — yours and everyone else's. This is how you know what a building is actually worth." /></h3>
        {state.comps.length === 0 ? <div className="dim" style={{ fontSize: 12 }}>No closed transactions yet. The first trades will set the tone.</div> : (
          <table className="sc">
            <thead><tr><th>Date</th><th>Type</th><th>SF</th><th>Price</th><th>$/SF</th><th>Cap</th><th>Buyer</th></tr></thead>
            <tbody>
              {[...state.comps].reverse().slice(0, 12).map((c, i) => (
                <tr key={i} style={{ color: c.buyer === 'You' ? 'var(--amber)' : undefined }}>
                  <td className="num">{E.monthName(c.m)}</td>
                  <td>{E.PLABEL[c.type]}</td>
                  <td className="num">{(c.sf / 1000).toFixed(0)}K</td>
                  <td className="num">{E.fmtMoney(c.price)}</td>
                  <td className="num">${c.sf > 0 ? Math.round(c.price / c.sf) : '—'}</td>
                  <td className="num">{c.capPct !== null ? c.capPct.toFixed(2) + '%' : '—'}</td>
                  <td className="dim">{c.buyer}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="panel" style={{ marginBottom: 14 }}>
        <h3>Market cap rates today <Hint text="What buyers demand as a yield. Prime = best block, Class A. Average = mid-city, Class B. Your borrowing cost sits underneath everything — positive leverage lives in the gap." /></h3>
        <table className="sc">
          <thead><tr><th>Asset class</th><th>Prime / Class A</th><th>Average / Class B</th><th>Weak block / Class C</th></tr></thead>
          <tbody>
            {E.PTYPES.map(ty => {
              const land = state.tiles.filter(t => !t.water);
              const prime = land.reduce((b2, t) => t.D > b2.D ? t : b2, land[0]);
              const avg = land.reduce((b2, t) => Math.abs(t.D - 50) < Math.abs(b2.D - 50) ? t : b2, land[0]);
              const weak = land.reduce((b2, t) => t.D < b2.D ? t : b2, land[0]);
              return (
                <tr key={ty}>
                  <td>{E.PLABEL[ty]}</td>
                  <td className="num">{E.capRatePct(state, prime, ty, 80).toFixed(2)}%</td>
                  <td className="num">{E.capRatePct(state, avg, ty, 60).toFixed(2)}%</td>
                  <td className="num">{E.capRatePct(state, weak, ty, 35).toFixed(2)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="faint" style={{ fontSize: 11, marginTop: 6 }}>Your acquisition borrowing cost today: <b className="num" style={{ color: 'var(--ink)' }}>{(state.econ.rate + E.CONFIG.acqSpread).toFixed(2)}%</b>{(state.econ.capInflowMonthsLeft ?? 0) > 0 ? ' · capital inflow is compressing caps ~35 bps' : ''}</div>
      </div>
      <div className="grid2" style={{ marginBottom: 14 }}>
        <div className="panel">
          <h3>Rates & inflation — <span className="amber">base rate</span> / <span style={{ color: 'var(--blue)' }}>inflation</span></h3>
          <LineChart labels={labels} series={[
            { name: 'rate', color: 'var(--amber)', data: h.map(x => x.rate) },
            { name: 'infl', color: 'var(--blue)', data: h.map(x => x.infl) },
          ]} yFmt={v => v.toFixed(1) + '%'} />
          <div className="faint" style={{ fontSize: 11.5, marginTop: 6, lineHeight: 1.5 }}>
            Prime = base + 3.0%. Cap rates follow the base rate with a lag — when rates climb, every building in the city quietly loses value, whatever its rent roll says.
          </div>
        </div>
        <div className="panel">
          <h3>Jobs & mood — <span className="pos">employment idx</span> / <span style={{ color: 'var(--blue)' }}>confidence</span></h3>
          <LineChart labels={labels} series={[
            { name: 'emp', color: 'var(--green)', data: h.map(x => x.emp) },
            { name: 'conf', color: 'var(--blue)', data: h.map(x => x.conf) },
          ]} yFmt={v => v.toFixed(0)} />
        </div>
      </div>
      <div className="grid2">
        <div className="panel">
          <h3>Citywide rent indices (1.00 = campaign start)</h3>
          <LineChart labels={labels} series={E.PTYPES.map((ty, i) => ({
            name: ty, color: ['var(--blue)', 'var(--amber)', 'var(--green)', '#b07fd9', '#e88bb8'][i],
            data: h.map(x => x.ri?.[ty] ?? 1),
          }))} yFmt={v => v.toFixed(2)} />
          <div className="faint" style={{ fontSize: 10.5, marginBottom: 4 }}>
            <span style={{ color: 'var(--blue)' }}>office</span> · <span className="amber">retail</span> · <span className="pos">industrial</span> · <span style={{ color: '#b07fd9' }}>mixed</span> · <span style={{ color: '#e88bb8' }}>multifamily</span>
          </div>
          <table className="sc">
            <thead><tr><th>Use</th><th>Rent index</th><th>City vacancy</th><th>Read</th></tr></thead>
            <tbody>
              {E.PTYPES.map(ty => {
                const v = state.econ.cityVac[ty];
                const eq = ty === 'industrial' ? 6 : ty === 'retail' ? 8.5 : ty === 'multifamily' ? 6.5 : 10.5;
                return (
                  <tr key={ty}>
                    <td>{E.PLABEL[ty]}</td>
                    <td className="num">{state.econ.rentIdx[ty].toFixed(3)}</td>
                    <td className="num">{v.toFixed(1)}%</td>
                    <td className={v < eq - 1 ? 'pos' : v > eq + 2 ? 'neg' : 'dim'}>
                      {v < eq - 1 ? 'Tight — rents rising' : v > eq + 2 ? 'Slack — rents under pressure' : 'Balanced'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="panel">
          <h3>Cycle read</h3>
          <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--dim)' }}>
            <p style={{ marginTop: 0 }}>The market is in <b className={'phase-chip phase-' + state.econ.phase} style={{ padding: '2px 8px' }}>{state.econ.phase}</b>, {state.econ.phaseAge} months in. Base rate {state.econ.rate.toFixed(1)}%, prime {E.primeRate(state).toFixed(1)}%, inflation {state.econ.inflation.toFixed(1)}%, population growth {state.econ.popGrowth.toFixed(1)}%/yr.</p>
            <p>
              {state.econ.phase === 'recovery' && 'Sellers are tired and money is cheap. Projects started now deliver into the expansion. This is when the good vintages are planted.'}
              {state.econ.phase === 'expansion' && 'Demand is broadening and rents are climbing. Deals still pencil, but every quarter of expansion pulls the peak closer.'}
              {state.econ.phase === 'peak' && 'Everything leases fast and everything is expensive. Whatever breaks ground today delivers into whatever comes next — and what comes next is not another peak. Consider selling into this.'}
              {state.econ.phase === 'recession' && 'Values are marked down and tenants are fragile. If your debt service is covered, hold. If you have cash, the best deals of the decade are on this board.'}
            </p>
            {state.econ.crunchMonthsLeft > 0 && <p className="neg">Credit crunch: no refinancings, LTVs cut. ~{state.econ.crunchMonthsLeft} months left.</p>}
            {state.econ.ecomMonthsLeft > 0 && <p className="amber">E-commerce squeeze: retail soft, industrial strong. ~{state.econ.ecomMonthsLeft} months left.</p>}
            {state.econ.tariffMonthsLeft > 0 && <p className="amber">Material tariffs: construction +8%. ~{state.econ.tariffMonthsLeft} months left.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------- Small modals ----------------
function SellModal({ state, setState, asset, close, variant = 'dialog' }: {
  state: GameState; setState: (s: GameState) => void; asset: Asset; close: () => void; variant?: 'dialog' | 'drawer';
}) {
  const val = E.assetValue(state, asset);
  const [ask, setAsk] = useState(() => Math.round(val / 10000) * 10000);
  const [err, setErr] = useState<string | null>(null);
  const debt = E.assetTotalDebt(state, asset);
  return (
    <Modal close={close} variant={variant}>
      <h2>List {asset.name} for sale</h2>
      <div className="sub">Selling takes time. Set an ask, then field offers as they come — anywhere from lowballs to full price, depending on the market, your ask, and your name.</div>
      <div className="memo">
        <div className="memo-row"><span className="lbl">Your appraised value</span><span className="num">{E.fmtMoney(val, false)}</span></div>
        <div className="memo-row"><span className="lbl">Debt to clear at closing</span><span className="num">{E.fmtMoney(debt)}</span></div>
        <div className="memo-row"><span className="lbl">Sale costs (~{Math.round(E.CONFIG.saleCostPct * 100)}%)</span><span className="num">~{E.fmtMoney(val * E.CONFIG.saleCostPct)}</span></div>
      </div>
      <label className="f">Asking price — {E.fmtMoney(ask)} <span className="faint">({Math.round((ask / Math.max(1, val)) * 100)}% of appraisal)</span>
        <input type="range" min={Math.round(val * 0.7 / 10000) * 10000} max={Math.round(val * 1.35 / 10000) * 10000} step={10000}
          value={ask} onChange={e => setAsk(Number(e.target.value))} />
      </label>
      <div className="dim" style={{ fontSize: 11.5, marginBottom: 10, lineHeight: 1.55 }}>
        Price it under appraisal and the phone rings sooner. Price it rich and you'll wait — though the longer it sits, the more the market wonders what's wrong with it.
      </div>
      {err && <div className="alert-strip red" style={{ marginBottom: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn" onClick={close}>Not yet</button>
        <button className="btn btn-amber" onClick={() => {
          const r = E.listAssetForSale(state, asset.id, ask);
          if (r.err) setErr(r.err); else { setState(r.s); close(); }
        }}>Put it on the market</button>
      </div>
    </Modal>
  );
}

function PostMortemModal({ pm, close }: { pm: PostMortem; close: () => void }) {
  return (
    <Modal close={close}>
      <h2>Deal post-mortem — {pm.assetName}</h2>
      <div className="sub">
        Realized {pm.profit >= 0 ? 'profit' : 'loss'} of <b className={'num ' + (pm.profit >= 0 ? 'pos' : 'neg')}>{E.fmtMoney(Math.abs(pm.profit))}</b>
        {pm.irr !== null && <> · <b className="num">{pm.irr.toFixed(1)}%</b> IRR on your equity</>}
      </div>
      <div className="memo">
        {pm.parts.map((p, i) => (
          <div key={i} style={{ padding: '6px 0', borderBottom: i < pm.parts.length - 1 ? '1px solid var(--line2)' : 'none' }}>
            <div className="memo-row" style={{ padding: 0 }}>
              <span style={{ fontWeight: 650 }}>{p.label}</span>
              <span className={'num ' + (p.amt >= 0 ? 'pos' : 'neg')}>{p.amt >= 0 ? '+' : ''}{E.fmtMoney(p.amt)}</span>
            </div>
            <div className="dim" style={{ fontSize: 11.5, marginTop: 2 }}>{p.note}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--amber)', background: '#241d10', border: '1px solid #6a5423', borderRadius: 5, padding: '10px 12px' }}>
        {pm.lesson}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        <button className="btn btn-amber" onClick={close}>Noted</button>
      </div>
    </Modal>
  );
}

function EventModal({ state, setState, asset, kind }: {
  state: GameState; setState: (s: GameState) => void; asset: Asset; kind: string;
}) {
  const info: Record<string, { title: string; body: string; absorb: string; mitigate: string }> = {
    materials: {
      title: 'Material prices spike',
      body: `Steel and concrete just repriced under ${asset.name}. Your contractor is holding out a change order worth roughly 4–10% of remaining hard costs.`,
      absorb: 'Eat the increase — keep the spec',
      mitigate: 'Value-engineer — pay ~45% of it, but finishes drop a grade',
    },
    labor: {
      title: 'Labor shortage',
      body: `Crews are being poached across the city and ${asset.name} is falling behind. Throw money at it, or let the schedule slip while the interest clock runs.`,
      absorb: 'Accept a 2-month delay',
      mitigate: 'Pay overtime — +3% of hard cost, hold the schedule',
    },
    default: {
      title: 'Your contractor walked',
      body: `The budget GC on ${asset.name} has defaulted mid-job. This is what the discount bought you. Both paths hurt; pick the flavor.`,
      absorb: 'Litigate & finish with subs — +9% cost, +4 months',
      mitigate: 'Re-bid fast to a new GC — +5% cost, +2 months',
    },
  };
  const p = asset.project;
  if (kind === 'ddResult' && p?.dd) {
    const cond = p.dd.known ?? { kind: 'none' as E.SiteCondKind, cost: 0, delayMo: 0 };
    const clean = cond.kind === 'none';
    return (
      <Modal close={() => { }}>
        <h2>{clean ? '✓' : '⚠'} Diligence is back — {asset.name}</h2>
        <div className="sub">{E.SITE_COND_LABEL[cond.kind]}{!clean && !cond.sfLossFrac ? ` — ${E.fmtMoney(cond.cost)} to deal with${cond.delayMo ? `, +${cond.delayMo} months` : ''}` : ''}
          {cond.sfLossFrac ? ` — buildable area shrinks ~${Math.round(cond.sfLossFrac * 100)}%` : ''}</div>
        <div className="dim" style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 12 }}>
          {clean
            ? 'The drills found nothing. The site is what it looked like. Close, and this money was spent on certainty.'
            : 'Now you know — before your equity does. Close with the problem priced into the budget and schedule, or walk: the deposit and diligence are sunk either way, and sometimes that is the best money a developer ever spends.'}
        </div>
        <div style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
          <button className="btn btn-amber" onClick={() => setState(E.resolveConstrEvent(state, asset.id, 'absorb'))}>Close on the land — proceed{clean ? '' : ' with it priced in'}</button>
          <button className="btn" onClick={() => setState(E.resolveConstrEvent(state, asset.id, 'mitigate'))}>Walk away — forfeit {E.fmtMoney(p.dd.deposit)} deposit + {E.fmtMoney(p.dd.ddFee)} diligence</button>
        </div>
      </Modal>
    );
  }
  if (kind === 'siteSurprise' && p?.siteCond) {
    const cond = p.siteCond;
    return (
      <Modal close={() => { }}>
        <h2>⚠ Excavation surprise — {asset.name}</h2>
        <div className="sub">{E.SITE_COND_LABEL[cond.kind]}. You waived diligence; it surfaced anyway — at a multiple, mid-build, on the clock.</div>
        <div className="dim" style={{ fontSize: 12, marginBottom: 12 }}>
          Contingency remaining: <b className="num" style={{ color: 'var(--ink)' }}>{E.fmtMoney(p.contingencyLeft)}</b>.
          {p.contractType === 'gmp' ? ' Site conditions sit OUTSIDE the GMP — this one is yours.' : ''} The interest reserve keeps burning through every delay.
        </div>
        <div style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
          <button className="btn" onClick={() => setState(E.resolveConstrEvent(state, asset.id, 'absorb'))}>Pay to fix it properly — full cost, full delay</button>
          <button className="btn" onClick={() => setState(E.resolveConstrEvent(state, asset.id, 'mitigate'))}>Redesign around it — smaller building, partial cost</button>
          <button className="btn btn-danger" onClick={() => setState(E.resolveConstrEvent(state, asset.id, 'abandon'))}>Abandon the project — repay drawn debt, keep the dirt if you can</button>
        </div>
      </Modal>
    );
  }
  const d = info[kind] ?? info.materials;
  return (
    <Modal close={() => { }}>
      <h2>⚠ {d.title}</h2>
      <div className="sub">{d.body}</div>
      <div className="dim" style={{ fontSize: 12, marginBottom: 12 }}>
        Contingency remaining: <b className="num" style={{ color: 'var(--ink)' }}>{E.fmtMoney(asset.project?.contingencyLeft ?? 0)}</b> — costs beyond it come straight from your cash.
      </div>
      <div style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
        <button className="btn" onClick={() => setState(E.resolveConstrEvent(state, asset.id, 'absorb'))}>{d.absorb}</button>
        <button className="btn" onClick={() => setState(E.resolveConstrEvent(state, asset.id, 'mitigate'))}>{d.mitigate}</button>
      </div>
    </Modal>
  );
}

function GameOverModal({ state, restart }: { state: GameState; restart: () => void }) {
  return (
    <Modal close={() => { }}>
      <h2>The bank owns it all now</h2>
      <div className="sub">{state.gameOverReason}</div>
      <div className="memo">
        <div className="memo-row"><span className="lbl">Campaign length</span><span className="num">{Math.floor(state.month / 12)} years, {state.month % 12} months</span></div>
        <div className="memo-row"><span className="lbl">Deals closed</span><span className="num">{state.dealsClosed}</span></div>
        <div className="memo-row"><span className="lbl">Realized P&L over the run</span><span className={'num ' + (state.totalRealizedProfit >= 0 ? 'pos' : 'neg')}>{E.fmtMoney(state.totalRealizedProfit)}</span></div>
      </div>
      <div className="dim" style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 14 }}>
        Real estate rarely kills you with bad buildings — it kills you with good buildings and too much debt at the wrong moment in the cycle. Next run: lower leverage into peaks, keep 6 months of cash, and let the recession be your buying season.
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-amber" onClick={restart}>Start a new campaign</button>
      </div>
    </Modal>
  );
}
