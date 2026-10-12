# What makes a game UI great — and what that means for Broadway & Wall

Written during the October 2026 UI pass (branch `claude/ui-overhaul`). The
question came first; every change in the pass answers to one of the rules
below. `UI_DECLUTTER.md` still holds — this builds on it.

## The question

Look at the games whose interfaces people praise — the management sims,
the 4X games, the city builders, the trading games — and the same handful of
things keep turning up. None of them is "fewer numbers". Broadway & Wall is a
deep game and should stay one. The great ones are deep **and** easy to read,
because they treat attention as the scarce resource, not screen space.

1. **The HUD answers "am I OK?" in one glance.** A handful of vitals, always in
   the same place, always on one line, each with a direction. Everything else is
   one click away. When the HUD wraps, jitters or truncates, the player stops
   trusting it.
2. **One interruption at a time.** A game may stop the clock — but a stack of
   cards is a wall, not a question. Interruptions queue, say how many are
   waiting, and each one can be put off with the same key.
3. **The verb is always in reach.** When you click a thing you can act on, the
   action is on screen without scrolling. Explanation can be long; the button
   must not be at the bottom of it.
4. **Every action answers.** A click that changes the world gets visible
   feedback where the player is looking. A result hidden behind a panel is the
   same as no result.
5. **Never offer what cannot be done.** A primary button the player cannot
   afford is a lie told loudly. Disable it and say why in its tooltip.
6. **One fact, one row.** If two surfaces say the same thing, one of them is
   noise — and two copies that disagree are worse.
7. **Depth by disclosure, not by density.** Lead with the decision, fold the
   method. A long room gets section chips; a long paragraph gets a fold; a
   wide table wraps its actions rather than scrolling sideways.
8. **Consistency is a feature.** The same key closes everything (Esc), the same
   colour means the same thing, every card arrives the same way. The player
   learns the grammar once.
9. **The interface must survive its own failures.** A fault in one view —
   the map renderer, say — must not take the rest of the game with it.
10. **Layers are a contract.** Write down what sits above what, once, so a new
    element cannot silently land underneath the page it belongs to.

## The layer contract

| layer | z-index |
|---|---|
| map chrome (docket, controls, HUD cards) | 20–30 |
| desk pages | 50 |
| status bar | 60 |
| toasts, milestone flash | 70 |
| moments (year, goal, exit, delivery) | 79 |
| engine cards (alert, default notice, decision, auction) | 80–83 |
| card queue pill | 95 |

All of it is settled last in `src/ui/hud.css`.

## What this pass changed, rule by rule

**1 · The HUD.** The status bar wrapped onto a second, ragged row at 1600px
(MARKET and BOOK under the date) and ran readouts under the Play button at
1440. Each readout's movement now sits in its own label row ("NET WORTH
−$100K"), the bar is a single 56px row at every width (it was 91px), and
readouts are shed by rank — measured each render, not guessed by media
query — Market first, then Line and Occupancy, then Street. Date, cash, net
worth and cash flow never go. Flat deltas are hidden. A few thousand drawn on
a seven-figure line no longer turns the readout red. "BOOK thin" reads
"thin cash". The labelled side rail collapses to icons below 1360px.

**2 · One card at a time.** The alert, default notice, decision and auction
cards rendered independently, so two or three could stack with their blur
compounding. Now only the first is drawn (alert → default notice → decision →
auction), the moments wait for any engine card, a pill at the top says
"2 more cards after this one", and **Esc presses the card's own "Not now" /
"Decide later"** (tagged `data-esc`) instead of refusing with a toast. A card
with no safe default shakes.

**3 · The verb in reach.** A for-sale building's card was 2,400px tall with
the Offer button about 1,100px down. A sticky footer now pins the ask, the
going-in yield and **Make an offer ↓**, and steps aside once the offer desk is
on screen.

**4 · Every action answers.** The toast lane sat at z 40 — *under* every desk
page (z 50). Measured with `elementFromPoint`: the Debt desk's header covered
the toast. Every result of an action taken on a desk was blurred behind it.
The year/goal/exit/delivery moments (z 35) had the same fault and could
pause Play while invisible. Both now sit above the pages. Toasts about the
same subject replace each other instead of stacking, and the lane is centred
on the open map rather than over the docket.

**5 · Never offer the impossible.** The default notice's primary button was
"Keep it current" even when the line under it said the coupon was not
fundable. It is now disabled with the shortfall in its tooltip.

**6 · One fact, one row.** The docket showed the engine's condition and the
tape's news of it as two rows ("222 E 10th St: covenant breach" under CAP and
"Covenant breach at 222 E 10th St" under CITY; "Motivated seller: 390 E 16th
St" and "Start here: 390 E 16th St"). Tape lines now yield to the standing
row about the same building — matched by address when the line carries no
parcel id — and news about your own building is tagged as an asset, not the
city. The redundant Open button on every row is gone: the sentence is the
link.

**7 · No sideways scroll.** Portfolio's holdings table pushed Refi / Pay off
off the page at 1280px. Row actions now wrap into a tidy block.

**9 · Survive failures.** `lotMassing` indexed `ring[4]` on any four-sided lot
whose long side was edge 1; the throw happened in the map's commit, and with
no error boundary React unmounted the entire app. The index is fixed, and the
map now sits in an error boundary that keeps every desk alive and offers to
draw the city again.
