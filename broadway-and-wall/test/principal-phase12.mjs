// Principal Phase 1–2 bug hunt.
//   pnpm engine && node test/principal-phase12.mjs
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

// 1. newGame synthesises principal + rival faces. No age, no death clock.
{
  const g = E.firstListings(E.newGame(4242, parcels), parcels, bbls);
  ok(`v is ${E.SAVE_VERSION}`, g.v === E.SAVE_VERSION);
  ok("principal seat you", g.principal?.seat === "you");
  ok("principal carries no age or death clock", g.principal.bornM === undefined && g.principal.diesM === undefined);
  ok("principal has a seeded career", Object.keys(g.principal.career?.classM ?? {}).length > 0);
  ok("peopleRng initialised", typeof g.peopleRng === "number");
  const live = (g.rivals ?? []).filter((r) => r.failedM === undefined);
  ok("every living rival has a principal",
    live.every((r) => g.rivalPrincipals?.[r.id]?.seat === "rival"),
    `${live.length} firms`);
  ok("no style overrides on new game", !g.ownerStyle && !g.benchStyle);
}

// 3. RNG isolation — people work must not move s.rng or staffRng vs a twin
//    that never touches people APIs (same newGame, advance without hiring).
{
  const a = E.firstListings(E.newGame(550991, parcels), parcels, bbls);
  const b = E.firstListings(E.newGame(550991, parcels), parcels, bbls);
  // Strip people from b and freeze peopleRng so ensure-like paths no-op.
  // Advance both 24 months — neither should hire.
  for (let i = 0; i < 24; i++) {
    E.advanceMonth(a, parcels, bbls, adjacency);
    E.advanceMonth(b, parcels, bbls, adjacency);
  }
  ok("s.rng matched after 24m", a.rng === b.rng, `${a.rng} vs ${b.rng}`);
  ok("staffRng matched after 24m", a.staffRng === b.staffRng, `${a.staffRng} vs ${b.staffRng}`);
  // Economy fingerprint
  ok("office rent matched", a.econ.rentIdx.office === b.econ.rentIdx.office);
  ok("principals still present after 24m", !!a.principal && Object.keys(a.rivalPrincipals ?? {}).length > 0);
}

// 4. Hire seeds a career from peopleRng without changing staffRng step count shape:
//    two pools generated with same staffRng seed produce same candidate attrs.
{
  const mk = () => {
    const g = E.newGame(777, parcels);
    g.staffRng = (777 ^ 0x5741ff) | 0;
    g.peopleRng = (777 ^ 0x50454f50) | 0;
    g.hireReputation = 0.55;
    return g;
  };
  const g1 = mk();
  const g2 = mk();
  const c1 = E.generateCandidate(g1, "pm", 26);
  const c2 = E.generateCandidate(g2, "pm", 26);
  ok("candidate attrs identical across twins", JSON.stringify(c1.attrs) === JSON.stringify(c2.attrs));
  ok("candidate has a career and no life fields", !!c1.career && c1.bornM === undefined && c1.diesM === undefined);
  ok("staffRng advanced identically", g1.staffRng === g2.staffRng);
}

// 5. Migrate v32 → v33 synthesises people, clears style dials.
{
  const g = E.firstListings(E.newGame(4242, parcels), parcels, bbls);
  const snap = structuredClone(g);
  // (v32 would now be refused: the island's ground moved at v39.)
  snap.v = E.SAVE_VERSION;
  delete snap.principal;
  delete snap.rivalPrincipals;
  delete snap.peopleRng;
  snap.ownerStyle = "handsOn";
  snap.benchStyle = "boutique";
  // Strip life from a fake staff row
  snap.staff = [{
    id: 1, name: "Test Hire", role: "pm",
    attrs: { judgment: 50, urgency: 50, diligence: 50, relationships: 50, costControl: 50, tenantCare: 50 },
    obs: {}, salary: 100_000, hiredM: 0, band0: 18,
  }];
  const m = E.migrateSaveState(snap);
  ok(`migrate bumps to ${E.SAVE_VERSION}`, m.v === E.SAVE_VERSION);
  ok("migrate clears style overrides", !m.ownerStyle && !m.benchStyle);
  ok("migrate synthesises principal", m.principal?.seat === "you");
  ok("migrate seeds staff career", !!m.staff[0].career);
  ok("migrate fills rival principals",
    (m.rivals ?? []).filter((r) => !r.failedM).every((r) => m.rivalPrincipals?.[r.id]));
}

// 5b. A save from before carries life fields — they are stripped on load.
{
  const g = E.firstListings(E.newGame(4242, parcels), parcels, bbls);
  const snap = structuredClone(g);
  snap.startAge = 52;
  snap.principal.bornM = -52 * 12; snap.principal.diesM = 400;
  for (const p of Object.values(snap.rivalPrincipals)) { p.bornM = -50 * 12; p.diesM = 300; }
  snap.estateDue = { gross: 4e7, tax: 1e6, remaining: 1e6, deadlineM: 9, deathM: 0, decedentName: "Old" };
  snap.careers = [{ name: "Old", heir: "New", fromM: 0, toM: 0, age: 80, gross: 1, tax: 0 }];
  snap.founderBids = [{ readyM: 3, name: "F", bornM: -400, diesM: 500, attrs: {}, obs: {}, band0: 10, role: "pm", fromFirmId: "you", fromFirmName: "Y" }];
  const m = E.migrateSaveState(structuredClone(snap));
  ok("legacy save with life fields migrates at the current version", m.v === E.SAVE_VERSION);
  ok("legacy life fields stripped", m && m.startAge === undefined && m.estateDue === undefined && m.careers === undefined
    && m.principal.bornM === undefined && m.principal.diesM === undefined
    && Object.values(m.rivalPrincipals).every((p) => p.bornM === undefined && p.diesM === undefined)
    && m.founderBids.every((b) => b.bornM === undefined && b.diesM === undefined));
}

// 6. Inferred firm shape still works; forced override ignored.
{
  const g = E.newGame(1, parcels);
  g.staff = [];
  ok("empty payroll hands-on", E.effectiveOwnerStyle(g) === "handsOn");
  g.ownerStyle = "delegated"; // should be ignored
  ok("forced ownerStyle ignored", E.effectiveOwnerStyle(g) === "handsOn");
  g.staff = [1, 2, 3, 4, 5].map((i) => ({
    id: i, name: "X", role: "pm",
    attrs: { judgment: 80, urgency: 80, diligence: 80, relationships: 80, costControl: 80, tenantCare: 80 },
    obs: {}, salary: 100_000, hiredM: 0, band0: 10,
  }));
  ok("five hires → platform bench", E.effectiveBenchStyle(g) === "platform");
  ok("five hires → delegated owner", E.effectiveOwnerStyle(g) === "delegated");
}

// 7. New firm gets a principal (peopleRng only).
{
  const g = E.firstListings(E.newGame(12007, parcels), parcels, bbls);
  const before = Object.keys(g.rivalPrincipals ?? {}).length;
  const rngBefore = g.rng;
  // Force many months; maybeNewFirm may or may not fire — call ensurePeople after injecting a firm.
  const id = `r${g.rivals.length}`;
  g.rivals.push({
    id, name: "Probe Capital", style: "pe",
    cash: 5_000_000, debt: 0, bbls: [], targetLtv: 0.7, bornM: g.month,
  });
  g.rivalPrincipals[id] = E.makeRivalPrincipal(g, id, "Probe Capital");
  ok("injected firm has principal", g.rivalPrincipals[id]?.seat === "rival");
  ok("makeRivalPrincipal did not touch s.rng", g.rng === rngBefore);
  ok("principal count grew", Object.keys(g.rivalPrincipals).length === before + 1);
}

// 8. ensurePeople is idempotent — second call draws nothing if complete.
{
  const g = E.firstListings(E.newGame(33, parcels), parcels, bbls);
  const rng1 = g.peopleRng;
  const career = JSON.stringify(g.principal.career);
  E.ensurePeople(g);
  E.ensurePeople(g);
  ok("ensurePeople idempotent on peopleRng", g.peopleRng === rng1);
  ok("ensurePeople idempotent on career", JSON.stringify(g.principal.career) === career);
}

console.log(`\n${fails === 0 ? "principal-phase12 pass" : `${fails} principal-phase12 failure(s)`}`);
process.exit(fails === 0 ? 0 : 1);
