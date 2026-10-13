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

console.log("\nPHASE 5 — NEW MECHANICS\n");
{
  // A RAID: a raider with cash and a firm it can afford. The look is hashed,
  // so walk the mid-years until it fires.
  let g = E.newGame(12007, parcels);
  const raider = g.rivals.find((r) => r.sheet) ;
  E.seatProfile(g, raider, E.PROFILE_OF.raider);
  raider.cash = 400_000_000;
  raider.stressMs = 0;
  let taken = null;
  for (let y = 0; y < 40 && !taken; y++) {
    g.month = 6 + 12 * y;
    E.tickRivalTakeovers(g, parcels);
    taken = g.rivals.find((r) => r.takenOverBy === raider.id);
  }
  ok("a raider buys a competitor whole", !!taken, taken ? `${raider.name} bought ${taken.name}` : "never fired");
  if (taken) {
    ok("the target is off the street with nothing left on it", taken.failedM !== undefined && !taken.bbls.length && taken.debt === 0 && taken.cash === 0);
    ok("no deed is on two books after the raid", g.rivals.every((r) => r === raider || !r.bbls.some((b) => raider.bbls.includes(b))));
  }
}
{
  // THE BRIDGE: an old, unlevered family firm that has stopped buying.
  let g = E.newGame(12007, parcels);
  const fam = g.rivals.find((r) => r.bbls.length >= 2);
  E.seatProfile(g, fam, E.PROFILE_OF.dynasty);
  fam.sheet.hold = 96; fam.sheet.capacity = 20;
  fam.bornM = -400; fam.debt = 0; fam.cash = 1_000_000; fam.stressMs = 0;
  fam.heldSince = Object.fromEntries(fam.bbls.map((b) => [b, -200]));
  const deeds = [...fam.bbls];
  for (let y = 0; y < 60 && fam.failedM === undefined; y++) {
    g.month = 9 + 12 * y;
    E.tickRivalRetirements(g, parcels);
  }
  ok("an old family firm can wind up into a holder", fam.retiredM !== undefined);
  if (fam.retiredM !== undefined) {
    const h = E.holderOf(g, parcels, deeds[0]);
    ok("its buildings are held by the family under its name", !!h && h.name.includes("Family Holdings") && deeds.every((b) => E.holderOf(g, parcels, b)?.id === h.id), h?.name ?? "no holder");
    ok("the family is on the register", E.register(g, parcels).some((x) => x.id === h?.id));
  }
}
{
  // BUILD-TO-SUIT: a tenant of yours whose lease runs out around delivery signs elsewhere.
  let g = E.newGame(12007, parcels);
  const bbl = Object.keys(parcels).find((b) => parcels[b].class === "office" && parcels[b].bldgArea > 20_000);
  const r = g.rivals[0];
  E.seatProfile(g, r, E.PROFILE_OF.bts);
  g.holdings[bbl] = { bbl, boughtM: 0, costBasis: 1, assessed: 1, loan: null, condition: "standard", tenants: [
    { name: "Ledger & Quill LLP", sf: 12_000, rentPsf: 40, startM: -60, endM: 30, credit: 1, use: "office", sector: "law" },
  ], cfHistory: [], occ: 0.6 };
  let signed = false;
  for (let m = 0; m < 40 && !signed; m++) {
    g.month = m;
    E.poachForBuildToSuit(g, parcels, r, parcels[bbl], "office", 60_000, 28);
    signed = !!g.holdings[bbl].tenants[0].leavingFor;
  }
  ok("a build-to-suit shop signs your tenant for its new building", signed, g.holdings[bbl].tenants[0].leavingFor ?? "");
}
{
  // YOUR LOAN, BOUGHT BY A COMPETITOR THAT WANTS THE BUILDING.
  let g = E.firstListings(E.newGame(12007, parcels, 40_000_000), parcels, bbls);
  let mine = null;
  for (const L of g.listings) {
    const rec = E.resolveRec(parcels, g, L.bbl);
    if (!rec || rec.class === "land" || !rec.bldgArea || L.ask > 8_000_000) continue;
    const r = E.executePurchase(g, parcels, L.bbl, L.ask, "savings", false, 1);
    if (!r.err && r.s.holdings[L.bbl]?.loan) { g = r.s; mine = L.bbl; break; }
  }
  ok("bought a levered building to default on", !!mine);
  const hunter = g.rivals.find((r) => r.failedM === undefined);
  E.seatProfile(g, hunter, E.PROFILE_OF.loanToOwn);
  hunter.sheet.distress = 95; hunter.sheet.reach = 80;
  hunter.cash = 50_000_000; hunter.aum = 400_000_000; hunter.debt = 0; hunter.stressMs = 0;
  E.openWorkout(g, mine, "arrears", 250_000);
  g.workouts[mine].startM = g.month - 4;                 // three months in, no cure
  for (let m = 0; m < 80 && !g.holdings[mine].loan.holderFirmId; m++) { g.month++; E.maybeSellYourLoan(g, parcels); }
  const held = g.holdings[mine].loan.holderFirmId === hunter.id;
  ok("a loan-to-own competitor buys your defaulted loan", held, held ? `${hunter.name} holds it` : "never sold");
  if (held) {
    const x = g.firmHeldLoans.find((y) => y.bbl === mine);
    ok("it paid less than the balance, and the workout now names it", x.paid < x.bal && g.workouts[mine].lender === hunter.name,
      `${(x.paid / x.bal * 100).toFixed(0)} cents`);
    const fb = E.requestForbearance(g, parcels, mine);
    ok("it will not extend", /said no/i.test(fb.msg ?? "") || !!fb.err, fb.msg ?? fb.err);
    const q = E.payoffQuote(g, parcels, mine);
    ok("a payoff costs you a profit over what it paid", q.open && q.px > x.paid && q.px <= x.bal, `${q.px} vs paid ${x.paid}`);
    // to the July steps, with no money to cure: the credit bid takes it
    const w = g.workouts[mine];
    w.stage = "foreclosure";
    g.cash = 0; if (g.loc) g.loc.limit = 0;
    const h0 = g.holdings[mine];
    h0.loan.balance = Math.round(E.ownedHoldingValue(g, parcels, h0) * 1.3);
    // a payment the building and the firm cannot meet — so the coupon is not
    // fundable and the file is not pulled back from the steps (the house rule)
    h0.loan.monthlyPmt = 25_000_000;
    // the county's first docket is month 30 (auction.ts FIRST_DOCKET_M), a July
    while (g.month % 12 !== 5 || g.month < 29) g.month++;
    w.saleM = g.month + 1; w.decideM = w.saleM;
    let s2 = g;
    for (let m = 0; m < 4 && s2.holdings[mine]; m++) {
      s2 = { ...s2, cash: 0 };
      s2 = E.advanceMonth(s2, parcels, bbls, adjacency);
      if (s2.gameOver) s2 = { ...s2, gameOver: null };
    }
    const took = (s2.rivals.find((r) => r.id === hunter.id)?.bbls ?? []).includes(mine);
    ok("its credit bid at the auction puts the building on its book", !s2.holdings[mine] && took,
      s2.holdings[mine] ? "still yours" : took ? "theirs" : "went elsewhere");
  }
}
{
  // Over a long run, how often each mechanic happens on its own (a report).
  let g = E.newGame(550991, parcels);
  const count = { raid: 0, convert: 0, retire: 0, lto: 0, backer: 0 };
  for (let m = 0; m < 360; m++) {
    g = E.advanceMonth(g, parcels, bbls, adjacency);
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
    for (const n of g.news.filter((x) => x.q === g.month)) {
      if (/has bought .* outright/.test(n.text)) count.raid++;
      if (/is converting/.test(n.text)) count.convert++;
      if (/has wound itself up/.test(n.text)) count.retire++;
      if (/before anyone else moved/.test(n.text)) count.lto++;
      if (/somebody behind it wrote a cheque/.test(n.text)) count.backer++;
    }
  }
  console.log(`  thirty years, seed 550991: ${count.raid} raids, ${count.convert} conversions, ${count.retire} retirements, ${count.lto} loan-to-own buys, ${count.backer} backer rescues`);
  ok("thirty years run clean with every mechanic live", (g.rivals ?? []).length > 0);
}

console.log("\nPLANS, QUIET CALLS, FAMILIES\n");
{
  // EVERY FIRM OPENS WITH A PLAN, and the card can say it.
  const g = E.newGame(12007, parcels);
  const sheeted = g.rivals.filter((r) => r.sheet && r.bbls.length);
  const planned = sheeted.filter((r) => r.thesis && E.thesisLabel(r.thesis).length > 10);
  ok("every firm with a book opens the game with a plan", planned.length === sheeted.length, `${planned.length}/${sheeted.length} — e.g. "${planned[0] && E.thesisLabel(planned[0].thesis)}"`);
}
{
  // A FIRM UNDER PRESSURE RINGS YOU BEFORE THE TAPE.
  let g = E.firstListings(E.newGame(12007, parcels, 40_000_000), parcels, bbls);
  for (const L of g.listings) {
    const rec = E.resolveRec(parcels, g, L.bbl);
    if (!rec || rec.class === "land" || !rec.bldgArea || L.ask > 8_000_000) continue;
    const r = E.executePurchase(g, parcels, L.bbl, L.ask, "savings", false, 1);
    if (!r.err) { g = r.s; break; }
  }
  let quiet = null;
  for (let m = 0; m < 24 && !quiet; m++) {
    for (const r of g.rivals) {
      if (r.failedM !== undefined || r.bbls.length < 2 || !r.sheet) continue;
      r.sheet.secrecy = 100;
      if (m % 3 === 0) { r.cash = -Math.max(2_000_000, (r.aum ?? 0) * 0.05); r.uncalled = 0; r.distributed = 0; }
    }
    g = E.advanceMonth(g, parcels, bbls, adjacency);
    if (g.gameOver) g = { ...g, gameOver: null, cash: 40e6 };
    quiet = g.listings.find((l) => l.quietFrom && l.earlyUntilM > g.month);
  }
  ok("a firm under pressure offers you a building privately, before the tape", !!quiet,
    quiet ? `${quiet.quietFrom}, ${quiet.earlyUntilM - g.month} months to decide` : "no quiet call in two years of squeezed firms");
  if (quiet) {
    const rec = E.resolveRec(parcels, g, quiet.bbl);
    const v = E.conveyedValue(g, rec, quiet.bbl, true);
    ok("priced under what it would appraise at", quiet.ask < v * 1.0, `${Math.round(100 * quiet.ask / v)}% of the deed's value`);
  }
}
{
  // A FAMILY WITH A GRUDGE IN IT SPLITS THE BOOK — and the loans go with the buildings.
  let g = E.newGame(12007, parcels);
  const fam = g.rivals.filter((r) => r.sheet && r.bbls.length >= 4).sort((a, b) => b.bbls.length - a.bbls.length)[0];
  fam.style = "family"; fam.profile = "dynasty"; fam.sheet.grudge = 95; fam.genM = -400; fam.stressMs = 0;
  const n0 = g.rivals.length, b0 = fam.bbls.length;
  for (let k = 0; k < 60 && g.rivals.length === n0; k++) {
    g.month = 8 + 12 * k; fam.stressMs = 0;
    E.tickCorporate(g, parcels);
  }
  const twin = g.rivals.length > n0 ? g.rivals[g.rivals.length - 1] : null;
  ok("the heirs split the book", !!twin && twin.bbls.length + fam.bbls.length === b0, twin ? `${fam.name} ${fam.bbls.length} · ${twin.name} ${twin.bbls.length}` : "no split");
  if (twin) {
    const sum = (r) => Object.values(g.cityLoans ?? {}).filter((x) => x.obligorId === r.id).reduce((a, x) => a + x.balance, 0) + (r.lineBal ?? 0);
    ok("each branch owes exactly its own loans", Math.abs(sum(twin) - twin.debt) <= 2 && Math.abs(sum(fam) - fam.debt) <= 2
      && Object.values(g.cityLoans ?? {}).every((x) => x.obligorId !== twin.id || twin.bbls.includes(x.bbl)));
    ok("and the two branches are feuding", twin.feud === fam.id && fam.feud === twin.id);
  }
}

console.log(fails ? `\n${fails} FAILED` : "\nall clear");
process.exit(fails ? 1 : 0);
