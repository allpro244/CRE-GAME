// Player-held notes: buy every note the desks offer, then count what happens to them,
// and read each building's own coverage (NOI over coupon) at the moment it stops paying.
import { pathToFileURL } from "url"; import { join } from "path";
const ROOT = process.argv[2], SEED = Number(process.argv[3] ?? 11), YEARS = Number(process.argv[4] ?? 25);
const E = await import(pathToFileURL(join(ROOT, "test", ".engine.mjs")).href);
const { makeCity } = await import(pathToFileURL(join(ROOT, "src", "citygen", "index.mjs")).href);
const city = makeCity("somewhere", 1); E.normalizeParcels(city.parcels); const P = city.parcels, bbls = Object.keys(P);
let g = E.firstListings(E.newGame(SEED, P, 2_000_000_000), P, bbls);
const kinds = { bought: 0, "repaid at maturity": 0, "stopped paying": 0, "could not repay": 0, reinstated: 0, "paid off": 0, "repaid on sale": 0, keys: 0 };
const covAtDefault = [], seen = new Set();
for (let m = 1; m <= YEARS * 12; m++) {
  for (const o of [...(g.noteOffers ?? [])]) { if (o.expiresM < g.month) continue; const b = E.buyNote(g, P, o.id); if (!b.err) { g = b.s; kinds.bought++; } }
  const before = new Map((g.notes ?? []).map((n) => [n.id, n.perf]));
  g = E.advanceMonth(g, P, bbls, city.adjacency);
  if (g.gameOver) g = { ...g, gameOver: null, cash: 2e9 };
  for (const x of g.news ?? []) {
    if (x.q !== g.month || seen.has(x.text)) continue; seen.add(x.text);
    const t = x.text;
    if (t.startsWith("Note repaid at maturity")) kinds["repaid at maturity"]++;
    else if (t.includes("has stopped paying on")) kinds["stopped paying"]++;
    else if (t.includes("could not repay the loan")) kinds["could not repay"]++;
    else if (t.startsWith("Loan reinstated")) kinds.reinstated++;
    else if (t.startsWith("Note paid off")) kinds["paid off"]++;
    else if (t.startsWith("Note repaid on sale")) kinds["repaid on sale"]++;
    else if (/keys|deed in lieu|handed you/i.test(t)) kinds.keys++;
  }
  for (const n of g.notes ?? []) if (before.get(n.id) === "performing" && n.perf === "nonperforming") {
    const r = (g.rivals ?? []).find((x) => x.id === n.obligorId); const rec = E.resolveRec(P, g, n.bbl);
    if (r && rec && r.failedM === undefined) { const a = E.markAsset(g, r, rec); covAtDefault.push((a.noi / 12) / Math.max(1, n.face * n.ratePct / 1200)); }
  }
}
const q = (a, p) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(p * (b.length - 1))].toFixed(2) : "—"; };
console.log(JSON.stringify(kinds));
console.log(`building NOI / coupon when it stopped paying (n ${covAtDefault.length}): p10 ${q(covAtDefault,.1)} p50 ${q(covAtDefault,.5)} p90 ${q(covAtDefault,.9)}; share covering the coupon ${covAtDefault.length ? (100 * covAtDefault.filter((x) => x >= 1).length / covAtDefault.length).toFixed(0) : "—"}%`);
