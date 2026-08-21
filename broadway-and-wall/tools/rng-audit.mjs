// Fail if hot-path engine files gain rng()/rrange() calls without an RNG-NOTE.
//
//   node tools/rng-audit.mjs
//   RNG_NOTE=1 node tools/rng-audit.mjs   allow increases when commit documents re-roll
//
// Baseline counts live in tools/rng-baseline.json — bump only with measured re-roll note.
//
// IT COUNTS CODE, NOT PROSE, and that is not a refinement — it was the whole
// reason this check had been failing for months on end.
//
// The counter was a text grep over the file, so every COMMENT that mentioned
// `rng(` counted as a draw. In a codebase where the discipline around the
// random stream is the thing most often explained in comments, that makes the
// audit fire hardest at the commits that document themselves best: the commit
// that added the entitlement premium wrote "it means no new rng() draw" in a
// comment, added no draws at all, and was reported as having added one.
//
// A check that fails for a reason nobody can act on stops being read, and a
// check nobody reads is worse than no check because it looks like coverage.
// So comments come out before anything is counted, and the baseline below was
// re-measured with the corrected counter — the old numbers were prose plus
// code and are not comparable to these.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..");
const HOT = ["sim.ts", "market.ts", "rivals.ts", "dev.ts"];
const baseline = JSON.parse(readFileSync(join(HERE, "rng-baseline.json"), "utf8"));
const allow = process.env.RNG_NOTE === "1" || /RNG-NOTE:/i.test(process.env.GIT_COMMIT_MESSAGE ?? "");

let fails = 0;
/**
 * The file with its comments removed. Block comments go whole; a line comment
 * runs to the end of its line, except after a colon so that a `https://` in a
 * source line is not mistaken for one. It is not a TypeScript parser and does
 * not need to be — what it has to do is stop counting the word `rng(` when it
 * appears in a sentence about rng().
 */
function code(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => {
      const m = /(?<!:)\/\//.exec(line);
      return m ? line.slice(0, m.index) : line;
    })
    .join("\n");
}

for (const file of HOT) {
  const src = code(readFileSync(join(APP, "src", "engine", file), "utf8"));
  const rng = (src.match(/\brng\(/g) ?? []).length;
  const rrange = (src.match(/\brrange\(/g) ?? []).length;
  const base = baseline[file] ?? { rng: 0, rrange: 0 };
  const drift = (rng > base.rng || rrange > base.rrange);
  const line = `${file}: rng ${rng} (base ${base.rng}), rrange ${rrange} (base ${base.rrange})`;
  if (drift && !allow) {
    fails++;
    console.log(`FAIL  ${line} — set RNG_NOTE=1 or add RNG-NOTE: to commit when intentional`);
  } else {
    console.log(`OK    ${line}${drift ? " (allowed by RNG note)" : ""}`);
  }
}

if (fails) {
  console.log("\nHot-path RNG increased without note. Re-run paired audits if stream order changed.");
  process.exit(1);
}
console.log("\nrng-audit pass");
process.exit(0);
