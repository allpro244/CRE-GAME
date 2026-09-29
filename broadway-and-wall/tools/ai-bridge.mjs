// THE LOCAL AI BRIDGE — keys stay in your shell, not in the browser.
//
//   OPENAI_API_KEY=… ANTHROPIC_API_KEY=… pnpm ai-bridge          (port 8788)
//   AI_BRIDGE_PORT=9000 pnpm ai-bridge
//
// A browser tab usually cannot call an AI API directly: most providers do not
// send CORS headers, and a key typed into a web page lives in that page. This
// tiny proxy listens on 127.0.0.1 only, adds the key from an environment
// variable, and forwards to the real endpoint. Point the game's AI firms at it:
//
//   provider openai-compatible  base URL  http://127.0.0.1:8788/openai
//   provider anthropic          base URL  http://127.0.0.1:8788/anthropic
//   provider webhook            URL       http://127.0.0.1:8788/webhook
//   any other API               base URL  http://127.0.0.1:8788/t/<name>
//
// Environment:
//   OPENAI_API_KEY, OPENAI_BASE_URL (default https://api.openai.com/v1)
//   ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL (default https://api.anthropic.com)
//   AI_WEBHOOK_URL, AI_WEBHOOK_KEY (sent as "Authorization: Bearer …")
//   AI_BRIDGE_TARGETS  JSON, for anything else — e.g. your JEV API:
//     '{"jev": {"url": "https://api.jev.example/v1", "keyEnv": "JEV_API_KEY",
//               "header": "authorization", "prefix": "Bearer "}}'
//
// Safety: binds 127.0.0.1; refuses requests whose Host is not localhost (a
// DNS-rebinding guard); answers CORS only for localhost origins; never logs a
// key or a body; forwards only to the configured upstreams.
import http from "node:http";

const PORT = Number(process.env.AI_BRIDGE_PORT ?? 8788);
const env = process.env;
const targets = {
  openai: { url: env.OPENAI_BASE_URL ?? "https://api.openai.com/v1", key: env.OPENAI_API_KEY, header: "authorization", prefix: "Bearer " },
  anthropic: { url: env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com", key: env.ANTHROPIC_API_KEY, header: "x-api-key", prefix: "" },
};
if (env.AI_WEBHOOK_URL) targets.webhook = { url: env.AI_WEBHOOK_URL, key: env.AI_WEBHOOK_KEY, header: "authorization", prefix: "Bearer ", exact: true };
if (env.AI_BRIDGE_TARGETS) {
  for (const [name, t] of Object.entries(JSON.parse(env.AI_BRIDGE_TARGETS))) {
    targets[`t/${name}`] = { url: t.url, key: t.keyEnv ? env[t.keyEnv] : undefined, header: (t.header ?? "authorization").toLowerCase(), prefix: t.prefix ?? "Bearer " };
  }
}

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const MAX_BODY = 4 * 1024 * 1024;

function cors(req, res) {
  const o = req.headers.origin;
  if (o && LOCAL_ORIGIN.test(o)) {
    res.setHeader("access-control-allow-origin", o);
    res.setHeader("vary", "origin");
    res.setHeader("access-control-allow-headers", "content-type, authorization, x-api-key, anthropic-version, anthropic-dangerous-direct-browser-access");
    res.setHeader("access-control-allow-methods", "POST, GET, OPTIONS");
  }
}

const server = http.createServer(async (req, res) => {
  if (!LOCAL.test(req.headers.host ?? "")) { res.writeHead(403).end("localhost only"); return; }
  cors(req, res);
  if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, targets: Object.fromEntries(Object.entries(targets).map(([k, t]) => [k, { url: t.url, key: !!t.key }])) }));
    return;
  }
  if (req.method !== "POST") { res.writeHead(405).end(); return; }
  const path = url.pathname.replace(/^\/+/, "");
  const name = Object.keys(targets).sort((a, b) => b.length - a.length).find((k) => path === k || path.startsWith(k + "/"));
  if (!name) { res.writeHead(404).end(`No target for /${path}. Targets: ${Object.keys(targets).join(", ")}`); return; }
  const t = targets[name];
  const rest = path.slice(name.length);
  const upstream = t.exact ? t.url : t.url.replace(/\/+$/, "") + rest + url.search;
  let size = 0;
  const chunks = [];
  for await (const c of req) { size += c.length; if (size > MAX_BODY) { res.writeHead(413).end(); return; } chunks.push(c); }
  const headers = { "content-type": req.headers["content-type"] ?? "application/json" };
  for (const h of ["anthropic-version", "anthropic-beta"]) if (req.headers[h]) headers[h] = req.headers[h];
  // The environment's key wins; a key sent by the page is passed through only
  // when the bridge has none for this target.
  if (t.key) headers[t.header] = t.prefix + t.key;
  else if (req.headers[t.header]) headers[t.header] = req.headers[t.header];
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 180_000);
  const t0 = Date.now();
  try {
    const r = await fetch(upstream, { method: "POST", headers, body: Buffer.concat(chunks), signal: ctl.signal });
    const body = Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status, { "content-type": r.headers.get("content-type") ?? "application/json" });
    res.end(body);
    console.log(`${new Date().toISOString()}  ${name.padEnd(10)} ${r.status}  ${Date.now() - t0}ms  ${body.length}b`);
  } catch (e) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `bridge: ${e.name === "AbortError" ? "upstream timed out" : e.message}` }));
    console.log(`${new Date().toISOString()}  ${name.padEnd(10)} 502  ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`AI bridge on http://127.0.0.1:${PORT}`);
  for (const [k, t] of Object.entries(targets)) console.log(`  /${k.padEnd(12)} → ${t.url}  ${t.key ? "(key from env)" : "(no key set)"}`);
});
