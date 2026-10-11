// FIRMS RING OWNERS WHO HAVE NOT LISTED — and the owner answers them the way
// it answers the player.
//   pnpm engine && node test/offmarket.mjs
import { assertFreshBundle } from "./fresh.mjs";
if (!process.env.ENGINE) assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(process.env.ENGINE ? join(HERE, "..", process.env.ENGINE) : join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

let fails = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) { fails++; console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`); }
  else console.log(`PASS  ${name}${detail ? " — " + detail : ""}`);
};

const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);

// The owner's answer: the player's refusal band, the player's price floor.
{
  const g = E.firstListings(E.newGame(4242, parcels), parcels, bbls);
  const built = bbls.map((b) => E.resolveRec(parcels, g, b))
    .filter((r) => r && r.class !== "land" && r.bldgArea > 0 && !E.ownerOf(g, r.bbl) && E.holderOf(g, parcels, r.bbl));
  let refused = 0, quoted = 0, n = 0, underFloor = 0;
  for (let i = 0; i < 600; i++) {
    const rec = built[i % built.length];
    const a = E.ownerAnswersCall(g, rec, E.holderOf(g, parcels, rec.bbl), "owners");
    n++;
    if (a.refused) { refused++; continue; }
    if (a.quotes) quoted++;
    if (a.reserve < a.value * 0.8 - 1000) underFloor++;
  }
  const rp = refused / n;
  ok("owners refuse a minority of firm calls, as they do the player's", rp > 0.1 && rp < 0.45, `${(rp * 100).toFixed(0)}%`);
  ok("some owners name a number, some say make me an offer", quoted > 0 && quoted < n - refused, `${quoted} of ${n - refused}`);
  ok("no owner prices under 80% of appraisal", underFloor === 0, `${underFloor}`);
}

// What a firm will pay: nothing for a class its style does not buy.
{
  const g = E.firstListings(E.newGame(4242, parcels), parcels, bbls);
  const merchant = (g.rivals ?? []).find((r) => r.style === "merchant") ?? { id: "x", style: "merchant", cash: 1e7, bbls: [], debt: 0 };
  const shop = bbls.map((b) => E.resolveRec(parcels, g, b)).find((r) => r && r.class === "office" && r.bldgArea > 0);
  ok("a merchant builder pays nothing for a standing office", E.firmMaxPrice(g, merchant, shop) === 0);
  const core = (g.rivals ?? []).find((r) => r.style === "core" || r.style === "reit");
  if (core && shop) ok("a core/REIT firm puts a number on one", E.firmMaxPrice(g, core, shop) > 0);
}

// Twenty years, no player: firms buy off-market from private holders.
{
  let g = E.firstListings(E.newGame(4242, parcels), parcels, bbls);
  const firmBuysOff = new Set();
  let firmBuys = 0;
  const seen = new Set();
  for (let m = 0; m < 240; m++) {
    g = E.advanceMonth(g, parcels, bbls, adjacency);
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
    const names = new Set((g.rivals ?? []).map((r) => r.name));
    for (const c of g.comps ?? []) {
      const k = `${c.bbl}@${c.m}@${c.price}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (!names.has(c.buyer)) continue;
      firmBuys++;
      if (c.offMarket && !names.has(c.seller)) firmBuysOff.add(k);
    }
  }
  const share = firmBuysOff.size / Math.max(1, firmBuys);
  ok("firms close off-market deals with private holders", firmBuysOff.size > 0, `${firmBuysOff.size} of ${firmBuys} firm buys`);
  ok("off-market is a share of firm buying, not all of it", share < 0.8, `${(share * 100).toFixed(0)}%`);
}

console.log(fails ? `\n${fails} failed` : "\nall good");
process.exit(fails ? 1 : 0);
