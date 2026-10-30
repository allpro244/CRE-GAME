// EVERY CLAMP IN THE ENGINE, AND WHICH OF THEM ACTUALLY BIND.
//
//   node tools/rail-audit.mjs                   2 towns x 30 years, no player (~10-15 min on 4 cores)
//   SEEDS=3 YEARS=50 node tools/rail-audit.mjs  more of both
//   BIND=0.02 node tools/rail-audit.mjs         a stricter "load-bearing"
//   YEARS=2 CHECK=1 OUT=- node tools/rail-audit.mjs   a quick look (stdout only)
//   TALLY=/tmp/t.json …  then  FROM=/tmp/t.json …    save the counts / re-report without playing
//
// A REPORT, NOT A GATE. It writes RAIL_AUDIT.md and prints a summary.
//
// CLAUDE.md, fake number five: "A clamp that stops a number going somewhere
// absurd is fine as a guard and is a bug when it is load-bearing. If a
// variable rests against its rail in normal play, the rail is holding up the
// model." You cannot tell which from the code. You can only count.
//
// tools/rails.mjs counts the bare `clamp(` helper and two-argument Math.min /
// Math.max with a numeric literal, by string surgery. This counts EVERYTHING:
//
//   - every `Math.min(...)` / `Math.max(...)` call in src/engine/**, any arity,
//     whatever the bound is (a literal, a named constant, a constant table);
//   - every call to a clamp HELPER, found by shape, not by name: any function
//     whose whole body is `Math.max(A, Math.min(B, V))` (either nesting, any
//     parameter order — notes.ts `cl(lo, hi, x)` puts the value last), module-
//     level or local, called in its own file or imported from another.
//
// HOW. The TypeScript parser finds each call site; an esbuild onLoad plugin
// rewrites only the callee — `Math.min(a, b)` becomes `__RA_min2(OFF, a, b)`,
// `clamp(x, lo, hi)` becomes `__RA_c3(OFF, 0, clamp, x, lo, hi)` — so every
// argument is evaluated once, in the same order, and the tracker returns
// exactly what Math (or the helper) returned. It records WHICH ARGUMENTS
// EQUAL THE RESULT as a bitmask. A site binds when the result equals no live
// argument, i.e. a bound changed the answer. A value that merely equals its
// bound (every argument equal) is a TIE and is not a bind — the first
// rails.mjs counted `<=` and its loudest finding was a variable that is
// identically zero.
//
// The instrumented bundle is test/.engine.rail-audit.mjs (gitignored); the
// harness bundle test/.engine.mjs is never touched. The tool proves the
// instrument changes nothing — same seed, plain vs instrumented bundle, the
// hash of g.econ and of the whole state after CHECK years must be identical —
// and proves the tracker can fail, by running a fixture with known binds
// through the same transform and asserting the exact counts.
//
// CLASSIFICATION IS HEURISTIC, from the source text: guard / behaviour / rail
// (see classify()). OVERRIDE pins a site by id when the heuristic is wrong.
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir, cpus } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..");
const ENGINE = join(APP, "src", "engine");

// ------------------------------------------------------------- worker side

if (!isMainThread) {
  const { bundle, seed, run, months, checkM } = workerData;
  process.env.CITY_SEEDS = "1";
  const E = await import(pathToFileURL(bundle).href);
  const { loadCity } = await import(pathToFileURL(join(APP, "test", "city.mjs")).href);
  const t0 = Date.now();
  const { parcels, adjacency, bbls } = loadCity(run, E.normalizeParcels);
  let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  const hash = (x) => createHash("sha256").update(JSON.stringify(x)).digest("hex").slice(0, 16);
  let check = null, resurrect = 0;
  // THE KNOWN RAIL. BASELINE.json's rail.cap.office.hi counts months the office
  // cap rate reads >= 10.999 (tools/baseline.mjs). Sampled here the same way,
  // every month, with its distinct values, to see whether a clamp produces it.
  const capHi = { n: 0, hi: 0, vals: new Set() };
  for (let m = 0; m < months; m++) {
    if (g.gameOver) { g = { ...g, gameOver: null, cash: 6e6 }; resurrect++; }
    g = E.advanceMonth(g, parcels, bbls, adjacency);
    const c = g.econ?.capRate?.office;
    if (Number.isFinite(c)) { capHi.n++; if (c >= 10.999) { capHi.hi++; capHi.vals.add(c); } }
    if (m + 1 === checkM) check = { econ: hash(g.econ), state: hash(g), month: g.month };
  }
  const T = globalThis.__RA_T ? Array.from(globalThis.__RA_T) : null;
  parentPort.postMessage({ T, check, resurrect, ms: Date.now() - t0,
    capHi: { n: capHi.n, hi: capHi.hi, distinct: capHi.vals.size, sample: [...capHi.vals].slice(0, 8) } });
  process.exit(0);
}

// --------------------------------------------------------------- settings

const SEEDS = Number(process.env.SEEDS ?? 2);
const YEARS = Number(process.env.YEARS ?? 30);
const CHECK = Number(process.env.CHECK ?? 3);           // years for the identical-state check
const BIND = Number(process.env.BIND ?? 0.01);
const TOP = Number(process.env.TOP ?? 60);
const OUT = process.env.OUT ?? join(APP, "RAIL_AUDIT.md");
const SEED0 = 4242;                                     // the market seed for run i is SEED0 + i
const MIN_CALLS = Number(process.env.MIN_CALLS ?? 0) || SEEDS * YEARS * 12 * 0.1; // ranked only if called this often
const T_START = Date.now();

// OVERRIDE: pin a site's class by id ("file.ts:line:col") when the heuristic
// reads it wrongly. Keep a reason beside each entry.
const OVERRIDE = {
  // land is held free and clear >= 70% of the time: a stated fact about who
  // owns dirt (the comment above it), applied as a floor on a share
  "ownership.ts:254:58": "behaviour",
  // the state-and-local part of a statutory tax schedule (ITEP): the law's cap
  "households.ts:3322:29": "behaviour",
  // the central bank's step size when it is restoring credibility: policy
  "market.ts:1853:28": "behaviour",
};

// --------------------------------------------------------------- instrument

const ts = (await import("typescript")).default;
const { build } = await import("esbuild");

const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith(".ts") && !f.endsWith(".d.ts")) files.push(p);
  }
})(ENGINE);

const isMathCall = (n) => ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)
  && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === "Math"
  && (n.expression.name.text === "min" || n.expression.name.text === "max");
const unparen = (n) => { while (ts.isParenthesizedExpression(n)) n = n.expression; return n; };

/** If fn is a clamp helper — body is max(A, min(B, V)) or min(B, max(A, V)) over its params — return the value param's index. */
function helperShape(fn) {
  let body = fn.body;
  if (!body) return null;
  if (ts.isBlock(body)) {
    if (body.statements.length !== 1 || !ts.isReturnStatement(body.statements[0]) || !body.statements[0].expression) return null;
    body = body.statements[0].expression;
  }
  body = unparen(body);
  const params = fn.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : null));
  if (!isMathCall(body) || body.arguments.length !== 2) return null;
  const outer = body.expression.name.text;
  const innerIx = body.arguments.findIndex((a) => isMathCall(unparen(a)));
  if (innerIx < 0) return null;
  const inner = unparen(body.arguments[innerIx]);
  if (inner.expression.name.text === outer || inner.arguments.length !== 2) return null;
  // a leaf is a parameter, or `param ?? literal` (proforma's clamp01)
  const leafParam = (e) => {
    e = unparen(e);
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) e = unparen(e.left);
    return ts.isIdentifier(e) ? params.indexOf(e.text) : -2;
  };
  const leaves = [...inner.arguments.map(leafParam), leafParam(body.arguments[1 - innerIx])];
  const inParams = leaves.filter((i) => i >= 0);
  if (leaves.some((i) => i === -2 && false)) return null;
  // the value is a parameter among the INNER pair; the bound side of the inner
  // pair is told apart by name (min(hi, v) is symmetric), falling back to the
  // one that is not a conventional bound name
  const BOUNDNAME = /^(a|b|lo|hi|min|max|low|high|lower|upper|floor|ceil|mn|mx)$/i;
  const cand = inner.arguments.map(leafParam).filter((i) => i >= 0);
  if (!inParams.length || !cand.length) return null;
  if (cand.length === 1) return { vi: cand[0], params: params.length };
  const named = cand.filter((i) => !BOUNDNAME.test(params[i]));
  return { vi: named.length === 1 ? named[0] : cand[1], params: params.length };
}

// pass 1: every clamp helper, per file, and what each file exports
const helpers = new Map(); // abs file -> Map(name -> {vi, params, node})
const sources = new Map();
for (const f of files) {
  const text = readFileSync(f, "utf8");
  const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  sources.set(f, { text, sf });
  const h = new Map();
  const visit = (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer
      && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) {
      const s = helperShape(n.initializer);
      if (s) h.set(n.name.text, { ...s, node: n.initializer });
    } else if (ts.isFunctionDeclaration(n) && n.name) {
      const s = helperShape(n);
      if (s) h.set(n.name.text, { ...s, node: n });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  helpers.set(f, h);
}
// helper names imported from another engine file
function importedHelpers(f, sf) {
  const out = new Map();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause?.namedBindings || !ts.isNamedImports(st.importClause.namedBindings)) continue;
    const spec = st.moduleSpecifier.text;
    if (!spec.startsWith(".")) continue;
    const target = resolve(dirname(f), spec.replace(/\.(ts|js|mjs)$/, "") + ".ts");
    const th = helpers.get(target);
    if (!th) continue;
    for (const el of st.importClause.namedBindings.elements) {
      const orig = (el.propertyName ?? el.name).text;
      if (th.has(orig)) out.set(el.name.text, th.get(orig));
    }
  }
  return out;
}

// SHOUTING_CASE of two or more characters; a lone capital (V, D, S) is usually a local
const UPPER = /^[A-Z][A-Z0-9_]+$/;
function constLike(e, consts) {
  e = unparen(e);
  if (ts.isNumericLiteral(e)) return true;
  if (ts.isPrefixUnaryExpression(e)) return constLike(e.operand, consts);
  if (ts.isIdentifier(e)) return UPPER.test(e.text) || e.text === "Infinity" || consts.has(e.text);
  if (ts.isPropertyAccessExpression(e)) {
    const root = unparen(e.expression);
    return (ts.isIdentifier(root) && (root.text === "Number" || UPPER.test(root.text))) || constLike(root, consts);
  }
  if (ts.isElementAccessExpression(e)) { const root = unparen(e.expression); return ts.isIdentifier(root) && UPPER.test(root.text); }
  if (ts.isBinaryExpression(e)) {
    const k = e.operatorToken.kind, S = ts.SyntaxKind;
    if ([S.PlusToken, S.MinusToken, S.AsteriskToken, S.SlashToken, S.AsteriskAsteriskToken].includes(k)) return constLike(e.left, consts) && constLike(e.right, consts);
  }
  return false;
}
function literalValue(e) {
  e = unparen(e);
  if (ts.isNumericLiteral(e)) return Number(e.text.replace(/_/g, ""));
  if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.MinusToken) { const v = literalValue(e.operand); return v === null ? null : -v; }
  if (ts.isIdentifier(e) && e.text === "Infinity") return Infinity;
  return null;
}
/** What the result is assigned to / named as — the quantity being bounded. */
function contextName(node, sf) {
  let n = node;
  for (let k = 0; k < 12 && n.parent; k++) {
    const p = n.parent;
    if (ts.isVariableDeclaration(p)) return p.name.getText(sf);
    if (ts.isPropertyAssignment(p)) return p.name.getText(sf);
    if (ts.isBinaryExpression(p) && p.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && p.operatorToken.kind <= ts.SyntaxKind.LastAssignment && p.right === n) return p.left.getText(sf);
    if (ts.isReturnStatement(p)) {
      let f = p.parent;
      while (f && !ts.isFunctionLike(f)) f = f.parent;
      if (f?.name) return "return " + f.name.getText(sf);
      if (f?.parent && ts.isVariableDeclaration(f.parent)) return "return " + f.parent.name.getText(sf);
      return "return";
    }
    if (ts.isArrowFunction(p) && p.body === n) {
      if (p.parent && ts.isVariableDeclaration(p.parent)) return "return " + p.parent.name.getText(sf);
      return "=>";
    }
    if (ts.isStatement(p) || ts.isBlock(p)) break;
    n = p;
  }
  return "";
}

let OFFSET = 0;
const sites = [];
const instrumented = new Map();
const recon = []; // per file: raw counts vs instrumented, so coverage is visible
const TRACKER = join(mkdtempSync(join(tmpdir(), "rail-audit-")), "tracker.mjs");

function instrument(f) {
  const { text, sf } = sources.get(f);
  const rel = relative(ENGINE, f);
  const local = helpers.get(f), imported = importedHelpers(f, sf);
  const helperBodies = [...local.values()].map((h) => h.node);
  const consts = new Set();
  // module-level `const x = <constant>` only: a local `const cap = ...` in one
  // function must not make every `cap` in the file a constant
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st) || !(st.declarationList.flags & ts.NodeFlags.Const)) continue;
    for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer && (constLike(d.initializer, consts) || ts.isObjectLiteralExpression(unparen(d.initializer)) || ts.isArrayLiteralExpression(unparen(d.initializer)))) consts.add(d.name.text);
  }
  const edits = [];
  const r = { file: rel, math: 0, helper: 0, inHelper: 0, spread: 0, skipped: 0 };
  const visit = (n, inHelper) => {
    if (helperBodies.includes(n)) inHelper = true;
    if (ts.isCallExpression(n) && !n.questionDotToken) {
      const callee = n.expression;
      const argsPos = n.arguments.pos; // just after "("
      const start = callee.getStart(sf);
      const pos = sf.getLineAndCharacterOfPosition(n.getStart(sf));
      const line = pos.line + 1, col = pos.character + 1;
      const id = `${rel}:${line}:${col}`;
      const base = { id, file: rel, line, col, text: n.getText(sf).replace(/\s+/g, " "), lineText: text.split("\n")[line - 1].trim(), ctx: contextName(n, sf) };
      if (isMathCall(n)) {
        const fn = callee.name.text;
        if (inHelper) { r.inHelper++; }
        else {
          const args = n.arguments;
          const spread = args.some((a) => ts.isSpreadElement(a));
          const nargs = args.length;
          const constMask = spread ? 0 : args.reduce((m, a, i) => (constLike(a, consts) ? m | (1 << i) : m), 0);
          const full = (1 << nargs) - 1;
          let kind, stride, call;
          if (spread || nargs > 4 || nargs < 2) { kind = "spread"; stride = 1; call = `__RA_${fn}N(${OFFSET}, `; r.spread++; }
          else { kind = constMask === 0 ? "choice" : constMask === full ? "const" : "bound"; stride = 1 << nargs; call = `__RA_${fn}${nargs}(${OFFSET}, `; r.math++; }
          const bounds = spread ? [] : args.filter((_, i) => constMask & (1 << i)).map((a) => a.getText(sf));
          const values = spread ? [] : args.filter((_, i) => !(constMask & (1 << i))).map((a) => a.getText(sf));
          sites.push({ ...base, type: "math", fn, kind, nargs, constMask, off: OFFSET, stride, bounds, values,
            lits: spread ? [] : args.filter((_, i) => constMask & (1 << i)).map(literalValue) });
          OFFSET += stride;
          edits.push([start, argsPos, call]);
        }
      } else if (ts.isIdentifier(callee) && (local.has(callee.text) || imported.has(callee.text)) && !inHelper) {
        const h = local.get(callee.text) ?? imported.get(callee.text);
        const nargs = n.arguments.length;
        if (nargs >= 1 && nargs <= 3 && h.vi < nargs) {
          const args = n.arguments.map((a) => a.getText(sf));
          const vi = h.vi;
          const bounds = args.filter((_, i) => i !== vi);
          sites.push({ ...base, type: "clamp", fn: callee.text, kind: "bound", nargs, off: OFFSET, stride: 4, vi,
            bounds, values: [args[vi]], lits: n.arguments.filter((_, i) => i !== vi).map(literalValue) });
          edits.push([start, argsPos, nargs === 1 ? `__RA_c1(${OFFSET}, ${callee.text}, ` : `__RA_c${nargs}(${OFFSET}, ${vi}, ${callee.text}, `]);
          OFFSET += 4;
          r.helper++;
        } else r.skipped++;
      }
    }
    ts.forEachChild(n, (c) => visit(c, inHelper));
  };
  visit(sf, false);
  r.raw = (text.match(/\bMath\.(min|max)\(/g) ?? []).length;
  r.helpers = [...local.keys()];
  recon.push(r);
  if (!edits.length) return null;
  edits.sort((a, b) => b[0] - a[0]);
  let out = text;
  for (const [s, e, rep] of edits) {
    // the callee and its "(" are replaced; nothing else moves
    const between = out.slice(s, e);
    if (!/\(\s*$/.test(between)) throw new Error(`rail-audit: unexpected call shape at ${rel}: ${between}`);
    out = out.slice(0, s) + rep + out.slice(e);
  }
  return `import { __RA_min2, __RA_max2, __RA_min3, __RA_max3, __RA_min4, __RA_max4, __RA_minN, __RA_maxN, __RA_c1, __RA_c2, __RA_c3 } from ${JSON.stringify(TRACKER)};\n` + out;
}

function trackerSource(size) {
  const mm = (fn, n) => {
    const ps = ["a", "b", "c", "d"].slice(0, n);
    const mask = ps.map((p, i) => `(${p} === r ? ${1 << i} : 0)`).join(" | ");
    return `export function __RA_${fn}${n}(o, ${ps.join(", ")}) { const r = Math.${fn}(${ps.join(", ")}); T[o + (${mask})]++; return r; }`;
  };
  return `const T = (globalThis.__RA_T ??= new Float64Array(${size}));
${["min", "max"].flatMap((f) => [2, 3, 4].map((n) => mm(f, n))).join("\n")}
export function __RA_minN(o, ...xs) { T[o]++; return Math.min(...xs); }
export function __RA_maxN(o, ...xs) { T[o]++; return Math.max(...xs); }
// clamp helpers: [0] unchanged, [1] raised to the floor, [2] cut to the ceiling, [3] not comparable (NaN, undefined)
function rec(o, r, v) { if (r === v || (r !== r && v !== v)) T[o]++; else if (r > v) T[o + 1]++; else if (r < v) T[o + 2]++; else T[o + 3]++; }
export function __RA_c1(o, fn, a) { const r = fn(a); rec(o, r, a); return r; }
export function __RA_c2(o, vi, fn, a, b) { const r = fn(a, b); rec(o, r, vi === 0 ? a : b); return r; }
export function __RA_c3(o, vi, fn, a, b, c) { const r = fn(a, b, c); rec(o, r, vi === 0 ? a : vi === 1 ? b : c); return r; }
`;
}

// ---- the tracker must be able to fail: a fixture with known answers
async function selfTest() {
  const fx = join(dirname(TRACKER), "fixture.ts");
  const fxText = `
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const cl = (lo: number, hi: number, x: number) => Math.max(lo, Math.min(hi, x));
const CAP = 0.06;
export function run() {
  const out: number[] = [];
  for (let i = 0; i < 10; i++) {
    out.push(Math.max(0, i - 7));        // floor wins at i<7 (7 binds, i=7 is a tie)
    out.push(Math.min(CAP, i / 100));    // CAP wins at i>6 (3 binds, i=6 a tie)
    out.push(clamp(i, 2, 5));            // lo at 0,1 ; hi at 6..9
    out.push(cl(2, 5, i));               // same, value last
    out.push(Math.min(i, 10 - i));       // a choice, not a bound
  }
  return out;
}`;
  writeFileSync(fx, fxText);
  const text = fxText, sf = ts.createSourceFile(fx, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const save = { OFFSET, n: sites.length };
  sources.set(fx, { text, sf });
  const h = new Map();
  ts.forEachChild(sf, function v(n) {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isArrowFunction(n.initializer)) { const s = helperShape(n.initializer); if (s) h.set(n.name.text, { ...s, node: n.initializer }); }
    ts.forEachChild(n, v);
  });
  helpers.set(fx, h);
  OFFSET = 0;
  const code = instrument(fx).replace(JSON.stringify(TRACKER), JSON.stringify(TRACKER.replace(/tracker\.mjs$/, "fxtracker.mjs")));
  const fsites = sites.splice(save.n);
  recon.pop();
  writeFileSync(TRACKER.replace(/tracker\.mjs$/, "fxtracker.mjs"), trackerSource(OFFSET).replace("globalThis.__RA_T", "globalThis.__RA_FX"));
  OFFSET = save.OFFSET;
  writeFileSync(fx.replace(/\.ts$/, ".inst.ts"), code);
  const outFile = fx.replace(/\.ts$/, ".mjs");
  await build({ entryPoints: [fx.replace(/\.ts$/, ".inst.ts")], bundle: true, format: "esm", platform: "node", outfile: outFile, logLevel: "error" });
  const M = await import(pathToFileURL(outFile).href);
  const ref = (() => { const clamp = (v, a, b) => Math.max(a, Math.min(b, v)); const o = []; for (let i = 0; i < 10; i++) o.push(Math.max(0, i - 7), Math.min(0.06, i / 100), clamp(i, 2, 5), clamp(i, 2, 5), Math.min(i, 10 - i)); return o; })();
  const got = M.run();
  const T = globalThis.__RA_FX;
  const stats = fsites.map((s) => siteStats(s, T));
  const want = [{ bind: 7, tie: 1 }, { bind: 3, tie: 1 }, { lo: 2, hi: 4 }, { lo: 2, hi: 4 }];
  const fails = [];
  if (JSON.stringify(got) !== JSON.stringify(ref)) fails.push("instrumented fixture returned different values");
  if (stats.length !== 5) fails.push(`expected 5 fixture sites, found ${stats.length} (${fsites.map((s) => s.text).join(" | ")})`);
  want.forEach((w, i) => { for (const k of Object.keys(w)) if (stats[i]?.[k] !== w[k]) fails.push(`fixture site ${i} (${fsites[i]?.text}): ${k} = ${stats[i]?.[k]}, want ${w[k]}`); });
  if (fsites[3] && fsites[3].vi !== 2) fails.push(`cl(lo, hi, x): value index ${fsites[3].vi}, want 2`);
  if (fsites[4] && fsites[4].kind !== "choice") fails.push(`Math.min(i, 10 - i) classed ${fsites[4].kind}, want choice`);
  return { ok: !fails.length, fails, stats };
}

function siteStats(s, T) {
  const at = (k) => T[s.off + k] ?? 0;
  if (s.type === "clamp") {
    const keep = at(0), lo = at(1), hi = at(2), odd = at(3), n = keep + lo + hi + odd;
    return { n, bind: lo + hi, lo, hi, tie: 0, odd, share: n ? (lo + hi) / n : 0 };
  }
  if (s.kind === "spread") return { n: at(0), bind: 0, lo: 0, hi: 0, tie: 0, odd: 0, share: 0 };
  const full = (1 << s.nargs) - 1, valueMask = full & ~s.constMask;
  let n = 0, bind = 0, tie = 0, odd = 0;
  const wins = new Array(s.nargs).fill(0); // calls each arg was (one of) the winner(s)
  for (let m = 0; m <= full; m++) {
    const c = at(m); if (!c) continue;
    n += c;
    if (m === 0) { odd += c; continue; }
    if (m === full) { tie += c; continue; }
    for (let i = 0; i < s.nargs; i++) if (m & (1 << i)) wins[i] += c;
    if (s.kind === "bound" && !(m & valueMask)) bind += c;
  }
  const isMax = s.fn === "max";
  return { n, bind, lo: isMax ? bind : 0, hi: isMax ? 0 : bind, tie, odd, wins, share: n ? bind / n : 0 };
}

// ---- classification (heuristic)
const ECON = /rent|price|\bpx|cap(?!ac)|rate|vac|yield|growth|belief|spread|value|\bval\b|premium|wage|demand|absor|elast|momentum|infl|disc|tax|cost|land|occ|psf|idx|index|irr|noi|income|expen|mult|beta|press|fear|sentiment|confid|appetite|credit|tilt|bias|drift|shock|gap|margin|resid|bid|ask|offer|quote|apprec|trend|stress|risk|spend|output|jobs|employ|popul|household|lease|supply|starts|pipeline|stock|ratio|share|weight|prob|odds|pct|chance|ret\b|return|level|room|tgt|target|miss/i;
// an actor's own policy limit: a lender's leverage, a term, a budget, a count of tries
const BEHAV = /ltv|ltc|dscr|debt.?yield|\blev\b|\.lev\b|leverage|term|loan|amort|matur|budget|headroom|cash|equity|liquid|reserve|covenant|draw|limit|floors|storey|stories|units|years|months|horizon|patience|slots|tries|attempts|deals|bids|capacit|quota|catchup|contested|depth|ready/i;
// a physical, geometric or demographic bound: feet, distance, plate, a person's age
const GEOM = /\bage\b|Age\b|ADULT_AT|suite|\bft\b|_FT\b|feet|dist|radius|width|front|plate|coverage|height|zone|zoned|lotArea|bldgArea|\bsf\b|area|\bx\b|\by\b/i;
function classify(s, st) {
  if (OVERRIDE[s.id]) return { cls: OVERRIDE[s.id], why: "pinned" };
  if (s.kind === "choice" || s.kind === "spread") return { cls: "choice", why: "min/max of live quantities" };
  if (s.kind === "const") return { cls: "guard", why: "constant expression" };
  const val = s.values.join(" "), ctx = s.ctx ?? "", bnd = s.bounds.join(" ");
  const lits = s.lits.filter((v) => v !== null);
  const allLit = lits.length === s.bounds.length;
  // index bounds and divisor guards
  if (/\.length\b/.test(val + bnd) || /Math\.(floor|round|trunc|ceil)\(/.test(s.text) && /idx|index|\bi\b|\bk\b|band|tier|bucket|slot/i.test(ctx + val)) return { cls: "guard", why: "index bound" };
  if (s.parentDivisor) return { cls: "guard", why: "divisor guard" };
  if (allLit && lits.every((v) => v === 0 || v === 1 || Math.abs(v) <= 1e-3 || !Number.isFinite(v))) {
    return { cls: "guard", why: lits.every((v) => v === 0) ? "non-negativity" : lits.every((v) => v === 0 || v === 1) ? "unit interval / count >= 1" : "epsilon" };
  }
  const words = `${ctx.replace(/^return\s*/, "")} ${val} ${bnd}`;
  if (BEHAV.test(words)) return { cls: "behaviour", why: "actor's limit (named)" };
  if (GEOM.test(words)) return { cls: "guard", why: "physical / geometric / demographic bound" };
  if (ECON.test(words)) return { cls: "rail", why: "bound on an economic quantity" };
  return { cls: "rail", why: "literal bound, quantity unclear" };
}

// ------------------------------------------------------------------- main

for (const f of files) { const c = instrument(f); if (c) instrumented.set(f, c); }
writeFileSync(TRACKER, trackerSource(OFFSET));
// a divisor guard: the call is the right operand of "/" — mark from source
for (const s of sites) {
  const { sf } = sources.get(join(ENGINE, s.file));
  const pos = sf.getPositionOfLineAndCharacter(s.line - 1, s.col - 1);
  const find = (n) => { if (n.getStart(sf) === pos && ts.isCallExpression(n)) return n; return ts.forEachChild(n, find); };
  const node = find(sf);
  let p = node?.parent; let c = node;
  while (p && ts.isParenthesizedExpression(p)) { c = p; p = p.parent; }
  s.parentDivisor = !!(p && ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.SlashToken && p.right === c);
}

// a pin that no longer names a site (the line moved) is reported, not silently ignored
const stalePins = Object.keys(OVERRIDE).filter((id) => !sites.some((s) => s.id === id));
if (stalePins.length) console.log(`OVERRIDE pins that match no site (line moved?): ${stalePins.join(", ")}`);
const fx = await selfTest();
console.log(`self-test: ${fx.ok ? "PASS" : "FAIL"} — fixture with known binds through the same transform`);
if (!fx.ok) { for (const f of fx.fails) console.log("  " + f); process.exit(1); }

const { writeEntry } = await import(pathToFileURL(join(APP, "test", "entry.mjs")).href);
const ENTRY = join(APP, "test", ".entry.rail-audit.ts");
const BUNDLE_I = join(APP, "test", ".engine.rail-audit.mjs");
const BUNDLE_P = join(APP, "test", ".engine.rail-plain.mjs");
writeFileSync(ENTRY, writeEntry());
const tb = Date.now();
await build({ entryPoints: [ENTRY], bundle: true, format: "esm", platform: "node", outfile: BUNDLE_P, logLevel: "error" });
await build({ entryPoints: [ENTRY], bundle: true, format: "esm", platform: "node", outfile: BUNDLE_I, logLevel: "error",
  plugins: [{ name: "rail-audit", setup(b) {
    b.onLoad({ filter: /[\\/]src[\\/]engine[\\/].*\.ts$/ }, (args) => {
      const c = instrumented.get(args.path);
      return c ? { contents: c, loader: "ts" } : undefined;
    });
  } }] });
console.log(`instrumented ${sites.length} call sites in ${files.length} files; bundles built in ${((Date.now() - tb) / 1000).toFixed(1)}s`);

const months = YEARS * 12, checkM = Math.min(CHECK * 12, months);
const spawn = (bundle, i, m) => new Promise((res, rej) => {
  const w = new Worker(fileURLToPath(import.meta.url), { workerData: { bundle, seed: SEED0 + i, run: i, months: m, checkM } });
  w.once("message", res); w.once("error", rej);
  w.once("exit", (c) => { if (c) rej(new Error(`worker exit ${c}`)); });
});
if (!process.env.FROM) console.log(`playing ${SEEDS} town(s) x ${YEARS} years, no player, + a plain-bundle control for ${CHECK} years (${cpus().length} cpus)…`);
// TALLY=file saves the raw counts; FROM=file re-reports from them without
// playing (for iterating on classification — the sites must not have moved)
let plain, runs, simWall = null;
if (process.env.FROM) ({ plain, runs, simWall } = JSON.parse(readFileSync(process.env.FROM, "utf8")));
else [plain, ...runs] = await Promise.all([spawn(BUNDLE_P, 0, checkM), ...Array.from({ length: SEEDS }, (_, i) => spawn(BUNDLE_I, i, months))]);
simWall ??= Date.now() - T_START;
if (process.env.TALLY) writeFileSync(process.env.TALLY, JSON.stringify({ plain, runs, simWall }));
if (runs[0].T.length !== OFFSET) throw new Error(`rail-audit: tally has ${runs[0].T.length} slots, the source now has ${OFFSET}; re-run without FROM`);
const T = new Float64Array(OFFSET);
for (const r of runs) r.T.forEach((v, k) => { T[k] += v; });
const identical = plain.check && runs[0].check && plain.check.econ === runs[0].check.econ && plain.check.state === runs[0].check.state;
const capHi = runs.reduce((a, r) => ({ n: a.n + r.capHi.n, hi: a.hi + r.capHi.hi, distinct: a.distinct + r.capHi.distinct, sample: [...a.sample, ...r.capHi.sample] }), { n: 0, hi: 0, distinct: 0, sample: [] });

// ----------------------------------------------------------------- report

const rows = sites.map((s) => { const st = siteStats(s, T); return { ...s, ...st, ...classify(s, st) }; });
const called = rows.filter((r) => r.n > 0);
const ranked = called.filter((r) => r.kind === "bound" && r.n >= MIN_CALLS).sort((a, b) => b.share - a.share || b.n - a.n);
const railsHot = ranked.filter((r) => r.cls === "rail" && r.share >= BIND);
const behavHot = ranked.filter((r) => r.cls === "behaviour" && r.share >= BIND);
const guardsEcon = ranked.filter((r) => r.cls === "guard" && r.share >= BIND && ECON.test(`${r.ctx.replace(/^return\s*/, "")} ${r.values.join(" ")}`));
const runtime = simWall / 1000; // the playing run, also when re-reported FROM a tally
const pct = (x) => (100 * x).toFixed(x < 0.001 && x > 0 ? 3 : 1) + "%";
const esc = (s) => String(s).replace(/\|/g, "\\|").replace(/`/g, "'");
const snip = (s, n = 90) => esc(s.length > n ? s.slice(0, n - 1) + "…" : s);

const byClass = {};
for (const r of rows) {
  const c = (byClass[r.cls] ??= { sites: 0, called: 0, ranked: 0, hot: 0 });
  c.sites++; if (r.n) c.called++;
  if (r.kind === "bound" && r.n >= MIN_CALLS) { c.ranked++; if (r.share >= BIND) c.hot++; }
}
const raw = recon.reduce((a, r) => a + r.raw, 0);
const inHelper = recon.reduce((a, r) => a + r.inHelper, 0);
const nMath = rows.filter((r) => r.type === "math").length, nClamp = rows.filter((r) => r.type === "clamp").length;
const helperNames = [...new Set(recon.flatMap((r) => r.helpers.map((h) => `${r.file.replace(/\.ts$/, "")}.${h}`)))];
const skipped = recon.reduce((a, r) => a + r.skipped, 0);

const L = [];
L.push(`# Rail audit — which clamps bind in normal play`, "");
L.push(`Generated by \`node tools/rail-audit.mjs\` (\`pnpm rail-audit\`) — a report, not a gate. ${SEEDS} town(s) x ${YEARS} years, monthly, no player (resurrected on game over: ${runs.map((r) => r.resurrect).join("/")} times), market seeds ${Array.from({ length: SEEDS }, (_, i) => SEED0 + i).join(", ")}, CITY_SEEDS=1. Wall time **${(runtime / 60).toFixed(1)} min** (per-town sim ${runs.map((r) => (r.ms / 60000).toFixed(1)).join(" / ")} min instrumented, in parallel workers).`, "");
L.push(`CLAUDE.md fault five: a clamp is fine as a guard and a bug when it is load-bearing. This instruments **every** \`Math.min\` / \`Math.max\` call and every call to a clamp helper in \`src/engine/**\` (helpers found by shape: ${helperNames.length} of them), and counts how often the **bound**, not the value, decides the result. A call where every argument is equal is a tie, not a bind.`, "");
L.push(`**Classification is heuristic** (from source text; \`OVERRIDE\` in the tool pins a site): *guard* = non-negativity, unit interval, epsilon, divisor or index bound; *behaviour* = an actor's named policy limit (LTV, term, budget, floors…); *rail* = a literal or constant bound on an economic quantity; *choice* = min/max of two live quantities (a mechanism, e.g. \`min(demand, supply)\`, not ranked). Ranked sites need at least ${Math.round(MIN_CALLS)} calls; "load-bearing" = bound wins in >= ${pct(BIND)} of calls.`, "");
L.push(`## Instrument checks`, "");
L.push(`- **Self-test ${fx.ok ? "PASS" : "FAIL"}**: a fixture with known binds (\`Math.max(0, i-7)\` 7 binds + 1 tie, \`Math.min(CAP, i/100)\` 3 + 1 tie, \`clamp(i,2,5)\` 2 lo + 4 hi, \`cl(lo,hi,x)\` with the value last, a two-live-quantity \`min\` classed as choice) is run through the same transform and the exact counts asserted; its outputs equal the uninstrumented reference.`);
L.push(`- **Identical state ${identical ? "PASS" : "FAIL"}**: seed ${SEED0}, town 0, after ${CHECK} years: plain bundle econ ${plain.check?.econ} / state ${plain.check?.state}; instrumented econ ${runs[0].check?.econ} / state ${runs[0].check?.state} (sha256 of \`JSON.stringify(g.econ)\` and of the whole \`g\`).`);
L.push(`- **Coverage**: ${raw} \`Math.min(\`/\`Math.max(\` occurrences in the source = ${nMath} instrumented Math sites + ${inHelper} inside the clamp helpers' own bodies (counted at the helper's call sites instead)${raw - nMath - inHelper ? ` + ${raw - nMath - inHelper} that are not calls (the text in comments)` : ""}. ${nClamp} helper call sites instrumented${skipped ? `, ${skipped} helper calls with an unexpected arity skipped` : ""}. Helpers: ${helperNames.map((h) => "`" + h + "`").join(", ")}.`);
L.push(`- **The known rail** (BASELINE \`rail.cap.office.hi\` = 0.0967): that metric counts months the office cap rate *reads* >= 10.999%. Sampled the same way here: ${capHi.hi} of ${capHi.n} town-months (${pct(capHi.n ? capHi.hi / capHi.n : 0)}), with ${capHi.distinct} distinct values${capHi.sample.length ? ` (e.g. ${capHi.sample.slice(0, 5).join(", ")})` : ""}. ${capHi.hi ? (capHi.distinct > Math.max(2, capHi.hi * 0.2) ? "BASELINE measures its own towns, seeds and horizon, so the rate differs; what this checks is the shape. The values vary, so no clamp is holding them: `g.econ.capRate` is now the median of trades (propmarket.ts), and the 11% the baseline watches is a *level*, not a rail. The instrument correctly finds no 11% clamp binding there." : "The readings repeat one value: a bound is producing them — see the ranked list.") : "It did not occur in these towns/years."}`, "");

if (stalePins.length) L.push(`- **Stale OVERRIDE pins** (match no site; update the ids): ${stalePins.join(", ")}`, "");
L.push(`## Summary`, "");
L.push(`| class | sites | called | ranked (>= ${Math.round(MIN_CALLS)} calls) | load-bearing (>= ${pct(BIND)}) |`, `|---|---:|---:|---:|---:|`);
for (const c of ["rail", "behaviour", "guard", "choice"]) { const v = byClass[c] ?? { sites: 0, called: 0, ranked: 0, hot: 0 }; L.push(`| ${c} | ${v.sites} | ${v.called} | ${c === "choice" ? "—" : v.ranked} | ${c === "choice" ? "—" : v.hot} |`); }
L.push(`| **all** | ${rows.length} | ${called.length} | ${ranked.length} | ${ranked.filter((r) => r.share >= BIND).length} |`, "");
L.push(`${rows.length - called.length} sites were never called in these runs (dead code, the player's paths, or branches no town reached).`, "");

const table = (list, n) => {
  const o = [`| # | site | class | calls | bound wins | floor / ceil | ties | bounds | quantity | code |`, `|---:|---|---|---:|---:|---|---:|---|---|---|`];
  list.slice(0, n).forEach((r, i) => o.push(`| ${i + 1} | \`${r.file}:${r.line}\` | ${r.cls} | ${Math.round(r.n).toLocaleString("en-US")} | **${pct(r.share)}** | ${pct(r.n ? r.lo / r.n : 0)} / ${pct(r.n ? r.hi / r.n : 0)} | ${pct(r.n ? r.tie / r.n : 0)} | \`${snip(r.bounds.join(", "), 30)}\` | ${snip(r.ctx || "—", 28)} | \`${snip(r.text)}\` |`));
  return o;
};
L.push(`## Load-bearing rails (bound wins in >= ${pct(BIND)} of calls)`, "");
L.push(railsHot.length ? table(railsHot, 999).join("\n") : "_none_", "");
L.push(`## Guards binding on economic quantities`, "", `A guard that fires is a value the model computed out of range — a negative rent, a share above one. These may be hiding faults upstream.`, "");
L.push(`Most rows here are hinges, \`max(0, x - k)\`: a response that starts at a threshold, which is arithmetic doing its job when x below k is normal (a delinquency rate under its trigger, an index rate below where a lender gets nervous). A row is a suspect when the clipped quantity should never have been negative at all — a rent, a value, an NOI.`, "");
L.push(guardsEcon.length ? table(guardsEcon, 40).join("\n") : "_none_", "");
L.push(`## Behaviour limits that bind`, "", `An actor's policy limit binding is normal (a lender's max LTV binds on most loans) — listed so it can be read, not as a fault.`, "");
L.push(behavHot.length ? table(behavHot, 30).join("\n") : "_none_", "");
L.push(`## Top ${TOP} sites by bind share (all classes)`, "");
L.push(table(ranked, TOP).join("\n"), "");
L.push(`Site ids are \`file:line:col\` at main as audited; the column is the call's first character.`, "");

// RAIL_AUDIT.md also carries the hand-written history of rails retired one PR
// at a time (Phase 3, NO_PLAYTEST_PLAN.md). Everything from the HISTORY marker
// on is kept as it is; a file without the marker is kept whole beneath it.
const HISTORY = "<!-- rail-audit: hand-written history below; the tool regenerates only what is above -->";
if (OUT !== "-") {
  let tail = "";
  try {
    const prev = readFileSync(OUT, "utf8");
    tail = prev.includes(HISTORY) ? prev.slice(prev.indexOf(HISTORY)) : `${HISTORY}\n\n# History\n\n${prev.replace(/^# /, "## ")}`;
  } catch { /* first run */ }
  writeFileSync(OUT, L.join("\n") + "\n" + (tail ? "\n" + tail.trimEnd() + "\n" : ""));
}

console.log(`\nRAIL AUDIT — ${rows.length} sites (${nMath} Math.min/max, ${nClamp} clamp-helper calls), ${SEEDS} towns x ${YEARS}y, ${(runtime / 60).toFixed(1)} min`);
console.log(`  identical state (plain vs instrumented, ${CHECK}y): ${identical ? "PASS" : "FAIL"}  econ ${plain.check?.econ} vs ${runs[0].check?.econ}`);
console.log(`  office cap >= 10.999%: ${capHi.hi}/${capHi.n} months, ${capHi.distinct} distinct values`);
for (const c of ["rail", "behaviour", "guard"]) { const v = byClass[c] ?? {}; console.log(`  ${c.padEnd(10)} ${String(v.sites ?? 0).padStart(5)} sites, ${String(v.hot ?? 0).padStart(4)} load-bearing`); }
console.log(`\n  top load-bearing rails:`);
for (const r of railsHot.slice(0, 15)) console.log(`  ${pct(r.share).padStart(7)}  ${`${r.file}:${r.line}`.padEnd(24)} ${snip(r.ctx || "", 20).padEnd(20)} ${snip(r.text, 70)}`);
if (OUT !== "-") console.log(`\n  full report: ${relative(process.cwd(), OUT)}`);
rmSync(dirname(TRACKER), { recursive: true, force: true });
if (!identical) { console.log("\nIDENTICAL-STATE CHECK FAILED: the instrument changed the simulation; the counts above are not of the real engine."); process.exit(1); }
