// WHAT THE HARNESSES CAN SEE OF THE ENGINE — one list, one owner.
//
// This list lived inside test/run.mjs, which regenerates `.entry.ts` when it
// runs. `pnpm engine` ran esbuild against whatever `.entry.ts` happened to be
// on disk. So adding a module to the list did nothing until somebody happened
// to run `pnpm test`, and a harness calling the newly-exported function got
// `undefined is not a function` with a bundle that looked freshly built.
//
// A missing export is not a small thing here. It is why a leasing-policy fix
// was first proposed against `E.leasingOdds`, which does not exist in the
// bundle — and the general failure it causes is worse: a harness that cannot
// reach the engine's own function re-derives it, and a re-derivation drifts
// from the original in silence. CLAUDE.md has the case: a clamp probe went on
// reporting a stale expression's bind rate after the engine's had been fixed,
// because it had its own copy of the arithmetic.
export const MODULES = [
  "sim", "leasing", "actions", "credit", "value", "dev", "debt", "demand",
  "invariants", "rivals", "sponsor", "mix", "acquire", "comps", "market",
  "zoning", "lenders", "workout", "portfolio",
  // absorption carries staleDiscount and leasingOdds — how an owner's ask falls
  // on space that will not let, which the harness bots have to read rather than
  // guess at. space carries the submarket roll-up.
  "absorption", "space",
  // staff carries roleState and the role multipliers. Without it a harness
  // cannot ask what a hire is worth and has to re-derive the band — the exact
  // drift this file exists to prevent.
  "staff",
];

export function writeEntry(path) {
  return MODULES.map((m) => `export * from "../src/engine/${m}";`).join("\n") + "\n";
}
