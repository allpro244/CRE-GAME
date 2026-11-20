# Frontier playthrough: $5M, City size, 50 years (20 Nov 2026)

> **Read this first.** Everything below the line was measured on a checkout
> that turned out to be **a month old**: 76403d5, PR #474 of 22 Oct. Main was
> 799 commits ahead, at #838. This section is the same bot and the same three
> seeds, re-run on **current main plus the opening-dearness change** in this
> PR. The current map generator makes 1,400 lots at City size.

## Re-run on current main (c75ef8b, #838) — the numbers that count

| Seed | Net worth 2050 | Rank | Leader | Rival failures | Own ground-up starts | Population | Real rent over 50 years: office / retail / apartments / industrial | Vacancy range: office / retail / apartments / industrial |
|---|---|---|---|---|---|---|---|---|
| 12007 | $159M | 6 of 48 | $2.15B | 67 | 0 | 51k→69k | −22% / +1% / **+94%** / −11% | 6–22% / 3–13% / 4–11% / 1–14% |
| 550991 | $248M | 4 of 54 | $2.01B | 98 | 2 | 50k→83k | −9% / +24% / **+104%** / −7% | 6–23% / 2–11% / 4–11% / 1–17% |
| 655720 | $163M | 6 of 18 | $1.29B | 84 | 14 | 51k→73k | −9% / +16% / **+89%** / −24% | 6–16% / 1–11% / 3–11% / 0–17% |

What changed against the month-old engine:

- **Becoming the richest is now hard.** The player compounds at 7–8% a year,
  from $5M to $159–248M, and finishes 4th–6th. The leaders reach $1.3–2.2B,
  and one family firm (Wentworth Trust, 347 buildings in seed 655720) ends up
  owning a large share of the town. The old finding "too easy, #1 by year 6"
  no longer holds.
- **Rivals die en masse.** There were 67–98 failures, and in seed 655720 the
  field shrank from 56 firms to 17, leaving one dominant survivor. That fits
  `RANDOMNESS_AUDIT.md` item 2: one cash pot per firm, and failure seizes
  every building, including loans that were current.
- **Apartment rents roughly double in real terms in every seed,** while
  apartment vacancy stays at 3–11%. Supply is not catching up. That fits the
  flats-occupancy rail, which binds in about 26% of months on the reference
  town (audit item 8: the looking-pool cap deletes excess demand instead of
  letting it bid).
- **Office is the weak class:** real rent −9% to −22%, and vacancy up to
  22–23%.
- **Ground-up development happens,** but unevenly: 0, 2 and 14 of the bot's
  own starts.
- **Seed 655720 had a decade-long shortage of shops and sheds:** retail and
  industrial were 0.3–2% vacant from 2012 to 2021, with the index rate at
  8–10.6%. High rates froze supply. That direction is real, but the length is
  worth checking.

---

## First pass (month-old engine, 76403d5) — kept for the record

**Setup:** generated island, City size (1,466 lots), **Frontier** build-out
(591 vacant lots), $5M start, 50 years (2000–2050). Three market seeds on the
same map. Driver: `tools/play50-frontier.mjs` (deterministic):

    pnpm engine && BW_SIZE=city BW_DENSITY=frontier SEED=12007 node tools/play50-frontier.mjs

**Strategy (a bot playing as a person would):**
- buy standing buildings whose yield clears the loan coupon;
- buy dirt only when a scheme pencils (hurdle ≥ 1.0);
- run up to three jobs at once;
- lease through the tray (take anything ≥ 92% of market, counter the rest);
- refinance balloons;
- sell into strength or on strong offers.

The bot did not phone the owners of unlisted lots.

## Result

| Market seed | Net worth 2050 | Rank | First #1 | Peak drawdown | Bought / sold | Ground-up starts | Town population |
|---|---|---|---|---|---|---|---|
| 12007 | **$898M** | **#1 of 63** | 2006 | 37% | 147 / 45 | 0 (5 half-built takeovers) | 38k → 84k |
| 550991 | **$230M** | **#1 of 42** | 2047 | 15% | 106 / 35 | 0 | 38k → 41k |
| 655720 | **$558M** | #2 of 64 (Pruitt Development $647M) | 2044 (briefly) | 15% | 167 / 40 | 0 | 38k → 73k |

That is 8–11% a year compounded, from levered buy-and-hold with every dollar
reinvested. No run went bankrupt, and none came close: cash never fell below
$300k.

## Rents by asset class

The figures are asking rents in $/sf/yr: nominal first, then real (2000
dollars) in brackets, then city vacancy.

### Market seed 12007 (the boom town)

| Year | Phase | CPI | Office | Retail | Apartments | Industrial |
|---|---|---|---|---|---|---|
| 2001 | expansion | 1.02 | $52.0 ($51.1) · 16% | $27.3 ($26.8) · 18% | $24.3 ($23.9) · 3% | $13.2 ($13.0) · 11% |
| 2005 | recession | 1.24 | $49.2 ($39.7) · 17% | $24.0 ($19.3) · 20% | $32.6 ($26.3) · 7% | $13.4 ($10.8) · 16% |
| 2010 | recovery | 1.51 | $59.5 ($39.5) · 13% | $27.1 ($18.0) · 12% | $36.2 ($24.1) · 8% | $16.5 ($11.0) · 36% |
| 2015 | depression | 1.70 | $50.3 ($29.5) · 10% | $27.0 ($15.8) · 13% | $48.3 ($28.4) · 14% | $17.2 ($10.1) · 30% |
| 2020 | recovery | 1.52 | $43.4 ($28.5) · 9% | $23.8 ($15.6) · 12% | $38.4 ($25.3) · 5% | $17.5 ($11.5) · 31% |
| 2025 | recovery | 1.40 | $37.4 ($26.6) · 9% | $20.9 ($14.9) · 10% | $35.7 ($25.4) · 6% | $14.3 ($10.2) · 22% |
| 2030 | expansion | 1.46 | $37.8 ($25.9) · 4% | $22.1 ($15.1) · 10% | $42.5 ($29.1) · 3% | $16.4 ($11.2) · 15% |
| 2035 | peak | 1.57 | $51.1 ($32.6) · 3% | $22.7 ($14.5) · 11% | $47.8 ($30.5) · 4% | $15.9 ($10.1) · 21% |
| 2040 | expansion | 1.79 | $81.7 ($45.6) · 4% | $24.7 ($13.8) · 10% | $66.8 ($37.3) · 3% | $17.3 ($9.6) · 30% |
| 2045 | expansion | 2.10 | $94.0 ($44.7) · 6% | $26.9 ($12.8) · 14% | $86.8 ($41.3) · 9% | $19.8 ($9.4) · 34% |
| 2050 | expansion | 2.42 | $111.6 ($46.0) · 5% | $29.6 ($12.2) · 9% | $98.3 ($40.5) · 8% | $22.8 ($9.4) · 32% |

Real change over 50 years: office −10%, retail −55%, apartments +70%, industrial −27%.

### Market seed 550991 (the town that never grew)

| Year | Phase | CPI | Office | Retail | Apartments | Industrial |
|---|---|---|---|---|---|---|
| 2001 | expansion | 1.03 | $16.3 ($15.8) · 12% | $10.4 ($10.1) · 13% | $10.8 ($10.5) · 4% | $3.9 ($3.8) · 11% |
| 2010 | recovery | 1.19 | $17.1 ($14.3) · 15% | $9.9 ($8.3) · 17% | $12.3 ($10.3) · 6% | $3.9 ($3.3) · 10% |
| 2020 | recession | 1.53 | $20.6 ($13.4) · 14% | $12.7 ($8.3) · 22% | $15.5 ($10.1) · 6% | $4.5 ($2.9) · 13% |
| 2030 | recession | 1.91 | $32.1 ($16.8) · 13% | $12.9 ($6.8) · 17% | $21.0 ($11.0) · 6% | $4.0 ($2.1) · 9% |
| 2040 | recession | 2.48 | $48.5 ($19.6) · 12% | $16.2 ($6.6) · 12% | $28.2 ($11.4) · 7% | $9.2 ($3.7) · 5% |
| 2050 | recession | 2.65 | $45.7 ($17.2) · 15% | $20.8 ($7.8) · 13% | $29.4 ($11.1) · 7% | $11.5 ($4.3) · 10% |

Real change: office +9%, retail −23%, apartments +6%, industrial +13%.

### Market seed 655720 (steady growth)

| Year | Phase | CPI | Office | Retail | Apartments | Industrial |
|---|---|---|---|---|---|---|
| 2001 | expansion | 1.02 | $13.1 ($12.9) · 12% | $9.1 ($8.9) · 14% | $9.5 ($9.3) · 3% | $3.1 ($3.0) · 5% |
| 2010 | expansion | 1.29 | $16.1 ($12.6) · 8% | $8.8 ($6.8) · 7% | $13.2 ($10.3) · 5% | $4.1 ($3.2) · 7% |
| 2020 | peak | 1.66 | $28.7 ($17.3) · 12% | $12.8 ($7.7) · 6% | $17.9 ($10.8) · 5% | $4.8 ($2.9) · 13% |
| 2030 | recovery | 2.09 | $31.0 ($14.9) · 13% | $19.3 ($9.3) · 11% | $23.0 ($11.0) · 8% | $8.1 ($3.9) · 10% |
| 2040 | recovery | 2.90 | $43.9 ($15.1) · 12% | $26.8 ($9.2) · 4% | $32.4 ($11.2) · 9% | $10.5 ($3.6) · 12% |
| 2050 | expansion | 3.55 | $48.2 ($13.6) · 9% | $38.3 ($10.8) · 4% | $39.2 ($11.1) · 3% | $12.1 ($3.4) · 7% |

Real change: office +6%, retail +21%, apartments +20%, industrial +13%.

### My own book against market (seed 12007, 2050)

| Class | Buildings | Size | In-place rent | Market rent for those buildings | NOI | Value |
|---|---|---|---|---|---|---|
| Office | 85 | 1.75M sf | $122.2 | $133.0 | $131M | $1.07B |
| Apartments | 15 | 153k sf | $107.9 | $120.2 | $7.4M | $100M |
| Retail | 2 | 20k sf | $25.9 | $27.0 | $0.3M | $5M |

In-place rents tracked market within about 5–10% in all three runs. That is
right: leases signed in a rising market lag it. The book ended up 80–90% office
in every run, because office was what kept clearing the coupon on the tape.

## What feels right

- **Rent responds to vacancy and to the town.** In the boom seed, office went
  from 16% vacant to 3–4% as population doubled, and real office rent nearly
  doubled from its 2030 low. In the stagnant seed, population was flat for 50
  years, real rents went nowhere, and office sat at 12–15% vacant throughout.
  Each town's rents trace the story of that town.
- **Apartments are the steady class.** Vacancy stayed at 3–9% in every seed,
  occupancy in my blocks was about 91–96%, and apartments were the best real
  performer where the town grew.
- **Retail is a poor business on a frontier,** and it says so. Retail vacancy
  sat at 10–23%, real rent fell 23–55% in two of the three seeds, and my
  shopfronts were 35–80% let.
- **The lender walls are real.** The minimum cheque, "not writing anything this
  month" and the underwriting test each blocked financed closes dozens of times.
  The bot fell back to cash.
- **Leasing works in volume.** Each run signed 272–714 leases, with expansion
  space contested between letters.
- **Cycles hurt.** Seed 12007 had a 37% drawdown in its 2004–09 run of
  recessions, with the index rate at 13–16%.
- **Takeovers work.** Buying a rival's half-built job, finishing it and holding
  it worked. Its five deliveries were among the best marks in the book: for
  example, 1246 Old Union St cost a $14M basis and was worth $38M.

## What feels wrong, or is worth a look

1. **Becoming the richest is too easy, and it happens too early.** In seed 12007
   the player was #1 by **2006, with $10.8M**. Thirteen rivals died in the
   2004–06 recessions (49 → 35 firms), and the best survivor had less than
   $14M. By 2050 the player held 2.7× the #2. Two of three runs ended #1 and
   the third ended #2. Each town opens with rivals of only $14–35M of equity,
   so a $5M player is a mid-table firm on day one. That may be realistic for a
   frontier town, but the goal "become the richest" is not much of a goal here.
   Rival deaths are also heavy: 55–93 failures over 50 years against fields of
   about 50.
2. **I never broke ground on my own land, in 150 bot-years.** On Frontier
   (where more than half the map is empty), the probe below found 0–3 listed
   lots at any time with a scheme clearing hurdle 1.0. The typical best was
   0.4–0.7. In the seed-12007 world with no player in it, **no listed lot
   penciled for 30 years**, and rivals started no office at all. In seed 550991,
   rivals did build: 150–440k sf of office every three years. Two caveats:
   the bot never phoned owners of unlisted lots, and it ignored lots at 0.9–0.99.
   Even so, a Frontier town that is mostly grass, where buying existing
   buildings beats building on it by this much, is the opposite of what the
   Frontier preset's description promises a player.

   **Follow-up (same day): mostly not a fake.** On the lots that fail, land is
   2–10% of total cost: one $0.21M lot sat under an $8.4M building. Those
   schemes do not pencil even with free land. The hurdle is exit yield × 1.17
   (a 17% margin on cost, the industry standard). The exit yield is cap rate
   plus property tax, because the plan's NOI is measured before tax, so the
   hurdle is consistent with how buildings are marked. Low-demand frontier
   lots stay grass because a new building there would be worth less than it
   costs to build. That is the real reason land stays vacant. Where space
   really was short, rents rose until building paid: apartments gained +70%
   real in seed 12007, and rivals built 30–60k sf every three years. The
   no-office decades in seed 12007 match 12–18% office vacancy. Nobody should
   build into that.
3. **The opening rent level swings about 5× on the market seed alone.** On the
   same map, office opened at $10.6–$52/sf and industrial at $2.2–$13.4/sf. The
   cause is `wage0` (0.26–0.60), which is drawn from the seed. $52 office in a
   two-storey frontier town is high. $2.60 industrial is plausible for a small
   town. The spread is not visible to the player at setup, so two "identical"
   games are very different businesses.

   **Follow-up:** this is deliberate. `market.ts` `initEcon` makes two seeded
   draws, at the owner's request of 2026-10-12. The first is a price level,
   which only sets the units money is counted in. The second is a dearness
   draw, which is real economics. A third draw, the opening Tobin's q spread,
   does the same. Under the 2026-11-20 no-dice rule, dearness should be
   derived from the town itself. That is an owner decision, and it is open.
4. **Industrial vacancy was stuck at 30–36% for about 30 years (seed 12007),**
   from 2010 through 2050, while real industrial rent fell only gently. Nothing
   converted, demolished or repurposed that space. The other two seeds stayed at
   1–15%. A market a third empty for a generation should either clear on price
   much harder or lose stock.
5. **Office cap rates widened to 17.6% in a boom (seed 12007, 2050):**
   5% vacancy, real rent rising, index at 6.5%. If this is the market pricing in
   mean reversion of a peak rent, the cap rate on normalised rent may be fine.
   But the headline cap rate a player sees reads as broken. Worth checking which
   one the Markets tab shows.
6. **Ten years of deflation in seed 12007.** CPI fell from 1.70 in 2015 to 1.39
   in 2027, about 18%, during a "recovery". That is possible, but long for a
   town that was also adding jobs.
7. **Bot-only noise, not game bugs:**
   - "That LOI is gone" (50–170 per run) happens because the bot iterates over a
     stale LOI list.
   - "Land money is for dirt" (20–36 per run) happens because the refinance desk
     correctly lists a land quote with a reason it cannot be used, and the bot
     ignored the reason.

### The pencil probe (no player in the world, best scheme on every listed lot, every three years)

| Seed | Typical land listings | Lots clearing 1.0 | Best hurdle seen |
|---|---|---|---|
| 550991 | 2–44 | 0–3 | 1.35 (2014) |
| 12007 | 4–46 | 0 for 2008–2029 | 1.07 (2005) |

## Occupancy note

The first pass measured occupancy as tenant feet over gross building area. That
understates it by the core factor (rentable is 72–92% of gross). The committed
driver uses `occupancyRead().lettableOcc`, the same figure the Leasing screen
shows. I re-ran seed 12007 with the corrected driver. It is deterministic and
finished at the same $898.3M.

| Year | My offices, lettable occupancy | City office vacancy | My apartments, lettable |
|---|---|---|---|
| 2010 | 70% | 13.1% | 91% |
| 2020 | 84% | 8.6% | 92% |
| 2030 | 80% | 4.1% | 84% |
| 2040 | 95% | 4.3% | 85% |
| 2050 | 88% | 5.3% | 91% |

My offices ran 5–15 points below the city. That is mostly self-inflicted: the
bot bought on yield, which picks up half-empty buildings. Apartments at 84–85%
lettable in 2030–40, while the city was 3–4% vacant, is a little low. The
lettable read includes any shop floor under a block of flats, which may
explain it. Not chased further.
