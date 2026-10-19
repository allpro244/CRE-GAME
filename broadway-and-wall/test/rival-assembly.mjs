// THE STREET ASSEMBLES SITES (owner, Oct 2026: "I definitely do want rivals
// to have the ability to assemble lots"). A builder firm that redevelops an
// old building, or builds on empty dirt, can buy the unowned lots beside it
// and put one building across all of them. This runs a town until a firm does
// it and holds the result to the shape every other path relies on:
//   - the firm owns the site (the parent); the folded lots belong to nobody
//     and have no land of their own left (resolveRec lotArea 0);
//   - the site's land is the sum of its lots, and the job stands on the site;
//   - nothing that stood on a folded lot is still standing;
//   - no folded lot is ever on the sales tape, a firm's deed list or your book;
//   - the merge invariants hold.
//
//   pnpm engine && node test/rival-assembly.mjs
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);

let bad = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`); if (!ok) bad++; };

let g = E.firstListings(E.newGame(4242, parcels, 1_000_000), parcels, bbls);
const MAX_M = Number(process.env.MONTHS ?? 120);
let site = null, listedKid = null;
for (let m = 1; m <= MAX_M; m++) {
  g = E.advanceMonth(g, parcels, bbls, adjacency);
  const merged = g.merged ?? {};
  for (const l of g.listings) if (merged[l.bbl]) listedKid ??= l.bbl;
  if (!site) {
    for (const j of g.cityJobs ?? []) {
      if (!j.firmId) continue;
      const kids = Object.keys(merged).filter((c) => merged[c] === j.bbl);
      if (kids.length) { site = { bbl: j.bbl, kids, firmId: j.firmId, m }; break; }
    }
  }
  if (site && m >= site.m + 24) break;
}
check(!!site, `a builder firm assembled a site and broke ground on it within ${MAX_M} months${site ? ` (month ${site.m}, ${site.kids.length + 1} lots)` : ""}`);
if (site) {
  const merged = g.merged ?? {};
  const kids = Object.keys(merged).filter((c) => merged[c] === site.bbl);
  check(kids.length >= site.kids.length, `the lots stay folded into the site (${kids.length})`);
  const owner = E.ownerOf(g, site.bbl);
  check(!!owner || !!g.holdings[site.bbl], `the site has an owner (${owner?.name ?? (g.holdings[site.bbl] ? "you" : "nobody")})`);
  for (const k of kids) {
    const kr = E.resolveRec(parcels, g, k);
    check(!E.ownerOf(g, k) && !g.holdings[k], `folded lot ${k} is on nobody's deed list`);
    check(kr.lotArea === 0, `folded lot ${k} has no land of its own (${kr.lotArea})`);
    check(kr.class === "land" && !(kr.bldgArea > 0), `nothing still stands on folded lot ${k} (${kr.class}, ${kr.bldgArea ?? 0} sf)`);
  }
  const sum = [site.bbl, ...kids].reduce((a, b) => a + parcels[b].lotArea, 0);
  const area = E.resolveRec(parcels, g, site.bbl).lotArea;
  check(Math.abs(area - sum) <= 1, `the site's land is its lots' land (${Math.round(area)} vs ${Math.round(sum)})`);
}
check(!listedKid, `no folded lot is ever put on the sales tape${listedKid ? ` (${listedKid})` : ""}`);
const merges = E.checkInvariants(g, parcels).filter((v) => v.kind === "merge");
check(merges.length === 0, `merge invariants hold${merges.length ? `: ${merges[0].msg}` : ""}`);

console.log(bad ? `\n${bad} FAILED` : "\nall clear");
process.exit(bad ? 1 : 0);
