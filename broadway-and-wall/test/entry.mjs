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
  // economy, industries and sfc: the city's firm books, industries and ledger (ONE_ECONOMY_PLAN.md steps 0-1).
  "economy", "industries", "sfc",
  // why: the cause ledger behind every "Why?" chain (ONE_ECONOMY_PLAN.md §6e).
  "why",
  "sim", "leasing", "actions", "credit", "value", "dev", "debt", "demand",
  "invariants", "rivals", "sponsor", "mix", "acquire", "comps", "propmarket", "market",
  "zoning", "landdev", "lotcode", "lotsplit", "lotsplitGeom", "products", "platdesign", "homes", "homeprice", "growth", "roads", "towngrowth", "unpack", "lenders", "proforma", "workout", "portfolio", "portfoliosale", "auction", "notes",
  "privateCredit", "broker", "loanbook", "amortize", "pricing", "ledger", "rivalDebt", "strategy", "corporate", "firmLog",
  // streetLoans: the private owners' mortgages, loan by loan (ONE_ECONOMY_PLAN.md step 5).
  "streetLoans",
  // absorption carries staleDiscount and leasingOdds — how an owner's ask falls
  // on space that will not let, which the harness bots have to read rather than
  // guess at. space carries the submarket roll-up.
  "absorption", "space", "bands",
  // blackswans: the rare city-dating events (fire, surge, capital wave).
  "blackswans",
  // inputs: the nation's oil price and the input costs buildings and bids read.
  "inputs",
  // contractors: the named general contractors, their bids and the cost index they make.
  "contractors",
  // citygov: City Hall — budget, bonds, policies, the mayor.
  "citygov",
  // plates is floorplate inventory — stacks, vacant blocks, size draws.
  "plates",
  // regime is the pre-history: nationPhase and simulateHistory, so a harness
  // can replay the opening on the engine's own equations.
  "regime",
  // fund is the player vehicle — second cash account, raise, promote.
  "fund",
  // leasehold is the landlord sale-leaseback: sell the land, keep the building.
  "leasehold",
  // jv is a minority partner in one deed; fund.ts carries the waterfall.
  "jv",
  // vehicles is the one answer to "whose equity is inside this deed" — fund,
  // JV partner, later deal vehicles (CAPITAL_RAISING_PLAN.md §12.1a).
  "vehicles",
  // waterfall is the deal waterfall (pure); syndicate is deal-by-deal outside
  // equity on one job (CAPITAL_RAISING_PLAN.md §4).
  "waterfall", "syndicate",
  // reputation: the investor track-record score, the street's rank and bands.
  "reputation",
  // investors: the city's investor pool; raise: a deal-by-deal raise over time.
  "investors", "raise",
  // recap: buying a syndicate's investors out at the waterfall's value.
  "recap",
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
  // competitorTraits — the competitor's sheet, rules, quirks and profiles.
  "competitorTraits",
  // competitorReads — what you know of each competitor's sheet; storyline —
  // headliners, story stages and what's coming (display only).
  "competitorReads", "storyline",
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
  // stories is the paper: features mined from the deed histories, read-only.
  "stories",
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
  // renderView — the render contract Unreal draws from (test/render-view.mjs).
  "renderView",
  // households — the household register (stage 1 shadow; tools/households.mjs).
  "households",
];

export function writeEntry(path) {
  return MODULES.map((m) => `export * from "../src/engine/${m}";`).join("\n") + "\n";
}
