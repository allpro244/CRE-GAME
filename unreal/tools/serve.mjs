// Tiny static server for the playable (spike A loads it over http, not file://,
// so the page gets a real origin and IndexedDB saves work):
//   node unreal/tools/serve.mjs broadway-and-wall/playable 8765
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize, extname } from "node:path";
const [dir, port = "8765"] = process.argv.slice(2);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".png": "image/png" };
createServer(async (req, res) => {
  console.log(new Date().toISOString(), req.method, req.url, req.headers["user-agent"]?.slice(0, 60));
  const p = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([\\/])+/, "");
  try {
    const f = p || "broadway-and-wall.html";
    const body = await readFile(join(dir, f));
    res.writeHead(200, { "content-type": types[extname(f)] ?? "application/octet-stream" }).end(body);
  } catch { res.writeHead(404).end("not found"); }
}).listen(Number(port), "127.0.0.1", () => console.log(`serving ${dir} on http://127.0.0.1:${port}/`));
