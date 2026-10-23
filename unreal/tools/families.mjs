// The web renderer's facade picker (map/real/facades.ts familyFor, with the
// pattern book's cousins registered) bundled for Node, so the command-line
// exporter hands Unreal the same family and tint for each building the browser
// map draws. esbuild is the web app's own; the bundle goes to the OS temp dir.
import { buildSync } from "../../broadway-and-wall/node_modules/esbuild/lib/main.js";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "broadway-and-wall", "src", "map", "real");
const out = join(tmpdir(), `bw-families-${process.pid}.mjs`);
buildSync({
  stdin: { contents: `import "./patternbook/register";\nexport { familyFor, TINTS, LIKE } from "./facades";`, resolveDir: SRC, loader: "ts" },
  bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "error",
});
export const { familyFor, TINTS, LIKE } = await import(pathToFileURL(out).href);
