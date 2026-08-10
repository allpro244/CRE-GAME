# A Century at the Desk — playthrough report

Measured on New Alden, opening bankroll **$2.5M**, horizon **100 years**.
Re-run with:

```bash
pnpm engine
SEEDS=6 HORIZON=1200 node tools/century-play.mjs
N=8 HORIZON=1200 pnpm balance
SEEDS=3 HORIZON=1200 pnpm play50
```

Re-measure before believing any standing number below.

---

## Headline scores (6 seeds × 100 years)

| posture | median NW | median *real* NW | best | worst | deaths |
|---|---|---|---|---|---|
| reckless levered | $8.94B | $505M | $36.72B | −$1.6M | 2/6 |
| disciplined principal | $2.98B | $169M | $11.09B | $495M | **0/6** |
| yield hog | $1.99B | $79M | $15.02B | −$782K | 3/6 |
| contrarian | $1.14B | $63M | $2.59B | −$475K | 3/6 |
| all-cash | $2.04B | $59M | $2.24B | −$964K | 1/6 |
| merchant builder | −$157K | −$55K | −$101K | −$249K | **6/6** |

Balance harness (8 seeds, archetype bots via `buyListing`):

| strategy | NW p10 | NW med | NW p90 | CAGR | wipeouts |
|---|---|---|---|---|---|
| trader | $850M | $5.92B | $8.77B | 7.1% | 0 |
| yieldHog | −$8M | $5.19B | $7.84B | 7.0% | 3 |
| developer | $1.21B | $4.22B | $8.57B | 6.8% | 0 |
| reckless | −$558M | $3.26B | $14.37B | 6.5% | 3 |
| core | −$135M | $2.20B | $8.00B | 6.1% | 2 |

After the `play50` reserve fix (3 seeds × 100 years): **0 failures**,
worst $1.86B · median $5.87B · best **$17.55B** (189 buildings, street rank
1 of 13, 30% max drawdown). Before the fix: 12/12 dead, zero deeds.

---

## Bugs found

1. **`play50` never bought.** Reserve was hardcoded at `$2.5M`, equal to
   `DEFAULT_START_CASH`, so `cash > reserve` was false from month one.
   Twelve century runs → twelve insolvencies → zero deeds. Fixed: reserve is
   now a fraction of the opening cheque; yield hurdle softened from
   `index+140bp` (which rejected the whole opening tape) to `index+40bp`.

2. **`buyListing` lied about closings.** A refused / insulted bid returned
   `{ msg }` with no `err` and no deed. The UI toasted *"Deed recorded. The
   block knows your name now."* Harnesses counted `bought++`. Fixed: returns
   `refused: true`; toast is an error; bots count only real holdings.

3. **Merchant development is still unreachable at $2.5M.** Sites that clear a
   120bp development spread typically want `$1.3–3.7M` equity at close after
   you have already spent the land cheque. Pure-developer `playdev` and the
   merchant arm of `century-play` die of overhead without ever topping out.
   The balance `developer` archetype survives because it also buys *buildings*.

---

## What looks like an exploit (and what doesn't)

- **Max-leverage buy-everything** has the highest ceiling ($37B) and a real
  wipeout rate. Not a free lunch — a coin flip with a billion-dollar upside.
- **No money pump** in the stress battery (buy/mark, list/delist, revolver,
  refi loops). Idle cash still decays (G&A > 1% deposit APY).
- **Nominal billions are mostly inflation.** CPI ~19× over a century in a null
  run; $3B nominal ≈ $150M real. Office rent index hits thousands nominally
  while real rents stay in a recognisable band — known labelling tension
  (`START_YEAR` / CPI notes in `types.ts`).
- **Sitting in cash is death**, not a strategy: ~35 years to insolvency on
  overhead alone at the standard opening.

---

## Things that should change

1. Merchant / ground-up path needs a bootstrap that a $2.5M sponsor can
   actually finish — or the UI should say so at the land desk.
2. Harnesses that call `buyListing` must treat `refused` (now) as non-purchase.
3. Read **real** net worth next to nominal in any century scoreboard; the
   nominal number flatters every survivor.
4. Reckless's p90 ($14–37B, 100+ assets) is the right question for "is
   leverage priced?": survivors compound too easily once past the first
   decade — concentration, covenant, and refinance risk may still be thin
   on a diversified book.
