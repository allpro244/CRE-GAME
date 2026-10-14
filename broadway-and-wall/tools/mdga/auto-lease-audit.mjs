// MDGA instrument — WHAT IS THE TEAM ACTUALLY SIGNING ON AUTO-LEASE?
//
// A gifted commercial book, every building on auto-lease, YEARS years. Each
// month the letters are captured BEFORE the desk answers them (auto is held
// off through the tick, then autoLeaseDesk runs over the month's letters —
// the same call the tick makes, one step later), so every signing is scored
// on the space as the tenant toured it, not after their fit-out used up the
// shell. Two scores:
//
//   engine  loiMandateScore over the letter's market — what the desk decides on
//   owner   the landlord's levelised net effective: rent after free months
//           and bumps, minus the WHOLE allowance, discounted at OWNER_RATE,
//           as a level $/sf/yr over the term, over the same at market with
//           no concessions — what a lender would underwrite the lease at
//
// plus the yardstick the desk measures against (marketDealShare, "the street's
// deal") and how many years of the lease's own rent its fit-out cheque is.
//
//   pnpm engine && node tools/mdga/auto-lease-audit.mjs
//   SHELL=0 SF=1500000 YEARS=4 ARMS=market,fill node tools/mdga/auto-lease-audit.mjs
//   ARMS=market+lean,market+any   (posture + team concession limit)
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(process.env.ENGINE ?? join(HERE, "..", "..", "test", ".engine.mjs"));   // ENGINE=path: an older bundle, for before/after
const { loadCity } = await import(join(HERE, "..", "..", "test", "city.mjs"));
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);
const SEED = Number(process.env.SEED ?? 550991);
const YEARS = Number(process.env.YEARS ?? 4);
const TARGET_SF = Number(process.env.SF ?? 3_000_000);
const ARMS = (process.env.ARMS ?? "market,fill,push").split(",");
const SHELL = !!Number(process.env.SHELL ?? 1);   // SHELL=1: a new-delivery book, every foot first-generation
const WORST = Number(process.env.WORST ?? 4);
const OWNER_RATE = 0.07;   // levelising rate for the owner's view; a stabilised office yield

const pct = (x) => Number.isFinite(x) ? `${(x * 100).toFixed(0)}%` : "—";
const q = (xs, p) => { const a = xs.filter(Number.isFinite).sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : NaN; };

/** Level $/sf/yr the landlord nets over the term, at OWNER_RATE monthly. */
function ownerNe(rent, bumpPct, termM, freeM, tiPsf) {
  const r = OWNER_RATE / 12;
  let pv = -tiPsf, ann = 0;
  for (let m = 0; m < termM; m++) {
    const d = 1 / Math.pow(1 + r, m + 1);
    if (m >= freeM) pv += (rent * Math.pow(1 + bumpPct / 100, Math.floor(m / 12)) / 12) * d;
    ann += d / 12;
  }
  return pv / ann;
}

const takeBook = (g0) => {
  const g = structuredClone(g0);
  g.cash = Math.max(g.cash, 80e6);
  let sf = 0;
  const cands = bbls.map((b) => E.resolveRec(parcels, g, b))
    .filter((rec) => rec && rec.bldgArea > 0 && E.isCommercial(rec) && !g.holdings[rec.bbl] && !E.isCivicLand(g, rec.bbl))
    .sort((a, b) => SHELL ? b.bldgArea - a.bldgArea : a.bbl.localeCompare(b.bbl));
  for (const rec of cands) {
    const worth = E.assetValue(rec, g.econ, E.initialCondition(rec));
    const grade = E.gradeOf(g, rec);
    const h = {
      bbl: rec.bbl, boughtM: g.month, costBasis: worth, assessed: worth, loan: null,
      condition: grade, condIdx: E.initialCondIdx(rec, g.month, grade),
      service: 0, stance: 0, plan: 1, svcIdx: 0.55, tenants: [], cfHistory: [],
    };
    E.genRentRoll(g, rec, h, false, true);
    if (Object.keys(g.holdings).length % 2 === 0 || SHELL) h.tenants = [];
    if (SHELL) {
      h.deliveredM = g.month;
      h.shellSf = {};
      for (const u of E.leasableUses(rec)) if (u !== "multifamily") h.shellSf[u] = Math.round(E.useSf(rec, u));
    }
    g.holdings[rec.bbl] = h;
    E.clearRivalClaims(g, rec.bbl);
    g.listings = (g.listings ?? []).filter((l) => l.bbl !== rec.bbl);
    if (g.approaches) delete g.approaches[rec.bbl];
    sf += rec.bldgArea;
    if (sf >= TARGET_SF) break;
  }
  return g;
};

let w = E.firstListings(E.newGame(SEED, parcels), parcels, bbls);
for (let m = 0; m < 12; m++) { w = E.advanceMonth(w, parcels, bbls, adjacency); if (w.gameOver) w = { ...w, gameOver: null, cash: 5e6 }; }
const book = takeBook(w);
console.log(`\nAUTO-LEASE AUDIT — seed ${SEED}, ${Object.keys(book.holdings).length} buildings${SHELL ? " (new shells)" : ""}, ${YEARS} years\n`);

function runArm(arm) {
  let g = structuredClone(book);
  const setup = arm.split("+");
  for (const h of Object.values(g.holdings)) {
    h.stance = setup[0] === "fill" ? -1 : setup[0] === "push" ? 1 : 0;
    h.autoLease = false;
  }
  if (setup[1] && setup[1] !== "floor") g.autoConcessions = setup[1];
  if (setup.includes("floor")) g.autoRentFloor = true;   // ARMS=market+lean+floor: never below market rent
  const deals = [];
  const letters = [];
  let vacSfM = 0, totSfM = 0;
  for (let m = 0; m < YEARS * 12; m++) {
    if (g.gameOver) g = { ...g, gameOver: null };
    g.cash = Math.max(g.cash, 20e6);
    g = E.advanceMonth(g, parcels, bbls, adjacency);
    // the month's letters, as the desk is about to see them
    const pre = new Map();
    for (const l of g.lois) {
      const h = g.holdings[l.bbl];
      const rec = E.resolveRec(parcels, g, l.bbl);
      if (!h || !rec || l.use === "multifamily") continue;
      const market = E.loiMarket(g, rec, h, l);
      const street = E.marketDealShare(g, rec, h, l);
      pre.set(l.id, { l: structuredClone(l), addr: rec.address, market, street, engine: E.loiMandateScore(l, market) });
    }
    for (const h of Object.values(g.holdings)) h.autoLease = true;
    const before = new Set(g.news.filter((n) => n.q === g.month).map((n) => n.text));
    E.autoLeaseDesk(g, parcels);
    for (const h of Object.values(g.holdings)) h.autoLease = false;
    // whoever was referred: the owner of 200 buildings accepts what the team sends up
    for (const l of [...g.lois]) if (l.referred) { const r = E.respondLOI(g, parcels, l.id, "accept"); if (r && !r.err && r.s) g = r.s; }
    const fresh = g.news.filter((n) => n.q === g.month && !before.has(n.text) && n.text.startsWith("Auto-lease"));
    for (const [, p] of pre) {
      // tenant names repeat across the city: the address pins the letter
      const out = fresh.find((n) => n.text.includes(` ${p.l.name} at ${p.addr}`));
      const verdict = !out ? "open" : /signed/.test(out.text) ? "signed" : /walked/.test(out.text) ? "walked" : /referred/.test(out.text) ? "referred" : "passed";
      letters.push({ ...p, verdict, why: verdict === "passed" ? out.text.replace(/^.*? — /, "") : "" });
      if (verdict !== "signed") continue;
      const mm = out.text.match(/sf at \$([\d.]+)\/sf(?:, \$(\d+)\/sf fit-out)?/);
      const rent = Number(mm[1]), ti = Number(mm[2] ?? 0), l = p.l;
      const own = ownerNe(rent, E.bumpOf(l), l.termM, l.freeM ?? 0, ti) / ownerNe(p.market, 2.5, l.termM, 0, 0);
      deals.push({ ...p, rent, ti, own, sf: l.sf, use: l.use, termM: l.termM, freeM: l.freeM ?? 0, tiYrsRent: ti / Math.max(0.01, rent) });
    }
    for (const [b, h] of Object.entries(g.holdings)) {
      const rec = E.resolveRec(parcels, g, b);
      for (const u of E.leasableUses(rec)) {
        if (u === "multifamily") continue;
        const tot = E.useSf(rec, u);
        vacSfM += Math.min(tot, E.useVacantSf(rec, h, u, g.month)); totSfM += tot;
      }
    }
  }
  const n = (v) => letters.filter((x) => x.verdict === v).length;
  const sfW = (k) => deals.reduce((a, d) => a + d[k] * d.sf, 0) / Math.max(1, deals.reduce((a, d) => a + d.sf, 0));
  console.log(`${arm.padEnd(16)} ${letters.length} letters → ${n("signed")} signed · ${n("passed")} passed · ${n("walked")} walked · ${n("referred")} referred · mean vacancy ${pct(vacSfM / totSfM)}`);
  console.log(`   signed: owner NE ${pct(sfW("own"))} of market (sf-wtd) · ${pct(deals.filter((d) => d.own < 0.8).length / Math.max(1, deals.length))} under 80% · ${pct(deals.filter((d) => d.own < 0.6).length / Math.max(1, deals.length))} under 60%`);
  console.log(`   fit-out cheque in years of the lease's own rent: median ${q(deals.map((d) => d.tiYrsRent), 0.5).toFixed(2)} · p90 ${q(deals.map((d) => d.tiYrsRent), 0.9).toFixed(2)} · free months median ${q(deals.map((d) => d.freeM), 0.5)} p90 ${q(deals.map((d) => d.freeM), 0.9)}`);
  console.log(`   yardstick (street deal nets, share of face): median ${pct(q(letters.map((x) => x.street), 0.5))} · p10 ${pct(q(letters.map((x) => x.street), 0.1))} · on the 25% rail ${pct(letters.filter((x) => x.street <= 0.2501).length / Math.max(1, letters.length))}`);
  console.log(`   engine score overstates the owner's NE by median ${pct(q(deals.map((d) => d.engine - d.own), 0.5))} · p90 ${pct(q(deals.map((d) => d.engine - d.own), 0.9))} (letters as written)`);
  for (const d of [...deals].sort((a, b) => a.own - b.own).slice(0, WORST)) {
    console.log(`     worst: ${d.use} ${Math.round(d.sf)} sf ${(d.termM / 12).toFixed(1)}y at $${d.rent.toFixed(2)} vs $${d.market.toFixed(2)} market, $${d.ti}/sf TI (${d.tiYrsRent.toFixed(1)}y of rent), ${d.freeM}mo free — street deal nets ${pct(d.street)} → owner ${pct(d.own)}`);
  }
  const whys = new Map();
  for (const x of letters) if (x.why) { const k = x.why.replace(/[\d$.,%]+/g, "#").slice(0, 60); whys.set(k, (whys.get(k) ?? 0) + 1); }
  for (const [k, v] of [...whys].sort((a, b) => b[1] - a[1]).slice(0, 3)) console.log(`     passed ×${v}: ${k}`);
  console.log("");
}

for (const a of ARMS) runArm(a);
