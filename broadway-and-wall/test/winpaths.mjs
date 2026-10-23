// WINDOWS: LET THE HARNESSES IMPORT ABSOLUTE PATHS.
//
// Every harness loads the engine with `await import(join(HERE, ".engine.mjs"))`.
// On Linux that is "/…/test/.engine.mjs" and Node takes it. On Windows it is
// "D:\…\test\.engine.mjs", which Node's ESM loader rejects as a URL with the
// scheme "d:" — so on the owner's PC not one harness could start. This hook
// turns a drive-letter specifier into a file:// URL before resolution, and is
// a no-op everywhere else. Loaded for every pnpm script by `.npmrc`
// (node-options), so the 250-odd harnesses stay exactly as they are.
import { register } from "node:module";

if (process.platform === "win32") {
  register("data:text/javascript," + encodeURIComponent(`
    import { pathToFileURL } from "node:url";
    export function resolve(spec, ctx, next) {
      return next(/^[A-Za-z]:[\\\\/]/.test(spec) ? pathToFileURL(spec).href : spec, ctx);
    }`));
}
