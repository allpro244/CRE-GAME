// Rebuild the self-contained HTML and copy it into playable/ for commit.
//   pnpm package:playable
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const ONE = join(APP, "dist", "broadway-and-wall.html");
const PLAYABLE = join(APP, "playable", "broadway-and-wall.html");
const STAMP = join(APP, "src", "buildStamp.ts");

if (!existsSync(STAMP)) {
  console.error("Missing src/buildStamp.ts");
  process.exit(1);
}

execFileSync("pnpm", ["package:onefile"], { cwd: APP, stdio: "inherit" });

if (!existsSync(ONE)) {
  console.error("Expected dist/broadway-and-wall.html after package:onefile");
  process.exit(1);
}

cpSync(ONE, PLAYABLE);

execFileSync("pnpm", ["package"], { cwd: APP, stdio: "inherit" });
const ZIP = join(APP, "dist-zip", "broadway-and-wall-playable.zip");
const PLAYABLE_ZIP = join(APP, "playable", "Broadway-and-Wall-playable.zip");
if (!existsSync(ZIP)) {
  console.error("Expected dist-zip/broadway-and-wall-playable.zip after pnpm package");
  process.exit(1);
}
cpSync(ZIP, PLAYABLE_ZIP);

const stamp = readFileSync(STAMP, "utf8");
const m = stamp.match(/commit:\s*"([^"]+)"/);
const commit = m?.[1] ?? "unknown";
const rent = stamp.match(/rentBaseOffice:\s*([\d.]+)/)?.[1] ?? "?";

const readme = `BROADWAY & WALL — PLAYABLE
======================================
Build id:  ${commit}
Office:    $${rent} base (secondary market)

HOW TO KNOW YOU HAVE THIS BUILD
  On the start screen footer you should see:
    build ${commit} · office base $${rent}
  The start screen asks WHICH CITY first:
    Somewhere else - a generated island, a new one every run
    Manhattan      - the written-down one, with an extent picker
                     (below Houston / 14th / 23rd / 34th / 42nd / 59th)
  Pick Manhattan below 59th Street with the Metropolis build-out for the
  largest map in the game, about 25,000 parcels.
  The old hand-drawn fictional islands, New Alden and Kestrel Point, are
  still gone; Manhattan is a real city written down, which is a different
  thing and is why it came back as a named choice rather than as those.

DOWNLOAD
  Prefer: Broadway-and-Wall-playable.zip  (from pnpm package)
  1. Unzip
  2. Double-click play.command (Mac) / play.cmd (Windows) / play.sh (Linux)
  3. Leave the small terminal open while you play (needs Python 3)

Start a NEW campaign after updating if you were mid-run on an older tip.
`;

writeFileSync(join(APP, "playable", "README.txt"), readme);
writeFileSync(join(APP, "playable", "VERSION.txt"), `${commit}\n`);

console.log(`  playable/broadway-and-wall.html   refreshed (build ${commit})`);
