// WHAT A GLUT DOES TO THE MARKET, AND TO THE BUILDINGS YOU ALREADY OWN.
//
//   node test/glut.mjs                          office, 25% of stock
//   CLASS=retail DOSE=0.40 node test/glut.mjs
//   CLASS=office DOSE=0.10,0.25,0.40 SEEDS=11,22,33 YRS=12 node test/glut.mjs
//
// Test B in econ:accept already asks whether ONE 10% delivery moves the city.
// This asks the landlord's question instead, which is a different question and
// the one the game is actually about: a competitor dumps a ton of space on your
// market, and what happens to YOUR rent roll — how fast you let space, what you
// have to give away to let it, and whether the tenants you already have stay.
//
// PAIRED CONTROL. The injection changes decisions, so it changes the RNG path,
// so a treatment run compared against its own past is comparing two different
// centuries. Every dose is run against a control that is identical in seed, in
// portfolio and in the landlord's behaviour, and differs only in whether the
// building exists. Several seed pairs, because the pair-to-pair spread is
// large — the same reason test D is a mean over twelve and not a median over
// three.
//
// THE LANDLORD IS DELIBERATELY UNSKILLED. He answers every letter at asking and
// never counters, exactly as tests A and B do, so what moves is the market and
// not a bot's judgement.
//
// WHAT THE REAL WORLD DOES, and what this is therefore checking:
//   - Face rents are STICKY DOWNWARD and effective rents are not. A landlord
//     protects the headline number — it is what the lender's covenant and the
//     appraiser read — and discounts through free rent and TI instead. Wheaton
//     & Torto, and every glut on record: effective rent falls roughly TWO TO
//     THREE TIMES as far as asking rent.
//   - Leasing VELOCITY collapses before price does. Deal flow dries up first;
//     the price follows months later.
//   - Concessions blow out: US office gluts take free rent from ~6 months to
//     15-20 on a ten-year lease, and TI from ~$60 to $100-150/sf.
//   - Net absorption goes NEGATIVE — the standing stock loses tenants, it does
//     not merely stop gaining them.
//   - Dallas added about 40% to its downtown office stock in the early 1980s
//     and took fifteen years to re-let it. Houston added ~15% in 2014-17. So a
//     40% dose is not a fantasy, it is the worst case on the record.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

const { parcels: P0, adjacency, bbls } = loadCity(0, E.normalizeParcels);
const clone = () => JSON.parse(JSON.stringify(P0));
const KLASS = process.env.CLASS ?? "office";
const DOSES = (process.env.DOSE ?? "0.25").split(",").map(Number);
const SEEDS = (process.env.SEEDS ?? "550991,12007,11,4242,91117").split(",").map(Number);
const PRE = Number(process.env.PRE ?? 60);            // months to stabilise before the shock
const POST = Number(process.env.YRS ?? 12) * 12;      // months to watch after it
const OWN = Number(process.env.OWN ?? 12);            // buildings the player holds

// The engine's own natural vacancy by class (market.ts NATURAL_VAC), so the
// duration lines below measure excess availability and not the level.
const NATURAL = { office: 0.115, retail: 0.085, multifamily: 0.045, industrial: 0.07 };

// How much of THIS class a building actually carries.
const classSf = (rec) => (E.mixOf(rec)[KLASS] ?? 0) * (rec.bldgArea ?? 0);
// The smallest slice of this class worth calling a landlord's building. Retail
// and industrial live in smaller units than office and flats do, and this city
// has few of either, so the threshold is per class rather than one number that
// happens to suit towers.
const MINSF = Number(process.env.MINSF ?? ({ office: 12000, multifamily: 12000, retail: 6000, industrial: 6000 }[KLASS] ?? 8000));

const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
const med = (xs) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[Math.floor((a.length - 1) / 2)] : NaN; };
const sd = (xs) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };
const pct = (v) => (Number.isFinite(v) ? (v * 100).toFixed(1) + "%" : "  —  ");
const pp = (v) => (Number.isFinite(v) ? (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "pp" : "  —  ");

// STRAIGHT-LINE NET EFFECTIVE RENT, the number the trade actually quotes:
// face rent less the free months, less the TI amortised over the term.
const ner = (rentPsf, termM, freeM, tiPsf) => {
  const yrs = Math.max(1 / 12, termM / 12);
  return rentPsf * (1 - Math.min(0.95, (freeM ?? 0) / Math.max(1, termM))) - (tiPsf ?? 0) / yrs;
};

// Answer every letter at asking. The least-skilled landlord there is.
function acceptAll(g, parcels, log) {
  for (const l of [...g.lois]) {
    if (!g.lois.find((x) => x.id === l.id)) continue;
    const r = E.respondLOI(g, parcels, l.id, "accept", true);
    if (r.err) continue;              // only count what SIGNED, not what arrived
    g = r.s;
    if (log) log.push({ kind: l.kind, bbl: l.bbl, use: l.use, sf: l.sf, rentPsf: l.rentPsf, termM: l.termM, freeM: l.freeM ?? 0, tiPsf: l.tiPsf ?? 0 });
  }
  return g;
}

// The player's rent roll, in aggregate, across everything he owns of this class.
// FLATS DO NOT HAVE A RENT ROLL, AND READING THEM AS IF THEY DID REPORTS ZERO.
//
// leasing.ts, line 4: "Multifamily skips all of this and runs aggregate
// occupancy." Residential space is a scalar `h.occ` walked toward the market
// each month, not a list of named tenants and not a letter on the desk — so a
// `h.tenants` filter finds nothing on a block of flats and an honest-looking
// table reads 0.0% occupancy, no deals, no downtime, at every dose. That is
// this harness measuring an empty set, and the first cut of it did exactly
// that and would have reported a residential landlord who feels nothing.
function book(g, parcels, mine) {
  let sf = 0, occ = 0, wr = 0, tenants = 0;
  for (const bbl of mine) {
    const rec = E.resolveRec(parcels, g, bbl);
    const h = g.holdings[bbl];
    if (!rec || !h) continue;
    const cs = classSf(rec);
    sf += cs;
    if (KLASS === "multifamily") {
      occ += cs * (h.occ ?? 0);
      wr += cs * (h.occ ?? 0) * E.useRentPsfYr(rec, g.econ, rec.condition ?? "standard", "multifamily");
      continue;
    }
    for (const t of h.tenants) {
      if ((t.use ?? rec.class) !== KLASS) continue;   // a shop under flats is a retail lease
      occ += t.sf; wr += t.sf * t.rentPsf; tenants++;
    }
  }
  return { sf, occ, rent: occ > 0 ? wr / occ : 0, tenants, vacant: Math.max(0, sf - occ) };
}

// ---------------------------------------------------------------------------
// ONE RUN. `dose` of 0 is the control.
// ---------------------------------------------------------------------------
function run(seed, dose) {
  const parcels = clone();
  let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  g = { ...g, cash: 3_000_000_000 };

  // BUY A BOOK OF THIS CLASS, spread across the demand gradient so the answer
  // is a portfolio's and not one lucky corner's.
  //
  // BY MIX, NOT BY LABEL. A shop under a block of flats is a retail lease in a
  // retail market — the Tenant type says so in its own comment — and this city
  // has exactly THREE buildings whose parcel class is "retail" and whose area
  // is over 15,000 sf, against thirty carrying that much retail inside a mixed
  // stack. Selecting on `rec.class` measured the label and found no landlord.
  const stock = bbls.map((b) => parcels[b])
    .filter((r) => r && r.class && r.class !== "land" && r.bldgArea > 0
      && (E.mixOf(r)[KLASS] ?? 0) * r.bldgArea >= MINSF)
    .sort((a, b) => a.demandScore - b.demandScore);
  const want = Math.min(OWN, stock.length);
  if (want < 3) return null;
  const mine = [];
  for (let i = 0; i < want; i++) {
    const rec = stock[Math.floor((i + 0.5) / want * stock.length)];
    if (!rec || mine.includes(rec.bbl)) continue;
    const r = E.executePurchase(g, parcels, rec.bbl, 5_000_000, "cash", false, 1);
    if (r.err) continue;
    g = r.s;
    g.holdings[rec.bbl].broker = true;
    mine.push(rec.bbl);
  }
  if (mine.length < 3) return null;

  const cityStock = g.econ.stock?.[KLASS] ?? 0;
  const path = [];
  const deals = [];        // every letter signed, month-stamped
  let injected = 0, siteBbl = null;
  // HOW LONG A VACANT FOOT SITS. Tracked per building: when the building's
  // vacant space grows, the new feet start a clock; when it shrinks, the
  // oldest waiting feet are let and their wait is recorded. This is the
  // landlord's own downtime, which is the question, and it is not the same
  // number as the citywide vacancy rate.
  const waiting = new Map();          // bbl -> [{sf, sinceM}]
  const downtime = [];                // {m, sf, months}

  for (let m = 0; m < PRE + POST; m++) {
    // THE SHOCK, at month PRE: one delivery equal to `dose` of citywide stock,
    // finished and empty, on a good lot, in SOMEBODY ELSE'S hands — the point
    // is what a competitor's building does to yours.
    if (m === PRE && dose > 0) {
      const site = bbls.map((b) => E.resolveRec(parcels, g, b))
        .filter((r) => r && r.class === "land" && r.lotArea > 6000 && !g.holdings[r.bbl])
        .sort((a, b) => b.demandScore - a.demandScore)[2];
      if (site) {
        injected = Math.round(g.econ.stock[KLASS] * dose);
        g = { ...g, built: { ...g.built, [site.bbl]: {
          class: KLASS, mix: { [KLASS]: 1 }, bldgArea: injected,
          floors: Math.max(2, Math.round(injected / Math.max(1, site.lotArea) / 0.7)),
          yearBuilt: 1900 + Math.floor((g.month) / 12) } } };
        E.addStock(g.econ, KLASS, injected);
        siteBbl = site.bbl;
      }
    }
    g = E.advanceQuarter(g, parcels, bbls, adjacency);
    const sign = [];
    const loiN = g.lois.filter((l) => mine.includes(l.bbl) && (l.use ?? KLASS) === KLASS).length;
    g = acceptAll(g, parcels, sign);
    for (const d of sign) if (mine.includes(d.bbl) && (d.use ?? KLASS) === KLASS) deals.push({ m: m - PRE, ...d });

    const e = g.econ, b = book(g, parcels, mine);
    for (const bbl of mine) {
      const rec = E.resolveRec(parcels, g, bbl);
      const h = g.holdings[bbl];
      if (!rec || !h) continue;
      const vac = KLASS === "multifamily"
        ? Math.max(0, classSf(rec) * (1 - (h.occ ?? 0)))
        : Math.max(0, classSf(rec)
          - h.tenants.reduce((a, t) => a + ((t.use ?? rec.class) === KLASS ? t.sf : 0), 0));
      const q = waiting.get(bbl) ?? [];
      const held = q.reduce((a, x) => a + x.sf, 0);
      if (vac > held + 1) q.push({ sf: vac - held, sinceM: m });
      else if (vac < held - 1) {
        let let_ = held - vac;
        while (let_ > 1 && q.length) {
          const head = q[0];
          const take = Math.min(head.sf, let_);
          downtime.push({ m: m - PRE, sf: take, months: m - head.sinceM });
          head.sf -= take; let_ -= take;
          if (head.sf <= 1) q.shift();
        }
      }
      waiting.set(bbl, q);
    }
    path.push({
      m: m - PRE,
      vac: e.cityVac?.[KLASS] ?? 0,
      face: (e.rentIdx?.[KLASS] ?? 0) / (e.cpi || 1),
      eff: (e.effRentIdx?.[KLASS] ?? e.rentIdx?.[KLASS] ?? 0) / (e.cpi || 1),
      conc: e.concIdx?.[KLASS] ?? 0,
      occ: b.sf > 0 ? b.occ / b.sf : 0,
      occSf: b.occ, sf: b.sf, tenants: b.tenants, vacantSf: b.vacant,
      loi: loiN,
      roll: b.rent / (e.cpi || 1),
    });
    if (g.gameOver) g = { ...g, gameOver: null, cash: 3e9 };
  }
  // the injected building's own lease-up, for scale
  let injOcc = null;
  if (siteBbl) {
    const rec = E.resolveRec(parcels, g, siteBbl);
    if (rec) injOcc = E.occupancy(rec, g.econ);
  }
  return { path, deals, mine, injected, injOcc, downtime, cityStock };
}

// ---------------------------------------------------------------------------
const MARKS = [0, 6, 12, 24, 36, 60, 96, 120, 144];
console.log(`A GLUT, AND YOUR OWN RENT ROLL — ${KLASS}, ${SEEDS.length} paired seeds, `
  + `${PRE} months to stabilise then ${POST / 12} years watched\n`);

const summary = [];
for (const dose of DOSES) {
  const rows = [];
  for (const seed of SEEDS) {
    const t = run(seed, dose), c = run(seed, 0);
    if (!t || !c) continue;
    rows.push({ seed, t, c });
  }
  if (!rows.length) { console.log(`  ${pct(dose)} dose: no run`); continue; }

  const at = (r, side, m) => r[side].path.find((p) => p.m === m) ?? null;
  const inj = med(rows.map((r) => r.t.injected));
  console.log(`${"=".repeat(78)}`);
  console.log(`DOSE ${pct(dose)} of citywide ${KLASS} stock — ${(inj / 1e6).toFixed(2)}M sf delivered empty, in a rival's hands`);
  console.log(`  the player owns ${rows[0].t.mine.length} buildings carrying `
    + `${(med(rows.map((r) => at(r, "t", 0)?.sf ?? 0)) / 1e6).toFixed(2)}M sf of ${KLASS} — `
    + `${pct(med(rows.map((r) => (at(r, "t", 0)?.sf ?? 0) / Math.max(1, r.t.cityStock))))} of the city's ${KLASS} stock, `
    + `spread across the demand gradient\n`);

  console.log(`  THE MARKET  (median across pairs; TREATMENT vs its own CONTROL)`);
  console.log(`   month   city vac    vs ctrl   face vs ctrl   eff vs ctrl   eff/face   concession (t vs c)`);
  for (const m of MARKS) {
    if (m > POST) continue;
    const tv = rows.map((r) => at(r, "t", m)?.vac).filter((x) => x != null);
    const cv = rows.map((r) => at(r, "c", m)?.vac).filter((x) => x != null);
    if (!tv.length) continue;
    const dF = med(rows.map((r) => { const a = at(r, "t", m), b = at(r, "c", m); return a && b && b.face > 0 ? a.face / b.face - 1 : NaN; }).filter(Number.isFinite));
    const dE = med(rows.map((r) => { const a = at(r, "t", m), b = at(r, "c", m); return a && b && b.eff > 0 ? a.eff / b.eff - 1 : NaN; }).filter(Number.isFinite));
    const tc = med(rows.map((r) => at(r, "t", m)?.conc).filter((x) => x != null));
    const cc = med(rows.map((r) => at(r, "c", m)?.conc).filter((x) => x != null));
    const rat = Number.isFinite(dF) && Number.isFinite(dE) && dF < -0.002 ? dE / dF : NaN;
    console.log(`   ${String(m).padStart(4)}   ${pct(med(tv)).padStart(7)}   ${pp(med(tv) - med(cv)).padStart(9)}`
      + `   ${pct(dF).padStart(9)}   ${pct(dE).padStart(9)}   ${(Number.isFinite(rat) ? rat.toFixed(2) + "x" : "   —").padStart(6)}`
      + `   ${tc.toFixed(2)} vs ${cc.toFixed(2)}`);
  }

  // THE HEADLINE PAIR: how far each fell against its control, at the worst.
  const faceLo = rows.map((r) => Math.min(...r.t.path.filter((p) => p.m >= 0).map((p) => {
    const b = r.c.path.find((x) => x.m === p.m); return b && b.face > 0 ? p.face / b.face - 1 : 0; })));
  const effLo = rows.map((r) => Math.min(...r.t.path.filter((p) => p.m >= 0).map((p) => {
    const b = r.c.path.find((x) => x.m === p.m); return b && b.eff > 0 ? p.eff / b.eff - 1 : 0; })));
  console.log(`\n   worst FACE rent against control:      ${pct(med(faceLo))}   (per pair ${faceLo.map((x) => pct(x)).join("  ")})`);
  console.log(`   worst EFFECTIVE rent against control: ${pct(med(effLo))}   (per pair ${effLo.map((x) => pct(x)).join("  ")})`);
  // THE TWO SERIES TROUGH YEARS APART, so the ratio of one worst month to the
  // other worst month is not a measurement of anything — it silently compares
  // month 12 to month 120. The concession channel is a LEAD, not a level: it
  // opens first and burns off while the face rate is still falling. So the
  // ratio has to be taken at the SAME month, and the month that matters is the
  // one the market is worst in.
  const sameMonth = rows.map((r) => {
    // NOT the peak-vacancy month: vacancy peaks the month the building lands,
    // before any price has had time to move, so that column reads the impact
    // and not the damage. The month FACE rent is furthest below its control is
    // the moment the market has fully repriced, and it is the honest place to
    // ask how much of the fall the concession channel was carrying.
    let worst = 1, at = 0;
    for (const p of r.t.path) {
      if (p.m < 0) continue;
      const b = r.c.path.find((x) => x.m === p.m);
      if (b && b.face > 0 && p.face / b.face < worst) { worst = p.face / b.face; at = p.m; }
    }
    const out = [];
    for (const m of [6, 12, 24, at]) {
      const a = r.t.path.find((p) => p.m === m), b = r.c.path.find((p) => p.m === m);
      if (!a || !b || !(b.face > 0) || !(b.eff > 0)) { out.push(NaN); continue; }
      const dF = a.face / b.face - 1, dE = a.eff / b.eff - 1;
      out.push(dF < -0.002 ? dE / dF : NaN);
    }
    return { out, at };
  });
  const col = (i) => med(sameMonth.map((x) => x.out[i]).filter(Number.isFinite));
  // PER-PAIR DUMP for the F-R1 dispersion test.
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const parts = [];
    for (const m of [6, 12, 24, 36, 60, 96, 120]) {
      const a = r.t.path.find((p) => p.m === m), b = r.c.path.find((p) => p.m === m);
      if (!a || !b || !(b.face > 0) || !(b.eff > 0)) { parts.push("m" + m + "=  -  "); continue; }
      const dF = a.face / b.face - 1, dE = a.eff / b.eff - 1;
      const rr = dF < -0.002 ? dE / dF : NaN;
      parts.push("m" + m + "=" + (Number.isFinite(rr) ? rr.toFixed(2) : "  - ") + "[dF=" + (dF*100).toFixed(1) + ",cT=" + a.conc.toFixed(2) + ",cC=" + b.conc.toFixed(2) + "]");
    }
    console.log("   PAIR " + r.seed + "  " + parts.join(" "));
  }
  console.log(`   EFFECTIVE / FACE, taken at the SAME month:`);
  console.log(`      month 6  ${col(0).toFixed(2)}x      month 12  ${col(1).toFixed(2)}x      month 24  ${col(2).toFixed(2)}x`
    + `      at peak vacancy (median month ${med(sameMonth.map((x) => x.at))})  ${col(3).toFixed(2)}x`);
  console.log(`   real world: net effective falls 2-4x as far as face in the first year or two of a`);
  console.log(`   downturn, then face catches up — the concession is a lead, not a permanent level.`);

  // ------------------------------------------------------------------
  console.log(`\n  YOUR BUILDINGS  (median across pairs)`);
  console.log(`   month   occupancy   vs ctrl   new sf let/mo   vs ctrl    letters/mo   vs ctrl    rent roll psf`);
  const velo = (r, side, a, b) => {
    const seg = r[side].path.filter((p) => p.m > a && p.m <= b);
    if (seg.length < 2) return NaN;
    let gross = 0;
    for (const d of r[side].deals) if (d.m > a && d.m <= b && d.kind !== "renewal") gross += d.sf;
    return gross / seg.length;
  };
  const letters = (r, side, a, b) => {
    const seg = r[side].path.filter((p) => p.m > a && p.m <= b);
    return seg.length ? mean(seg.map((p) => p.loi)) : NaN;
  };
  let prev = -1;
  for (const m of MARKS) {
    if (m > POST) continue;
    const to = rows.map((r) => at(r, "t", m)?.occ).filter((x) => x != null);
    const co = rows.map((r) => at(r, "c", m)?.occ).filter((x) => x != null);
    if (!to.length) continue;
    const tvel = rows.map((r) => velo(r, "t", prev, m)).filter(Number.isFinite);
    const cvel = rows.map((r) => velo(r, "c", prev, m)).filter(Number.isFinite);
    const tl = rows.map((r) => letters(r, "t", prev, m)).filter(Number.isFinite);
    const cl = rows.map((r) => letters(r, "c", prev, m)).filter(Number.isFinite);
    const tr = med(rows.map((r) => at(r, "t", m)?.roll).filter((x) => x > 0));
    const cr = med(rows.map((r) => at(r, "c", m)?.roll).filter((x) => x > 0));
    console.log(`   ${String(m).padStart(4)}   ${pct(med(to)).padStart(7)}   ${pp(med(to) - med(co)).padStart(9)}`
      + `   ${med(tvel).toFixed(0).padStart(10)}   ${(med(tvel) - med(cvel)).toFixed(0).padStart(8)}`
      + `   ${med(tl).toFixed(2).padStart(9)}   ${(med(tl) - med(cl)).toFixed(2).padStart(8)}`
      + `   $${tr.toFixed(2)} vs $${cr.toFixed(2)}`);
    prev = m;
  }

  // NET ABSORPTION on the player's book, and what the deals cost him.
  const netAbs = (r, side, a, b) => {
    const A = r[side].path.find((p) => p.m === a), B = r[side].path.find((p) => p.m === b);
    return A && B ? B.occSf - A.occSf : NaN;
  };
  const dealsIn = (r, side, a, b, kind) => r[side].deals.filter((d) => d.m > a && d.m <= b && (kind ? d.kind === kind : true));
  const W = (ds, f) => { let s = 0, w = 0; for (const d of ds) { s += d.sf * f(d); w += d.sf; } return w > 0 ? s / w : NaN; };
  // NEW AND RENEWAL SEPARATELY, because they are different deals. A renewal
  // carries no moving cost for the tenant and no downtime for the landlord, so
  // it strikes at a smaller concession in life too — but "smaller" is not
  // "none", and pooling the two hides which one the model is getting wrong.
  if (KLASS === "multifamily") {
    console.log(`\n  WHAT THE DEALS COST YOU — flats have no letters. Residential space runs on`);
    console.log(`  aggregate occupancy (leasing.ts: h.occ walked toward the market at a pace that`);
    console.log(`  halves in a soft market), so there is no LOI, no TI and no free-rent line to`);
    console.log(`  read. For this class the occupancy path above IS the leasing velocity.`);
  }
  console.log(`\n  WHAT THE DEALS COST YOU  (letters signed in the first five years after the drop)`);
  console.log(`                    face      free      TI/sf    term      NER    NER/face   deals`);
  for (const [lbl, side] of [["glut   ", "t"], ["control", "c"]]) {
    for (const [klbl, kf] of [["new    ", (d) => d.kind !== "renewal"], ["renewal", (d) => d.kind === "renewal"]]) {
      const ds = rows.flatMap((r) => dealsIn(r, side, 0, 60)).filter(kf);
      if (!ds.length) { console.log(`   ${lbl} ${klbl}   — no deals`); continue; }
      const f = W(ds, (d) => d.rentPsf), n = W(ds, (d) => ner(d.rentPsf, d.termM, d.freeM, d.tiPsf));
      const fm = W(ds, (d) => d.freeM), tm = W(ds, (d) => d.termM);
      console.log(`   ${lbl} ${klbl}  $${f.toFixed(2).padStart(6)}   ${fm.toFixed(1).padStart(4)} mo`
        + `   $${W(ds, (d) => d.tiPsf).toFixed(1).padStart(5)}   ${(tm / 12).toFixed(1)}y`
        + `   $${n.toFixed(2).padStart(6)}   ${pct(f > 0 ? 1 - n / f : NaN).padStart(7)}   ${ds.length}`
        + `   [free = ${pct(fm / Math.max(1, tm))} of term, TI = ${(W(ds, (d) => d.tiPsf) / Math.max(0.01, f)).toFixed(2)}x annual rent]`);
    }
  }
  console.log(`   real world, office: free rent 3-6 months on a 10-year lease in a balanced`);
  console.log(`   market and 12-18 in a bad one (10-15% of term); TI 1.0-1.6x annual face on a`);
  console.log(`   new lease and roughly half that on a renewal; NER 25-40% under face at the worst.`);
  // HOW LONG A VACANT FOOT SAT before it was let again — sf-weighted, on the
  // player's own buildings, for space that came free after the drop.
  console.log(`\n  DOWNTIME — months a vacant foot waited before it was let again (sf-weighted)`);
  for (const [lbl, side] of [["glut     ", "t"], ["control  ", "c"]]) {
    const ds = rows.flatMap((r) => r[side].downtime.filter((d) => d.m >= 0));
    const wsf = ds.reduce((a, d) => a + d.sf, 0);
    const wm = wsf > 0 ? ds.reduce((a, d) => a + d.sf * d.months, 0) / wsf : NaN;
    const long = ds.filter((d) => d.months >= 24).reduce((a, d) => a + d.sf, 0);
    console.log(`   ${lbl} ${Number.isFinite(wm) ? wm.toFixed(1) : " — "} months   `
      + `${(wsf / 1000).toFixed(0)}k sf re-let   ${pct(wsf > 0 ? long / wsf : NaN)} of it took two years or more`);
  }
  const stillOut = rows.flatMap((r) => {
    const last = r.t.path[r.t.path.length - 1];
    return last ? [last.vacantSf] : []; });
  const stillOutC = rows.flatMap((r) => {
    const last = r.c.path[r.c.path.length - 1];
    return last ? [last.vacantSf] : []; });
  console.log(`   still empty at the end: glut ${(med(stillOut) / 1000).toFixed(0)}k sf   control ${(med(stillOutC) / 1000).toFixed(0)}k sf`);
  // SURVIVOR BIAS, NAMED. A foot only enters the average once it is LET, so a
  // building whose space never lets contributes nothing and the mean reads
  // shorter than the truth. Reporting the unlet stock beside it is what makes
  // the number readable rather than reassuring.
  console.log(`   ^ that stock never entered the average above, which only counts space that DID re-let`);
  console.log(`   (real world: a Class-B suite lets in 6-9 months in a balanced market and`);
  console.log(`    18-30 in a glut; Dallas needed fifteen years to re-let its 1980s tower wave)`);

  // THE CONCESSION DIAL — the market's own giveaway, and whether it is a dial
  // or a rail. effRentIdx = rentIdx x (1 - 0.14 x concIdx), so concIdx at 1.00
  // means the model has given away everything it is able to give away, and
  // every further point of distress has to come out of the HEADLINE rent.
  const bind = rows.map((r) => {
    const post = r.t.path.filter((p) => p.m >= 0);
    return post.filter((p) => (p.conc ?? 0) >= 0.99).length / Math.max(1, post.length); });
  console.log(`\n  THE CONCESSION DIAL`);
  console.log(`   months resting on its 1.00 ceiling, after the drop: ${pct(med(bind))}   (per pair ${bind.map(pct).join("  ")})`);
  console.log(`   maximum giveaway the index can express: 14% of face (market.ts effRentIdx)`);
  console.log(`   real world: net effective rent runs 25-40% under face in a bad office glut`);

  console.log(`\n  DEAL FLOW OVER THE FIRST FIVE YEARS  (median per pair)`);
  for (const [lbl, side] of [["glut   ", "t"], ["control", "c"]]) {
    const sf = rows.map((r) => dealsIn(r, side, 0, 60).filter((d) => d.kind !== "renewal").reduce((a, d) => a + d.sf, 0));
    const n = rows.map((r) => dealsIn(r, side, 0, 60).filter((d) => d.kind !== "renewal").length);
    const rn = rows.map((r) => dealsIn(r, side, 0, 60).filter((d) => d.kind === "renewal").length);
    console.log(`   ${lbl}  ${(med(sf) / 1000).toFixed(0).padStart(4)}k sf of NEW leasing   ${med(n).toFixed(0).padStart(3)} new deals`
      + `   ${med(rn).toFixed(0).padStart(3)} renewals   renewal share ${pct(med(rn) / Math.max(1, med(n) + med(rn)))}`);
  }
  console.log(`   real world: gross leasing volume FALLS in a glut even as rents fall, and the`);
  console.log(`   renewal share RISES — tenants who would have moved stay put and renegotiate.`);

  const nA = rows.map((r) => netAbs(r, "t", 0, 60)), nC = rows.map((r) => netAbs(r, "c", 0, 60));
  console.log(`\n   NET ABSORPTION on your book, first five years:  glut ${(med(nA) / 1000).toFixed(0)}k sf`
    + `   control ${(med(nC) / 1000).toFixed(0)}k sf   difference ${((med(nA) - med(nC)) / 1000).toFixed(0)}k sf`);
  console.log(`   (real world: standing stock LOSES tenants in a glut — net absorption goes negative,`);
  console.log(`    it does not merely stop growing)`);
  const injLet = rows.map((r) => r.t.injOcc).filter((x) => x != null);
  if (injLet.length) console.log(`\n   the rival's new building, ${POST / 12} years on: ${pct(med(injLet))} let`);

  // DURATION, WHICH IS THE OTHER HALF OF THE ANSWER. market.ts caps the RATE
  // at which a glut cuts asking rent, and argues the cap from the record:
  // Manhattan 1990-92 fell ~14%/yr at ~9pp of excess and Houston 1983-87 fell
  // ~16%/yr at 15-20pp — "twice the glut, a tenth more decline. A market that
  // deep is not falling faster, it is falling for LONGER." That is a testable
  // promise: if the rate is capped, the duration has to carry the difference,
  // or the model cannot tell a bad glut from a catastrophic one.
  const nat = NATURAL[KLASS];
  const over5 = rows.map((r) => r.t.path.filter((p) => p.m >= 0 && p.vac - nat > 0.05).length);
  const over10 = rows.map((r) => r.t.path.filter((p) => p.m >= 0 && p.vac - nat > 0.10).length);
  const backIn = rows.map((r) => {
    for (const p of r.t.path) {
      if (p.m < 12) continue;
      const b = r.c.path.find((x) => x.m === p.m);
      if (b && p.vac - b.vac < 0.02) return p.m;
    }
    return POST;
  });
  console.log(`\n  HOW LONG IT LASTS`);
  console.log(`   months above +5pp of natural: ${med(over5).toFixed(0)}   above +10pp: ${med(over10).toFixed(0)}`
    + `   months until vacancy is back within 2pp of control: ${med(backIn).toFixed(0)}${med(backIn) >= POST ? " (still out at the end)" : ""}`);

  summary.push({ dose, faceLo: med(faceLo), effLo: med(effLo), r6: col(0), r12: col(1), r24: col(2),
    over5: med(over5), backIn: med(backIn),
    vacPeak: med(rows.map((r) => Math.max(...r.t.path.filter((p) => p.m >= 0).map((p) => p.vac)))),
    occDrop: med(rows.map((r) => {
      let worst = 0;
      for (const p of r.t.path) { if (p.m < 0) continue; const b = r.c.path.find((x) => x.m === p.m); if (b) worst = Math.min(worst, p.occ - b.occ); }
      return worst; })),
    absGap: (med(nA) - med(nC)) });
  console.log("");
}

console.log("=".repeat(78));
console.log(`DOSE RESPONSE — ${KLASS}\n`);
console.log(`  dose   peak vac   worst face   worst eff   eff/face m6 / m12 / m24   mo >5pp   mo to clear   your occ`);
for (const s of summary) {
  const r = (x) => (Number.isFinite(x) ? x.toFixed(2) + "x" : "  — ").padStart(6);
  console.log(`  ${pct(s.dose).padStart(5)}  ${pct(s.vacPeak).padStart(8)}   ${pct(s.faceLo).padStart(10)}`
    + `   ${pct(s.effLo).padStart(9)}   ${r(s.r6)} ${r(s.r12)} ${r(s.r24)}`
    + `   ${s.over5.toFixed(0).padStart(7)}   ${s.backIn.toFixed(0).padStart(11)}   ${pp(s.occDrop).padStart(8)}`);
}
console.log(`\n  The rate at which asking rent falls is deliberately capped in market.ts and the cap`);
console.log(`  is argued from Manhattan 1990-92 and Houston 1983-87. That makes DURATION the`);
console.log(`  variable that has to carry a deeper glut, which is what the two middle columns`);
console.log(`  are for: if they do not scale with the dose, the rate cap is hiding the shock.`);
console.log(`\nA REPORT, NOT A GATE. Every number is a treatment against its own paired`);
console.log(`control on the same seed, so the century re-roll is inside both sides.`);
