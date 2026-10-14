# A century as a developer only — Great City, $1M, medium rivals

*14 Oct 2026. Played on `main` at `527f822` (black swans, boom-bust, credit freezes, and the two fixes this playthrough produced).*

**Setup.** Great City map (`BW_SIZE=giant`): **6,049 lots, 1,663 of them vacant**. The standard "Young town" build-out. **$1,000,000** opening bankroll, against 62 rivals at **Medium** capital. 100 years, 2000–2100.

**Mandate.**
- Develop only: buy dirt, build, sell whenever.
- Never buy a standing building to hold.
- A standing building may be bought only as a **teardown**: emptied (lease buyout) and demolished within 12 months, or sold back out if that fails.

**How it was played.** `tools/mdga/century-dev.mjs` is a deterministic bot sitting at the game's own desks.

- **Finding sites.** Each month it runs the Build desk's scheme sweep (every use at 1–50 floors) on every land listing and every teardown candidate. Every quarter it phones five owners of vacant lots the parcel card calls "Developable".
- **Building.** It buys when a scheme clears a 1.05× hurdle and it can fund dirt plus the job. It breaks ground at the desk's maximum LTC, with a rate cap on the takeout.
- **Lease-up.** It leases through the tray and brokers.
- **Takeout.** It moves to the permanent loan at stabilisation or the balloon.
- **Exit.** It sells stabilised product into strength: anything worth 1.15× cost while net worth is under $40M, 1.6× after. Above $40M it also pulls cash-out refinances.

Every job, sale and recession is logged. Re-run any seed with `SEED=… CKPT=… node tools/mdga/century-dev.mjs`, which is deterministic and checkpointed. Tables come from `node tools/mdga/century-dev-report.mjs`.

---

## Headline

| Seed | Before the fixes | After the fixes | Peak | Built | First #1 |
|---|---|---|---|--:|---|
| **655720 (the playthrough)** | effectively bankrupt by 2053 (−$6.0M, 0 deeds) | **$1.81B, #3 of 81** | #1 for 37 of 57 years, 2044–2100 | 66 | 2044 |
| 760449 | bankrupt 2028 | bankrupt 2044 | $17.2M (2025) | 13 | never |
| 550991 | $6.2M at 2040 | **$77.6M, #53 of 101** | $99.3M (2090) | 41 | never |

**Can a development-only firm become the top firm from $1M? Yes.** The main seed was #1 by 2044 and held it for 37 of the remaining 57 years. It finished **#3** behind two buy-and-hold families: Kilbride & Co. ($2.48B, 158 buildings) and Windlass Partners ($2.20B, 126). The reason is my own mandate. The bot recycled everything it built into cash ($1.78B of its $1.81B), and for the last 32 years the built-out city offered almost nothing worth building, while the holders' rent rolls compounded.

**It is not reliable.** One seed of three went bankrupt and one is a modest success. Before the two fixes below, two of the three were bankrupt.

---

## The story of seed 655720

**2000–2010: walk-ups, one at a time.**
- **2002, the first building.** The firm opened with $1M, ranked 63rd of 63. It bought a 3,342 sf lot on Old Vesey St for $245K and built a 4-storey, 9,400 sf walk-up for $1.3M all-in: 53% loan-to-cost (LTC) at 7.07%, apartment rent $24.41/sf, city apartment vacancy 7.2%. It was let in 13 months and sold in 2006 for $2.7M, a 39.8% levered IRR.
- **2005–2010, eight more just like it.** All were 3–6 storeys, 2,800–10,200 sf and $0.4–1.7M, at 62–70% LTC and 5–7%.
- **What they earned.** Every one sold 2–3 years after delivery at 1.5–2.3× cost; median IRR was about 40%. No bank would have lent this firm more; the walk-ups built the balance sheet.
- **The 2002–04 recession** (17 months) hit before the first sale. The firm had nothing at risk.

**2011–2019: the office turn.**
- **2011, first office.** A 16-storey, 39,400 sf tower on Old Trinity Pl: $12.0M all-in, $3.3M of land, 64% LTC at 6.42%, $31/sf rent, 6.6% office vacancy. It sold in 2015 for $22.1M.
- **2014–2016, a six-tower run.** Office vacancy fell from 4.6% to 1.6% and rents rose from $37 to $42/sf. The firm built six 11–14 storey towers, each $5–10M at 70% LTC and about 5%. Most sold in 2018–19 at $8–20M with 26–50% IRRs.
- **2017, the biggest job yet.** A 22-storey, 71,400 sf tower: $32.1M, 70% LTC at 4.93%, held until 2041.
- **By 2020:** $42.8M of net worth, #15 of 149.

**2020–2021: the first real recession.**
- **The shock.** Over 19 months the index rose from 5.24% to 6.43% and unemployment from 5.3% to 7.6%. Office vacancy went from 9.2% to 14.0%. The office cap rate went from 7.16% to 9.11%. The credit index fell to 0.59: "the debt markets have effectively closed".
- **Who failed.** Five rivals: two merchant builders, two vulture funds and a private-equity fund.
- **What it did to the firm.** Net worth fell from $42.8M to $30.8M, about −28%, all of it marks. The firm owned three buildings, mostly let, and had $21M of cash from the 2018–19 sales, so nothing was forced.
- **The lesson of this downturn:** sell into the boom and go into the bust liquid.

**2029–2041: core office and the land boom.**
- **Office vacancy sat between 1.3% and 2% for about twenty years**, while core office rents for my jobs ran from $60 to $137/sf. The city never built enough office space. More on that below.
- **The towers grew:**
  - 20 storeys and $39M in 2029;
  - 16 storeys, 104,100 sf and $65M in 2032;
  - in 2037, a teardown: a 53,901 sf office on Old Bank St bought for $17.9M, plus $4.7M to buy out six tenants and $635K to demolish, replaced with 16 storeys and 119,500 sf for $80.7M.
- **The $394M sale.** That last building (job #25) delivered in 2039 worth $97M. In 2041 it sold for **$393.9M**, $3,296/sf, a $305M gain. That sale is why net worth went from $185M (2040) to $984M (2045). It was a land sale, not a building sale; see Realism.

**2041–2052: the boom.** Twenty-five office jobs in eleven years, including:
- **#27:** 52 storeys, 383,500 sf, $356M, at 70% LTC and 4.56%. It took 80 months to reach 90% let and sold in 2051 for **$727M**.
- **#34:** 43 storeys, 337,100 sf, $351M. It was still below 90% let when its 3-year mini-perm came due in 2048, so it was the firm's **only forced sale**, at $466M. That was still $156M over cost, because land had run.
- **#49:** 19 storeys, 202,800 sf, $303M, on $128M of land. It sold in 2076 for $445M.
- **#41–48, eight 13–18 storey towers at $1,100–1,300/sf all-in** ($23M of land under 4,500 sf in one case), as rents rose from $112 to $136/sf.
- **2044:** the firm reached **#1**.

**2052–2057: the depression.** This was the worst downturn of the century, at 65 months.
- **The economy.** City jobs fell from 232,483 to 203,044 (−13%), and local unemployment went from 5.1% to 10.7%. Office vacancy went from 4.6% to 17.0%, and apartment vacancy from 2.8% to 6.1%. The office cap rate went from 6.76% to 8.32%; the land index fell from 1.41 to 0.93.
- **Who failed.** Twelve rivals: core funds, two developers, a family, a REIT-style foreign fund and private equity.
- **What it did to the firm.** Net worth fell from $676M to $351M (−48%), all marks. Two jobs that started in 2051–52 delivered into it. Nothing was forced; the firm still had a large cash cushion from the 2046–51 sales.
- **What the bot did.** It bought nothing during the depression and built a single 7,700 sf industrial shed. That is the weakest part of its play: this was the moment to buy land.

**2058–2068: the last cranes.**
- **2058:** a 7-storey apartment building at **3.83%**. Rates had fallen to a 1.2–1.8% index.
- **2059–2068: industrial.** Nine 2-storey sheds of 7–17k sf at $1.5–4M each. Industrial vacancy was 0.3% and rents ran from $17 to $28/sf; they cleared hurdles of 1.5–1.6×.

**2069–2100: built out.**
- **Almost nothing left to build.** Vacant lots fell from 432 (2040) to 73 (2060) to 40 (2100).
- **The numbers.** Of 1,137 land listings over the century, 19 penciled at the asking price. Of 1,776 owner phone calls, 3 became purchases. Of 18,431 building listings, 28 penciled as teardowns.
- **What the firm did.** It started one job in 32 years, a 3,800 sf walk-up in 2096 on $865/sf land, and sold the rest of its book into the 2070s–90s.
- **How it ended.** Kilbride and Windlass, holding 100+ buildings each through a tripling of rents, passed it. Final: **$1.81B, #3 of 81.**

---

## What happened in the other two seeds

**760449: bankrupt in 2044.**
- **2000–2025 went well.** Small walk-ups and shops, and one retail building that sold for $4.9M on a $2.55M basis (70% IRR). Net worth reached $17.2M in 2025.
- **2023, the teardown that killed it.** It bought a 10,299 sf office on Old Union St for $7.51M and paid $4.29M to empty it. The scheme that justified that price was **12 storeys**. The firm could fund **4**: 12,100 sf at **$1,256/sf all-in**.
- **2025–26.** The building delivered 0% let on a $4.0M mini-perm, and a small retail job delivered worth $2.37M against $3.58M of cost. Both were sold in 2026 at a combined $4.5M loss, the office as a forced sale.
- **2026–2044.** Left with $1.7M and land that no longer penciled at that size, it built nothing for 18 years. Overhead ate the rest.

That death is mostly the bot's fault. It bought a site priced for 12 storeys and built 4, and it carried no reserve for lease-up. But the lessons are the game's: **never buy land for the building you can't afford, and a teardown's buyout is real money.**

**550991: $77.6M, #53 of 101.** **Survived, never contended.**
- **A much harsher economy.** Same map, different market seed. Its city grew far slower (about 126,000 jobs in 2040 against 179,000 in the main seed) and went through **four depressions**: 2007–10, 2039–43, 2046–49 and 2076–79.
- **A slow start.** The firm was still at $1.6M in 2010 and $1.5M in 2020.
- **Growth came late.** It reached $11M by 2040, fell to $5M in the 2046–49 depression (eight rivals failed), then built its way to $99M by 2090 on 18 offices and 18 apartment buildings.
- **Two forced sales.** One in 2060, at a gain. The other in 2086: a 27,200 sf office forced at a $3.9M loss, with office vacancy at only 1.5%, during lease-up.
- **The result shows how much the city's own growth decides a developer's fate.** Same strategy, same map: $1.81B in a booming city, $78M in a stagnant one.

---

## What I learned (as a player)

1. **Start with walk-ups, not towers.** At $1M you can build $0.4–1.7M walk-ups at 60–70% LTC. They lease in 13–14 months and sell for 1.5–2× cost. Nothing else is affordable, and nothing else would be lent on.
2. **Sell into strength, go into busts with cash.** The firm went into every recession liquid, and none of them forced a sale.
3. **The core is a goldmine; the edge never pays.** Every big win was core office on a lot with high demand scores. Fringe apartment and retail jobs cleared hurdles of 1.03–1.06× and earned little.
4. **Build to the envelope, not to the best ratio.** My bot ranked schemes by yield-on-cost ratio, which favours shorter, cheaper buildings. On the best sites it built 16 storeys where zoning allowed 47. The game's land price assumes the tall scheme, so the next buyer paid for the floors I didn't build.
5. **Teardowns can pay, and they can kill.** 41 teardowns, $4–5M lease buyouts, and the biggest gain of the run. One badly sized teardown also killed seed 760449.
6. **A long lease-up needs long debt.** The 43-storey tower missed its 3-year mini-perm by a year and was sold at the balloon. With office vacancy at 2%, a 337k sf building still took more than three years to let.
7. **Development-only loses to holding in the long run.** Development compounds equity fast, about 30% IRRs. A built-out city leaves nothing to develop, though, and the holders' rents keep rising. A merchant builder who never keeps anything ends as a bank account.
8. **Floating debt is cheap and the bot loved it.** Floaters price off the short index, about 1.4 points under the long index, so the cheapest quote was usually floating. That's realistic, but it carries rate risk the bot never hedged after the takeout.

---

## How realistic is it?

**Realistic, often impressively so:**
- **Construction finance:** construction loans at 53–70% LTC; mini-perm takeouts; lease-up taking 13–14 months for walk-ups and 18–80 for towers; capital calls when a budget runs over.
- **Land prices** are discovered by residuals and comparables, and they move with leverage. The 2037–41 doubling and the 2052–57 slide are both what residual land does.
- **The cycle feels like a cycle:** credit freezes ("the debt markets have effectively closed"), rivals failing in clusters (2 to 12 per recession), lenders' appetites, a central-bank chair with a reputation, trade-specific busts ("Finance is in trouble…").
- **Teardown economics:** buying a building, buying out the leases at 1.25× remaining rent, demolishing at about $14/sf × cost index, and the 12-month risk that it doesn't come down.
- **Mid-depression lending:** by 2058 the index was 1.2–1.6% and apartment loans priced at 3.8%.
- **Cap rates** stay in a credible 4–9% band for a century, and move about 150bp in the big downturn.

**Not realistic, or suspicious:**
1. **Office vacancy sat between 1.3% and 2% for about two decades** (2029–2050) while office rents tripled. Real markets build into that kind of shortage within a cycle, and nothing here did. This is the MDGA plan's F1 finding ("supply does not answer a shortage") still showing on the Great City map.
2. **The core location premium keeps widening.** Market rent for my core jobs ran at 1.8× the city office index in 2011, 2.7× in 2037 and 4.5× in 2044. A premium that size is plausible (core against average); one that keeps growing for 35 years is the bid-rent curve getting steeper rather than shifting out.
3. **The land appraisal floor ignores what it costs to clear the site** (see Bugs). A new, 92%-let office was valued at its full land value, $340M on $6.0M of NOI (an implied 1.76% cap), with no deduction for buying out 13 tenants or demolishing.
4. **Vacant-land prices over 2060–2100.** The median ran from $190 to $4,846/sf and the 90th percentile to $12,814/sf. Part of that is composition (only 40–73 vacant lots left, all central). Even so, the 90th percentile rose about 10× while consumer prices rose 2.2×.
5. **Development's late game is empty.** In a real built-out city, redevelopment of under-built sites is most of what developers do. Here 28 of 18,431 building listings penciled as teardowns. The new-build hurdle carries a 17% developer margin on top of the price of the old building, and that rarely clears.

---

## Bugs found

**Fixed and merged (PR #338):**

1. **A shop that is one suite could never be let.** The new-tenant path required the address's tenant pool to cover a whole suite. That pool tops out at 98.5% of the space, so any commercial leg that is a single suite never got a tenant, anywhere, ever.
   - **Where it showed up.** A walk-up with an 855 sf shop at grade read 66% let for 16 years, at 80% monthly letter odds, in a city with 0.6% retail vacancy.
   - **The fix.** The pool now rounds to a whole suite in expectation.
2. **The bridge lender lent on the business plan forever.** The same building was refinanced on its "stabilised" value four times in 16 years, three times for cash out, at 0.30× coverage.
   - **The fix.** A plan now carries credit for one bridge term (36 months), fades out over the two customary extensions, and after that the desk lends on in-place income.

**Found, not fixed (your call):**

3. **The appraisal floor uses a flat percentage instead of a mechanism.** `landAppraisalFloor` = land × (0.92 + 0.08 × newness): a fully let new tower gets 100% of land value, and an old one 92%.
   - **What it should do.** Deduct the actual cost to clear: `buyoutQuote` for the leases, `demolitionCost`, and the income lost while clearing.
   - **Why I haven't done it.** It changes every building's value in the city and moves the baseline. The job #25 sale ($394M for a building earning $6M) is the visible symptom.
4. **The land tape and the owner-approach desk offer lots with someone else's crane on them.** That happened 163 times in the main seed. The deal can only fail at closing ("There is a crane on that lot…").
5. **`pnpm check` is red on `main`, independent of this work.** These fail on `main` before any of my changes:
   - `fund.mjs`: a fund can't be raised because the test's seed lands in a credit crunch;
   - `rival-husks`, `offmarket`, `loanbook` and `loc-pays-note`.

   CI `smoke` failed on each of the last eight PRs (CI runs #558–#565).

**Game-design gaps I hit:**
- **There's no way to wind down a firm.** Seed 760449 spent 18 years paying overhead out of its last $1.5M rather than closing and returning the cash.
- **Off-market acquisition almost never works:** 3 purchases from 1,776 calls. Owners ask 1.06–1.78× appraisal unless distressed, and some refuse to talk at all ("Ainsworth Estate will not take your call…").

---

## What I like / don't like

**Like:**
- The economy is a simulation, and you can feel it. Recessions have causes and casualties, and the press releases read like a real market.
- Every number in a development budget is real: land carry, interest reserve, points, lease-up reserve, the hedge on the takeout.
- Building the right thing in the right place at the right time pays. The 2014–19 office run and the 2041–48 tower boom were genuinely exciting.

**Don't like:**
- **The late game.** Development-only has nothing to do for the last third of the century. The city fills by about 2060, teardowns almost never pencil, and owners won't sell.
- **One decision decides the run.** Seeds diverge on one or two choices: a single teardown killed seed 760449, and a single land sale made seed 655720. Skill matters, but variance dominates in the first 25 years.
- **The game doesn't tell you to build to the envelope.** The desk ranks schemes by hurdle ratio, and a player following it under-builds the best sites, exactly as the bot did.
- **Office supply that never answers a 20-year shortage** makes the core a one-way bet. That is the opposite of what the game is trying to model.
- **Small-firm survival is binary.** There is no sublease, no partner equity, no joint venture to rescue a job, so a firm that runs short of cash during lease-up is sold at the balloon.

---

# Appendix A — seed 655720 in full

### Economics every 20 years

| Year | Phase | Index | CPI | Cost idx | City jobs | Pop | Buildings | Vacant lots | Floor area | Land $/sf (med / p90) |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| 2000 | expansion | 4.70% | 1.00 | 0.28 | 98,780 | 179,652 | 4,386 | 1,663 | 45.7M sf | $44 / $97 |
| 2020 | recession | 5.24% | 1.66 | 0.62 | 142,063 | 257,865 | 5,078 | 971 | 67.4M sf | $45 / $72 |
| 2040 | expansion | 2.56% | 2.48 | 0.85 | 179,306 | 333,121 | 5,617 | 432 | 86.3M sf | $70 / $119 |
| 2060 | recovery | 1.24% | 3.37 | 1.25 | 220,271 | 425,957 | 5,976 | 73 | 107.8M sf | $190 / $1283 |
| 2080 | recession | 3.76% | 5.51 | 2.02 | 277,519 | 520,009 | 5,987 | 62 | 115.8M sf | $3024 / $6734 |
| 2100 | recovery | 4.70% | 7.49 | 3.15 | 333,991 | 640,516 | 6,009 | 40 | 128.2M sf | $4846 / $12814 |

| Year | Off rent $/sf | MF rent $/sf | Ret rent $/sf | Ind rent $/sf | Off vac | MF vac | Ret vac | Ind vac | Off cap | MF cap | Ret cap | Ind cap |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| 2000 | $12.56 | $11.45 | $8.52 | $2.86 | 8.4% | 3.6% | 7.2% | 5.0% | 7.05% | 5.57% | 6.36% | 6.35% |
| 2020 | $20.59 | $18.08 | $13.51 | $4.92 | 9.2% | 3.4% | 8.5% | 6.3% | 7.16% | 5.47% | 6.75% | 5.77% |
| 2040 | $28.76 | $28.67 | $12.09 | $7.72 | 7.6% | 2.8% | 8.5% | 9.0% | 7.16% | 4.26% | 6.71% | 4.47% |
| 2060 | $45.32 | $42.35 | $17.74 | $16.21 | 10.7% | 3.1% | 11.7% | 1.9% | 6.73% | 4.86% | 5.36% | 4.48% |
| 2080 | $90.57 | $77.65 | $31.09 | $35.38 | 3.8% | 2.8% | 5.3% | 1.2% | 7.16% | 6.23% | 6.64% | 4.94% |
| 2100 | $134.60 | $123.47 | $45.10 | $44.45 | 7.7% | 2.8% | 8.0% | 8.6% | 8.11% | 5.97% | 7.05% | 7.88% |

### The firm every 20 years

| Year | Net worth | Cash | Line drawn | Deeds | Live jobs | Book value | Debt | NOI/yr | Rank | Leader (equity) | Jobs started | Sales |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|
| 2000 | $1.0M | $1.0M | $0K | 0 | 0 | $0K | $0K | $0K | #63/63 | The Delancey Trust ($47.0M) | 0 | 0 |
| 2020 | $42.8M | $21.1M | $0K | 3 | 0 | $45.6M | $23.8M | $846K | #15/149 | The Delancey Trust ($279.9M) | 20 | 17 |
| 2040 | $185.1M | $2.8M | $0K | 3 | 0 | $277.4M | $93.4M | $9.7M | #2/102 | Nakamura Realty ($194.4M) | 25 | 22 |
| 2060 | $549.4M | $212.1M | $0K | 22 | 4 | $727.3M | $387.3M | $53.3M | #1/129 | You ($549.4M) | 59 | 37 |
| 2080 | $1.41B | $1.17B | $0K | 17 | 0 | $575.8M | $330.5M | $39.1M | #1/99 | You ($1.41B) | 65 | 48 |
| 2100 | $1.81B | $1.78B | $0K | 6 | 0 | $89.1M | $56.6M | $6.5M | #3/81 | Kilbride & Co. ($2.48B) | 66 | 60 |

### Every development

| # | Start | Address | Use | Floors | GSF | Lot sf | Land | All-in cost | $/sf all-in | Hard $/sf | Loan | LTC | Rate | Equity | YoC | Exit yld | Hurdle | Mkt rent $/sf | City vac | Index | Phase |
|--:|---|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | 2002 | 4994 Old Vesey St | multifamily | 4 | 9,400 | 3,342 | $250K | $1.3M | $139 | $78 | $529K | 53% | 7.07% | $482K | 8.38% | 6.01% | 1.19x | $24.41 | 7.2% | 4.17% | peak |
| 2 | 2005 | 8927 Old Federal St | multifamily | 6 | 10,100 | 2,794 | $311K | $1.5M | $151 | $84 | $706K | 62% | 5.58% | $440K | 7.98% | 6.23% | 1.1x | $23.43 | 7.6% | 2.81% | recovery |
| 3 | 2005 | 5279 Old Bank St | multifamily | 6 | 10,200 | 2,825 | $417K | $1.7M | $162 | $84 | $771K | 68% | 5.14% | $379K | 8.01% | 6.25% | 1.1x | $23.46 | 6.6% | 2.55% | recovery |
| 4 | 2005 | 2250 Old Trinity Pl | multifamily | 4 | 9,200 | 3,271 | $275K | $1.3M | $145 | $81 | $690K | 69% | 5.46% | $320K | 8.05% | 6.35% | 1.08x | $21.25 | 6.3% | 2.92% | recovery |
| 5 | 2006 | 3474 Old Federal St | multifamily | 3 | 6,400 | 3,539 | $180K | $829K | $130 | $69 | $430K | 70% | 5.18% | $189K | 8.31% | 5.98% | 1.19x | $23.82 | 5.2% | 2.81% | expansion |
| 6 | 2007 | 1625 Old Denholm St | multifamily | 4 | 3,800 | 1,348 | $69K | $496K | $131 | $80 | $288K | 70% | 4.96% | $126K | 8.25% | 5.99% | 1.18x | $21.76 | 4.4% | 2.6% | expansion |
| 7 | 2008 | 9265 Old Federal St | multifamily | 1 | 2,800 | 4,030 | $140K | $419K | $150 | $66 | $179K | 70% | 6.36% | $79K | 7.34% | 5.7% | 1.1x | $20.04 | 4.7% | 4% | expansion |
| 8 | 2010 | 6354 Old Vesey St | multifamily | 3 | 7,200 | 4,006 | $108K | $830K | $115 | $71 | $447K | 64% | 7.31% | $256K | 7.44% | 5.64% | 1.13x | $15.88 | 3.8% | 4.82% | expansion |
| 9 | 2010 | 546 Old Salt Ln | multifamily | 4 | 3,800 | 1,352 | $87K | $567K | $149 | $88 | $295K | 64% | 6.46% | $169K | 8.37% | 5.36% | 1.33x | $23.81 | 3.9% | 3.94% | expansion |
| 10 | 2011 | 6825 Old Trinity Pl | office | 16 | 39,400 | 4,108 | $3.3M | $12.0M | $304 | $134 | $5.0M | 64% | 6.42% | $2.8M | 7.78% | 5.91% | 1.12x | $31.02 | 6.6% | 3.38% | expansion |
| 11 | 2013 | 8727 Old Vesey St | multifamily | 6 | 11,700 | 3,256 | $376K | $2.2M | $184 | $108 | $1.2M | 70% | 5.42% | $519K | 7.56% | 5.91% | 1.09x | $20.85 | 3.3% | 3.11% | expansion |
| 12 | 2013 | 50 West Federal St | multifamily | 7 | 46,100 | 9,411 | $909K | $7.9M | $171 | $111 | $4.7M | 70% | 4.89% | $2.1M | 7.84% | 6.1% | 1.1x | $16.8 | 3.2% | 2.69% | expansion |
| 13 | 2014 | 2838 Old State St | multifamily | 6 | 14,400 | 4,002 | $1.1M | $3.4M | $236 | $109 | $1.5M | 70% | 4.62% | $647K | 8.3% | 5.24% | 1.35x | $29.55 | 2.9% | 2.4% | expansion |
| 14 | 2014 | 2502 Old State St | office | 12 | 26,700 | 3,707 | $1.7M | $7.7M | $288 | $144 | $3.9M | 70% | 4.74% | $1.7M | 9.29% | 6.2% | 1.28x | $37.06 | 4.6% | 2.54% | expansion |
| 15 | 2014 | 2923 Old Union St | office | 12 | 30,700 | 3,195 | $1.7M | $8.6M | $279 | $144 | $4.5M | 70% | 4.47% | $2.0M | 9.85% | 5.82% | 1.45x | $37.8 | 4.2% | 2.22% | expansion |
| 16 | 2015 | 6764 Old State St | office | 14 | 31,900 | 3,794 | $2.3M | $10.2M | $321 | $157 | $5.1M | 70% | 5.04% | $2.2M | 9.48% | 5.84% | 1.39x | $40.26 | 3.0% | 2.72% | expansion |
| 17 | 2015 | 3638 Old Federal St | office | 11 | 19,800 | 3,003 | $793K | $5.2M | $263 | $150 | $2.9M | 70% | 4.95% | $1.3M | 8.9% | 6.25% | 1.22x | $32.04 | 2.5% | 2.67% | expansion |
| 18 | 2015 | 518 Old Beaver St | office | 11 | 19,400 | 2,934 | $1.0M | $5.5M | $284 | $152 | $3.0M | 70% | 4.98% | $1.3M | 10.38% | 6% | 1.48x | $39.29 | 1.9% | 2.75% | expansion |
| 19 | 2016 | 6355 Old Bank St | office | 13 | 27,400 | 3,512 | $1.6M | $8.3M | $302 | $159 | $4.4M | 70% | 4.95% | $1.9M | 10.43% | 5.93% | 1.5x | $41.9 | 1.6% | 2.74% | expansion |
| 20 | 2017 | 3751 Old Union St | office | 22 | 71,400 | 5,410 | $7.6M | $32.1M | $450 | $210 | $15.3M | 70% | 4.93% | $6.7M | 7.97% | 5.84% | 1.16x | $46.93 | 1.8% | 2.74% | expansion |
| 21 | 2021 | 7355 Old Federal St | multifamily | 1 | 3,000 | 4,290 | $200K | $818K | $273 | $145 | $246K | 42% | 9.53% | $342K | 7.47% | 6.01% | 1.06x | $31.76 | 5.1% | 6.27% | recession |
| 22 | 2024 | 759 Old Denholm St | multifamily | 2 | 7,300 | 5,232 | $167K | $1.6M | $225 | $147 | $1.0M | 70% | 5.86% | $442K | 7.5% | 6.24% | 1.03x | $26.67 | 3.2% | 3.86% | expansion |
| 23 | 2029 | 1719 Old Cortland St | office | 20 | 67,600 | 5,631 | $8.2M | $39.2M | $580 | $285 | $19.8M | 70% | 5.42% | $8.7M | 9.89% | 6.96% | 1.21x | $59.72 | 1.4% | 3.42% | expansion |
| 24 | 2032 | 547 Old Gouverneur Ln | office | 16 | 104,100 | 10,840 | $15.9M | $65.2M | $626 | $275 | $31.2M | 70% | 6.73% | $13.7M | 11.2% | 6.33% | 1.51x | $80.51 | 1.4% | 4.53% | expansion |
| 25 | 2037 | 6232 Old Bank St | office | 16 | 119,500 | 12,444 | $18.3M | $80.7M | $676 | $318 | $32.5M | 57% | 5.77% | $24.9M | 11.35% | 6.87% | 1.41x | $73.69 | 9.3% | 2.76% | recession |
| 26 | 2041 | 4396 Old Vesey St | office | 17 | 45,300 | 4,444 | $14.2M | $40.0M | $884 | $329 | $15.2M | 70% | 4.76% | $6.7M | 10.69% | 6.99% | 1.31x | $74.51 | 2.1% | 2.76% | expansion |
| 27 | 2041 | 7724 Old State St | office | 52 | 383,500 | 12,293 | $56.1M | $356.2M | $929 | $507 | $195.8M | 70% | 4.56% | $85.9M | 11.49% | 7.17% | 1.37x | $65.12 | 1.7% | 2.52% | expansion |
| 28 | 2041 | 1808 Old Cortland St | office | 14 | 31,400 | 3,737 | $9.9M | $26.6M | $847 | $308 | $9.8M | 70% | 4.66% | $4.3M | 10.21% | 6.97% | 1.25x | $74.3 | 1.4% | 2.61% | expansion |
| 29 | 2041 | 265 Old Dock Sq | office | 15 | 35,200 | 3,910 | $11.8M | $31.3M | $890 | $317 | $11.4M | 70% | 4.88% | $5.0M | 10.58% | 6.83% | 1.32x | $80.82 | 1.3% | 2.82% | expansion |
| 30 | 2041 | 3761 Old Vesey St | office | 24 | 118,000 | 8,194 | $33.9M | $112.1M | $950 | $384 | $46.6M | 70% | 4.71% | $20.5M | 10.89% | 6.97% | 1.33x | $72.59 | 1.3% | 2.6% | expansion |
| 31 | 2041 | 4159 Old Trinity Pl | office | 15 | 35,100 | 3,896 | $8.4M | $26.9M | $767 | $318 | $11.3M | 70% | 4.8% | $5.0M | 10.32% | 6.99% | 1.26x | $69.53 | 1.3% | 2.68% | expansion |
| 32 | 2041 | 4163 Old Cortland St | office | 20 | 104,300 | 8,690 | $17.7M | $77.9M | $747 | $357 | $37.9M | 70% | 4.51% | $16.6M | 10.84% | 7.14% | 1.3x | $59.54 | 1.3% | 2.42% | expansion |
| 33 | 2042 | 2949 Old Union St | office | 13 | 27,400 | 3,518 | $10.0M | $24.8M | $906 | $307 | $8.6M | 70% | 4.67% | $3.8M | 10.66% | 6.49% | 1.4x | $93.14 | 1.3% | 2.55% | expansion |
| 34 | 2042 | 8855 Old Trinity Pl | office | 43 | 337,100 | 9,798 | $76.4M | $351.3M | $1042 | $504 | $173.7M | 70% | 4.97% | $76.2M | 12.04% | 6.72% | 1.53x | $85.71 | 1.3% | 2.79% | expansion |
| 35 | 2042 | 442 Old Salt Ln | office | 12 | 22,800 | 3,160 | $6.6M | $18.2M | $800 | $305 | $7.0M | 70% | 4.89% | $3.1M | 10.36% | 6.64% | 1.33x | $87.45 | 1.3% | 2.69% | expansion |
| 36 | 2042 | 6832 Old State St | office | 13 | 26,900 | 3,445 | $11.7M | $26.9M | $1000 | $312 | $8.6M | 70% | 4.85% | $3.8M | 9.53% | 6.27% | 1.3x | $101.05 | 1.3% | 2.62% | expansion |
| 37 | 2043 | 455 Old Ingram St | multifamily | 3 | 12,700 | 7,036 | $730K | $4.2M | $331 | $198 | $2.3M | 69% | 5.84% | $1.1M | 7.62% | 6.15% | 1.06x | $33.39 | 2.8% | 3.55% | expansion |
| 38 | 2043 | 1238 Old Denholm St | multifamily | 3 | 18,500 | 10,251 | $1.0M | $6.1M | $331 | $200 | $3.4M | 70% | 5.92% | $1.5M | 7.65% | 6.19% | 1.06x | $33.69 | 2.8% | 3.73% | expansion |
| 39 | 2043 | 440 Old Jarvis St | multifamily | 3 | 20,000 | 11,121 | $1.1M | $6.7M | $337 | $203 | $3.8M | 70% | 5.48% | $1.6M | 7.48% | 6.01% | 1.06x | $34.38 | 2.8% | 3.25% | expansion |
| 40 | 2044 | 265 Old Hartwell St | multifamily | 3 | 18,700 | 10,409 | $924K | $6.2M | $329 | $204 | $3.4M | 68% | 5.47% | $1.6M | 7.8% | 6.27% | 1.06x | $34.53 | 2.8% | 3.19% | expansion |
| 41 | 2044 | 4037 Old Vesey St | office | 18 | 48,600 | 4,497 | $23.1M | $57.3M | $1178 | $381 | $19.1M | 70% | 5.29% | $8.4M | 9.39% | 6.16% | 1.3x | $121.81 | 2.4% | 3.02% | expansion |
| 42 | 2044 | 1822 Old Cortland St | office | 13 | 27,600 | 3,536 | $16.5M | $34.4M | $1246 | $340 | $9.7M | 70% | 5.06% | $4.2M | 8.86% | 5.97% | 1.27x | $132.34 | 2.0% | 2.79% | expansion |
| 43 | 2044 | 2180 Old State St | office | 14 | 30,400 | 3,619 | $15.3M | $35.0M | $1153 | $350 | $11.0M | 70% | 5.13% | $4.8M | 9.7% | 6.11% | 1.36x | $124.86 | 1.5% | 2.93% | expansion |
| 44 | 2044 | 2824 Old State St | office | 15 | 34,800 | 3,865 | $18.5M | $42.3M | $1216 | $361 | $13.1M | 70% | 5.56% | $5.7M | 10.06% | 5.91% | 1.46x | $134.75 | 1.4% | 3.35% | expansion |
| 45 | 2044 | 4855 Old State St | office | 16 | 39,500 | 4,113 | $16.7M | $42.9M | $1087 | $371 | $15.0M | 70% | 5.19% | $6.6M | 9.51% | 6.23% | 1.3x | $111.73 | 1.3% | 2.99% | expansion |
| 46 | 2044 | 4720 Old Vesey St | office | 13 | 26,900 | 3,448 | $16.9M | $34.8M | $1293 | $347 | $9.6M | 70% | 4.73% | $4.2M | 8.64% | 5.76% | 1.28x | $136.45 | 1.3% | 2.53% | expansion |
| 47 | 2045 | 3550 Old State St | office | 15 | 36,100 | 4,014 | $15.0M | $38.5M | $1067 | $365 | $13.5M | 70% | 4.77% | $5.9M | 10.41% | 6.08% | 1.46x | $123.96 | 1.6% | 2.6% | expansion |
| 48 | 2046 | 333 Old Salt Ln | office | 13 | 26,600 | 3,413 | $13.8M | $31.8M | $1194 | $368 | $9.9M | 68% | 5.98% | $4.7M | 9.47% | 5.88% | 1.38x | $131.51 | 1.7% | 3.75% | expansion |
| 49 | 2046 | 353 Old Salt Ln | office | 19 | 202,800 | 13,654 | $128.0M | $303.4M | $1496 | $425 | $93.0M | 69% | 5.89% | $43.7M | 11.73% | 5.86% | 1.71x | $135.43 | 1.9% | 3.65% | expansion |
| 50 | 2046 | 6603 Old Trinity Pl | office | 20 | 60,700 | 5,055 | $23.9M | $70.6M | $1163 | $435 | $26.8M | 69% | 5.65% | $12.4M | 8.89% | 6.18% | 1.23x | $102.28 | 1.7% | 3.42% | expansion |
| 51 | 2048 | 7321 Old Bank St | office | 12 | 23,000 | 3,199 | $12.5M | $28.8M | $1253 | $394 | $9.3M | 70% | 6.06% | $4.1M | 8.36% | 6.04% | 1.18x | $122.46 | 2.0% | 3.87% | expansion |
| 52 | 2048 | 4341 Old Union St | office | 21 | 67,000 | 5,317 | $31.0M | $90.1M | $1345 | $482 | $34.0M | 70% | 6.2% | $14.9M | 10.15% | 6.01% | 1.44x | $128.88 | 1.5% | 4.08% | expansion |
| 53 | 2051 | 353 Old Anchor Ln | office | 22 | 70,700 | 5,440 | $36.9M | $107.0M | $1514 | $552 | $40.3M | 70% | 4.97% | $17.7M | 8.95% | 6.1% | 1.25x | $137.5 | 3.1% | 2.91% | expansion |
| 54 | 2052 | 1626 Old Trinity Pl | office | 25 | 95,500 | 6,367 | $22.2M | $113.9M | $1193 | $598 | $58.7M | 70% | 5.27% | $25.7M | 9.04% | 6.38% | 1.21x | $115.23 | 5.1% | 2.85% | recession |
| 55 | 2054 | 1810 Old Granby St | industrial | 2 | 7,700 | 4,524 | $108K | $1.6M | $203 | $138 | $887K | 62% | 5.85% | $557K | 7.68% | 6.06% | 1.08x | $16.63 | 1.8% | 2.93% | depression |
| 56 | 2058 | 5156 Old Trinity Pl | multifamily | 7 | 10,600 | 2,165 | $966K | $6.0M | $565 | $345 | $3.0M | 63% | 3.83% | $1.8M | 11.05% | 6.14% | 1.54x | $93.15 | 3.5% | 1.59% | recovery |
| 57 | 2059 | 20 North Bank St | industrial | 2 | 11,700 | 6,862 | $184K | $2.3M | $193 | $130 | $1.1M | 54% | 3.95% | $947K | 7.38% | 5.62% | 1.12x | $17.71 | 3.6% | 1.44% | recovery |
| 58 | 2059 | 74 Lower Denholm St | industrial | 2 | 16,900 | 9,935 | $1.0M | $4.1M | $243 | $130 | $1.7M | 56% | 4.19% | $1.3M | 7.34% | 5.78% | 1.09x | $17.75 | 3.1% | 1.71% | recovery |
| 59 | 2059 | 2832 Old Denholm St | industrial | 2 | 7,600 | 4,486 | $167K | $1.5M | $199 | $130 | $776K | 59% | 3.55% | $547K | 8.73% | 5.69% | 1.31x | $17.87 | 2.3% | 1.11% | recovery |
| 60 | 2061 | 38 New Everett St | industrial | 2 | 6,900 | 4,085 | $76K | $1.3M | $186 | $129 | $766K | 64% | 4.16% | $431K | 8.2% | 5.59% | 1.25x | $19.06 | 1.8% | 1.78% | recession |
| 61 | 2066 | 90 Upper Granby St | industrial | 2 | 8,500 | 5,022 | $652K | $2.3M | $276 | $138 | $1.1M | 70% | 5.25% | $492K | 9.34% | 5.06% | 1.58x | $25.11 | 0.3% | 3.12% | recovery |
| 62 | 2066 | 5856 Old State St | industrial | 2 | 6,900 | 4,084 | $190K | $1.5M | $222 | $139 | $915K | 70% | 5.74% | $401K | 9.58% | 5.27% | 1.55x | $25.41 | 0.3% | 3.61% | recovery |
| 63 | 2067 | 33 East Denholm St | industrial | 2 | 10,500 | 6,183 | $436K | $2.5M | $242 | $141 | $1.4M | 70% | 6.18% | $624K | 10.13% | 5.37% | 1.61x | $26.67 | 0.3% | 4.06% | recovery |
| 64 | 2067 | 2652 Old Fenwick St | industrial | 2 | 8,100 | 4,782 | $576K | $2.2M | $275 | $141 | $1.1M | 70% | 6.39% | $483K | 9.72% | 5.23% | 1.59x | $26.8 | 0.3% | 4.24% | recovery |
| 65 | 2068 | 73 East Bank St | industrial | 2 | 7,800 | 4,563 | $481K | $2.1M | $268 | $144 | $1.1M | 70% | 6.11% | $473K | 10.06% | 5.47% | 1.57x | $27.93 | 1.1% | 3.99% | expansion |
| 66 | 2096 | 64 Upper Ingram St | multifamily | 4 | 3,800 | 1,345 | $1.2M | $4.9M | $1293 | $687 | $2.4M | 70% | 7.56% | $1.1M | 7.62% | 6% | 1.09x | $136.58 | 2.8% | 5.41% | expansion |

| # | Delivered | Slip (mo) | Value at delivery | Basis | Mini-perm | Months to 90% | Sold | Sale price | Gain | Held (mo) | Levered IRR |
|--:|---|--:|--:|--:|---|--:|---|--:|--:|--:|--:|
| 1 | 2004 | 4 | $1.7M | $1.2M | $529K @5.02% | 13 | 2006 | $2.7M | $1.5M | 46 | 39.8% |
| 2 | 2007 | 2 | $3.1M | $1.4M | $703K @4.93% | 14 | 2009 | $3.7M | $2.1M | 44 | 47.0% |
| 3 | 2007 | 1 | $3.0M | $1.5M | $713K @5.22% | 14 | 2009 | $3.4M | $1.8M | 45 | 36.5% |
| 4 | 2007 | 3 | $2.6M | $1.2M | $684K @5.3% | 13 | 2009 | $2.7M | $1.5M | 46 | 38.3% |
| 5 | 2008 | 1 | $1.6M | $773K | $415K @6.29% | — | 2009 | $1.8M | $992K | 27 | 84.2% |
| 6 | 2008 | 0 | $947K | $466K | $259K @6.2% | 13 | 2010 | $902K | $427K | 42 | 46.6% |
| 7 | 2009 | 0 | $822K | $386K | $158K @6.02% | 14 | 2011 | $776K | $376K | 39 | 42.1% |
| 8 | 2011 | 2 | $756K | $775K | $439K @5.08% | 14 | 2015 | $948K | $230K | 63 | 8.7% |
| 9 | 2012 | 0 | $894K | $529K | $258K @5% | 13 | 2013 | $1.3M | $740K | 42 | 58.8% |
| 10 | 2013 | 0 | $11.9M | $10.6M | $4.1M @5.51% | 15 | 2015 | $22.1M | $11.0M | 51 | 29.2% |
| 11 | 2015 | 0 | $3.3M | $2.0M | $1.1M @4.7% | 13 | 2017 | $3.5M | $1.5M | 44 | 35.5% |
| 12 | 2015 | 1 | $15.8M | $7.4M | $4.6M @4.85% | 14 | 2017 | $14.4M | $6.9M | 46 | 41.0% |
| 13 | 2016 | 6 | $7.4M | $3.1M | $1.5M @5.08% | 13 | 2018 | $7.6M | $4.2M | 50 | 31.6% |
| 14 | 2016 | 2 | $12.6M | $7.0M | $3.6M @5.05% | 39 | 2022 | $8.4M | $1.7M | 88 | 5.4% |
| 15 | 2016 | 1 | $15.8M | $7.9M | $3.8M @5.05% | 4 | 2018 | $19.9M | $11.5M | 47 | 49.6% |
| 16 | 2017 | 0 | $14.5M | $9.2M | $4.2M @5.37% | 7 | 2019 | $15.9M | $6.3M | 48 | 28.9% |
| 17 | 2017 | 0 | $6.5M | $4.8M | $2.5M @5.52% | 3 | 2030 | $8.4M | $4.4M | 174 | — |
| 18 | 2017 | 1 | $8.8M | $5.1M | $2.5M @5.35% | 2 | 2019 | $9.6M | $4.3M | 47 | 39.7% |
| 19 | 2017 | 0 | $12.7M | $7.6M | $4.2M @5.48% | 9 | 2019 | $14.5M | $6.6M | 46 | 26.3% |
| 20 | 2019 | 4 | $29.5M | $28.2M | $15.2M @6.34% | 33 | 2041 | $48.7M | $31.3M | 297 | — |
| 21 | 2022 | 0 | $944K | $765K | $206K @6.81% | 14 | 2024 | $1.3M | $514K | 39 | 29.2% |
| 22 | 2025 | 1 | $2.4M | $1.6M | $990K @5.87% | 14 | 2027 | $2.5M | $966K | 41 | 34.1% |
| 23 | 2032 | 1 | $47.3M | $34.7M | $16.7M @6.76% | 18 | 2034 | $57.7M | $21.2M | 53 | 16.3% |
| 24 | 2034 | 2 | $67.9M | $57.4M | $26.5M @6.39% | 21 | 2040 | $106.6M | $50.2M | 104 | 15.4% |
| 25 | 2039 | 2 | $97.2M | $72.6M | $25.9M @5.05% | 23 | 2041 | $393.9M | $305.3M | 58 | 54.8% |
| 26 | 2043 | 2 | $55.6M | $34.9M | $14.2M @5.65% | 3 | 2045 | $57.9M | $21.6M | 52 | 12.1% |
| 27 | 2044 | 7 | $559.3M | $345.2M | $178.4M @5.12% | 80 | 2051 | $727.1M | $379.1M | 123 | 9.3% |
| 28 | 2043 | 4 | $35.1M | $23.4M | $9.8M @5.83% | 2 | 2045 | $42.2M | $17.7M | 53 | 14.3% |
| 29 | 2043 | 0 | $41.0M | $27.3M | $9.4M @5.83% | 61 | 2050 | $43.6M | $17.2M | 106 | 11.2% |
| 30 | 2044 | 2 | $173.1M | $96.8M | $41.0M @5.12% | 11 | 2046 | $208.5M | $105.9M | 57 | 24.6% |
| 31 | 2043 | 2 | $33.2M | $23.8M | $9.8M @5.49% | 6 | 2045 | $41.3M | $16.5M | 52 | 20.5% |
| 32 | 2044 | 0 | $106.2M | $69.1M | $31.1M @5.12% | 21 | 2046 | $133.7M | $61.0M | 55 | 24.0% |
| 33 | 2044 | 3 | $32.6M | $21.8M | $7.3M @5.12% | 6 | 2063 | $33.6M | $16.4M | 256 | — |
| 34 | 2045 | 4 | $567.0M | $310.0M | $155.0M @4.7% | — | 2048 | $466.3M | $156.3M | 75 | 12.0% |
| 35 | 2044 | 2 | $23.5M | $16.2M | $6.4M @4.89% | 5 | 2046 | $29.9M | $12.8M | 47 | 20.5% |
| 36 | 2044 | 5 | $32.5M | $23.4M | $7.4M @5.09% | 105 | held | — | — | — | — |
| 37 | 2045 | 5 | $3.2M | $3.9M | $2.3M @4.79% | 14 | 2046 | $4.1M | $193K | 42 | -10.4% |
| 38 | 2045 | 2 | $4.6M | $5.7M | $3.4M @4.69% | 14 | 2064 | $9.7M | $6.8M | 257 | — |
| 39 | 2045 | 0 | $4.8M | $6.3M | $3.5M @4.52% | 14 | 2062 | $10.8M | $7.2M | 218 | — |
| 40 | 2045 | 2 | $4.4M | $5.8M | $3.4M @4.39% | 14 | 2071 | $10.2M | $8.0M | 331 | — |
| 41 | 2046 | 2 | $53.8M | $48.8M | $16.3M @5.85% | 26 | 2092 | $31.6M | $21.9M | 580 | — |
| 42 | 2046 | 7 | $33.1M | $29.7M | $9.6M @5.52% | 110 | held | — | — | — | — |
| 43 | 2046 | 0 | $32.3M | $30.3M | $8.8M @5.89% | 93 | held | — | — | — | — |
| 44 | 2046 | 0 | $43.4M | $36.2M | $11.1M @5.52% | 157 | 2085 | $23.9M | $6.5M | 485 | — |
| 45 | 2046 | 0 | $37.6M | $37.0M | $12.5M @5.57% | 4 | 2071 | $10.4M | $-9.1M | 316 | — |
| 46 | 2047 | 5 | $30.8M | $30.0M | $8.7M @6.12% | 20 | 2058 | $26.1M | $377K | 166 | — |
| 47 | 2047 | 4 | $38.4M | $34.5M | $12.3M @6.09% | 5 | 2089 | $36.5M | $15.4M | 528 | — |
| 48 | 2048 | 0 | $25.1M | $27.6M | $7.8M @6.18% | 20 | 2074 | $35.8M | $18.0M | 340 | — |
| 49 | 2049 | 0 | $293.8M | $255.2M | $67.2M @5.85% | 30 | 2076 | $444.9M | $303.4M | 360 | — |
| 50 | 2049 | 1 | $48.7M | $60.3M | $22.5M @5.85% | 5 | 2093 | $103.1M | $68.0M | 558 | — |
| 51 | 2050 | 0 | $19.9M | $25.1M | $8.5M @4.98% | — | 2050 | $26.3M | $378K | 41 | -2.0% |
| 52 | 2050 | 0 | $71.2M | $76.0M | $26.9M @5.03% | 51 | 2064 | $88.5M | $29.0M | 195 | — |
| 53 | 2053 | 0 | $52.6M | $91.2M | $32.5M @4.89% | 29 | 2093 | $162.2M | $117.0M | 507 | — |
| 54 | 2055 | 2 | $52.8M | $100.8M | $51.6M @4.81% | 50 | 2093 | $184.1M | $133.2M | 494 | — |
| 55 | 2055 | 0 | $1.0M | $1.5M | $784K @4.62% | 128 | 2078 | $2.6M | $1.8M | 298 | — |
| 56 | 2060 | 1 | $11.2M | $5.6M | $2.8M @3.39% | 14 | 2063 | $12.8M | $7.1M | 51 | 33.3% |
| 57 | 2060 | 0 | $2.3M | $2.2M | $958K @3.58% | 81 | 2078 | $4.8M | $3.2M | 232 | — |
| 58 | 2060 | 1 | $4.0M | $3.9M | $1.6M @3.49% | — | held | — | — | — | — |
| 59 | 2061 | 2 | $1.7M | $1.5M | $775K @3.88% | 27 | 2086 | $3.4M | $2.6M | 322 | — |
| 60 | 2062 | 0 | $1.2M | $1.2M | $682K @3.05% | 296 | 2087 | $2.6M | $2.0M | 314 | — |
| 61 | 2067 | 0 | $2.4M | $2.2M | $994K @6.46% | 122 | 2082 | $3.8M | $2.0M | 189 | — |
| 62 | 2068 | 1 | $1.5M | $1.5M | $825K @6.21% | 240 | 2090 | $2.5M | $1.6M | 278 | — |
| 63 | 2068 | 1 | $2.5M | $2.4M | $1.4M @5.73% | — | held | — | — | — | — |
| 64 | 2068 | 0 | $2.2M | $2.1M | $969K @5.73% | 236 | 2090 | $3.6M | $2.0M | 276 | — |
| 65 | 2069 | 3 | $1.9M | $2.0M | $1.1M @5.38% | 261 | 2091 | $3.4M | $1.9M | 283 | — |
| 66 | 2098 | 1 | $5.3M | $4.5M | $2.4M @7.94% | 14 | held | — | — | — | — |

### Every sale

| Year | What | Address | Price | $/sf | Basis | Gain | Held | IRR | Cap rate then | Vac then | Index | Phase |
|---|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|---|
| 2006 | #1 multifamily 9,400 gsf | 4994 Old Vesey St | $2.7M | $292 | $1.2M | $1.5M | 46 mo | 39.8% | 4.37% | 4.9% | 2.59% | expansion |
| 2009 | #2 multifamily 10,100 gsf | 8927 Old Federal St | $3.7M | $363 | $1.4M | $2.1M | 44 mo | 47.0% | 4.01% | 3.9% | 4.19% | expansion |
| 2009 | #5 multifamily 6,400 gsf | 3474 Old Federal St | $1.8M | $281 | $773K | $992K | 27 mo | 84.2% | 4.03% | 4.0% | 4.01% | expansion |
| 2009 | #3 multifamily 10,200 gsf | 5279 Old Bank St | $3.4M | $336 | $1.5M | $1.8M | 45 mo | 36.5% | 4.09% | 4.1% | 3.72% | expansion |
| 2009 | #4 multifamily 9,200 gsf | 2250 Old Trinity Pl | $2.7M | $297 | $1.2M | $1.5M | 46 mo | 38.3% | 4.14% | 4.4% | 3.92% | expansion |
| 2010 | #6 multifamily 3,800 gsf | 1625 Old Denholm St | $902K | $237 | $466K | $427K | 42 mo | 46.6% | 5.18% | 3.7% | 3.72% | expansion |
| 2011 | #7 multifamily 2,800 gsf | 9265 Old Federal St | $776K | $277 | $386K | $376K | 39 mo | 42.1% | 5.61% | 3.8% | 2.91% | expansion |
| 2013 | #9 multifamily 3,800 gsf | 546 Old Salt Ln | $1.3M | $341 | $529K | $740K | 42 mo | 58.8% | 4.86% | 3.2% | 2.69% | expansion |
| 2015 | #8 multifamily 7,200 gsf | 6354 Old Vesey St | $948K | $132 | $775K | $230K | 63 mo | 8.7% | 3.95% | 2.8% | 2.16% | expansion |
| 2015 | #10 office 39,400 gsf | 6825 Old Trinity Pl | $22.1M | $561 | $10.6M | $11.0M | 51 mo | 29.2% | 5.71% | 3.0% | 2.81% | expansion |
| 2017 | #11 multifamily 11,700 gsf | 8727 Old Vesey St | $3.5M | $301 | $2.0M | $1.5M | 44 mo | 35.5% | 4.17% | 3.4% | 3.34% | expansion |
| 2017 | #12 multifamily 46,100 gsf | 50 West Federal St | $14.4M | $312 | $7.4M | $6.9M | 46 mo | 41.0% | 4.36% | 3.1% | 3.12% | expansion |
| 2018 | #13 multifamily 14,400 gsf | 2838 Old State St | $7.6M | $525 | $3.1M | $4.2M | 50 mo | 31.6% | 4.81% | 3.0% | 3.29% | expansion |
| 2018 | #15 office 30,700 gsf | 2923 Old Union St | $19.9M | $649 | $7.9M | $11.5M | 47 mo | 49.6% | 6.31% | 4.7% | 3.96% | expansion |
| 2019 | #16 office 31,900 gsf | 6764 Old State St | $15.9M | $498 | $9.2M | $6.3M | 48 mo | 28.9% | 6.76% | 7.8% | 4.52% | expansion |
| 2019 | #19 office 27,400 gsf | 6355 Old Bank St | $14.5M | $529 | $7.6M | $6.6M | 46 mo | 26.3% | 6.94% | 8.8% | 4.93% | peak |
| 2019 | #18 office 19,400 gsf | 518 Old Beaver St | $9.6M | $495 | $5.1M | $4.3M | 47 mo | 39.7% | 6.98% | 9.0% | 5.17% | peak |
| 2022 | #14 office 26,700 gsf | 2502 Old State St | $8.4M | $316 | $7.0M | $1.7M | 88 mo | 5.4% | 8.93% | 14.4% | 5.78% | recovery |
| 2024 | #21 multifamily 3,000 gsf | 7355 Old Federal St | $1.3M | $430 | $765K | $514K | 39 mo | 29.2% | 4.72% | 3.1% | 4.08% | expansion |
| 2027 | #22 multifamily 7,300 gsf | 759 Old Denholm St | $2.5M | $346 | $1.6M | $966K | 41 mo | 34.1% | 4.62% | 3.5% | 3.12% | peak |
| 2030 | #17 office 19,800 gsf | 3638 Old Federal St | $8.4M | $423 | $4.8M | $4.4M | 174 mo | — | 6.21% | 1.4% | 3.7% | expansion |
| 2034 | #23 office 67,600 gsf | 1719 Old Cortland St | $57.7M | $853 | $34.7M | $21.2M | 53 mo | 16.3% | 7.13% | 6.2% | 4.48% | expansion |
| 2040 | #24 office 104,100 gsf | 547 Old Gouverneur Ln | $106.6M | $1024 | $57.4M | $50.2M | 104 mo | 15.4% | 6.59% | 4.9% | 3.15% | expansion |
| 2041 | #20 office 71,400 gsf | 3751 Old Union St | $48.7M | $682 | $28.2M | $31.3M | 297 mo | — | 5.89% | 1.3% | 2.5% | expansion |
| 2041 | #25 office 119,500 gsf | 6232 Old Bank St | $393.9M | $3296 | $72.6M | $305.3M | 58 mo | 54.8% | 5.66% | 1.3% | 2.62% | expansion |
| 2045 | #26 office 45,300 gsf | 4396 Old Vesey St | $57.9M | $1278 | $34.9M | $21.6M | 52 mo | 12.1% | 5.83% | 1.4% | 2.5% | expansion |
| 2045 | #28 office 31,400 gsf | 1808 Old Cortland St | $42.2M | $1344 | $23.4M | $17.7M | 53 mo | 14.3% | 5.80% | 1.4% | 2.18% | expansion |
| 2045 | #31 office 35,100 gsf | 4159 Old Trinity Pl | $41.3M | $1178 | $23.8M | $16.5M | 52 mo | 20.5% | 5.76% | 1.3% | 2.92% | expansion |
| 2046 | #35 office 22,800 gsf | 442 Old Salt Ln | $29.9M | $1310 | $16.2M | $12.8M | 47 mo | 20.5% | 5.85% | 1.3% | 3.12% | expansion |
| 2046 | #30 office 118,000 gsf | 3761 Old Vesey St | $208.5M | $1767 | $96.8M | $105.9M | 57 mo | 24.6% | 5.89% | 1.3% | 3.49% | expansion |
| 2046 | #32 office 104,300 gsf | 4163 Old Cortland St | $133.7M | $1282 | $69.1M | $61.0M | 55 mo | 24.0% | 5.95% | 1.6% | 3.45% | expansion |
| 2046 | #37 multifamily 12,700 gsf | 455 Old Ingram St | $4.1M | $326 | $3.9M | $193K | 42 mo | -10.4% | 5.54% | 2.8% | 3.31% | expansion |
| 2048 | **FORCED** #34 office 337,100 gsf | 8855 Old Trinity Pl | $466.3M | $1383 | $310.0M | $156.3M | 75 mo | 12.0% | 6.53% | 2.0% | 3.87% | expansion |
| 2050 | #29 office 35,200 gsf | 265 Old Dock Sq | $43.6M | $1240 | $27.3M | $17.2M | 106 mo | 11.2% | 6.53% | 2.6% | 2.88% | peak |
| 2050 | #51 office 23,000 gsf | 7321 Old Bank St | $26.3M | $1142 | $25.1M | $378K | 41 mo | -2.0% | 6.50% | 2.7% | 3.24% | expansion |
| 2051 | #27 office 383,500 gsf | 7724 Old State St | $727.1M | $1896 | $345.2M | $379.1M | 123 mo | 9.3% | 6.57% | 3.3% | 2.81% | expansion |
| 2058 | #46 office 26,900 gsf | 4720 Old Vesey St | $26.1M | $972 | $30.0M | $377K | 166 mo | — | 7.61% | 15.5% | 1.89% | recovery |
| 2062 | #39 multifamily 20,000 gsf | 440 Old Jarvis St | $10.8M | $540 | $6.3M | $7.2M | 218 mo | — | 4.09% | 4.2% | 0.89% | depression |
| 2063 | #56 multifamily 10,600 gsf | 5156 Old Trinity Pl | $12.8M | $1207 | $5.6M | $7.1M | 51 mo | 33.3% | 3.93% | 5.3% | 2.1% | recovery |
| 2063 | #33 office 27,400 gsf | 2949 Old Union St | $33.6M | $1226 | $21.8M | $16.4M | 256 mo | — | 6.25% | 7.6% | 2.21% | recovery |
| 2064 | #52 office 67,000 gsf | 4341 Old Union St | $88.5M | $1321 | $76.0M | $29.0M | 195 mo | — | 5.64% | 8.9% | 1.61% | recovery |
| 2064 | #38 multifamily 18,500 gsf | 1238 Old Denholm St | $9.7M | $523 | $5.7M | $6.8M | 257 mo | — | 3.88% | 5.0% | 2.07% | recovery |
| 2071 | #45 office 39,500 gsf | 4855 Old State St | $10.4M | $264 | $37.0M | $-9.1M | 316 mo | — | 7.39% | 9.6% | 3.93% | expansion |
| 2071 | #40 multifamily 18,700 gsf | 265 Old Hartwell St | $10.2M | $548 | $5.8M | $8.0M | 331 mo | — | 4.56% | 2.8% | 4.11% | expansion |
| 2074 | #48 office 26,600 gsf | 333 Old Salt Ln | $35.8M | $1347 | $27.6M | $18.0M | 340 mo | — | 6.96% | 5.8% | 4% | expansion |
| 2076 | #49 office 202,800 gsf | 353 Old Salt Ln | $444.9M | $2194 | $255.2M | $303.4M | 360 mo | — | 6.87% | 4.0% | 4.36% | expansion |
| 2078 | #55 industrial 7,700 gsf | 1810 Old Granby St | $2.6M | $336 | $1.5M | $1.8M | 298 mo | — | 5.60% | 0.3% | 4.65% | expansion |
| 2078 | #57 industrial 11,700 gsf | 20 North Bank St | $4.8M | $408 | $2.2M | $3.2M | 232 mo | — | 5.54% | 0.3% | 4.42% | expansion |
| 2082 | #61 industrial 8,500 gsf | 90 Upper Granby St | $3.8M | $449 | $2.2M | $2.0M | 189 mo | — | 4.63% | 7.3% | 2.54% | recession |
| 2085 | #44 office 34,800 gsf | 2824 Old State St | $23.9M | $687 | $36.2M | $6.5M | 485 mo | — | 7.30% | 14.0% | 1.99% | recovery |
| 2086 | #59 industrial 7,600 gsf | 2832 Old Denholm St | $3.4M | $454 | $1.5M | $2.6M | 322 mo | — | 5.10% | 11.6% | 2.19% | expansion |
| 2087 | #60 industrial 6,900 gsf | 38 New Everett St | $2.6M | $382 | $1.2M | $2.0M | 314 mo | — | 5.41% | 9.5% | 2.61% | expansion |
| 2089 | #47 office 36,100 gsf | 3550 Old State St | $36.5M | $1012 | $34.5M | $15.4M | 528 mo | — | 7.06% | 10.4% | 3.15% | expansion |
| 2090 | #62 industrial 6,900 gsf | 5856 Old State St | $2.5M | $358 | $1.5M | $1.6M | 278 mo | — | 5.94% | 1.8% | 2.58% | expansion |
| 2090 | #64 industrial 8,100 gsf | 2652 Old Fenwick St | $3.6M | $447 | $2.1M | $2.0M | 276 mo | — | 5.92% | 1.5% | 3.65% | expansion |
| 2091 | #65 industrial 7,800 gsf | 73 East Bank St | $3.4M | $435 | $2.0M | $1.9M | 283 mo | — | 5.90% | 1.7% | 3.85% | expansion |
| 2092 | #41 office 48,600 gsf | 4037 Old Vesey St | $31.6M | $651 | $48.8M | $21.9M | 580 mo | — | 6.74% | 4.0% | 3.75% | expansion |
| 2093 | #50 office 60,700 gsf | 6603 Old Trinity Pl | $103.1M | $1698 | $60.3M | $68.0M | 558 mo | — | 6.41% | 3.5% | 3.04% | expansion |
| 2093 | #53 office 70,700 gsf | 353 Old Anchor Ln | $162.2M | $2294 | $91.2M | $117.0M | 507 mo | — | 6.34% | 3.2% | 3.06% | expansion |
| 2093 | #54 office 95,500 gsf | 1626 Old Trinity Pl | $184.1M | $1928 | $100.8M | $133.2M | 494 mo | — | 6.33% | 3.2% | 2.8% | expansion |

### Land bought

| Year | Address | Lot sf | Price | $/sf | How | Financing |
|---|---|--:|--:|--:|---|---|
| 2002 | 4994 Old Vesey St | 3,342 | $245K | $73 | tape | cash |
| 2005 | 8927 Old Federal St | 2,794 | $305K | $109 | off-market | land loan $139K @4.15% |
| 2005 | 5279 Old Bank St | 2,825 | $409K | $145 | tape | land loan $207K @3.88% |
| 2005 | 2250 Old Trinity Pl | 3,271 | $269K | $82 | tape | cash |
| 2006 | 3474 Old Federal St | 3,539 | $176K | $50 | off-market | cash |
| 2007 | 1625 Old Denholm St | 1,348 | $68K | $50 | tape | cash |
| 2008 | 9265 Old Federal St | 4,030 | $137K | $34 | tape | cash |
| 2009 | 6354 Old Vesey St | 4,006 | $106K | $26 | tape | cash |
| 2010 | 546 Old Salt Ln | 1,352 | $85K | $63 | tape | cash |
| 2011 | 6825 Old Trinity Pl | 4,108 | $3.2M | $787 | off-market | land loan $1.2M @7.76% |
| 2013 | 8727 Old Vesey St | 3,256 | $369K | $113 | tape | land loan $160K @4.11% |
| 2013 | 50 West Federal St | 9,411 | $891K | $95 | tape | cash |
| 2021 | 7355 Old Federal St | 4,290 | $196K | $46 | tape | cash |
| 2024 | 759 Old Denholm St | 5,232 | $164K | $31 | tape | cash |
| 2043 | 455 Old Ingram St | 7,036 | $715K | $102 | tape | cash |
| 2043 | 1238 Old Denholm St | 10,251 | $991K | $97 | tape | cash |
| 2043 | 440 Old Jarvis St | 11,121 | $1.1M | $100 | tape | cash |
| 2044 | 265 Old Hartwell St | 10,409 | $906K | $87 | tape | cash |
| 2053 | 1810 Old Granby St | 4,524 | $106K | $24 | tape | cash |
| 2059 | 20 North Bank St | 6,862 | $181K | $26 | tape | cash |
| 2059 | 74 Lower Denholm St | 9,935 | $994K | $100 | tape | cash |
| 2059 | 2832 Old Denholm St | 4,486 | $164K | $36 | tape | cash |
| 2060 | 38 New Everett St | 4,085 | $75K | $18 | tape | cash |
| 2066 | 5856 Old State St | 4,084 | $186K | $46 | tape | cash |
| 2096 | 64 Upper Ingram St | 1,345 | $1.2M | $865 | tape | land loan $540K @7.90% |

### Final league table

| Rank | Firm | Style | Equity | Deeds |
|--:|---|---|--:|--:|
| 1 | Kilbride & Co. | owneruser | $2.48B | 158 |
| 2 | Windlass Partners | family | $2.20B | 126 |
| 3 | **You** | player | $1.81B | 6 |
| 4 | Wexler & Sons | pe | $1.69B | 110 |
| 5 | Dunmore Investors | family | $1.39B | 185 |
| 6 | Quimby & Sons | family | $1.06B | 109 |
| 7 | Thorne & Boyle Brothers | family | $985.3M | 37 |
| 8 | Castellane Holdings | owneruser | $928.2M | 98 |
| 9 | Hollis Development Co. | pe | $889.3M | 72 |
| 10 | Thorne & Boyle Brothers | family | $799.4M | 38 |
| 11 | Corbin Whitlock | opportunistic | $728.6M | 137 |
| 12 | Thorne & Boyle Brothers | family | $723.6M | 80 |

Counters: `{"landBids":43,"landBought":25,"built":66,"takeouts":62,"teardownBids":41,"teardownsBought":41,"demolished":41,"refis":93,"cashOutRefis":62,"lettersSigned":11}`

Tape: `{"land":1137,"landPencil":19,"bldg":18431,"teardownPencil":28}` · off-market: `{"rounds":371,"calls":1776,"refused":402,"bought":3,"tooDear":852,"cantFund":29}`

Friction: 1114× land: does not pencil at ask · 121× buyOffMarket: There is a crane on that lot — somebody else's job is under way. It is not for sale until it tops out or the receiver takes it. · 42× close: There is a crane on that lot — somebody else's job is under way. It is not for sale until it tops out or the receiver takes it. · 39× approach: Ainsworth Estate will not take your call. Whatever happened between you, they own more than this one building and they have not forgotten it · 18× approach: Ainsworth Estate are not taking your call at the moment. · 9× approach: That conversation ended badly and they have not forgotten it. This one is shut for years, not months. · 9× approach: You knocked recently — the owner hasn't changed their mind. · 9× refinance: No lender will size a loan against this income. · 7× approach: Marchetti Family Trust will not take your call. Whatever happened between you, they own more than this one building and they have not forgot · 4× land: pencils, cannot fund dirt + job · 4× approach: Sutcliffe Holdings will not take your call. Whatever happened between you, they own more than this one building and they have not forgotten  · 3× approach: Nolan Holdings are not taking your call at the moment.

### Every recession

| Years | Months | Depression? | Index before → peak (24 mo earlier) | Local unemp | City jobs | Office vac | MF vac | Retail vac | Ind vac | MF cap | Office cap | Credit idx low | Land idx | Rivals failed | My NW start → low → end | My starts / sales / forced |
|---|--:|---|---|---|---|---|---|---|---|---|---|--:|---|--:|---|---|
| 2002–2004 | 17 | no | 3.85% → 3.9% (4.97%) | 5.6% → 7% | 98,419 → 96,382 | 14.2% → 17.3% | 7.8% → 8.4% | 12.6% → 14.4% | 7.2% → 8.9% | 6.01% → 6.01% | 8.21% → 8.63% | 0.529 | 1.25 → 1.11 | 2 | $1.0M → $950K → $1.1M | 0 / 0 / 0 |
| 2020–2021 | 19 | no | 5.24% → 6.43% (3.32%) | 5.3% → 7.6% | 142,063 → 138,289 | 9.2% → 14.0% | 3.4% → 5.2% | 8.5% → 11.0% | 6.3% → 10.1% | 5.47% → 5.97% | 7.16% → 9.11% | 0.592 | 1.11 → 0.99 | 5 | $42.8M → $30.7M → $30.8M | 1 / 0 / 0 |
| 2037–2038 | 17 | no | 3.3% → 3.3% (4.23%) | 5% → 6.8% | 171,771 → 168,497 | 9.4% → 9.5% | 2.8% → 2.9% | 10.8% → 10.8% | 2.8% → 6.0% | 4.90% → 5.00% | 7.65% → 7.99% | 0.552 | 1.10 → 1.04 | 4 | $82.1M → $77.0M → $77.0M | 1 / 0 / 0 |
| 2052–2057 | 65 | **yes** | 2.77% → 3.22% (2.88%) | 5.1% → 10.7% | 232,483 → 203,044 | 4.6% → 17.0% | 2.8% → 6.1% | 11.7% → 14.9% | 1.5% → 5.2% | 4.44% → 6.19% | 6.76% → 8.32% | 0.691 | 1.41 → 0.93 | 12 | $676.0M → $351.2M → $367.0M | 2 / 0 / 0 |
| 2060–2062 | 22 | **yes** | 1.76% → 1.78% (1.59%) | 7% → 8.8% | 220,538 → 215,080 | 7.1% → 7.1% | 3.3% → 5.0% | 10.3% → 10.3% | 1.7% → 3.5% | 4.21% → 4.21% | 6.53% → 6.59% | 0.778 | 0.87 → 0.87 | 7 | $604.1M → $592.4M → $700.0M | 1 / 1 / 0 |
| 2079–2081 | 20 | no | 3.69% → 3.99% (4.11%) | 4.8% → 6.7% | 278,793 → 273,919 | 3.6% → 7.1% | 2.8% → 2.8% | 4.9% → 6.7% | 0.4% → 3.9% | 5.95% → 6.32% | 6.91% → 7.33% | 0.681 | 1.34 → 1.34 | 7 | $1.38B → $1.38B → $1.39B | 0 / 0 / 0 |
| 2082–2084 | 25 | **yes** | 2.78% → 2.78% (3.5%) | 8% → 10.1% | 273,295 → 265,647 | 9.1% → 13.1% | 2.8% → 3.0% | 7.8% → 9.8% | 7.1% → 14.2% | 5.81% → 5.81% | 7.40% → 7.91% | 0.58 | 1.30 → 1.16 | 8 | $1.39B → $1.33B → $1.34B | 0 / 1 / 0 |
| 2098–2099 | 20 | no | 5.62% → 6.41% (5.02%) | 4.9% → 7.3% | 337,958 → 329,429 | 4.3% → 7.2% | 2.8% → 2.9% | 6.7% → 7.9% | 7.0% → 8.4% | 5.15% → 6.02% | 7.26% → 8.23% | 0.553 | 1.29 → 1.25 | 5 | $1.75B → $1.75B → $1.81B | 0 / 0 / 0 |

- **2002–2004** — failed: Ferro Construction Co. (merchant), Pell Street Holdings (opportunistic) · headlines: 2002: The debt markets have effectively closed. The bond buyers have gone, the banks are lending only to names they already know, and term sheets are being pulled mid-deal. | 2002: Elena Marsh takes the chair of the central bank — The market reads a dove. Inflation is running 3.5% and the policy rate is 3.72%; expect growth first and inflation to be given room — cheaper money for now, and the risk  | 2003: Thorne & Devereaux has finally split. 6 buildings go to market because that is the only way two people who do not speak can divide anything. | 2003: Sanderling Trust has called $143K from their partners. They were not going to sell a building over a bad year, and they did not have to. | 2003: Ironbound Development has called $128K from their partners. They were not going to sell a building over a bad year, and they did not have to.
- **2020–2021** — failed: Moresby Capital (merchant), Rookery Investments (vulture), Marek Partners (pe), Ashby Realty (merchant), Beckwith Holdings (vulture) · headlines: 2020: Sanderling Trust has opened 12 Upper Cortland St. It is empty today and it is competing with you tomorrow. | 2020: Kilbride & Co. has opened 35 West Cortland St. It is empty today and it is competing with you tomorrow. | 2020: Selkirk Trust has lost a major tenant. Their book is running at 79% — somebody in this town is about to have space to fill. | 2020: Haverford Partners has called $286K from their partners. They were not going to sell a building over a bad year, and they did not have to. | 2020: Moresby Capital is wound up. They handed back the last building months ago and went on paying interest on what was left until they could not — 15 months in arrears with nothing behind it, and no collateral for the receiv
- **2037–2038** — failed: Ovington Capital (developer), Vance Partners (pe), Wardlow Property Group (developer), Coyne Capital (vulture) · headlines: 2037: Wardlow Investors has called $1.68M from their partners. They were not going to sell a building over a bad year, and they did not have to. | 2037: Alden Development Co. has opened 16 North State St. It is empty today and it is competing with you tomorrow. | 2037: The county's foreclosure docket is out: 1 lot cross the block this month. As-is, ten per cent down, no financing and no warranty — the hammer falls at the end of July. | 2037: Ovington Capital has wound up. The last building is gone, the debt is clear, and after two years with nothing left to buy they returned what remained to their partners. | 2037: Vance Partners has wound up. The last building is gone, the debt is clear, and after two years with nothing left to buy they returned what remained to their partners.
- **2052–2057** — failed: Bellweather Estates (core), Ovington & Sons (opportunistic), Halyard Investors (foreign), Garrity Capital (developer), Yarrow Realty (vulture), Ziegler Investors (developer), Aldous Partners (pe), Thackeray Realty (opportunistic), Jessup Investors (merchant), Haverford Partners (owneruser), Vance Brothers (family), Lanterman & Sons (developer) · headlines: 2052: Prentiss Holdings has wound up. The last building is gone, the debt is clear, and after two years with nothing left to buy they returned what remained to their partners. | 2052: Thackeray Realty has called $102K from their partners. They were not going to sell a building over a bad year, and they did not have to. | 2052: Selkirk Capital has bought Ovington & Sons outright — 1 building marked at $422K, $644K to the owners, and $142K of paper assumed. Ovington & Sons comes off the street. | 2052: Bellweather Estates is wound up. They handed back the last building months ago and went on paying interest on what was left until they could not — 15 months in arrears with nothing behind it, and no collateral for the re | 2052: The debt markets have effectively closed. The bond buyers have gone, the banks are lending only to names they already know, and term sheets are being pulled mid-deal.
- **2060–2062** — failed: Bryce Capital (pe), Odell Capital (pe), Hollis Partners (pe), Garrity Property Group (developer), Vance Trust (vulture), Wardlow Development Co. (developer), Hollis Holdings (pe) · headlines: 2060: Haverford & Sons bought the loan on 22 West Bank St off Meridian Street Capital at 62 cents. They are not buying a bond. Fenwick & Co. has about a year to find the money. | 2061: Finance is in trouble. Look at how much of your rent roll depends on it before somebody hands you the keys.
- **2079–2081** — failed: Bryce Holdings (pe), Hollis Investors (pe), Moresby Property Group (opportunistic), Ashby Property Group (core), Fielding & Crane (opportunistic), Prentiss Capital (vulture), Ingram Development Co. (pe) · headlines: 2079: Merrow & Sons has bought Bryce Holdings outright — 1 building marked at $1.1M, $1.5M to the owners, and $124K of paper assumed. Bryce Holdings comes off the street. | 2079: Leonard Strand takes the chair of the central bank — The market reads a centrist. Inflation is running 1.4% and the policy rate is 3.05%; nobody expects the bank's course to change much. | 2079: Technology is in trouble. Look at how much of your rent roll depends on it before somebody hands you the keys. | 2079: The national recession is over on paper. Nobody in the room feels it yet. | 2080: The Thorne & Boyle family could not agree on what to do with the business, so they have halved it: 23 buildings go to Thorne & Boyle Brothers. The two branches will be bidding against each other within the year.
- **2082–2084** — failed: Ingram Realty (pe), Ashby Holdings (core), Lanterman Development Co. (developer), Thackeray Development Co. (core), Fenwick Partners (developer), Trask Property Group (pe), Haverford Capital (developer), Fenn Trust (pe) · headlines: 2082: Thackeray Holdings has bought Ingram Realty outright — 1 building marked at $991K, $1.5M to the owners, and $334K of paper assumed. Ingram Realty comes off the street. | 2082: Merrow & Sons has bought Ashby Holdings outright — 1 building marked at $2.0M, $2.6M to the owners, and $532K of paper assumed. Ashby Holdings comes off the street. | 2082: The debt markets have effectively closed. The bond buyers have gone, the banks are lending only to names they already know, and term sheets are being pulled mid-deal. | 2082: Retail demand is rolling over. Brokers are quietly cutting asking rents. | 2082: Thackeray Development Co. has wound up. The last building is gone, the debt is clear, and after two years with nothing left to buy they returned what remained to their partners.
- **2098–2099** — failed: Selkirk & Co. (reit), Wexler Coyne Capital (pe), Beckwith Property Group (core), Bryce Trust (pe), Bryce Ashby Partners (pe) · headlines: 2098: 64 Upper Ingram St called $31K of additional equity this month. The construction budget has outrun its remaining equity and loan commitment; cash funded the gap. | 2098: Vance Property Group is finished — 2 buildings go to the lenders. They have not made a payment in 15 months, the partners stopped answering and no desk would extend again. The receiver will be selling for years. | 2098: 64 Upper Ingram St has delivered — 4k sf of multifamily, after 1 problem, $3.3M all in, with $182K of contingency returned. The mini-perm matures Mar 2103 — stabilise it before then. | 2098: The lease-up reserve at 64 Upper Ingram St was $88K, and only $68K of it is still fundable. The fit-out and the leasing commissions on the rest come out of your own account. | 2098: 64 Upper Ingram St called $26K of additional equity this month. The construction budget has outrun its remaining equity and loan commitment; cash funded the gap.


# Appendix B — seed 550991's recessions

### Every recession

| Years | Months | Depression? | Index before → peak (24 mo earlier) | Local unemp | City jobs | Office vac | MF vac | Retail vac | Ind vac | MF cap | Office cap | Credit idx low | Land idx | Rivals failed | My NW start → low → end | My starts / sales / forced |
|---|--:|---|---|---|---|---|---|---|---|---|---|--:|---|--:|---|---|
| 2003–2003 | 5 | no | 5.96% → 5.96% (5.1%) | 6% → 6% | 96,296 → 96,296 | 13.7% → 13.7% | 6.9% → 6.9% | 11.7% → 11.7% | 10.9% → 11.1% | 5.82% → 5.82% | 8.63% → 8.71% | 0.946 | 0.88 → 0.86 | 0 | $1.0M → $1.0M → $1.0M | 0 / 0 / 0 |
| 2007–2010 | 30 | **yes** | 5.48% → 5.48% (6.82%) | 5.9% → 10.3% | 98,312 → 92,675 | 7.6% → 10.6% | 3.1% → 7.7% | 11.5% → 12.5% | 11.9% → 17.1% | 5.99% → 6.06% | 8.77% → 8.83% | 0.491 | 0.81 → 0.81 | 3 | $1.3M → $1.3M → $1.6M | 0 / 0 / 0 |
| 2016–2016 | 9 | no | 3.96% → 4.39% (3.97%) | 7.1% → 7.7% | 99,899 → 99,055 | 10.0% → 10.1% | 3.6% → 5.3% | 10.5% → 10.8% | 0.7% → 2.4% | 4.65% → 4.99% | 6.80% → 7.17% | 0.721 | 0.94 → 0.94 | 0 | $1.6M → $1.6M → $1.6M | 0 / 0 / 0 |
| 2019–2020 | 6 | no | 2.78% → 2.86% (3.03%) | 6.6% → 6.6% | 103,453 → 103,453 | 9.3% → 9.3% | 5.3% → 5.4% | 9.5% → 9.6% | 6.0% → 7.9% | 4.57% → 4.57% | 7.00% → 7.03% | 0.868 | 0.97 → 0.97 | 1 | $1.6M → $1.5M → $2.2M | 0 / 0 / 0 |
| 2025–2027 | 17 | no | 3.81% → 5.18% (4.8%) | 6.1% → 8.3% | 111,007 → 108,345 | 6.8% → 8.6% | 3.0% → 3.0% | 6.9% → 7.5% | 5.7% → 9.2% | 5.38% → 5.57% | 7.63% → 8.15% | 0.525 | 1.04 → 1.00 | 2 | $2.9M → $2.8M → $3.0M | 0 / 0 / 0 |
| 2027–2028 | 5 | no | 3.66% → 3.99% (4.22%) | 8.8% → 8.8% | 107,709 → 107,709 | 9.6% → 10.7% | 3.1% → 3.1% | 7.7% → 7.9% | 9.7% → 10.3% | 5.49% → 5.49% | 8.14% → 8.16% | 0.699 | 0.99 → 0.97 | 1 | $3.0M → $3.0M → $3.1M | 1 / 0 / 0 |
| 2034–2035 | 9 | no | 2.96% → 2.96% (4.76%) | 5.8% → 6.5% | 126,679 → 125,842 | 2.4% → 4.1% | 2.8% → 2.8% | 5.2% → 5.9% | 3.0% → 8.1% | 6.01% → 6.01% | 6.90% → 6.90% | 0.781 | 0.99 → 0.99 | 0 | $10.6M → $10.6M → $12.5M | 0 / 0 / 0 |
| 2035–2036 | 6 | no | 2.87% → 3.06% (4.14%) | 7.1% → 7.7% | 125,339 → 124,473 | 5.8% → 7.8% | 3.0% → 3.0% | 6.7% → 7.6% | 8.7% → 10.1% | 5.72% → 5.75% | 6.79% → 6.95% | 0.932 | 0.98 → 0.97 | 0 | $12.6M → $11.9M → $12.6M | 0 / 0 / 0 |

