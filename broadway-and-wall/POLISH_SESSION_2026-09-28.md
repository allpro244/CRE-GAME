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

## Open, measured, not done

- Land residual (`landRead`) vs `planDevelopment` disagree by −30…+45% at breakeven on the
  same scheme — an agent was reconciling this at the end of the session
  (`test/residual-recon.mjs` if it landed).
- "Offer in hand" is 52–71% of all clock stops — standing sale instructions were in
  progress (`test/sale-instructions.mjs` if it landed).
- Buy criteria for broker first looks (class / submarket / min yield) would replace the
  affordability screen with the player's own.
- Late game: platform sale / listing using `sellStake` + `listPortfolio` machinery.
