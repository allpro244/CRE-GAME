# LEASING OVERHAUL — floorplate inventory + leasing doctrine

An implementation plan for two changes that land together, written for an
implementing agent that has not read this conversation. Read `CLAUDE.md` first
and treat it as binding: realism outranks preference, difficulty is an output,
no fake numbers, every constant carries its source, and every money movement
goes through the ledger or `pnpm conserve` will find it.

The two changes:

1. **Floorplate inventory.** A building stops being pre-cut into N equal
   suites at development. It becomes a stack of floorplates; tenants arrive
   with their own size requirements; the landlord demises to fit, at a cost,
   and remnants and contiguous blocks become real things with real prices.
2. **Leasing doctrine.** The delegated-leasing product (four mandate dials, a
   desk that imitates the player letter-by-letter under clamps) is deleted and
   replaced with a posted pricing policy — an asking sheet, a hold-out
   schedule, and a committee-by-exception docket — executed by one engine that
   is the same physics whether the player's hand or the desk's holds the pen.

They are one project because the doctrine's pricing is written over the
inventory's size bands (full floor / suite / remnant), and because both exist
to kill the same fault from opposite ends.

---

## 0. The faults being fixed, with the evidence

### 0.1 The desk is structurally worse than the player, by construction

- The mandate sign line is capped at par: `AGENT_FLOOR_MAX = 1.00`
  (`src/engine/leasing.ts:2660-2662`), and the desk's counters cap at
  `market * 1.14` (`agentCounterTerms`, `leasing.ts:2884-2919`). A player in a
  tight market signs at 105–115% of market with little TI; the desk is
  *forbidden to try*. The mandate cannot express the strategy its principal
  actually runs.
- The desk signs the first letter that clears the floor
  (`runLeasingAgent` / `deskVerdict`, `leasing.ts:3086-3090`). It has no
  patience — no way to weigh vacancy carry against the option value of waiting
  for the strong letter. The player cherry-picks the tail of the letter
  distribution; the desk takes the first thing above the line.
- The player's edge is partly real (incumbent stickiness `RENEWAL_STICK`,
  tight-market tolerance — both modelled in `tenantIndifferenceMult`) and
  partly a mechanical exploit: every counter has a hard 4% acceptance floor
  (`pAccept = Math.max(0.04, …)`, `leasing.ts:3884-3886`) and each letter is
  an independent draw, so a player re-sampling across a hundred suites farms
  the logistic's tail for free while paying nothing for their own time. A
  redesign that lets the desk replicate the player must make that throughput
  honest for BOTH parties, or it automates an exploit.

### 0.2 The suite model has the causality backwards

- A building is cut into N equal suites by `useSuiteSf`
  (`src/engine/leasing.ts:138-211`), either from class heuristics or from a
  demise the player chose at development (`rec.suites`,
  `src/engine/types.ts:626,738`; `suiteSfForUnits`, `src/engine/dev.ts:4407`).
  Prospects are then quantised to that cut (`toSuites` at the prospect draw,
  `leasing.ts:1941`).
- In life the demise is an OUTPUT: you build plates, tenants arrive with
  requirements, and the landlord cuts (or holds) the floor to fit. The current
  inversion has required an accumulating pile of compensating machinery — the
  partial-suite probability fill (`leasing.ts:720-800`), the
  remnant-vs-lettability floor distinction (`minTenancySf`,
  `leasing.ts:213-239`), the whole-leg coin — each of which is a patch over
  the same wrong premise, and each of which this plan deletes along with it.
- It also hands the player a degenerate strategy: build many small buildings
  (or coarse demises) purely to minimise per-suite management work. When unit
  count stops being a design input, the strategy stops existing.

### 0.3 Pre-registered realism anchors (write these down BEFORE measuring)

Per `CLAUDE.md`, anchors are stated before any engine output is read, and
shape parameters cite them in comments:

- Median US office lease is roughly 3–6k sf; the size distribution is heavily
  right-skewed (log-normal-like): many small deals, few full-floor users,
  anchor tenants (50k+) rare. (CompStak / JLL national lease comps.)
- A large office tower leases up over ~2.5–4 years in 20–40 transactions
  absent anchor pre-lets. (The existing comment at `leasing.ts:170-177`
  already cites this; keep it true under the new model.)
- Demising cost (partition walls, corridor, split HVAC/metering) runs on the
  order of $5–15/sf of the smaller resulting space; it is construction work
  and multiplies `econ.costIdx`.
- Large contiguous blocks command a premium in tight markets and go begging in
  soft ones (documented block-scarcity premiums in primary CBDs at cycle
  peaks); remnant / oddly-cut space clears at a discount.
- A principal instructs an agent with an asking rent, a standard concession
  package, and a signing authority — not with a "% of model market" dial.

---

## 1. Architecture after the change

Three layers. Keep them separate in code the way they are separate here.

```
PHYSICAL   Building = floors × plate. Vacant inventory = contiguous blocks.
           Demise/merge are EVENTS with costs, not properties of the record.

MARKET     Prospects arrive with size requirements drawn from a distribution.
           One indifference model prices every deal (existing
           tenantIndifferenceMult, extended with size-band adjustments).
           Same physics for player and desk. No 4% farming floor.

POLICY     The player authors a leasing plan (asking sheet + package + holds +
           authority). The engine clears deals against the plan. Exceptions
           surface on a docket; everything else lands in a digest after the
           fact.
```

Multifamily is OUT OF SCOPE for the physical layer: flats run on aggregate
occupancy, not demises (`leasing.ts:413`), and stay that way. The doctrine
layer applies to commercial uses; renewals of flats keep current behaviour.

---

## 2. Phase plan

Work in this order. Every phase ends green on `pnpm gate` and `pnpm conserve`,
with `pnpm check` diffed and any baseline movement explained in the commit.
Rebuild the harness bundle (`pnpm engine`) before EVERY probe — stale-bundle
false conclusions are a documented trap (`CLAUDE.md`, "measuring the WRONG
BUILD").

### Phase 0 — measure the gap you are about to close (no engine change)

Build `test/desk-vs-principal.mjs`: on paired seeds, run (a) the current
delegated desk at default mandate, (b) a "patient principal" bot that counters
every letter to the tenant indifference point and lets the rest walk, on the
same 100-suite portfolio. Record signed NE as % of market, vacancy-months
burned, and net income over 10 years. This is the number the whole project
exists to move; keep the harness — it becomes the parity gate in Phase 6.

Expected finding (verify, don't assume): the bot beats the desk materially in
tight markets, and a large share of its edge disappears when the 4% floor in
`pAccept` is removed — that share is the exploit, not the strategy.

### Phase 1 — floorplate inventory (engine only, behaviour-preserving where possible)

**New model** (in a new file, `src/engine/space.ts` already exists — extend it
or add `src/engine/plates.ts`):

```ts
/** One commercial component of one building, as floors. */
interface PlateStack {
  use: Exclude<BuiltClass, "multifamily" | "land">;
  plateSf: number;          // useSf(rec, use) / floorsOfComponent
  floors: number;
}
/** A contiguous vacant space. Derived + cached, persisted on the holding. */
interface SpaceBlock {
  id: number;
  use: BuiltClass;
  floorLo: number; floorHi: number;   // inclusive; equal for partial floors
  sf: number;
  kind: "floors" | "partial" | "remnant";
  cuts: number;              // demising walls standing on this space
}
```

- `Tenant` gains `floorLo?/floorHi?` (`types.ts:70`); `LOI` gains
  `blockId?` (`types.ts:165`). Optional fields, absent on old saves.
- Derivation rule, one function, one source of truth:
  `blocksOf(rec, holding): SpaceBlock[]` — walk floors, subtract tenant sf,
  merge adjacent free space. Invariant: `Σ blocks.sf + Σ tenants.sf ==
  useSf(rec, use)` per component, to the foot. Add this to
  `src/engine/invariants.ts` next to the existing demise checks
  (`invariants.ts:436-462`), replacing them.
- **Remnant definition** (mechanism, not magic number): a `partial` space is a
  `remnant` when it is under 35% of its plate AND under the class's market-norm
  suite size. Comment the 35% with its meaning (a space that cannot take a
  standard suite layout without borrowing the corridor) — it is a shape
  parameter, say so.
- **Save migration** (`src/engine/save.ts`): assign existing tenants to floors
  deterministically (largest tenant lowest floor, per component, stable by
  tenant index — no RNG draws, migrations must not touch any stream). Vacancy
  falls out as blocks.
- **Rent-roll generation** (`genRentRoll` / `buildRentRoll`,
  `leasing.ts:720-800`): replace the suite-count walk with a floor walk that
  places tenants of distribution-drawn sizes until the occupancy target is
  met. KEEP the private per-parcel RNG stream discipline exactly as documented
  in `HANDOFF.md` §4 — the stream swap in `genRentRoll` stays; only the code
  inside it changes. Aim the generated size distribution at the same anchors
  as Phase 2 so bought buildings and leased-up buildings agree.
- Delete: `useSuiteSf`'s equal-cut logic, `suiteSf`, `unitsOf`/`spacesOf`
  consumers re-derived from blocks (`leasing.ts:241-341`), the partial-suite
  coin machinery, `rec.suites` and its writers (`types.ts:626,738`,
  `suiteSfForUnits` `dev.ts:4407`, the DevelopDesk suite picker in
  `src/ui/panels/DevelopDesk.tsx`), and the pre-let demise special case at
  `dev.ts:2511-2531`. `COMMERCIAL_SUITE_MIN` survives ONLY as a parameter of
  the demand distribution (Phase 2), not as a clamp on inventory.
- `specSuites` / `makeReady` (`leasing.ts:2248-2352`) re-point at blocks:
  a spec suite is a fitted `partial` block; make-ready attaches to a block id.

This phase changes world output (rolls are generated differently), so it is a
century re-roll. Accept it once, here: regenerate `BASELINE.json` in this
phase's final commit with the reason in the message, and do not re-roll again
in later phases.

**Done when:** the block invariant holds over `pnpm test` invariant sweeps;
`pnpm conserve` is green; a fresh 60y no-player run shows citywide occupancy
and vacancy medians within noise of pre-change (`pnpm vacdist` before/after —
the change re-cuts buildings, it must not move the macro market).

### Phase 2 — demand with a size requirement; demise and merge as events

- **Requirement draw**: in the prospect generator (`tickLeasing`,
  `leasing.ts:1877-2070`, the `toSuites` call at `:1941`), replace
  suite-quantised `sf` with a draw from a per-class log-normal, parameters
  chosen to hit the pre-registered anchors (office median ~5k sf, p95 ≈ one
  full plate of the reference tower; retail smaller; industrial larger,
  whole-shed biased). Document parameters with the anchor in the comment.
  Requirements larger than one plate are multi-floor requirements and match
  only `floors` blocks.
- **Matching**: a prospect tours the smallest block that fits (respecting
  Phase 3 hold rules once they exist; until then, no holds). If the fit
  requires a cut, the LOI carries `demiseSf`/`demiseCost` so both the player
  card and the desk see the all-in deal.
- **Demise event** (on signing): book demising capex through the ledger —
  `fundAndBook(next, parcels, cost, "capex")` alongside TI in the signing
  path (`signLoi` / `leaseCosts`). Cost: `DEMISE_PSF × min(newSf, remnantSf) ×
  econ.costIdx`, `DEMISE_PSF` from the $5–15/sf anchor — pick $9 and cite it.
  The remnant becomes a `remnant` block. Run `pnpm conserve` immediately after
  wiring this; it is the cheapest test in the repo and the only one that can
  see an unbooked payment.
- **Merge event**: when adjacent space frees (expiry, default, buyout), blocks
  auto-merge; if a demising wall stood between them, queue a `makeReady` at
  the same $/sf source so recombination costs what it costs.
- **Pricing by size and shape**, one function: extend `loiMarket`
  (`leasing.ts:2760+`) with a size/shape term — full-floor and multi-floor
  blocks earn a premium that scales with the class's tightness (reuse the
  existing `tight` expression in `respondLOI`, do not invent a second one);
  remnants clear at a discount. Sized from the block-premium anchor; both ends
  bounded and the bounds are guards, not policy — wire them into the rail
  counters like every other watched rail.
- **The 4% floor dies here**: `pAccept = Math.max(0.04, …)`
  (`leasing.ts:3884`) drops to a numerical guard (0.005). This is the exploit
  half of the player's edge; removing it before Phase 3 means the doctrine is
  never asked to imitate a farm.

**Done when:** a new probe `test/demise.mjs` shows (a) tower lease-up hits the
anchor (20–40 deals, 2.5–4y, no whale-only rolls), (b) demise + merge conserve
area and money over 50y, (c) remnant share of vacant sf is a minority and
falls when the market softens (tenants take clean space first).

### Phase 3 — the leasing plan (doctrine state + one clearing engine)

**New state** on `GameState` (`types.ts`, near the current agent fields at
`:2630-2707`):

```ts
interface LeasingPlan {
  /** Asking sheet per commercial class; bbl overrides win over class rows. */
  sheet: Partial<Record<BuiltClass, PlanRow>> & { byBbl?: Record<string, PlanRow> };
  /** Deals the desk may sign without the principal, total lease value $. */
  authority: number;
}
interface PlanRow {
  quotePct: number;          // ask vs current model market, e.g. 1.08. NO CAP AT PAR.
  bandAdj?: { fullFloor?: number; remnant?: number };   // ± on quotePct by size band
  maxTiPsf: number; maxFreeM: number; minBumpPct: number;
  termLoM: number; termHiM: number; minCredit: Credit;
  /** Hold-out: keep quoting at quotePct for holdM months of vacancy, then
   *  step quote down stepPct per quarter, never below floorPct. */
  holdM: number; stepPct: number; floorPct: number;
  /** Contiguity holds: floors kept whole for a block user. */
  holdBlocks?: { floorLo: number; floorHi: number; untilM?: number }[];
}
```

- The par cap is gone by design: `quotePct` may exceed 1.0 and the cost is
  time-on-market, priced by the same indifference model as everything else.
  The old band comment ("above par the desk would refuse everything",
  `leasing.ts:2467`) described a market this game does not always have; delete
  it with the code.
- **One clearing engine**: `clearAgainstPlan(s, loi, plan): "sign" | "docket"
  | "decline"` replaces `deskVerdict`/`agentCounterTerms`/`runLeasingAgent`'s
  band logic (`leasing.ts:2643-3350`). The desk counters every workable letter
  to the plan's quote (with the plan's package) through the SAME
  `tenantIndifferenceMult`/`pAccept` path the player uses — same function,
  same draw channel (`"leasing"`), so desk and principal face identical
  physics. A letter that cannot reach the sheet declines silently; the
  step-down schedule reprices the quote as a block's vacancy ages
  (`darkMs` already tracks this — read it, don't add a clock).
- **Docket triggers** (exceptions only — this list IS the player's remaining
  job): over `authority`; off-package (needs more TI/free than the row allows
  AND clears the row's quote — the "great tenant, expensive ask" case); term
  outside band; any deal breaking a `holdBlocks` rule; expansions (already
  flagged as the decision worth having, `types.ts:170-176`); anything the
  treasury control refers (`agentCashReserve` stays exactly as is,
  `leasing.ts:2721-2739`, as does deal authority keyed on the mandate,
  `leasing.ts:2149-2213`).
- **Who holds the pen**: a plan executes only where a desk exists — firm agent
  (`s.agent`, fee unchanged) or leasing staff (`s.teamLeasing` coverage
  rules unchanged, `leasing.ts:2920+`). With no desk, letters land on the
  player exactly as today; the plan editor is the delegation product, not a
  free autopilot. `renewalMgmt` and `RENEWAL_MGMT_FEE` fold into the same
  engine: a renewal clears against the plan row with the incumbent's
  stickiness premium; the separate renewal desk (`runRenewalDesk`,
  `leasing.ts:3405+`) is deleted.
- **Migration**: absent `s.leasingPlan`, behaviour is the legacy dials so old
  saves keep working for one release; when a save with `s.agent` and old dial
  fields loads, synthesise a starter plan (`quotePct: agentFloor(s)`, package
  from the TI/signing caps) and mark the dials deprecated. Delete the dials
  (`agentFloor…agentMaxSigningMonths`, `types.ts:2670-2707`, accessors
  `leasing.ts:2672-2712`) in Phase 5, not here.

**Done when:** `test/plan-desk.mjs` (new) shows monotonicity — raising
`quotePct` lowers deal count and raises signed NE%, `holdM`/`stepPct` trade
vacancy for rent in the measured direction — and the Phase 0 harness re-run
shows the desk under a player-equivalent plan lands within a few points of the
patient-principal bot, with the residual gap explained by fees, not by clamps.

### Phase 4 — docket and digest (UI)

- **Docket**: extend the existing docket (`src/ui/docket/Docket.tsx`,
  `build.ts`) with leasing exception cards — one screen, line-item
  approve / counter (opens `LoiNegotiate.tsx`, which survives for exactly
  this) / decline. No more per-letter modal stream where a plan is active.
- **Digest**: extend `deskMonth` (`types.ts:2640`) into a quarterly record —
  signed count and avg NE% of market by size band, walked/declined, vacancy
  months burned, capital out (TI + demise + commissions), and one advisory
  line: the clearing quote the market would have borne vs the sheet ("your
  sheet is 6 points over where deals cleared; you bought 31 vacant-months
  with it"). Render in `LeasingPage.tsx`; the plan editor lives there too
  (class rows + per-building override + hold-blocks picker on the stacking
  list).
- **Stacking view**: `PropertyPage.tsx` lists blocks per floor (tenant, sf,
  expiry | vacant, kind, months dark). A list, not a diagram — the diagram is
  a later nicety.
- Remove the mandate-dials UI (currently in `RightPanel.tsx` /
  `StaffPage.tsx` per the grep of `agentFloor` consumers) and the DevelopDesk
  suite picker.

### Phase 5 — deletions, docs, baseline

- Delete the legacy dial fields, accessors, `deskVerdict` bands,
  `agentCounterTerms`, `runRenewalDesk`, and the last `useSuiteSf` callers.
  `grep -n "agentFloor\|agentPassBelow\|useSuiteSf\|minTenancySf\|toSuites"`
  must come back empty in `src/` outside `save.ts` migration code.
- Update `HANDOFF.md` (new §: the leasing overhaul, what moved and why),
  `BUILDINGS.md`, `ATTR_CONTRACT.md` if attribution touches leasing, and the
  Glossary entries for suite/demise/mandate.
- `pnpm baseline` once, with the commit message naming every standing number
  that moved and the phase that moved it.

### Phase 6 — adversarial measurement (do not skip)

- `pnpm stress`: the dominant-strategy sweep must show hands-off-with-plan is
  NOT strictly dominated by manual grinding (the Phase 0 gap closed), and NOT
  strictly dominant either (fees and information loss are real).
- `pnpm report` + `pnpm audit`: no band newly breached without a written
  explanation; the backwards-wire check on the new block-premium term (a
  tightening market must WIDEN the full-floor premium; if it narrows it, the
  wire is backwards and that is worse than broken).
- Re-run `pnpm vacdist` and the Phase 0/2/3 harnesses; paste the tables into
  the PR/commit description.

---

## 3. Rules for the implementing agent (repo law, condensed)

- **RNG stream discipline.** All new leasing draws use the named `"leasing"`
  channel (`rng(s, "leasing")` / `rrange(s, …, "leasing")`) or the private
  per-parcel stream inside `genRentRoll`. Never add or remove draws on the
  shared world stream in a patch you claim is behaviour-preserving — a changed
  draw count re-rolls the century (the glut study's placebo moved ±30pp; see
  `GLUT_FINDINGS_2026-08.md`). Phase 1 is the one sanctioned re-roll.
- **Ledger discipline.** Demise capex, merge make-ready, TI, commissions:
  every `s.cash` write pairs with `logBooks`. Run `pnpm conserve` after every
  money-touching commit.
- **No fake numbers.** Every new constant carries a comment saying whether it
  is a fact (with source) or a shape parameter (with the anchor it was
  calibrated against). If a number exists to make a median run look right, the
  fix is upstream.
- **Rails are guards.** New clamps (premium bounds, pAccept guard) get wired
  into the rail-bind counters so `BASELINE.json` can watch them. A rail that
  binds in normal play is a bug.
- **Do not tune the desk until the parity number looks good.** If the desk
  underperforms the bot, find out whether the plan cannot express the strategy
  (fix the plan schema) or the market punishes it (that is the answer) — and
  say which, with the measurement.
- `pnpm engine` before every probe; `pnpm gate` before every commit that
  moves money; `pnpm check` diffed in every commit touching the world.

## 4. Explicitly out of scope

- Multifamily demising (flats stay an occupancy rate).
- The chronic-shortage / glut-frequency work (separate findings, separate
  plan — see the demand investigation; nothing here should try to fix market
  balance through leasing constants).
- Stacking-plan graphics beyond the block list.
- Broker/exclusive marketing (`Holding.broker`) — unchanged; it works the
  phones regardless of who signs.
