// THE SHEET'S STANDING ANSWERS — the quarter's leasing review and the relief rule.
//
//   pnpm engine && node test/sheet-review.mjs
//
// 1. sheetReview suggests moving a number that has come three points or more
//    off what the street is signing, and the attention list carries it once a
//    quarter;
// 2. the relief rule grants, declines or leaves a relief letter as written,
//    through answerAsk (same rent cut, term and legal fee as the button), and
//    never touches a surrender.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels, bbls } = loadCity(0, E.normalizeParcels);

let bad = 0;
const ok = (c, msg) => { console.log(`  ${c ? "OK  " : "FAIL"}  ${msg}`); if (!c) bad++; };

let g = structuredClone(E.firstListings(E.newGame(12007, parcels, 5_000_000), parcels, bbls));
const rec = bbls.map((b) => E.resolveRec(parcels, g, b)).find((r) => r && r.bldgArea > 8000 && r.class === "office" && !E.isCivicLand(g, r.bbl));
{
  const worth = E.assetValue(rec, g.econ, E.initialCondition(rec));
  const grade = E.gradeOf(g, rec);
  const h = { bbl: rec.bbl, boughtM: 0, costBasis: worth, assessed: worth, loan: null, condition: grade,
    condIdx: E.initialCondIdx(rec, 0, grade), service: 0, stance: 0, plan: 1, svcIdx: 0.55, tenants: [], cfHistory: [] };
  E.genRentRoll(g, rec, h, false, true);
  g.holdings[rec.bbl] = h;
  E.clearRivalClaims(g, rec.bbl);
}
const h = g.holdings[rec.bbl];

console.log("the quarter's review");
{
  const s = structuredClone(g);
  const street = E.marketClearingPct(s, "office");
  s.leasingPlan = E.starterPlan({ targetNePct: street + 0.10, patienceM: 12 });
  s.deskDigestPrev = { ...E.emptyDeskDigest(0), vacMonths: 20, signed: 2 };
  s.month = 3 * Math.max(1, Math.round(s.month / 3) + 1);
  const rev = E.sheetReview(s, parcels);
  ok(rev.length === 1 && rev[0].use === "office" && Math.abs(rev[0].suggest - Math.round(street * 100) / 100) < 1e-9,
    `ten points over the street with space sitting: move office to the street (${JSON.stringify(rev)})`);
  const it = E.attentionItems(s, parcels).find((a) => a.key.startsWith("sheet-review:"));
  ok(!!it && !it.soft, `it is a decision on the attention list: "${it?.label}"`);
  s.leasingPlan.sheet.office.targetNePct = street + 0.01;
  ok(E.sheetReview(s, parcels).length === 0, "a number within three points of the street is left alone");
  s.month += 1;
  s.leasingPlan.sheet.office.targetNePct = street + 0.10;
  ok(!E.attentionItems(s, parcels).some((a) => a.key.startsWith("sheet-review:")), "only at the quarter, not every month");
}

console.log("the relief rule");
const t = h.tenants[0];
const plant = (s, kind = undefined) => {
  s.asks = [{ id: 1, bbl: rec.bbl, name: t.name, tenantStartM: t.startM, sf: t.sf, currentPsf: t.rentPsf,
    askPsf: +(t.rentPsf * 0.9).toFixed(2), addM: 24, arrivedM: s.month, expiresM: s.month + 3, ...(kind ? { kind, giveSf: Math.round(t.sf / 3) } : {}) }];
  s.cash = 5e6;
};
const rule = { grantIfVacOver: 0.10, minCredit: 0, maxCutPct: 0.15, otherwise: "decline" };
{
  const s = structuredClone(g);
  plant(s);
  s.leasingPlan = { ...E.starterPlan(), reliefRule: rule };
  s.econ.cityVac = { ...s.econ.cityVac, office: 0.16 };
  const endM = t.endM;
  const leasing0 = (s.books ?? []).reduce((a, y) => a + (y.leasing ?? 0), 0);
  E.applyReliefRule(s, parcels);
  const tt = s.holdings[rec.bbl].tenants.find((x) => x.name === t.name);
  ok(!s.asks?.length && Math.abs(tt.rentPsf - t.rentPsf * 0.9) < 0.02 && tt.endM === endM + 24,
    `soft market, 10% cut: granted — rent $${t.rentPsf.toFixed(2)}→$${tt.rentPsf.toFixed(2)}, term +24 mo`);
  ok((s.books ?? []).reduce((a, y) => a + (y.leasing ?? 0), 0) > leasing0, "the legal fee went through the ledger");
}
{
  const s = structuredClone(g);
  plant(s);
  s.leasingPlan = { ...E.starterPlan(), reliefRule: rule };
  s.econ.cityVac = { ...s.econ.cityVac, office: 0.05 };
  E.applyReliefRule(s, parcels);
  const tt = s.holdings[rec.bbl].tenants.find((x) => x.name === t.name);
  ok(!s.asks?.length && tt.rentPsf === t.rentPsf && tt.strainedM === s.month, "tight market: declined, the rent stands, the tenant remembers");
}
{
  const s = structuredClone(g);
  plant(s);
  s.leasingPlan = { ...E.starterPlan(), reliefRule: { ...rule, otherwise: "mine" } };
  s.econ.cityVac = { ...s.econ.cityVac, office: 0.05 };
  E.applyReliefRule(s, parcels);
  ok(s.asks?.length === 1, "otherwise \"mine\": a letter the rule will not grant stays on your desk");
}
{
  const s = structuredClone(g);
  plant(s, "giveback");
  s.leasingPlan = { ...E.starterPlan(), reliefRule: rule };
  s.econ.cityVac = { ...s.econ.cityVac, office: 0.20 };
  E.applyReliefRule(s, parcels);
  ok(s.asks?.length === 1, "a surrender is never answered by the rule");
}

console.log(bad ? `\n${bad} FAILED` : "\nall clear");
process.exit(bad ? 1 : 0);
