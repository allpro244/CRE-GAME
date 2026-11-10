// THE MECHANISM AUDIT: HOW MUCH OF THE ECONOMY IS STILL NOT SIMULATED.
//
//   node tools/mechanism-audit.mjs            print the scoreboard, write MECHANISM_AUDIT.md
//   node tools/mechanism-audit.mjs --check    exit 1 if any count is above MECHANISM_BASELINE.json (CI)
//   node tools/mechanism-audit.mjs --update   write the current counts as the new baseline
//   node tools/mechanism-audit.mjs --list coin|draw|unsourced   print every site of one kind
//
// THE GOAL (owner, 2026-11-10): "The goal is that everything is simulated and
// there's no fake numbers; I don't necessarily need it to reflect what has
// happened in the real world." So the scoreboard is not how closely the
// outputs track US history (tools/proof.mjs is a reference and a smoke alarm,
// no more). It is how many places in the engine are still not a simulation,
// counted from the source, in about a second:
//
//   COINS      a random draw compared against a probability — something an
//              actor should decide, decided by dice instead. The faults.
//   DRAWS      any other random draw that is not the outside world or an
//              agent's own taste: random magnitudes, random picks, random
//              timings. Suspect: each should become a decision or a sourced
//              distribution an actor actually draws from.
//   UNSOURCED  a module-level numeric constant (or table of them) whose
//              comment carries no source: no citation, no year, no [S] [D] [K]
//              tag. Fake number one is "a constant chosen to make an outcome
//              come out right"; a constant that does not say where it came
//              from cannot be told apart from one.
//   LEDGER     open rows in FORMULA_LEDGER.md: aggregates still set from the top.
//
// And, counted but allowed:
//   OUTSIDE    the world outside the town: national cycles, black swans,
//              weather (REAL_ECONOMY_PLAN "allowed exogenous inputs"). The
//              owner: do not change black swans or confidence shocks.
//   TASTE      an agent's private taste in a choice — the Gumbel term of a
//              logit (random utility, McFadden 1974). That is heterogeneity
//              the agents have, not a decision taken for them.
//   KEEPERS    `void rng(...)`: a draw kept only so the stream does not
//              re-roll after a coin was replaced. Harmless; delete them in a
//              batch when the century can be re-baselined.
//
// The classification is by the shape of the code, so it can be wrong at the
// margin; `--list` shows every site so a reader can check. Lower is better on
// every row except OUTSIDE and TASTE. The ratchet (`--check`) only stops a
// count going UP: a PR that adds a coin has to remove one.
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE = join(ROOT, "src", "engine");
const BASE = join(ROOT, "MECHANISM_BASELINE.json");

/** Files that ARE the outside world (the nation's cycle, black swans, weather). */
const OUTSIDE_FILES = new Set(["blackswans.ts", "swans.ts", "nation.ts", "weather.ts", "opening.ts"]);
/** Channels that are the outside world wherever they are drawn. */
const OUTSIDE_CHANNELS = new Set(["nation", "shock"]);
/** The random primitives themselves are defined here; their bodies are not draws. */
const SKIP_FILES = new Set(["rng.ts"]);

const DRAW = /\b(rng|rrange|hash01|hashNormal|gumbel|marketRng)\s*\(/g;

function stripComment(line) {
  // drop // comments that are not inside a string (good enough for this code base)
  let out = "", q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { out += c; if (c === q && line[i - 1] !== "\\") q = null; continue; }
    if (c === '"' || c === "'" || c === "`") { q = c; out += c; continue; }
    if (c === "/" && line[i + 1] === "/") break;
    out += c;
  }
  return out;
}

function classify(file, code) {
  if (OUTSIDE_FILES.has(file)) return "outside";
  const ch = code.match(/\b(?:rng|rrange)\s*\([^)]*?["'](\w+)["']\s*\)/);
  if (ch && OUTSIDE_CHANNELS.has(ch[1])) return "outside";
  if (/\bvoid\s*\(?\s*(rng|rrange)\b/.test(code)) return "keeper";
  if (/\bgumbel\s*\(/.test(code)) return "taste";
  // a draw set against a threshold: rng(s) < p, p > rng(s), rng(s) >= x …
  if (/\b(rng|rrange|marketRng|hash01)\s*\([^()]*(\([^()]*\)[^()]*)*\)\s*[<>]=?/.test(code)
    || /[<>]=?\s*(rng|rrange|marketRng|hash01)\s*\(/.test(code)) return "coin";
  return "draw";
}

function scanDice() {
  const sites = [];
  for (const f of readdirSync(ENGINE).filter((x) => x.endsWith(".ts")).sort()) {
    if (SKIP_FILES.has(f)) continue;
    const lines = readFileSync(join(ENGINE, f), "utf8").split("\n");
    let inBlock = false;
    lines.forEach((raw, i) => {
      let line = raw;
      if (inBlock) { const e = line.indexOf("*/"); if (e < 0) return; line = line.slice(e + 2); inBlock = false; }
      const b = line.indexOf("/*");
      if (b >= 0 && line.indexOf("*/", b) < 0) { inBlock = true; line = line.slice(0, b); }
      if (/^\s*\*/.test(line)) return;
      const code = stripComment(line);
      if (!DRAW.test(code)) return;
      DRAW.lastIndex = 0;
      // the definitions of the primitives are not draws
      if (/\b(export\s+)?(function|const)\s+(rng|rrange|hash01|hashNormal|gumbel|marketRng)\b/.test(code)) return;
      sites.push({ file: f, line: i + 1, kind: classify(f, code), code: code.trim().slice(0, 160) });
    });
  }
  return sites;
}

/**
 * A source, for this audit, is any of: a [S] / [S~] / [D] / [M] tag (the
 * repo's convention: sourced, derived from other sourced numbers, a
 * mathematical constant), a cited year 1900-2099, or a named data source.
 * A dated change note — "(2026-10-15)" — is not a citation and is stripped
 * first. A [K] / [K~] tag is a judgement stated as such: honest, and still
 * not a source, so it counts as unsourced (reported apart as "judgement").
 * So does a source that DISAGREES with the number (`[S≠ …]`, "source
 * disagrees"): the figure is written down and the constant is still to be
 * reconciled.
 */
const SOURCED = /\[(S|S~|D|M)[\]:,\s]|\b(19|20)\d\d\b|\b(BLS|BEA|Census|FDIC|NBER|JOLTS|CPS|NCREIF|CBRE|JLL|REIS|CoStar|ACLI|NAIOP|BOMA|IREM|RSMeans|Damodaran|Freddie|Fannie|HUD|IRS|OCC|SLOOS|ICSC|NAHB|CoreNet|Prologis|Cushman|Moody|RCA|FRED|OECD|IMF|BIS|CBO|ECB|Treasury|Federal Reserve|ULI|MBA|ACS|CBP|BDS|QCEW|CES|PMMS|S&P|Fitch|ATUS|CoStar|Trepp|MSCI|NAR|NMHC|Zillow)\b|et al\.|\bsource[sd]?:/i;
const JUDGEMENT = /\[K~?[\]:,\s]|shape parameter|stated, not fitted/i;
const DATE_NOTE = /\b20\d\d-\d\d(-\d\d)?\b/g;
/** Physical and accounting facts that need no citation: units, calendar, display. */
const TRIVIAL = /^(0|1|-1|2|12|100|1000|1e3|1e6|1_000_000|1_000|24|60|365|0\.5)$/;

function scanConstants() {
  const out = [];
  for (const f of readdirSync(ENGINE).filter((x) => x.endsWith(".ts")).sort()) {
    if (SKIP_FILES.has(f)) continue;
    const lines = readFileSync(join(ENGINE, f), "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(?:export\s+)?const\s+([A-Z][A-Z0-9_]{2,})\s*(?::[^=]+)?=\s*(.*)$/);
      if (!m) continue;
      const name = m[1], rhs = m[2].trim();
      // numbers, or a table of numbers ({ a: 1.2, b: 3 } / [1, 2]) on this line or the next few
      let body = rhs;
      for (let j = i + 1; j < Math.min(lines.length, i + 8) && !/[;}\]]\s*(as const)?;?\s*$/.test(body); j++) body += " " + lines[j].trim();
      const numeric = /^-?[\d_.]+(e-?\d+)?\s*(as const)?;?\s*(\/\/.*)?$/.test(rhs);
      const table = /^[{[]/.test(rhs) && /:\s*-?[\d.]+|^\[\s*-?[\d.]/.test(body) && !/=>|\bfunction\b|new\s/.test(body);
      if (!numeric && !table) continue;
      const value = rhs.replace(/;.*$/, "").replace(/\s*as const$/, "").trim();
      if (numeric && TRIVIAL.test(value.replace(/_/g, ""))) continue;
      // the comment block directly above (contiguous comment lines), plus the same line and the body
      let k = i - 1, cmt = "";
      // ...through a run of sibling constants declared under one comment
      for (;;) {
        while (k >= 0 && /^\s*(\/\/|\*|\/\*\*?|\*\/)/.test(lines[k])) { cmt = lines[k] + "\n" + cmt; k--; }
        if (k >= 0 && /^(?:export\s+)?const\s+[A-Z][A-Z0-9_]{2,}\b/.test(lines[k]) && cmt === "") { k--; continue; }
        break;
      }
      const text = (cmt + "\n" + lines[i] + "\n" + body).replace(DATE_NOTE, "");
      // a source that disagrees with the number is not a source for it
      const sourced = SOURCED.test(text) && !/\[S≠|source disagrees/i.test(text);
      out.push({ file: f, line: i + 1, name, sourced, judgement: !sourced && JUDGEMENT.test(text), value: value.slice(0, 60) });
    }
  }
  return out;
}

function ledgerOpen() {
  const p = join(ROOT, "FORMULA_LEDGER.md");
  if (!existsSync(p)) return { open: NaN, ids: [] };
  const txt = readFileSync(p, "utf8");
  const open = txt.split(/^## Open\s*$/m)[1]?.split(/^## /m)[0] ?? "";
  const rows = open.split("\n").filter((l) => /^\|\s*\d+\s*\|/.test(l));
  return { open: rows.length, ids: rows.map((l) => Number(l.split("|")[1])) };
}

function railsLastRun() {
  const p = join(ROOT, "RAIL_AUDIT.md");
  if (!existsSync(p)) return null;
  const txt = readFileSync(p, "utf8");
  const m = txt.match(/load-bearing[^\n]*?(\d+)/i);
  const d = txt.match(/\b(20\d\d-\d\d-\d\d)\b/);
  return { loadBearing: m ? Number(m[1]) : NaN, date: d ? d[1] : "?" };
}

// ------------------------------------------------------------------ report
const dice = scanDice();
const consts = scanConstants();
const ledger = ledgerOpen();
const rails = railsLastRun();
const by = (k) => dice.filter((x) => x.kind === k);
const counts = {
  coins: by("coin").length,
  draws: by("draw").length,
  unsourced: consts.filter((c) => !c.sourced).length,
  ledger: ledger.open,
};
const allowed = { outside: by("outside").length, taste: by("taste").length, keepers: by("keeper").length, sourcedConstants: consts.filter((c) => c.sourced).length };

const args = process.argv.slice(2);
if (args[0] === "--list") {
  const kind = args[1] ?? "coin";
  const rows = kind === "unsourced" ? consts.filter((c) => !c.sourced).map((c) => `src/engine/${c.file}:${c.line}  ${c.name} = ${c.value}`)
    : dice.filter((x) => x.kind === kind).map((x) => `src/engine/${x.file}:${x.line}  ${x.code}`);
  console.log(rows.join("\n"));
  console.log(`\n${rows.length} ${kind}`);
  process.exit(0);
}

const perFile = {};
for (const x of dice) if (x.kind === "coin" || x.kind === "draw") { const r = (perFile[x.file] ??= { coin: 0, draw: 0, unsourced: 0 }); r[x.kind]++; }
for (const c of consts) if (!c.sourced) (perFile[c.file] ??= { coin: 0, draw: 0, unsourced: 0 }).unsourced++;
const worst = Object.entries(perFile).sort((a, b) => (b[1].coin * 3 + b[1].draw + b[1].unsourced) - (a[1].coin * 3 + a[1].draw + a[1].unsourced)).slice(0, 15);

const lines = [];
lines.push("# Mechanism audit — how much of the economy is still not simulated");
lines.push("");
lines.push("Generated by `node tools/mechanism-audit.mjs`. Lower is better. The ratchet (`--check`, in CI) stops any count rising above `MECHANISM_BASELINE.json`; lower it with `--update` when a PR removes some.");
lines.push("");
lines.push("| fault | count | what it is |");
lines.push("|---|---|---|");
lines.push(`| **coins** | ${counts.coins} | a random draw compared against a probability: a decision an actor should take, taken by dice |`);
lines.push(`| **draws** | ${counts.draws} | other random draws (magnitudes, picks, timings) that are not the outside world or an agent's taste |`);
lines.push(`| **unsourced constants** | ${counts.unsourced} | module-level numbers whose comment names no source, cited year or [S]/[D]/[M] tag ([K] judgements count here) |`);
lines.push(`| **ledger rows open** | ${counts.ledger} | aggregates still set from the top (FORMULA_LEDGER.md: ${ledger.ids.map((x) => "#" + x).join(", ")}) |`);
lines.push(`| load-bearing rails | ${rails ? rails.loadBearing : "—"} | from the last \`tools/rail-audit.mjs\` run (${rails ? rails.date : "never"}; a run takes ~15 min, so it is not re-counted here) |`);
lines.push("");
lines.push(`Allowed and counted: ${allowed.outside} draws of the outside world (nation, swans, weather), ${allowed.taste} taste draws (random utility), ${allowed.keepers} stream keepers (\`void rng\`), ${allowed.sourcedConstants} sourced constants. Of the unsourced constants, ${consts.filter((c) => c.judgement).length} are judgements stated as such ([K]) — honest, and still to be sourced or replaced by a mechanism.`);
lines.push("");
lines.push("## Where they are (coins weighted ×3)");
lines.push("");
lines.push("| file | coins | draws | unsourced constants |");
lines.push("|---|---|---|---|");
for (const [f, r] of worst) lines.push(`| src/engine/${f} | ${r.coin} | ${r.draw} | ${r.unsourced} |`);
lines.push("");
lines.push("Every site: `node tools/mechanism-audit.mjs --list coin` (or `draw`, `unsourced`). The classification is by the shape of the code and can be wrong at the margin — check a site before acting on it.");
const md = lines.join("\n") + "\n";

if (args[0] === "--update") {
  writeFileSync(BASE, JSON.stringify(counts, null, 2) + "\n");
  console.log(`baseline written: ${JSON.stringify(counts)}`);
  process.exit(0);
}
if (args[0] === "--check") {
  if (!existsSync(BASE)) { console.log("no MECHANISM_BASELINE.json — run with --update first"); process.exit(1); }
  const base = JSON.parse(readFileSync(BASE, "utf8"));
  let bad = 0;
  for (const k of Object.keys(counts)) {
    const was = base[k], now = counts[k];
    if (Number.isFinite(was) && now > was) { console.log(`  FAIL  ${k}: ${now} > baseline ${was} — this change added ${now - was}; see --list`); bad++; }
    else if (Number.isFinite(was) && now < was) console.log(`  down  ${k}: ${was} → ${now} — lower the baseline: node tools/mechanism-audit.mjs --update`);
  }
  console.log(bad ? "\nmechanism audit: counts went up" : `mechanism audit: ok — coins ${counts.coins} · draws ${counts.draws} · unsourced ${counts.unsourced} · ledger ${counts.ledger}`);
  process.exit(bad ? 1 : 0);
}
writeFileSync(join(ROOT, "MECHANISM_AUDIT.md"), md);
console.log(md);
