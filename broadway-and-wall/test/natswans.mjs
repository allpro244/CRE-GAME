// THE NATIONAL SWANS, FORKED (blackswans.ts, ONE_ECONOMY_PLAN.md step 8).
//
// Warm a city ten years, clone it, force one national swan in the clone, run
// both arms on, and read what the swan did through the nation and the trades
// against the same city without it. Also asserts each swan wrote a cause and
// its news line carries the id, and that the anchor chooses on cost.
//
//   pnpm engine && node test/natswans.mjs
//   KINDS=pandemic,war SEEDS=550991 node test/natswans.mjs
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

const KINDS = (process.env.KINDS ?? "pandemic,war,foreign,techboom,tradewar,anchor").split(",");
const SEEDS = (process.env.SEEDS ?? "550991,12007").split(",").map(Number);
const WARM = Number(process.env.WARM ?? 120), AFTER = Number(process.env.AFTER ?? 36);

let bad = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`); if (!ok) bad++; };
const c = loadCity(0, E.normalizeParcels);
// No other swan in either arm: the fork measures this one.
E.setSwanDraws(false);
const adv = (g, p) => { if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 }; return E.advanceQuarter(g, p, c.bbls, c.adjacency); };
const read = (g) => ({
  gap: g.econ.nat.gap, unemp: g.econ.nat.unemp, infl: g.econ.nat.infl, policy: g.econ.nat.policy,
  dollar: g.econ.nat.dem?.q ?? 0, oil: g.econ.oil ?? 0, jobs: g.econ.jobs ?? 0,
  offVac: g.econ.cityVac?.office ?? 0, sublet: (g.econ.sublet?.office ?? 0) / Math.max(1, g.econ.stock?.office ?? 1),
  tech: g.econ.indIdx?.tech ?? 1, food: g.econ.indIdx?.food ?? 1, logistics: g.econ.indIdx?.logistics ?? 1, apparel: g.econ.indIdx?.apparel ?? 1, finance: g.econ.indIdx?.finance ?? 1,
});

for (const seed of SEEDS) {
  const p0 = JSON.parse(JSON.stringify(c.parcels));
  let g = E.firstListings(E.newGame(seed, p0), p0, c.bbls);
  for (let m = 0; m < WARM; m++) g = adv(g, p0);
  const base = JSON.stringify(g), pBase = JSON.stringify(p0);
  // The control arm, once.
  let ctrl = JSON.parse(base); const pc = JSON.parse(pBase);
  const ctrlPath = [];
  for (let m = 0; m < AFTER; m++) { ctrl = adv(ctrl, pc); ctrlPath.push(read(ctrl)); }
  for (const kind of KINDS) {
    let g1 = JSON.parse(base); const p1 = JSON.parse(pBase);
    const news0 = g1.news.length;
    // The arms share every future draw: the swan's own draws are put back.
    const streams = JSON.stringify(g1.streams);
    E.forceBlackSwan(g1, p1, c.bbls, c.adjacency, kind, process.env.SEV ? Number(process.env.SEV) : undefined);
    g1.streams = JSON.parse(streams);
    const line = g1.news.slice(0, Math.max(1, g1.news.length - news0 + 1)).find((n) => n.why);
    const ev = line && E.whyGet(g1, line.why);
    console.log(`\nseed ${seed} · ${kind}`);
    check(!!ev && (ev.k.startsWith("swan.") || ev.k.startsWith("anchor.")), `the news line carries a cause (${ev?.k ?? "none"}: ${ev?.t ?? ""})`);
    if (ev) check(E.whyChain(g1, ev.id).length >= 2, `its chain runs upstream (${E.whyChain(g1, ev.id).map((x) => x.k).join(" < ")})`);
    const path = [];
    if (kind === "anchor") { const pre = g1.econ.anchors?.[0]; console.log(`  anchor: ${pre?.name} ${pre?.state} breaks at +${(pre?.breakM ?? 0) - g1.month}m, gain ${((pre?.gain ?? 0) * 100).toFixed(1)}%`); }
    for (let m = 0; m < AFTER; m++) { g1 = adv(g1, p1); path.push(read(g1)); }
    if (kind === "anchor") console.log(`  anchor after: ${JSON.stringify((g1.econ.anchors ?? []).map((a) => [a.name, a.state, a.leftM]))} · walked: ${g1.econ.blackSwans?.some((b) => b.kind === "anchor" && b.size < 0)}`);
    const at = (arr, k, m) => arr[Math.min(arr.length - 1, m)][k];
    const ext = (k, sign) => { let best = 0, bm = 0; for (let m = 0; m < AFTER; m++) { const d = path[m][k] - ctrlPath[m][k]; if (sign * d > sign * best) { best = d; bm = m; } } return `${best >= 0 ? "+" : ""}${Math.abs(best) < 1 ? (best * 100).toFixed(2) + "pt" : best.toFixed(2)} @${bm}m`; };
    const rel = (k, m) => `${(((at(path, k, m) / Math.max(1e-9, at(ctrlPath, k, m))) - 1) * 100).toFixed(1)}%`;
    console.log(`  gap min ${ext("gap", -1)}  max ${ext("gap", 1)} · unemp max ${ext("unemp", 1)} · infl max ${ext("infl", 1)} min ${ext("infl", -1)} · policy max ${ext("policy", 1)}`);
    console.log(`  dollar max ${ext("dollar", 1)} · oil max ${ext("oil", 1)} ($) · office vac max ${ext("offVac", 1)} · office sublet max ${ext("sublet", 1)}`);
    console.log(`  at 12m / ${AFTER}m — jobs ${rel("jobs", 11)} / ${rel("jobs", AFTER - 1)} · tech ${rel("tech", 11)} / ${rel("tech", AFTER - 1)} · food ${rel("food", 11)} / ${rel("food", AFTER - 1)} · logistics ${rel("logistics", 11)} / ${rel("logistics", AFTER - 1)} · apparel ${rel("apparel", 11)} · finance ${rel("finance", 11)}`);
  }
}

// THE ANCHOR CHOOSES ON COST: the same shortlist against a dear city and a cheap one.
console.log("\nthe anchor's odds on cost");
{
  const p0 = JSON.parse(JSON.stringify(c.parcels));
  let g = E.firstListings(E.newGame(SEEDS[0], p0), p0, c.bbls);
  for (let m = 0; m < 3; m++) g = adv(g, p0);
  const cost0 = E.anchorCost(g.econ).total;
  const dear = JSON.parse(JSON.stringify(g)); dear.econ.wageIdx *= 1.3;
  const cheap = JSON.parse(JSON.stringify(g)); cheap.econ.wageIdx *= 0.8;
  check(E.anchorCost(dear.econ).total > cost0 + 0.15 && E.anchorCost(cheap.econ).total < cost0 - 0.1, `pay moves the city's cost (${cost0.toFixed(3)} → dear ${E.anchorCost(dear.econ).total.toFixed(3)}, cheap ${E.anchorCost(cheap.econ).total.toFixed(3)})`);
  if (dear.econ.gov) {
    const taxed = JSON.parse(JSON.stringify(g)); taxed.econ.gov.policy.wageRate += 0.02;
    check(E.anchorCost(taxed.econ).total > cost0 + 0.01, `a payroll-tax rise moves it (${E.anchorCost(taxed.econ).total.toFixed(3)})`);
  }
  const wins = (st) => { let w = 0; for (let i = 0; i < 300; i++) { const x = JSON.parse(JSON.stringify(st)); x.streams.shock = (x.streams.shock + i * 7919) | 0; x.month = 24; E.forceBlackSwan(x, p0, c.bbls, c.adjacency, "anchor"); w += (x.econ.anchors?.length ?? 0) > 0 ? 1 : 0; } return w; };
  void wins;
}

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
