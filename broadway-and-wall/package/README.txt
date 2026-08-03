BROADWAY & WALL
A commercial real estate tycoon game. Two harbor cities, a new town on each
one every time you start over, one hundred years, one principal — you.


HOW TO PLAY
-----------
  macOS      Double-click  play.command
             (If macOS blocks it: right-click > Open > Open. Or in Terminal,
             cd into this folder and run:  python3 serve.py)

  Windows    Double-click  play.cmd

  Linux      ./play.sh      (or: python3 serve.py)

Your browser opens at http://localhost:8080 automatically. Requires Python 3,
which macOS and most Linux systems already have. Nothing is installed, nothing
is downloaded, no account or key is needed — the whole game is in this folder.

Leave the little terminal window open while you play; closing it stops the
server. Press Ctrl+C there when you're done.

Note: you can't just double-click index.html. Browsers block local pages from
loading their own data files, so the game needs the small server to run.


THE CITIES
----------
Two islands, picked from the dropdown beside the title.

  New Alden       The original. A colonial landing, a numbered grid, and a
                  Broadway cutting across both.
  Kestrel Point   A narrow peninsula. Frontage is scarce and the only cheap
                  land is out at the tip.

They play differently on purpose: New Alden has a hinterland behind its
harbour, so there is always somewhere cheaper to go. Kestrel Point does not —
the whole town is within four blocks of water, and the only way to get more
building is to buy somebody out or go up.

Each island keeps its own campaign and its own autosave, so switching away and
back resumes where you left off.


A NEW TOWN EVERY TIME
---------------------
The island is fixed. The town on it is not.

Every time you press "New city", the whole place is rebuilt from scratch: the
block grid is re-cut, every block is subdivided into different lots, so parcel
sizes and shapes are new; what is already built and what is left as vacant
ground is new; heights, ages, uses and the mix inside each building are new. A
reroll of New Alden might go from 1,697 lots on 170 blocks to 1,631 on 156.

Same harbour, same parks, same street names — a completely different town on
top of them. The corner you learned last game belongs to somebody else now,
and the good ground is somewhere you have not looked yet.

It takes about a third of a second, and none of it is downloaded: the city is
generated in your browser from a single number, which is why this whole game
is a two-megabyte folder. That number is written into your save, so refreshing
the page puts you back in YOUR town with your campaign — only starting over
rolls a new one.


THE GAME
--------
You start in January 2000 with $6,000,000 and 1,200 months ahead of you.
About half of every city is still vacant lots. That is your opening — and
the competition's, because six rival firms start alongside you with $5-15M
of equity each — family money, core institutions, opportunistic shops and a
developer — and they will build whether you do or not.

  Marketplace    What's for sale, on-market and off. Brokers only bring you
                 deals worth the phone call.
  Deals          The desk: your live LOIs, negotiations, and diligence. Offer
                 60-day due diligence or take it as-is; counter anything on a
                 slider.
  Leasing        Every lease you own, its expiry, and the renewals in front
                 of you — with the new $/sf set against what they pay now.
  Economy        The macro sim: employment, rates, construction costs, the
                 phase of the cycle, and the four-quadrant space market for
                 office, retail, multifamily and industrial — stock,
                 occupancy, vacancy, absorption, the delivery pipeline, and
                 submarket-by-submarket detail, all in graphs.
  Portfolio      What you own, what it earns, what it's worth. Top earners
                 ranked; list or delist without opening the record.
  Books          Your ledger: cash flow, debt schedule, equity, and taxes.

  Advance >      One month.
  Yr >>          A year, stopping early if something needs you.
  >>|            Skip to the next real decision, up to three years.

  Land lens      Shade every lot by current land $/sf.
  Demand lens    Transit and employment gravity — the why behind the rents.

The run ends if the creditors take everything, or when the century closes.


HOW IT ACTUALLY WORKS
---------------------
Valuation is honest and traceable: NOI after real estate taxes, divided by a
cap rate that moves with the cycle and the asset class. Rents scale with the
parcel's demand score. Occupancy breathes. Vacant land bleeds carrying costs
while you hold it.

Debt is real debt — LTV and debt-yield and DSCR constraints, amortization
you choose, interest reserves, construction draws on an S-curve, mini-perm
takeouts, cash sweeps, prepayment penalties, and lenders who remember how
you treated them last time. A loan struck at 5% is a problem when the index
walks to 9%.

Development is real development: a buildable envelope from the zoning, a GMP
or cost-plus contract, months of construction, and a yield-on-cost you have
to beat the exit cap with. You can lever a development. You cannot put 216
stories on a 414 square foot lot.

Space markets clear on supply and demand. Build into a glut and you will sit
empty; build into a shortage and the rents run — which is exactly when the
next glut gets started.

The cycle runs recovery -> expansion -> peak -> recession. The news tape
rumors a turn a quarter or two before it lands. Rumors are real information.
They are not promises.

Your game autosaves to the browser every month. It saves per-browser and
per-city, so play in the same one.


ABOUT THE CITIES
----------------
All six are fictional and deterministic — same seed, same city, every time.
No downloads, no accounts. (The source repo also ships a full pipeline for
playing on real NYC data — genuine tax lots, footprints, subway ridership —
if you ever want that version.)


SOURCE
------
github.com/allpro244/CRE-GAME — branch claude/phase-1-implementation-v4c2az

Built with MapLibre GL, PMTiles, Three.js, React and TypeScript. The
simulation is a pure function — advanceQuarter(state) -> state — with a
seeded RNG, kept completely separate from the rendering.
