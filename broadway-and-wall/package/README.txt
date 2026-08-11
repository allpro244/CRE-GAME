BROADWAY & WALL
A commercial real estate game. Every run starts on a generated harbour island —
a brand-new town cut from a seed every time you break ground — at whatever size
and whatever stage of its life you choose, with no end date. One principal, one
balance sheet, and as long as you last.


HOW TO PLAY
-----------
  macOS      Double-click  play.command
             (If macOS blocks it: right-click > Open > Open. Or in Terminal,
             cd into this folder and run:  python3 serve.py)

  Windows    Double-click  play.cmd

  Linux      ./play.sh      (or: python3 serve.py)

Your browser opens at http://localhost:8080 automatically. Requires Python 3,
which macOS and most Linux systems already have. Nothing is installed, nothing
is downloaded, no account or key is needed — the whole game is in this folder,
and it is about two megabytes.

Leave the little terminal window open while you play; closing it stops the
server. Press Ctrl+C there when you're done.

Note: you can't just double-click index.html. Browsers block local pages from
loading their own modules, so the game needs the small server to run.


THE ISLAND
----------
There is one kind of island and it is generated. The coast, the districts, the
parks and every street name come out of your seed when you press Break ground,
so each new campaign is a town no one has played before. Old hand-drawn maps
(New Alden, Kestrel Point) are gone.

A NEW TOWN EVERY TIME, AND YOU SAY WHAT KIND
-------------------------------------------
Every run asks three things before the ground is cut — how big, how built up,
and how much capital you start with. Then the whole place is built from
scratch: the block grid is re-cut, every block is subdivided into different
lots, so parcel sizes and shapes are new; what is already built and what is
left as vacant ground is new; heights, ages, uses and the mix inside each
building are new.

HOW BIG                     lots      the shape of the game
  Hamlet                    ~380      you can hold every corner in your head
  Town                      ~870      tight, and every mistake is visible
  City (standard)          ~1420      two miles end to end, four districts
  Metropolis               ~3000      submarkets you will never visit
  Great City               ~5800      a career is not long enough to learn it

A bigger island is MORE BLOCKS, not bigger blocks — the streets and the lots
stay the size streets and lots are. And it is a bigger economy with it: more
standing stock, and banks sized to lend against it, because a city four times
the size with the same five balance sheets behind it would simply be a city
where nothing can be financed.

HOW BUILT UP                vacant    tallest
  Frontier                    43%      9 floors    almost all of it is yours to build
  Young town (standard)       28%     14
  Provincial                  26%     32
  Established                 23%     40
  Boomtown                    28%     48    low fabric, dramatic towers
  Capital                     19%     58    you will redevelop more than you build
  Metropolis                  14%     60    a game about buying what exists

Both settle before the town is generated and both travel with your save,
because the same seed at Hamlet and at Great City are different places with
different deeds.

Same harbour, same parks, same street names — a completely different town on
top of them. The corner you learned last game belongs to somebody else now,
and the good ground is somewhere you have not looked yet.

It takes between a fifth of a second and a second and a half depending on the
size, and none of it is downloaded: the city is generated in your browser from
a single number. That number is written into
your save, so refreshing the page puts you back in YOUR town with your
campaign — only starting over rolls a new one.


THE OPENING
-----------
January 2000. You start with $1M, $2.5M or $5M — your choice on the opening
screen, and $2.5M unless you say otherwise. How much of the town is already
built is also your choice, across nine settings: a Landing has barely begun
and is about seventy per cent vacant ground with nothing above four floors,
the standard Young town is about forty per cent vacant, and a Metropolis is
down to fourteen per cent with towers past sixty floors.

That is your opening and it is also everyone else's: thirty-two rival firms
start alongside you, already owning buildings and holding working capital —
family money that will not sell at any price, core institutions, opportunistic
shops levered to eighty, and developers who will build whether you do or not.
They buy with their actual money, they can be inspected building by building,
and they can fail. When one does, the buildings go to its lenders and the
lenders take the loss — which is how a bank in this town ends up in trouble.

There is no tutorial and no beginner mode. There is a market, and you are in
it.


THE SCREENS
-----------
  Marketplace    What is for sale, on-market and off. Brokers only ring about
                 deals worth the phone call, and not at all in your first year.
  Deals          Your desk: live letters of intent, negotiations in progress,
                 offers in hand on things you have listed.
  Leasing        Every lease you own, when it expires, and the renewals in
                 front of you — the new $/sf set against what they pay now.
  Economy        The macro sim: employment, rates, construction costs, the
                 phase of the cycle, and the four-quadrant space market for
                 office, retail, multifamily and industrial — stock, occupancy,
                 absorption, the delivery pipeline, submarket by submarket.
  Research       The sectors, the trades, THE BANKS, land values over time, the
                 street's balance sheets, who owns what, and every comparable
                 sale in the city.
  Portfolio      What you own, what it earns, what it is worth, what you paid.
                 Refinance from the row. Bundle several and sell them at once.
  Books          Your income statement, the ledger year by year, the tape, and
                 what you have actually realised.

  Advance >      One month.
  Yr >>          A year, stopping early if something needs you.
  >>|            Skip to the next real decision, up to three years.

  Land lens      Shade every lot by current land $/sf.
  Demand lens    Transit and employment gravity — the why behind the rents.
  Owners lens    One colour per firm. Yours stay gold.

The run ends when the creditors take everything, and not otherwise. The
century is a marker you pass.


HOW IT ACTUALLY WORKS
---------------------
VALUE is traceable: NOI after real estate taxes over a cap rate that moves
with the cycle, the asset class and the condition of the building. Rents scale
with the parcel's demand. Vacant land bleeds carrying costs while you hold it.

DEBT is real debt. Five named lenders, each with LTV, debt-yield and DSCR
constraints, amortisation you choose, interest reserves, construction draws on
an S-curve, mini-perm takeouts, cash sweeps, rate caps, prepayment penalties
and participating paper. A loan struck at 5% is a problem when the index walks
to 9%.

THE BANKS THEMSELVES have books you can open on Research: capital, loans
outstanding, delinquency, charge-offs, and a capital ratio that decides whether
they are lending this quarter. When the cycle turns their bad debts eat their
capital, their appetite goes with it, and the desk that quoted 75% last year
stops answering the phone — not because a hidden index moved, but because THAT
BANK is in trouble and you could have read it a quarter early. They can fail. A
receiver then sells the franchise and somebody reopens it, smaller and more
careful, a year or two later.

BEING IN TROUBLE is a process, not an event. Miss a balloon and a file opens:
you have months to cure it, ask them to extend (at their price, and only if
their own balance sheet can carry a non-performing loan), or hand back the deed
— which settles the debt in full with no deficiency even on recourse paper, and
is nearly always better than letting it go to auction.

DEVELOPMENT is real development: a buildable envelope from the zoning, a GMP or
cost-plus contract, a use mix and a unit count you choose, months of
construction, and a yield on cost you have to beat the exit cap with. Retail is
two storeys. You cannot put two hundred floors on a four-hundred-foot lot.

LEASING is a negotiation. Tenants have credit, a trade, a lease structure and a
security deposit; you counter on rent and fit-out and they answer once, and
that one is final. You can freeze leasing on a building you intend to empty, or
buy every tenant out at a premium.

SPACE MARKETS clear on supply and demand. Build into a glut and you sit empty;
build into a shortage and the rents run — which is exactly when the next glut
gets started.

SELLING is a process too. List quietly, or run a marketed campaign with a call
for offers on a date everybody knows. Counter the bids. Buyers retrade you. Or
bundle several buildings and sell them as one trade, at a blend priced off the
weakest building in it — which is exactly why anybody bundles, because it is
the only way the half-empty one ever trades at all.

THE CYCLE runs recovery -> expansion -> peak -> recession. The news tape rumours
a turn a quarter or two before it lands. Rumours are real information. They are
not promises.

Your game autosaves to the browser every month, per browser and per city.
Each new playable zip clears those saves the first time you open it, so a
campaign from the previous build is never Continued under new rules.


SOURCE
------
github.com/allpro244/CRE-GAME - branch claude/phase-1-implementation-v4c2az

MapLibre GL, Three.js, React and TypeScript. The simulation is a pure
function - advanceQuarter(state, parcels) -> state - with a seeded RNG, kept
completely separate from the rendering, which is why the same seed always
gives the same city and the same campaign.
