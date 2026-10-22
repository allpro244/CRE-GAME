// THE WORD BUDGET, ENFORCED (ui-revamp PLAN R1, BUILD_SPEC 1b).
//
// Every ui/next/**/*.tsx file is parsed with the TypeScript compiler and two
// things fail the run:
//   - a JSX text node of more than 3 words;
//   - a string literal given to a `label`, `title`, `heading` or `chip` prop
//     (JSX attribute or object property) of more than 3 words.
// Allowed: the `q` prop of <Definition> (40 words), and anything a file marks
// with a `// words-ok` comment on the same line (data, not copy: headlines,
// tenant names). Inbox facts and toasts are checked at runtime (ui/next/words.ts).
//
// Usage: node tools/ui-words.mjs   (exit 1 on any breach)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../src/ui/next");
const PROPS = new Set(["label", "title", "heading", "chip"]);
const MAX = 3;

const words = (s) => s.replace(/[·|/→←▸◂×—–-]/g, " ").trim().split(/\s+/).filter((w) => /[A-Za-z]/.test(w)).length;

function files(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? files(p) : /\.tsx?$/.test(d.name) ? [p] : [];
  });
}

const bad = [];
let scanned = 0;
for (const f of files(root)) {
  scanned++;
  const src = fs.readFileSync(f, "utf8");
  const lines = src.split("\n");
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, f.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const report = (node, text, why) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
    if (/words-ok/.test(lines[line] ?? "")) return;
    bad.push(`${path.relative(process.cwd(), f)}:${line + 1}  ${why}: "${text.trim().slice(0, 80)}"`);
  };
  const literal = (e) => (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) ? e.text : null);
  const visit = (node) => {
    if (ts.isJsxText(node)) {
      const t = node.getText().replace(/\s+/g, " ").trim();
      if (t && words(t) > MAX) report(node, t, `JSX text over ${MAX} words`);
    } else if (ts.isJsxAttribute(node) && PROPS.has(node.name.getText())) {
      const init = node.initializer;
      const t = !init ? null : ts.isStringLiteral(init) ? init.text
        : ts.isJsxExpression(init) && init.expression ? literal(init.expression) : null;
      const owner = node.parent?.parent;
      const tag = owner && (ts.isJsxOpeningElement(owner) || ts.isJsxSelfClosingElement(owner)) ? owner.tagName.getText() : "";
      if (t && !(tag === "Definition") && words(t) > MAX) report(node, t, `${node.name.getText()} over ${MAX} words`);
    } else if (ts.isPropertyAssignment(node) && PROPS.has(node.name.getText())) {
      const t = literal(node.initializer);
      if (t && words(t) > MAX) report(node, t, `${node.name.getText()} over ${MAX} words`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

if (bad.length) {
  console.error(`ui-words: ${bad.length} breach${bad.length === 1 ? "" : "es"} of the word budget (PLAN R1)`);
  for (const b of bad) console.error("  " + b);
  process.exit(1);
}
console.log(`ui-words: ${scanned} file${scanned === 1 ? "" : "s"} in ui/next, all within ${MAX} words.`);
