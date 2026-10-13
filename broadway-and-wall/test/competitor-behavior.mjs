// DO THE COMPETITORS BEHAVE LIKE THEIR SHEETS SAY?
//
// Runs a town with nobody playing for YEARS and follows every named firm deed
// by deed: what it buys (class, where, distress, off-market), how long it
// holds, what it builds, how levered it runs, and whether it dies. Then it
// asks, across firms, whether each trait moves the behaviour it names (a
// rank correlation), whether any hard rule was broken, and how different the
// firms actually are from one another.
//
// A report, not a gate: SEEDS (comma list), YEARS (default 50), JSON=path to
// dump the per-firm table.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";
const HERE = dirname(fileURLToPath(import.meta.url));
await import(join(HERE, "fresh.mjs"));
const E = await import(process.env.ENGINE ?? join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

const SEEDS = (process.env.SEEDS ?? "4242").split(",").map(Number);
const YEARS = Number(process.env.YEARS ?? 50);

const spearman = (xs, ys) => {
  const n = xs.length;
  if (n < 5) return NaN;
  const rank = (a) => {
    const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
    const r = new Array(n);
    for (let i = 0; i < n;) {
      let j = i; while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++;
      for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2;
      i = j + 1;
    }
    return r;
  };
  const a = rank(xs), b = rank(ys);
  const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : NaN;
};

const all = [];
for (const [ci, seed] of SEEDS.entries()) {
  const { parcels, adjacency, bbls } = loadCity(ci, E.normalizeParcels);
  let g = E.firstListings(E.newGame(seed, parcels, 6_000_000), parcels, bbls);
  const F = {};
  const firm = (r) => (F[r.id] ??= {
    seed, id: r.id, name: r.name, style: r.style, profile: r.profile, sheet: r.sheet ? { ...r.sheet } : null,
    rules: [...(r.rules ?? [])], quirks: [...(r.quirks ?? [])], bornM: r.bornM ?? 0,
    buys: 0, tight: 0, byClass: {}, prime: 0, distress: 0, offMarket: 0, landBuys: 0, builds: 0, sells: 0, sellsToPlayer: 0,
    holdM: [], ltv: [], months: 0, failedM: undefined, outcome: "alive", peakAum: 0, home: 0, buysWithHome: 0,
    maxBuysYear: 0, buysByYear: {}, rulesBroken: [],
  });
  const prevB = {};
  const listed = (bbl) => g.listings.find((l) => l.bbl === bbl);
  let prevListings = new Map();
  let prevNotes = new Set();
  for (const r of g.rivals) { firm(r); prevB[r.id] = new Set(r.bbls); }
  const jobsSeen = new Set((g.cityJobs ?? []).map((j) => j.bbl + ":" + j.startM));
  for (let m = 0; m < YEARS * 12; m++) {
    prevListings = new Map(g.listings.map((l) => [l.bbl, l]));
    prevNotes = new Set([...(g.rivalNotes ?? []).map((x) => x.bbl), ...(g.notes ?? []).map((x) => x.bbl), ...(g.bankFcls ?? []).map((x) => x.bbl)]);
    g = E.advanceMonth(g, parcels, bbls, adjacency);
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
    const owner = {};
    for (const r of g.rivals) for (const b of r.bbls) owner[b] = r.id;
    for (const r of g.rivals) {
      const f = firm(r);
      const before = prevB[r.id] ?? new Set();
      const now = new Set(r.bbls);
      if (r.failedM === undefined) {
        f.months++;
        f.peakAum = Math.max(f.peakAum, r.aum ?? 0);
        if ((r.aum ?? 0) > 0) f.ltv.push(r.debt / r.aum);
      } else if (f.failedM === undefined) {
        f.failedM = r.failedM;
        f.outcome = r.retiredM !== undefined ? "retired" : r.takenOverBy ? "taken over" : r.takenPrivateM !== undefined ? "bought by you" : "failed";
      }
      for (const b of now) {
        if (before.has(b)) continue;
        // delivered on its own dirt is a build, not a buy
        if (r.deliveredM?.[b] === g.month) continue;
        const rec = E.resolveRec(parcels, g, b);
        if (!rec) continue;
        const pl = prevListings.get(b);
        f.buys++;
        const cls = rec.class === "land" || !(rec.bldgArea > 0) ? "land" : rec.class === "multifamily" ? "residential" : rec.class;
        f.byClass[cls] = (f.byClass[cls] ?? 0) + 1;
        if (cls === "land") f.landBuys++;
        if (E.demandLinear(rec.demandScore) >= 50) f.prime++;
        if (pl?.distress) f.distress++;
        if ((g.econ.creditIdx ?? 1) < 0.95) f.tight++;
        // off-market as the tape records it: a deed struck on a call, never listed
        const comp = (g.comps ?? []).slice(-60).reverse().find((c) => c.bbl === b && c.m === g.month);
        if (comp?.offMarket) f.offMarket++;
        if (r.home) { f.buysWithHome++; if (rec.district === r.home) f.home++; }
        const y = Math.floor(g.month / 12);
        f.buysByYear[y] = (f.buysByYear[y] ?? 0) + 1;
        f.maxBuysYear = Math.max(f.maxBuysYear, f.buysByYear[y]);
        // hard rules
        const R = f.rules;
        if (R.includes("onlyOffice") && cls !== "office") f.rulesBroken.push(`onlyOffice bought ${cls}`);
        if (R.includes("onlyResidential") && cls !== "residential") f.rulesBroken.push(`onlyResidential bought ${cls}`);
        if (R.includes("onlyRetail") && cls !== "retail") f.rulesBroken.push(`onlyRetail bought ${cls}`);
        // a builder under ONLY industrial buys the dirt its warehouses go on
        if (R.includes("onlyIndustrial") && cls !== "industrial" && !(cls === "land" && (f.sheet?.build ?? 0) > 0)) f.rulesBroken.push(`onlyIndustrial bought ${cls}`);
        if (R.includes("onlyLand") && cls !== "land") f.rulesBroken.push(`onlyLand bought ${cls}`);
        if (R.includes("neverDistress") && pl?.distress) f.rulesBroken.push("neverDistress bought distress");
        // ONLY home: its home district, or one it already owns in (siteFit's rule)
        const owned = new Set([...before].map((x) => E.resolveRec(parcels, g, x)?.district));
        if (R.includes("onlyHome") && r.home && rec.district !== r.home && !owned.has(rec.district) && before.size > 0) f.rulesBroken.push("onlyHome bought away");
      }
      for (const b of before) {
        if (now.has(b)) continue;
        f.sells++;
        if (g.holdings[b]) f.sellsToPlayer++;
        const since = r.heldSince?.[b];
        // a VOLUNTARY sale: its own non-distress listing, or a quiet sale to another firm
        const pl = prevListings.get(b);
        // a deed taken through a note somebody else held is not a sale
        const viaPaper = prevNotes.has(b);
        const voluntary = !viaPaper && (pl ? (pl.sellerId === r.id && !pl.distress && pl.reason !== "receiver") : (!!owner[b] && owner[b] !== r.id && r.failedM === undefined && !r.stressMs));
        if (voluntary) f.voluntarySells = (f.voluntarySells ?? 0) + 1;
        if (f.rules.includes("neverSells") && voluntary) f.rulesBroken.push("neverSells sold");
      }
      prevB[r.id] = now;
    }
    for (const j of g.cityJobs ?? []) {
      const k = j.bbl + ":" + j.startM;
      if (jobsSeen.has(k)) continue;
      jobsSeen.add(k);
      if (j.firmId && F[j.firmId]) {
        F[j.firmId].builds++;
        if (F[j.firmId].rules.includes("neverBuilds")) F[j.firmId].rulesBroken.push("neverBuilds built");
      }
    }
    // hold length: record at sale from heldSince snapshots
    for (const r of g.rivals) {
      const f = F[r.id];
      f._held = f._held ?? {};
      for (const b of r.bbls) if (f._held[b] === undefined) f._held[b] = g.month;
      for (const b of Object.keys(f._held)) if (!r.bbls.includes(b)) { f.holdM.push(g.month - f._held[b]); delete f._held[b]; }
    }
  }
  for (const f of Object.values(F)) {
    for (const b of Object.keys(f._held ?? {})) f.holdM.push(YEARS * 12 - f._held[b]);
    delete f._held;
    all.push(f);
  }
}

// ---------------------------------------------------------------- report
const pct = (a, b) => (b > 0 ? Math.round((100 * a) / b) : 0);
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
console.log(`\nCOMPETITOR BEHAVIOUR — ${SEEDS.length} town(s) × ${YEARS} years, no player\n`);
console.log("firm".padEnd(30), "profile".padEnd(13), "yrs".padStart(3), "buys", "bld", "sell", "of/res/ind/ret/lnd%".padStart(19), "prime%", "dist%", "tight%", "offmkt%", "hold", "ltv", "outcome");
for (const f of all.sort((a, b) => b.buys - a.buys)) {
  const c = (k) => pct(f.byClass[k] ?? 0, f.buys);
  console.log(
    f.name.slice(0, 29).padEnd(30), String(f.profile ?? f.style).slice(0, 12).padEnd(13), String(Math.round(f.months / 12)).padStart(3),
    String(f.buys).padStart(4), String(f.builds).padStart(3), String(f.sells).padStart(4),
    `${c("office")}/${c("residential")}/${c("industrial")}/${c("retail")}/${c("land")}`.padStart(19),
    String(pct(f.prime, f.buys)).padStart(6), String(pct(f.distress, f.buys)).padStart(5), String(pct(f.tight, f.buys)).padStart(6), String(pct(f.offMarket, f.buys)).padStart(7),
    String(Math.round(avg(f.holdM) || 0)).padStart(4), (avg(f.ltv) || 0).toFixed(2), f.outcome,
  );
}

const withSheet = all.filter((f) => f.sheet && f.months >= 60);
const active = withSheet.filter((f) => f.buys >= 3);
const corr = (trait, metric, pool = active) => {
  const rows = pool.map((f) => [f.sheet[trait], metric(f)]).filter(([, y]) => Number.isFinite(y));
  return { r: spearman(rows.map((x) => x[0]), rows.map((x) => x[1])), n: rows.length };
};
const tests = [
  ["office", "share of buys that are office", (f) => (f.byClass.office ?? 0) / f.buys],
  ["residential", "share of buys that are residential", (f) => (f.byClass.residential ?? 0) / f.buys],
  ["industrial", "share of buys that are industrial", (f) => (f.byClass.industrial ?? 0) / f.buys],
  ["retail", "share of buys that are retail", (f) => (f.byClass.retail ?? 0) / f.buys],
  ["land", "share of buys that are land", (f) => (f.byClass.land ?? 0) / f.buys],
  ["prime", "share of buys in prime locations", (f) => f.prime / f.buys],
  ["edge", "share of buys on the edge", (f) => 1 - f.prime / f.buys],
  ["homeTurf", "share of buys in its home district", (f) => (f.buysWithHome ? f.home / f.buysWithHome : NaN)],
  ["distress", "share of buys that were distress", (f) => f.distress / f.buys],
  ["reach", "share of buys that were off-market", (f) => f.offMarket / f.buys],
  ["capacity", "buys a year alive", (f) => f.buys / Math.max(1, f.months / 12), withSheet],
  ["build", "groundbreaks a year alive", (f) => f.builds / Math.max(1, f.months / 12), withSheet],
  ["hold", "average hold (months)", (f) => avg(f.holdM)],
  ["leverage", "average LTV", (f) => avg(f.ltv), withSheet],
  ["discipline", "did not fail (1) or failed (0)", (f) => (f.outcome === "failed" ? 0 : 1), withSheet],
  ["cycle", "share of buys while credit is tight (low = contrarian)", (f) => f.tight / f.buys],
];
console.log(`\nDOES EACH TRAIT MOVE ITS BEHAVIOUR? (Spearman rank correlation across firms with a sheet)\n`);
for (const [t, label, fn, pool] of tests) {
  const { r, n } = corr(t, fn, pool);
  const rr = t === "cycle" ? -r : r;   // a contrarian (low Cycle) should buy MORE in tight credit
  const verdict = !Number.isFinite(rr) ? "n/a" : rr >= 0.35 ? "YES" : rr >= 0.15 ? "weak" : rr > -0.15 ? "NO" : "BACKWARDS";
  console.log(`  ${t.padEnd(12)} → ${label.padEnd(44)} r=${Number.isFinite(r) ? r.toFixed(2).padStart(5) : "  n/a"}  n=${n}  ${verdict}`);
}

const broken = all.filter((f) => f.rulesBroken.length);
console.log(`\nHARD RULES: ${broken.length ? broken.map((f) => `${f.name}: ${[...new Set(f.rulesBroken)].join(", ")} (${f.rulesBroken.length})`).join("; ") : "none broken"}`);
const idle = withSheet.filter((f) => f.buys + f.builds === 0);
console.log(`IDLE: ${idle.length} of ${withSheet.length} sheeted firms never bought or built in their life` + (idle.length ? ` — ${idle.slice(0, 8).map((f) => `${f.name} (${f.profile}, ${Math.round(f.months / 12)}y)`).join(", ")}` : ""));
const outcomes = {};
for (const f of all) outcomes[f.outcome] = (outcomes[f.outcome] ?? 0) + 1;
console.log(`OUTCOMES: ${Object.entries(outcomes).map(([k, v]) => `${k} ${v}`).join(", ")} (of ${all.length} firms ever)`);
const byProf = {};
for (const f of all) (byProf[f.profile ?? f.style] ??= []).push(f);
console.log(`PROFILES SEEN: ${Object.keys(byProf).length}`);
if (process.env.JSON) writeFileSync(process.env.JSON, JSON.stringify(all, null, 1));
