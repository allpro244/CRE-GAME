// EVERY DEED IN TOWN HAS AN OWNER YOU CAN READ.
//
// The contract engine/ownership.ts exists to hold: point at any parcel on the
// map and you get a name, a balance sheet and an income statement. This
// harness is the thing that stops that quietly becoming untrue — an ownerless
// deed is invisible from the UI (it just renders nothing) and would survive
// any number of green runs.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels } = loadCity(0, E.normalizeParcels);

let bad = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`);
  if (!ok) bad++;
};
const usd = (n) => "$" + (n / 1e6).toFixed(1) + "M";

const ALL = Object.keys(parcels);
const run = (g, months) => {
  for (let i = 0; i < months; i++) {
    // A frozen world reports the month it died in, forever. See CLAUDE.md.
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
    g = E.advanceMonth(g, parcels, ALL, null);
  }
  return g;
};

console.log("\nOWNERSHIP — EVERY DEED HAS A LEGIBLE OWNER\n");

// ---------------------------------------------------------------- coverage
{
  const g = E.newGame(77_001, parcels);
  const bbls = Object.keys(parcels);
  let orphan = 0, byPlayer = 0, byFirm = 0, byHolder = 0, byCity = 0;
  const firstOrphans = [];
  for (const b of bbls) {
    if (g.holdings[b]) { byPlayer++; continue; }
    const v = E.ownerAt(g, parcels, b);
    if (!v) { orphan++; if (firstOrphans.length < 5) firstOrphans.push(b); continue; }
    if (v.publicOwner) byCity++;
    else if (v.operator) byFirm++;
    else byHolder++;
  }
  check(orphan === 0,
    `every one of ${bbls.length} deeds resolves to an owner (orphans: ${orphan}${firstOrphans.length ? " — " + firstOrphans.join(", ") : ""})`);
  console.log(`        player ${byPlayer} · firms ${byFirm} · private holders ${byHolder} · city ${byCity}`);

  // ...and every owner answers with a statement rather than a shrug.
  const owners = E.allOwners(g, parcels);
  const noSheet = owners.filter((o) => !o.sheet || !Number.isFinite(o.sheet.assets) || !Number.isFinite(o.sheet.equity));
  const noIncome = owners.filter((o) => !o.income || !Number.isFinite(o.income.net));
  check(noSheet.length === 0, `all ${owners.length} named owners carry a finite balance sheet`);
  check(noIncome.length === 0, `all ${owners.length} named owners carry a finite income statement`);
  check(owners.every((o) => o.book.length > 0), "no owner is listed without a deed to their name");

  const firms = owners.filter((o) => o.operator);
  const priv = owners.filter((o) => !o.operator);
  check(firms.length > 0 && priv.length > 0,
    `the register carries both kinds: ${firms.length} operating firms, ${priv.length} private holders`);
  const top = owners[0];
  console.log(`        largest owner in town: ${top.name} · ${top.book.length} deeds · ${usd(top.sheet.assets)} · ${top.operator ? "operator" : "holder"}`);
}

// ---------------------------------------------------------------- land
{
  const g = E.newGame(77_002, parcels);
  const dirt = Object.keys(parcels).filter((b) => {
    const r = parcels[b];
    return (r.class === "land" || !(r.bldgArea > 0)) && !g.holdings[b];
  });
  const named = dirt.filter((b) => E.ownerAt(g, parcels, b));
  check(dirt.length > 0 && named.length === dirt.length,
    `all ${dirt.length} vacant lots have a named owner (was: none of them did)`);
  // Institutions do not carry non-earning land in a book they report a yield on.
  const kinds = {};
  for (const b of dirt) {
    const v = E.ownerAt(g, parcels, b);
    if (v) kinds[v.kind] = (kinds[v.kind] ?? 0) + 1;
  }
  const instShare = (kinds.institution ?? 0) / Math.max(1, dirt.length);
  check(instShare < 0.15,
    `institutions hold almost no dirt (${(instShare * 100).toFixed(1)}% of vacant lots)`);
  console.log("        dirt by owner kind: " + Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(" · "));
}

// ---------------------------------------------------------------- the debt
{
  const g = E.newGame(77_003, parcels);
  const owners = E.allOwners(g, parcels).filter((o) => !o.operator);
  let assets = 0, debt = 0, clear = 0, n = 0;
  for (const o of owners) {
    assets += o.sheet.assets; debt += o.sheet.debt;
    if (o.sheet.debt === 0) clear++;
    n++;
  }
  const ltv = debt / Math.max(1, assets);
  // lenders.ts sizes every desk in town off a 55% SYSTEM_LTV for the WHOLE
  // market — operators included, and they run levered. The private half has to
  // sit below that or the aggregate the banks were sized against is a fiction.
  check(ltv > 0.15 && ltv < 0.50,
    `private register runs ${(ltv * 100).toFixed(1)}% aggregate LTV — under the 55% system figure the banks are sized off`);
  check(clear > 0 && clear < n,
    `${clear} of ${n} private holders own everything free and clear, and the rest carry paper`);

  const firms = E.allOwners(g, parcels).filter((o) => o.operator);
  let fa = 0, fd = 0;
  for (const o of firms) { fa += o.sheet.assets; fd += o.sheet.debt; }
  const fltv = fd / Math.max(1, fa);
  check(fltv > ltv, `operators are levered above the private stock (${(fltv * 100).toFixed(1)}% vs ${(ltv * 100).toFixed(1)}%)`);
  const blend = (debt + fd) / Math.max(1, assets + fa);
  console.log(`        whole-market LTV across both registers: ${(blend * 100).toFixed(1)}%  (lenders.ts assumes 55%)`);
}

// ---------------------------------------------------------------- statement
{
  const g = E.newGame(77_004, parcels);
  const owners = E.allOwners(g, parcels);
  // The statement has to be an identity, not a list of numbers near each other.
  const off = owners.filter((o) => {
    const i = o.income;
    return Math.abs((i.noi - i.leasing - i.capex - i.ga - i.interest - i.amort) - i.net) > 2;
  });
  check(off.length === 0, "every income statement foots: NOI less costs, debt service and overhead equals net");
  const eqOff = owners.filter((o) => Math.abs((o.sheet.assets - o.sheet.debt + o.sheet.cash) - o.sheet.equity) > 2);
  check(eqOff.length === 0, "every balance sheet foots: assets less debt plus cash equals equity");

  const earning = owners.filter((o) => o.sheet.assets > 0);
  const yields = earning.map((o) => o.income.noi / o.sheet.assets).sort((a, b) => a - b);
  const med = yields[Math.floor(yields.length / 2)];
  check(med > 0.02 && med < 0.12,
    `median owner's book yields ${(med * 100).toFixed(2)}% on assets — a property yield, not a rounding artefact`);
  const losing = owners.filter((o) => o.income.net < 0);
  console.log(`        ${losing.length} of ${owners.length} owners are cash-flow negative at today's marks`);
  // WHO IS UNDERWATER TELLS YOU WHETHER THE STATEMENT IS RIGHT. A land banker
  // paying interest on dirt that earns nothing is a real condition; half the
  // town losing money on let buildings is a modelling fault.
  const dirtOnly = losing.filter((o) => o.income.noi <= 0).length;
  const smallest = losing.filter((o) => o.sheet.assets < 1_500_000).length;
  console.log(`        of those, ${dirtOnly} earn no NOI at all (land) and ${smallest} hold under $1.5M`);
  // NOT A BAND ON HOW MANY ARE LOSING MONEY — that is a fact about the
  // economy's cap rates against its cost of debt, and hill-climbing it here
  // would be fitting the test rather than fixing the world (CLAUDE.md). What
  // IS assertable is that a levered, LET book covers what it borrowed: if the
  // median owner in town cannot service their own mortgage out of their own
  // NOI, the statement is wrong, not the city.
  const levered = owners.filter((o) => o.sheet.debt > 0 && o.income.noi > 0)
    .map((o) => o.income.noi / (o.income.interest + o.income.amort)).sort((a, b) => a - b);
  const medDscr = levered[Math.floor(levered.length / 2)];
  check(medDscr > 1.15,
    `median levered owner covers debt service ${medDscr.toFixed(2)}x out of NOI`);
}

// ---------------------------------------------------------------- one answer
{
  const g = run(E.newGame(77_009, parcels), 120);
  const owners = E.allOwners(g, parcels);

  // THE STREET TABLE AND THE REGISTER MUST NOT COME APART. Both print a firm's
  // net worth; the street table computes it as markRival's gross assets less
  // debt plus cash, and the register reads engine/ownership.ts. If those two
  // ever disagree the player is being shown one firm with two balance sheets —
  // the fault the street table itself had to fix once, when the league table,
  // the column and the drawer each derived equity their own way.
  let worst = 0, worstName = "";
  for (const o of owners.filter((x) => x.operator)) {
    const r = (g.rivals ?? []).find((x) => x.id === o.id);
    if (!r) continue;
    const m = E.markRival(g, parcels, r);
    const street = m.aum - r.debt + r.cash;
    const d = Math.abs(street - o.sheet.equity);
    if (d > worst) { worst = d; worstName = o.name; }
  }
  check(worst <= 2, `every firm's net worth is the same number on the street table and the register (worst gap $${worst.toFixed(2)}${worstName ? " on " + worstName : ""})`);

  // ...and the three doors onto an owner are the same owner.
  let mismatch = 0, missing = 0;
  for (const o of owners) {
    if (!E.ownerById(g, parcels, o.id)) { missing++; continue; }
    for (const b of o.book.slice(0, 4)) {
      const at = E.ownerAt(g, parcels, b);
      if (!at || at.id !== o.id) mismatch++;
    }
  }
  check(missing === 0, `every owner in the register can be looked up by id (${missing} could not)`);
  check(mismatch === 0, `every deed in a book resolves back to the owner holding it (${mismatch} did not)`);

  // A book that is all dirt is a real condition and it must not print as a
  // building portfolio: nothing to lease, no roof to fund.
  //
  // READ OFF THE DEEDS, not off the NOI. The first cut of this check called an
  // owner land-only when their NOI was zero or less, and six owners failed it
  // — every one of them holding real buildings whose operating costs and tax
  // exceed their rent, which is a marginal building and not a vacant lot. The
  // check was wrong, not the statement; a predicate that infers what somebody
  // owns from what it earns cannot tell a car park from a failing walk-up.
  const isDirt = (b) => {
    const rec = E.resolveRec(parcels, g, b);
    return !rec || rec.class === "land" || !(rec.bldgArea > 0);
  };
  const dirtOnly = owners.filter((o) => o.sheet.assets > 0 && o.book.every(isDirt));
  const wrong = dirtOnly.filter((o) => o.income.leasing > 1 || o.income.capex > 1);
  check(dirtOnly.length > 0 && wrong.length === 0,
    `the ${dirtOnly.length} land-only owners are charged no leasing and no capital plan (${wrong.length} were)`);

  // ...and the mirror of it: an owner holding buildings that lose money is a
  // real thing this city contains, and it is not the same condition.
  const marginal = owners.filter((o) => o.income.noi <= 0 && o.book.some((b) => !isDirt(b)));
  console.log(`        ${dirtOnly.length} owners hold nothing but dirt · ${marginal.length} hold buildings that do not cover their own costs`);
}

// ---------------------------------------------------------------- determinism
{
  const a = E.newGame(77_005, parcels);
  const b = E.newGame(77_005, parcels);
  const sig = (g) => E.allOwners(g, parcels).map((o) => `${o.id}:${o.name}:${o.book.length}:${o.sheet.debt}`).join("|");
  check(sig(a) === sig(b), "the register and its accounts are identical on two builds of the same town");

  // ...and reading them must not consume the stream. A view that drew from the
  // RNG would re-roll the century the first time a panel opened.
  const c = E.newGame(77_006, parcels);
  const d = E.newGame(77_006, parcels);
  E.allOwners(c, parcels);
  for (const bbl of Object.keys(parcels).slice(0, 200)) E.ownerAt(c, parcels, bbl);
  const after = (g) => { const x = run(g, 24); return `${x.cash}|${x.listings.length}|${x.news.length}`; };
  check(after(c) === after(d), "reading every owner's accounts does not touch the RNG stream");
}

// ---------------------------------------------------------------- over time
{
  let g = run(E.newGame(77_007, parcels), 240);
  const bbls = Object.keys(parcels);
  let orphan = 0;
  for (const b of bbls) {
    if (g.holdings[b]) continue;
    if (!E.ownerAt(g, parcels, b)) orphan++;
  }
  check(orphan === 0, `twenty years in, all ${bbls.length} deeds still resolve to an owner (orphans: ${orphan})`);
  const owners = E.allOwners(g, parcels);
  check(owners.every((o) => Number.isFinite(o.sheet.equity) && Number.isFinite(o.income.net)),
    "and every one of them still has a statement that is a number");
  const dead = owners.filter((o) => o.failedM !== undefined);
  console.log(`        year 20: ${owners.length} owners · ${owners.filter((o) => o.operator).length} firms (${dead.length} in receivership)`);
}

console.log(bad ? `\n${bad} FAILED\n` : "\nall good\n");
process.exit(bad ? 1 : 0);
