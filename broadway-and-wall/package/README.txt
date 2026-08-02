BROADWAY & WALL
A commercial real estate tycoon game. Six harbor cities, one hundred years,
one principal — you.


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
Six of them, picked from the dropdown beside the title. Each is a complete,
deterministic city of roughly 1,300-1,650 lots, and each keeps its own
campaign and its own autosave — switch away and switch back and you resume
where you left off.

  New Alden       The original. A colonial landing, a numbered grid, and a
                  Broadway cutting across both.
  Kestrel Point   A narrow peninsula. Frontage is scarce and the only cheap
                  land is out at the tip.
  Marrow Bay      A crescent around a deep bay; three grids that refuse to
                  agree with each other.
  Thorne Island   An island. No hinterland, no cheap edge — build up or buy
                  somebody out.
  Calder Falls    A mill town. Value runs uphill, away from the working river.
  Sable Harbor    A hooked harbor — more waterfront than land behind it.

Every lot is selectable and carries a real record: lot area, building area,
floors, year built, zoning, FAR built against FAR allowed, assessed value,
and a demand score computed from transit proximity and workplace employment.

Drag to pan, right-drag to rotate, scroll to zoom, click any building.


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
