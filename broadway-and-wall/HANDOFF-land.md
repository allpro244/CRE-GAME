# Handoff: land (#24) and step 7b (big books) — branch `claude/land-7b`

## Done (all in `src/engine/propmarket.ts` unless noted)
- **Land bid rounds.** `landMaxPrice`: a builder bids its own residual (the street's scheme from `landRead`, its own `firmMargin`, the queue wait backed out — a builder that buys is at the front of the queue); a land banker (`landBanker`, does not build) bids the holder's option (`landRead().holder`). `landBidRound` shades by the room and caps by cash. Wired into `actions.ts tickListingAbsorption` (non-`halfBuilt` lots); a failed round haggles the ask like buildings.
- **Texture level read.** The `landIdx` formula in `market.ts` is gone (its econ-stream draw kept as `void rrange`). `tickLandRead` sets `econ.landIdx` to the weighted median level implied by `s.landTape` over 12/24/36 months, needing 5 prints' weight or the read stays stale. Prints come from `printLandTrade` (called in `comps.ts recordComp`) and are kept ONLY for arm's-length (not distress or off-market) closed sales to a land banker on a texture-governed lot.
- **7b.** `packageBids`: firms with a 36-month track record value the book deed by deed (`maxPrice` / `landMaxPrice`) and bid only what they can fund themselves (account + line + desks' loan). `portfoliosale.ts tickPortfolios` clears at the best bid over the seller's floor (`p.reserve`, or 92% of the ask; a lender takes 88%); `sizeDiscount` is deleted. Street packages list at the sum of appraisals, with the reserve from `sellerTerms(forced)`. A receiver's break-up lists at `forcedSalePrice`.
- **Ledger.** #24 and #27 have moved to Removed in `FORMULA_LEDGER.md`.

## Owner's rules
- No fund raises and no joint ventures for packages. No portfolio discount formula: the price is just the best bid, and if nobody can fund the cheque there is no bid.
- No visual changes. Stay out of `leasing.ts`, `NATURAL_VAC` and `rentDriftAt` (the tenant-market agent owns them).

## Not verified (the last check run was stopped)
- After the final 7b simplification (commit 1fc34cfa): `test/property-market.mjs`, `test/reo-books.mjs`, `test/conserve.mjs` and `node tools/baseline.mjs` were NOT re-run, and BASELINE.json is main's.
- One run each, then regenerate the baseline and say why in the commit. Then `node package/refresh-playable.mjs`.

## Measurements and gotchas
- Most listed dirt has no building case even at peak rents. 168 land rounds in 5 years: 159 drew no bid at all. Land trades are therefore far fewer than under the old ask-clears path.
- Reading the texture level off bids, surveys or distress prints collapses it: land median 61 to 8 $/sf over 6 seeds and 25 years. The texture has no buyer in this town, so the read now stays near its provisional opening level. The real fix is long-horizon land buyers (owner-users, holders beyond 5 years), which is not built.
- A builder buying a texture-governed lot is evidence that the lot pencils for that builder, not evidence about the texture. Do not print it as texture.
- Do not count `rng(s)` draws away in `portfoliosale.ts` or `sim.ts`: the default channel is "econ", and changing the draw count re-rolls the national path.
- ms/month rose about 25% on a single-seed probe (shared machine, so the figure is noisy). Suspects: `landBidRound` (59 builders × `landMaxPrice`) and `packageBids` (two loan quotes per deed per month). Cache per month if it holds.
- Still open: #25 (half-built frame ask), and location-specific rent history by district for the prime cap spread.
