// Careers — and nobody dies. Rival mortality (estate sales at a drawn death
// month, an heir seated) was removed with age: owner decision, ECONOMY.md
// "No age, no mortality".
//   pnpm engine && node test/principal-careers.mjs
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

let fails = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) { fails++; console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`); }
  else console.log(`PASS  ${name}${detail ? " — " + detail : ""}`);
};

const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);

// Careers: unset → neutral load; specialist lighter than novice.
{
  ok("unset career load = 1.0", Math.abs(E.careerLoadMult(undefined, "office", "X") - 1) < 1e-9);
  const novice = E.emptyCareer();
  novice.classM.office = 0;
  // empty keys → treated neutral
  ok("empty career load = 1.0", Math.abs(E.careerLoadMult(novice, "office", "X") - 1) < 1e-9);
  const deep = E.emptyCareer();
  deep.classM.office = 120;
  deep.districtM.Exchange = 80;
  const mDeep = E.careerLoadMult(deep, "office", "Exchange");
  const mStrange = E.careerLoadMult(deep, "industrial", "Millside");
  ok("specialist lighter load than stranger", mDeep < mStrange, `${mDeep.toFixed(3)} < ${mStrange.toFixed(3)}`);
  ok("specialist below 1.0", mDeep < 1);
  ok("stranger above 1.0", mStrange > 1);
}

// Careers accrue on principal float without touching s.rng.
{
  const g = E.firstListings(E.newGame(12007, parcels), parcels, bbls);
  // Give the player a building
  const bbl = bbls.find((b) => {
    const rec = E.resolveRec(parcels, g, b);
    return rec && rec.class === "office" && rec.bldgArea > 0;
  });
  ok("found office parcel", !!bbl);
  g.holdings[bbl] = { bbl, tenants: [], condition: "standard", boughtM: 0, costBasis: 1 };
  const before = g.principal.career.classM.office ?? 0;
  const rng0 = g.rng;
  E.tickCareers(g, parcels);
  const after = g.principal.career.classM.office ?? 0;
  ok("principal accrued office month", after === before + 1, `${before} -> ${after}`);
  ok("tickCareers leaves s.rng", g.rng === rng0);
}

// Nobody dies: a decade runs, every rival principal who opened the run is
// still seated (unless the firm failed), and no person carries a life field.
{
  let cur = E.firstListings(E.newGame(33, parcels), parcels, bbls);
  const seated0 = Object.fromEntries(Object.entries(cur.rivalPrincipals ?? {}).map(([k, p]) => [k, p.name]));
  for (let i = 0; i < 120; i++) cur = E.advanceMonth(cur, parcels, bbls, adjacency);
  const kept = Object.entries(seated0).filter(([k, n]) => {
    const r = (cur.rivals ?? []).find((x) => x.id === k);
    return !r || r.failedM !== undefined || cur.rivalPrincipals?.[k]?.name === n;
  }).length;
  ok("no rival principal replaced in a decade", kept === Object.keys(seated0).length, `${kept}/${Object.keys(seated0).length}`);
  const people = [cur.principal, ...Object.values(cur.rivalPrincipals ?? {}), ...(cur.staff ?? [])];
  ok("no person carries bornM/diesM/diedM", people.every((p) => p && p.bornM === undefined && p.diesM === undefined && p.diedM === undefined));
  ok("no estate listing from a person", !(cur.listings ?? []).some((l) => l.reason === "estate" && (cur.rivals ?? []).some((r) => r.id === l.sellerId)));
  ok("no death on the tape", !(cur.news ?? []).some((n) => /has died at/.test(n.text)));
  ok("world still running", cur.gameOver == null && cur.month === 120);
}

console.log(`\n${fails === 0 ? "principal-careers pass" : `${fails} principal-careers failure(s)`}`);
process.exit(fails === 0 ? 0 : 1);
