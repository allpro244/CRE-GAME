// THE LEASING PAGE LISTS THE LETTERS.
//
//   pnpm leasing-page
//
// The owner's report: "when you get LOIs and renewals, they don't pop up in
// the leasing tab." They did not — the page called Leasing showed a COUNT of
// letters on the desk and the letters themselves lived on Deals. This renders
// the real page against a real game that carries a new-lease LOI and a
// renewal letter, and fails if either is missing from the markup.
//
// It is the only harness in the repo that renders React, so it builds its own
// bundle: the engine harnesses read test/.engine.mjs, which has no UI in it.
// esbuild bundles src/ with the `@/` alias, stylesheets emptied, and the
// browser-only packages left external; the store sets `window.__store` at
// import, so `window` is shimmed in a banner. react-dom/server answers
// useSyncExternalStore with the SERVER snapshot, which zustand wires to the
// store's initial state (game: null), so the entry hands the renderer the live
// snapshot instead — otherwise every page renders the start menu's world.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..");
const ENTRY = join(HERE, ".leasing-page.tsx");
const OUT = join(HERE, ".leasing-page.mjs");

writeFileSync(ENTRY, String.raw`
import React from "react";
import { renderToString } from "react-dom/server";
import { useStore } from "@/state/store";
import { LeasingPage } from "@/ui/panels/LeasingPage";
import { PortfolioPage } from "@/ui/panels/PortfolioPage";
import { occRead, occLabel } from "@/ui/panels/shared";
import { portfolioOccupancy } from "@/engine/leasing";
import { newGame, advanceMonth, firstListings } from "@/engine/sim";
import { executePurchase } from "@/engine/actions";
import { normalizeParcels } from "@/engine/mix";
import { resolveRec } from "@/engine/value";
import { loiNeedsPrincipal } from "@/engine/leasing";
import { makeCity, PROCEDURAL, REFERENCE_SEED } from "@/citygen/index.mjs";

const built = makeCity(PROCEDURAL, REFERENCE_SEED, {});
normalizeParcels(built.parcels);
const parcels = built.parcels;
const bbls = Object.keys(parcels);
const adjacency = built.adjacency;
let g = firstListings(newGame(550991, parcels), parcels, bbls);
g = { ...g, cash: 80e6 };

// Two office buildings off the tape, all cash, so there is space to let and a
// roll to renew. The principal holds the pen: no agent, no desk, no manager.
let bought = 0;
for (let m = 0; m < 60 && bought < 2; m++) {
  g = advanceMonth(g, parcels, bbls, adjacency);
  for (const li of [...g.listings]) {
    const rec = resolveRec(parcels, g, li.bbl);
    if (!rec || g.holdings[li.bbl] || rec.class !== "office" || !rec.bldgArea) continue;
    const r = executePurchase(g, parcels, li.bbl, li.ask, "cash", false, 1);
    if (!r.err) { g = r.s; bought++; break; }
  }
}
if (bought < 2) { console.log("FAIL  could not buy two office buildings"); process.exit(1); }
// A sitting tenant rolls seven months out, so a renewal letter is due.
const h0 = Object.values(g.holdings).find((h) => h.tenants.length);
if (!h0) { console.log("FAIL  no tenants on the book"); process.exit(1); }
h0.tenants[0].endM = g.month + 7;

// TWO RENDERS, ONE LETTER EACH. A renewal is engineered (the roll above), so
// it arrives on the clock; a new-lease letter depends on traffic. Each is
// asserted on a page rendered while it is LIVE — a letter seen in month 5
// that lapsed by month 9 is on no page, and the first cut of this harness
// waited for both to coincide and once sat 36 months without them doing so.
const liveOn = (kind: "renewal" | "new") => g.lois.find((l) => loiNeedsPrincipal(g, l) && (kind === "renewal" ? l.kind === "renewal" : l.kind !== "renewal"));
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
let fails = 0;
const ok = (name: string, cond: boolean) => { console.log((cond ? "PASS  " : "FAIL  ") + name); if (!cond) fails++; };
const origUses = React.useSyncExternalStore;
(React as any).useSyncExternalStore = (sub: any, get: any) => origUses(sub, get, get);
const renderLeasing = () => { useStore.setState({ game: g, parcels } as any); return renderToString(<LeasingPage />); };

let renewal: any = null;
for (let m = 0; m < 12 && !renewal; m++) { g = advanceMonth(g, parcels, bbls, adjacency); renewal = liveOn("renewal"); }
ok("a renewal letter arrived to test against", !!renewal);
if (renewal) {
  const html = renderLeasing();
  console.log("month " + g.month + ": renewal from " + renewal.name + " is live");
  ok("a letters section renders on Leasing", html.includes("On your desk ·"));
  ok("the renewal from " + renewal.name + " is listed on Leasing", html.includes(esc(renewal.name)));
  ok("the renewal carries the RENEWAL chip", html.includes("chip-renewal"));
}
let loi: any = null;
for (let m = 0; m < 48 && !loi; m++) { g = advanceMonth(g, parcels, bbls, adjacency); loi = liveOn("new"); }
ok("a new-lease LOI arrived to test against", !!loi);
if (loi) {
  const html = renderLeasing();
  console.log("month " + g.month + ": new-lease letter from " + loi.name + " is live (" + g.lois.filter((l) => loiNeedsPrincipal(g, l)).length + " on the desk)");
  ok("the LOI from " + loi.name + " is listed on Leasing", html.includes(esc(loi.name)));
  ok("the cards carry their actions", html.includes(">Accept<") || html.includes("Take their final"));
}

// THE PORTFOLIO PAGE AGREES WITH THE TOP BAR. Same store, same game.
useStore.setState({ game: g, parcels } as any);
const book = renderToString(<PortfolioPage />);
const po = portfolioOccupancy(g, parcels);
ok("the book has a lettable foot to measure", !!po);
if (po) {
  const topBar = (100 * po.occ).toFixed(1) + "%";
  ok("Portfolio prints the top bar's occupancy (" + topBar + ") as its book total", book.includes(topBar));
  for (const h of Object.values(g.holdings)) {
    const rec = resolveRec(parcels, g, h.bbl);
    if (!rec || rec.class === "land" || !rec.bldgArea) continue;
    const label = occLabel(occRead(rec, h));
    ok("row " + rec.address + " prints Leasing's read (" + label + ")", book.includes(esc(label)));
  }
}
process.exit(fails ? 1 : 0);
`);

const build = spawnSync(join(APP, "node_modules", ".bin", "esbuild"), [
  ENTRY, "--bundle", "--format=esm", "--platform=node", "--jsx=automatic", "--log-level=warning",
  `--alias:@=${join(APP, "src")}`, "--loader:.css=empty",
  "--external:react", "--external:react-dom", "--external:zustand",
  "--external:maplibre-gl", "--external:three", "--external:pmtiles",
  "--banner:js=globalThis.window = globalThis; globalThis.document = globalThis.document ?? { addEventListener() {}, removeEventListener() {} };",
  `--outfile=${OUT}`,
], { stdio: "inherit" });
if (build.status) process.exit(build.status);
const run = spawnSync(process.execPath, [OUT], { stdio: "inherit", cwd: APP });
process.exit(run.status ?? 1);
