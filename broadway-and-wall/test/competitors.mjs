// COMPETITORS — the sheet, the rules, the profiles, the cast (COMPETITORS_PLAN.md).
//   pnpm engine && node test/competitors.mjs
import { assertFreshBundle } from "./fresh.mjs";
if (!process.env.ENGINE) assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(process.env.ENGINE ? join(HERE, "..", process.env.ENGINE) : join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

let fails = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) { fails++; console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`); }
  else console.log(`PASS  ${name}${detail ? " — " + detail : ""}`);
};

const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);

console.log("\nTHE SHEET\n");
{
  // A firm with no sheet acts on its style row, exactly (the 1a contract).
  for (const style of ["family", "core", "opportunistic", "developer", "merchant", "pe", "reit", "vulture", "owneruser", "foreign", "slumlord"]) {
    const r = { id: "x", name: "X", style, cash: 0, debt: 0, bbls: [], targetLtv: 0.5, bornM: 0 };
    const p = E.paramsOf(r);
    ok(`${style}: no sheet reads the style row unchanged`, p === E.styleParams(style));
  }
  // Every trait maps inside its range and every profile draws inside 1..100.
  let inRange = true, n = 0;
  for (const prof of E.PROFILES) {
    const { sheet } = E.drawSheet(prof, `t:${prof.id}`);
    for (const t of E.TRAITS) { n++; if (!(sheet[t.key] >= 1 && sheet[t.key] <= 100)) inRange = false; }
    const p = E.paramsFrom(sheet, [], E.styleParams(prof.style));
    if (!(p.maxLtv > 0.1 && p.maxLtv < 0.96 && p.patience >= 0.95 && p.patience <= 1.31 && p.holdM >= 0)) inRange = false;
  }
  ok("every profile draws a sheet inside 1..100 and maps to sane parameters", inRange, `${n} traits checked across ${E.PROFILES.length} profiles`);
  // Same key, same firm. Different key, a different firm of the same kind.
  const a = E.drawSheet(E.PROFILE_OF.trophy, "seed:r1:Alden"), b = E.drawSheet(E.PROFILE_OF.trophy, "seed:r1:Alden");
  const c = E.drawSheet(E.PROFILE_OF.trophy, "seed:r2:Tidewater");
  ok("a sheet is drawn by hash: same firm, same numbers", JSON.stringify(a) === JSON.stringify(b));
  ok("two trophy builders still differ", JSON.stringify(a.sheet) !== JSON.stringify(c.sheet));
  // Display inverts the mapping closely enough to read a legacy firm.
  const core = E.styleParams("core");
  const disp = E.sheetFromStyle(core);
  const back = E.paramsFrom(disp, [], core);
  ok("a legacy firm's displayed leverage reads back to its own covenant",
    Math.abs(back.maxLtv - core.maxLtv) < 0.01, `${core.maxLtv} vs ${back.maxLtv.toFixed(3)}`);
}

console.log("\nRULES AND FIT\n");
{
  const base = { cls: "office", loc: 0.9, sf: 60_000, grade: 1, corner: false, districtShare: 0, ownBlock: false, distress: false, landmark: false, emptyBook: false, home: false };
  const trophy = E.drawSheet(E.PROFILE_OF.trophy, "fit:trophy").sheet;
  const edge = E.drawSheet(E.PROFILE_OF.industrialEdge, "fit:edge").sheet;
  ok("a trophy builder wants a prime office", E.siteFit(trophy, ["onlyTrophy"], [], base) > 0);
  ok("ONLY trophy refuses a fringe lot", E.siteFit(trophy, ["onlyTrophy"], [], { ...base, loc: 0.2 }) === 0);
  ok("ONLY industrial refuses an office", E.siteFit(edge, ["onlyIndustrial"], [], base) === 0);
  const fringe = E.siteFit(edge, [], [], { ...base, cls: "industrial", loc: 0.1, grade: 0.6 });
  const core = E.siteFit(edge, [], [], { ...base, cls: "industrial", loc: 0.95, grade: 0.6 });
  ok("the edge developer prefers the outskirts", fringe > core, `${fringe.toFixed(2)} vs ${core.toFixed(2)}`);
  ok("NEVER buys distress refuses a receiver's sale", E.siteFit(trophy, ["neverDistress"], [], { ...base, distress: true }) === 0);
  const plain = E.siteFit(trophy, [], [], base);
  ok("a corner-obsessed firm pays attention to corners", E.siteFit(trophy, [], ["corner"], { ...base, corner: true }) > plain);
  const asm = E.drawSheet(E.PROFILE_OF.assembler, "fit:asm").sheet;
  ok("an assembler wants the lot on its own block",
    E.siteFit(asm, [], [], { ...base, cls: "land", grade: undefined, ownBlock: true })
      > E.siteFit(asm, [], [], { ...base, cls: "land", grade: undefined, ownBlock: false }));
  const p = E.paramsFrom(trophy, ["neverSells", "neverAbove50", "neverBuilds"], E.styleParams("developer"));
  ok("NEVER sells holds forever, NEVER above 50% caps leverage, NEVER builds zeroes the build appetite",
    p.holdM === 0 && p.maxLtv <= 0.5 && p.build === 0 && p.jobs === 0);
}

console.log("\nTHE CAST\n");
{
  const g = E.newGame(12007, parcels);
  const firms = g.rivals ?? [];
  const withSheet = firms.filter((r) => r.sheet);
  ok("every opening firm is drawn from a profile", withSheet.length === firms.length && firms.length > 0, `${withSheet.length}/${firms.length}`);
  const ids = new Set(firms.map((r) => r.profile));
  ok("the cast is varied: most profiles appear once", ids.size >= Math.min(20, firms.length * 0.6), `${ids.size} profiles across ${firms.length} firms`);
  const P = (r) => E.PROFILE_OF[r.profile];
  const builders = firms.filter((r) => (P(r).centre.build ?? 50) >= 70).length;
  const holders = firms.filter((r) => (P(r).centre.hold ?? 50) >= 80).length;
  const distress = firms.filter((r) => (P(r).centre.distress ?? 50) >= 80).length;
  const banker = firms.filter((r) => r.profile === "landBanker").length;
  ok("the city check holds: builders, holders, distress buyers, a land banker",
    builders >= 4 && holders >= 4 && distress >= 2 && banker >= 1,
    `builders ${builders}, holders ${holders}, distress ${distress}, land bankers ${banker}`);
  // No opening firm is over its own covenant.
  let over = 0;
  for (const r of firms) {
    const m = E.markRival(g, parcels, r);
    if (m.aum > 0 && r.debt / m.aum > E.paramsOf(r).maxLtv + 1e-9) over++;
  }
  ok("no opening firm starts over its own leverage limit", over === 0, `${over} over`);
  // The map signature: trophy owners sit on better locations than edge owners.
  const locOf = (r) => {
    const v = r.bbls.map((b) => parcels[b]?.demandScore ?? 0);
    return v.length ? v.reduce((a, x) => a + x, 0) / v.length : NaN;
  };
  const primeFirms = firms.filter((r) => r.sheet.prime >= 75 && r.bbls.length);
  const edgeFirms = firms.filter((r) => r.sheet.edge >= 75 && r.bbls.length);
  if (primeFirms.length && edgeFirms.length) {
    const pm = primeFirms.map(locOf).reduce((a, x) => a + x, 0) / primeFirms.length;
    const em = edgeFirms.map(locOf).reduce((a, x) => a + x, 0) / edgeFirms.length;
    ok("prime-loving firms open on better-located books than edge-loving ones", pm > em, `demand ${pm.toFixed(0)} vs ${em.toFixed(0)}`);
  }
  // Two years on, nothing has broken and the books are still theirs.
  let s = g;
  for (let m = 0; m < 24; m++) s = E.advanceMonth(s, parcels, bbls, adjacency);
  ok("two years of play with the cast: no game over, sheets kept", !s.gameOver && (s.rivals ?? []).every((r) => !!r.sheet || r.bornM > 0));
}

console.log(fails ? `\n${fails} FAILED` : "\nall clear");
process.exit(fails ? 1 : 0);
