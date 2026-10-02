// WHAT TENANTS ASK FOR, MEASURED. Every LOI the engine writes against a
// player-held commercial book, as months of face rent per year of term.
//
//   node test/ti-probe.mjs            SEEDS=1,2 HZ=240
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { leaseAtMarket } from "./leasepolicy.mjs";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const SEEDS = (process.env.SEEDS ?? "550991,12007,73303").split(",").map(Number);
const HZ = Number(process.env.HZ ?? 240);

const seen = new Map();
for (const seed of SEEDS) {
  const { parcels: P0, bbls } = loadCity(0, E.normalizeParcels);
  const parcels = JSON.parse(JSON.stringify(P0));
  let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  for (let m = 0; m < HZ; m++) {
    g = E.advanceQuarter(g, parcels, bbls, null);
    if (g.gameOver) g = { ...g, gameOver: null };
    g = { ...g, cash: Math.max(g.cash, 400e6) };
    if (Object.keys(g.holdings).length < 14 && m % 3 === 0) {
      for (const L of g.listings ?? []) {
        const rec = E.resolveRec(parcels, g, L.bbl);
        if (!rec || rec.class === "land" || rec.class === "multifamily" || !rec.bldgArea || g.holdings[L.bbl]) continue;
        const r = E.executePurchase(g, parcels, L.bbl, L.ask, null, false, 0);
        if (r?.s?.holdings[L.bbl]) {
          g = r.s;
          // SHELL=1 marks every other purchase as undelivered shell, so the
          // first-generation allowance can be read against the second.
          if (process.env.SHELL && Object.keys(g.holdings).length % 2) {
            const h = g.holdings[L.bbl];
            h.shellSf = {};
            for (const u of E.leasableUses(rec)) if (u !== "multifamily") h.shellSf[u] = Math.round(E.useRentableSf(rec, u));
          }
          break;
        }
      }
    }
    for (const l of g.lois ?? []) {
      if (seen.has(`${seed}:${l.id}`)) continue;
      const h = g.holdings[l.bbl];
      const t = l.tenantIdx != null ? h?.tenants?.[l.tenantIdx] : null;
      seen.set(`${seed}:${l.id}`, {
        kind: l.kind, use: l.use, rent: l.rentPsf, ti: l.tiPsf, term: l.termM, free: l.freeM ?? 0,
        tenure: t ? (g.month - t.startM) / 12 : null, costIdx: g.econ.costIdx,
        openTi: l.openTiPsf, shell: !!(h?.shellSf?.[l.use]), credit: l.credit, spec2: l.demiseSf, sf: l.sf, conc: E.concessionPressure(g.econ, l.use ?? 'office'), spec: !!h?.specSuites, dark: h?.darkMs ?? 0,
      });
    }
    g = leaseAtMarket(E, g, parcels);
  }
}
const rows = [...seen.values()];
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) * p)] : NaN; };
console.log(`\n${rows.length} letters\n`);
console.log("kind       use          n   TI$/sf p50  TI mo/yr p25/p50/p75   TI mo total p50  term p50  free p50  TI/costIdx p50");
for (const kind of ["new", "renewal", "expansion"]) for (const use of ["office", "retail", "industrial"]) {
  const r = rows.filter((x) => x.kind === kind && x.use === use && x.rent > 0);
  if (!r.length) continue;
  const moYr = r.map((x) => (x.ti / x.rent) * 12 / Math.max(1, x.term / 12));
  const mo = r.map((x) => (x.ti / x.rent) * 12);
  console.log(`${kind.padEnd(10)} ${use.padEnd(11)} ${String(r.length).padStart(4)}  ${q(r.map((x) => x.ti), 0.5).toFixed(1).padStart(8)}   ${q(moYr, .25).toFixed(2)}/${q(moYr, .5).toFixed(2)}/${q(moYr, .75).toFixed(2)}           ${q(mo, .5).toFixed(1).padStart(5)}      ${q(r.map((x) => x.term), .5)}      ${q(r.map((x) => x.free), .5)}     ${q(r.map((x) => x.ti / x.costIdx), .5).toFixed(1)}`);
}
const ren = rows.filter((x) => x.kind === "renewal" && x.use === "office" && x.tenure != null);
for (const [lo, hi] of [[0, 4], [4, 8], [8, 15], [15, 99]]) {
  const r = ren.filter((x) => x.tenure >= lo && x.tenure < hi);
  if (r.length) console.log(`office renewal, tenure ${lo}-${hi}y: n=${r.length} TI mo total p50 ${q(r.map((x) => x.ti / x.rent * 12), .5).toFixed(2)}`);
}
for (const use of ["office", "retail"]) {
  const r = rows.filter((x) => x.use === use && x.kind === "new");
  console.log(`${use} new: rent p50 ${q(r.map((x) => x.rent), .5)}  costIdx p50 ${q(r.map((x) => x.costIdx), .5).toFixed(2)}  zero-TI share ${(r.filter((x) => x.ti === 0).length / r.length * 100).toFixed(0)}%`);
}

const no = rows.filter((x) => x.kind === "new" && x.use === "office");
console.log("office new conc p25/50/75", q(no.map(x=>x.conc),.25).toFixed(2), q(no.map(x=>x.conc),.5).toFixed(2), q(no.map(x=>x.conc),.75).toFixed(2), "spec share", no.filter(x=>x.spec).length/no.length, "term p25", q(no.map(x=>x.term),.25));
const z = no.filter(x=>x.ti===0); console.log("zero-TI: conc p50", q(z.map(x=>x.conc),.5).toFixed(2), "rent/ask?", z.length);

if (process.env.DUMP) for (const x of no.slice(0, 40)) console.log(JSON.stringify(x));

for (const sh of [false, true]) {
  const r = rows.filter((x) => x.kind === "new" && x.use === "office" && !!x.shell === sh && x.rent > 0);
  if (!r.length) continue;
  const moYr = r.map((x) => (x.ti / x.rent) * 12 / Math.max(1, x.term / 12));
  console.log(`new office ${sh ? "first-gen " : "second-gen"} n=${r.length} TI$ p50 ${q(r.map(x=>x.ti),.5)} mo/yr p50 ${q(moYr,.5).toFixed(2)} zero ${(r.filter(x=>x.ti===0).length/r.length*100).toFixed(0)}%`);
}
