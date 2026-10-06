// GROUND AUDIT — does every prop in the 3D city stand on the right ground?
//
//   pnpm dev --port 5176 &   then   node tools/ground-audit.mjs [url] ["island,size,dev,seed;..."]
//
// Starts each town in a headless browser and asks the 3D layer
// (RealCityLayer.auditGround) where each instanced prop stands: building,
// footway, park, open ground (boulevard mall, esplanade), lot, or road. Exits
// 1 if a street tree or lamp is off the footway, a parked car is off the
// carriageway, or a tree stands in the road or inside a building. Needs a
// running dev server, playwright-core and a Chromium (CHROMIUM=path).
// playwright-core is not a dependency of the game; install it alongside (npm i -D playwright-core) to run this
const { chromium } = await import("playwright-core").catch(() => { console.error("ground-audit needs playwright-core: npm i --no-save playwright-core"); process.exit(2); });
const url = process.argv[2] || "http://127.0.0.1:5176/";
const towns = (process.argv[3] || "somewhere,city,town,4;somewhere,city,metropolis,2;somewhere,town,village,1").split(";");
const exe = process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: exe, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
// where each kind may stand
const OK = {
  trunk: ["walk", "park", "open", "lot"], pine: ["walk", "park", "open", "lot"],
  car: ["road"], suv: ["road"], van: ["road"], taxi: ["road"], lotcar: ["lot"], lotsuv: ["lot"], lamp: ["walk"],
  hydrant: ["walk"], bin: ["walk"], shelter: ["walk"], signal: ["walk"], sigpost: ["walk"],
  stoop: ["walk", "lot"], dock: ["lot", "road"], awning: ["walk", "lot"],
};
let bad = 0;
for (const t of towns) {
  const [isl, size, dev, seed] = t.split(",");
  const page = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
  page.setDefaultTimeout(0);
  await page.goto(url, { waitUntil: "load" });
  // a dev server may reload the page once while it warms up: retry the start
  for (let a = 0; a < 3; a++) {
    try {
      await page.waitForFunction(() => window.__store);
      await page.evaluate((t) => window.__store.getState().startRun(t[0], t[1], t[2], undefined, undefined, +t[3]), [isl, size, dev, seed]);
      break;
    } catch { await page.waitForTimeout(4000); }
  }
  await page.waitForFunction(() => window.__three && window.__map && window.__map.loaded(), null, { timeout: 0 });
  const r = await page.evaluate(() => window.__three.auditGround());
  console.log(t);
  for (const [k, row] of Object.entries(r)) {
    const wrong = OK[k] ? Object.entries(row).filter(([g]) => !OK[k].includes(g)).reduce((a, [, n]) => a + n, 0) : 0;
    bad += wrong;
    console.log("  ", k.padEnd(9), JSON.stringify(row), wrong ? `  <- ${wrong} misplaced` : "");
  }
  await page.close();
}
await browser.close();
console.log(bad ? `${bad} props on the wrong ground` : "every prop on its ground");
process.exit(bad ? 1 : 0);
