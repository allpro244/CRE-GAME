// Spike B — the economy engine as a sidecar Unreal talks to over a local WebSocket.
//
//   node unreal/sim-server/server.mjs [port]        (default 8790)
//
// Loads the same self-contained engine bundle the harnesses use
// (broadway-and-wall/test/.engine.mjs — rebuild with `pnpm engine`) and the
// same city generator, holds the authoritative GameState, and answers:
//   {type:"town", seed?}            build the city + a new game
//   {type:"month"}                  advance one month
//   {type:"span", cap?}             advance until something needs the player
//   {type:"action", name, args}     call any exported engine function as name(g, ...args)
// Add view:true to any of them to get the month's render view (engine/renderView.ts,
// the "bw-render/1" contract Unreal draws from) in the reply.
// Every reply is {type, id, ms, ...summary}. No dependencies: the WebSocket
// framing is hand-rolled (RFC 6455, text frames only).
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BW = join(HERE, "..", "..", "broadway-and-wall");
const E = await import(pathToFileURL(join(BW, "test", ".engine.mjs")).href);
const { loadCity } = await import(pathToFileURL(join(BW, "test", "city.mjs")).href);
const PORT = Number(process.argv[2] ?? 8790);

let town = null; // { parcels, bbls, adjacency }
let g = null;

function summary() {
  const holdings = Object.keys(g.holdings ?? {}).length;
  return { month: g.month, cash: Math.round(g.cash), holdings, gameOver: !!g.gameOver, stateBytes: JSON.stringify(g).length };
}

let lastViewMonth = -1;
function withView(m, reply) {
  if (!m.view || !g || typeof E.renderView !== "function") return reply;
  const view = E.renderView(g, lastViewMonth);
  lastViewMonth = g.month;
  return { ...reply, view };
}

function handle(m) {
  const t0 = performance.now();
  const done = (extra) => withView(m, { id: m.id ?? 0, ms: +(performance.now() - t0).toFixed(1), ...extra });
  switch (m.type) {
    case "town": {
      if (m.seed != null) process.env.BW_SEED = String(m.seed);
      if (m.size) process.env.BW_SIZE = m.size;
      const c = loadCity(0, E.normalizeParcels);
      const parcels = JSON.parse(JSON.stringify(c.parcels));
      town = { parcels, bbls: c.bbls, adjacency: c.adjacency };
      g = E.firstListings(E.newGame(m.gameSeed ?? 1, parcels), parcels, c.bbls);
      lastViewMonth = -1;
      return done({ type: "ready", citySeed: c.seed, parcels: c.bbls.length, ...summary() });
    }
    case "month":
      if (!g) return done({ type: "error", err: "no town" });
      g = E.advanceMonth(g, town.parcels, town.bbls, town.adjacency);
      return done({ type: "state", ...summary() });
    case "span": {
      if (!g) return done({ type: "error", err: "no town" });
      const r = E.advanceUntilAttention(g, town.parcels, town.bbls, town.adjacency, m.cap ?? 36, m.seen);
      g = r.s ?? r.state ?? g;
      return done({ type: "state", ...summary() });
    }
    case "action": {
      const fn = E[m.name];
      if (!g || typeof fn !== "function") return done({ type: "error", err: `no action ${m.name}` });
      g = fn(g, ...(m.args ?? []));
      return done({ type: "state", ...summary() });
    }
    default:
      return done({ type: "error", err: `unknown ${m.type}` });
  }
}

// ---- minimal WebSocket server ----
function frame(text) {
  const p = Buffer.from(text, "utf8"), n = p.length;
  const h = n < 126 ? Buffer.from([0x81, n])
    : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255])
    : (() => { const b = Buffer.alloc(10); b[0] = 0x81; b[1] = 127; b.writeBigUInt64BE(BigInt(n), 2); return b; })();
  return Buffer.concat([h, p]);
}

const server = createServer((_, res) => res.writeHead(426).end("websocket only"));
server.on("upgrade", (req, sock) => {
  const accept = createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  console.log("client connected");
  let buf = Buffer.alloc(0), parts = [];
  sock.on("data", (d) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = buf[0] & 0x80, op = buf[0] & 0x0f, masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const need = off + (masked ? 4 : 0) + len;
      if (buf.length < need) return;
      const mask = masked ? buf.subarray(off, off + 4) : null;
      const pay = Buffer.from(buf.subarray(off + (masked ? 4 : 0), need));
      if (mask) for (let i = 0; i < pay.length; i++) pay[i] ^= mask[i & 3];
      buf = buf.subarray(need);
      if (op === 8) { sock.end(Buffer.from([0x88, 0])); return; }
      if (op === 9) { sock.write(Buffer.concat([Buffer.from([0x8a, pay.length]), pay])); continue; }
      if (op === 1 || op === 0) {
        parts.push(pay);
        if (!fin) continue;
        const text = Buffer.concat(parts).toString("utf8"); parts = [];
        let reply;
        try { reply = handle(JSON.parse(text)); } catch (e) { reply = { type: "error", err: String(e?.stack ?? e) }; }
        console.log(">", text.slice(0, 120), "<", JSON.stringify(reply).slice(0, 200));
        sock.write(frame(JSON.stringify(reply)));
      }
    }
  });
  sock.on("error", () => {});
  sock.on("close", () => console.log("client gone"));
});
server.listen(PORT, "127.0.0.1", () => console.log(`sim-server on ws://127.0.0.1:${PORT}`));
