// Turn a kit's survey (kit-survey.py) and Epic's own shape grammar for it
// (grammar-dump.py) into the table the facade builder reads:
// floor bands bottom to top, each with its height, its wall modules (mesh +
// width along the facade) and its outside/inside corners.
//
//   node unreal/tools/kit-table.mjs CHF   -> unreal/BroadwayWall/Data/kit-CHF.json
//
// The band order and heights are the grammar's ("L00, L01, L02*, L03, L04, L05"
// for CHF: footing, shopfront floor, a repeating typical floor, top band,
// cornice, cap). Module widths are the grammar's Size, which is the module grid
// Epic laid the kit out on, not the mesh bounds (those include overhangs).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const kit = process.argv[2] ?? "CHF";
const gdir = join(HERE, "..", "kits", `grammar-${kit}`);
const survey = JSON.parse(readFileSync(join(HERE, "..", "kits", `kit-${kit}.json`), "utf8"));
const bounds = Object.fromEntries(survey.pieces.map((p) => [p.name, p]));
const strip = (t) => t.replace(/_\d+_[0-9A-F]{32}/g, "");

const sgd = strip(readFileSync(join(gdir, `SGD_${kit}_A.t3d`), "utf8"));
const main = sgd.match(/Main Grammar="([^"]*)"/)[1].split(",").map((s) => s.trim());
const slots = [...sgd.matchAll(/Symbol="(\w+)",size=([\d.]+)/g)].map((m) => ({ symbol: m[1], size: +m[2] }));
const sizeOf = Object.fromEntries(slots.map((s) => [s.symbol, s.size]));

const bands = [];
for (const entry of main) {
  const symbol = entry.replace("*", "");
  const repeat = entry.endsWith("*");
  const rule = strip(readFileSync(join(gdir, `RULE_${kit}_${symbol}.t3d`), "utf8"));
  const mods = [...rule.matchAll(/\(Mesh="[^"]*?'(\/Game\/[^'.]+)\.(SM_\w+)'",Symbol="(\w+)",Size=([\d.]+)/g)]
    .map((m) => ({ path: `${m[1]}.${m[2]}`, name: m[2], symbol: m[3], width: +m[4] }));
  if (!mods.length) { bands.push({ symbol, height: sizeOf[symbol], repeat, walls: [], entrances: [], corner: null, inner: null }); continue; }
  const pick = (re) => mods.filter((m) => re.test(m.symbol));
  const one = (re) => pick(re)[0] ?? null;
  // depth: how far the piece reaches behind its face (X<0); y0/y1: its extent along
  // the facade in mesh space, which is where the builder anchors it
  const withDepth = (m) => m && { path: m.path, width: m.width, depth: bounds[m.name] ? Math.round(-bounds[m.name].min[0]) : 100,
    y0: bounds[m.name] ? +bounds[m.name].min[1].toFixed(1) : -m.width, y1: bounds[m.name] ? +bounds[m.name].max[1].toFixed(1) : 0 };
  bands.push({
    symbol, height: sizeOf[symbol], repeat,
    walls: pick(/^W\d+$/).map(withDepth),
    entrances: pick(/^E\d+$/).map(withDepth),
    corner: withDepth(one(/^C_E$/)),
    inner: withDepth(one(/^C_I$/)),
  });
}
// the ground floor: the first band above the footing hairline (shopfronts, entrances)
const g = bands.find((b) => b.height >= 100 && b.walls.length);
if (g) g.ground = true;
const out = join(HERE, "..", "BroadwayWall", "Data", `kit-${kit}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ format: "bw-kit/1", kit, grammar: main.join(", "), bands }, null, 1));
for (const b of bands) console.log(`${b.symbol.padEnd(4)} ${String(b.height).padStart(4)} cm${b.repeat ? " *" : "  "}  ${b.walls.length} walls (${[...new Set(b.walls.map((w) => w.width))].join("/")}), ${b.entrances.length} entrances, corner ${b.corner ? "yes" : "no"}`);
console.log("->", out);
