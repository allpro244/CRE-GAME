// ECONOMY HONESTY — the OPEN findings from CENTURY_REPORT / ECONOMY.md that
// are mechanisms rather than coefficient dials.
//
//   1. Solvent husks wind up (empty book + clear debt ≠ forever alive).
//   2. High slack cannot be labelled "recovery" forever — depression exists.
//   3. Ordinary sublet inventory has an idiosyncratic floor.
//   4. Patient styles have hold clocks (tape is not 84-year holds only).
//   5. Off-market comps can actually fire.
//   6. Pro forma exit yield is tax-loaded like assetValue (one valuation).
//
// Run: node test/economy-honesty.mjs
import { permittedUse } from "./permitted-use.mjs";
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels: baseParcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);
const clone = () => structuredClone(baseParcels);

let bad = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`);
  if (!ok) bad++;
};

console.log("\nECONOMY HONESTY — husks, depression, sublet, turnover, off-market, dual-val\n");

// ---------------------------------------------------------------------------
// 1. The cycle is DATED from payroll levels (market.ts derivePhase, 2026-11-24):
//    noise is not a recession, a real fall is, a deep long one is a depression,
//    and the street's rumour comes from the data, not dice. This used to poke
//    `slackEma`, which the dating stopped reading long ago: it failed on main
//    and tested nothing.
// ---------------------------------------------------------------------------
{
  const parcels = clone();
  const base = E.firstListings(E.newGame(44101, parcels), parcels, bbls);
  // Run the dating alone over a payroll path (index 1.0 = the opening payroll).
  const runPath = (path) => {
    const g = structuredClone(base);
    const e = g.econ;
    e.jobs0 = 100_000; e.history = [{}, {}]; e.phase = "expansion"; e.phaseAge = 10; e.rumoredPhase = null;
    for (const k of ["cycHist", "cycPeak", "cycPeakM", "cycOldPeak", "cycLow", "cycLowM"]) delete e[k];
    g.news = [];
    const phases = [];
    path.forEach((T, i) => { g.month = 1000 + i; e.jobs = Math.round(T * e.jobs0); E.derivePhase(g); phases.push(e.phase); });
    return { phases, rumours: g.news.filter((n) => n.kind === "rumor").map((n) => n.text) };
  };
  const flat = Array.from({ length: 120 }, (_, i) => 1 + 0.005 * Math.sin(i / 3));
  check(!runPath(flat).phases.some((p) => p === "recession" || p === "depression"),
    "payrolls wobbling ±0.5% around a flat line are never a recession");
  // 12 months up, a 3% fall over 8 months, 6 flat, then back above the peak
  const cyc = [...Array.from({ length: 12 }, (_, i) => 1 + 0.002 * i), ...Array.from({ length: 8 }, (_, i) => 1.022 - 0.004 * (i + 1)),
    ...Array(6).fill(0.99), ...Array.from({ length: 20 }, (_, i) => 0.99 + 0.002 * (i + 1))];
  const c = runPath(cyc).phases;
  const firstRec = c.indexOf("recession");
  check(firstRec >= 0 && firstRec - 11 >= 6, `a 3% fall is dated a recession, no sooner than six months after the peak (month ${firstRec - 11} after it)`);
  check(c.includes("recovery") && c.at(-1) === "expansion", `it turns to recovery after the trough and expansion once the old peak is regained (ends ${c.at(-1)})`);
  // a 15% fall over 30 months
  const deep = [...Array(12).fill(1), ...Array.from({ length: 30 }, (_, i) => 1 - 0.005 * (i + 1))];
  check(runPath(deep).phases.includes("depression"), "a fall of a tenth that keeps going past eighteen months is a depression");
  const r1 = runPath(cyc).rumours, r2 = runPath(cyc).rumours;
  check(r1.length > 0 && JSON.stringify(r1) === JSON.stringify(r2), `rumours come from the payrolls, identically on the same path (${r1.length} heard)`);
}

// ---------------------------------------------------------------------------
// 2. Style table: patient capital has hold clocks; owner-user still never sells.
// ---------------------------------------------------------------------------
{
  check(E.STYLE_OF("family").holdM >= 240, `family holdM ${E.STYLE_OF("family").holdM} ≥ 20y`);
  check(E.STYLE_OF("foreign").holdM >= 180, `foreign holdM ${E.STYLE_OF("foreign").holdM} ≥ 15y`);
  check(E.STYLE_OF("slumlord").holdM >= 120, `slumlord holdM ${E.STYLE_OF("slumlord").holdM} ≥ 10y`);
  check(E.STYLE_OF("owneruser").holdM === 0, "owner-user still never sells (holdM 0)");
}

// ---------------------------------------------------------------------------
// 3. Sublet background: calm market still markets idiosyncratic space.
// ---------------------------------------------------------------------------
{
  const parcels = clone();
  let g = E.firstListings(E.newGame(550991, parcels), parcels, bbls);
  // Warm a few years so the give-back has settled.
  for (let m = 0; m < 36; m++) {
    g = E.advanceMonth(g, parcels, bbls, adjacency);
    if (g.gameOver) g = { ...g, gameOver: null, cash: Math.max(g.cash, 5e6) };
  }
  const stock = g.econ.stock.office;
  const sub = (g.econ.sublet?.office ?? 0) / Math.max(1, stock);
  check(sub >= 0.004,
    `ordinary office sublet ${(sub * 100).toFixed(2)}% of stock (need ≥ 0.4% — idiosyncratic floor)`);
  check(sub <= 0.10,
    `ordinary office sublet ${(sub * 100).toFixed(2)}% of stock stays under the 10% guard`);
}

// ---------------------------------------------------------------------------
// 4. Dual valuation: plan exit yield is tax-loaded (≥ bare cap).
// ---------------------------------------------------------------------------
{
  const parcels = clone();
  const g = E.firstListings(E.newGame(12007, parcels), parcels, bbls);
  // Any owned lot with zoning room — vacant land preferred, else teardown site.
  const land = bbls.map((b) => parcels[b]).find((r) => r && r.class === "land" && r.lotArea > 5000)
    ?? bbls.map((b) => parcels[b]).find((r) => r && r.lotArea > 8000 && (r.zoningMaxFar ?? 0) >= 3);
  check(!!land, `found a developable site (${land ? land.bbl : "none"})`);
  if (land) {
    g.holdings[land.bbl] = {
      bbl: land.bbl, boughtM: 0, costBasis: 1_000_000, condition: "standard",
      tenants: [], loan: null, condIdx: 0.85, cfHistory: [],
    };
    g.cash = 200_000_000;
    const floors = Math.min(12, Math.max(4, Math.floor((land.zoningMaxFar ?? 4) * land.lotArea / Math.max(1, land.lotArea * 0.6) )));
    const plan = E.planDevelopment(g, parcels, land.bbl, permittedUse(E, land, g.econ, ["office"]), floors, 0.6);
    check(!!plan, `planDevelopment returns a plan${plan ? "" : " (null)"}`);
    if (plan) {
      // Bare office exit caps in this engine sit ~5–9%; tax load adds ~TAX_RATE
      // share. The plan field is the tax-loaded yield the hurdle uses.
      check(plan.exitCap >= 6.0,
        `plan exit yield ${plan.exitCap.toFixed(2)}% is tax-loaded (≥ 6%, not a bare mid-5s cap alone)`);
      check(plan.requiredYield > plan.exitCap,
        `required yield ${plan.requiredYield.toFixed(2)}% > exit ${plan.exitCap.toFixed(2)}%`);
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Husks: solvent empty firm winds up after the empty clock.
// ---------------------------------------------------------------------------
{
  const parcels = clone();
  let g = E.firstListings(E.newGame(73303, parcels), parcels, bbls);
  // Plant a husk that has already deployed (basis > 0) and sits empty.
  g.rivals = g.rivals ?? [];
  g.rivals.push({
    id: "husk-test", name: "Husk Capital", style: "family",
    cash: 2_000_000, debt: 0, bbls: [], targetLtv: 0.5, bornM: 0,
    basis: 5_000_000, aum: 0, emptyMs: 24, uncalled: 0,
  });
  g = E.advanceMonth(g, parcels, bbls, adjacency);
  const husk = (g.rivals ?? []).find((r) => r.id === "husk-test");
  check(!!husk && husk.failedM !== undefined,
    `solvent husk is wound up (failedM=${husk?.failedM ?? "none"})`);
}

// ---------------------------------------------------------------------------
// 6. Off-market flag can appear on the comps sheet within a long run.
// ---------------------------------------------------------------------------
{
  const parcels = clone();
  let g = E.firstListings(E.newGame(22, parcels), parcels, bbls);
  let saw = 0;
  const seen = new Set();
  for (let m = 0; m < 240; m++) {
    g = E.advanceMonth(g, parcels, bbls, adjacency);
    if (g.gameOver) g = { ...g, gameOver: null, cash: Math.max(g.cash, 5e6) };
    for (const c of g.comps ?? []) {
      if (!c.offMarket) continue;
      const key = `${c.m}|${c.bbl}|${c.price}`;
      if (seen.has(key)) continue;
      seen.add(key);
      saw++;
    }
  }
  // Soft gate: with hold clocks + quiet treaty, some private sales should land
  // in twenty years. If zero, the branch is still dead.
  check(saw > 0, `off-market comps observed in 20y (${saw} unique prints) — weighting branch is live`);
}

console.log("");
process.exit(bad ? 1 : 0);
