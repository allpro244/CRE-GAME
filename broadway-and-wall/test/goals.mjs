// A GOAL IS DECIDED ONCE, FROM NUMBERS THE GAME ALREADY KEEPS.
//   pnpm engine && node test/goals.mjs
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels, bbls } = loadCity(0, E.normalizeParcels);
let bad = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`); if (!ok) bad++; };
console.log("\nGOALS — progress, met, missed\n");
const g0 = E.firstListings(E.newGame(5, parcels, 2_500_000), parcels, bbls);
const s = { ...g0, goal: E.newGoal("nw100", g0.month) };
check(E.goalVerdict(s) === null, "a fresh $2.5M firm has neither met nor missed $100M");
const p = E.goalProgress(s);
check(p && p.share > 0 && p.share < 0.1, `progress reads the stamped net worth (${p?.text})`);
check(E.goalVerdict({ ...s, nwHistory: [...s.nwHistory, 101e6] }) === "done", "past $100M it is met");
check(E.goalVerdict({ ...s, month: s.goal.deadlineM + 1 }) === "failed", "past the deadline short of it, missed");
check(E.goalVerdict({ ...s, goal: { ...s.goal, doneM: 10 }, nwHistory: [...s.nwHistory, 101e6] }) === null, "decided once: a met goal is not met again");
const b = { ...g0, goal: E.newGoal("builder", 0), delivered: 5 };
check(E.goalVerdict(b) === "done", "five deliveries meet Builder");
const st = { ...g0, goal: E.newGoal("street", 0), yearMarks: [{ y: 3, m: 47, nw: 1, rank: 1, of: 20, medianRival: 1, holdings: 1 }] };
check(E.goalVerdict(st) === "done", "first on a year mark meets Top of the street");
console.log(bad ? `\n${bad} FAILED` : "\nall clear");
process.exit(bad ? 1 : 0);
