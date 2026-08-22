// FLOORPLATE IDENTITY — stacks, blocks, and a rent-roll that conserves area.
//
//   pnpm engine && pnpm plates-blocks
//
// Phase 1 of LEASING_OVERHAUL_PLAN.md. A building is floors × plate. Vacant
// inventory is contiguous blocks. Σ tenants.sf + Σ blocks.sf == useSf.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

const { parcels, bbls } = loadCity(0, E.normalizeParcels);
let fails = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) { fails++; console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`); }
  else console.log(`PASS  ${name}${detail ? " — " + detail : ""}`);
};

const rec = {
  bbl: "testplate0001",
  address: "1 Test St",
  class: "office",
  bldgArea: 120_000,
  floors: 10,
  mix: { office: 1 },
  lotArea: 20_000,
  yearBuilt: 1998,
};
const stacks = E.stacksOf(rec);
ok("one office stack", stacks.length === 1 && stacks[0].floors === 10,
  `${stacks.length} stacks, ${stacks[0]?.floors} floors, plate ${Math.round(stacks[0]?.plateSf ?? 0)}`);
ok("plate is useSf / floors", Math.abs((stacks[0]?.plateSf ?? 0) - 12_000) < 1);

const g = E.firstListings(E.newGame(4242, parcels), parcels, bbls);
const h = {
  bbl: rec.bbl,
  boughtM: 0,
  costBasis: 1,
  loan: null,
  condition: "good",
  condIdx: 0.8,
  tenants: [],
  cfHistory: [],
};
E.genRentRoll(g, rec, h, false, false);
const ident = E.blockIdentity(rec, h);
ok("block identity holds after genRentRoll", ident.every((r) => r.ok),
  ident.map((r) => `${r.use} t=${Math.round(r.tenantSf)} b=${Math.round(r.blockSf)} u=${Math.round(r.useSf)}`).join("; "));
ok("tenants have floors", h.tenants.every((t) => t.floorLo >= 1 && t.floorHi >= t.floorLo),
  `${h.tenants.length} tenants, floors ${h.tenants.map((t) => `${t.floorLo}-${t.floorHi}`).join(",")}`);

// Migration: unstamped tenants get deterministic floors, no stream movement.
const stamped = structuredClone(h.tenants);
for (const t of h.tenants) { delete t.floorLo; delete t.floorHi; }
const before = g.streams?.leasing;
E.assignTenantFloors(rec, h.tenants);
ok("assignTenantFloors does not touch the leasing stream", g.streams?.leasing === before);
ok("restamp is stable", h.tenants.every((t, i) => t.floorLo === stamped[i].floorLo && t.floorHi === stamped[i].floorHi));

// City sample: every commercial holding we gift must conserve area.
let checked = 0, broken = 0;
const sample = E.firstListings(E.newGame(11, parcels), parcels, bbls);
for (const bbl of bbls.slice(0, 80)) {
  const r = E.resolveRec(parcels, sample, bbl);
  if (!r || !E.isCommercial(r)) continue;
  const hold = {
    bbl, boughtM: 0, costBasis: 1, loan: null, condition: "fair",
    condIdx: 0.7, tenants: [], cfHistory: [],
  };
  E.genRentRoll(sample, r, hold, false, false);
  const rows = E.blockIdentity(r, hold);
  checked++;
  if (!rows.every((x) => x.ok)) broken++;
}
ok("city sample conserves area", broken === 0, `${checked} buildings, ${broken} broken`);

// Mixed 2-storey shop + flats + a sliver office: both commercial uses
// must have a stack (they share grade) and the identity must hold.
{
  const mixed = {
    bbl: "testplate0002",
    address: "2 Test St",
    class: "multifamily",
    bldgArea: 6_211,
    floors: 2,
    mix: { retail: 0.42, multifamily: 0.3793, office: 0.2007 },
    lotArea: 3_000,
    yearBuilt: 1920,
  };
  const st = E.stacksOf(mixed);
  const uses = st.map((x) => x.use);
  ok("mixed sliver office still has a stack", uses.includes("office") && uses.includes("retail"),
    st.map((x) => `${x.use} ${x.floorLo}-${x.floorHi}`).join(", "));
  const hold = {
    bbl: mixed.bbl, boughtM: 0, costBasis: 1, loan: null, condition: "fair",
    condIdx: 0.7, tenants: [], cfHistory: [],
  };
  E.genRentRoll(sample, mixed, hold, false, false);
  const rows = E.blockIdentity(mixed, hold);
  ok("mixed sliver conserves area", rows.every((x) => x.ok),
    rows.map((r) => `${r.use} t=${Math.round(r.tenantSf)} b=${Math.round(r.blockSf)} u=${Math.round(r.useSf)}`).join("; "));
}

console.log(fails ? `\n${fails} FAILURE(S)` : "\nplates-blocks green");
process.exit(fails ? 1 : 0);
