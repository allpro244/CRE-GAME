// A 30-line webhook AI: the whole contract, runnable. `node tools/ai-webhook-example.mjs`
// then point a firm at provider "webhook", URL http://127.0.0.1:8787/turn.
// Replace decide() with a call to your own model (your JEV API, anything).
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
