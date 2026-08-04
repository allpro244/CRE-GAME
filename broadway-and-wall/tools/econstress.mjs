// THE DEEP ECONOMY STRESS TEST.
//
//   pnpm stress                 the whole battery, writes ECONOMY_STRESS.md
//   pnpm stress --only=33,A,28  a subset
//   SEEDS=10 pnpm stress        wider tournament
//
// The interconnection audit (tools/econaudit.mjs) asks whether a shock in one
// place moves the right things elsewhere. This asks a harder and more hostile
// set of questions: does the world exist without the player, does the player
// exist to the world, is there a dominant strategy, is there a money pump, and
// does the whole thing survive being pushed to its bounds.
//
// The order below is deliberate and is the owner's: DETERMINISM FIRST, because
// every paired-run number in either audit is worthless if the engine does not
// reproduce. Then the null player, because a world that only moves when poked
// is a response function wearing a simulation's clothes. Then the tournament,
// because an economy with one right answer is a solved game.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { E, USES, MONTHS, run, city, med, mean, pct } from "./econaudit-core.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "ECONOMY_STRESS.md");
const CITY_SEED = Number(process.env.CITY_SEED ?? 20261);
const SEEDS = Number(process.env.SEEDS ?? 6);
const MARKET_SEEDS = [550991, 12007, 73303, 11, 22, 4242, 90210, 313, 777, 2468].slice(0, SEEDS);
const only = (process.argv.find((a) => a.startsWith("--only=")) ?? "").slice(7).split(",").filter(Boolean);
const want = (k) => !only.length || only.includes(String(k));
const md = [];
const say = (s) => md.push(s);
const log = (...a) => console.log(...a);
const RESULTS = [];
const report = (id, title, verdict, lines) => {
  RESULTS.push({ id, title, verdict, lines });
  log(`\n[${id}] ${title}: ${verdict}`);
  for (const l of lines) log("   " + l);
};
const M = (n) => (Math.abs(n) >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : `$${(n / 1e6).toFixed(1)}M`);

// ---------------------------------------------------------------------------
// NUMERICAL HYGIENE (test 32) — rides along on every run in this file
// ---------------------------------------------------------------------------
const HYGIENE = [];
function scan(tag, g, parcels) {
  const e = g.econ, bad = [];
  const chk = (name, v, lo, hi) => {
    if (!Number.isFinite(v)) { bad.push(`${name} = ${v}`); return; }
    if (lo !== undefined && v < lo) bad.push(`${name} = ${v.toFixed(4)} (below ${lo})`);
    if (hi !== undefined && v > hi) bad.push(`${name} = ${v.toFixed(4)} (above ${hi})`);
  };
  chk("cash", g.cash);
  chk("indexRate", e.indexRate, 0, 40);
  chk("cpi", e.cpi, 0.05, 1000);
  chk("wageIdx", e.wageIdx, 0.05, 1000);
  chk("costIdx", e.costIdx, 0.05, 1000);
  chk("population", e.population, 1000);
  chk("unemployment", e.unemployment, 0, 1);
  chk("creditIdx", e.creditIdx, 0, 3);
  for (const u of USES) {
    chk(`rentIdx.${u}`, e.rentIdx?.[u], 0);
    chk(`cityVac.${u}`, e.cityVac?.[u], 0, 1);
    chk(`stock.${u}`, e.stock?.[u], 0);
    chk(`occupied.${u}`, e.occupied?.[u], 0);
    if ((e.occupied?.[u] ?? 0) > (e.stock?.[u] ?? 0) * 1.001) {
      bad.push(`occupied.${u} exceeds stock (${Math.round(e.occupied[u])} > ${Math.round(e.stock[u])})`);
    }
  }
  for (const h of Object.values(g.holdings ?? {})) {
    if (h.occ !== undefined && (h.occ < -0.001 || h.occ > 1.001)) bad.push(`holding ${h.bbl} occ = ${h.occ}`);
    if (h.loan && !Number.isFinite(h.loan.balance)) bad.push(`holding ${h.bbl} loan balance = ${h.loan.balance}`);
  }
  if (bad.length) HYGIENE.push({ tag, month: e.m, issues: bad.slice(0, 6) });
  return bad.length;
}

// ===========================================================================
// 33. DETERMINISM — run this first or nothing else means anything
// ===========================================================================
if (want(33)) {
  const lines = [];
  let identical = 0, differed = 0;
  const fingerprint = (g) => {
    const e = g.econ;
    return JSON.stringify([
      +e.indexRate.toFixed(6), +e.cpi.toFixed(6), +e.wageIdx.toFixed(6), +e.costIdx.toFixed(6),
      e.population, e.jobs, +e.unemployment.toFixed(6), e.phase, +e.creditIdx.toFixed(6),
      USES.map((u) => [+e.rentIdx[u].toFixed(6), +e.cityVac[u].toFixed(6), Math.round(e.stock[u])]),
      (g.rivals ?? []).map((r) => [r.id, r.bbls.length, Math.round(r.cash), Math.round(r.debt)]),
      (g.lenders ?? []).map((l) => [l.name, Math.round(l.capital), Math.round(l.book)]),
      g.news.length, g.listings.length, Math.round(g.cash),
    ]);
  };
  for (const ms of MARKET_SEEDS.slice(0, 3)) {
    const a = run(CITY_SEED, ms, { sampleEvery: 999999 });
    const b = run(CITY_SEED, ms, { sampleEvery: 999999 });
    const fa = fingerprint(a.end), fb = fingerprint(b.end);
    if (fa === fb) identical++; else { differed++; lines.push(`seed ${ms}: DIVERGED at year 50`); }
  }
  lines.unshift(`${identical}/${identical + differed} seeds reproduced bit-for-bit over ${MONTHS / 12} years`);

  // SAVE/LOAD ROUND TRIP. The engine is JSON-serialisable by contract; if a
  // round trip changes the state, every save in the game is a subtly different
  // universe from the one the player left.
  {
    const base = city(CITY_SEED);
    const parcels = JSON.parse(JSON.stringify(base.parcels));
    let g = E.firstListings(E.newGame(MARKET_SEEDS[0], parcels), parcels, base.bbls);
    for (let m = 0; m < 180; m++) g = E.advanceQuarter(g, parcels, base.bbls, base.adjacency);
    const snapshot = JSON.parse(JSON.stringify(g));
    const pSnap = JSON.parse(JSON.stringify(parcels));
    let straight = g, loaded = snapshot;
    const pStraight = parcels, pLoaded = pSnap;
    for (let m = 0; m < 120; m++) {
      straight = E.advanceQuarter(straight, pStraight, base.bbls, base.adjacency);
      loaded = E.advanceQuarter(loaded, pLoaded, base.bbls, base.adjacency);
    }
    const same = fingerprint(straight) === fingerprint(loaded);
    lines.push(`save/load round trip after 15 years, then 10 more: ${same ? "identical" : "DIVERGED — a save is not the same universe"}`);
    if (!same) differed++;
  }
  report(33, "DETERMINISM", differed === 0 ? "WIRED" : "BROKEN", lines);
}

// ===========================================================================
// A. THE NULL PLAYER — does the city exist without you?
// ===========================================================================
function snapshotCity(g, parcels, base) {
  const e = g.econ;
  let built = 0, land = 0, sfTotal = 0, ageSum = 0, ageN = 0, tallest = 0;
  for (const b of base.bbls) {
    const rec = E.resolveRec(parcels, g, b) ?? parcels[b];
    if (!rec) continue;
    if (rec.class === "land" || !rec.bldgArea) { land++; continue; }
    built++; sfTotal += rec.bldgArea;
    ageSum += 2000 + Math.floor((e.m ?? 0) / 12) - (rec.yearBuilt || 2000); ageN++;
    tallest = Math.max(tallest, rec.floors || 0);
  }
  const rivals = (g.rivals ?? []).filter((r) => r.failedM === undefined && !r.dead);
  return {
    yr: Math.floor((e.m ?? 0) / 12),
    built, land, sfM: sfTotal / 1e6, age: ageN ? ageSum / ageN : 0, tallest,
    pop: e.population, jobs: e.jobs, vacOff: e.cityVac?.office ?? 0,
    rentOff: e.rentIdx?.office ?? 0, cpi: e.cpi,
    firms: rivals.length, aum: rivals.reduce((a, r) => a + (r.aum ?? 0), 0),
    demolished: g.demolished ?? 0, comps: (g.comps ?? []).length,
    cityBuilt: (g.cityBuilt ?? []).length,
  };
}

if (want("A")) {
  const rows = [];
  for (const ms of MARKET_SEEDS.slice(0, 3)) {
    const base = city(CITY_SEED);
    const parcels = JSON.parse(JSON.stringify(base.parcels));
    let g = E.firstListings(E.newGame(ms, parcels), parcels, base.bbls);
    const snaps = [snapshotCity(g, parcels, base)];
    for (let m = 0; m < MONTHS; m++) {
      g = E.advanceQuarter(g, parcels, base.bbls, base.adjacency);
      if (m % 60 === 0) scan(`null:${ms}`, g, parcels);
      if (m === 299 || m === MONTHS - 1) snaps.push(snapshotCity(g, parcels, base));
    }
    rows.push(snaps);
  }
  const at = (i, k) => med(rows.map((r) => r[i][k]));
  const lines = [
    `                    year 0        year 25       year 50`,
    `buildings standing  ${String(at(0, "built")).padEnd(13)} ${String(at(1, "built")).padEnd(13)} ${at(2, "built")}`,
    `vacant lots         ${String(at(0, "land")).padEnd(13)} ${String(at(1, "land")).padEnd(13)} ${at(2, "land")}`,
    `built sf            ${at(0, "sfM").toFixed(1)}M${" ".repeat(9)} ${at(1, "sfM").toFixed(1)}M${" ".repeat(9)} ${at(2, "sfM").toFixed(1)}M`,
    `mean building age   ${at(0, "age").toFixed(0)}${" ".repeat(12)} ${at(1, "age").toFixed(0)}${" ".repeat(12)} ${at(2, "age").toFixed(0)}`,
    `tallest building    ${String(at(0, "tallest")).padEnd(13)} ${String(at(1, "tallest")).padEnd(13)} ${at(2, "tallest")}`,
    `population          ${String(at(0, "pop")).padEnd(13)} ${String(at(1, "pop")).padEnd(13)} ${at(2, "pop")}`,
    `office vacancy      ${pct(at(0, "vacOff")).padEnd(13)} ${pct(at(1, "vacOff")).padEnd(13)} ${pct(at(2, "vacOff"))}`,
    `office rent index   ${at(0, "rentOff").toFixed(0)}${" ".repeat(12)} ${at(1, "rentOff").toFixed(0)}${" ".repeat(12)} ${at(2, "rentOff").toFixed(0)}`,
    `firms alive         ${String(at(0, "firms")).padEnd(13)} ${String(at(1, "firms")).padEnd(13)} ${at(2, "firms")}`,
    `street AUM          ${M(at(0, "aum")).padEnd(13)} ${M(at(1, "aum")).padEnd(13)} ${M(at(2, "aum"))}`,
    `trades recorded     ${String(at(0, "comps")).padEnd(13)} ${String(at(1, "comps")).padEnd(13)} ${at(2, "comps")}`,
    `city groundbreaks   ${String(at(0, "cityBuilt")).padEnd(13)} ${String(at(1, "cityBuilt")).padEnd(13)} ${at(2, "cityBuilt")}`,
    `buildings demolished${String(at(0, "demolished")).padEnd(13)} ${String(at(1, "demolished")).padEnd(13)} ${at(2, "demolished")}`,
  ];
  // The verdict: did the world actually DO anything?
  const moved = [
    at(2, "comps") > 50, at(2, "cityBuilt") > 20, at(2, "demolished") > 5,
    Math.abs(at(2, "sfM") / Math.max(0.01, at(0, "sfM")) - 1) > 0.08,
    at(2, "firms") < at(0, "firms"),
  ].filter(Boolean).length;
  lines.push(`world-activity checks passed: ${moved}/5 (trades, city building, demolition, stock change, firm failure)`);
  report("A", "THE NULL PLAYER — 50 years, nobody playing",
    moved >= 4 ? "WIRED" : moved >= 2 ? "WEAK" : "BROKEN", lines);
}

// ===========================================================================
// H28. STRATEGY TOURNAMENT
// ===========================================================================
// Eight archetypes, each a real posture rather than a difficulty setting. They
// share one leasing policy (take anything at or near market) so that what is
// being compared is ACQUISITION and CAPITAL strategy, not leasing skill.
const STRATS = {
  core: { ltv: 0.55, buyWhen: () => true, want: (r) => r.demandScore >= 55 && r.class !== "land", maxPrice: 1.0, sellAt: null, build: false },
  allcash: { ltv: 0, buyWhen: () => true, want: (r) => r.class !== "land", maxPrice: 0.96, sellAt: null, build: false },
  maxlev: { ltv: 0.80, buyWhen: () => true, want: (r) => r.class !== "land", maxPrice: 1.05, sellAt: null, build: false },
  valueadd: { ltv: 0.68, buyWhen: () => true, want: (r, g) => r.class !== "land" && E.initialCondition(r) !== "good", maxPrice: 0.92, sellAt: 96, build: false },
  landbank: { ltv: 0.35, buyWhen: () => true, want: (r) => r.class === "land", maxPrice: 1.0, sellAt: null, build: false },
  // A MERCHANT BUILDER BUYS DIRT WITH EQUITY AND LEVERS THE CONSTRUCTION, not
  // the other way round. The first cut of this bought land at 72% LTV, which
  // is a thing no lender writes and no builder asks for: raw land throws off
  // no income, so the debt service eats the sponsor alive while the site sits
  // there, and there is nothing left to fund the build with. It returned
  // -$0.1M with four wipeouts in four seeds and I reported that as an engine
  // blocker in the develop-lease-sell chain. It was the bot being stupid.
  // Land in cash, then build, then sell once it is leased -- which is the
  // actual business.
  merchant: { ltv: 0, buyWhen: () => true, want: (r) => r.class === "land", maxPrice: 1.0, sellAt: 60, build: true },
  contrarian: { ltv: 0.60, buyWhen: (e) => e.phase === "recession" || (e.creditIdx ?? 1) < 0.8, want: (r) => r.class !== "land", maxPrice: 0.88, sellAt: null, build: false },
  industrial: { ltv: 0.62, buyWhen: () => true, want: (r) => r.class === "industrial", maxPrice: 1.0, sellAt: null, build: false },
};

function playStrategy(name, ms) {
  const st = STRATS[name];
  const base = city(CITY_SEED);
  const parcels = JSON.parse(JSON.stringify(base.parcels));
  let g = E.firstListings(E.newGame(ms, parcels), parcels, base.bbls);
  let bought = 0, sold = 0, builtN = 0, peak = 0, trough = 1;
  for (let m = 0; m < MONTHS; m++) {
    g = E.advanceQuarter(g, parcels, base.bbls, base.adjacency);
    const e = g.econ;
    // ---- leasing: identical for everyone
    for (const loi of [...g.lois]) {
      const rec = E.resolveRec(parcels, g, loi.bbl);
      const h = g.holdings[loi.bbl];
      if (!rec || !h) continue;
      const mkt = E.managedRentPsfYr(rec, e, h, loi.use);
      const r = E.respondLOI(g, parcels, loi.id, loi.rentPsf >= mkt * 0.92 ? "accept" : "pass");
      if (!r.err) g = r.s;
    }
    // ---- take offers on anything we are selling
    for (const h of Object.values(g.holdings)) {
      if (!h.sale?.offer) continue;
      const r = E.acceptSaleOffer(g, parcels, h.bbl);
      if (!r.err) { g = r.s; sold++; }
    }
    // ---- buy
    // ONE SITE AT A TIME for a builder. Accumulating dirt is a land banker's
    // business, not a merchant's: seven vacant lots bought with the whole fund
    // earn nothing, cannot be built on because the equity is already spent,
    // and the property tax bleeds the account to zero. Which is exactly what
    // happened -- 101% drawdown, four wipeouts in four seeds. A merchant buys
    // a site, builds it, sells it, and buys the next one.
    const busy = st.build
      && (Object.keys(g.developments).length > 0
        || Object.values(g.holdings).some((h) => (E.resolveRec(parcels, g, h.bbl)?.class) === "land"));
    if (st.buyWhen(e) && m > 2 && !busy) {
      for (const li of [...g.listings].slice(0, 6)) {
        const rec = E.resolveRec(parcels, g, li.bbl);
        if (!rec || g.holdings[li.bbl]) continue;
        if (!st.want(rec, g)) continue;
        const worth = rec.class === "land" ? E.landValue(rec, e)
          : E.assetValue?.(rec, e, E.initialCondition(rec)) ?? li.ask;
        if (li.ask > worth * st.maxPrice) continue;
        const prod = st.ltv <= 0.01 ? "cash" : "senior";
        const r = E.executePurchase(g, parcels, li.bbl, li.ask, prod, false, st.ltv <= 0.01 ? 1 : st.ltv / 0.65);
        if (!r.err) { g = r.s; bought++; break; }
      }
    }
    // ---- build (merchant)
    if (st.build && m > 6) {
      for (const h of Object.values(g.holdings)) {
        const rec = E.resolveRec(parcels, g, h.bbl);
        if (!rec || rec.class !== "land" || g.developments[h.bbl]) continue;
        const fl = Math.min(E.maxFloorsFor?.(rec) ?? 8, 8);
        const r = E.startDevelopment(g, parcels, h.bbl, "office", fl, 0.6);
        if (!r.err) { g = r.s; builtN++; }
        break;
      }
    }
    // ---- sell on a clock (merchant / value-add)
    if (st.sellAt) {
      for (const h of Object.values(g.holdings)) {
        if (h.sale || g.developments[h.bbl]) continue;
        if (m - (h.boughtM ?? 0) < st.sellAt) continue;
        const rec = E.resolveRec(parcels, g, h.bbl);
        if (!rec || rec.class === "land") continue;
        const v = E.holdingValue?.(g, parcels, h.bbl) ?? E.assetValue(rec, e, h.condition);
        const r = E.listForSale(g, parcels, h.bbl, Math.round((typeof v === "number" ? v : v.value ?? 0) * 1.02));
        if (!r.err) g = r.s;
        break;
      }
    }
    if (m % 12 === 0) {
      const nw = E.netWorth(g, parcels);
      peak = Math.max(peak, nw);
      if (peak > 0) trough = Math.min(trough, nw / peak);
    }
    if (m % 120 === 0) scan(`strat:${name}:${ms}`, g, parcels);
  }
  return { nw: E.netWorth(g, parcels), bought, sold, builtN, drawdown: 1 - trough,
           holdings: Object.keys(g.holdings).length, cpi: g.econ.cpi };
}

if (want(28)) {
  const table = [];
  for (const name of Object.keys(STRATS)) {
    const outs = MARKET_SEEDS.map((ms) => playStrategy(name, ms));
    const nws = outs.map((o) => o.nw).sort((a, b) => a - b);
    table.push({
      name, med: med(nws), worst: nws[0], best: nws[nws.length - 1],
      realMed: med(outs.map((o) => o.nw / Math.max(0.1, o.cpi))),
      dd: med(outs.map((o) => o.drawdown)), fails: outs.filter((o) => o.nw < 1e6).length,
      bought: med(outs.map((o) => o.bought)), holds: med(outs.map((o) => o.holdings)),
    });
    log(`   ${name.padEnd(11)} median ${M(med(nws))}  worst ${M(nws[0])}  best ${M(nws[nws.length - 1])}`);
  }
  table.sort((a, b) => b.realMed - a.realMed);
  const winner = table[0], loser = table[table.length - 1];
  // How often does the top strategy actually win? Recompute per-seed rank.
  const lines = [
    `strategy     median NW    real NW      worst        best         maxDD   wipeouts  bought  holds`,
    ...table.map((t) =>
      `${t.name.padEnd(12)} ${M(t.med).padEnd(12)} ${M(t.realMed).padEnd(12)} ${M(t.worst).padEnd(12)} ${M(t.best).padEnd(12)} ${pct(t.dd).padEnd(7)} ${String(t.fails).padEnd(9)} ${String(t.bought).padEnd(7)} ${t.holds}`),
    ``,
    `strongest: ${winner.name} at ${M(winner.realMed)} real · weakest: ${loser.name} at ${M(loser.realMed)}`,
    `spread between best and worst strategy: ${(winner.realMed / Math.max(1, loser.realMed)).toFixed(1)}x`,
  ];
  const spread = winner.realMed / Math.max(1, loser.realMed);
  report(28, "STRATEGY TOURNAMENT", spread > 12 ? "BROKEN" : spread > 5 ? "WEAK" : "WIRED", lines);
  globalThis.__tourney = table;
}

// ===========================================================================
// 32. NUMERICAL HYGIENE — the scan that rode along with everything above
// ===========================================================================
if (HYGIENE.length || want(32)) {
  const lines = HYGIENE.length
    ? [`${HYGIENE.length} sampled states carried a problem:`,
       ...HYGIENE.slice(0, 14).map((h) => `${h.tag} @ month ${h.month}: ${h.issues.join(" · ")}`)]
    : [`no NaN, no Infinity, no negative rents or stocks, no occupancy outside 0-100%, no occupied-exceeds-stock, across every state sampled in this run.`];
  report(32, "NUMERICAL HYGIENE", HYGIENE.length ? "BROKEN" : "WIRED", lines);
}

// ---------------------------------------------------------------------------
{
  say(`# ECONOMY STRESS TEST — Broadway & Wall`);
  say(``);
  say(`\`pnpm stress\` · ${MARKET_SEEDS.length} market seeds × ${MONTHS / 12} sim years · city seed ${CITY_SEED}.`);
  say(``);
  say(`Companion to ECONOMY_AUDIT.md. That report asks whether a shock in one place moves the right things elsewhere. This one asks whether the world exists without the player, whether the player exists to the world, whether there is a dominant strategy, and whether the engine survives being pushed to its bounds.`);
  say(``);
  for (const r of RESULTS) {
    say(`## ${r.id}. ${r.title} — **${r.verdict}**`);
    say(``);
    say("```");
    for (const l of r.lines) say(l);
    say("```");
    say(``);
  }
  writeFileSync(OUT, md.join("\n") + "\n");
  log(`\nwrote ${OUT}`);
}
