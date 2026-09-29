// THE LOCAL JEV BRIDGE — the key stays in your shell, not in the browser.
//
//   TYPESAFE_API_KEY=… pnpm ai-bridge            (http://127.0.0.1:8788/jev)
//   AI_BRIDGE_PORT=9000 pnpm ai-bridge
//
// api.typesafe.ai refuses CORS preflights from localhost origins ("Disallowed
// CORS origin", checked 2026-09-29), so a browser tab cannot call Jev
// directly. This proxy listens on 127.0.0.1 only, adds the key from
// TYPESAFE_API_KEY, and forwards to TypeSafe's System One endpoint — and to
// nothing else. In the game: Settings → Jev → "through the local bridge".
//
// Safety: binds 127.0.0.1; refuses requests whose Host is not localhost (a
// DNS-rebinding guard); answers CORS only for localhost origins; forwards only
// POST /jev to the one upstream; never logs a key or a body.
//
// TYPESAFE_URL overrides the upstream (for testing against a local mock only).
import http from "node:http";

const PORT = Number(process.env.AI_BRIDGE_PORT ?? 8788);
const UPSTREAM = process.env.TYPESAFE_URL ?? "https://api.typesafe.ai/v1/systemone";
const KEY = process.env.TYPESAFE_API_KEY;
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const MAX_BODY = 2 * 1024 * 1024;

const server = http.createServer(async (req, res) => {
  if (!LOCAL.test(req.headers.host ?? "")) { res.writeHead(403).end("localhost only"); return; }
  const o = req.headers.origin;
  if (o && LOCAL_ORIGIN.test(o)) {
    res.setHeader("access-control-allow-origin", o);
    res.setHeader("vary", "origin");
    res.setHeader("access-control-allow-headers", "content-type, authorization");
    res.setHeader("access-control-allow-methods", "POST, GET, OPTIONS");
  }
  if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (req.method === "GET" && path === "/health") {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, upstream: UPSTREAM, key: !!KEY }));
    return;
  }
  if (req.method !== "POST" || path !== "/jev") { res.writeHead(404).end("POST /jev only"); return; }
  let size = 0;
  const chunks = [];
  for await (const c of req) { size += c.length; if (size > MAX_BODY) { res.writeHead(413).end(); return; } chunks.push(c); }
  const headers = { "content-type": "application/json" };
  // The environment's key wins; a key typed into the page is passed through
  // only when the bridge has none.
  if (KEY) headers.authorization = `Bearer ${KEY}`;
  else if (req.headers.authorization) headers.authorization = req.headers.authorization;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 30_000);
  const t0 = Date.now();
  try {
    const r = await fetch(UPSTREAM, { method: "POST", headers, body: Buffer.concat(chunks), signal: ctl.signal });
    const body = Buffer.from(await r.arrayBuffer());
    const pass = { "content-type": r.headers.get("content-type") ?? "application/json" };
    for (const h of ["retry-after", "retry-after-ms"]) { const v = r.headers.get(h); if (v) pass[h] = v; }
    if (o && LOCAL_ORIGIN.test(o)) res.setHeader("access-control-expose-headers", "retry-after, retry-after-ms");
    res.writeHead(r.status, pass).end(body);
    console.log(`${new Date().toISOString()}  jev ${r.status}  ${Date.now() - t0}ms  ${size}b in / ${body.length}b out`);
  } catch (e) {
    res.writeHead(502, { "content-type": "application/json" }).end(JSON.stringify({ error: `bridge: ${e.name === "AbortError" ? "upstream timed out" : e.message}` }));
    console.log(`${new Date().toISOString()}  jev 502  ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Jev bridge on http://127.0.0.1:${PORT}/jev → ${UPSTREAM} ${KEY ? "(key from TYPESAFE_API_KEY)" : "(no TYPESAFE_API_KEY set — the page's key is passed through)"}`);
});
