# Jev in Broadway & Wall

TypeSafe's **Jev** (`jev-latest`, currently `jev-1.13.0`) informs the judgement
of rival firms on the street. It is the only model the game can be plugged into.

Jev is a "System One" model: fast (70–500 ms; measured here 200–300 ms a call),
cheap ($0.042 per million input tokens, output free), and it writes no text. It
answers typed questions — **Noul** (yes/no → a probability), **Choice** (pick one
option → probabilities + confidence), **Score** (a level on a rubric → value,
probabilities, confidence) — about a structured `state`. So Jev does **not** write
orders. The engine keeps control:

1. The engine computes every number and every constraint — what the firm can
   afford, what each listing yields against its cost of debt, what a cash-out does
   to coverage, which schemes pass zoning and the lender's hurdle — and pre-filters
   the candidates so every option is one the firm could actually take.
2. `src/ai/buckets.ts` turns the numbers into phrases that carry the verdict *and*
   the numbers ("well above the firm's cost of debt (8.1% vs 6.9%)"), because Jev
   is not a calculator (TypeSafe's jev-1.13 jaggedness notes).
3. One request per firm per decision period (default: a quarter) carries all of
   the firm's questions (speculative fan-out); firms are called in parallel.
4. The answers are filed on the game state; the tick reads them synchronously at
   the firm's own decision points in `engine/rivals.ts`. Code acts only when Jev is
   confident (per-decision thresholds). Otherwise the firm's **scripted rule
   decides, unchanged** — and the log says which path each decision took.

A Jev-run firm *is* the scripted firm with Jev at its decision points: same style,
same chassis (rent, debt service, overhead, tax, balloons, arrears, mandated
hold-clock exits), same counterparties. Without a key, or with no firm selected,
the game is exactly the scripted game (bit-identical; see Tests).

## Plugging in a key

**Browser.** `api.typesafe.ai` refuses CORS preflights from localhost origins
("Disallowed CORS origin", checked 2026-09-29), so a tab cannot call it directly.
Run the local bridge, which holds the key:

```sh
TYPESAFE_API_KEY=… pnpm ai-bridge     # http://127.0.0.1:8788/jev → api.typesafe.ai/v1/systemone
```

Then Settings → **Jev**: route "Through the local bridge", leave the key empty,
press **Test connection** (one tiny Noul; shows model, latency, tokens), and pick
the firms (or on the start screen: "Jev runs N rival firms", optional charter,
"Spectator: no player — watch the firms compete"). You can also type the key into
the page; it is held in memory, written to localStorage only if you tick
"Remember on this device", never written into a save, and sent only to the bridge
(which forwards it to api.typesafe.ai) — the bridge's own env key wins if set.

**Headless.** `TYPESAFE_API_KEY=… pnpm ai-match` / `pnpm jev-lab --live` read the
key from the environment and call api.typesafe.ai directly.

## Decision points, questions, and what code does with the answers

All wording lives in `src/ai/jevQuestions.ts` (version `2026-09-29.2`); the
mapping functions are in the same file so a reader sees question and action
together. `state` is only `firm_mandate` (the firm's charter in plain words),
`firm` (book, leverage, cash, construction, payment status) and `market` (cycle,
credit, debt cost, vacancy and cap rates by use). Each candidate travels inside
its own question's structured `instructions` and is referred to in backticks.

| Point | Asked when | Question (id · primitive) | Code does |
|---|---|---|---|
| **Buy** | the firm is current on its debt; candidates = open listings inside the style's box that the firm can fund today (`rivalCanClose`), land only if it pencils; top 10 by yield spread | `buy_pick` · Choice over the candidates + `none`: "Which one of these listed buildings should the firm buy this quarter, given `firm_mandate`, `firm` and `market`? … Choose `none` if no listing is a good purchase…" | confidence < 0.45 → scripted. `none` → the firm sits out the tape for the period. Otherwise composite = charter-weighted mean of the five scores below (each normalised 0–1, each needing confidence ≥ 0.35 or scripted). Composite ≥ 0.60 → buy at the ask through `rivalBuys` (the loan sized by the town's desks, 2% closing, line draw); < 0.60 → sit out. Never pays more than the ask Jev saw. |
| | per candidate | `buy_value_<bbl>` · Score 0–4: "How attractive is the price of `candidate`, judged by `candidate.price` and `candidate.going_in_yield`?" | weight by charter |
| | per candidate | `buy_location_<bbl>` · Score: "How strong is the location of `candidate` for a building of its use…?" | weight by charter |
| | per candidate | `buy_income_<bbl>` · Score: "How secure is the rental income of `candidate` over the next three years…?" | weight by charter |
| | per candidate | `buy_fit_<bbl>` · Score: "How well does buying `candidate` fit `firm_mandate` and the firm's current book in `firm`?" | weight by charter |
| | once | `buy_timing` · Score: "Is `market` a buyer's market or a seller's market for income property right now, judged by `market.cycle` and `market.credit`?" (0 strong seller's … 4 strong buyer's) | weight by charter |
| **Sell** | holdings held ≥ 12 months, not listed / building / in a package; the 10 weakest by yield on value | `sell_<bbl>` · Noul: "Should the firm put `holding` up for sale now, given `firm_mandate` and `market`?" | the highest p ≥ 0.80 → list it at 1.14× conveyed value falling to 1.00× as p → 1 (the scripted voluntary seller's own range); every p ≤ 0.20 → no discretionary sale this period; otherwise the scripted trim. Mandated exits (fund hold clock, merchant delivery) stay scripted. |
| **Refinance** | the scripted cash-out preconditions hold (style takes cash out, credit open, leverage room) and the room is > $1M | `refi` · Noul: "Should the firm take the loan described in `refinance` now…?" (`refinance` = new money, leverage now/after, interest coverage after vs the regional desk's 1.25x, rate) | p ≥ 0.75 → take exactly the room the scripted rule would; p ≤ 0.25 → don't; otherwise the scripted roll |
| **Build** | the style builds, below its live-job cap; sites = owned vacant lots and worn stock ≥ 35 years; options = every legal use at the envelope/cornice height that clears `underwriteDevelopment`, has tenant demand waiting and whose day-one equity the firm can fund | `build_pick` · Choice over `<bbl>:<use>` schemes + `hold`: "Which one of these development schemes … should it start now…? Choose `hold` to start nothing this quarter." | confidence ≥ 0.65 → break ground on that scheme through the scripted developers' own `breakGround` (re-underwritten at the tick); `hold` → no own-land start this period; else the scripted site search |
| **City work** | the style builds | `claim_jobs` · Noul: "Should the firm take on new construction projects this quarter…?" | p ≤ 0.25 → the firm is not a runner for city-conceived jobs this period; otherwise the scripted appetite |
| **Distress** | the firm is behind on payments; ≥ 2 holdings whose forced sale nets cash | `distress_pick` · Choice over those holdings: "The firm has missed a debt payment and must sell one building to cover `shortfall`. Which building should it sell…?" | confidence ≥ 0.50 → that building goes on the tape at the scripted duress price; else the scripted pick |

Thresholds are on the state (`s.jev.thresholds`, editable in Settings → Jev, so a
save reproduces). Charters (`CHARTERS`): Family office, Core fund, Value-add fund,
Opportunistic fund, Merchant builder — each a plain-language mandate and a set of
buy weights (value / location / income / fit / timing). A firm defaults to the
charter of its style; the player can rename Jev firms and pick charters.

Every verdict is logged once per period (`s.jev.log`: point, path, why, answer
detail, what code did). The Street table marks Jev firms **JEV** and opens a card
per firm with each question, Jev's answer (probabilities, confidence) and the
decision path; the **Jev match** page shows the Jev firms' equity over time, what
code did, and their deals.

## Robustness

Requests are validated against the API's rules before they leave (Choice 2–255
options, Score 2–10 levels, 32k/64k token budgets); answers are checked against
the questions (type, option membership, ranges). Timeout per call (15 s in the
browser, 8 s headless), one retry with backoff on 429/5xx honouring Retry-After,
a circuit breaker (3 consecutive failures → no calls for 4 periods, "Jev
offline" in the UI). A failed call is filed for that firm and every one of its
decisions falls back that period. In the browser the next period's questions are
sent as soon as the previous month closes; Play waits only if the answers are
still out. The key is never in the state, a save, a log or a match file.

## Cost

About 4–20k input tokens a call (holdings and candidates dominate), one call per
Jev firm per period. Measured: 6 firms × 10 years quarterly = 240 calls, 2.5–5M
tokens, **$0.10–0.21 per 10-year match**; 200–300 ms a call. Settings → Jev shows
the running meter and a per-game-year estimate.

## Measuring it

**`pnpm ai-match`** — the same seeds twice: every firm scripted, then the chosen
firms with Jev. Reports value created (equity + distributions), IRR, drawdown,
failures, deeds, act/pass/fallback rates, confidence and cost, plus each firm
against the median scripted firm *in its own world* — because one firm's
different decisions change the tape, and the tape feeds the cycle, so a Jev run
and its twin do not live through the same macro path (seed 73303 with one Jev
firm hit a recession at month 42 where its twin was still at the peak).

Live result (jev-latest, 3 seeds × 10 years × 6 firms, questions v2026-09-29.2):
Jev ahead of its scripted twin on value in 8 of 18 firm-runs, behind in 9; median
IRR 11.8% scripted vs 11.2% Jev; median max drawdown 18% scripted vs 35% Jev; failures 2 scripted vs 1 Jev;
58–64% of decisions fell back to the scripted rule. **Jev is not yet better than
the scripted street at running these firms.** That is a measurement, not a
verdict on Jev: the thresholds and wordings are untuned.

**`pnpm jev-lab`** — ground truth from the simulator. At checkpoints, each
decision a firm would be asked is forked (buy each shortlisted listing and Jev's
own pick, or none; sell each of three holdings or keep all; refinance or not),
each fork is rolled 24 months, and the firm is scored against the median scripted
firm in the same fork. Then the exact production request is sent to Jev
(`--live`) or the mock (dry run, which also prints the request it would send).
Wording variants for A/B are in `WORDING_VARIANTS` (`--variant v1-timing`,
`--variant sell-no-mandate`).

Live lab (2 seeds × 3 checkpoints × 3 firms, 18 calls, $0.014):
- Buy: Jev's raw pick was the best of the forked actions 3/17 (chance ≈ 0.22);
  its picks earned 1.245 against 1.160 for the average forked option; the gated
  decision earned 1.166 vs the scripted rule's 1.106 (best available 1.433).
- Sell: 54 calls, p(yes) mostly 0.5–0.8 and **not calibrated** (p 0.6–0.8: selling
  actually won 41% of the time; p ≥ 0.8: 33%). This is why the sell threshold is
  0.80 and most sells fall back.
- The first timing wording came back with confidence 0.0–0.3 on most calls; the
  literal buyer's/seller's-market wording answers at ~0.9.

Samples this small are noisy and fork outcomes carry the same cycle-divergence
as the match. The lab exists so the owner can tune wordings and thresholds with
a key and see whether it helps.

## Tests (`test/jev.mjs`, in `pnpm check`)

Mock Jev and fixtures, no key: buckets say what they should; with no Jev firm
every entry point leaves the run hash-identical, and building a request never
moves the world; every request across every firm and four years validates, every
builder in the library is a valid API question, the validator refuses 256
options and a one-level score; a confident pick buys through `rivalBuys` and is
booked; a low composite passes; `none` keeps the firm off the tape; a sure sale
lists at the mapped ask; all-no holds; refinance yes takes the scripted room;
a build pick breaks ground; a distress pick sells that building; **six firms whose
every answer is below threshold play out bit-identically to their scripted
selves**; every Jev-firm ledger entry satisfies its identity; two runs with the
same answers are identical; the client retries a 429, sends the key only as a
Bearer header, refuses incomplete answers; the breaker opens and recovers; a
failed call is filed per firm and falls back.

## Files

`src/ai/jevQuestions.ts` (library, mapping, validation) · `src/ai/buckets.ts` ·
`src/ai/jevRequest.ts` (request builder) · `src/ai/jevClient.ts` (HTTP client,
breaker) · `src/ai/jevMock.ts` · `src/ai/jevController.ts` · `src/engine/jev.ts`
(answers on the state, verdicts, log) · `src/engine/jevmatch.ts` (which firms,
standings) · `src/engine/aibooks.ts` (Jev firms' deal ledger) · hooks in
`src/engine/rivals.ts` · `src/state/jevStore.ts` · `src/ui/panels/JevPanel.tsx` ·
`tools/ai-bridge.mjs` · `tools/ai-match.mjs` · `tools/jev-lab.mjs`.

TypeSafe publishes a JS SDK (`@typesafe-ai/sdk`); it is not installable in this
offline tree and the game must also run in a tab, so `jevClient.ts` is a small
typed client for the documented HTTP API with the SDK's retry behaviour.
