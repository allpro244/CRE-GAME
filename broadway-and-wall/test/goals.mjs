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
// A GOAL SET MID-RUN COUNTS FROM WHEN IT WAS SET.
const late = { ...g0, month: 240, delivered: 7 };
const dev = { ...late, goal: E.newGoal("developer", 240, late) };
check(E.goalVerdict(dev) === null && E.goalProgress(dev).text === "0 of 15 delivered", `Developer set with 7 on the record starts at 0 (${E.goalProgress(dev).text})`);
check(E.goalVerdict({ ...dev, delivered: 22 }) === "done", "fifteen more meet it");
const bld = { ...late, goal: E.newGoal("builder", 240, late) };
check(E.goalVerdict(bld) === null, "Builder set late is not met by deliveries already made");
// Which goals are open: a firm already worth $120M is not offered $100M.
const rich = { ...late, nwHistory: [...late.nwHistory, 120e6] };
const open = E.goalsOpen(rich, parcels).map((d) => d.id);
check(!open.includes("nw100") && open.includes("nw500"), `$100M is not offered to a $120M firm; $500M is (${open.join(", ")})`);
// Manager: a fund raised after the goal, settled and not failed.
const mg = { ...late, goal: E.newGoal("manager", 240, late) };
check(E.goalProgress(mg).share === 0, "Manager with no fund reads 0");
const fund = { raisedM: 250, size: 50e6, uncalled: 0, cash: 0, called: 40e6, distributed: 30e6 };
check(E.goalProgress({ ...mg, fund }).share === 0.5 && E.goalVerdict({ ...mg, fund }) === null, `a live fund is half way (${E.goalProgress({ ...mg, fund }).text})`);
check(E.goalVerdict({ ...mg, fund: { ...fund, settled: true } }) === "done", "a fund returned meets it");
check(E.goalVerdict({ ...mg, fund: { ...fund, settled: true, failed: true } }) === null, "a failed fund does not");
check(E.goalProgress({ ...mg, fund: { ...fund, raisedM: 100, settled: true } }).share === 0, "a fund raised before the goal was set does not count");

console.log(bad ? `\n${bad} FAILED` : "\nall clear");
process.exit(bad ? 1 : 0);
