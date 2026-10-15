// RIVAL ENTRY READS THE INVESTOR POOL — on by default, a setup choice.
//   pnpm engine && node test/pool-entry.mjs
//
// CAPITAL_RAISING_PLAN.md §0.5 5.5. Off, a new firm's entry is
// exactly what it was. On (the default), a first close comes out of the city's local and
// family-office money: entry slows when this year's has gone, a firm never
// raises more than is left, and a player who has raised the city dry keeps
// new competitors out that year.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels: P0, bbls, adjacency } = loadCity(0, E.normalizeParcels);

let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? "OK  " : "FAIL"}  ${m}`); if (!c) fails++; };
const run = (seed, months, setup) => {
  const parcels = JSON.parse(JSON.stringify(P0));
  let g = E.firstListings(E.newGame(seed, parcels, 2_500_000, setup), parcels, bbls);
  const hooks = [];
  for (let m = 0; m < months; m++) {
    const n0 = g.rivals.length;
    g = E.advanceMonth(g, parcels, bbls, adjacency);
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
    hooks.push({ m: g.month, born: g.rivals.length - n0, pool: g.investorPool ? { ...g.investorPool, cap: { ...g.investorPool.cap }, used: { ...g.investorPool.used } } : null });
  }
  return { g, hooks };
};
const firmsHash = (g) => createHash("sha256").update(JSON.stringify(g.rivals.map((r) => [r.id, r.name, r.bornM, Math.round(r.cash)]))).digest("hex").slice(0, 16);

console.log("\nOff: new firms raise from money that never runs out");
{
  const b = run(7101, 120, { poolEntry: false });
  ok(!b.g.poolEntry && !(b.g.poolBindMs > 0), `turned off, the pool never slows entry (${b.g.rivals.length} firms, ${firmsHash(b.g)})`);
}

console.log("\nOn (the default): one capital market");
{
  const { g, hooks } = run(7101, 240);
  let over = 0;
  for (const h of hooks) if (h.pool) for (const id of ["local", "family"]) if ((h.pool.used[id] ?? 0) > (h.pool.cap[id] ?? 0) + 1) over++;
  console.log(`  ${g.rivals.length} firms after 20 years · the pool slowed entry in ${g.poolBindMs ?? 0} months`);
  ok(g.poolEntry === true, "a new game runs on one capital market");
  ok(over === 0, "no year's local or family-office money is ever overdrawn");
  ok((g.poolBindMs ?? 0) > 0, "and a thin pool does slow new firms");
}

console.log("\nA city raised dry keeps new firms out");
{
  const parcels = JSON.parse(JSON.stringify(P0));
  let g = E.firstListings(E.newGame(7102, parcels, 2_500_000, { poolEntry: true }), parcels, bbls);
  let born = 0;
  for (let m = 0; m < 120; m++) {
    // Somebody (the player) has raised every dollar of the year's money.
    const p = E.investorPool(g);
    for (const id of Object.keys(p.cap)) p.used[id] = p.cap[id];
    const ids = new Set(g.rivals.map((r) => r.id));
    g = E.advanceMonth(g, parcels, bbls, adjacency);
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
    // Only firms born from a raise (a first close leaves uncalled commitments);
    // an heir inheriting an estate or a family split raises nothing. A pool
    // reopened in January can fund one in that month.
    if (g.month % 12 !== 0) born += g.rivals.filter((r) => !ids.has(r.id) && r.uncalled !== undefined).length;
  }
  ok(born === 0, `with the money gone, no first close clears (${born} new firms in ten years)`);
}

console.log(fails ? "\nFAIL" : "\nPASS — off it is the old street; on, new firms raise from the money that is there");
process.exit(fails ? 1 : 0);
