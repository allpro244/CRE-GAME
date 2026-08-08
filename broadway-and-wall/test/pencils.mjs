// CAN ANYTHING IN THIS CITY BE BUILT, AND BY WHOM.
//
//   pnpm pencils                                 two towns, thirty years
//   N=4 HZ=480 pnpm pencils                      wider and longer
//   ENGINE=test/.engine-base.mjs pnpm pencils    the other arm of an A/B
//
// The development desk and the land market are the same question asked from
// two ends, and for a long time this repo answered it two different ways
// without either answer being able to see the other.
//
// From the desk's end, `pnpm devyield` had been reporting 0 office sites
// pencil of 1,363, 0 retail, 3 multifamily and 21 industrial — in a city whose
// office stock grows about 1% a year. From the land market's end, the price of
// dirt ran 1.24x to 1.37x the best builder's residual, and the number of lots
// out of 1,109 where a builder could pay the asking price was ZERO. The
// residual IS the price at which a builder earns exactly DEV_MARGIN, so a
// market permanently above it is a market where development never clears its
// hurdle, anywhere, in any year.
//
// The city kept building through all of it, because `devPencils` — which
// decides city supply — works from index ratios and never looks at what land
// costs or what a square foot costs to put up. The player's desk does look.
// Same quantity, two answers, and the one the player was shown was the one
// that said no.
//
// Three things are measured here and the third is the one that matters.
//
// WHO BIDS       which of the three bids in `landRead` sets the price. If the
//                holder's option wins nearly everywhere, then PEAK_RENT_MULT
//                and WAIT_DISCOUNT are the land market and the builder's
//                residual is decoration.
// PRICE/RESIDUAL the ratio, across every vacant lot. It should STRADDLE 1.0.
//                All of it above 1.0 is a city that cannot be built; all of it
//                below is a city where every lot is a development site.
// RENT vs COST   the identity. `HARD_COST_PSF` carries, in its own comments,
//                the net rent each class needs to justify its cost. `RENT_BASE`
//                carries the rent each class actually gets. Nobody had ever put
//                the two columns next to each other. Industrial is the only
//                class that earns what its cost requires, which is why
//                industrial outbids everybody for every lot in the city.
import { assertFreshBundle } from "./fresh.mjs";
if (!process.env.ENGINE) assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(process.env.ENGINE ? join(HERE, "..", process.env.ENGINE) : join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

const N = Number(process.env.N ?? 2);
const HZ = Number(process.env.HZ ?? 360);
const USES = ["office", "retail", "multifamily", "industrial"];

// The rent each class needs to cover its own construction, read off the
// comments beside HARD_COST_PSF in value.ts. These are NET rents and they are
// the point of the third table: they were written down when the cost table was
// written and never checked against the rent table.
const NEEDS_NET = { office: 62, retail: 97, multifamily: 37, industrial: 17 };

const q = (a, p) => { const s = [...a].filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(p * (s.length - 1))] : NaN; };
const pad = (s, n) => String(s).padEnd(n);
const rp = (s, n) => String(s).padStart(n);

const who = { builder: 0, holder: 0, texture: 0 };
const wins = {}, bids = {};
for (const u of USES) { wins[u] = 0; bids[u] = []; }
const ratio = [], price = [], resid = [];
const grew = {}; for (const u of USES) grew[u] = [];

for (let i = 0; i < N; i++) {
  const { parcels, adjacency, bbls } = loadCity(i, E.normalizeParcels);
  let g = E.firstListings(E.newGame(31 + i, parcels), parcels, bbls);
  const s0 = {}; for (const u of USES) s0[u] = g.econ.stock[u];
  for (let m = 0; m < HZ; m++) {
    // The frozen world: advanceQuarter returns state unchanged once gameOver
    // is set, so an un-resurrected probe stops and copies its last month.
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
    g = E.advanceQuarter(g, parcels, bbls, adjacency);
  }
  for (const u of USES) grew[u].push(Math.pow(g.econ.stock[u] / Math.max(1, s0[u]), 12 / HZ) - 1);
  for (const b of bbls) {
    const r = parcels[b];
    if (r?.class !== "land" || !(r.lotArea > 1500)) continue;
    const read = E.landRead(r, g.econ);
    if (!(read.psf > 0)) continue;
    who[read.winner]++;
    if (read.scheme) {
      wins[read.scheme.use]++;
      for (const c of read.scheme.all) bids[c.use].push(c.psf);
    }
    price.push(read.psf); resid.push(read.builder);
    if (read.builder > 0) ratio.push(read.psf / read.builder);
  }
}

const n = who.builder + who.holder + who.texture;
console.log(`\nWHO IS THE HIGH BIDDER FOR DIRT — ${n} vacant lots, ${N} towns, year ${HZ / 12}\n`);
console.log(`  builder      ${rp(((100 * who.builder) / n).toFixed(1) + "%", 7)}   what can be built today`);
console.log(`  holder       ${rp(((100 * who.holder) / n).toFixed(1) + "%", 7)}   the option on the next peak`);
console.log(`  the street   ${rp(((100 * who.texture) / n).toFixed(1) + "%", 7)}   neither bid reaches the comparison floor`);

const tw = Object.values(wins).reduce((a, v) => a + v, 0) || 1;
console.log(`\nAND WHAT THE BUILDER WOULD PUT UP — every use the residual considered\n`);
console.log(`  ${pad("use", 14)}${rp("best use", 10)}${rp("bids > 0", 10)}${rp("median bid $/sf land", 22)}`);
for (const u of USES) {
  const ok = bids[u].filter((x) => x > 0).length;
  console.log(`  ${pad(u, 14)}${rp(((100 * wins[u]) / tw).toFixed(1) + "%", 10)}${rp(((100 * ok) / Math.max(1, bids[u].length)).toFixed(1) + "%", 10)}${rp(q(bids[u], 0.5).toFixed(0), 22)}`);
}

console.log(`\nWHAT DIRT COSTS AGAINST WHAT A BUILDER CAN PAY FOR IT\n`);
console.log(`  ${pad("", 22)}${rp("p25", 9)}${rp("median", 9)}${rp("p75", 9)}`);
console.log(`  ${pad("land price $/sf", 22)}${rp(q(price, 0.25).toFixed(0), 9)}${rp(q(price, 0.5).toFixed(0), 9)}${rp(q(price, 0.75).toFixed(0), 9)}`);
console.log(`  ${pad("builder's residual", 22)}${rp(q(resid, 0.25).toFixed(0), 9)}${rp(q(resid, 0.5).toFixed(0), 9)}${rp(q(resid, 0.75).toFixed(0), 9)}`);
console.log(`  ${pad("price / residual", 22)}${rp(q(ratio, 0.25).toFixed(2) + "x", 9)}${rp(q(ratio, 0.5).toFixed(2) + "x", 9)}${rp(q(ratio, 0.75).toFixed(2) + "x", 9)}`);
console.log(`\n  lots a builder could pay the asking price for: ${((100 * ratio.filter((x) => x <= 1).length) / Math.max(1, ratio.length)).toFixed(1)}%`);
console.log(`  This should STRADDLE 1.0. At 0% the city cannot be built and the`);
console.log(`  supply the player sees is coming from a model that never looks at cost.`);

console.log(`\nTHE IDENTITY NOBODY HAD CHECKED — what a class earns against what its cost needs\n`);
console.log(`  ${pad("use", 14)}${rp("hard $/sf", 11)}${rp("needs net", 11)}${rp("base rent", 11)}${rp("shortfall", 11)}   stock`);
for (const u of USES) {
  const need = NEEDS_NET[u];
  const got = E.RENT_BASE[u];
  const gap = got / need - 1;
  console.log(`  ${pad(u, 14)}${rp(E.HARD_COST_PSF[u], 11)}${rp("$" + need, 11)}${rp("$" + got.toFixed(2), 11)}`
    + `${rp((gap >= 0 ? "+" : "") + (100 * gap).toFixed(0) + "%", 11)}   ${(100 * q(grew[u], 0.5)).toFixed(2)}%/yr`);
}
console.log(`\n  The "needs net" column is copied from the comments beside HARD_COST_PSF`);
console.log(`  in value.ts, where it was written down when the cost table was set. The`);
console.log(`  "base rent" column is RENT_BASE in market.ts. They were never compared.`);
console.log(`  A class that earns less than its cost requires cannot be built at any`);
console.log(`  land price, because the land is the LAST claim on the money, not the`);
console.log(`  first — and the one class that clears its own bar outbids the others`);
console.log(`  for every lot in the city, including the ones it has no business on.\n`);
