// FIRMS RUN BY AN OUTSIDE AI — the plug-in, held to the engine's rules.
//
//   pnpm engine && node test/ai-firms.mjs
//
// A deterministic mock provider stands in for the outside model. What is
// asserted, and why each can fail:
//
//   1. THE NO-AI PATH IS UNTOUCHED. A run that exercises every AI entry point
//      without an AI firm on the street (turn checks, the controller, a brief
//      read off a scripted firm, orders addressed to a scripted firm) hashes
//      identically to a plain run. Reading a brief must not move the world.
//   2. AN AI ORDER IS A STREET ACTION. An AI `buy` leaves the firm's cash,
//      debt, basis and deeds exactly where `rivalBuys` with that firm as the
//      named bidder leaves them.
//   3. REFUSALS COST NOTHING. Unaffordable, not listed, illegal zoning, not
//      owned, over-priced ask, malformed: the world hashes the same before and
//      after, bar the turn record.
//   4. THE BOOKS BALANCE. Every ledger entry satisfies its identity
//      (buy: Δcash−Δdebt = −(price+closing); sale: = price−tax; refi: = −fee;
//      paydown: 0; develop: = −equity) AND the entries' measured deltas are the
//      firm's actual balance-sheet movement around each apply.
//   5. DETERMINISM. Two matches with the same scripted players are identical.
//   6. THE BRIEF FITS. Under AI_BRIEF_CAP for small and large books.
//   7. THE WIRE. Replies are parsed out of fences and prose; a failing
//      provider is retried once, then the firm holds and the error is filed.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);

let bad = 0, n = 0;
const check = (ok, msg) => { n++; console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`); if (!ok) bad++; };
const hash = (g) => {
  const s = JSON.stringify(g);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16) + ":" + s.length;
};
const without = (g, ...keys) => { const c = { ...g }; for (const k of keys) delete c[k]; return c; };
const fresh = (seed = 12007) => E.firstListings(E.newGame(seed, parcels, 2_500_000), parcels, bbls);
const step = (g) => { const x = E.advanceMonth(g, parcels, bbls, adjacency); return x.gameOver ? { ...x, gameOver: null, cash: 6e6 } : x; };

console.log("\nAI FIRMS — the outside-AI plug-in runs through the street's own machinery\n");

// 1 ------------------------------------------------------------------------
{
  const M = 48;
  let a = fresh(), b = fresh();
  const scripted = b.rivals.find((r) => r.failedM === undefined && r.bbls.length > 3).id;
  for (let m = 0; m < M; m++) {
    a = step(a);
    if (m % 3 === 0) {
      const h0 = hash(b);
      E.aiBrief(b, parcels, scripted);
      if (hash(b) !== h0) { check(false, `reading a brief mutated the state at month ${b.month}`); break; }
      if (E.aiTurnDue(b)) check(false, "a turn was due with no AI firm on the street");
      b = await E.runAiTurn(b, parcels, {});
      const r = E.applyAiOrders(b, parcels, scripted, [{ action: "hold" }]);
      if (r.s !== b || r.results[0].ok) check(false, "orders addressed to a scripted firm were not refused untouched");
      b = E.stampAiHistory(b, parcels);
    }
    b = step(b);
  }
  check(hash(a) === hash(b), `no AI firm: ${M} months with every AI entry point exercised hash identically to a plain run (${hash(a)})`);
  check(!("aiBooks" in b) && !("aiTurns" in b) && !("aiHistory" in b), "and leave no AI fields on the state");
}

// 2 ------------------------------------------------------------------------
let g0 = E.createAiFirms(fresh(), [{ name: "Probe Capital", provider: "mock" }], 25_000_000);
const id = E.aiFirmIds(g0)[0];
{
  const brief = E.aiBrief(g0, parcels, id);
  const pick = brief.tape.find((t) => t.ask < 8_000_000);
  check(!!pick, `the brief shows a buyable listing (${brief.tape.length} on the tape)`);
  const { s: viaAi, results } = E.applyAiOrders(g0, parcels, id, [{ action: "buy", bbl: pick.bbl, maxPrice: pick.ask, leverage: 0.55 }]);
  check(results[0].ok, `AI buy accepted: ${results[0].reason}`);
  // The same close, by the street's own function, on a copy.
  const direct = structuredClone(g0);
  const r = direct.rivals.find((x) => x.id === id);
  const rec = E.resolveRec(parcels, direct, pick.bbl);
  const was = r.targetLtv; r.targetLtv = 0.55;
  const buyer = E.rivalBuys(direct, parcels, rec, pick.ask, r, "a private owner");
  r.targetLtv = was;
  const a = viaAi.rivals.find((x) => x.id === id);
  check(buyer === r && a.cash === r.cash && a.debt === r.debt && a.basis === r.basis
    && JSON.stringify(a.bbls) === JSON.stringify(r.bbls),
  `identical to rivalBuys: cash ${a.cash} = ${r.cash}, debt ${a.debt} = ${r.debt}, basis ${a.basis} = ${r.basis}`);
  check(!viaAi.listings.some((l) => l.bbl === pick.bbl), "and the listing is off the tape");
  const comp = (viaAi.comps ?? []).at(-1);
  check(comp && comp.bbl === pick.bbl && comp.price === pick.ask, "and the trade is on the comps sheet at the ask");
}

// 3 ------------------------------------------------------------------------
{
  let g = E.createAiFirms(fresh(), [{ name: "Thin Capital", provider: "mock", cash: 150_000 }], 25_000_000);
  const tid = E.aiFirmIds(g).find((x) => x.startsWith("ai:thin"));
  // A vacant residential-zone lot for the zoning refusal, handed to the firm.
  const owned = new Set(g.rivals.flatMap((r) => r.bbls));
  const rlot = Object.values(parcels).find((p) => p.class === "land" && p.zoneDist?.[0] === "R" && !owned.has(p.bbl) && p.lotArea >= 5000);
  const t = g.rivals.find((x) => x.id === tid);
  if (rlot) t.bbls.push(rlot.bbl);
  const big = g.listings.find((l) => l.ask > 2_000_000);
  const notListed = Object.keys(parcels).find((b) => !g.listings.some((l) => l.bbl === b));
  const someoneElses = g.rivals.find((r) => !r.aiControlled && r.bbls.length).bbls[0];
  const orders = [
    { action: "buy", bbl: big.bbl, maxPrice: big.ask, leverage: 0.75 },   // cannot fund
    { action: "buy", bbl: notListed, maxPrice: 1e9 },                     // not on the tape
    { action: "buy", bbl: big.bbl, maxPrice: big.ask - 1 },               // over the limit
    ...(rlot ? [{ action: "develop", bbl: rlot.bbl, use: "office", floors: 3 }] : []), // zoning
    { action: "sell", bbl: someoneElses },                                // not owned
    ...(rlot ? [{ action: "sell", bbl: rlot.bbl, minPrice: 1e10 }] : []), // absurd ask
    { action: "refinance", bbl: someoneElses },
    { action: "paydown", amount: 1e6 },                                   // no debt
    { action: "teleport" }, { foo: 1 }, "buy everything",                 // malformed
  ];
  const before = hash(without(g, "aiTurns"));
  const { s, results } = E.applyAiOrders(g, parcels, tid, orders);
  const refused = results.filter((r) => !r.ok).length;
  check(refused === orders.length, `${refused} of ${orders.length} bad orders refused`);
  for (const r of results) console.log(`          ${JSON.stringify(r.order).slice(0, 70).padEnd(70)} → ${r.reason.slice(0, 90)}`);
  check(hash(without(s, "aiTurns")) === before, "and the world is exactly where it was (only the turn record changed)");
  check(!!rlot && /Zoned R/.test(results[3].reason), "the zoning refusal quotes the district's rule");
  check(s.aiTurns.at(-1).results.length === orders.length, "the turn is filed with a verdict per order");
}

// 4 & 5 ---------------------------------------------------------------------
async function match(months, seed = 12007) {
  let g = E.createAiFirms(fresh(seed), [
    { name: "Yield Mock", provider: "mock" }, { name: "Builder Mock", provider: "mock" },
    { name: "Contrarian Mock", provider: "mock" }, { name: "Hold Mock", provider: "mock" },
  ], 25_000_000);
  const styles = { "ai:yield-mock": "yield", "ai:builder-mock": "builder", "ai:contrarian-mock": "contrarian", "ai:hold-mock": "hold" };
  const cfg = Object.fromEntries(Object.entries(styles).map(([k, v]) => [k, { kind: "mock", script: E.mockPlayers[v] }]));
  // Add a scripted seller every year so sales and refinancings are exercised.
  const seller = {
    kind: "mock",
    script: (b) => {
      const inc = b.holdings.filter((h) => h.sf > 0 && !h.listed && !h.building);
      const orders = [];
      if (b.month % 12 === 6 && inc.length) orders.push({ action: "sell", bbl: inc[0].bbl });
      if (b.month % 12 === 9 && inc.length > 1) orders.push({ action: "refinance", bbl: inc[inc.length - 1].bbl });
      if (b.month % 24 === 15 && b.firm.debt > 1e6) orders.push({ action: "paydown", amount: 500_000 });
      return { reasoning: "test seller", orders: [...orders, ...E.mockPlayers.yield(b).orders] };
    },
  };
  cfg["ai:yield-mock"] = seller;
  let deltasOk = true;
  for (let m = 0; m < months; m++) {
    if (E.aiTurnDue(g)) {
      const pre = Object.fromEntries(g.rivals.filter((r) => r.aiControlled).map((r) => [r.id, { cash: r.cash, debt: r.debt, n: (g.aiBooks?.[r.id] ?? []).length }]));
      g = await E.runAiTurn(g, parcels, cfg);
      for (const r of g.rivals.filter((x) => x.aiControlled)) {
        const es = (g.aiBooks?.[r.id] ?? []).slice(pre[r.id].n);
        const sc = es.reduce((a, e) => a + e.cashDelta, 0), sd = es.reduce((a, e) => a + e.debtDelta, 0);
        if (Math.abs(r.cash - pre[r.id].cash - sc) > 0.5 || Math.abs(r.debt - pre[r.id].debt - sd) > 0.5) {
          deltasOk = false;
          console.log(`   ${r.id} m${g.month}: Δcash ${r.cash - pre[r.id].cash} vs entries ${sc}; Δdebt ${r.debt - pre[r.id].debt} vs ${sd}`);
        }
      }
    }
    g = step(g);
  }
  return { g, deltasOk };
}
{
  const { g, deltasOk } = await match(96);
  const all = Object.values(g.aiBooks ?? {}).flat();
  const kinds = {};
  let broken = 0;
  for (const e of all) {
    kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
    const net = e.cashDelta - e.debtDelta;
    const want = e.kind === "buy" ? -(e.amount + (e.closing ?? 0))
      : e.kind === "sale" ? e.amount - (e.tax ?? 0)
        : e.kind === "refi" ? -(e.closing ?? 0)
          : e.kind === "develop" ? -e.amount : 0;
    if (Math.abs(net - want) > 1) { broken++; if (broken < 5) console.log("   ", JSON.stringify(e)); }
  }
  console.log(`          ledger: ${Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  check(all.length > 10 && broken === 0, `every one of ${all.length} ledger entries satisfies its identity`);
  check(["buy", "sale", "refi", "paydown"].every((k) => kinds[k] > 0), "and buys, sales, refinancings and paydowns were all exercised");
  check(deltasOk, "and each turn's entries sum to the firms' actual cash and debt movement");
  const st = E.aiStandings(g, parcels);
  console.log(`          after 8 years: ${st.map((x) => `${x.name} ${(x.equity / 1e6).toFixed(1)}M/${x.buildings}b`).join(" · ")}`);
  check(st.some((x) => x.buildings > 0), "AI firms own buildings at the end");
  check((g.aiHistory ?? []).length >= 30, `quarterly marks filed for the match chart (${(g.aiHistory ?? []).length})`);
  const again = await match(96);
  check(hash(again.g) === hash(g), "two matches with the same scripted players are identical");
}

// 4b — a groundbreak, through the scripted developers' own breakGround ------
{
  let g = E.createAiFirms(fresh(), [{ name: "Crane Capital", provider: "mock" }], 60_000_000);
  const cid = "ai:crane-capital";
  let done = null;
  for (let y = 0; y < 12 && !done; y++) {
    const owned = new Set([...g.rivals.flatMap((r) => r.bbls), ...Object.keys(g.holdings), ...g.listings.map((l) => l.bbl), ...(g.cityJobs ?? []).map((j) => j.bbl)]);
    const lots = Object.values(parcels).filter((p) => (g.built?.[p.bbl]?.class ?? p.class) === "land" && !owned.has(p.bbl) && p.lotArea >= 5000)
      .sort((a, b) => b.demandScore - a.demandScore).slice(0, 6);
    const probe = structuredClone(g);
    const firm = probe.rivals.find((r) => r.id === cid);
    firm.bbls.push(...lots.map((p) => p.bbl));
    const brief = E.aiBrief(probe, parcels, cid);
    for (const site of brief.sites) {
      const opt = site.options.find((o) => o.pencils && o.demandWaiting);
      if (!opt) continue;
      const before = { cash: firm.cash, debt: firm.debt, jobs: (probe.cityJobs ?? []).length };
      const { s, results } = E.applyAiOrders(probe, parcels, cid, [{ action: "develop", bbl: site.bbl, use: opt.use, floors: opt.maxFloors }]);
      done = { s, r: results[0], before, bbl: site.bbl, y };
      break;
    }
    for (let m = 0; m < 12; m++) g = step(g);
  }
  check(!!done && done.r.ok, done ? `develop accepted in year ${done.y}: ${done.r.reason}` : "no penciling site found in twelve years to test a groundbreak");
  if (done?.r.ok) {
    const job = done.s.cityJobs.find((j) => j.bbl === done.bbl);
    const e = done.s.aiBooks[cid].at(-1);
    const f = done.s.rivals.find((r) => r.id === cid);
    check(!!job && job.firmId === cid && job.spent === e.amount, "the job is on the city's books in the firm's name, day-one equity spent");
    check(f.cash === done.before.cash - e.amount && e.cashDelta === -e.amount, "and the ledger entry is the cash that left");
  }
}

// 6 ------------------------------------------------------------------------
{
  let g = fresh();
  const biggest = [...g.rivals].sort((a, b) => b.bbls.length - a.bbls.length)[0];
  g = E.convertToAi(g, biggest.id, "mock");
  let max = 0;
  for (let m = 0; m < 36; m++) {
    if (m % 6 === 0) max = Math.max(max, JSON.stringify(E.aiBrief(g, parcels, biggest.id)).length);
    g = step(g);
  }
  check(max < E.AI_BRIEF_CAP, `brief for the street's largest book (${biggest.bbls.length} deeds) peaks at ${max} chars < ${E.AI_BRIEF_CAP}`);
  check(!g.rivalPrincipals?.[biggest.id], "a converted firm's principal steps back");
}

// 7 ------------------------------------------------------------------------
{
  const p = E.parseAiReply;
  check(p('Sure!\n```json\n{"reasoning":"r","orders":[{"action":"hold"}]}\n```\nGood luck').orders.length === 1, "parses fenced JSON inside prose");
  check(p('I think {"reasoning": "has } brace", "orders": []} is right').reasoning === "has } brace", "parses embedded JSON with a brace inside a string");
  check(p({ orders: [{ action: "hold" }] }).orders.length === 1, "accepts an object");
  let threw = false; try { p("no json here"); } catch { threw = true; }
  check(threw, "refuses a reply with no JSON");
  let g = E.createAiFirms(fresh(), [{ name: "Flaky", provider: "mock" }]);
  let calls = 0;
  g = await E.runAiTurn(g, parcels, { "ai:flaky": { kind: "mock", script: () => { calls++; throw new Error("503 upstream"); } } });
  const t = g.aiTurns.at(-1);
  check(calls === 2 && /503/.test(t.error ?? "") && t.results.length === 0, `a failing provider is retried once (${calls} calls), then the firm holds with the error filed`);
  const budget = { used: 0, max: 0 };
  g = E.createAiFirms(fresh(), [{ name: "Capped", provider: "mock" }]);
  g = await E.runAiTurn(g, parcels, { "ai:capped": { kind: "mock", script: () => { throw new Error("should not be called"); } } }, { budget });
  check(/budget/.test(g.aiTurns.at(-1).error ?? ""), "the run budget guard holds a firm without calling out");
}

console.log(`\n${bad ? `${bad} of ${n} FAILED` : `all ${n} checks passed`}\n`);
process.exit(bad ? 1 : 0);
