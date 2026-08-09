// THE CLOCK MUST STOP BEFORE A DECISION EXPIRES OR A CAPITAL EVENT ARRIVES.
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
const keys = (s) => new Set(E.attentionItems(s).map((x) => x.key));

console.log("\nATTENTION / AUTO-ADVANCE SAFETY\n");

const base = E.newGame(4242, parcels);
base.month = 24;

{
  const g = structuredClone(base);
  g.lois = [{ id: "l1", name: "Anchor Tenant", expiresM: 26 }];
  g.asks = [{ id: "a1", name: "Shop Tenant", expiresM: 27 }];
  g.talks = {
    "100": { bbl: "100", sellerName: "Estate", theirPrice: 2_000_000, final: false },
    "101": { bbl: "101", sellerName: "Fund", theirPrice: 3_000_000, agreed: true, agreedPrice: 2_900_000, closeByM: 25 },
  };
  const k = keys(g);
  check(k.has("loi:l1"), "tenant LOI stops the clock");
  check(k.has("tenant-ask:a1"), "tenant relief request stops the clock");
  check([...k].some((x) => x.startsWith("talks:100:")), "seller counter stops the clock");
  check(k.has("contract:101"), "unfunded acquisition contract stops the clock");
}

{
  const g = structuredClone(base);
  g.holdings["200"] = {
    bbl: "200",
    tenants: [],
    loan: { maturityM: 36, sweep: true },
  };
  const k = keys(g);
  check(k.has("balloon:200:far"), "single-asset maturity gives twelve months' notice");
  check(k.has("sweep:200"), "single-asset covenant sweep stops the clock");
}

{
  const g = structuredClone(base);
  g.facility = {
    bbls: [],
    balance: 8_000_000,
    drawn: 9_000_000,
    ratePct: 7,
    lender: "Harbor National",
    productId: "facility",
    originM: 0,
    maturityM: 36,
    ioUntilM: 24,
    amortYears: 25,
    monthlyPmt: 60_000,
    minDSCR: 1.2,
    maxLTV: 0.7,
    recourse: true,
    breachedSince: 22,
    sweep: true,
  };
  const a = E.attentionItems(g);
  const k = new Set(a.map((x) => x.key));
  check(k.has("facility-balloon:far"), "portfolio facility maturity gives twelve months' notice");
  check(k.has("facility-sweep"), "portfolio facility breach stops the clock");
  check(a.some((x) => x.key === "facility-sweep" && x.label.includes("Harbor National")),
    "facility warning names the lender");
}

{
  const g = structuredClone(base);
  g.workouts = {
    "300": {
      bbl: "300", lender: "Receiver Trust", stage: "foreclosure",
      decideM: 27, saleM: 30, cure: 500_000,
    },
  };
  const a = E.attentionItems(g);
  check(a.some((x) => x.key.startsWith("workout:300:foreclosure")),
    "open foreclosure remains visible to auto-advance");
}

console.log("");
process.exit(bad ? 1 : 0);
