// THE OPENING SCREEN SAYS WHICH DECADE IT IS, AND THE CRANES ARE UP.
//
//   pnpm opening-screen
//
// Four things this session put on screen, rendered against a real month-zero
// game and asserted in the markup, the way test/leasing-page.mjs does it:
//   - the top bar and the Economy strip name the era the money behaves like,
//     under a calendar that still says the founding year;
//   - the Research page's "Under construction" column is not 0 sf in every
//     row on a seed where the opening pipeline seeded jobs;
//   - the Marketplace leads with the live tape: "On the market" comes before
//     the shops ledger, and an empty books desk is one line;
//   - a refinance quote whose cheque is smaller than its three legs says why,
//     and the desk prints that reason under "What caps it".
// Same SSR build as leasing-page: esbuild, the @/ alias, css emptied, the
// browser packages external, window shimmed, and useSyncExternalStore handed
// the live snapshot so pages render the game rather than the start menu.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..");
const ENTRY = join(HERE, ".opening-screen.tsx");
const OUT = join(HERE, ".opening-screen.mjs");

writeFileSync(ENTRY, String.raw`
import React from "react";
import { renderToString } from "react-dom/server";
import { useStore } from "@/state/store";
import TopBar from "@/ui/TopBar";
import { EconomyPage } from "@/ui/panels/EconomyPage";
import { ResearchPage } from "@/ui/panels/ResearchPage";
import { MarketPage } from "@/ui/panels/MarketPage";
import { RefiSection } from "@/ui/panels/RefiDesk";
import { sf } from "@/ui/format";
import { newGame, advanceMonth, firstListings } from "@/engine/sim";
import { executePurchase } from "@/engine/actions";
import { refiQuotes } from "@/engine/debt";
import { normalizeParcels } from "@/engine/mix";
import { resolveRec } from "@/engine/value";
import { makeCity, PROCEDURAL, REFERENCE_SEED } from "@/citygen/index.mjs";

const built = makeCity(PROCEDURAL, REFERENCE_SEED, {});
normalizeParcels(built.parcels);
const parcels = built.parcels;
const bbls = Object.keys(parcels);
const adjacency = built.adjacency;

let fails = 0;
const ok = (name: string, cond: boolean) => { console.log((cond ? "PASS  " : "FAIL  ") + name); if (!cond) fails++; };
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const origUses = React.useSyncExternalStore;
(React as any).useSyncExternalStore = (sub: any, get: any) => origUses(sub, get, get);
const render = (g: any, el: React.ReactElement) => { useStore.setState({ game: g, parcels } as any); return renderToString(el); };

// A SEED THAT SEEDS. Walk the seeds until the opening pipeline put at least
// one job up, so the pipeline assertion measures the screen, not the pro
// forma's mood on one seed (on half the seeds it clears nothing — HANDOFF §6).
let g: any = null;
for (let seed = 9085; seed < 9085 + 17 * 12 && !g; seed += 17) {
  const cand = firstListings(newGame(seed, parcels), parcels, bbls);
  if ((cand.cityJobs ?? []).length > 0) g = cand;
}
ok("some opening seed carries a construction pipeline at month zero", !!g);
if (!g) process.exit(1);

// 1. THE ERA, ON THE TOP BAR AND THE ECONOMY STRIP.
const top = render(g, <TopBar />);
ok("the top bar carries the era label in a tooltip (" + g.econ.eraLabel + ")", top.includes(esc(g.econ.eraLabel)));
ok("the top bar has an Era tile", top.includes(">Era<"));
const econ = render(g, <EconomyPage />);
ok("the Economy strip prints the era label", econ.includes(esc(g.econ.eraLabel)));
ok("the Economy strip still prints the base rate", econ.includes(g.econ.indexRate.toFixed(2) + "%"));

// 2. THE CRANES ARE UP on Research · Sectors.
const research = render(g, <ResearchPage />);
const pipeSf = Object.values(g.econ.pipeline ?? {}).reduce((a: number, v: any) => a + (v ?? 0), 0) as number;
ok("the economy's pipeline view carries the seeded jobs (" + sf(pipeSf) + ")", pipeSf > 0);
const seededRow = (["office", "retail", "multifamily", "industrial"] as const).find((k) => (g.econ.pipeline?.[k] ?? 0) > 0);
ok("Research prints a non-zero Under construction cell (" + (seededRow ? sf(Math.round(g.econ.pipeline[seededRow])) : "—") + ")",
  !!seededRow && research.includes(esc(sf(Math.round(g.econ.pipeline[seededRow])))));

// 3. THE MARKETPLACE LEADS WITH THE TAPE.
const market = render(g, <MarketPage />);
const iTape = market.indexOf("On the market ·");
const iShops = market.indexOf("The shops ·");
ok("the tape is on the page", iTape >= 0);
ok("the shops ledger comes after the tape", iShops > iTape);
if ((g.portfolios ?? []).length === 0) {
  ok("an empty books desk is one line", market.includes("Books for sale · 0 — no receiver books"));
}

// 4. A REFINANCE QUOTE SAYS WHY. Buy on the tape until a desk's cheque carries
// a reason (a rent-roll haircut or an advance below the stated rate).
let h = { ...g, cash: 80e6 };
let found: { bbl: string; q: any } | null = null;
for (let m = 0; m < 48 && !found; m++) {
  h = advanceMonth(h, parcels, bbls, adjacency);
  for (const li of [...h.listings]) {
    const rec = resolveRec(parcels, h, li.bbl);
    if (!rec || h.holdings[li.bbl] || rec.class === "land" || !rec.bldgArea) continue;
    const r = executePurchase(h, parcels, li.bbl, li.ask, "cash", false, 1);
    if (r.err) continue;
    h = r.s;
    const { quotes } = refiQuotes(h, parcels, li.bbl);
    const q = quotes.find((x) => x.available && x.maxProceeds > 0 && x.bindingWhy);
    if (q) { found = { bbl: li.bbl, q }; break; }
  }
}
ok("a bought building drew a quote with a reason on it", !!found);
if (found) {
  const { bbl, q } = found;
  ok("every haircut is named: haircut ×" + q.haircut.toFixed(2) + (q.haircut < 0.995 ? " and the reason says so" : " (none this time)"),
    q.haircut >= 0.995 || /off for the roll/.test(q.bindingWhy));
  const desk = render(h, <RefiSection bbl={bbl} />);
  ok("the desk prints What caps it", desk.includes("What caps it"));
  // The selected desk prints bindingWhy under "What caps it"; every other
  // desk's row prints its haircut sentence (why) and, when it also sized
  // below its stated advance, the advance reason on a second line.
  const reason = q.advanceWhy ?? q.bindingWhy;
  ok("the desk prints the reason: " + reason.slice(0, 60) + "…", desk.includes(esc(reason)));
  ok("the Advance column shows the sized rate today (" + (q.advanceToday * 100).toFixed(0) + "%)", desk.includes((q.advanceToday * 100).toFixed(0) + "%"));
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
