// Offer / counter slider bands. A $3M listing must not sweep to $27M.
//
//   node --experimental-strip-types test/price-bounds.mjs
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const mod = await import(pathToFileURL(join(HERE, "../src/ui/priceBounds.ts")).href);
const { widePriceBounds, counterPriceBounds, parsePriceInput, nicePriceStep, formatUsdExact } = mod;

let fails = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) { fails++; console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`); }
  else console.log(`PASS  ${name}${detail ? " — " + detail : ""}`);
};

const ASK = 3_000_000;
const APPR = 3_375_000;
const w = widePriceBounds(ASK, APPR);
ok("$3M ask / $3.375M appraisal does not sweep to $27M", w.max < 6_000_000,
  `max ${w.max}`);
ok("slider includes $2.75M", w.min <= 2_750_000 && w.max >= 2_750_000,
  `${w.min}–${w.max}`);
ok("$2.75M is on a step", (2_750_000 - w.min) % w.step === 0
  || 2_750_000 % w.step === 0, `step ${w.step}`);
ok("step is $25k on a $3M deal", w.step === 25_000, String(w.step));
ok("typed floor is below the track", w.typedMin < w.min);
ok("typed ceiling is above the track", w.typedMax > w.max);
ok("old 8× rail is gone", w.max < ASK * 2);

const c = counterPriceBounds(2_800_000, APPR);
ok("seller counter max is near the bid/appraisal, not 2×", c.max < 5_000_000,
  `max ${c.max}`);
ok("counter sits above the bid", c.max > 2_800_000);
ok("can type a number above the track", c.typedMax > c.max);

ok("parse 2.75M", parsePriceInput("2.75M") === 2_750_000);
ok("parse $2,750,000", parsePriceInput("$2,750,000") === 2_750_000);
ok("parse 2750k", parsePriceInput("2750k") === 2_750_000);
ok("parse 2750000", parsePriceInput("2750000") === 2_750_000);
ok("format exact", formatUsdExact(2_750_000) === "$2,750,000");
ok("nice step $3M", nicePriceStep(3_000_000) === 25_000);

console.log(`\n${fails === 0 ? "price-bounds pass" : `${fails} price-bounds failure(s)`}`);
process.exit(fails === 0 ? 0 : 1);
