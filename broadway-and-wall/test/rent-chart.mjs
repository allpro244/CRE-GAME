// DOES THE ECONOMY PAGE'S RENT CHART DESCRIBE THIS MARKET, OR A DIFFERENT ONE?
//
//   pnpm engine && node test/rent-chart.mjs
//   SEEDS=550991,11 MONTHS=180 node test/rent-chart.mjs
//
// The chart draws two lines and its caption makes two claims about them:
// "asking is the face rate landlords quote; effective is what deals actually
// strike after free rent and work". Both were false, and neither was measured
// by anything until this file. Found 2026-08 over four playthroughs:
//
//   the quote      every desk in the game quoted `effRentIdx` (the parcel
//                  card, the letting panel, the arriving letter), so the
//                  ASKING line was a rate nobody was ever quoted — buildings
//                  ran 11-13% under it through a glut.
//   the strike     effective was `asking x (1 - 0.14 x concIdx)`, a constant
//                  nobody had measured, while the leasing desk wrote its own
//                  free-rent and fit-out package ON TOP of an already
//                  discounted quote. Deals struck 18-27% under the EFFECTIVE
//                  line, which is the line that claims to be where they strike.
//
// Both are levels, not shapes: the chart's direction was right the whole time,
// which is exactly why nothing caught this. So this measures LEVELS, in the
// two regimes where they differ — a normal market where the concession dial is
// near zero and the two lines nearly touch, and a glut where the dial pins at
// 1 and the gap is the whole story.
//
// WHAT IT ASSERTS, per seed and per regime, as medians over deal-months:
//   A  what a building QUOTES  ~=  the asking line       (0.85 .. 1.06)
//   B  what a deal NETS        ~=  the effective line    (0.85 .. 1.15)
//
// Band A opens downward because a quote is allowed to sit under the index:
// `staleDiscount` marks down space that has been dark for years, and in a glut
// most of the book is. Band B is symmetric because it is an average of signed
// paper against the index that claims to be that average — bid dispersion cuts
// both ways (growth tenants bid over the quote, stale space signs under it).
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
const SEEDS = (process.env.SEEDS ?? "550991,12007,11").split(",").map(Number);
const MONTHS = Number(process.env.MONTHS ?? 156);
const SHOCK = Number(process.env.SHOCK ?? 60);        // month the glut lands
const DOSE = Number(process.env.DOSE ?? 0.35);        // share of stock delivered at once
const OWN = Number(process.env.OWN ?? 12);

const ASK_BAND = [0.85, 1.06];
const NER_BAND = [0.85, 1.15];

let fails = 0;
const fail = (m) => { fails++; console.log(`FAIL  ${m}`); };
const pass = (m) => console.log(`PASS  ${m}`);
const med = (xs) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[Math.floor((a.length - 1) / 2)] : NaN; };
// Straight-line net effective: face less the free months, less the TI over the term.
const ner = (r, termM, freeM, tiPsf) =>
  r * (1 - Math.min(0.95, (freeM ?? 0) / Math.max(1, termM))) - (tiPsf ?? 0) / Math.max(1 / 12, termM / 12);
const classSf = (rec) => (E.mixOf(rec)[KLASS] ?? 0) * (rec.bldgArea ?? 0);

// ---------------------------------------------------------------------------
// One playthrough. An unskilled landlord — he answers every letter at asking
// and never counters, so what is measured is the market and not a bot.
// ---------------------------------------------------------------------------
function run(seed) {
  const parcels = clone();
  let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  g = { ...g, cash: 3_000_000_000 };
  const stock = bbls.map((b) => parcels[b])
    .filter((r) => r && r.class && r.class !== "land" && r.bldgArea > 0 && classSf(r) >= 12000)
    .sort((a, b) => a.demandScore - b.demandScore);
  const mine = [];
  for (let i = 0; i < Math.min(OWN, stock.length); i++) {
    const rec = stock[Math.floor((i + 0.5) / OWN * stock.length)];
    if (!rec || mine.includes(rec.bbl)) continue;
    const r = E.executePurchase(g, parcels, rec.bbl, 5_000_000, "cash", false, 1);
    if (r.err) continue;
    g = r.s; g.holdings[rec.bbl].broker = true; mine.push(rec.bbl);
  }
  if (mine.length < 3) return null;

  const rows = [];
  for (let m = 0; m < MONTHS; m++) {
    if (m === SHOCK && DOSE > 0) {
      // A competitor finishes a building equal to `dose` of citywide stock, on
      // a good lot, empty. The fastest way to pin the concession dial.
      const site = bbls.map((b) => E.resolveRec(parcels, g, b))
        .filter((r) => r && r.class === "land" && r.lotArea > 6000 && !g.holdings[r.bbl])
        .sort((a, b) => b.demandScore - a.demandScore)[2];
      if (site) {
        const inj = Math.round(g.econ.stock[KLASS] * DOSE);
        g = { ...g, built: { ...g.built, [site.bbl]: {
          class: KLASS, mix: { [KLASS]: 1 }, bldgArea: inj,
          floors: Math.max(2, Math.round(inj / Math.max(1, site.lotArea) / 0.7)),
          yearBuilt: 1900 + Math.floor(g.month / 12) } } };
        E.addStock(g.econ, KLASS, inj);
      }
    }
    g = E.advanceQuarter(g, parcels, bbls, adjacency);
    const e = g.econ;
    const asks = [], ners = [];
    for (const bbl of mine) {
      const rec = E.resolveRec(parcels, g, bbl), h = g.holdings[bbl];
      if (!rec || !h) continue;
      // Take the building's own multipliers out — plate, location, condition,
      // spec — so a quote and a signed deal can be read against a CITY index.
      const mult = E.useRentPsfYr(rec, e, h.condition, KLASS)
        / Math.max(1e-9, e.effRentIdx?.[KLASS] ?? e.rentIdx[KLASS]);
      if (!(mult > 0)) continue;
      const q = E.currentAskPsfYr(rec, e, h, KLASS);
      if (q > 0) asks.push(q / mult);
      for (const l of g.lois) {
        if (l.bbl !== bbl || (l.use ?? rec.class) !== KLASS) continue;
        ners.push(ner(l.rentPsf, l.termM, l.freeM, l.tiPsf) / mult);
      }
    }
    for (const l of [...g.lois]) {
      const r = E.respondLOI(g, parcels, l.id, "accept", true);
      if (!r.err) g = r.s;
    }
    const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    rows.push({
      m, ask: e.rentIdx[KLASS], eff: e.effRentIdx?.[KLASS] ?? e.rentIdx[KLASS],
      conc: e.concIdx?.[KLASS] ?? 0, vac: e.cityVac?.[KLASS] ?? 0,
      quoted: asks.length ? mean(asks) : null,
      ner: ners.length ? mean(ners) : null, nDeals: ners.length,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
for (const seed of SEEDS) {
  const rows = run(seed);
  if (!rows) { fail(`seed ${seed}: could not assemble a book`); continue; }
  const regimes = [
    ["normal", rows.filter((r) => r.m >= 12 && r.m < SHOCK)],
    ["glut  ", rows.filter((r) => r.m >= SHOCK + 6)],
  ];
  for (const [label, sub] of regimes) {
    const q = sub.filter((r) => r.quoted != null).map((r) => r.quoted / r.ask);
    const n = sub.filter((r) => r.ner != null).map((r) => r.ner / r.eff);
    const deals = sub.reduce((a, r) => a + r.nDeals, 0);
    const conc = med(sub.map((r) => r.conc)), vac = med(sub.map((r) => r.vac));
    const head = `seed ${seed} ${label}  dial ${conc.toFixed(2)}  vac ${(vac * 100).toFixed(1)}%  ${deals} letters`;
    if (deals < 15 || q.length < 12) { console.log(`SKIP  ${head} — too few deals to measure`); continue; }
    const mq = med(q), mn = med(n);
    const inA = mq >= ASK_BAND[0] && mq <= ASK_BAND[1];
    const inB = mn >= NER_BAND[0] && mn <= NER_BAND[1];
    (inA ? pass : fail)(`${head} — A quote/asking ${mq.toFixed(3)} (band ${ASK_BAND.join("..")})`);
    (inB ? pass : fail)(`${head} — B net effective/effective ${mn.toFixed(3)} (band ${NER_BAND.join("..")})`);
  }
}

console.log(fails ? `\n${fails} failure(s)` : "\nrent chart matches the market");
process.exit(fails ? 1 : 0);
