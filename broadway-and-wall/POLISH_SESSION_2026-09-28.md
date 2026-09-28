# Polish session — 2026-09-28

A long player-experience pass, PRs #141–#149 onto the default branch. Read this before
touching any of the systems below; each bullet names where it lives.

## Money and one-quantity fixes (each has a test that fails on the old code)

| Fault | Fix | Test |
|---|---|---|
| Mezz coupon paid twice a month (`serviceMezz` paid + booked it AND returned it into the holding's debt cash) | paid once, through the senior's door | `test/mezz-coupon.mjs` |
| Fund settlement left the LPs' buildings on the sponsor's book at 100% (+114% net worth in one month) | 24-month extension, then sponsor buy-in at NAV through the waterfall; unaffordable deeds go in kind to a liquidating trust (`windDownFund`, sim.ts) | `test/fundsheet.mjs` |
| Books' balance sheet ≠ engine net worth (up to 47%) | consolidates like `portfolioMark`: fund as GP interest, JV partners' share, mezz as debt | `test/fundsheet.mjs` |
| Fund parked 60% of commitments at close (pref drag) | 25% at close, each vehicle purchase calls its own equity | `test/fund.mjs` (now in check) |
| A realised fund demoted the firm a tier | realised fund scores 0.75 on the vehicle pillar | — |
| Adaptive reuse hurdle used the bare cap, ground-up the tax-loaded exit | both use the tax-loaded exit yield | — |
| `test/fund.mjs` asserted the pre-#143 waterfall | updated to pref → capital → split, co-invest pro rata | `test/fund.mjs` |
| Portfolio sale of fund deeds paid every leg to the sponsor (+$4.29M cash, +36% NW in a click); mixed bundles and mixed unsolicited approaches allowed | fund legs settle into `fund.cash` like `acceptSaleOffer`; mixed bundles refused (`mixesVehicles`); approaches are per class *and* per book; no 1031 on a fund gain | `test/fund-plumbing.mjs` |
| Sponsor paid the fund deeds' leasing, capex, payoffs, cures and income tax (~20% of vehicle NOI) | every deed-tagged `logBooks` on a live fund deed settles against the vehicle (`settleVehicleDeedFlow`, types.ts): its cash → a capital call → a recorded GP advance repaid first; the vehicle's income tax is struck on its own line | `test/fund-plumbing.mjs` |
| No automatic distributions — proceeds sat in `fund.cash` for years while pref accrued | after `investEndM`, quarterly distribution of cash over `fundReserve` through the waterfall (`scheduledDistribution`, fund.ts) | `test/fund-plumbing.mjs` |

## New systems

- **Per-deed equity ledger** — `logBooks(…, bbl)` dual-writes each property dollar to
  `s.deedCf[bbl]`; exits carry `equityIn / equityOut / irr` (levered, pre-tax).
  Pooled deeds (facility, fund buy-in, old saves) report nothing rather than a wrong number.
  `test/deedledger.mjs` holds noi/leasing/capex/dev tagged == books to the dollar.
- **Standing** (`engine/standing.ts`) — street rank, year marks, year review, career card,
  `positiveLeverage`, `periodRecap`, `firmTier`.
- **Continuous Play** (`ui/AutoPlay.tsx`, `stopRule` exported from sim.ts) — pauses on exactly
  what Yr stops on.
- **Watchlist** — `s.watch`; a watched listing is an attention item (`watch:` key).
- **Rewind points** — first autosave of each calendar year, last five, per run seed
  (`writeRewind` in store.ts); offered on the game-over card.
- **Run records** — localStorage `bw:runs`, start screen "Your best runs".
- **Sounds** — WebAudio synthesised, `ui/Sounds.tsx`, localStorage `bw:sound`.
- **Map event pops** — `map/EventPops.tsx`, a diff of `prevForDigest` vs the live game.

## Quieter clock

- Private lenders cool off a building for 12 months after a lapse/decline (`privateQuoteCool`).
- Broker first looks / off-market files stop the clock only when the firm could fund the
  deal at a 65% loan (`canClose` in attentionItems); `s.brokerStops = "never"` turns them off.
- Idle leasing hires are flagged (docket row, Staff page) — the pen is a real decision, never
  flipped silently.

## Graphics

Per-building state texture (`aBid` → one texel: owned, lens, highlight, sink height) so state
changes upload 16 bytes; lit civic works; lenses keep the 3D city; owned parapet band;
selection as light; framed Go-to; demolition sinks / delivery rises; formwork and a crane
trolley on sites. See the commit messages on `ThreeBuildings.ts` and `MapView.tsx`.

## Later in the session (PRs #149–#153)

- **One development pro forma** (`engine/proforma.ts`, `developmentProForma`): the land
  residual (`landRead`) and `planDevelopment` now run the same stack — massing, street
  retail, GMP, rents on the expected market, lease-up reserve, the construction desk's real
  terms, land carry over the scheme's own months. At the residual's scheme and a basis equal
  to the residual the hurdle reads 1.000 on every lot (`test/residual-recon.mjs`; was
  p05/p50/p95 0.81/1.10/1.54). BASELINE.json was regenerated for it — median land +30%,
  p10 +76%, floor area −9%; see ECONOMY.md. Ticks are ~50% heavier (landRead runs the pro forma).
- **Standing sale instructions** (`applySaleInstructions`, actions.ts) and the **buy box**
  (`engine/buybox.ts`) — the two largest sources of clock stops, now under the player's rules.
- **Goals** (`engine/goals.ts`) — optional target + deadline chosen at the start.
- **Returns to date** (`returnsToDate`, standing.ts) — the deed ledger read on held buildings.
- **First hour**: starter building named in the docket/Marketplace/HUD, offer-grid funding and
  letting rows, negative-leverage default to cash, letter terms on docket rows, glossary.
- **Graphics batch 2**: dusk during Play, blue-hour photo frame, street lights, boats, dust,
  sea-mesh wedge fix.
- **Review fixes**: underwater fund deeds never bought in, in-kind exits pooled, autosave is
  max-wait with serialized writes (Play used to never save), dead-branch rewind points pruned.

## Reviewer batch 4 (PR #154)

- Revolver over-advance charges a 5%/yr default margin on the excess (was 25% a month).
- `operatingReserve` (credit.ts) — max($250K, six months of debt service) — is the one
  reserve the LOC sweep and the leasing agent keep.
- Listing rent rolls age: expired leases drop off (sim.ts). This alone moved 8 baseline
  metrics (office rent index +16.7%); see ECONOMY.md "A listing's rent roll ages".
- Underwater counter resets on a month above water; capital-plan stops fire once per streak.
- Landlord goal counts flats and JV share; returns-to-date floors non-recourse equity at 0.
- Fund quote refuses a raise the GP cannot co-invest in.
- Buy box: **land that pencils** (`landPencils`, buybox.ts) — one function for the box and
  the Marketplace PENCILS chip.
- A "refinance at maturity" instruction was considered and dropped: `serviceLoan` already
  rolls a maturing performing loan to the cheapest desk that sizes the whole balance.

## Open, measured, not done

- Report letter H (the glut is seen) moved OK → BAND with the pro-forma reconciliation:
  rate-policy drift during the glut +1.31pp vs a ≤ +0.35 band. Informational; worth a look.
- Sale instructions act on single offers, not a marketed campaign's bid list.
- landRead cost: a memo keyed on the market object plus a fingerprint of every scalar on the
  lot and the market hit 64% of calls but saved nothing — fingerprinting the market each call
  cost what the pro forma did. A cheaper invalidation (a market version counter bumped where the
  tick mutates econ) would be the way to recover the time.
  **DONE (perf branch):** `landPsfNow` now memoises on exactly landRead's read-set (≈50 market
  fields compared in place, 9 lot fields), skips the holder residual when the builder's is
  positive, and the tick got a plain-data clone, a per-scan cornice memo and a per-lot occHash
  memo. ~2.3x on advanceMonth; state hashes byte-identical over 3 seeds × 40 years.
- Late game: platform sale / listing using `sellStake` + `listPortfolio` machinery.
