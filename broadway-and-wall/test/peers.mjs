// THE LEAGUE TABLE — real cities, read the same way the town is.
//   pnpm engine && node test/peers.mjs
import { assertFreshBundle } from "./fresh.mjs";
if (!process.env.ENGINE) assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(process.env.ENGINE ? join(HERE, "..", process.env.ENGINE) : join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const DATA = JSON.parse(readFileSync(join(HERE, "..", "src", "data", "peerCities.json"), "utf8"));

let fails = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) { fails++; console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`); }
  else console.log(`PASS  ${name}${detail ? " — " + detail : ""}`);
};

// The data: every city has every series from 2000 to the end of its record.
{
  const gaps = [];
  for (const c of DATA.cities) for (const k of ["pop", "unemp", "avgPay", "fmr2br"]) {
    const ys = Object.keys(c[k]).map(Number).sort((a, b) => a - b);
    if (ys[0] !== 2000) gaps.push(`${c.name} ${k} starts ${ys[0]}`);
    for (let i = 1; i < ys.length; i++) if (ys[i] !== ys[i - 1] + 1) gaps.push(`${c.name} ${k} gap at ${ys[i - 1]}`);
  }
  ok("32 cities, every series continuous from 2000", DATA.cities.length === 32 && gaps.length === 0, gaps.slice(0, 3).join("; "));
  ok("every series cites a source", DATA.sources.length >= 6 && DATA.sources.every((x) => /^https:\/\//.test(x.url)));
}

const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);
let g = E.firstListings(E.newGame(4242, parcels), parcels, bbls);

// Year one: the town opens at the nation's pay and rent, and sits among the small cities.
{
  const t = E.cityRankings(g, "Test Town");
  const you = t.rows.find((r) => r.you);
  ok("33 rows, the town among them", t.rows.length === 33 && !!you);
  ok("the town opens near US average pay", Math.abs(you.pay / DATA.us.avgPay["2000"] - 1) < 0.1, `$${Math.round(you.pay)}`);
  const frisco = t.rows.find((r) => r.name.startsWith("Frisco"));
  ok("a peer's 2000 population is its Census record", frisco.pop === DATA.cities.find((c) => c.name.startsWith("Frisco")).pop["2000"]);
  ok("nothing is projected in 2000", t.rows.every((r) => !r.projected));
}

// Past the record: projections are flagged, finite, and fade toward the nation.
{
  for (let m = 0; m < 12 * 30; m++) { g = E.advanceMonth(g, parcels, bbls, adjacency); if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 }; }
  const t = E.cityRankings(g, "Test Town");
  ok("year 2030 is past the record and flagged", t.year === 2030 && t.rows.filter((r) => !r.you).every((r) => r.projected));
  ok("every number is finite and positive", t.rows.every((r) => [r.pop, r.unemp, r.pay, r.rent2br].every((v) => Number.isFinite(v) && v > 0)));
  const frisco = DATA.cities.find((c) => c.name.startsWith("Frisco"));
  const g10 = Math.log(frisco.pop["2024"] / frisco.pop["2014"]) / 10;
  const p2030 = E.peerPop(frisco, 2030), p2124 = E.peerPop(frisco, 2124);
  const gLate = Math.log(E.peerPop(frisco, 2124) / E.peerPop(frisco, 2114)) / 10;
  ok("a boomtown keeps growing past the record", p2030 > frisco.pop["2024"]);
  ok("and its growth fades toward the nation's", gLate < g10 / 2, `${(g10 * 100).toFixed(1)}%/yr → ${(gLate * 100).toFixed(1)}%/yr`);
  void p2124;
}

console.log(fails ? `\n${fails} failed` : "\nall good");
process.exit(fails ? 1 : 0);
