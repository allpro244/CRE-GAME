// Bundle the engine to plain ESM and run the invariant sweep against it.
// No test framework: the engine is pure functions and JSON state, so the
// harness is a program that plays the game and asserts the state is sane.
//
//   pnpm test            a century, 4 bots x 4 seeds  (~2 min)
//   HORIZON=240 pnpm test   twenty years, for a quick pass
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, ".entry.ts");
const OUT = join(HERE, ".engine.mjs");

const MODULES = ["sim", "leasing", "actions", "credit", "value", "dev", "debt", "demand", "invariants", "rivals", "sponsor", "mix", "acquire"];
const { writeFileSync } = await import("node:fs");
writeFileSync(ENTRY, MODULES.map((m) => `export * from "../src/engine/${m}";`).join("\n") + "\n");

const build = spawnSync(
  join(HERE, "..", "node_modules", ".bin", "esbuild"),
  [ENTRY, "--bundle", "--format=esm", "--platform=node", `--outfile=${OUT}`],
  { stdio: "inherit" },
);
if (build.status !== 0) process.exit(build.status ?? 1);

const which = process.argv.includes("--balance") ? "audit.mjs"
  : process.argv.includes("--econ") ? "econ.mjs"
  : process.argv.includes("--stats") ? "stats.mjs"
  : process.argv.includes("--play") ? "play50.mjs"
  : "invariants.mjs";
const run = spawnSync("node", [join(HERE, which)], { stdio: "inherit", env: process.env });
process.exit(run.status ?? 1);
