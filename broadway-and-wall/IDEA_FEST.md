# IDEA FEST

Things nobody asked for. The owner said to keep a file of them and throw them
over the wall now and again, so this is that file.

Nothing here is a commitment. An idea earns its way onto the backlog by being
a real risk or a real decision that the simulation is currently silent about —
CLAUDE.md's rule holds: *"If the game feels too easy, the question is never
what should we make worse — it is which real risk is not being modelled yet."*

Ideas that graduate get a task number and leave this file.

---

## 1 · THE BROKER WHO CALLS YOU FIRST

The leasing exclusive exists (`h.broker`) and the house is anonymous. Give the
house a name and a memory. A broker who has been paid on three of your deals
brings you the fourth **before it goes wide** — which is the entire reason
anybody pays six per cent, and the reason a relationship in this business is
an asset and not a pleasantry.

The mechanic writes itself: a hidden relationship score per broker, moved by
fees paid and by whether you take their advice; above a threshold you see
listings a month or two before the tape does. The cost is that you are paying
for access you might not need.

*Related to #33.*

---

## 2 · THE TENANT WHO OUTGROWS THE SUITE

`t.staff` already tracks whether a tenant is growing or shrinking and the rent
roll already prints "growing" and "shrinking" on the row. Nothing happens.

A growing tenant should come to **you** first: they want the floor above, and
if you have not got it they will look at buildings that do — including yours
across town. A shrinking one should ask to give space back before they default,
which is a decision (take the space and re-let it, or hold them to the lease
and risk the default).

This turns the rent roll from a table into a set of relationships, and it costs
almost nothing because the state is already there.

*Related to #33.*

---

## 3 · THE STATION

Cities do not only build buildings. A transit line, a park, a bridge, a
stadium, a highway that goes in — or comes down — moves land value in a way no
building ever does, and it is how a city acquires a history you can point at.

A station opening three blocks from a lot you have been sitting on for eleven
years should be the best news you ever get, and it should be *rumoured* first:
a plan announced, an alignment argued over, a route that might move. Buying
ahead of an announcement is the oldest trade in the business and there is
currently no way to make it.

The demand model already propagates by distance (`engine/demand.ts`), so the
plumbing exists. What is missing is an event that moves the anchor.

---

## 4 · THE BLOCK YOU CAN SEE IS IN TROUBLE

Retail turnover is the most legible signal a real city gives you. Three shops
going dark on one street is visible from the pavement months before it shows up
in a vacancy statistic.

Make it visible on the map. Not a number — a *look*. Ground-floor vacancy per
block, rendered. A player should be able to fly over their own city and feel
which streets are going the wrong way without opening a panel.

---

## 5 · GROUND-FLOOR RETAIL IS A DIFFERENT BUSINESS

Retail at grade under an office tower is not "retail". It is a different
tenant, a different lease, a different rent per foot and a completely different
risk: it lives or dies on the footfall of the building above it and the street
outside it. A tower that empties takes its coffee shop with it.

Right now `MIXED_STACK` treats the shops as a percentage. They could be a
consequence: the retail leg's rent reads the office leg's occupancy and the
block's own footfall.

---

## 6 · THE BUILDING WITH A NAME

Every building is an address. A handful should be **places**: the one that was
the tallest in town for forty years, the one empty since the crash, the one
somebody's grandfather built. Purely cosmetic, nearly free, and it is the whole
difference between `1000440010` and somewhere you have been.

Cheap version: name any building that has ever been the largest of its class,
or that has been held by one owner for forty years, and let the name stick.

*Related to #33.*

---

## 7 · THE OPERATING PARTNER YOU DO NOT CONTROL

A JV has two sides (#31). The other side is a person with their own clock: a
fund at the end of its life must sell whether or not the market is good, and
that is the single most common reason a good building trades at a bad time.

Once #31 exists, the LP should be a character — patient or impatient, deep or
stretched, with a fund vintage that runs out. "My partner needs liquidity" is a
sentence that has moved more real estate than any spreadsheet.

---

## 8 · THE ASSESSOR IS WRONG AND YOU CAN SAY SO

Property tax steps up on reassessment and the owner simply pays it. In life,
appealing the assessment is a standing part of the job, it costs money and time,
it works maybe half the time, and after a market turns it is one of the largest
sources of value available to an operator — because the assessment has not
caught up with what the building is now worth.

*Folded into #34.*

---

## 9 · WHAT THE BUILDING IS WORTH TO SOMEBODY ELSE

Every exit in this game is a whole-asset sale. Real owners recapitalise, sell
half, contribute to a REIT for units, do a sale-leaseback, sell the land and
keep the building on a ground lease (the game already has ground leases — the
reverse trade is missing).

Each of these is a different answer to "I need money and I do not want to
sell", which is the most common position in the business.

*Folded into #34.*

---

## 10 · A CENSUS YOU CAN READ

The century runs produced genuinely good material — dynasties, cycle anatomy,
buildings with biographies. None of it is visible in the game. A player who has
run forty years should be able to open a page and read their own city's
history: the biggest deal of each decade, who rose and who failed, which
blocks changed character, what their own firm looked like at its peak.

The data is already in `comps`, `news` and the holdings history. It is a
reading problem, not a modelling one.

---

## 11 · THE TELL

From the bank-failure work (#29): a bank quoting above market for deposits is
not being generous, it is desperate for funding. That is a real pre-failure
signature and it is exactly the kind of thing this game should teach without
ever saying it out loud.

Generalise it. Every serious event in this simulation should have a *tell* —
something a careful player could have read a year early. Make a list of them,
check each one is actually visible somewhere, and make sure none of them is
only visible in the source code.
