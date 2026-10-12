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

## Second batch

**3 · The verb in reach, again.** Market led with an empty "Brokers on the
phone · 0", the buy-box form and the site list; the listings started a screen
and a half down. With no broker call live, the tape now comes first (calls,
which expire, still lead when there are any). The develop flow's Programme /
Design / Financing tabs are now a numbered stepper — ① ② ③, the current step
lit, the steps behind you ticked — instead of three buttons that looked like
every other button.

**6 · One fact, one row.** Contract and negotiation rows on the docket now
name the building ("390 E 16th St: under contract at $483K…" rather than
"Under contract at $483K…"), and the tape's line about the same contract
yields to it. The offer desk no longer prints occupancy twice (it does not
depend on price). The property page is titled with the building's address
instead of the word "Property", and the duplicate address below the tiles is
gone.

**7 · Depth by disclosure.** Leasing rows label their controls: an "Asking"
segmented control (Fill −8% · Market · Push +8% — the engine's own ±8%,
`value.ts`), then "Auto-answer", "I sign here", "Hire a broker". The Deals desk
with nothing live is one card that says how deals arrive, not three empty
headings. Long stat strips split into even rows instead of seven tiles and an
orphan.

**8 · Consistency.** Settings switches are switches (track, knob, state word),
not buttons reading "Off" — which could be the state or the action. Setup's
section rail is numbered 1–7 like the headings it points at (it read ★, 1–6).
Focus moves into each card as it takes the screen, so the keyboard is where
the eyes are.

**Bugs fixed along the way.** Selecting a second building opened its card at
the previous card's scroll offset (the card is now keyed per deed). The hidden
hover arrow on docket rows wrapped onto an invisible third line, making every
snoozable row a line taller than its words. The AT RISK banner, once raised
above the desks, covered their tables — it stays on the map now. Toasts keep
clear of the parcel card. Portfolio row actions sit in a 2×2 block instead of
a four-high column.

## Third batch — measured on an eight-year run

A scripted principal played eight years (two buildings, cards on, every card
answered "Not now") with every card and toast logged. 34 cards arrived — 29
of them tenant letters, about four a year — which is a fair cadence for a
business that runs on letters. The toast lane was the noisy channel:

- **Most month-close toasts said only the month** ("Feb 2000"). A quiet month
  now answers in the HUD — the date tile flashes as the month turns — and the
  toast is kept for months that carry news.
- **The same standing condition rode the toast every month** ("covenant
  breach — cash flow swept" three months running; one note sale four). The
  toast now names only what is new this month; the docket keeps the rest.

## Fourth batch — things that were never visible

- **Every "bad" value printed in ordinary ink.** `Row` marks a value bad
  (`v-bad`) in about 185 places — a bid 29% under the whisper, a negative
  yield, a short cheque — and `.app .grid .v` (specificity 0,3,0) outranked
  `.app .v-bad` (0,2,0) in every key/value grid. They are red again.
- **Entrance animations faded from opacity 0.** Under a slow compositor the
  card animation was measured sitting at t = 0 for 300ms+, leaving a decision
  card invisible behind its scrim (and the desks half-transparent). Cards and
  desks now arrive by motion only, from 85% opacity — never invisible.
- **A number means an answer is owed.** The City desk's rail badge counted
  this month's news and was lit on nearly every screen — the way a player
  learns that badges are wallpaper. News is unread, not waiting: City gets a
  dot, the count stays on the News tab inside, and numbered badges are left
  for things that want a decision.

## Fifth batch — the card the game shows most

- **The tenant letter leads with its decision.** It is 29 of every 34 cards
  in the measured run, and it printed nine rows of terms each time. Now: rent,
  net effective against the market, cash to sign, answer-by — then one folded
  line that still carries the gist ("TERMS 1.75%/yr bump · triple net · no TI ·
  3 mo free"). A gross lease, which puts every expense on you, never folds.
- **Tape rows on the docket dismiss instead of snoozing.** A news line leaves
  the docket next month on its own; "Later — back in three months" meant
  nothing on it. It has a ×.
- **The map card leads with the building, not a non-action.** Most standing
  buildings leave a quarter of their envelope unused, so "Underbuilt · a
  rebuild does not pencil" headed nearly every owned building's card. On the
  map card it now shows only when there is something to do — bare dirt, or a
  rebuild that pencils. The property file's Overview still carries the full
  read.
- **Notes leads with the paper for sale.** The badge on the Notes tab counts
  offers on the block, and the offer was the last thing on the page — under an
  empty "Private asks" section and the table of which banks are under
  pressure. Offers come first now; the pressure table follows them, and the
  private sleeve moves below when nobody is asking.
- **A lit badge explains itself where it leads.** Capital's red "!" means a
  maturity wall or a swept facility, and the Debt desk opened on six tiles and
  the stack with the reason four sections down. A one-line callout now leads
  the desk ("100% of what you owe matures inside three years") with a jump to
  the wall.
- **A decision is asked once.** Taking a bid from the bid-list card puts the
  building under contract — it closes itself in two months. The decision card
  then woke on that contract and asked "Offer in hand: Accept / Counter /
  Decline" about the sale accepted one click earlier. The card now skips a
  papered contract (the engine already files it as a soft docket row), and the
  toast says what happens next: "Under contract with … at $1.61M — it closes
  Sep 2008 on its own."
- **A long card keeps its verbs on screen.** Countering a letter opens five
  sliders and the card runs to ~970px; Send sat below the card's own fold.
  Every card's action band is now sticky at its foot, the counter's Send /
  Best & final / Back included (Esc = Back while countering), and tall cards
  start below the queue pill instead of under it.
- **Your building opening is never silent.** The delivery card is reserved for
  the five largest buildings on the map (a deliberate call), and a player's
  own smaller job fell through that gate with no toast at all — two years of
  building ended in a news line. It now toasts with the fact the card would
  have led with: "◆ Delivered — 268 W 13th St: worth $5.4M against $4.6M
  all-in."
- **You are the row you came for.** Clicking the top bar's Street readout
  opened the league table at the leaders; the player's own row was twenty-odd
  firms down, below the fold. The table now opens on your row, with the firms
  you are trying to pass directly above it.

## What belongs on the top bar

Asked plainly: what does a principal need without opening a desk?

| readout | verdict | why |
|---|---|---|
| Date · year of run | keep | the clock |
| Cash | keep, **absorbs Line** | "how much can I spend" was split across two tiles, and the line only showed once drawn. One tile now: cash, with "+$1.6M line" free or "line $829K drawn" (red past 60% of the limit) in its label; click opens the line |
| Line | **removed** | folded into Cash |
| Net worth · Δ | keep | the score |
| Street rank · Δ | keep | the race; the owner asked for it in sight |
| CF / yr · Δ | keep | the firm's burn or yield, after debt and overhead |
| **Next due** | **added** | the nearest hard date — fund a contract, answer a letter, an offer lapsing, a balloon inside a year, a lender's filing — read off the same state the engine acts on (`ui/nextDue.ts`), red inside a month, click opens it. A game of deadlines had no clock in its HUD |
| Occupancy | keep, **only once you operate a building**, shed early | it read "—" on every new player's first screen, and moves slowly |
| Market · rate · phase · Δbp | keep, shed first | the weather every price is read against; one click from Economy |
| Book | keep, only in trouble | an alarm, not a readout |

## Sixth batch

- **Nothing arrives invisible.** Every other entrance in the app (the ⌘K
  palette, the parcel card, the AT RISK banner, toasts, deal stages) still
  faded in from opacity 0; measured headless, the palette's backdrop showed
  and the palette did not. All entrances now arrive by motion from 85%.
- **⌘K opens on what is waiting.** Up to five items from the desk sit between
  the clock and the desks, every waiting item is searchable by name ("letter",
  "balloon", a tenant) and Enter opens it, and your buildings carry their debt
  on their row, so "debt" or "loan" finds them. It used to find the Debt desk
  and a lender.
- **The property file says each fact once.** Its Overview printed the
  appraisal, occupancy, NOI, gross area, FAR, demand and year built two or
  three times — in the tiles, the header grid, and again in the Overview grid
  under them — plus "Office · C-8 · OWNED" chips under a header that already
  said all three. Inside the file those rows and chips are dropped; the map
  card, which has no tiles, keeps them.
- **Operations names each setting.** Asking rent, Service and Capital plan
  were two stacked labels and three unlabeled rows of buttons. Each is now a
  line: its name, a segmented control, and what it reads as today
  ("tenants read it as 55 of 100", "condition 92 of 100").
- **The tape says a standing fact once.** Conditions that hold for months
  re-wrote themselves into the news every month ("2 parties are chasing the
  same 1.8k sf at 146 E 15th St"). The News desk keeps the newest copy and
  notes "also 6 earlier times"; on a measured save, 120 lines became 97.
- **Deals says what it holds.** The live tab read "Letters · 4" over four
  purchase negotiations, and under them the empty letters section said "No
  live negotiations" with a primary "Browse buildings" button. The tab is
  "Open deals", the empty section says no tenant has written, its button goes
  when anything is on the table, and the desk uses the full width.
- **Hovering your own building answers your question.** It showed "Owner:
  You" and the market rent; now it shows what the deed nets you a month and
  when its loan balloons (red inside a year). The cash-flow walk moved into
  `deedDebtService` (ui/deedMarks.ts), shared with the Portfolio row so the
  two cannot disagree. "+N more" on the docket expands the list.
