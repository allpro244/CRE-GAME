# AI firms — plug an outside AI into the street

Any API can run a rival firm in Broadway & Wall. Each quarter the game sends the
firm's AI a JSON **brief** and the AI answers with `{reasoning, orders}`. The
orders go through exactly the machinery the scripted street uses — the same
lenders, closing costs, comps, taxes, zoning, construction hurdle and debt
service — so an AI firm can only win by making better decisions.

- Engine: `src/engine/aifirms.ts` (`aiBrief`, `applyAiOrders`, `createAiFirms`,
  `convertToAi`, `aiStandings`), order ledger `src/engine/aibooks.ts`.
- Controller (async, outside the engine): `src/ai/` — `protocol.ts` (prompt,
  reply parser), `providers.ts` (openai-compatible, anthropic, webhook, mock),
  `controller.ts` (`runAiTurn`), `mock.ts` (scripted stand-ins).
- Tools: `pnpm ai-match` (headless match), `pnpm ai-bridge` (local key proxy),
  `node tools/ai-webhook-example.mjs` (a 30-line webhook AI).
- Test: `test/ai-firms.mjs`, part of `pnpm check`.

## Three ways to plug in an API

| Your API speaks… | Provider | Endpoint |
|---|---|---|
| OpenAI's `/chat/completions` (OpenAI, OpenRouter, Together, Groq, Mistral, vLLM, Ollama, LM Studio, most "OpenAI-compatible" services) | `openai-compatible` | base URL incl. `/v1`, model name, key → `Authorization: Bearer` |
| Claude's Messages API | `anthropic` | `https://api.anthropic.com`, model `claude-sonnet-5` (or `claude-opus-5`, `claude-opus-5-5`, `claude-haiku-4-5`), key → `x-api-key` |
| Anything else — e.g. your own "JEV" service | `webhook` | a URL that takes the brief as the POST body and returns `{reasoning, orders}` |

If your JEV API is a chat-completion API with an OpenAI-shaped request, use
`openai-compatible` with its base URL. If it has its own shape, put a thin
webhook in front of it (the example below is the whole contract) — the webhook
receives the brief, calls JEV however JEV likes to be called, and returns the
orders.

### In the browser

**Settings → AI firms**: add a firm (name, provider, base URL / URL, model,
key), press **Test connection** (sends a real brief and shows the parsed reply
without executing anything), then either **Add to this run** or start a new
run with **Spectator** ticked on the start screen. A turn runs every quarter
before the month is advanced; Continuous Play waits for it.

Browsers usually cannot call AI APIs directly (CORS), and a key typed into a
page lives in that page. Two options:

1. **The bridge (recommended).** `OPENAI_API_KEY=… ANTHROPIC_API_KEY=… pnpm ai-bridge`
   runs a proxy on `127.0.0.1:8788` that adds the key from your environment.
   Base URLs: `http://127.0.0.1:8788/openai`, `http://127.0.0.1:8788/anthropic`,
   `http://127.0.0.1:8788/webhook` (forwards to `AI_WEBHOOK_URL`), or any API via
   `AI_BRIDGE_TARGETS='{"jev":{"url":"https://…/v1","keyEnv":"JEV_API_KEY"}}'`
   → `http://127.0.0.1:8788/t/jev`. Leave the key field in the game empty.
2. **Direct.** Anthropic allows browser calls when the request carries
   `anthropic-dangerous-direct-browser-access: true` — tick "Direct from the
   browser" on an `anthropic` firm. A webhook you run yourself can send CORS
   headers (the example does).

**Keys** are never written into a save, a match log, or the state. They are
held in memory for the session, and in `localStorage` only if you tick
"Remember on this device". They are sent only to the endpoint configured for
that firm.

### Headless

```sh
pnpm engine
pnpm ai-match                                  # four mock firms, 10 years
pnpm ai-match --config my-match.json --years 20 --out match.json
```

```json
{
  "seed": 12007, "years": 10, "cash": 25000000, "everyMonths": 3, "maxCalls": 2000,
  "firms": [
    { "name": "JEV Capital",  "provider": "webhook", "baseUrl": "http://127.0.0.1:8787/turn", "keyEnv": "JEV_API_KEY" },
    { "name": "GPT Partners", "provider": "openai-compatible", "model": "gpt-4o-mini", "keyEnv": "OPENAI_API_KEY" },
    { "name": "Claude & Co",  "provider": "anthropic", "model": "claude-sonnet-5", "keyEnv": "ANTHROPIC_API_KEY" },
    { "name": "Index Fund",   "provider": "mock", "mock": "hold" }
  ]
}
```

Keys come from the named environment variables. It prints a leaderboard each
year and a final report (equity, multiple, IRR, buildings, debt, deals, refused
orders, failed calls, biggest deals, latest reasoning) and writes every turn to
the JSON log. Mocks: `hold` (the control), `yield`, `contrarian`, `builder`.

## The protocol (`broadway-wall-ai/1`)

### Request

For `webhook`, the POST body **is** the brief. For chat providers, the brief is
the user message and a fixed system prompt (`AI_SYSTEM_PROMPT`) explains the
game. Abridged:

```json
{
  "protocol": "broadway-wall-ai/1",
  "date": "Apr 2003", "month": 39,
  "firm": { "id": "ai:jev-capital", "name": "JEV Capital", "equity": 27410000, "cash": 9120000,
            "debt": 14800000, "assets": 33090000, "ltvPct": 44.7, "noiYr": 2410000,
            "creditLineRoom": 3100000, "debtRatePct": 6.9, "inArrearsMonths": 0,
            "jobsUnderConstruction": 0, "buildings": 11 },
  "market": { "phase": "expansion", "policyRatePct": 5.0, "creditIndex": 1.04,
              "capRatePct": { "office": 7.1, "retail": 7.6, "multifamily": 6.2, "industrial": 7.4 },
              "vacancyPct": { "office": 11.2, "retail": 8.9, "multifamily": 5.1, "industrial": 6.0 },
              "rentIndex": { "office": 1.06 }, "costIndex": 1.08, "notes": "Closing costs 2%…" },
  "holdings": [ { "bbl": "1002140004", "address": "21 Quaker Ln", "class": "office", "sf": 14200,
                  "built": 1968, "grade": "standard", "occ": 88.1, "noi": 91000, "value": 1180000,
                  "loan": { "balance": 530000, "ratePct": 6.4, "maturity": "Jan 2009" } } ],
  "sites": [ { "bbl": "1003050001", "zone": "C6", "lotSf": 8000, "standingSf": 0,
               "options": [ { "use": "multifamily", "maxFloors": 12, "pencils": true, "yieldOnCost": 6.4,
                              "requiredYield": 6.2, "cost": 14100000, "demandWaiting": true } ] } ],
  "tape": [ { "bbl": "1002000003", "address": "1764 Old Trinity Pl", "class": "office", "sf": 12889,
              "built": 1976, "ask": 798000, "appraisal": 911544, "noi": 79318, "yieldPct": 9.9,
              "occ": 73.1, "rollDisclosed": true, "seller": "private owner",
              "listed": "Jan 2003", "expires": "Sep 2003" } ],
  "land": [ { "bbl": "…", "address": "…", "zone": "R6", "lotSf": 6000, "ask": 900000, "askPsf": 150,
              "builderResidualPsf": 171, "landPencils": true, "seller": "estate" } ],
  "landListed": 7,
  "street": [ { "rank": 1, "name": "Granite Mutual", "equity": 88100000, "buildings": 31 },
              { "rank": 6, "name": "JEV Capital", "equity": 27410000, "buildings": 11, "ai": true, "you": true } ],
  "news": [ "Fed raises the policy rate to 5.00%…" ],
  "lastTurn": { "m": 36, "results": [ { "order": { "action": "buy", "bbl": "…", "maxPrice": 900000 },
                                        "ok": false, "reason": "The ask is $950K, over your $900K limit." } ] },
  "actions": { "buy": { "description": "…", "schema": { … } }, "…": "…" },
  "reply": "Respond with ONLY a JSON object: {\"reasoning\": …, \"orders\": […]}…"
}
```

The tape is the top 25 buildings by going-in yield; `land` is every penciling
lot (top 15 by residual over ask). Typical size 5–16k characters (≈1.5–4k
tokens); the test holds it under 24k.

### Response

```json
{
  "reasoning": "Expansion, debt at 6.9%. 1764 Old Trinity yields 9.9% on a disclosed roll — buy at 55%. List the weakest office before the peak.",
  "orders": [
    { "action": "buy", "bbl": "1002000003", "maxPrice": 800000, "leverage": 0.55 },
    { "action": "sell", "bbl": "1002140004", "minPrice": 1250000 }
  ]
}
```

Fenced JSON or JSON inside prose is accepted; an empty `orders` list holds.

### Actions

| action | fields | what happens |
|---|---|---|
| `buy` | `bbl`, `maxPrice`, `leverage` 0–0.75 (default 0.6) | Closes at the ask through `rivalBuys` (the loan is sized by the town's desks on coverage/debt yield/advance rate, capped at your leverage; 2% closing; the credit line covers equity the account cannot). Refused if the ask > maxPrice or the close cannot be funded. |
| `sell` | `bbl`, `minPrice?` | Lists the building on the tape (default ask = appraisal, max 1.3× appraisal). It sells when a buyer takes it; 25% gains tax; the building's share of debt is retired. |
| `reprice` | `bbl`, `ask` | Changes the ask on your listing. |
| `withdraw` | `bbl` | Takes your listing down. |
| `refinance` | `bbl` | Cash-out against one income building: lenders' sizing less its share of your debt, capped by line room; 1% cost; ≥ $250k. |
| `paydown` | `amount` | Repays debt from cash. |
| `develop` | `bbl`, `use` (office/retail/multifamily/industrial/mixed), `floors` | Breaks ground on your lot through the scripted developers' `breakGround`: zoning (`zoneUseBar`), envelope and cornice, the pro forma's required yield with an open construction desk, waiting tenant demand, 40% of equity day one. Worn buildings can be redeveloped for ≥ 12% more floor area. |
| `hold` | — | Nothing. |

Every order returns `{ok, reason}`; refused orders cost nothing and the
reasons come back in the next brief's `lastTurn`. At most 12 orders per turn.

## Rules of the house

- **One economy.** AI firms are `Rival`s with `aiControlled` set, on the
  private-equity chassis (operating care, amortisation, 75% covenant). Rent,
  debt service (index + 1.9%), overhead, income tax, balloons, the revolver,
  arrears and wind-up all run on them as on any firm.
- **Their performance is their own.** With no fresh orders a firm **holds** —
  the scripted discretionary moves (buying off the tape, trimming, hold-clock
  exits, boom cash-outs, own-land starts, distributions, husk retirement) never
  run for it, and no scripted chooser (tape absorption, bids on your sales,
  city jobs, orphan rescues, portfolio and note buyers, private credit) picks
  it as a counterparty. Involuntary events still reach it: a firm in arrears
  sells to raise cash, hands back keys and can be wound up.
- **AI firms distribute nothing**, so their equity is their score; the match
  report's IRR is the compound growth of equity.
- **Determinism.** Nothing in the AI path draws on the RNG. Given the same
  replies a match is bit-identical (the test runs one twice). With no AI firm
  in the run, every AI entry point is a no-op and the state hashes identically
  to a plain run; `pnpm check` reports 0 of 39 baseline metrics moved.
- **Books.** Every AI-caused money movement is written to `s.aiBooks[firmId]`
  with its measured cash and debt deltas; the test holds each to its identity
  (buy: Δcash−Δdebt = −(price+closing); sale: = price−tax; refi: = −fee;
  paydown: 0; develop: = −equity) and holds each turn's entries to the firm's
  actual movement.
- **Robustness.** Timeouts (60s browser, 90s headless), one retry, JSON
  extraction from prose/fences, schema validation per order, a per-turn call
  cap and a per-run call budget. A failed call means the firm holds that
  quarter; the error is filed on the turn and shown on the Street table.

## A 30-line webhook AI

`tools/ai-webhook-example.mjs` — run it, then add a firm with provider
`webhook` and URL `http://127.0.0.1:8787/turn`. Replace `decide()` with a call
to your model.

```js
import http from "node:http";

function decide(brief) {
  const rate = brief.firm.debtRatePct, cash = brief.firm.cash;
  const buy = brief.tape.find((t) => t.yieldPct > rate + 1 && t.ask * 0.45 < cash * 0.5);
  const orders = buy ? [{ action: "buy", bbl: buy.bbl, maxPrice: buy.ask, leverage: 0.55 }] : [];
  const reasoning = buy
    ? `${buy.address} yields ${buy.yieldPct}% against ${rate}% debt; buying at 55% leverage.`
    : `Nothing on the tape clears ${rate + 1}%; holding ${Math.round(cash / 1e6)}M of cash.`;
  return { reasoning, orders };
}

http.createServer((req, res) => {
  res.setHeader("access-control-allow-origin", "*"); // lets the game call it straight from the browser
  res.setHeader("access-control-allow-headers", "content-type, authorization");
  if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }
  if (req.method !== "POST") { res.writeHead(405).end(); return; }
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    try {
      const reply = decide(JSON.parse(body));
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(reply));
    } catch (e) {
      res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: String(e) }));
    }
  });
}).listen(Number(process.env.PORT ?? 8787), "127.0.0.1", () => console.log("webhook AI on http://127.0.0.1:8787/turn"));
```

## Not modelled / known limits

- A street firm's debt is one balance; per-building loans in the brief are the
  public mortgage record's allocation (`s.cityLoans`), and `refinance` sizes
  new money against the building's share. There is no rate benefit to a
  refinance because all street debt prices at one spread.
- A buy closes at the ask; there is no negotiation below it for AI firms (the
  scripted street closes at the ask too).
- A player can still buy an AI firm's listed building, and an AI firm's
  distressed assets can reach the courthouse — both are real counterparties.
