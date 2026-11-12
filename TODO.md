# Broadway & Wall: open items (owner requests)

Updated 2026-10-23. Classic is the only interface; the new shell is shelved (`?ui=next`).

## Doing now: lot development in Classic
- [x] Test: sell lots to homebuilders end to end. Engine test `test/homebuild.mjs` passes on seeds 2, 3, 5: builders sign takedowns, build and sell the houses, and the ledger reconciles.
- [ ] Pro forma before you start: cost and time for each stage (permits/rezoning, streets, lot sales) plus the total.
- [ ] Stage timeline while it runs: each stage's length, how far along it is, and months left.
- [ ] Rename "rezoning" to "Apply for permits", and show its timeline when buying a lot.
- [ ] Platted lots show in the portfolio as one neighborhood (lots, sold, value), not one holding per lot.

## UI clean-up follow-ups (2026-11-10, ui-revamp/CLEANUP_PLAN.md)
Done 2026-11-11: letter cards' prose to hover; one rent-vs-market colour rule (above market red, below green, ±10% plain); a held building under construction is one Portfolio row; the Debt table fits at 1366px; your own Deals 12m.
- [ ] Players' "Deals 12m" counts the street log, which keeps 600 entries; a bigger town could truncate it.
- [ ] Lender capital multiples like 115.81× and 1111× (Tidewater, Bowline): engine numbers, worth a look by whoever owns lenders.ts.
- [ ] Investor rows are named by matching the engine's "N.NNx held" label to `reputation.held` in order; an engine-side `bbl` on the evidence row would make it exact.
- [ ] Not checked inside Unreal itself (the unreal MCP server was unreachable); checked in Chromium at 1920x1080 with ?host=unreal and at 1366x768.

## Economy findings to fix (2026-11-12, measured on 4 seeds x 50 years)
- [ ] **Flats grow fastest while 14-20% vacant.** Stock grows 25-60% over 50 years; the vacancy sits in blocks that get leads, asking ~1.1x the flats' market rent. Each household's guest card already prices its best alternative, so landlords are not simply over-counting leads. Suspect the demand side: how many households look for an island flat may not respond to lower rents, so an overbuilt market stays empty whatever landlords ask, rents follow budgets, and builders keep building. Check `want` / the mainland pool's response to rent (households.ts), and what builders read when they pencil flats.
- [ ] **Industrial occupancy falls ~22% in the first 3 years** (seed 11: street industrial tenants lease 2.49M sf at month 1, 2.0M by year 3) and the vacancy weighs on industrial for decades. Not the opening over-filling industries (islandFill ~1.0); the tenants' staffing (`t.staff`) shrinks after signing while the town's factory employment holds. Small unrated tenants (90% of industrial) fail ~16%/yr on books with 3.5x leverage and 1.5 months of cash.
- [ ] **Office effective rent still swings 9-11% a year** after the filtered read (was 19-25%; retail 4%). Office comps' dispersion is 28% around the address market rent: find what spreads them (packages, bargaining, quality normalisation).
- [ ] **Cap rates move 60-120bp a year** (log sd 6-12%), in a 4-13% band; real classes move ~30-60bp.
- [ ] Two tests already fail on main: `refi-strong` "coverage moves on standards" (expects a removed rule) and `loanbook` (calls the removed `deskRatePct`).

## Next
- [ ] Offer system revamp (waiting on owner OK): price plus terms (deposit, due diligence, financing, closing speed), a seller read, back-and-forth as a thread, live numbers.
- [ ] Bring the new shell's features into Classic where they're worth it:
  - Markets charts
  - Lease offer cards with Sign / Counter / Decline
  - Refinance borrow slider and fixed/floating options
  - Rent roll leasing plan
  - Holdings: under-construction tag and completion date
  - For sale: Demand column
- [ ] Downtown blends into the land around it: parcel sizes, building density and streets taper off instead of stopping at a hard edge.
- [ ] Streets look boring: medians, lane markings, crosswalks, street furniture, variety.
- [ ] Camera zoom-out: two causes fixed (the "2" key; plat preview framing). Confirm in play that it no longer happens.

## On hold
- [ ] Multifamily rent roll unit mix (1-beds, 2-beds...): owner said wait.
- [ ] House and road visuals: waiting on asset packs.
- [ ] Farm/tract value re-mark after a rezoning filing: half-done in worktree `agent-adc0c0135f6ee69fc` (`claude/land-marks2`).
- [ ] `unreal/tools/region-driver.js`: update for the new home screen.

## Done this round
- Hover outline and info card; Go to; yellow roofs removed; floodplain removed; pop-ups on by default
- Classic is the only interface; the Classic build desk spans the page
- Design preview quality; build desk Form / Look / loan options
- Packaging fix: rebuild `playable/` before every package, and PRs go to `--base main`
