// THE PAPER IS A READER. engine/stories.ts mines the deed histories for the
// News tab's front page, and it is allowed to do exactly one thing: read. This
// harness holds it to that across several towns and ages of town:
//
//   - it never writes to the state (the save is byte-identical after a print);
//   - it is deterministic (two prints of one month are the same paper);
//   - no story prints a NaN, an Infinity, an "undefined" or a "null";
//   - every story that names a place names a real parcel;
//   - and, so this test can fail, a thirty-year town has a paper at all —
//     a miner that silently stopped finding stories would otherwise pass.
import { assertFreshBundle } from "./fresh.mjs";
if (!process.env.ENGINE) assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(process.env.ENGINE ? join(HERE, "..", process.env.ENGINE) : join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

const SEEDS = (process.env.SEEDS ?? "12007,550991").split(",").map(Number);
const CHECK = [1, 18, 120, 360];
let fails = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) { fails++; console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`); }
  else if (process.env.VERBOSE) console.log(`PASS  ${name}${detail ? " — " + detail : ""}`);
};
const BAD = /NaN|Infinity|undefined|null|\[object/;

const { parcels, bbls, adjacency } = loadCity(0, E.normalizeParcels);
for (const seed of SEEDS) {
  let g = E.firstListings(E.newGame(seed, parcels, 30_000_000), parcels, bbls);
  for (let m = 1; m <= CHECK[CHECK.length - 1]; m++) {
    g = E.advanceMonth(g, parcels, bbls, adjacency);
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
    // A player, crudely, so the player's own corner has something to say.
    if (m % 7 === 0 && Object.keys(g.holdings).length < 5) {
      for (const li of [...g.listings].slice(0, 6)) {
        const rec = E.resolveRec(parcels, g, li.bbl);
        if (!rec || rec.class === "land" || g.holdings[li.bbl]) continue;
        const r = E.executePurchase(g, parcels, li.bbl, li.ask, "harbor", false, 0.6);
        if (!r.err) { g = r.s; break; }
      }
    }
    if (m % 40 === 0) {
      const bbl = Object.keys(g.holdings).find((b) => !g.holdings[b].sale);
      if (bbl) {
        const rec = E.resolveRec(parcels, g, bbl);
        const r = E.listForSale(g, parcels, bbl, Math.round(E.assetValue(rec, g.econ, E.initialCondition(rec)) * 0.9));
        if (!r.err) g = r.s;
      }
    }
    for (const b of Object.keys(g.holdings)) if (g.holdings[b]?.sale?.offer) { const r = E.acceptSaleOffer(g, parcels, b); if (!r.err) g = r.s; }
    if (!CHECK.includes(m)) continue;

    const before = JSON.stringify(g);
    const a = E.writePaper(g, parcels);
    const b = E.writePaper(g, parcels);
    const tag = `seed ${seed} m${m}`;
    ok(`${tag}: state untouched`, JSON.stringify(g) === before);
    ok(`${tag}: deterministic`, JSON.stringify(a) === JSON.stringify(b));
    const ids = new Set();
    for (const s of a.stories) {
      const text = `${s.kicker} ${s.head} ${s.body} ${(s.beats ?? []).map((x) => x.text).join(" ")}`;
      ok(`${tag}: clean text ${s.id}`, !BAD.test(text), text.match(BAD)?.[0] + " in: " + text.slice(0, 160));
      ok(`${tag}: finite rank ${s.id}`, Number.isFinite(E.storyRank(s, g.month)));
      ok(`${tag}: real place ${s.id}`, !s.bbl || !!parcels[s.bbl]);
      ok(`${tag}: unique id ${s.id}`, !ids.has(s.id));
      ids.add(s.id);
    }
    for (const n of a.numbers) ok(`${tag}: clean stat ${n.label}`, !BAD.test(`${n.value} ${n.note}`), `${n.value} ${n.note}`);
    for (const x of a.almanac) ok(`${tag}: clean almanac`, !BAD.test(x.text), x.text);
    const kinds = new Set(a.stories.map((s) => s.kicker));
    console.log(`${tag}: ${a.stories.length} stories, ${kinds.size} kinds, ${a.numbers.length} stats, ${a.almanac.length} almanac`
      + (process.env.VERBOSE ? `  [${[...kinds].join(", ")}]` : ""));
    if (m === 360) {
      ok(`${tag}: a thirty-year town has a paper`, a.stories.length >= 10, `${a.stories.length} stories`);
      ok(`${tag}: and it is not one kind of story`, kinds.size >= 5, [...kinds].join(", "));
      ok(`${tag}: and it has numbers`, a.numbers.length > 0);
    }
  }
}
console.log(fails ? `\n${fails} failure(s)` : "\nThe paper reads and does not write.");
process.exit(fails ? 1 : 0);
