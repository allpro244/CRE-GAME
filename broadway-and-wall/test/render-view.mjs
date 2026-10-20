// THE RENDER CONTRACT CANNOT DRIFT (UE58_PLAN.md §2).
//
// engine/renderView.ts is what Unreal draws from; RenderView.cpp is what reads
// it. Two checks:
//   1. every field the TypeScript view emits is read by the C++ parser, and the
//      format tags match — so a field added on one side fails here, not as a
//      silently missing crane in Unreal;
//   2. over a few years of a real game the view keeps the web map's rules:
//      a frame's height is floors x FLOOR_M x progress, a standing building is
//      floors x FLOOR_M, a lot is drawn once, events fall in their window.
//
//   pnpm engine && node test/render-view.mjs
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

let bad = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`); if (!ok) bad++; };

console.log("\nRENDER VIEW — the contract Unreal draws from\n");

// ---- 1. the two sides read the same fields
const ts = readFileSync(join(HERE, "..", "src", "engine", "renderView.ts"), "utf8");
const cpp = readFileSync(join(HERE, "..", "..", "unreal", "BroadwayWall", "Source", "BroadwayWall", "RenderView.cpp"), "utf8");
const fieldsOf = (iface) => {
  const body = ts.match(new RegExp(`export interface ${iface} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
  return [...body.matchAll(/^\s+(\w+)\??:/gm)].map((m) => m[1]);
};
const read = new Set([...cpp.matchAll(/TEXT\("(\w+)"\)/g)].map((m) => m[1]));
for (const iface of ["RenderView", "RenderLot", "RenderOwner", "RenderEvent"]) {
  const missing = fieldsOf(iface).filter((f) => !read.has(f));
  check(fieldsOf(iface).length > 0 && missing.length === 0, `${iface}: C++ reads every field${missing.length ? ` — missing ${missing.join(", ")}` : ` (${fieldsOf(iface).length})`}`);
}
check(E.RENDER_VIEW_FORMAT === "bw-render/1" && cpp.includes(`TEXT("${E.RENDER_VIEW_FORMAT}")`), `format tag ${E.RENDER_VIEW_FORMAT} on both sides`);

// ---- 2. the rules, over a real game
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);
let g = E.firstListings(E.newGame(31337, parcels), parcels, bbls);
let frames = 0, standing = 0, events = 0, last = -1;
let heightsOk = true, onceOk = true, windowOk = true, progOk = true;
for (let m = 0; m < 96; m++) {
  g = E.advanceMonth(g, parcels, bbls, adjacency);
  if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
  const v = E.renderView(g, last);
  last = g.month;
  const seen = new Set();
  for (const l of v.lots) {
    if (seen.has(l.bbl)) onceOk = false;
    seen.add(l.bbl);
    const want = l.floors * E.FLOOR_M * (l.construction ? l.progress : 1);
    if (Math.abs(l.heightM - want) > 1e-9) heightsOk = false;
    if (l.construction && !(l.progress >= 0.12 && l.progress <= 1)) progOk = false;
    if (l.construction) frames++; else standing++;
  }
  for (const e of v.events) { events++; if (!(e.m > v.month - 1 && e.m <= v.month)) windowOk = false; }
}
check(heightsOk, "heights follow floors x FLOOR_M x progress");
check(progOk, "a frame's progress sits in [0.12, 1]");
check(onceOk, "no lot is drawn twice in one month");
check(windowOk, "events fall inside (last month, this month]");
// coverage: the run has to exercise what it checks, or the checks above are vacuous
check(frames > 0, `cranes appeared over eight years (${frames} frame-months)`);
check(standing > 0, `deliveries stood (${standing} building-months)`);
check(events > 0, `deed events came through (${events})`);

console.log(bad ? `\n${bad} FAILED\n` : "\nALL PASS\n");
process.exit(bad ? 1 : 0);
