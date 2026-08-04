// THE SIMULATION ACCEPTANCE SUITE — the macro half of the economy.
//
// econ-accept.mjs asserts that the SPACE market is real: location matters,
// supply is felt, tenants are conserved. This file asserts the thing under
// it — that the economy those tenants live in is a closed system rather than
// a set of scripted drifts, and that RENT IS A BY-PRODUCT OF IT.
//
// The owner's words: "rent should be a by product of the economy, and the
// economy should be very complex and pulls on each other and intertwines and
// not have anything be fakely made up."
//
// Every test here is a loop that must close:
//   F. INCOME ANCHOR   rents are paid out of incomes, so they cannot durably
//                      outrun them. Real rent growth lands near productivity,
//                      not at 3.3x it. This is the $1,000/sf test.
//   G. POLICY RESPONDS the interest rate is not a script. It rises with
//                      inflation and falls when the city is in trouble.
//   H. THE GLUT IS SEEN a city drowning in empty space cannot be described as
//                      an expansion, and every extra point of vacancy has to
//                      cost something — no saturating term where more empty
//                      space is free.
//   I. BUILDING COSTS BITE a construction boom bids up the trades, which is
//                      what makes a real supply cycle self-limiting.
//
// Run: node test/sim-accept.mjs (bundle first, like every other harness).
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

const { parcels: P0, adjacency, bbls } = loadCity(0, E.normalizeParcels);
const clone = () => JSON.parse(JSON.stringify(P0));
const results = [];
const report = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`\n${pass ? "PASS" : "FAIL"}  ${name}`);
  for (const d of detail) console.log("      " + d);
};
// SEVEN SEEDS, NOT THREE. Both of these metrics have a genuinely wide
// dispersion across a fifty-year run — rent-to-income came back 0.79x, 0.88x
// and 1.89x from the SAME build — so a three-seed median is a coin flip
// dressed up as a measurement, and it will report a regression that is not one
// and hide a regression that is. Seven is the smallest number where the median
// stopped moving when the unrelated parts of the RNG stream shifted.
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) / 2)];
const CAGR = (a, b, yrs) => (Math.pow(b / a, 1 / yrs) - 1) * 100;
const corr = (xs, ys) => {
  const n = Math.min(xs.length, ys.length);
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx, b = ys[i] - my;
    sxy += a * b; sxx += a * a; syy += b * b;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
};

/** A plain 50-year run of the city with nobody playing. */
function macroRun(seed, months = 600) {
  const parcels = clone();
  let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  const t = [];
  for (let m = 0; m < months; m++) {
    g = E.advanceQuarter(g, parcels, bbls, adjacency);
    const e = g.econ;
    t.push({
      m: g.month,
      rent: e.rentIdx.office, eff: e.effRentIdx?.office ?? e.rentIdx.office,
      cpi: e.cpi ?? 1, wage: e.wageIdx ?? 1, cost: e.costIdx,
      rate: e.indexRate, unemp: e.unemployment ?? 0.05,
      vac: e.cityVac.office, phase: e.phase, jobs: e.jobs ?? 0,
    });
  }
  return t;
}

// ---------------------------------------------------------------------------
// F. THE INCOME ANCHOR — the $1,000/sf test
// ---------------------------------------------------------------------------
// Rent is a payment out of somebody's income. Over fifty years a market's real
// rent per square foot may drift with productivity and with genuine scarcity,
// but it cannot triple in real terms while the wages of the city that pays it
// go nowhere — that is not a property market, it is a spreadsheet compounding.
// Real-world anchor: long-run real commercial rent growth is ~0%/yr, and the
// rent-to-income ratio is roughly trendless. We allow a dense, chronically
// tight city to earn a premium, which is why the band has room on the upside.
{
  const runs = [550991, 12007, 73303, 11, 22, 33, 4242].map((seed) => {
    const t = macroRun(seed);
    const a = t[0], b = t[t.length - 1];
    const yrs = (b.m - a.m) / 12;
    const nom = CAGR(a.rent, b.rent, yrs);
    const infl = CAGR(a.cpi, b.cpi, yrs);
    const wageReal = CAGR(a.wage / a.cpi, b.wage / b.cpi, yrs);
    // the ratio that has to hold: real rent per sf against real income
    const r0 = (a.rent / a.cpi) / (a.wage / a.cpi);
    const r1 = (b.rent / b.cpi) / (b.wage / b.cpi);
    return { seed, nom, infl, real: nom - infl, wageReal, ratio: r1 / r0, endRent: b.rent, endCpi: b.cpi };
  });
  const realRent = med(runs.map((r) => r.real));
  const ratio = med(runs.map((r) => r.ratio));
  const realWage = med(runs.map((r) => r.wageReal));
  const infl = med(runs.map((r) => r.infl));
  report("F. INCOME ANCHOR — can rents outrun the wages that pay them?",
    realRent >= -1.0 && realRent <= 1.5 && ratio <= 1.8 && realWage >= 0.0 && realWage <= 2.5
      && infl >= 0.8 && infl <= 4.5,
    [`per seed real rent growth: ${runs.map((r) => r.real.toFixed(2) + "%").join("  ")}   median ${realRent.toFixed(2)}%/yr   (need -1.0 to +1.5)`,
     `per seed rent-to-income over 50y: ${runs.map((r) => r.ratio.toFixed(2) + "x").join("  ")}   median ${ratio.toFixed(2)}x   (need <= 1.8x)`,
     `real WAGE growth: ${runs.map((r) => r.wageReal.toFixed(2) + "%").join("  ")}   median ${realWage.toFixed(2)}%/yr   (need 0 to 2.5 — a city whose workers get poorer for 50 years is broken)`,
     `inflation: ${runs.map((r) => r.infl.toFixed(2) + "%").join("  ")}   median ${infl.toFixed(2)}%/yr   (need 0.8 to 4.5)`,
     `office asking at year 50: ${runs.map((r) => "$" + r.endRent.toFixed(0)).join("  ")} nominal (CPI ${runs.map((r) => r.endCpi.toFixed(1) + "x").join(" ")})`]);
}

// ---------------------------------------------------------------------------
// G. POLICY RESPONDS — the rate is not a script
// ---------------------------------------------------------------------------
// A central bank raises into inflation and cuts into unemployment. If the loan
// index correlates with neither, then "the rate era" is weather and the
// player's fix-or-float decision is a coin flip rather than a read on the
// economy.
{
  const runs = [550991, 12007, 73303, 11, 22, 33, 4242].map((seed) => {
    const t = macroRun(seed);
    // year-on-year inflation and the rate, sampled annually after a burn-in
    const infl = [], rate = [], unemp = [];
    for (let i = 120; i + 12 < t.length; i += 6) {
      infl.push((t[i].cpi / t[i - 12].cpi - 1) * 100);
      rate.push(t[i].rate);
      unemp.push(t[i].unemp * 100);
    }
    return { seed, ri: corr(infl, rate), ru: corr(unemp, rate) };
  });
  const ri = med(runs.map((r) => r.ri));
  const ru = med(runs.map((r) => r.ru));
  report("G. POLICY RESPONDS — does the rate read the economy?",
    ri >= 0.35 && ru <= 0.0,
    [`corr(inflation, loan index): ${runs.map((r) => r.ri.toFixed(2)).join("  ")}   median ${ri.toFixed(2)}   (need >= 0.35 — policy leans against inflation)`,
     `corr(unemployment, loan index): ${runs.map((r) => r.ru.toFixed(2)).join("  ")}   median ${ru.toFixed(2)}   (need <= 0 — policy cuts into a weak labour market)`]);
}

// ---------------------------------------------------------------------------
// H. THE GLUT IS SEEN — a drowning city cannot be called an expansion
// ---------------------------------------------------------------------------
// The owner's cheat scenario, verbatim: flood the city with empty office and
// watch the top-left corner keep saying "expansion". Two clauses. The phase
// machine must see the slack; and the rent drift must never SATURATE — every
// extra point of vacancy has to keep costing rent, or a 45% glut is priced
// the same as a 20% one.
{
  const parcels = clone();
  let g = E.firstListings(E.newGame(910117, parcels), parcels, bbls);
  for (let m = 0; m < 36; m++) g = E.advanceQuarter(g, parcels, bbls, adjacency);
  E.addStock(g.econ, "office", 4_000_000);
  const t = [];
  for (let m = 0; m < 144; m++) {
    g = E.advanceQuarter(g, parcels, bbls, adjacency);
    t.push({ vac: g.econ.cityVac.office, phase: g.econ.phase, rent: g.econ.rentIdx.office, rate: g.econ.indexRate });
  }
  const peakVac = Math.max(...t.map((x) => x.vac));
  // months describing a >25%-vacant market as expansion or peak
  const lying = t.filter((x) => x.vac > 0.25 && (x.phase === "expansion" || x.phase === "peak")).length;
  const deep = t.filter((x) => x.vac > 0.25).length;
  const share = deep ? lying / deep : 0;
  // and the rate must not RISE through it — a glut is a demand shock
  const rate0 = t[0].rate, rateLate = med(t.slice(24, 96).map((x) => x.rate));
  report("H. THE GLUT IS SEEN — 4M sf of empty office dropped on the city",
    peakVac > 0.25 && share <= 0.15 && rateLate <= rate0 + 0.5,
    [`office vacancy peaked at ${(peakVac * 100).toFixed(1)}%`,
     `months calling a >25%-vacant market 'expansion' or 'peak': ${lying} of ${deep} (${(share * 100).toFixed(0)}%)   (need <= 15%)`,
     `loan index ${rate0.toFixed(2)}% -> ${rateLate.toFixed(2)}% median over the glut   (need not to RISE: a glut is a demand shock)`,
     `rent index over the glut: ${t[0].rent.toFixed(0)} -> ${Math.min(...t.map((x) => x.rent)).toFixed(0)} trough`]);
}

// ---------------------------------------------------------------------------
// I. BUILDING COSTS BITE — the supply cycle limits itself
// ---------------------------------------------------------------------------
// When everybody builds at once, the trades are busy and they charge for it.
// That is the brake that makes real construction booms end without anybody
// deciding they should. If costIdx is deaf to how much is being built, then
// the only thing stopping a boom is a number somebody typed.
{
  const runs = [550991, 12007, 73303, 11, 22].map((seed) => {
    const t = [];
    const parcels = clone();
    let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
    for (let m = 0; m < 600; m++) {
      g = E.advanceQuarter(g, parcels, bbls, adjacency);
      const e = g.econ;
      const pipe = (e.pipeline?.office ?? 0) + (e.pipeline?.multifamily ?? 0)
        + (e.pipeline?.retail ?? 0) + (e.pipeline?.industrial ?? 0);
      const stock = e.stock.office + e.stock.multifamily + e.stock.retail + e.stock.industrial;
      t.push({ build: stock > 0 ? pipe / stock : 0, cost: e.costIdx, cpi: e.cpi ?? 1 });
    }
    // real construction cost (over CPI) against how much is under way, annually
    const bs = [], cs = [];
    for (let i = 60; i + 12 < t.length; i += 6) {
      bs.push(t[i].build);
      cs.push((t[i + 12].cost / t[i + 12].cpi) / (t[i].cost / t[i].cpi) - 1);
    }
    return { seed, c: corr(bs, cs) };
  });
  const c = med(runs.map((r) => r.c));
  report("I. BUILDING COSTS BITE — does a boom bid up the trades?",
    c >= 0.25,
    [`corr(share of stock under construction, next year's REAL cost growth): ${runs.map((r) => r.c.toFixed(2)).join("  ")}   median ${c.toFixed(2)}   (need >= 0.25)`,
     `a boom that does not raise costs is a boom with no brake but the calendar`]);
}

// ---------------------------------------------------------------------------
console.log("\n" + "=".repeat(64));
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length} of ${results.length} simulation tests pass`);
if (failed.length) { console.log("failing: " + failed.map((f) => f.name.split(".")[0]).join(", ")); process.exit(1); }
