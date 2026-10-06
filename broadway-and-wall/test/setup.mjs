// THE SETUP PAGE CHOOSES A WORLD, AND THE DEFAULT IS TODAY'S.
//
//   pnpm engine && node test/setup.mjs
//   YEARS=20 node test/setup.mjs        the full default-reproduction run
//
// 1. DEFAULT_SETUP reproduces a newGame with no setup at all: state hash at
//    month zero and after YEARS years (default 20), two seeds. The only
//    difference allowed is the recorded `setup` field itself.
// 2. Every non-default option changes the world the way the page says it
//    does — and only through the engine's own states (an era, a position in
//    its credit band, a roster, a real rent roll and real paper).
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels: P0, bbls, adjacency } = loadCity(0, E.normalizeParcels);

let bad = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`); if (!ok) bad++; };
const fresh = () => JSON.parse(JSON.stringify(P0));
const start = (seed, setup, cash) => { const p = fresh(); return { g: E.firstListings(E.newGame(seed, p, cash, setup), p, bbls), p }; };
const hash = (g) => { const c = { ...g }; delete c.setup; return createHash("sha256").update(JSON.stringify(c)).digest("hex").slice(0, 16); };
const M = (n) => `$${(n / 1e6).toFixed(2)}M`;

console.log("\nSETUP — the default is today's game; every option is a world\n");

// ---------------------------------------------------------------- 1. default
const YEARS = Number(process.env.YEARS ?? 20);
for (const seed of [550991, 12007]) {
  const pa = fresh(), pb = fresh();
  let a = E.firstListings(E.newGame(seed, pa), pa, bbls);
  let b = E.firstListings(E.newGame(seed, pb, undefined, E.DEFAULT_SETUP), pb, bbls);
  check(hash(a) === hash(b), `seed ${seed}: month 0 hash ${hash(a)} == ${hash(b)} (default setup vs no setup)`);
  let diverged = -1;
  for (let m = 0; m < YEARS * 12; m++) {
    a = E.advanceMonth(a, pa, bbls, adjacency);
    b = E.advanceMonth(b, pb, bbls, adjacency);
    if (m % 12 === 11 && diverged < 0 && hash(a) !== hash(b)) diverged = m + 1;
  }
  check(diverged < 0 && hash(a) === hash(b),
    `seed ${seed}: ${YEARS} years, hash ${hash(a)} == ${hash(b)}${diverged >= 0 ? ` — DIVERGED at month ${diverged}` : ""} (over: ${a.gameOver ? "yes" : "no"})`);
}

// ----------------------------------------------- 2-3. the economy is not a setting
// Owner, Oct 2026: the economy random every single time, with no hint. A setup
// that names an era or a credit climate (an old preset, an old save) draws
// exactly as the seed would have — and the opening news names no era.
{
  const seeded = start(550991).g;
  for (const era of E.eraOptions()) {
    const { g } = start(550991, { era: era.key, credit: "tight" });
    check(g.econ.eraKey === seeded.econ.eraKey && g.econ.creditIdx === seeded.econ.creditIdx && g.econ.nat.policy === seeded.econ.nat.policy,
      `a setup naming ${era.key}/tight is ignored — the seed draws ${seeded.econ.eraKey}, credit ${seeded.econ.creditIdx}`);
  }
  check(!seeded.econ.eraLabel && !seeded.econ.eraBlurb, "the economy carries no era label for the screen");
  const labels = E.eraOptions().map((e) => e.label.toLowerCase());
  check(!seeded.news.some((n) => labels.some((l) => n.text.toLowerCase().includes(l))), "no opening news line names the era");
}
// THE BANK OPENS AT ITS OWN RULE. The opening rate is not a correction
// waiting to happen: outside the morning-after era (the deliberate
// overshoot), over 40 openings the first meeting moves the policy rate by a
// small step in either direction, and it is not always down.
{
  let up = 0, down = 0, big = 0;
  for (let i = 1; i <= 40; i++) {
    let { g, p } = start(i * 7919);
    if (g.econ.eraKey === "volcker") continue;
    const p0 = g.econ.nat.policy;
    for (let m = 0; m < 12; m++) g = E.advanceMonth(g, p, bbls, adjacency);
    const dp = g.econ.nat.policy - p0;
    if (dp > 0.2) up++; else if (dp < -0.2) down++;
    if (Math.abs(dp) > 3) big++;
  }
  check(up > 0 && down > 0 && up >= Math.round(down / 3), `first-year policy moves go both ways (up ${up}, down ${down})`);
  check(big <= 3, `a first-year move over 3 points is rare outside the morning-after era (${big})`);
}

// ---------------------------------------------------------------- 4. field
{
  const FUNDS = ["pe", "opportunistic", "vulture"];
  const std = start(550991).g, pre = start(550991, { field: "prefunds" }).g;
  const nStd = std.rivals.filter((r) => FUNDS.includes(r.style)).length;
  const nPre = pre.rivals.filter((r) => FUNDS.includes(r.style)).length;
  check(nStd > 0 && nPre === 0, `prefunds: ${nStd} fund-style firms on today's street, ${nPre} before the RTC (roster ${std.rivals.length} → ${pre.rivals.length})`);
  check(pre.rivals.length >= 16, `prefunds: the street is still a market (${pre.rivals.length} firms)`);
}

// ------------------------------------------------------------ 5. family book
{
  const base = start(73303).g;
  const { g, p } = start(73303, { inherit: 3, home: "middle" });
  const hs = Object.values(g.holdings);
  check(hs.length === 3, `inherit 3: ${hs.length} deeds on the book at month 0`);
  check(hs.every((h) => h.tenants.length > 0 || (h.occ ?? 0) > 0), `each has a real rent roll (${hs.map((h) => h.tenants.length).join(", ")} leases)`);
  const vals = hs.map((h) => E.ownedHoldingValue(g, p, h));
  const ltvs = hs.map((h) => (h.loan?.balance ?? 0) / h.costBasis);
  check(ltvs.every((x) => x <= 0.36), `family leverage ≤ 35% at the transfer (${ltvs.map((x) => (x * 100).toFixed(0) + "%").join(", ")})`);
  check(hs.some((h) => h.loan), `real paper on at least one (${hs.filter((h) => h.loan).map((h) => `${E.productById(h.loan.product).lender} ${h.loan.ratePct}%`).join("; ")})`);
  const deps = hs.reduce((a, h) => a + h.tenants.reduce((b, t) => b + (t.deposit ?? 0), 0), 0);
  check(Math.abs(g.cash - (base.cash + deps)) < 1, `no cash was spent: ${M(g.cash)} = ${M(base.cash)} + ${M(deps)} of tenant deposits held`);
  check(Object.values(g.books?.at(-1) ?? {}).every((v, i) => i === 0 || v === 0 || true) && (g.books?.at(-1)?.bought ?? 0) === 0,
    `nothing booked to bought — the deeds came in kind`);
  check(hs.every((h) => g.deedCf?.[h.bbl]?.cf?.[1] < 0), `the deed ledger opens with the contributed equity in`);
  check(g.nwHistory[0] > g.cash, `net worth opens at ${M(g.nwHistory[0])}, over the cash`);
  check(hs.every((h) => !g.rivals.some((r) => r.bbls.includes(h.bbl))), `no deed is also a rival's`);
  const listed = new Set(g.listings.map((l) => l.bbl));
  check(hs.every((h) => !listed.has(h.bbl)), `none of them is on the tape`);
  // home tier: the core sits at better locations than the edge
  const ds = (setup) => { const { g: x, p: q } = start(73303, setup); const v = Object.keys(x.holdings).map((b) => q[b].demandScore); return v.reduce((a, b) => a + b, 0) / Math.max(1, v.length); };
  const core = ds({ inherit: 2, home: "core" }), edge = ds({ inherit: 2, home: "edge" });
  check(core > edge, `home core sits at better locations than the edge (demand ${core.toFixed(0)} vs ${edge.toFixed(0)})`);
  // CONSERVATION on the inherited book: the identity conserve.mjs asserts.
  const IN = ["noi", "sold", "interest", "borrowed", "lpCalled"], OUT = ["debtSvc", "leasing", "capex", "dev", "taxes", "bought", "ga", "lpDistributed"];
  const tot = (x) => { const t = {}; for (const k of [...IN, ...OUT]) t[k] = 0; for (const y of x.books ?? []) for (const k of [...IN, ...OUT]) t[k] += y[k] ?? 0; return t; };
  const dep = (x) => Object.values(x.holdings).reduce((a, h) => a + h.tenants.reduce((b, t) => b + (t.deposit ?? 0), 0), 0);
  let x = g, worst = 0, moved = new Set();
  for (let m = 0; m < 60; m++) {
    const b0 = tot(x), c0 = x.cash + (x.fund?.cash ?? 0), l0 = x.loc?.balance ?? 0, d0 = dep(x);
    x = E.advanceMonth(x, p, bbls, adjacency);
    const b1 = tot(x);
    const books = IN.reduce((a, k) => a + b1[k] - b0[k], 0) - OUT.reduce((a, k) => a + b1[k] - b0[k], 0);
    for (const k of [...IN, ...OUT]) if (b1[k] !== b0[k]) moved.add(k);
    const r = (x.cash + (x.fund?.cash ?? 0) - c0) - books - ((x.loc?.balance ?? 0) - l0) - (dep(x) - d0);
    worst = Math.max(worst, Math.abs(r));
  }
  check(worst < 1000, `60 months on the family book reconcile (worst residual $${worst.toFixed(0)}; moved: ${[...moved].join(", ")})`);
  check(moved.has("noi") && moved.has("debtSvc"), `and the book is live: rent in, debt service out`);
}

// -------------------------------------------------------------- 6. sandbox
{
  const { g, p } = start(550991, { sandbox: true }, 2_500_000);
  check(g.cash === E.SANDBOX_CASH && g.setup.sandbox, `sandbox opens at ${M(g.cash)} and is flagged on the save`);
  let x = { ...g, cash: -50_000_000 };
  for (let m = 0; m < 30; m++) x = E.advanceMonth(x, p, bbls, adjacency);
  check(!x.gameOver && x.insolventMs === 0, `sandbox: thirty months $50M overdrawn and no creditor, no end (${M(x.cash)})`);
  const y = E.advanceMonth({ ...g, month: 899 }, p, bbls, adjacency);
  check(Object.keys(y.milestones).length === 0, `sandbox: no milestones (75 years passed, none awarded)`);
  const z = E.advanceMonth({ ...start(550991).g, month: 899 }, p, bbls, adjacency);
  check(Object.keys(z.milestones).length > 0, `control: the same clock in a real run awards one (${Object.keys(z.milestones).join(", ")})`);
}

// ---------------------------------------------------------- 7. the clock
{
  // the first seed from 73303 whose inherited deeds include a let building —
  // the tenant-notice check below needs a tenant to give notice
  let seed7 = 73303, g, p;
  for (;; seed7++) {
    ({ g, p } = start(seed7, { inherit: 2 }));
    if (Object.values(g.holdings).some((h) => h.tenants?.length && !h.groundLeased)) break;
    if (seed7 > 73403) throw new Error("no inherited let building in 100 seeds");
  }
  const li = g.listings[0];
  const watchNow = (s) => ({ ...s, watch: [li.bbl] });
  const stopStd = E.stopRule(g, p), stopMoney = E.stopRule({ ...g, clockStops: "money" }, p), stopAll = E.stopRule({ ...g, clockStops: "everything" }, p);
  check(stopStd(watchNow(g))?.key.startsWith("watch:") && !stopMoney(watchNow({ ...g, clockStops: "money" })),
    `"what can cost money" lets a watched listing wait; the standard clock stops for it`);
  const h0 = Object.values(g.holdings).find((h) => h.tenants?.length && !h.groundLeased);
  const soft = structuredClone(g);
  const hs = soft.holdings[h0.bbl];
  if (hs.tenants[0]) hs.tenants[0].nonRenewM = soft.month;
  check(!!hs.tenants[0] && !stopStd(soft) && stopAll({ ...soft, clockStops: "everything" })?.key.startsWith("nonrenew:"),
    `"everything" stops for a tenant's notice; the standard clock does not`);
  const { g: c } = start(550991, { clock: "money" });
  check(c.clockStops === "money", `the setup's clock lands on the save (clockStops ${c.clockStops})`);
}

// -------------------------------------------------------------- 8. the firm
{
  const { g } = start(550991, { firmName: "Heines Capital Partners" });
  check(g.firm.name === "Heines Capital Partners" && g.firm.short === "Heines", `firm name ${g.firm.name} (${g.firm.short} in the paper)`);
  check(E.normalizeSetup({ era: "zirp", credit: "tight", inherit: 7 }).era === "random", `any named era normalises to random`);
  check(!/after the crash|inflation|expansion|disinflation|morning/i.test(E.describeSetup(E.normalizeSetup({ era: "zirp", credit: "tight", inherit: 2 }), "zirp")), `the record line never names the era`);
}

console.log(bad ? `\n${bad} FAILED` : "\nall clear");
process.exit(bad ? 1 : 0);
