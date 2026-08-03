// A browser actually opening the new screens. The engine harnesses prove the
// numbers; this proves a human can see them without the page throwing.
import { chromium } from "playwright";

const URL = process.env.URL ?? "http://127.0.0.1:4173/";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });

page.setDefaultTimeout(8000);
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(9000);

// advance a few years so there are books, lenders with history and holdings
// Space advances a month — the button never settles into Playwright's idea of
// "stable" because the map repaints continuously behind it.
for (let i = 0; i < 40; i++) { await page.keyboard.press("Space"); await page.waitForTimeout(90); }
await page.waitForTimeout(600);

const report = {};
for (const [tab, needles] of Object.entries({
  Research: ["The banks", "Cap ratio", "Appetite", "Standing"],
  Books: ["Income statement", "Property cash flow", "Cash flow after debt", "Change in cash"],
  Portfolio: ["Assets"],
})) {
  // The map repaints continuously, so Playwright's actionability checks never
  // settle. Dispatch the click on the DOM node instead — this is a smoke test
  // of the panels, not of the hit-testing.
  const hit = await page.evaluate((name) => {
    const b = [...document.querySelectorAll("button.nav-btn")].find((x) => x.textContent.trim().toLowerCase() === name.toLowerCase());
    if (!b) return false;
    b.click();
    return true;
  }, tab);
  if (!hit) { report[tab] = "TAB NOT FOUND"; continue; }
  await page.waitForTimeout(900);
  const text = await page.innerText("body");
  // the stylesheet small-caps half these labels, so compare case-insensitively
  const flat = text.toLowerCase();
  report[tab] = needles.map((n) => `${flat.includes(n.toLowerCase()) ? "ok" : "MISSING"} ${n}`).join(" · ");
  await page.screenshot({ path: `/tmp/claude-0/-home-user-CRE-GAME/7b00530e-1e2c-5e54-8640-e3b0230e4191/scratchpad/${tab}.png`, animations: "disabled", timeout: 20000 }).catch((e) => report[tab + "-shot"] = String(e.message).slice(0, 60));
}

// the bundle control only exists with two buildings; report whether it showed
const body = await page.innerText("body");
report.bundle = body.toLowerCase().includes("sell several at once") ? "ok · bundling control present" : "not shown (fewer than two buildings)";

console.log(JSON.stringify(report, null, 2));
console.log(errs.length ? "\nERRORS:\n" + errs.slice(0, 12).join("\n") : "\nno console errors");
await b.close();
