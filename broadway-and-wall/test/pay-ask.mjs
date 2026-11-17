// PAYING THE ASK IS NEVER A LOWBALL. A seller's floor can sit above its own
// ask (a firm on the street has bid over it), and the insult line took 80% of
// that floor: the full listed price was "refused as a lowball, 0% under ask"
// and the door shut for a year. At or over the ask the seller answers with
// its number; under the ask the insult rule is unchanged.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { makeCity } = await import(join(HERE, "..", "src", "citygen", "index.mjs"));

function ok(label, cond) {
  if (!cond) throw new Error(`FAIL  ${label}`);
  console.log(`  OK   ${label}`);
}

const SEED = 20261;
const parcels = E.normalizeParcels(makeCity("somewhere", SEED, { size: "city" }).parcels);
const bbls = Object.keys(parcels);
const g = E.firstListings(E.newGame(SEED, parcels, 2_500_000, undefined, { citySize: "city", cityLots: bbls.length }), parcels, bbls);

// every opening listing whose best street bid is far enough over the ask that
// 80% of the seller's floor is above the ask
const over = [];
for (const li of g.listings) {
  const rec = E.resolveRec(parcels, g, li.bbl);
  if (li.halfBuilt) continue;
  const building = rec.class !== "land" && rec.bldgArea > 0;
  const top = (building ? E.bidRound(g, parcels, rec, li) : E.landBidRound(g, parcels, rec, li)).bids[0]?.bid ?? 0;
  const floor = Math.max(E.listingReserve(li), top + 1000);
  if (floor * 0.8 > li.ask) over.push({ li, floor });
}
ok(`listings whose floor is over 1.25x the ask (${over.length})`, over.length >= 1);

for (const { li, floor } of over) {
  const at = parcels[li.bbl].address;
  const r = E.negotiate(g, parcels, li.bbl, li.ask);
  ok(`${at}: the ask is not a lowball`, !r.err && !/too low/i.test(r.msg ?? "") && r.s.approaches[li.bbl]?.insultedUntilM === undefined);
  ok(`${at}: no reputation hit`, (r.s.lowballMs ?? []).length === (g.lowballMs ?? []).length);
  const t = r.s.talks?.[li.bbl];
  ok(`${at}: the seller counters at its floor, over the ask`, !!t && !t.agreed && !t.final && t.theirPrice === Math.round(floor) && t.theirPrice > li.ask);
  ok(`${at}: no draw`, r.s.rng === g.rng);
  // over the ask and still short of the floor: the same answer
  const r2 = E.negotiate(g, parcels, li.bbl, Math.round(li.ask * 1.05));
  ok(`${at}: 5% over the ask is not a lowball either`, r2.s.approaches[li.bbl]?.insultedUntilM === undefined && r2.s.talks?.[li.bbl]?.theirPrice === Math.round(floor));
  // standing on the full ask, round after round, never sours them or ends the talks
  // (the talks can run out — their last round is a final, and declining a final
  // ends that conversation — but nothing is held against you and you may open again)
  let gs = r.s;
  for (let i = 0; i < 4; i++) gs = E.negotiate(gs, parcels, li.bbl, li.ask).s;
  ok(`${at}: the ask offered five times running: not soured, no shut door, no reputation hit, no draw`,
    !(gs.approaches[li.bbl]?.soured > 0) && gs.approaches[li.bbl]?.insultedUntilM === undefined && !gs.approaches[li.bbl]?.refused
    && (gs.lowballMs ?? []).length === (g.lowballMs ?? []).length && gs.rng === g.rng);
  const again = E.negotiate(gs, parcels, li.bbl, li.ask);
  ok(`${at}: and the seller takes the call again at once`, !again.err && !!again.s.talks?.[li.bbl] && again.s.talks[li.bbl].theirPrice === Math.round(floor));
  // a dollar under the ask is under the line as before
  const r3 = E.negotiate(g, parcels, li.bbl, li.ask - 1);
  ok(`${at}: under the ask the insult rule stands`, /too low/i.test(r3.msg ?? "") && r3.s.approaches[li.bbl]?.insultedUntilM !== undefined);
}
console.log("pay-ask: ok");
