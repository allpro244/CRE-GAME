// THE COMMITTED PLAYABLE MUST MATCH THE SOURCE.
//
// PR #75 removed hand-drawn islands from citygen and the start screen, but the
// one-file bundle under playable/ was never rebuilt — so anyone opening
// playable/broadway-and-wall.html still saw New Alden and Kestrel Point in the
// island picker. This test fails if that stale bundle ships again.
//
// PR #82 merged UI + distress work but only refreshed the zip; the single-file
// HTML stayed older than TopBar/ParcelDesk. Guard against that too.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLAYABLE = join(HERE, "..", "playable", "broadway-and-wall.html");
const PLAYABLE_ZIP = join(HERE, "..", "playable", "Broadway-and-Wall-playable.zip");

// A change in ANY of these must trigger a playable rebuild.
//
// THIS LIST WAS SIX UI FILES AND THAT IS A GUARD WITH A HOLE IN IT. The whole
// point of this test is "the committed playable must match the source", and it
// was only ever asked about six panels — so a day's work on the renderer, the
// generator and the engine could land, and the download would still be the
// build from before any of it, and this test would print "fresh" the whole
// time. It did exactly that: the committed bundle sat six hours behind
// Manhattan, seventeen Art Deco families and the harbour rewrite, green.
//
// The honest anchor is the whole of src/, since everything under it ends up in
// the bundle. Walked rather than listed, so a new module cannot be forgotten —
// a hand-kept list of files to watch is the fault this replaces, not the fix.
const SRC = join(HERE, "..", "src");
function newestUnder(dir) {
  let newest = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    newest = Math.max(newest, e.isDirectory() ? newestUnder(p) : statSync(p).mtimeMs);
  }
  return newest;
}

const LEGACY = [
  "which island",
  "district:`newalden`",
  "district:`kestrel`",
  "name:`New Alden`",
  "name:`Kestrel Point`",
];

// Strings that must appear in a post-#82 bundle — if source has them but html
// does not, someone merged code without `pnpm package:playable`.
const REQUIRED = [
  "Cycle, space markets and construction", // Economy tab (TopBar)
  "Pay ask",                                  // distressed offer desk
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

const newestSource = newestUnder(SRC);
const playableMtime = statSync(PLAYABLE).mtimeMs;
if (playableMtime < newestSource - 1000) {
  console.error("\nSTALE PLAYABLE — playable/broadway-and-wall.html is older than src/.");
  console.error("Rebuild and commit:\n  pnpm --dir broadway-and-wall package:playable\n");
  process.exit(1);
}

const zipMtime = statSync(PLAYABLE_ZIP).mtimeMs;
if (zipMtime < playableMtime - 1000) {
  console.error("\nSTALE ZIP — Broadway-and-Wall-playable.zip is older than broadway-and-wall.html.");
  console.error("Rebuild and commit:\n  pnpm --dir broadway-and-wall package:playable\n");
  process.exit(1);
}

const missing = REQUIRED.filter((s) => !html.includes(s));
if (missing.length) {
  console.error("\nSTALE PLAYABLE — expected post-#82 UI strings missing from broadway-and-wall.html:");
  for (const s of missing) console.error(`  · ${s}`);
  console.error("\nRebuild and commit:\n  pnpm --dir broadway-and-wall package:playable\n");
  process.exit(1);
}

console.log("playable bundle: fresh html + zip, no legacy drawn cities");
