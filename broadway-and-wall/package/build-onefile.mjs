// Fold the built site into ONE self-contained HTML file.
//
//   pnpm package:onefile        -> dist/broadway-and-wall.html
//
// The zip in build-zip.mjs exists because a Vite build is a set of files with
// absolute asset paths, and opening index.html off a file:// URL therefore does
// nothing at all — hence the little Python server and the three launchers. This
// is the other answer to the same problem: inline the CSS and the module, and
// the whole game is a single document you can double-click, email, or drop on
// any static host. No install, no server, no network.
//
// THE ONE TRAP, and it cost a build that came out three times too big. String
// replacement in JS treats `$&`, `$'` and `$\`` in the REPLACEMENT as capture
// references, and a 2.8 MB minified bundle is full of them — `$'` alone splices
// in everything after the match, so the file inflated 2.95 MB -> 9.16 MB with no
// error anywhere. Pass a function as the replacement and none of it is parsed.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(APP, "dist");
const ASSETS = join(DIST, "assets");

if (!existsSync(join(DIST, "index.html"))) {
  console.error("No dist/ build found — run `pnpm build` first.");
  process.exit(1);
}

const js = readdirSync(ASSETS).filter((f) => f.endsWith(".js"));
const css = readdirSync(ASSETS).filter((f) => f.endsWith(".css"));
// A code-split build would put more than one of either here, and silently
// inlining the first would ship a game missing half of itself.
if (js.length !== 1 || css.length !== 1) {
  console.error(`Expected exactly one JS and one CSS chunk, found ${js.length} and ${css.length}.`);
  console.error("The build has started code-splitting; this script needs to inline all of them.");
  process.exit(1);
}

const jsSrc = readFileSync(join(ASSETS, js[0]), "utf8");
const cssSrc = readFileSync(join(ASSETS, css[0]), "utf8");

let html = readFileSync(join(DIST, "index.html"), "utf8");
html = html.replace(/<script type="module"[^>]*src="[^"]*"><\/script>/, "");
html = html.replace(/<link rel="stylesheet"[^>]*>/, () => `<style>${cssSrc}</style>`);
// The module goes last, after #root exists in the document.
html = html.replace("</body>", () => `<script type="module">${jsSrc}</script></body>`);

// Nothing may still be pointing at /assets — that is the whole point of the file.
if (/(?:src|href)="\/assets\//.test(html)) {
  console.error("An /assets/ reference survived inlining; the file would need the network.");
  process.exit(1);
}

const out = join(DIST, "broadway-and-wall.html");
writeFileSync(out, html);
const mb = (Buffer.byteLength(html) / 1e6).toFixed(2);
console.log(`  dist/broadway-and-wall.html   ${mb} MB   self-contained, opens from file://`);
