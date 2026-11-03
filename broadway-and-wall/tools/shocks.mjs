// SHOCK TESTS — paired twins for the fundamentals (SHOCK_TESTS_PLAN.md).
//
//   pnpm engine && node tools/shocks.mjs                     every shock, 3 seeds, 15 years after the shock
//   node tools/shocks.mjs --landing                          step 0: does each shock land (and hold)? short runs
//   node tools/shocks.mjs --only supply-office-up50,rates-up300 --seeds 11 --jobs 4
//   node tools/shocks.mjs --report <dir>                     re-grade saved runs, rewrite SHOCK_TESTS.md
//
// A REPORT, NOT A GATE. Same city, same seed, run twice: one copy shocked at
// year 10, the other not; every difference after that is the shock's. The
// opening's ten years are run once per seed and saved (both twins load the
// same snapshot, so they are identical by construction — and the month-zero
// hash is checked anyway). Injectors live in tools/shocks/*.mjs and follow two
// rules: they enter the world through agents (buildings, firms, households,
// the nation's rates and prices), never by writing a rent, a vacancy or a
// value; and they never draw from the engine's RNG.
//
// Each shock carries its scorecard: what should move, which way, about how
// much, read off the record. A result outside it is a finding to trace, never
// a dial to turn (CLAUDE.md).
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cpus } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..");
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 ? argv[i + 1] : d; };
const has = (n) => argv.includes("--" + n);

export const CLASSES = ["office", "retail", "industrial", "multifamily"];
export const SETTLE_M = Number(process.env.SETTLE_M ?? 120);   // the shock lands at year 10
const HORIZON_M = Number(process.env.HORIZON_M ?? 180);        // fifteen years read after it
const LANDING_M = 61;                                           // landing at +1, holding at +60

// ---------------------------------------------------------------- the shocks
async function loadShocks() {
  const dir = join(HERE, "shocks");
  const out = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".mjs")).sort()) {
    const mod = await import(pathToFileURL(join(dir, f)).href);
    for (const s of mod.SHOCKS ?? []) out.push({ ...s, file: f });
  }
  return out;
}

// ---------------------------------------------------------------- the recorder
// One row a month, citywide: what a research desk would chart.
function sumLenders(g, f) { let x = 0; for (const l of g.lenders ?? []) x += f(l) ?? 0; return x; }
function record(E, g, city, shocks, sample) {
  const e = g.econ, m = g.month;
  const row = { m, vac: {}, rent: {}, eff: {}, stock: {}, occupied: {}, starts: {}, pipeline: {}, cap: {}, trades: {}, val: {} };
  for (const k of CLASSES) {
    row.vac[k] = e.cityVac?.[k];
    row.rent[k] = e.rentIdx?.[k];
    row.eff[k] = e.effRentIdx?.[k] ?? e.rentIdx?.[k];
    row.stock[k] = e.stock?.[k];
    row.occupied[k] = e.occupied?.[k];
    row.starts[k] = e.starts?.[k] ?? 0;
    row.pipeline[k] = e.pipeline?.[k] ?? 0;
    row.cap[k] = e.capRate?.[k];
    row.trades[k] = (g.capTape ?? []).filter((p) => p.m === m && p.k === k && p.kind === "t").length;
  }
  // VALUES, read through the game's own appraiser, on a fixed sample of each
  // class's buildings (the same deeds in both twins, chosen at the snapshot):
  // the sum of their values today. A deed torn down reads zero, as it should.
  if (sample) for (const k of CLASSES) {
    let v = 0;
    for (const b of sample[k] ?? []) {
      const rec = E.resolveRec(city.parcels, g, b);
      if (!rec || rec.class === "land" || !(rec.bldgArea > 0)) continue;
      const h = g.holdings?.[b];
      v += E.assetValue(rec, e, h?.condition ?? E.initialCondition(rec), h?.condIdx) || 0;
    }
    row.val[k] = v;
  }
  row.cpi = e.cpi ?? 1; row.policy = e.nat?.policy; row.tenY = e.indexRate;
  row.jobs = e.jobs; row.pop = e.population; row.u = e.unemployment;
  row.land = e.landMkt; row.landIdx = e.landIdx; row.costIdx = e.costIdx; row.homePsf = e.homes?.psf;
  row.chargeOffs = sumLenders(g, (l) => l.chargeOffsTotal);
  row.bankFailed = (g.lenders ?? []).filter((l) => l.failedM !== undefined).length;
  row.listings = g.listings?.length ?? 0;
  row.distress = (g.listings ?? []).filter((l) => l.distress).length;
  // each shock's own probes, in every run, so a landing check can compare the twins
  row.probe = {};
  for (const s of shocks) for (const [name, fn] of Object.entries(s.probes ?? {})) {
    try { row.probe[`${s.id}.${name}`] = fn(g, city, E); } catch { row.probe[`${s.id}.${name}`] = NaN; }
  }
  return row;
}

// a state hash that ignores nothing: the twins must agree to the byte before the shock
const hashOf = (g) => createHash("sha256").update(JSON.stringify(g)).digest("hex").slice(0, 16);

// ---------------------------------------------------------------- one run (child process)
async function childRun() {
  const E = await import(pathToFileURL(join(APP, "test", ".engine.mjs")).href);
  const { makeCity } = await import(pathToFileURL(join(APP, "src", "citygen", "index.mjs")).href);
  const seed = Number(flag("seed")), id = flag("run"), out = flag("out"), months = Number(flag("months", HORIZON_M));
  const shocks = await loadShocks();
  const shock = id === "control" || id === "snapshot" ? null : shocks.find((s) => s.id === id);
  if (id !== "control" && id !== "snapshot" && !shock) throw new Error(`no shock ${id}`);
  const snapPath = join(out, `snap-${seed}.json`);
  const city = makeCity("somewhere", 1);
  E.normalizeParcels(city.parcels);
  const bbls = Object.keys(city.parcels);
  let g;
  if (id === "snapshot") {
    g = E.firstListings(E.newGame(seed, city.parcels), city.parcels, bbls);
    let resurrect = 0;
    for (let m = 1; m <= SETTLE_M; m++) {
      g = E.advanceMonth(g, city.parcels, bbls, city.adjacency);
      if (g.gameOver) { g = { ...g, gameOver: null, cash: 6e6 }; resurrect++; }
    }
    // the value sample: every fourth standing building of each class, in bbl order
    const sample = {};
    for (const k of CLASSES) sample[k] = bbls.filter((b) => { const r = E.resolveRec(city.parcels, g, b); return r && r.class === k && r.bldgArea > 0; }).filter((_, i) => i % 4 === 0);
    writeFileSync(snapPath, JSON.stringify({ seed, g, parcels: city.parcels, sample, resurrect }));
    console.log(JSON.stringify({ done: "snapshot", seed, hash: hashOf(g) }));
    return;
  }
  const snap = JSON.parse(readFileSync(snapPath, "utf8"));
  g = snap.g; city.parcels = snap.parcels;
  const h0 = hashOf(g);
  const ctx = { seed, bbls, adjacency: city.adjacency, at: g.month, notes: [] };
  // a shock defined against the counterfactual (e.g. the control's own policy rate + 3) reads its twin's
  // recorded path: controls run first (main), so the file is there; ctx.ctrl[i] is the control's state after i months
  if (shock?.needsControl) {
    const cp = join(out, `run-control-${seed}.json`);
    if (!existsSync(cp)) throw new Error(`${id} needs the control's run (${cp}) first`);
    ctx.ctrl = JSON.parse(readFileSync(cp, "utf8")).rows;
  }
  const rows = [record(E, g, city, shocks, snap.sample)];
  let resurrect = 0;
  const t0 = Date.now();
  for (let i = 0; i < months; i++) {
    // the shock lands at the snapshot month, before the first month runs on, and is held by its injector after each month
    if (shock) shock.inject(g, city, i, ctx, E);
    g = E.advanceMonth(g, city.parcels, bbls, city.adjacency);
    if (g.gameOver) { g = { ...g, gameOver: null, cash: 6e6 }; resurrect++; }
    rows.push(record(E, g, city, shocks, i % 3 === 2 ? snap.sample : null));
  }
  writeFileSync(join(out, `run-${id}-${seed}.json`), JSON.stringify({ id, seed, h0, months, resurrect, notes: ctx.notes, secs: (Date.now() - t0) / 1000, rows }));
  console.log(JSON.stringify({ done: id, seed, h0, secs: Math.round((Date.now() - t0) / 1000) }));
}

// ---------------------------------------------------------------- reading a scorecard
// probe keys are stored flat as "<shock id>.<name>", so they are looked up whole
// `startsYr.<class>`: the month's starts as a share of the class's standing stock, a year's pace —
// the builders' answer on a scale that does not need the control to have built anything
const startsYr = (row, k) => { const st = row.stock?.[k], sf = row.starts?.[k]; return st > 0 && Number.isFinite(sf) ? 12 * sf / st : undefined; };
const getPath = (row, p) => p.startsWith("probe.") ? row.probe?.[p.slice(6)]
  : p.startsWith("startsYr.") ? startsYr(row, p.slice(9))
  : p.split(".").reduce((o, k) => (o == null ? undefined : o[k]), row);
const WINDOWS = { impact: [1, 36], mid: [37, 96], late: [97, 180], all: [1, 180] };
const meanOf = (a) => { const b = a.filter(Number.isFinite); return b.length ? b.reduce((x, y) => x + y, 0) / b.length : NaN; };
/**
 * The twin difference of one observable over a window: in points (`pp`, for
 * rates and shares, ×100) or relative to the control's mean over the window
 * (`rel`). Rows without a reading (values are read quarterly) are skipped.
 */
/**
 * A COUNT OF LUMPY EVENTS NEEDS EVENTS. Starts are buildings: a month either
 * breaks ground on one or two or it does not. With n start-months in the
 * control's window the count's own error is about 1/sqrt(n) of it (Poisson):
 * over 45% below five, wider than the narrowest band a starts row grades
 * against (a fall of 30%), so a twin difference of one or two buildings cannot
 * tell a response from luck. Run 1's "apartment starts ROSE 425%" under the
 * construction-cost shock was one seed whose control broke ground in four
 * months of sixty (6k sf on a 2.8M sf stock). Such a reading is NO DATA.
 */
export const MIN_EVENTS = 5;
export function effect(ctrl, treat, obs, unit, win, minEvents = 0) {
  const [a, b] = WINDOWS[win] ?? WINDOWS.impact;
  const d = [], c = [];
  let events = 0;
  for (let i = a; i <= Math.min(b, ctrl.length - 1, treat.length - 1); i++) {
    const x = getPath(ctrl[i], obs), y = getPath(treat[i], obs);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    d.push(y - x); c.push(x);
    if (x > 0) events++;
  }
  if (!d.length || events < minEvents) return NaN;
  if (unit === "pp") return 100 * meanOf(d);
  // a relative effect on a control that is (nearly) nothing is not a measurement: starts sit at zero for years
  const base = Math.abs(meanOf(c)), ref = Math.max(...c.map(Math.abs));
  return base > 1e-6 && base > 0.05 * ref ? meanOf(d) / base : NaN;
}
function peakOf(ctrl, treat, obs, unit) {
  let best = 0, at = 0;
  const base = Math.max(1e-9, Math.abs(meanOf(ctrl.slice(1, 97).map((r) => getPath(r, obs)))));
  // within the first eight years: past that, twins drift apart from compounding alone (econaudit's lesson)
  for (let i = 1; i < Math.min(ctrl.length, treat.length, 97); i++) {
    const x = getPath(ctrl[i], obs), y = getPath(treat[i], obs);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const v = unit === "pp" ? 100 * (y - x) : (y - x) / base;
    if (Math.abs(v) > Math.abs(best)) { best = v; at = i; }
  }
  return { peak: best, at };
}
/**
 * One expectation's verdict. `sign` is the direction the record says; `lo`/`hi`
 * (same unit, signed) the range it says. NO RESPONSE under `tiny` (2pp or 2%).
 */
function judge(x, ex) {
  if (!Number.isFinite(x)) return "NO DATA";   // also: a relative effect on a control near zero
  const tiny = ex.tiny ?? (ex.unit === "pp" ? 0.5 : 0.02);
  if (ex.sign === 0) return Math.abs(x) <= (ex.hi ?? tiny * 2) ? "RIGHT" : "SPILLS";
  if (Math.abs(x) < tiny) return "NO RESPONSE";
  if (Math.sign(x) !== Math.sign(ex.sign)) return "BACKWARDS";
  if (ex.lo !== undefined && ex.hi !== undefined) {
    const [lo, hi] = [Math.min(ex.lo, ex.hi), Math.max(ex.lo, ex.hi)];
    if (x < lo || x > hi) return "WRONG SIZE";
  }
  return "RIGHT";
}
// NO DATA (a control near zero, e.g. a class nobody builds) is reported but does not set the shock's verdict
const RANK = { "DID NOT LAND": 6, "BACKWARDS": 5, "NO RESPONSE": 4, "SPILLS": 3, "WRONG SIZE": 2, "RIGHT": 0, "NO DATA": -1 };
const med = (a) => { const b = a.filter(Number.isFinite).sort((x, y) => x - y); return b.length ? (b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2) : NaN; };
const fmt = (x, unit) => !Number.isFinite(x) ? "—" : unit === "pp" ? `${x >= 0 ? "+" : ""}${x.toFixed(1)}pp` : `${x >= 0 ? "+" : ""}${(100 * x).toFixed(1)}%`;

// a small chart: control and shocked, one observable, as an inline SVG file
function chart(path, title, ctrl, treat, obs, scale = 1) {
  const W = 520, H = 160, P = 28;
  const xs = (arr) => arr.map((r) => getPath(r, obs) * scale);
  const series = ctrl.map((c, i) => [xs(ctrl)[i], xs(treat)[i]]);
  const vals = series.flat().filter(Number.isFinite);
  if (!vals.length) return false;
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const pt = (i, v) => `${(P + (i / Math.max(1, ctrl.length - 1)) * (W - 2 * P)).toFixed(1)},${(H - P - ((v - lo) / span) * (H - 2 * P)).toFixed(1)}`;
  const line = (j) => series.map((s, i) => (Number.isFinite(s[j]) ? pt(i, s[j]) : null)).filter(Boolean).join(" ");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="sans-serif" font-size="11">
<rect width="${W}" height="${H}" fill="#fff"/><text x="${P}" y="14" fill="#222">${title}</text>
<line x1="${P}" y1="${H - P}" x2="${W - P}" y2="${H - P}" stroke="#bbb"/><line x1="${P}" y1="${P}" x2="${P}" y2="${H - P}" stroke="#bbb"/>
<text x="2" y="${P + 4}" fill="#666">${hi.toPrecision(3)}</text><text x="2" y="${H - P}" fill="#666">${lo.toPrecision(3)}</text>
<text x="${P}" y="${H - 8}" fill="#666">shock (yr 10)</text><text x="${W - P - 40}" y="${H - 8}" fill="#666">+15 yrs</text>
<polyline fill="none" stroke="#8a8a8a" stroke-width="1.5" points="${line(0)}"/><polyline fill="none" stroke="#c0392b" stroke-width="1.8" points="${line(1)}"/>
<text x="${W - P - 150}" y="14" fill="#8a8a8a">control</text><text x="${W - P - 95}" y="14" fill="#c0392b">shocked</text></svg>`;
  writeFileSync(path, svg);
  return true;
}

// ---------------------------------------------------------------- the report
async function report(dir, landingOnly) {
  const shocks = await loadShocks();
  const runs = new Map();
  for (const f of readdirSync(dir).filter((x) => /^run-.*\.json$/.test(x))) {
    const r = JSON.parse(readFileSync(join(dir, f), "utf8"));
    runs.set(`${r.id}|${r.seed}`, r);
  }
  const seeds = [...new Set([...runs.values()].map((r) => r.seed))].sort((a, b) => a - b);
  const chartDir = join(APP, "docs", "shocks");
  if (!landingOnly) mkdirSync(chartDir, { recursive: true });
  const L = [], findings = [];
  L.push(`# SHOCK TESTS — results`, ``,
    `Generated by \`tools/shocks.mjs\` (plan: SHOCK_TESTS_PLAN.md). Every number is on a GENERATED city. Twins: the same town and seed, one shocked at year 10, both run 15 years on; every difference is the shock's. Seeds ${seeds.join(", ")}; effects are the median across seeds. Windows: impact = years 0-3 after the shock, mid = 3-8, late = 8-15. \`pp\` = percentage points; \`%\` = relative to the control's mean over the window.`, ``,
    `Verdicts: **RIGHT** (direction and size inside the record's range) · **WRONG SIZE** · **BACKWARDS** · **NO RESPONSE** · **SPILLS** (moved where it should not) · **DID NOT LAND** (the injection did not take, so nothing else about the shock means anything).`, ``);
  const summary = [];
  for (const s of shocks) {
    const per = seeds.map((sd) => ({ sd, c: runs.get(`control|${sd}`), t: runs.get(`${s.id}|${sd}`) })).filter((x) => x.c && x.t);
    if (!per.length) continue;
    const twinOk = per.every((x) => x.c.h0 === x.t.h0);
    const lands = per.map((x) => (s.land ? s.land(x.c.rows, x.t.rows) : { ok: true, msg: "no landing check" }));
    const holds = per.map((x) => (s.hold && x.t.rows.length > 60 ? s.hold(x.c.rows, x.t.rows) : null)).filter(Boolean);
    const landed = twinOk && lands.every((l) => l.ok) && holds.every((h) => h.ok);
    const rowsOut = [];
    let worst = landed ? "RIGHT" : "DID NOT LAND";
    if (!landingOnly) for (const ex of s.expect ?? []) {
      const xs = per.map((x) => effect(x.c.rows, x.t.rows, ex.obs, ex.unit, ex.win ?? "impact", ex.minEvents ?? (ex.obs.startsWith("starts.") ? MIN_EVENTS : 0)));
      const v = med(xs), j = landed ? judge(v, ex) : "—";
      const pk = per.map((x) => peakOf(x.c.rows, x.t.rows, ex.obs, ex.unit));
      rowsOut.push(`| ${ex.label ?? ex.obs} | ${ex.win ?? "impact"} | ${fmt(v, ex.unit)} (${xs.map((x) => fmt(x, ex.unit)).join(", ")}) | peak ${fmt(med(pk.map((p) => p.peak)), ex.unit)} at ${Math.round(med(pk.map((p) => p.at)) / 12 * 10) / 10}y | ${ex.want} | **${j}** |`);
      if (landed && RANK[j] > RANK[worst]) worst = j;
      if (landed && j !== "RIGHT") findings.push({ rank: RANK[j], text: `**${s.title}** — ${ex.label ?? ex.obs}: ${fmt(v, ex.unit)} (${ex.win ?? "impact"}), expected ${ex.want}. ${j}.${ex.trace ? ` Trace: ${ex.trace}` : ""}` });
    }
    if (!landed) findings.push({ rank: 6, text: `**${s.title}** — DID NOT LAND: ${[!twinOk ? "twins differ before the shock" : "", ...lands.filter((l) => !l.ok).map((l) => l.msg), ...holds.filter((h) => !h.ok).map((h) => h.msg)].filter(Boolean).join("; ")}` });
    summary.push(`| ${s.group} | ${s.title} | **${worst}** |`);
    L.push(`## ${s.title}`, ``, s.what ? `${s.what}` : "", ``);
    L.push(`- Twins identical before the shock: ${twinOk ? "yes" : "**NO**"} · landing: ${lands.map((l) => l.msg).join(" / ")}${holds.length ? ` · holding: ${holds.map((h) => h.msg).join(" / ")}` : ""}`);
    const notes = [...new Set(per.flatMap((x) => x.t.notes ?? []))];
    if (notes.length) L.push(`- Injector notes: ${notes.slice(0, 6).join("; ")}`);
    if (s.sources) L.push(`- Record: ${s.sources}`);
    L.push(``);
    if (!landingOnly && rowsOut.length) {
      L.push(`| observable | window | effect, median (by seed) | peak | the record says | verdict |`, `|---|---|---|---|---|---|`, ...rowsOut, ``);
      const x = per[0];
      for (const [i, ch] of (s.charts ?? []).entries()) {
        const file = `${s.id}-${i}.svg`;
        if (chart(join(chartDir, file), `${ch.title} — seed ${x.sd}`, x.c.rows, x.t.rows, ch.obs, ch.scale ?? 1)) L.push(`![${ch.title}](docs/shocks/${file})`);
      }
      L.push(``);
    }
  }
  const head = [`## Summary`, ``, `| group | shock | verdict |`, `|---|---|---|`, ...summary, ``];
  findings.sort((a, b) => b.rank - a.rank);
  const fl = [`## Findings, worst first`, ``, ...(findings.length ? findings.map((f, i) => `${i + 1}. ${f.text}`) : ["None."]), ``];
  const text = [...L.slice(0, 6), ...head, ...fl, ...L.slice(6)].join("\n");
  const outPath = landingOnly ? join(dir, "LANDING.md") : join(APP, "SHOCK_TESTS.md");
  writeFileSync(outPath, text);
  console.log(`wrote ${outPath}`);
  console.log(head.join("\n"));
}

// ---------------------------------------------------------------- the orchestrator
async function main() {
  if (argv.includes("--run")) return childRun();
  if (has("report")) return report(flag("report"), has("landing"));
  const landing = has("landing");
  const seeds = flag("seeds", landing ? "11" : "11,22,33").split(",").map(Number);
  const shocks = (await loadShocks()).filter((s) => !flag("only") || flag("only").split(",").includes(s.id));
  const out = flag("out", join(APP, "..", "..", `shocks-${landing ? "landing" : "full"}`));
  mkdirSync(out, { recursive: true });
  const jobs = Number(flag("jobs", Math.max(1, cpus().length)));
  const months = landing ? LANDING_M : HORIZON_M;
  const child = (args) => new Promise((res, rej) => {
    const p = spawn(process.execPath, [fileURLToPath(import.meta.url), ...args], { stdio: ["ignore", "pipe", "inherit"] });
    let s = ""; p.stdout.on("data", (d) => (s += d));
    p.on("exit", (code) => (code === 0 ? res(s.trim()) : rej(new Error(`${args.join(" ")} exited ${code}`))));
  });
  const pool = async (tasks) => {
    const q = [...tasks]; const done = [];
    await Promise.all(Array.from({ length: Math.min(jobs, q.length) }, async () => {
      while (q.length) { const t = q.shift(); try { const r = await child(t); console.log(r); done.push(r); } catch (e) { console.log(`FAILED ${e.message}`); } }
    }));
    return done;
  };
  const t0 = Date.now();
  console.log(`shocks: ${shocks.length} · seeds ${seeds.join(",")} · ${months} months after a ${SETTLE_M}-month opening · ${jobs} jobs · out ${out}`);
  await pool(seeds.filter((sd) => has("fresh") || !existsSync(join(out, `snap-${sd}.json`))).map((sd) => ["--run", "snapshot", "--seed", String(sd), "--out", out]));
  // the controls first: a shock defined against its twin's path reads it from disk
  await pool(seeds.map((sd) => ["--run", "control", "--seed", String(sd), "--out", out, "--months", String(months)]));
  const tasks = [];
  for (const sd of seeds) for (const s of shocks) tasks.push(["--run", s.id, "--seed", String(sd), "--out", out, "--months", String(months)]);
  await pool(tasks);
  console.log(`all runs in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  await report(out, landing);
}
await main();
