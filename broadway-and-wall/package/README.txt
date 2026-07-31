BROADWAY & WALL
A commercial real estate tycoon game on a 3D map of Manhattan.


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


WHAT YOU'RE LOOKING AT
----------------------
Ashport — a fictional harbor city of about 1,800 lots, every one selectable
with its own record: lot area, building area, floors, year built, zoning,
FAR built vs. allowed, assessed values, and a demand score computed from
transit proximity and workplace employment.

The districts: Old Harbor (the crooked colonial core), the Exchange (the
office grid), Northside (brownstones), Millside (aging industrial — cheap
land, big lots), and the Point (waterfront tower pads). The city is young:
plenty of it is vacant or waiting to be torn down and built better. That's
your opening.

Click any building. Drag to pan, right-drag to rotate, scroll to zoom.


THE GAME
--------
You start in 2026 Q1 with $6,000,000.

  Market tab      The tape. Roughly 44 properties are for sale at any time,
                  rotating every few quarters. Also the loan index, cap rates
                  by asset class, rent indices, and the news feed.

  Parcel tab      Click any lot. If it's for sale you can buy it all-cash or
                  financed at 65% LTV (30-year amortizing, priced off the live
                  index). If you own it, you can renovate or sell.

  Portfolio tab   What you own, what it's worth, what it earns.

  Advance ▸       Move forward one quarter. Rents, cap rates, and the loan
                  index all move; you collect NOI and pay debt service.

  ◧ Land          The land-value lens — shades every lot in the city by its
                  current land value per square foot. Reading where values are
                  heading is the core skill.

Valuation is honest and traceable: value = NOI ÷ cap rate. Rents scale with
the parcel's real demand score, occupancy breathes with the market cycle, and
vacant land bleeds carrying costs while you hold it. Leverage cuts both ways —
a loan taken at 5% is a problem when the index walks to 9%.

The market runs a boom/bust cycle (recovery → expansion → peak → recession).
The news tape rumors a turn a quarter or two before it lands. Rumors are real
information, but they are not promises.

If your cash stays negative for four straight quarters, the run ends.

Your game autosaves to the browser every quarter — just reopen to continue.
It saves per-browser, so play in the same one.


ABOUT THE CITY
--------------
Ashport is fictional and deterministic — same seed, same city, no downloads,
no accounts. (The source repo also ships a full pipeline for playing on real
NYC data — genuine tax lots, footprints, subway ridership — if you ever want
the big-league version back.)


SOURCE
------
github.com/allpro244/CRE-GAME — branch claude/phase-1-implementation-v4c2az

Built with MapLibre GL, PMTiles, React, and TypeScript. The simulation is a
pure function — advanceQuarter(state) → state — with a seeded RNG, kept
completely separate from the rendering.
