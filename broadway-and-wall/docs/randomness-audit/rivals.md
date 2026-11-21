# Fake-number audit: rivals, credit and swans

Verified against main at c75ef8b (#838), 2026-11-20.

Scope: `broadway-and-wall/src/engine/` {rivals, sim, blackswans, swans, privateCredit, lenders, debt, credit, portfolio, portfoliosale, investors, competitorTraits, workout, sponsor}.ts. The new firm files (firm.ts, firmCapital.ts, firms.ts, firmLog.ts) were scanned too; none of them contains a draw. Read-only audit.

Line numbers are from the working tree at c184d44. That tree had a merge of `c75ef8b` in progress (4 unmerged files, none of them engine files). Every row of the first pass was found again by searching for its content.

How the code was traced:
- **Random draws** through `rng()`, `rrange()`, `hash01` / `spinHash` / FNV hashes, `circleNoise` and `newsChance`. A `void rng(...)` kept only so streams do not re-roll decides nothing and is not listed.
- **Bounds** through `cl()`, `clamp()`, `clampSigned()` and `Math.min` / `Math.max` wherever they bound an economic quantity.

Buckets: **FAKE** (a roll or bound deciding something the model should compute, or a tuned constant), **EXOGENOUS** (an outside shock or firm luck; keep, but size it from data), **PHYSICAL** (a definition), **GUARD** (should never bind), **COSMETIC** (news text only).

Status: **STILL** (as before, at the current line), **CHANGED** (the mechanism moved; the note says what is left), **NEW** (not in the first pass). **GONE** rows are listed at the end.

## Table

### FAKE

| file:line | kind | what it decides | bucket | why | proposed replacement | sev | Status |
|---|---|---|---|---|---|---|---|
| rivals.ts:5011, 5022, 5530-5541, 5554-5609, 1346+ | firm-level arrears clock on a pooled cash account | whether a rival dies, and whether **every** building it owns goes to the lenders | FAKE | Every building's NOI, debt service, overhead and tax still land in one `r.cash` (5011, 5022). `markPayments` (rivalDebt.ts:714) now marks *which* loans went unpaid: the account's shortfall falls on the worst-covered rows. The firm-level clock still decides: `stressMs > NOTICE_M + FORECLOSE_M` (now 6 + 14 = 20 months, FORECLOSE_M sourced to Trepp) fails the firm and sends all its deeds to receivers. `chargeSponsorFailure` now prices the loss per loan and non-recourse (see GONE). A firm with positive equity but no liquidity still dies like an insolvent one | Each building in its own SPE: its NOI services its own loan, and a shortfall defaults that loan only. The parent carries overhead, the line and recourse. The firm fails only when the parent misses its own obligations or recourse liabilities exceed liquid assets plus net sale equity | high | CHANGED |
| rivals.ts:5102-5106, 5147-5153 | reserve cap and payout rate | how much cash a rival holds going into a downturn | FAKE | Reserve = min($30M or $45M·CPI, max($2M·dollarLevel, AUM × 4.5-16% by style)), now × a contrarian hold factor. 10% of the surplus is paid out each month. These are tuned constants, and none of them reads the firm's own obligations. Payout is now paused while investing, building or swept | Size the reserve from the firm's forward needs: debt service + overhead + capex, plus 24-month maturities not refinanceable at today's sizing, minus committed undrawn line. Distribute only free cash flow above that | high | STILL |
| rivals.ts:1694-1699, 3135-3139 (comment) | opening-roster liquidity | how deep the opening firms' defences are | FAKE | Cash is still `equity × rrange(0.06, 0.16)` (0.34-0.48 for builders). The roster still has no `uncalled`; the comment at 5136-5139 calls it "already mid-life". So `recallable()` stays 0 until distributions accrue, and the stress ladder's capital call (5581-5582) does nothing for openers early on | Seed the roster as mid-life vehicles: uncalled = commitment × remaining investment period, distRecent = the steady-state payout, cash from the obligation-based reserve | high | STILL |
| rivals.ts:4103-4127 (used at 5532-5535, balloon ladder 4740) | revolver capacity re-sized every month | whether a rival can borrow through a cash hole | FAKE | `lineRoom` = min(covenant, `streetRefiProceeds` on today's NOI, the bank's single-name room) − debt, recomputed every tick. The bank's legal lending limit (`deskRoom`) is new and real. It is still mark-to-market monthly, so room goes negative exactly when needed | A committed facility: commitment, maturity, spread, quarterly covenant test, breach → the desk's NPV decision (waiver / cut / call) | high | CHANGED |
| workout.ts:114-136 via rivals.ts:4759 | extension and forbearance access | whether a desk works with a struggling rival | FAKE | It now refuses a loan whose NOI does not cover its interest (real). Rivals still pass the default `rel = 20`, so a stretched bank never extends a rival (it needs rel > 45). It runs once per building, at maturity only. There is still no modification for missed monthly payments | Compute rel from the rival's loan history with the desk. Modify vs foreclose by NPV at the desk's `lenderPressure`, for payment defaults as well as balloons | high | CHANGED |
| privateCredit.ts:342 | arrears relief | rival's default clock after a rescue | FAKE | `stressMs = max(0, stressMs − 2)` by assertion, whatever cash it actually cured | Remove it. The cash lands in `r.cash` and the normal test resets the clock if it really cured | high | STILL |
| rivals.ts:5591-5593, 4317-4338, 4393-4408 | distress sale cadence and price | how fast and at what price a stressed rival raises cash | FAKE | Price is now `forcedSalePrice` (propmarket.ts) on the firm's own mark. It picks the building whose net covers the hole and refuses a sale that nets ≤ 0. Still listed only on **even** stress months, one at a time. The private-offer ask is still `0.95 − 0.20·desperate` (4400, 4408) | Several assets in a month when the arrears require it, timed by deadline vs expected days on market. Private ask from the seller's deadline × bid depth | med | CHANGED |
| rivals.ts:4933-4935 | receiver release pace | how many failed-firm buildings reach the market each month | FAKE | Still 1-2 a month, picked at random | Release pace from the desk's `lenderPressure` and bid depth at the mark. Worst-ratio assets first | med | STILL |
| rivals.ts:3803-3809 | own-site start gate | whether a rival breaks ground on its own lot this month | FAKE | `rng < 0.055 (0.12 redevelopment) × build × ci × appetite × mandate`. A coin on top of an underwriting that has already cleared. `claimJob` dropped its coin (see GONE); this path kept one | Start when the scheme clears the firm's `firmHurdle` and it can fund, as `claimJob` now does | med | NEW |
| rivals.ts:3778-3779 | own-site building size | floor area of a rival's own scheme: `lotArea × FAR × (0.4 + 0.45·rng)` | FAKE | The size is a die. The `landRead` highest-and-best-use scheme is already computed above (3774) | Size from the HBU scheme (`hbu.psf`, coverage) or the residual-maximising floors | med | NEW |
| rivals.ts:1010, 3837 | asserted build capacity | whether a rival can take on a project | FAKE | `cost > aum·0.9 + cash·5` is a rule of thumb, followed by the real equity and line tests | Delete it and let construction-loan sizing plus the equity test decide | low | STILL |
| rivals.ts:5565-5567 | "backer" quirk rescue | a one-time equity injection | FAKE | Size = max(AUM×0.08, 2×shortfall), asserted. It now arrives as callable commitment, not cash | A named backer with wealth; commitment from its own balance sheet | low | STILL |
| rivals.ts:5647-5658 | husk wind-up clock | when a solvent empty firm retires | FAKE | Fixed 24 months (builders: 180 months without a groundbreak) | Wind up at fund term (holdM) or when LPs vote | low | STILL |
| rivals.ts:5534, 5581 | cure buffer | size of a line draw / capital call | FAKE | `aum × 0.004` buffer | N months of the firm's own forward deficit | low | STILL |
| rivals.ts:3806, 6104 | mandate limit | appetite fades with a firm's share of the street's book: `1/(1+(share/0.15)²)` | FAKE (shape) | Stated as a shape parameter with a Zipf citation. The 0.15 is chosen | Source the single-market concentration limit (institutional mandates), or let capital cost rise with concentration | low | NEW |
| sim.ts:411-424 | listing ask rails | ask floor 0.70 × value; non-distress withdrawn below 0.85 × value; −1.5% a month after 4 months | FAKE | Asserted price-cut speed and two rails on every anonymous/holder listing | The seller's reservation (`valueTo` / `anchoredAsk`) as the floor; cuts as partial adjustment toward the best observed bid | med | NEW |
| sim.ts:684, 732-736 | land listing asks and distressed land flow | land asks `rrange(0.72,0.90)` (distress) / `rrange(0.97,1.08)`; distressed lots listed = floor(n·0.006·down + rng), max 3 | FAKE | Dice set the price and the count. Building listings now come from holders' hold-vs-sell tests and loan defaults; land did not follow | Distressed land from owners' actual carrying stress (land loans in default). Ask = the owner's reservation | med | NEW / CHANGED |
| sim.ts:1391 | player seizure, GP-out sale | `pickV × 0.97` when you are GP-out | FAKE (minor) | The main path now runs `foreclosureSale` (one distressed-sale mechanism). The GP-out branch is an asserted 3% haircut | Route it through `foreclosureSale` too | low | CHANGED |
| swans.ts:926 | wave clamp ±0.06 | demand effect of a structural swan | FAKE (dormant) | Inert: `SWANS_OFF = true` (763) | Fix during the revamp | low | STILL |
| privateCredit.ts:163, 466 | rescue advance | LTV the player lends a stressed rival | FAKE | +8 points when stressMs > 8 (+3/+6 on the balloon file), clamped 0.45-0.72 | Advance from collateral value and loan-to-own appetite; falls with arrears | med | STILL |
| privateCredit.ts:257-259, 544-546 | private loan pricing | coupon, points, term | FAKE | `privateBase + rrange(PRIVATE_PREMIUM)`, points rrange(1.2%, 2.8%), term 6-18 months | Risk-based price: LTV, arrears, collateral liquidity, desk appetite | med | STILL |
| lenders.ts:675 | depositor recovery | haircut on uninsured cash | FAKE (dormant) | Still `0.60 + rng·0.30`. `cashSplit` (650-654) now sweeps everything above the insured limit into bills, so `exposed` is always 0 and this never runs | Delete, or recover from the failed desk's realised book when the sweep is optional | low | CHANGED |
| lenders.ts:1202, 1344 | desk capital floor | capital never below $20M × priceLevel × capitalRatio; the recap buffer uses the same $20M | FAKE | The anonymous book is gone (books are named loans now). The old $20M book floor survives as a capital rail | Let capital fall to what the named book and retained earnings support | med | CHANGED |
| lenders.ts:1913-2021 | origination share | market share | FAKE (partial) | The target is now the desk's own trailing share (`usual0` / `usualShare`), not the fixed `bookShareOf` (still the fallback at 1960, 1970). The pull toward "usual" remains | The borrower picks the best quote (`quote`); share is what it wins | low | CHANGED |
| lenders.ts:1386-1409 | appetite | desk lending appetite | FAKE | nimFac clamp [0.25, 1]; `(raw − 0.55)/0.45 × …` with fitted constants | Appetite from capital surplus and expected RAROC | med | STILL |
| lenders.ts:1339 | conduit / desk recapitalisation | capital refill | FAKE | Refills 1/12 of the gap to target each month (plus 1/12 of any negative). Capital from nowhere | Retained first-loss funded by issuance; size from deal volume | low | STILL |
| lenders.ts:1140 | panic shape | depositor panic floor 0.25 / max 1.6 | FAKE (shape) | Rails on a shape term. The delinquency-cap and charge-off shapes went with the anonymous book | Panic from the run model (tickDeposits) | low | CHANGED |
| debt.ts:708-724 | underwriting standards index | LTV / DSCR loosening | FAKE | Weights 0.45/0.25/0.30, divisors 0.22/0.25, tuned | Fit to SLOOS CRE standards and say so | low | STILL |
| credit.ts:241 | player LOC advance | line limit | FAKE | LOC_LTV × clamp(ci, 0.35, 1.15) × (1 − min(0.6, 1.6·cut)) × appFac | The rivals' borrowing base (income at the desks, land at the land loan) | low | STILL |
| portfolio.ts:428, 475, 843, 908 | portfolio bids | bidder limit `1+rrange(0.04,0.16)`; counter meet `rrange(0.45,0.9)`; indication `indicative × rrange(0.88,1.02)`; unsolicited `× rrange(1.0,1.09)` | FAKE | Bidders are now named rivals that can fund the book, on a deterministic schedule (837-846). The prices are still dice | Each bidder bids its own package valuation (`portfolioQuote` on its capital); limit = its walk-away | med | CHANGED |
| portfoliosale.ts:821 | REO package open ask | `gross × rrange(0.80, 1.00)` | FAKE | A die | The desk's `reoAsk` | low | STILL |

### EXOGENOUS (keep; should say what data sizes them)

| file:line | kind | what it decides | bucket | why | sev | Status |
|---|---|---|---|---|---|---|
| blackswans.ts:135-143 | annual hazards (embargo, arrivals, capital wave, panic, pandemic, war, foreign, tech, trade war) | swan arrivals | EXOGENOUS | The `else if` chain still allows at most one start a month | low | STILL |
| blackswans.ts panicHazard | panic hazard × exp(15·credGap) | crisis odds | EXOGENOUS | Schularick & Taylor cited | — | STILL |
| blackswans.ts:668-757 | campus / anchor arrivals | a big employer chooses the city | EXOGENOUS | No longer a 1/200 hazard: a search over a shortlist of cities (`considerAnchor`) | low | CHANGED |
| blackswans.ts (embargo, arrivals, panic length, wave depth, desk loss 0.5-1.3×) | shock magnitudes | shock size | EXOGENOUS | Some cited (1973, Mariel); wave depth and desk loss unsourced | low | STILL |
| swans.ts:152-153, 666-728 | trade / use level events | structural shifts | EXOGENOUS (dormant) | SWANS_OFF | — | STILL |
| rivals.ts:1614 | roster draw: 14% absent | firm heterogeneity | EXOGENOUS | Equity is now the table's equity × town area (FORMULA_LEDGER #21), not ×0.55-1.75. The ltv jitter is gone | low | CHANGED |
| rivals.ts:1643, 1715, 1749 | opening book picks | initial allocation | EXOGENOUS | — | — | STILL |
| rivals.ts:2734-2739, 2976, 3236, 3265, 3313, 3395-3408, 3489-3492 | entrant / foreign / land-fund arrival, names and raise; uncalled 30-50% | new firm | EXOGENOUS | Practice cited for uncalled | low | STILL |
| rivals.ts:3011-3014 | spinout (hashed 5%/yr) | people events | EXOGENOUS | The 1/7 retirement hash is gone (now yearly and deterministic, 2355+) | low | CHANGED |
| rivals.ts:3625, 3730, 3745, 3762 | own-site picks (stalled frame, redevelopment candidate, use) | which site | EXOGENOUS (tie-break noise) | — | low | STILL |
| rivals.ts:4493, 5312, 5322, 5460, 1537 | REO window, listing lives | timing | EXOGENOUS | — | low | STILL |
| rivals.ts:6111 | buyer pick noise `×(0.65+0.7·rng)` in `rivalBuys` when no firm has bid | which firm | EXOGENOUS | Only used when no bid names the buyer (the tape passes its winner) | low | NEW |
| rivals.ts:4915 | epilogue timing | news/register | EXOGENOUS | — | low | NEW |
| workout.ts:95 | extension length `rrange(EXTENSION_M)` | how long an extension runs | EXOGENOUS | Should cite workout practice | low | NEW |
| lenders.ts:699, 752, 767, 1470-1472 | receivership pay timing, replacement delay, reopen, receiver term | timing | EXOGENOUS | — | low | STILL |
| sim.ts:556 (hash hold 34-155 mo), 314, 337, 519, 600 | owner review timing, listing lives | who lists | EXOGENOUS | — | low | STILL |
| investors.ts:223, 353 | commit hazard, circleNoise | raise pace | EXOGENOUS | Stated shapes | low | STILL |
| competitorTraits.ts:448-456, 577 | trait jitter, rules, quirks, misread | personality | EXOGENOUS | Firm heterogeneity | low | STILL |
| portfoliosale.ts:741 | wind-down review month (hash) | timing | EXOGENOUS | The hunger noise is gone | low | CHANGED |
| privateCredit.ts:255, 537, 542 | candidate / lender pick | — | EXOGENOUS | — | low | STILL |

### PHYSICAL

| file:line | kind | why | Status |
|---|---|---|---|
| debt.ts (min(LTV, DSCR, debt yield) sizing; 1704, 1760 floors) | loan sizing | The definition of loan sizing | STILL |
| debt.ts (statedLtv ≤ maxLTV − 0.03) | day-one covenant | No desk writes a loan in breach | STILL |
| debt.ts (prepay penalty, amortisation ≥ 0) | contract terms | — | STILL |
| lenders.ts (reoAsk ≤ mark, ≥ 0) | definition | — | STILL |
| lenders.ts (deposit / posted rate ≥ 0) | zero lower bound | — | STILL |
| rivals.ts (opening debt = min(ltv, refi, DSCR 1.25 @ +200bp)) | underwriting convention | — | STILL |
| rivals.ts:5534 draw ≤ room; 4143 recallable | cannot draw more than exists | — | STILL |
| credit.ts (LOC draw/pay ≤ balance, cash) | accounting | — | STILL |
| privateCredit.ts (face 250k-12M × CPI) | product limits | — | STILL |
| debt.ts (class concentration caps) | regulatory CRE concentration guidance (cite it) | — | STILL |
| lenders.ts:1425-1430 | bank closed 3 months after capital ratio ≤ 2%; life company when below 17.5% of target | prompt corrective action, deterministic | NEW |
| rivals.ts:4116-4127 | the line counts against the bank's single-name lending limit | legal lending limit | NEW |

### GUARD

| file:line | why | Status |
|---|---|---|
| rivals.ts:2608, 4885, 5689 (ci clamp 0.4-1.25) | Duplicates the pull clamp; check that it never binds | STILL |
| `max(1e-6, …)`, `Math.max(1, …)` denominators | Divide-by-zero | STILL |
| swans.ts LEVEL 0.25-4 | Level sanity | STILL |
| blackswans.ts credGap clamp | Extremes | STILL |
| blackswans.ts pole level clamps ±16 | — | REMOVED 2026-11-21: level derived from live anchors (settlePoles) |
| lenders.ts init book floor, deposit-rate smoothing | Init / smoothing | STILL |
| credit.ts reserve floor; rate ≥ 1% | — | STILL |
| privateCredit.ts:96-114 | Player's own sleeve policy | STILL |

### COSMETIC (news only)

rivals.ts:2546, 4781, 4803, 5583; sim.ts:526, 704; privateCredit.ts and lenders.ts news lines. These stay on `newsChance`.

## How rivals fail now (the chain)

1. **Cash in, cash out, one pot (unchanged in structure).** `tickRivals` is at rivals.ts:4883. Each month:
   - `r.cash += NOI/12 − interest − amort + deposit interest` (5011);
   - overhead of $60k·costIdx + 28bps of AUM is taken out (5022);
   - annual tax is taken out.

   All buildings and loans share one account.
2. **Balloons first** (`tickMaturities`, 4657). A maturity that `streetRefiProceeds` will not fully refinance is cured, in order, by:
   - cash;
   - `lineRoom` (now also capped by the bank's single-name limit);
   - **one** desk extension per building via `deskWillExtend(s, desk, 20, {noi, interest})` (4759). This now refuses a loan whose NOI does not cover its interest. The rel is still 20, so stretched banks still say no;
   - a capital call;
   - a duress listing or deed-in-lieu.

   A healthy refinance can now also take cash out up to the style's target (4703-4712, deterministic; the coin is gone).
3. **The cushion is paid out.** 10% a month of cash above the reserve goes out (5147-5153), paused while investing, building or swept. The reserve uses the same tuned constants (5102-5106). Opening firms still start with cash of 6-16% of equity and no `uncalled` (1694-1699).
4. **Shortfall.** With cash < 0, the firm draws on the line up to `lineRoom` + 0.4% of AUM (5532-5535). lineRoom is re-sized monthly against current NOI.
5. **Which loans went unpaid (new).** `markPayments` (5540; rivalDebt.ts:714) puts the remaining shortfall on the worst-covered rows, so arrears now live on specific loans in `cityLoans`. Those loans feed the deterministic auction filings (auction.ts) and the receiver's tape (sim.ts:533-539).
6. **Firm arrears clock.** Cash still < 0, or a called loan unpaid on an empty book, sets `stressMs++` (5554-5556). Any month with cash ≥ 0 resets it (5631). This is a cash-flow test, not a roll.
7. **The defence ladder:**
   - (0) the backer quirk, once, as callable commitment (5565-5567);
   - (1) a capital call only if recallable covers the whole shortfall (5581-5582);
   - (2) on even months, list the building whose forced-sale net covers the hole (5591-5593, 4317-4338; refused if the net is ≤ 0);
   - (3) from NOTICE_M (6), one deed-in-lieu every 3 months (5601-5603).

   There is still no modification for monthly payment defaults. Voluntary sales now run through the annual hold/sell review (5345+, deterministic). It is still skipped for stressed firms.
8. **Death.** At `stressMs > NOTICE_M + FORECLOSE_M` (now **20** months; FORECLOSE_M 14 sourced to Trepp) the firm gets `failedM` and endReason "failed" (5608-5612). `chargeSponsorFailure` (1346) then:
   - sells each building at `forcedSalePrice`;
   - pays its own mortgage first (non-recourse; the shortfall is that lender's loss);
   - pools the surplus for the recourse creditors (the line, construction and land loans).

   The remaining deeds go to receivers, still released 1-2 a month at random (4933-4935). A bank now fails by prompt corrective action, deterministically (lenders.ts:1425-1430), not by a roll. A failed desk refuses all extensions (workout.ts:116).
9. **Other exits.**
   - A solvent empty book retires after 24 months (5647-5658).
   - A founder's retirement now comes on a yearly deterministic test (2355+, which retires the firm into a family-office holder).
   - The own-site start coin (3803) and the size die (3778) are the only rolls left on the firm's growth path.

**Verdict.** Failure is still decided by money. There is no failure roll. The loss on failure is now allocated loan by loan at a market-derived forced-sale price, and bank failure is deterministic. Four parts of the old structure are still fake:
- the pooled firm account and the firm-wide death (with 20 months instead of 15);
- opening firms with no recallable capital;
- the tuned reserve and payout constants;
- a monthly mark-to-market revolver, plus maturity-only extensions at rel = 20.

So the mechanism for the "$14-35M openers die in the first recession" pattern is still in place: no uncalled commitment, a thin opening cushion, and a line that disappears in a downturn.

## Summary

**Status counts** (table rows; one row can group several lines). Old rows: **STILL 46, CHANGED 15, GONE 18** items. A few GONE items are parts of rows that stay as CHANGED: the distress ask, the seizure floor and the portfolio arrival. **NEW 9**.
- Of the first pass's 40 FAKE rows: 16 STILL, 11 CHANGED (still partly fake), 13 fully GONE.
- FAKE rows now open, including 5 NEW: 31 (high 6, med 11, low 14).

**Top 5 remaining fakes**
1. **Pooled firm cash and firm-wide failure** (rivals.ts:5011-5022, 5554-5612). Per-loan arrears now exist (`markPayments`), but a building's default still takes the whole firm. Fix: SPE-level default, with parent failure only on parent obligations.
2. **Opening roster with no `uncalled` and 6-16% cash** (rivals.ts:1694-1699). Seed the roster as mid-life funds.
3. **Reserve and payout constants** (rivals.ts:5102-5106, 5147-5153). Size the reserve from forward debt service and maturities.
4. **Revolver re-sized monthly, and extensions only at maturity with rel = 20** (rivals.ts:4103-4127, 4759; workout.ts:135). Use a committed facility and NPV-based modification with the real relationship.
5. **`stressMs −= 2` after a private rescue** (privateCredit.ts:342). Also open: the own-site start coin and size die (rivals.ts:3803, 3778), the distress sales limited to even months (5591), and the 1-2-a-month random receiver release (4933).

## Fixed since the first pass (GONE)

- rivals.ts:1293 the lender loss `asset value × rrange(0.68,0.88)` on a failed sponsor. Now a per-loan waterfall at `forcedSalePrice`, non-recourse mortgages, recourse pool (rivals.ts:1346+).
- rivals.ts:3881 the distress ask `rrange(0.68,0.88)` with a 0.78 decision midpoint. Now `forcedSalePrice`. The even-month cadence remains (see table).
- rivals.ts:4614 the cash-out refinance coin. Now deterministic up to the style target on a healthy refinance (4703-4712).
- rivals.ts:4777-4782 the voluntary trim coin. Now the annual hold/sell review against the firm's reservation (5345+).
- rivals.ts:978-986 the groundbreak claim coin and U(0.6,1.4) winner. Now `firmWouldBuild` + the best `firmHurdle` vs `anonHurdle` (1030-1036).
- rivals.ts:1414 the orphan-frame ask band. Now builders' `frameBid`, second-best number (1522-1531).
- sim.ts:454/494 the anonymous distressed-seller roll. Distress listings now come from `cityLoans` in workout past NOTICE_M and from defaulted street loans (sim.ts:533-546).
- sim.ts:497 the 88% big-asset rejection roll. A holder lists when the best bid beats its keep value (sim.ts:548-571).
- sim.ts:504/517/339/621 the building ask bands. Now `anchoredAsk` / `forcedSaleAsk`; the draws are voided (sim.ts:327). Land bands remain (see table).
- sim.ts:144-154 the anonymous listing flow rate. Now each holder's annual review on a hash schedule plus the bid test.
- sponsor.ts:73-76 the `distressPrice` floor 0.62 and sim.ts `min(0.85, …)`. The player seizure uses `foreclosureSale` (sim.ts:1391).
- blackswans.ts:116 the fiscal-crisis hazard tripled in recession (removed).
- privateCredit.ts:212/491/461 the ask spawn coins (22% / 28%) and the 35% Cordage refusal.
- lenders.ts:1327 the bank/life seizure rolls. Now prompt corrective action (lenders.ts:1425-1430).
- lenders.ts:1356 the 75% purchase-and-assumption roll.
- lenders.ts:1192-1208 the reduced-form anonymous book (badTarget + noise, clamp 0.002-0.35). Desks are now named-loan books (`namedOnly`, 1185-1210).
- portfoliosale.ts:498 / 640 the rival package-take coin and the breakup asks `rrange(0.62,0.78)`.
- portfolio.ts:794-797 / 857 the anonymous BUYERS arrival roll and the 70% hold-vs-walk roll. Bidders are named rivals that can fund the book (the price dice remain).
