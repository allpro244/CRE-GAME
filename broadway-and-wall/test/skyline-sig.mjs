// FINISHED STOCK MUST NOT CHANGE WHEN A CRANE GROWS.
//
// MapView used to fold construction height into one skyline signature, and
// setPlayerBuildings then remeshed every delivered tower. This is the
// identity the split lives on: stock is deliveries / bunting / style;
// jobs are the frames that move every month.
import { playerSkylineLayerSig } from "../src/map/skylineSig.mjs";

let bad = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`);
  if (!ok) bad++;
};

const stock = [
  { bbl: "100", cls: "office", heightM: 71, floors: 20, construction: false, year: 2030, cov: 0.8 },
  { bbl: "101", cls: "industrial", heightM: 14.2, floors: 2, construction: false, year: 2028, cov: 0.61 },
];
const job = (h) => ({ bbl: "200", cls: "office", heightM: h, floors: 24, construction: true, cov: 0.7 });

const a = [...stock, job(10.1)];
const b = [...stock, job(12.4)];

check(
  playerSkylineLayerSig(a, false) === playerSkylineLayerSig(b, false),
  "finished-stock signature ignores a construction frame growing 2.3 m",
);
check(
  playerSkylineLayerSig(a, true) !== playerSkylineLayerSig(b, true),
  "jobs signature moves when the frame grows",
);
check(
  playerSkylineLayerSig(a, false) !== "",
  "stock signature is non-empty when deliveries exist",
);
check(
  playerSkylineLayerSig([{ ...stock[0], fresh: true }], false)
    !== playerSkylineLayerSig(stock.slice(0, 1), false),
  "opening bunting is part of the stock picture",
);
check(
  playerSkylineLayerSig([{ ...stock[0], year: 2040 }], false)
    !== playerSkylineLayerSig(stock.slice(0, 1), false),
  "delivery year is part of the stock picture",
);
check(
  playerSkylineLayerSig([], false) === "" && playerSkylineLayerSig([], true) === "",
  "empty book is an empty signature on both layers",
);

console.log("");
process.exit(bad ? 1 : 0);
