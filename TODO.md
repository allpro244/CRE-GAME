# Broadway & Wall: open items (owner requests)

Updated 2026-10-23. Classic is the only interface; the new shell is shelved (`?ui=next`).

## Doing now: lot development in Classic
- [x] Test: sell lots to homebuilders end to end. Engine test `test/homebuild.mjs` passes on seeds 2, 3, 5: builders sign takedowns, build and sell the houses, and the ledger reconciles.
- [ ] Pro forma before you start: cost and time for each stage (permits/rezoning, streets, lot sales) plus the total.
- [ ] Stage timeline while it runs: each stage's length, how far along it is, and months left.
- [ ] Rename "rezoning" to "Apply for permits", and show its timeline when buying a lot.
- [ ] Platted lots show in the portfolio as one neighborhood (lots, sold, value), not one holding per lot.

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
