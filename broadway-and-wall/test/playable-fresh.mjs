// THE COMMITTED PLAYABLE MUST MATCH THE SOURCE.
//
// PR #75 removed hand-drawn islands from citygen and the start screen, but the
// one-file bundle under playable/ was never rebuilt — so anyone opening
// playable/broadway-and-wall.html still saw New Alden and Kestrel Point in the
// island picker. This test fails if that stale bundle ships again.
import { readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLAYABLE = join(HERE, "..", "playable", "broadway-and-wall.html");
const START_MENU = join(HERE, "..", "src", "ui", "StartMenu.tsx");

const LEGACY = [
  "which island",
  "district:`newalden`",
  "district:`kestrel`",
  "name:`New Alden`",
  "name:`Kestrel Point`",
];

let html;
try {
  html = readFileSync(PLAYABLE, "utf8");
} catch {
  console.error("\nMissing playable/broadway-and-wall.html — rebuild it:\n"
    + "  pnpm --dir broadway-and-wall package:playable\n");
  process.exit(1);
}

const hits = LEGACY.filter((s) => html.includes(s));
if (hits.length) {
  console.error("\nSTALE PLAYABLE — hand-drawn cities still embedded in playable/broadway-and-wall.html:");
  for (const h of hits) console.error(`  · ${h}`);
  console.error("\nRebuild and commit:\n  pnpm --dir broadway-and-wall package:playable\n");
  process.exit(1);
}

const menuMtime = statSync(START_MENU).mtimeMs;
const playableMtime = statSync(PLAYABLE).mtimeMs;
if (playableMtime < menuMtime - 1000) {
  console.error("\nSTALE PLAYABLE — playable/broadway-and-wall.html is older than src/ui/StartMenu.tsx.");
  console.error("Rebuild and commit:\n  pnpm --dir broadway-and-wall package:playable\n");
  process.exit(1);
}

console.log("playable bundle: no legacy drawn cities, newer than StartMenu.tsx");
