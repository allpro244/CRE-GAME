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
| 550991 | $6.2M at 2040 | SEE_550991 | | | |

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

**550991:** SEE_550991_STORY

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

SEE_TABLES
