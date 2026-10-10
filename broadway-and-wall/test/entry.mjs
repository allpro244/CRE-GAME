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
  "zoning", "lenders", "proforma", "workout", "portfolio", "portfoliosale", "auction", "notes",
  "privateCredit", "broker",
  // absorption carries staleDiscount and leasingOdds — how an owner's ask falls
  // on space that will not let, which the harness bots have to read rather than
  // guess at. space carries the submarket roll-up.
  "absorption", "space",
  // plates is floorplate inventory — stacks, vacant blocks, size draws.
  "plates",
  // staff carries roleState and the role multipliers. Without it a harness
  // cannot ask what a hire is worth and has to re-derive the band — the exact
  // drift this file exists to prevent.
  "staff",
  // regime is the pre-history: nationPhase and simulateHistory, so a harness
  // can replay the opening on the engine's own equations.
  "regime",
  // people is the Person substrate (player, hires, rival principals). Missing
  // from this list once made every harness re-derive a person — silent drift.
  "people",
  // fund is the player vehicle — second cash account, raise, promote.
  "fund",
  // leasehold is the landlord sale-leaseback: sell the land, keep the building.
  "leasehold",
  // jv is a minority partner in one deed; fund.ts carries the waterfall.
  "jv",
  // standing is the reading of the score: the street ranking, the year marks, the reviews.
  "standing",
  // buybox is the sponsor's standing acquisition criteria (what a first look must match).
  "buybox",
  // goals is the run's chosen ambition: progress and verdict, pure reads.
  "goals",
  // setup is the setup page's world: eras, credit position, field, the family book.
  "setup",
  // firmCapital — institutional standing readout (ATTR_CONTRACT Phases 5–6).
  "firmCapital",
  // books carries the balance-sheet stamp and month→year view helpers the
  // Books page uses for monthly income and last year's close.
  "books",
  // facility carries the portfolio loan: the quote, the pool score, the release
  // price and the tick. A harness that cannot reach it cannot test the one
  // instrument in the game that can take the whole book at once.
  "facility",
  // owners carries the register of named private holders: who owns what, what
  // they think of you, and when they leave the market.
  "owners",
  // offmarket is the firms' acquisitions desks: the calls they make to holders who have not listed.
  "offmarket",
  // peers is the league table: real US cities, read relative to the US and laid on this game's nation.
  "peers",
  // ownership is the merged view over both registers — every deed in town, its
  // owner, and that owner's balance sheet and income statement.
  "ownership",
  // supply is the one project queue shared by map deliveries and the economy.
  "supply",
  // tax carries property-assessment appeals and board decisions.
  "tax",
  // history carries permanent sparse property chronicles.
  "history",
  // save exposes pure migration steps for round-trip coverage.
  "save",
  // attentionRoute — inbox key → desk routing (attention-route harness).
  "attentionRoute",
  // deliveryNotice — which openings interrupt the player (top 1% by area).
  "deliveryNotice",
  // takeprivate — buying a rival firm whole (test/take-private.mjs).
  "takeprivate",
  // jev — Jev (TypeSafe) informing rival firms' decisions; jevmatch the setup
  // and standings (test/jev.mjs, tools/ai-match.mjs). aibooks is their deal ledger.
  "jev", "jevmatch", "aibooks",
];

export function writeEntry(path) {
  // The AI controller lives outside the engine (it is async and does I/O) but
  // the headless match runner drives it with the same bundle.
  return MODULES.map((m) => `export * from "../src/engine/${m}";`).join("\n")
    + `\nexport * from "../src/ai/index";\n`;
}
