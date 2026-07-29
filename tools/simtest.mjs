import * as E from '/tmp/engine.mjs';

function run(seed, city) {
  let s = E.newGame(seed, city ? { city } : undefined);
  // street network invariants: right shape, sane classes, nobody landlocked
  const W = E.CONFIG.GRID_W, H = E.CONFIG.GRID_H;
  if (!s.roads || s.roads.hz.length !== H + 1 || s.roads.vt.length !== H) throw new Error('roads: bad shape');
  for (const row of s.roads.hz) { if (row.length !== W) throw new Error('roads: hz row'); for (const c of row) if (!Number.isInteger(c) || c < 0 || c > 5) throw new Error('roads: bad class ' + c); }
  for (const row of s.roads.vt) { if (row.length !== W + 1) throw new Error('roads: vt row'); for (const c of row) if (!Number.isInteger(c) || c < 0 || c > 5) throw new Error('roads: bad class ' + c); }
  for (const t of s.tiles) {
    if (t.water) continue;
    if (!(s.roads.hz[t.y][t.x] || s.roads.hz[t.y + 1][t.x] || s.roads.vt[t.y][t.x] || s.roads.vt[t.y][t.x + 1])) throw new Error('landlocked tile ' + t.i);
    if (!t.acc || !isFinite(t.acc.art + t.acc.hwy + t.acc.rail + t.acc.quiet)) throw new Error('bad access on tile ' + t.i);
  }
  if (seed % 2 === 0) s = E.setAutoLease(s, true);
  let banked=0, demoed=0, matched=0, converted=0, listedForSale=0, haggled=0, approaches=0, bought=0, developed=0, sold=0, refis=0, signed=0, walked=0, offers=0, omBought=0, defaults=0, facMade=0;
  const startNews = () => s.news.length;
  for (let m = 0; m < 360; m++) {
    while (s.pending.length > 0) {
      const pd = s.pending[0];
      if (pd.type === 'assetEvent') s = E.resolveAssetEvent(s, pd.assetId, Math.random() < 0.5 ? 'a' : 'b');
      else s = E.resolveConstrEvent(s, pd.assetId, Math.random() < 0.5 ? 'absorb' : 'mitigate');
    }
    if (s.gameOver) break;
    // respond to LOIs: accept if their rate >= 92% of building market; counter at market if low; propose market for RFPs
    for (const loi of [...s.lois]) {
      const a = s.assets.find(x => x.id === loi.assetId);
      if (!a) continue;
      const mkt = E.assetRentPSF(s, a);
      let r;
      if (loi.kind === 'renewal') r = E.respondLOI(s, loi.id, (loi.rate ?? 0) >= mkt * 0.85 ? { type: 'accept' } : { type: 'counter', rate: mkt * 0.95, termY: 5 });
      else if (loi.kind === 'rfp') r = E.respondLOI(s, loi.id, { type: 'propose', rate: mkt * 0.99, termY: 5 });
      else if (loi.stage === 'countered') r = E.respondLOI(s, loi.id, { type: 'accept' });
      else if ((loi.rate ?? 0) >= mkt * 0.92) r = E.respondLOI(s, loi.id, { type: 'accept' });
      else r = E.respondLOI(s, loi.id, { type: 'counter', rate: mkt * 0.98, termY: loi.termY ?? 5 });
      s = r.s;
      if (r.outcome === 'signed') signed++; if (r.outcome === 'walked') walked++;
    }
    // scout off-market sometimes, negotiate
    if (E.canScout(s).ok && Math.random() < 0.25 && s.cash > 700000) {
      if (Math.random() < 0.4 && s.stock.length) {
        const b = s.stock[Math.floor(Math.random()*s.stock.length)];
        const r = E.approachOwner(s, b.id);
        s = r.s; if (r.lead) approaches++;
      } else s = E.doScout(s).s;
    }
    for (const l of [...s.listings]) {
      if (l.kind === 'offmarket' && !l.agreed && (l.offersLeft ?? 0) > 0) {
        const pf = E.proFormaBuilding(s, l);
        const bid = l.counterAt ?? Math.round(pf.stabValue * 0.85);
        offers++;
        const r = E.makeOffer(s, l.id, bid);
        s = r.s;
      }
    }
    // buy: agreed off-market first, then listings with positive leverage
    const rate = s.econ.rate + 2.0;
    for (const l of [...s.listings]) {
      if (s.assets.length >= 6) break;
      if (l.kind === 'land') {
        if (s.cash > 900000 && (s.econ.phase==='recovery'||s.econ.phase==='expansion')) {
          const ty = s.tiles[l.tileI].indSuit > 55 ? 'industrial' : 'retail';
          const specs = { industrial:'metal', retail:'strip' };
          const sf = Math.min(15000, E.maxBuildableSF(l, ty), E.CONFIG.tiers[s.tier].maxSF);
          if (sf >= 5000) {
            const units = ty==='retail' ? Math.max(3, Math.floor(sf/2500)) : 1;
            const r = E.buyLandAndDevelop(s, l.id, { type: ty, sf, units, construction: specs[ty], contractor:'standard', contingencyPct:0.10, expedited:false, downPct:0.35, contractType: Math.random()<0.5?'gmp':'costplus', bonded: Math.random()<0.5, fixedRate: Math.random()<0.3, diligence: Math.random()<0.5, designTier: ['ve','std','signature'][Math.floor(Math.random()*3)] });
            if (!r.err) { s = r.s; developed++; }
          }
        }
        continue;
      }
      const pf = E.proFormaBuilding(s, l);
      const ok = l.kind === 'offmarket' ? l.agreed && pf.stabValue > l.price * 1.02 : pf.capNow > rate + 0.3;
      const down = l.price * 0.3 + 15000;
      if (ok && s.cash > down + 150000) {
        const r = E.buyBuilding(s, l.id, 0.3);
        if (!r.err) { s = r.s; bought++; if (l.kind==='offmarket') omBought++; }
      }
    }
    // respond to purchase offers on our own listings
    for (const o of [...s.saleOffers]) {
      const a = s.assets.find(x => x.id === o.assetId);
      if (!a) continue;
      const val = E.assetValue(s, a);
      let r;
      if (o.amount >= val * 0.9) r = E.respondSaleOffer(s, o.id, { type: 'accept' });
      else if (o.amount >= val * 0.7) r = E.respondSaleOffer(s, o.id, { type: 'counter', amount: val * 0.95 });
      else r = E.respondSaleOffer(s, o.id, { type: 'decline' });
      s = r.s;
      if (r.outcome === 'sold') sold++;
    }
    // occasionally negotiate a regular listing down
    for (const l of [...s.listings]) {
      if (l.kind === 'building' && !l.yourSale && !l.agreed && !l.declinedYou && !l.hot && Math.random() < 0.06) {
        const r = E.makeOffer(s, l.id, l.price * 0.93); s = r.s; if (r.result==='accepted') haggled++;
        if (r.result === 'countered' && l.counterAt) { const r2 = E.makeOffer(s, l.id, r.counter ?? l.price*0.97); s = r2.s; }
      }
    }
    // match rival bids half the time
    for (const l of s.listings) {
      if (l.rivalBid && Math.random() < 0.5) { const r = E.matchRivalBid(s, l.id); if (!r.err) { s = r.s; matched++; } }
    }
    // convert dying offices
    for (const a of s.assets) {
      if (a.type === 'office' && a.occ < 0.3 && E.canConvert(s, a).ok && Math.random() < 0.3) {
        const r = E.startConversion(s, a.id); if (!r.err) { s = r.s; converted++; }
      }
    }
    // land banking (the honest way: call the owner, take the ask) + demolition
    if (Math.random() < 0.08 && s.cash > 900000 && s.approachesLeft > 0) {
      const t2 = s.tiles.filter(x => !x.water && E.freeParcelCount(s, x.i) >= 4)[Math.floor(Math.random() * 4)] ?? s.tiles.filter(x => !x.water && E.freeParcelCount(s, x.i) >= 4)[0];
      if (t2) { const g = E.parcelGrid(s, t2.i);
        for (let k = 0; k < 16; k++) if (g[k] === null) {
          const r = E.approachParcelOwner(s, t2.i, k);
          s = r.s;
          if (r.listing && s.cash > r.listing.price + 10000) {
            const r2 = E.buyLandHold(s, r.listing.id);
            if (!r2.err) { s = r2.s; banked++; }
          }
          break;
        } }
    }
    for (const a of s.assets) {
      if (a.occ <= 0.15 && E.canDemolish(s, a).ok && Math.random() < 0.25) { const r = E.demolish(s, a.id); if (!r.err) { s = r.s; demoed++; } }
    }
    // manage: refi with custom terms; sell at peak; build facility once
    for (const a of [...s.assets]) {
      if (a.mode==='operating' && s.month - a.acqMonth > 72 && s.econ.phase==='peak' && !a.forSale) {
        const r = E.listAssetForSale(s, a.id, E.assetValue(s, a) * 1.02); if (!r.err) { s = r.s; listedForSale++; }
      } else if (a.mode==='operating' && a.occ > 0.85 && E.assetDebt(a) < E.assetValue(s,a)*0.4 && Math.random()<0.05) {
        const lim = E.refiLimits(s, a);
        const r = E.doRefi(s, a.id, { amount: Math.min(lim.maxByLTV, lim.val*0.65), amortYears: 25 });
        if (!r.err) { s = r.s; refis++; }
      }
    }
    if (facMade===0 && s.facilities.length===0) {
      const elig = s.assets.filter(a => a.mode==='operating' && a.occ>=0.75);
      if (elig.length >= 2 && Math.random() < 0.1) {
        const ids = elig.slice(0,2).map(a=>a.id);
        const q = E.facilityQuote(s, ids);
        const r = E.createFacility(s, ids, Math.max(q.payoff*1.05, q.maxLoan*0.85));
        if (!r.err) { s = r.s; facMade++; }
      }
    }
    const before = s.news.filter(n=>n.text.includes('defaulted')).length;
    s = E.advanceMonth(s);
    defaults += s.news.filter(n=>n.text.includes('defaulted')).length - before > 0 ? 1 : 0;
    const nw = E.netWorth(s);
    if (!isFinite(nw) || !isFinite(s.cash)) throw new Error('NaN at month ' + s.month);
    // desirability stays inside the model's bounds and the anchor stays finite
    for (const t of s.tiles) {
      if (t.water) continue;
      if (!isFinite(t.D) || t.D < 5 - 1e-9 || t.D > 98 + 1e-9) throw new Error('bad D ' + t.D + ' tile ' + t.i);
      if (!isFinite(t.baseD) || t.baseD < 0 - 1e-9) throw new Error('bad baseD ' + t.baseD + ' tile ' + t.i);
      if (!isFinite(t.pop) || !isFinite(t.emp)) throw new Error('bad pop/emp tile ' + t.i);
    }
    // supply ledger honesty: per-tile supply must equal what is actually standing
    {
      const exp = s.tiles.map(() => ({ office: 0, retail: 0, industrial: 0, mixed: 0, multifamily: 0 }));
      for (const b of s.stock) if (!b.buildLeft) exp[b.tileI][b.type] += b.sf;
      for (const a of s.assets) if (a.mode !== 'construction') exp[a.tileI][a.type] += a.sf;
      for (const t of s.tiles) for (const ty of E.PTYPES) {
        if (Math.abs((t.supply[ty] ?? 0) - exp[t.i][ty]) > 0.5)
          throw new Error(`supply drift tile ${t.i} ${ty}: ledger ${t.supply[ty]} vs standing ${exp[t.i][ty]} at month ${s.month}`);
      }
    }
    for (const t3 of s.tiles) {
      if (t3.water) continue;
      const seen = new Set();
      const put = (o, tag) => { if (o.px === undefined) return;
        for (let y = o.py; y < o.py + o.ph; y++) for (let x = o.px; x < o.px + o.pw; x++) {
          const k = y * 4 + x; if (seen.has(k)) throw new Error('parcel collision ' + tag + ' on tile ' + t3.i); seen.add(k); } };
      for (const b of s.stock) if (b.tileI === t3.i) put(b, 'stock');
      for (const a of s.assets) if (a.tileI === t3.i) put(a, 'asset');
      for (const h of s.land) if (h.tileI === t3.i) { for (const c of h.cells) { if (seen.has(c)) throw new Error('land parcel collision'); seen.add(c); } }
    }
    for (const b of s.stock) {
      if (b.listedId && !s.listings.some(l => l.id === b.listedId)) throw new Error('dangling listedId');
    }
    for (const l of s.listings) {
      if (l.stockId && !s.stock.some(b => b.id === l.stockId)) throw new Error('listing points at missing stock');
      if (l.stockId && s.stock.find(b => b.id === l.stockId).listedId !== l.id) throw new Error('listedId mismatch');
    }
    for (const a of s.assets) {
      if (!isFinite(a.occ) || a.occ < 0 || a.occ > 1.0001) throw new Error('bad occ ' + a.occ);
      const ls = E.leasedSF(a);
      if (ls > a.sf * 1.001) throw new Error('overleased: ' + ls + '/' + a.sf);
      if (!isFinite(E.assetValue(s, a))) throw new Error('bad value');
    }
  }
  return { seed, banked, demoed, land: s.land.length, uc: s.stock.filter(b=>b.buildLeft).length, jvs: s.assets.filter(a=>a.jv).length, matched, converted, nol: Math.round(s.nolCarry/1000), agent: s.autoLease ? 1 : 0, comps: s.comps.length, ci: Math.round((s.econHistory[s.econHistory.length-1].ci ?? 1)*100)/100, listedForSale, haggled, rep: Math.round(s.reputation), approaches, stock: s.stock.length, nw: Math.round(E.netWorth(s)), cash: Math.round(s.cash), bought, omBought, developed, sold, refis, signed, walked, offers, facMade, fac: s.facilities.length, defaults, over: s.gameOver, assets: s.assets.length };
}
for (const seed of [11, 42, 1337, 90210, 7, 555]) console.log(JSON.stringify(run(seed)));
for (const seed of [21, 84]) console.log(JSON.stringify({ city: 'island', ...run(seed, 'island') }));
