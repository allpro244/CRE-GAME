// Minimal client for the UE 5.8 MCP server (streamable HTTP, JSON responses).
//   node unreal/tools/mcp.mjs [--url http://127.0.0.1:8000/mcp]   (or UE_MCP_URL) <method> [json-params]
//   node unreal/tools/mcp.mjs tools/list
//   node unreal/tools/mcp.mjs call list_toolsets '{}'
// "call <tool> <args>" is shorthand for tools/call.
const argv = process.argv.slice(2);
let url = process.env.UE_MCP_URL ?? "http://127.0.0.1:8000/mcp";
if (argv[0] === "--url") { url = argv[1]; argv.splice(0, 2); }

let session = null, id = 0;
export async function rpc(method, params = {}) {
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  if (session) headers["mcp-session-id"] = session;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
  session = res.headers.get("mcp-session-id") ?? session;
  const text = await res.text();
  const json = text.startsWith("{") ? JSON.parse(text) : JSON.parse(text.split("\n").find((l) => l.startsWith("data:")).slice(5));
  if (json.error) throw new Error(JSON.stringify(json.error));
  return json.result;
}
export async function connect() {
  const r = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "bw-agent", version: "0" } });
  await fetch(url, { method: "POST", headers: { "content-type": "application/json", "mcp-session-id": session }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
  return r;
}
export const call = (name, args = {}) => rpc("tools/call", { name, arguments: args });

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("mcp.mjs")) {
  if (argv.length) {
    await connect();
    const [m, ...rest] = argv;
    const r = m === "call" ? await call(rest[0], JSON.parse(rest[1] ?? "{}")) : await rpc(m, JSON.parse(rest[0] ?? "{}"));
    console.log(JSON.stringify(r, null, 1));
  }
}
