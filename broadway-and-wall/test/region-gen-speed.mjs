// REGION GENERATION: time and output hash per seed (a speed change must keep the hashes).  pnpm -s exec node test/region-gen-speed.mjs
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const { makeCity, REGION } = await import(join(HERE, "..", "src", "citygen", "index.mjs"));
for (const s of [1,2,3]) { const t = performance.now(); const c = makeCity(REGION, s); const ms = performance.now()-t; console.log(`seed ${s}: ${ms.toFixed(0)} ms ${createHash("sha1").update(JSON.stringify(c)).digest("hex").slice(0,12)}`); }
