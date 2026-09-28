// WHO OWNS IT AFTER YOU SELL IT?
//
//   pnpm deed-goes
//
// The deed a player sold left their book and landed nowhere: `holderOf`
// hashes an unowned parcel to a registered holder on the parcel's own key,
// so the desk showed the building back with the firm the player had BOUGHT
// it from — "Owned by Abernathy Construction", a month after selling it to a
// family office — and a named firm's winning bid put nothing in that firm's
// book. Two closes, two checks: an anonymous bid re-draws the register (a
// different, stable name, one comp); a living firm's bid puts the deed on
// that firm's balance sheet under its own name, one comp in its name.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);
let fails = 0;
const ok = (n, c, d = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); if (!c) fails++; };
let g = E.firstListings(E.newGame(4242, parcels), parcels, bbls);
g = { ...g, cash: 60e6 };
// buy two buildings
const mine = [];
for (let m = 0; m < 36 && mine.length < 2; m++) {
  g = E.advanceQuarter(g, parcels, bbls, adjacency);
  for (const li of [...g.listings]) {
    const rec = E.resolveRec(parcels, g, li.bbl);
    if (!rec || rec.class === "land" || !rec.bldgArea || g.holdings[li.bbl]) continue;
    const before = E.holderOf(g, parcels, li.bbl)?.name ?? E.ownerOf(g, li.bbl)?.name ?? "?";
    const r = E.executePurchase(g, parcels, li.bbl, li.ask, "cash", false, 1);
    if (!r.err) { g = r.s; mine.push({ bbl: li.bbl, before }); }
    if (mine.length >= 2) break;
  }
}
ok("bought two buildings", mine.length === 2);
// 1. a marketed sale where an ANONYMOUS bidder wins -> the register names somebody new
{
  const { bbl, before } = mine[0];
  const h = g.holdings[bbl];
  g = E.listForSale(g, parcels, bbl, Math.round(h.costBasis * 0.9), "marketed").s;
  let bids = null;
  for (let m = 0; m < 8 && !bids; m++) { g = E.advanceQuarter(g, parcels, bbls, adjacency); bids = g.holdings[bbl]?.sale?.bids ?? null; }
  const rivals = E.livingRivals(g).map((r) => r.name);
  const idx = bids ? bids.findIndex((b) => !rivals.includes(b.name) && !b.dropped) : -1;
  ok("an anonymous bid is on the list", idx >= 0, bids ? bids.map((b) => b.name).join(", ") : "no bids");
  if (idx >= 0) {
    let r = E.acceptBid(g, parcels, bbl, idx); ok("took the anonymous bid", !r.err, r.err); g = r.s;
    if (g.holdings[bbl]?.sale?.offer) {
      const c = E.acceptSaleOffer(g, parcels, bbl, false); ok("closed", !c.err, c.err); g = c.s;
      const after = E.holderOf(g, parcels, bbl)?.name ?? E.ownerOf(g, bbl)?.name ?? "?";
      ok(`the deed left the old name (${before} -> ${after})`, after !== before && !E.ownerOf(g, bbl));
      const again = E.holderOf(g, parcels, bbl)?.name ?? "?";
      ok("and the new holder is stable", again === after);
      ok("one comp filed for the sale", g.comps.filter((c) => c.bbl === bbl && c.m === g.month).length === 1);
    } else ok("offer set after taking the bid", false);
  }
}
// 2. a marketed sale where a named firm wins
{
  const { bbl, before } = mine[1];
  const h = g.holdings[bbl];
  g = E.listForSale(g, parcels, bbl, Math.round(h.costBasis * 0.9), "marketed").s;
  let bids = null;
  for (let m = 0; m < 8 && !bids; m++) { g = E.advanceQuarter(g, parcels, bbls, adjacency); bids = g.holdings[bbl]?.sale?.bids ?? null; }
  ok("a bid list came in", !!bids && bids.length > 0, bids ? `${bids.length} bids: ${bids.map((b) => b.name).join(", ")}` : "");
  const rivals = E.livingRivals(g).map((r) => r.name);
  const idx = bids ? bids.findIndex((b) => rivals.includes(b.name) && !b.dropped) : -1;
  if (idx >= 0) {
    const name = bids[idx].name;
    let r = E.acceptBid(g, parcels, bbl, idx);
    ok("took the firm's bid", !r.err, r.err); g = r.s;
    if (g.holdings[bbl]?.sale?.offer) {
      const c = E.acceptSaleOffer(g, parcels, bbl, false);
      ok("closed with the firm", !c.err, c.err); g = c.s;
      const owner = E.ownerOf(g, bbl);
      ok(`${name} now owns the deed (was ${before})`, !!owner && owner.name === name, owner ? `owner ${owner.name}` : "no rival owner");
      ok("one comp filed, in the firm's name", g.comps.filter((c) => c.bbl === bbl && c.m === g.month).length === 1 && g.comps.find((c) => c.bbl === bbl && c.m === g.month)?.buyer === name);
    } else ok("offer set after taking the bid", false, "no offer on the holding");
  } else console.log("  (no living firm on the bid list this run — the firm path was not exercised)");
}
process.exit(fails ? 1 : 0);
