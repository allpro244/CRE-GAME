// PLAT QUALITY — the harness the "weird generations" complaint never had.
//
// Every number here is a REPORT with a band, in the house style: movement is
// not failure, and taste stays human. The one hard gate is DEGENERACY — a
// non-finite coordinate, a zero-area lot — because those are never taste.
//
//   pnpm plat                    12 pinned seeds, city size (~40s)
//   SEEDS=1,2,3 SIZE=hamlet pnpm plat
//
// Bands (drawn from the pathologies named in the Tarrworth screenshot and
// the generator's own Manhattan-calibrated block maths):
//   sliver lots   <= 3% healthy · 3-6% watch · > 6% the shattered-glass look
//   spikes        <= 0.5%       — seam wedges parceled into confetti
//   confetti      0 blocks ideally; each one is a block the eye reads as debris
//   paved void    largest single unprogrammed apron under ~8,000 sq m
//   stream        meander >= 0.05 for a creek; a ruler canal scores ~0.01
//   hierarchy     inner-quarter floors / outer-quarter floors >= 1.3
import { makeCity } from "../src/citygen/index.mjs";
import { measurePlat } from "../tools/platlib.mjs";

const SEEDS = (process.env.SEEDS
  ? process.env.SEEDS.split(",").map(Number)
  : [4242, 550991, 12007, 1337, 31415, 271828, 87, 5150, 909090, 123457, 424243, 777001]);
const SIZE = process.env.SIZE || "city";
const DEV = process.env.DEV || "village";

const rows = [];
let degenerateTotal = 0;
for (const seed of SEEDS) {
  let m;
  try {
    m = measurePlat(makeCity("somewhere", seed, { size: SIZE, density: DEV }));
  } catch (e) {
    console.log(`  ${String(seed).padStart(8)}  GENERATION THREW: ${e.message}`);
    degenerateTotal++;
    continue;
  }
  degenerateTotal += m.degenerate.length;
  rows.push(m);
}

const pad = (v, n) => String(v).padStart(n);
console.log(`\nPLAT QUALITY — ${rows.length} islands, size=${SIZE}\n`);
console.log("  seed      lots  sliver%  spike%  confetti  void%  bigVoid  street  meander  orientVar  gradient");
for (const m of rows) {
  const meander = m.streams.length ? Math.min(...m.streams.map((s) => s.meander)).toFixed(3) : "  —  ";
  console.log(
    `  ${pad(m.seed, 8)}${pad(m.lots, 6)}${pad(m.sliverPct, 8)}${pad(m.spikePct, 8)}`
    + `${pad(m.confettiBlocks, 9)}${pad(m.pavedVoidPct, 8)}${pad(m.largestVoidM2, 9)}${pad(m.streetShare ?? "—", 8)}`
    + `${pad(meander, 9)}${pad(m.worstOrient ? m.worstOrient.variance : "—", 10)}${pad(m.gradient ?? "—", 9)}`,
  );
  if (m.degenerate.length) console.log(`           DEGENERATE: ${m.degenerate.slice(0, 4).join("; ")}`);
}

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const sliverMed = med(rows.map((m) => m.sliverPct));
const spikeMed = med(rows.map((m) => m.spikePct));
const confettiSum = rows.reduce((s, m) => s + m.confettiBlocks, 0);
const voidMax = Math.max(0, ...rows.map((m) => m.largestVoidM2));
const gradMed = med(rows.map((m) => m.gradient ?? 0).filter(Boolean));
const meanders = rows.flatMap((m) => m.streams.map((s) => s.meander));

console.log("\n  BANDS (report, not gate — taste stays human):");
console.log(`  sliver median  ${sliverMed}%   ${sliverMed <= 3 ? "healthy" : sliverMed <= 6 ? "WATCH" : "SHATTERED-GLASS TERRITORY"}`);
console.log(`  spike median   ${spikeMed}%   ${spikeMed <= 0.5 ? "healthy" : "SEAM CONFETTI"}`);
console.log(`  confetti       ${confettiSum} block(s) across the sweep ${confettiSum === 0 ? "" : "— each one reads as debris"}`);
console.log(`  largest void   ${voidMax} sq m ${voidMax <= 8000 ? "" : "— an unprogrammed field of asphalt"}`);
if (meanders.length) console.log(`  stream meander min ${Math.min(...meanders)} ${Math.min(...meanders) >= 0.05 ? "" : "— a ruler, not a brook"}`);
const streetMed = med(rows.map((m) => m.streetShare ?? 0).filter(Boolean));
console.log(`  street share   ${streetMed} pavement per unit of block ${streetMed <= 0.6 ? "" : "— MORE ROAD THAN CITY in places"}`);
console.log(`  hierarchy      inner/outer floors ${gradMed || "—"} ${gradMed >= 1.3 ? "(downtown exists)" : "(no core reads from the air)"}`);

if (degenerateTotal > 0) {
  console.log(`\n  ${degenerateTotal} DEGENERATE geometr${degenerateTotal === 1 ? "y" : "ies"} — this is the one hard gate.`);
  process.exit(1);
}
console.log("\n  No degenerate geometry. Bands above are the conversation.");
