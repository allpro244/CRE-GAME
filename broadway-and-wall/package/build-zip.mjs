// Assemble the distributable zip: the built site plus the launchers.
// Run via `pnpm package` (which builds first). Output: dist-zip/broadway-and-wall-playable.zip
import { cpSync, existsSync, mkdirSync, rmSync, chmodSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = dirname(fileURLToPath(import.meta.url));
const APP = join(PKG, "..");
const DIST = join(APP, "dist");
const OUT = join(APP, "dist-zip");
const STAGE = join(OUT, "broadway-and-wall");

if (!existsSync(join(DIST, "index.html"))) {
  console.error("No dist/ build found — run `pnpm build` first.");
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });

// the built site
cpSync(DIST, STAGE, { recursive: true });

// Fresh stamp per packaged build. The game wipes IndexedDB saves when this
// changes, so a new zip never Continues a campaign from the previous one.
const saveGen = `${Date.now().toString(36)}-${process.pid.toString(36)}`;
writeFileSync(join(STAGE, "build.json"), JSON.stringify({ saveGen, builtAt: new Date().toISOString() }) + "\n");

// the launchers
for (const f of ["serve.py", "play.command", "play.sh", "play.cmd", "README.txt"]) {
  cpSync(join(PKG, f), join(STAGE, f));
}
for (const f of ["play.command", "play.sh", "serve.py"]) {
  chmodSync(join(STAGE, f), 0o755);
}

const zipPath = join(OUT, "broadway-and-wall-playable.zip");
// -r recurse, -q quiet, -9 max compression; run from OUT so paths are relative
execFileSync("zip", ["-rq9", zipPath, "broadway-and-wall"], { cwd: OUT });

function tree(dir, depth = 0) {
  let bytes = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) bytes += tree(p, depth + 1);
    else bytes += st.size;
  }
  return bytes;
}

const staged = tree(STAGE);
const zipped = statSync(zipPath).size;
console.log(`staged  ${(staged / 1048576).toFixed(1)} MB`);
console.log(`zipped  ${(zipped / 1048576).toFixed(1)} MB  ->  ${zipPath}`);
