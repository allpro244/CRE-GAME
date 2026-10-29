// THE CAUSE LEDGER (engine/why.ts, ONE_ECONOMY_PLAN §6e).
//
//   1. the ledger API: events, once-a-month upstream events, chains, trimming;
//   2. writing to it draws no random numbers and changes nothing else in the world;
//   3. in play, a tenant leaving one of your buildings carries a "Why?" chain
//      that runs tenant -> its books -> its trade's month -> the nation's month;
//   4. the ledger stays bounded.
//
//   pnpm engine && node test/why.mjs
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

let bad = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`); if (!ok) bad++; };

// ---- 1. the API on a bare state ------------------------------------------------
console.log("\n1. the ledger");
{
  const s = { month: 10, econ: { nat: { gap: -0.03, unemp: 0.07, policy: 1.5, infl: 2 }, industryMom: { tech: -0.02 } } };
  const t1 = E.whyTrade(s, "tech");
  const t2 = E.whyTrade(s, "tech");
  check(t1 === t2, "a trade's month is written once and cited after");
  const a = E.why(s, { k: "tenant.books", t: "books" }, [t1]);
  const b = E.why(s, { k: "tenant.dark", t: "dark" }, [a]);
  const chain = E.whyChain(s, b);
  check(chain.map((e) => e.k).join(">") === "tenant.dark>tenant.books>trade.month>nation.month",
    `chain runs back to the nation (${chain.map((e) => e.k).join(" > ")})`);
  check(E.whyTree(s, b)[0].c.length === 1, "the tree holds the same causes");
  s.month = 10 + E.WHY_KEEP_MONTHS + 1;
  E.why(s, { k: "x", t: "later" });
  E.trimWhy(s);
  check(!E.whyGet(s, b) && s.why.ev.length === 1, "events past the window are trimmed");
  check(Object.keys(s.why.key).length === 0, "and the once-a-month keys that pointed at them go too");
}

// ---- 2 & 3. in play -------------------------------------------------------------
console.log("\n2-3. in play");
const { parcels, bbls, adjacency } = loadCity(0, E.normalizeParcels);
let g = E.firstListings(E.newGame(4242, parcels, 80_000_000), parcels, bbls);
let owned = 0;
for (const li of [...g.listings]) {
  const r = E.resolveRec(parcels, g, li.bbl);
  if (!r || r.class === "land" || r.class === "multifamily" || !(r.bldgArea > 8000)) continue;
  const b = E.buyListing(g, parcels, li.bbl, "cash");
  if (b.err) continue;
  g = b.s;
  if (++owned >= 6) break;
}
check(owned > 0, `owns ${owned} commercial buildings`);

// no RNG: writing causes on a copy leaves every stream where it was
{
  const c = structuredClone(g);
  const before = JSON.stringify(c.streams ?? {}) + c.rng;
  E.whyTrade(c, "tech"); E.whyNation(c);
  E.why(c, { k: "probe", t: "probe" });
  check(JSON.stringify(c.streams ?? {}) + c.rng === before, "writing to the ledger draws no random numbers");
}

let found = null;
for (let m = 0; m < 96 && !found; m++) {
  g = E.advanceMonth(g, parcels, bbls, adjacency);
  if (g.gameOver) break;
  // a tenant's departure (the banks write chains of their own — banks-compete.mjs checks those)
  found = (g.news ?? []).find((n) => n.why && E.whyChain(g, n.why).length >= 3 && E.whyChain(g, n.why).some((e) => e.k.startsWith("tenant.")));
}
check(!!found, found ? `a departure carries a chain: "${found.text.slice(0, 70)}..."` : "no departure with a chain in 8 years");
if (found) {
  const ch = E.whyChain(g, found.why);
  for (const e of ch) console.log(`        ${e.k.padEnd(18)} ${e.t}`);
  const kinds = ch.map((e) => e.k);
  check(kinds.includes("tenant.books") && kinds.includes("trade.month") && kinds.at(-1) === "nation.month",
    "the chain reaches the tenant's books, its trade and the nation");
  check(ch.every((e) => typeof e.t === "string" && e.t.length > 0 && e.t.length < 140), "every step is one short line");
}

// ---- 4. bounded -------------------------------------------------------------------
check((g.why?.ev.length ?? 0) <= E.WHY_MAX * 1.1, `ledger bounded (${g.why?.ev.length ?? 0} events)`);

console.log(bad ? `\nFAIL — ${bad} check(s)` : "\nPASS — causes are written when things happen, and the chain can be followed");
process.exit(bad ? 1 : 0);
