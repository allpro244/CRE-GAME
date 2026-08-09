import * as E from '/tmp/engine.mjs';
const s = E.newGame(42);
// 1) effective expense ratios (net of recoveries) at ~92% occupancy
for (const ty of E.PTYPES) {
  const t = s.tiles.find(t => !t.water && t.D > 45);
  const units = ty==='industrial'?1:ty==='multifamily'?40:6;
  const a = { tileI: t.i, type: ty, sf: 20000, quality: 90, units, construction: E.CONSTR[ty][1]?.id ?? E.CONSTR[ty][0].id, maint: 'std', tenants: [], occ: 0.92 };
  const pot = 20000 * E.assetRentPSF(s, a) / 12;
  const ex = E.expenseBreakdown(s, a, pot, pot*0.92);
  console.log(ty.padEnd(11), 'net exp/pot:', (ex.total/pot).toFixed(3), '| exp/EGI:', (ex.total/(pot*0.92)).toFixed(3));
}
// 2) listing going-in caps vs borrow over 24 months
let s2 = E.newGame(7);
let caps = [], afford = 0, qual = 0, seen = 0, mfCaps = [];
for (let m = 0; m < 24; m++) {
  for (const l of s2.listings) {
    if (l.kind !== 'building') continue;
    seen++;
    const pf = E.proFormaBuilding(s2, l);
    caps.push(pf.capNow);
    if (l.type === 'multifamily') mfCaps.push(pf.capNow);
    const rate = s2.econ.rate + 2.0;
    if (pf.capNow > rate + 0.3) { qual++; if (600000 > l.price*0.25 + 15000 + 150000) afford++; }
  }
  s2 = E.advanceMonth(s2);
}
caps.sort((a,b)=>a-b);
const q = (arr,p) => arr.length ? arr[Math.floor(arr.length*p)].toFixed(2) : '—';
console.log('capNow p10/p50/p90:', q(caps,.1), q(caps,.5), q(caps,.9), '| MF p50:', q(mfCaps.sort((a,b)=>a-b),.5), '| borrow~', (s2.econ.rate+2).toFixed(1));
console.log('seen', seen, 'qualifying', qual, 'affordable', afford);
// 3) dev spreads incl multifamily
const s3 = E.newGame(42);
for (const ty of E.PTYPES) {
  const spreads = [];
  for (const t of s3.tiles) {
    if (t.water) continue;
    const cid = ty==='industrial'?'metal':ty==='retail'?'strip':ty==='office'?'concrete':ty==='multifamily'?'garden':'podium';
    const units = ty==='industrial'?1:ty==='multifamily'?20:ty==='retail'?5:4;
    const psfLand = (1 + Math.pow(t.D / 100, 2.2) * 55) * (t.indSuit > 55 ? 0.40 : 1);
    const sf = 18000;
    const l = { tileI: t.i, price: psfLand*43560*(sf/(E.FAR[ty]*43560)), kind: 'land', acres: sf/(E.FAR[ty]*43560) };
    const pf = E.proFormaLand(s3, l, { type: ty, sf, units, construction: cid, contractor:'standard', contingencyPct:0.10, expedited:false, downPct:0.35 });
    spreads.push(pf.spread);
  }
  spreads.sort((a,b)=>a-b);
  console.log(ty.padEnd(11), 'dev spread p50/p90/max:', q(spreads,.5), q(spreads,.9), spreads[spreads.length-1].toFixed(2));
}

// ---- desirability & demand distribution (emergent mix model) ----
{
  const pct = (arr, p) => arr.length ? arr[Math.floor(arr.length * p)].toFixed(1) : '—';
  for (const label of ['month 0', 'month 120']) {
    const s = E.newGame(42);
    let st = s;
    if (label === 'month 120') for (let m = 0; m < 120; m++) st = E.advanceMonth(st);
    const land = st.tiles.filter(t => !t.water);
    const D = land.map(t => t.D).sort((a, b) => a - b);
    const mixNow = E.computeMix(st);
    const mixVals = land.map(t => mixNow[t.i]).sort((a, b) => a - b);
    const pop = Math.round(land.reduce((x, t) => x + t.pop, 0) / land.length * 10) / 10;
    const emp = Math.round(land.reduce((x, t) => x + t.emp, 0) / land.length * 10) / 10;
    console.log(`${label}: D p10/p50/p90 ${pct(D, .1)}/${pct(D, .5)}/${pct(D, .9)} | mix p50/p90 ${pct(mixVals, .5)}/${pct(mixVals, .9)} | avg pop ${pop} emp ${emp} | cityPop ${E.cityPopulation(st).toLocaleString()}`);
  }
}
