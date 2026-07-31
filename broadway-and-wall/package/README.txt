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
The whole island of Manhattan — about 49,000 individual tax lots, each one
selectable, each with its own record: lot area, building area, floors, year
built, zoning district, FAR built vs. allowed, assessed values, and a demand
score computed from subway proximity and workplace employment.

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


ABOUT THE DATA
--------------
The top bar says SYNTHETIC DEV DATA. The build machine had no network access
to NYC Open Data, so this dataset is procedurally generated: the coastline,
the 29°-rotated street grid north of Houston, Central Park and a dozen other
parks, the subway stations, and the height cores at FiDi and Midtown are all
real-ish, but the individual lots are invented — plausible, not factual.

The pipeline for real data is built and ready. From the source repo:

    node pipeline/fetch.mjs --district MN   # real MapPLUTO, all of Manhattan
    node pipeline/process.mjs
    node pipeline/tiles.mjs

That pulls genuine tax lots, building footprints and roof heights, MTA
stations, and Census employment. The badge disappears on its own when the
data is real.


SOURCE
------
github.com/allpro244/CRE-GAME — branch claude/phase-1-implementation-v4c2az

Built with MapLibre GL, PMTiles, React, and TypeScript. The simulation is a
pure function — advanceQuarter(state) → state — with a seeded RNG, kept
completely separate from the rendering.
